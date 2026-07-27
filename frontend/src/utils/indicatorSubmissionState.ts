import type { IndicatorSubmission } from "@/types";

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function latestMutationTimestamp(submission: IndicatorSubmission): number | null {
  const timestamps = [
    parseTimestamp(submission.updatedAt),
    parseTimestamp(submission.submittedAt),
    parseTimestamp(submission.reviewedAt),
    parseTimestamp(submission.createdAt),
  ].filter((value): value is number => value !== null);

  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

function numericVersion(submission: IndicatorSubmission): number | null {
  return typeof submission.version === "number" && Number.isFinite(submission.version)
    ? submission.version
    : null;
}

export function submissionDetailRichness(submission: IndicatorSubmission): number {
  const rows = Array.isArray(submission.items) && submission.items.length > 0
    ? submission.items
    : submission.indicators;
  const availableFiles = Object.values(submission.files ?? {}).filter(Boolean).length;
  const scopeProgressEntries = Object.values(submission.scopeProgress ?? {})
    .reduce<number>((count, value) => count + (Array.isArray(value) ? value.length : 0), 0);

  return rows.length * 10
    + availableFiles * 4
    + (submission.scopeReviews?.length ?? 0) * 2
    + scopeProgressEntries
    + (submission.school ? 1 : 0)
    + (submission.academicYear?.id ? 1 : 0);
}

/**
 * Returns a positive number when left is fresher, a negative number when right
 * is fresher, and zero when neither object has an ordering advantage.
 */
export function compareSubmissionFreshness(
  left: IndicatorSubmission,
  right: IndicatorSubmission,
): number {
  const leftVersion = numericVersion(left);
  const rightVersion = numericVersion(right);

  if (leftVersion !== null && rightVersion !== null && leftVersion !== rightVersion) {
    return leftVersion - rightVersion;
  }

  const leftTimestamp = latestMutationTimestamp(left);
  const rightTimestamp = latestMutationTimestamp(right);
  if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }
  if (leftTimestamp !== null && rightTimestamp === null) return 1;
  if (leftTimestamp === null && rightTimestamp !== null) return -1;

  return submissionDetailRichness(left) - submissionDetailRichness(right);
}

export function resolveFreshestSubmission(
  existing: IndicatorSubmission | undefined,
  incoming: IndicatorSubmission,
): IndicatorSubmission {
  if (!existing) return incoming;
  return compareSubmissionFreshness(incoming, existing) > 0 ? incoming : existing;
}

function normalizeScopeIds(values: string[] | undefined): string {
  return [...new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))]
    .sort()
    .join(",");
}

function normalizeScopeReviews(submission: IndicatorSubmission | null | undefined): string {
  return (submission?.scopeReviews ?? [])
    .map((review) => [
      String(review.scopeType ?? "").trim().toLowerCase(),
      String(review.scopeId ?? "").trim().toLowerCase(),
      String(review.decision ?? "").trim().toLowerCase(),
      review.updatedAt ?? review.reviewedAt ?? "",
    ].join("~"))
    .sort()
    .join(",");
}

export function buildSubmissionScopeStateFingerprint(
  submission: IndicatorSubmission | null | undefined,
): string {
  return [
    normalizeScopeIds(submission?.scopeProgress?.requiredScopeIds),
    normalizeScopeIds(submission?.scopeProgress?.submittedScopeIds),
    normalizeScopeIds(submission?.scopeProgress?.pendingScopeIds),
    normalizeScopeIds(submission?.scopeProgress?.previouslySubmittedScopeIds),
    normalizeScopeIds(submission?.scopeProgress?.requiresResubmissionScopeIds),
    normalizeScopeReviews(submission),
  ].join("|");
}
