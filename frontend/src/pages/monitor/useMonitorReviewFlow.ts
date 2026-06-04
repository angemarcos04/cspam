import { useCallback, useEffect, useState } from "react";

export interface ReviewCompletionPayload {
  schoolKey: string;
  schoolName: string;
  submissionId: string;
  action: "validated" | "returned";
}

interface UseMonitorReviewFlowArgs {
  activeSchoolDrawerKey: string | null;
  onRefreshActiveDrawer: () => void;
}

export interface UseMonitorReviewFlowResult {
  handleQueueReviewCompleted: (payload: ReviewCompletionPayload) => void;
}

export function useMonitorReviewFlow({
  activeSchoolDrawerKey,
  onRefreshActiveDrawer,
}: UseMonitorReviewFlowArgs): UseMonitorReviewFlowResult {
  const [lastReviewCompletion, setLastReviewCompletion] = useState<ReviewCompletionPayload | null>(null);

  const handleQueueReviewCompleted = useCallback((payload: ReviewCompletionPayload) => {
    setLastReviewCompletion(payload);
  }, []);

  useEffect(() => {
    if (!lastReviewCompletion) {
      return;
    }

    if (
      activeSchoolDrawerKey &&
      activeSchoolDrawerKey === lastReviewCompletion.schoolKey
    ) {
      onRefreshActiveDrawer();
    }

    setLastReviewCompletion(null);
  }, [
    activeSchoolDrawerKey,
    lastReviewCompletion,
    onRefreshActiveDrawer,
  ]);

  return {
    handleQueueReviewCompleted,
  };
}
