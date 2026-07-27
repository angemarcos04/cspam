import { describe, expect, it } from "vitest";
import {
  buildSubmissionScopeStateFingerprint,
  compareSubmissionFreshness,
  latestScopeReviewMutationTimestamp,
  resolveFreshestSubmission,
} from "@/utils/indicatorSubmissionState";
import type { IndicatorSubmission } from "@/types";

function submission(overrides: Partial<IndicatorSubmission> = {}): IndicatorSubmission {
  return {
    id: "submission-1",
    formType: "indicator",
    status: "draft",
    statusLabel: "Draft",
    reportingPeriod: "ANNUAL",
    version: 3,
    schoolId: "school-1",
    notes: null,
    reviewNotes: null,
    summary: { totalIndicators: 0, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
    indicators: [],
    academicYear: { id: "year-1", name: "2025-2026" },
    submittedAt: null,
    reviewedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T01:00:00.000Z",
    ...overrides,
  };
}

describe("submission freshness", () => {
  it("orders different versions before timestamps", () => {
    const lower = submission({ version: 2, updatedAt: "2026-07-02T00:00:00.000Z" });
    const higher = submission({ version: 3, updatedAt: "2026-07-01T00:00:00.000Z" });

    expect(compareSubmissionFreshness(higher, lower)).toBeGreaterThan(0);
    expect(resolveFreshestSubmission(higher, lower)).toBe(higher);
  });

  it("uses updatedAt when package versions are equal", () => {
    const older = submission({
      scopeProgress: { submittedScopeIds: [], pendingScopeIds: ["school_achievements_learning_outcomes"] },
    });
    const newer = submission({
      updatedAt: "2026-07-01T02:00:00.000Z",
      scopeProgress: { submittedScopeIds: ["school_achievements_learning_outcomes"], pendingScopeIds: [] },
    });

    expect(compareSubmissionFreshness(newer, older)).toBeGreaterThan(0);
    expect(compareSubmissionFreshness(older, newer)).toBeLessThan(0);
    expect(resolveFreshestSubmission(newer, older)).toBe(newer);
  });

  it("allows a genuinely newer same-version edit to remove submitted scope state", () => {
    const sent = submission({
      scopeProgress: { submittedScopeIds: ["school_achievements_learning_outcomes"], pendingScopeIds: [] },
    });
    const edited = submission({
      updatedAt: "2026-07-01T02:00:00.000Z",
      scopeProgress: { submittedScopeIds: [], pendingScopeIds: ["school_achievements_learning_outcomes"] },
    });

    expect(resolveFreshestSubmission(sent, edited)).toBe(edited);
  });

  it("preserves richer existing detail when version and timestamps tie", () => {
    const detailed = submission({
      indicators: [{ id: "row-1" } as never],
      scopeProgress: { submittedScopeIds: ["school_achievements_learning_outcomes"], pendingScopeIds: [] },
    });
    const sparse = submission({
      scopeProgress: { submittedScopeIds: [], pendingScopeIds: ["school_achievements_learning_outcomes"] },
    });

    expect(resolveFreshestSubmission(detailed, sparse)).toBe(detailed);
  });

  it("uses child review timestamps for repeated verify transitions", () => {
    const submitted = submission({
      scopeReviews: [],
    });
    const verified = submission({
      scopeReviews: [{
        id: "review-1",
        scopeId: "bmef",
        scopeType: "file",
        decision: "verified",
        notes: null,
        reviewedAt: "2026-07-01T10:05:00.000Z",
      }],
    });
    const unverified = submission({
      scopeReviews: [{
        id: "review-1",
        scopeId: "bmef",
        scopeType: "file",
        decision: "unverified",
        notes: null,
        reviewedAt: "2026-07-01T10:06:00.000Z",
      }],
    });
    const reverified = submission({
      scopeReviews: [{
        id: "review-1",
        scopeId: "bmef",
        scopeType: "file",
        decision: "verified",
        notes: null,
        reviewedAt: "2026-07-01T10:07:00.000Z",
      }],
    });

    expect(latestScopeReviewMutationTimestamp(verified)).toBe(Date.parse("2026-07-01T10:05:00.000Z"));
    expect(resolveFreshestSubmission(submitted, verified)).toBe(verified);
    expect(resolveFreshestSubmission(verified, submitted)).toBe(verified);
    expect(resolveFreshestSubmission(verified, unverified)).toBe(unverified);
    expect(resolveFreshestSubmission(unverified, reverified)).toBe(reverified);
    expect(resolveFreshestSubmission(reverified, verified)).toBe(reverified);
  });

  it("uses scope review updatedAt when it is newer than reviewedAt", () => {
    const verified = submission({
      scopeReviews: [{
        id: "review-1",
        scopeId: "bmef",
        scopeType: "file",
        decision: "verified",
        notes: null,
        reviewedAt: "2026-07-01T10:05:00.000Z",
        updatedAt: "2026-07-01T10:08:00.000Z",
      }],
    });

    expect(latestScopeReviewMutationTimestamp(verified)).toBe(Date.parse("2026-07-01T10:08:00.000Z"));
  });
});

describe("scope-state fingerprints", () => {
  it("changes for submitted scopes and review decisions", () => {
    const draft = submission({ scopeProgress: { submittedScopeIds: [], pendingScopeIds: ["bmef"] } });
    const sent = submission({ scopeProgress: { submittedScopeIds: ["bmef"], pendingScopeIds: [] } });
    const verified = submission({
      scopeProgress: { submittedScopeIds: ["bmef"], pendingScopeIds: [] },
      scopeReviews: [{
        id: "review-1",
        scopeId: "bmef",
        scopeType: "file",
        decision: "verified",
        notes: null,
        reviewedAt: "2026-07-01T03:00:00.000Z",
      }],
    });

    expect(buildSubmissionScopeStateFingerprint(sent)).not.toBe(buildSubmissionScopeStateFingerprint(draft));
    expect(buildSubmissionScopeStateFingerprint(verified)).not.toBe(buildSubmissionScopeStateFingerprint(sent));
  });

  it("normalizes scope array order and case", () => {
    const first = submission({ scopeProgress: { submittedScopeIds: ["BMEF", "smea"], pendingScopeIds: [] } });
    const second = submission({ scopeProgress: { submittedScopeIds: ["smea", "bmef"], pendingScopeIds: [] } });

    expect(buildSubmissionScopeStateFingerprint(first)).toBe(buildSubmissionScopeStateFingerprint(second));
  });

  it("changes when corrected-after-return state changes", () => {
    const returned = submission({
      scopeProgress: { correctedAfterReturnScopeIds: [] },
    });
    const corrected = submission({
      scopeProgress: { correctedAfterReturnScopeIds: ["BMEF"] },
    });

    expect(buildSubmissionScopeStateFingerprint(returned))
      .not.toBe(buildSubmissionScopeStateFingerprint(corrected));
  });
});
