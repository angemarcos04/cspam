import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { IndicatorDataContextType } from "@/context/IndicatorData";
import { isApiError } from "@/lib/api";
import { normalizeSchoolKey } from "@/pages/monitor/monitorRequirementRules";
import type { MonitorTopNavigatorId } from "@/pages/monitor/monitorFilters";
import type { SchoolDrawerTab } from "@/pages/monitor/useSchoolDrawer";

type ToastTone = "success" | "info" | "warning";

interface UseMonitorSubmissionDeepLinkArgs {
  filtersHydrated: boolean;
  fetchSubmission: IndicatorDataContextType["fetchSubmission"];
  refreshSubmissions: () => Promise<unknown>;
  refreshReviewInbox: () => Promise<unknown>;
  setActiveTopNavigator: Dispatch<SetStateAction<MonitorTopNavigatorId>>;
  openSchoolDrawer: (schoolKey: string, submissionId?: string | null) => void;
  setActiveSchoolDrawerTab: Dispatch<SetStateAction<SchoolDrawerTab>>;
  setSelectedSchoolDrawerYear: Dispatch<SetStateAction<string | null>>;
  setHighlightedDrawerIndicatorKey: Dispatch<SetStateAction<string | null>>;
  pushToast: (message: string, tone?: ToastTone) => void;
}

export interface SubmissionDeepLinkError {
  message: string;
  retryable: boolean;
}

export interface UseMonitorSubmissionDeepLinkResult {
  error: SubmissionDeepLinkError | null;
  retry: () => void;
}

export function useMonitorSubmissionDeepLink({
  filtersHydrated,
  fetchSubmission,
  refreshSubmissions,
  refreshReviewInbox,
  setActiveTopNavigator,
  openSchoolDrawer,
  setActiveSchoolDrawerTab,
  setSelectedSchoolDrawerYear,
  setHighlightedDrawerIndicatorKey,
  pushToast,
}: UseMonitorSubmissionDeepLinkArgs): UseMonitorSubmissionDeepLinkResult {
  const location = useLocation();
  const navigate = useNavigate();
  const processedTargetRef = useRef("");
  const [retryNonce, setRetryNonce] = useState(0);
  const [error, setError] = useState<SubmissionDeepLinkError | null>(null);

  const retry = useCallback(() => {
    if (!error?.retryable) return;
    setError(null);
    setRetryNonce((value) => value + 1);
  }, [error]);

  useEffect(() => {
    if (!filtersHydrated) return;

    const params = new URLSearchParams(location.search);
    if (params.get("section") !== "reviews") return;

    setActiveTopNavigator("reviews");
    const submissionId = (params.get("submissionId") ?? "").trim();
    if (!submissionId) return;

    const requestedScopeId = (params.get("scopeId") ?? "").trim();
    const targetKey = `${location.key}:${submissionId}:${requestedScopeId}:${retryNonce}`;
    if (processedTargetRef.current === targetKey) return;
    processedTargetRef.current = targetKey;
    setError(null);

    let active = true;
    void Promise.allSettled([refreshReviewInbox(), refreshSubmissions()])
      .then(() => fetchSubmission(submissionId))
      .then((submission) => {
        if (!active) return;

        const authoritativeSchoolId = String(submission.school?.id ?? submission.schoolId ?? "").trim();
        const authoritativeYearId = String(submission.academicYear?.id ?? submission.academicYearId ?? "").trim();
        const suppliedSchoolId = (params.get("schoolId") ?? "").trim();
        const suppliedYearId = (params.get("academicYearId") ?? "").trim();

        if (import.meta.env.DEV && (
          (suppliedSchoolId && suppliedSchoolId !== authoritativeSchoolId)
          || (suppliedYearId && suppliedYearId !== authoritativeYearId)
        )) {
          console.warn("Monitor notification target metadata did not match the authoritative submission.", {
            submissionId,
          });
        }

        const schoolKey = normalizeSchoolKey(
          submission.school?.schoolCode ?? authoritativeSchoolId,
          submission.school?.name,
        );
        openSchoolDrawer(schoolKey, submission.id);
        setActiveSchoolDrawerTab("submissions");
        setSelectedSchoolDrawerYear(authoritativeYearId || null);

        if (!requestedScopeId) {
          setHighlightedDrawerIndicatorKey(null);
          return;
        }

        const submittedScopeIds = new Set(submission.scopeProgress?.submittedScopeIds ?? []);
        const reviewedScopeIds = new Set((submission.scopeReviews ?? []).map((review) => review.scopeId));
        if (!submittedScopeIds.has(requestedScopeId) && !reviewedScopeIds.has(requestedScopeId)) {
          setHighlightedDrawerIndicatorKey(null);
          pushToast("The referenced requirement has not been submitted or is no longer available for review.", "warning");
          return;
        }

        setHighlightedDrawerIndicatorKey(requestedScopeId);
        const review = (submission.scopeReviews ?? []).find((entry) => entry.scopeId === requestedScopeId);
        if (review && review.decision !== "unverified") {
          pushToast("This requirement has already been reviewed.", "info");
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setActiveTopNavigator("reviews");

        if (isApiError(error) && error.status === 401) {
          return;
        }

        if (isApiError(error) && error.status === 404) {
          navigate("/monitor?section=reviews", { replace: true });
          pushToast("The referenced submission is no longer available.", "warning");
          return;
        }

        if (isApiError(error) && error.status === 403) {
          navigate("/monitor?section=reviews", { replace: true });
          pushToast("The referenced submission could not be opened.", "warning");
          return;
        }

        pushToast("The referenced submission could not be opened.", "warning");
        setError({
          message: "The referenced submission could not be opened.",
          retryable: true,
        });
      });

    return () => {
      active = false;
    };
  }, [
    fetchSubmission,
    filtersHydrated,
    location.key,
    location.search,
    navigate,
    openSchoolDrawer,
    pushToast,
    refreshReviewInbox,
    refreshSubmissions,
    retryNonce,
    setActiveSchoolDrawerTab,
    setActiveTopNavigator,
    setHighlightedDrawerIndicatorKey,
    setSelectedSchoolDrawerYear,
  ]);

  return { error, retry };
}
