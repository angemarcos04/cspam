import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
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
}: UseMonitorSubmissionDeepLinkArgs): void {
  const location = useLocation();
  const navigate = useNavigate();
  const processedTargetRef = useRef("");

  useEffect(() => {
    if (!filtersHydrated) return;

    const params = new URLSearchParams(location.search);
    if (params.get("section") !== "reviews") return;

    setActiveTopNavigator("reviews");
    const submissionId = (params.get("submissionId") ?? "").trim();
    if (!submissionId) return;

    const requestedScopeId = (params.get("scopeId") ?? "").trim();
    const targetKey = `${location.key}:${submissionId}:${requestedScopeId}`;
    if (processedTargetRef.current === targetKey) return;
    processedTargetRef.current = targetKey;

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

        const knownScopeIds = new Set([
          ...(submission.scopeProgress?.requiredScopeIds ?? []),
          ...(submission.scopeProgress?.submittedScopeIds ?? []),
          ...(submission.scopeReviews ?? []).map((review) => review.scopeId),
        ]);
        if (!knownScopeIds.has(requestedScopeId)) {
          setHighlightedDrawerIndicatorKey(null);
          pushToast("The referenced requirement is no longer available in this submission.", "warning");
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

        if (isApiError(error) && error.status === 404) {
          navigate("/monitor?section=reviews", { replace: true });
          pushToast("The referenced submission is no longer available.", "warning");
          return;
        }

        pushToast("The referenced submission could not be opened.", "warning");
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
    setActiveSchoolDrawerTab,
    setActiveTopNavigator,
    setHighlightedDrawerIndicatorKey,
    setSelectedSchoolDrawerYear,
  ]);
}
