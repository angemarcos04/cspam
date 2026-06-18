import { describe, expect, it } from "vitest";
import {
  buildMonitorRequirementSummaryState,
  buildSchoolCategoryCounts,
  matchesSchoolCategoryFilter,
  normalizeSchoolLevel,
  normalizeSchoolSector,
} from "@/pages/monitor/useMonitorRequirementData";

describe("buildMonitorRequirementSummaryState", () => {
  it("makes private active package meaning explicit in monitor summary state", () => {
    const result = buildMonitorRequirementSummaryState(
      {
        type: "private",
        indicatorLatest: null,
      },
      true,
    );

    expect(result.packageSchoolType).toBe("private");
    expect(result.activePackageLabel).toBe("FM-QAD uploads only");
    expect(result.requirementModeLabel).toBe("Active package requirements: FM-QAD uploads only.");
    expect(result.missingCount).toBe(1);
  });

  it("treats only monitor-relevant submitted states as active package submission truth", () => {
    const draftState = buildMonitorRequirementSummaryState(
      {
        type: "public",
        indicatorLatest: {
          id: "sub-1",
          status: "draft",
          submittedAt: null,
          reviewedAt: null,
          createdAt: null,
          updatedAt: null,
        },
      },
      true,
    );
    const returnedState = buildMonitorRequirementSummaryState(
      {
        type: "public",
        indicatorLatest: {
          id: "sub-2",
          status: "returned",
          submittedAt: null,
          reviewedAt: null,
          createdAt: null,
          updatedAt: null,
        },
      },
      true,
    );

    expect(draftState.hasActivePackageSubmission).toBe(false);
    expect(returnedState.hasActivePackageSubmission).toBe(true);
    expect(returnedState.hasAnySubmitted).toBe(true);
  });

  it("derives queue and school badge state from refreshed indicator status", () => {
    const forReviewState = buildMonitorRequirementSummaryState(
      {
        type: "public",
        indicatorLatest: {
          id: "sub-1",
          status: "submitted",
          submittedAt: "2026-06-18T08:00:00.000Z",
          reviewedAt: null,
          createdAt: null,
          updatedAt: null,
        },
      },
      true,
    );
    const verifiedState = buildMonitorRequirementSummaryState(
      {
        type: "public",
        indicatorLatest: {
          id: "sub-1",
          status: "validated",
          submittedAt: "2026-06-18T08:00:00.000Z",
          reviewedAt: "2026-06-18T09:00:00.000Z",
          createdAt: null,
          updatedAt: null,
        },
      },
      true,
    );
    const returnedState = buildMonitorRequirementSummaryState(
      {
        type: "public",
        indicatorLatest: {
          id: "sub-1",
          status: "returned",
          submittedAt: "2026-06-18T08:00:00.000Z",
          reviewedAt: "2026-06-18T09:00:00.000Z",
          createdAt: null,
          updatedAt: null,
        },
      },
      true,
    );

    expect(forReviewState.indicatorStatus).toBe("submitted");
    expect(forReviewState.awaitingReviewCount).toBe(1);
    expect(forReviewState.missingCount).toBe(0);

    expect(verifiedState.indicatorStatus).toBe("validated");
    expect(verifiedState.awaitingReviewCount).toBe(0);
    expect(verifiedState.missingCount).toBe(0);

    expect(returnedState.indicatorStatus).toBe("returned");
    expect(returnedState.awaitingReviewCount).toBe(0);
    expect(returnedState.missingCount).toBe(0);
    expect(returnedState.hasActivePackageSubmission).toBe(true);
  });

  it("normalizes school sector and level values used by monitor school filters", () => {
    expect(normalizeSchoolSector("Public")).toBe("public");
    expect(normalizeSchoolSector(" private ")).toBe("private");
    expect(normalizeSchoolSector("charter")).toBeNull();

    expect(normalizeSchoolLevel("Elementary")).toBe("elementary");
    expect(normalizeSchoolLevel("High School")).toBe("high_school");
    expect(normalizeSchoolLevel("secondary")).toBe("high_school");
    expect(normalizeSchoolLevel("integrated")).toBeNull();
  });

  it("counts public and private schools by normalized level", () => {
    const counts = buildSchoolCategoryCounts([
      { type: "Public", level: "Elementary" },
      { type: "public", level: "High School" },
      { type: "Private", level: "Secondary" },
      { type: "private", level: "Elementary" },
      { type: "private", level: null },
      { type: null, level: "Elementary" },
    ]);

    expect(counts).toEqual({
      total: 6,
      public: 2,
      private: 3,
      publicElementary: 1,
      publicHighSchool: 1,
      privateElementary: 1,
      privateHighSchool: 1,
    });
  });

  it("matches school category filters without matching unknown values", () => {
    const publicElementary = { type: "public", level: "Elementary" };
    const privateHighSchool = { type: "Private", level: "Secondary" };
    const unknown = { type: null, level: null };

    expect(matchesSchoolCategoryFilter(publicElementary, "public", "elementary")).toBe(true);
    expect(matchesSchoolCategoryFilter(publicElementary, "public", "high_school")).toBe(false);
    expect(matchesSchoolCategoryFilter(privateHighSchool, "private", "high_school")).toBe(true);
    expect(matchesSchoolCategoryFilter(privateHighSchool, "public", "all")).toBe(false);
    expect(matchesSchoolCategoryFilter(unknown, "all", "all")).toBe(true);
    expect(matchesSchoolCategoryFilter(unknown, "public", "all")).toBe(false);
  });
});
