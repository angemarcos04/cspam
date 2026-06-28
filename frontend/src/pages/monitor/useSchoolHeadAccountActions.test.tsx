import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, SERVICE_UNAVAILABLE_MESSAGE } from "@/lib/api";
import { useSchoolHeadAccountActions } from "@/pages/monitor/useSchoolHeadAccountActions";
import type { SchoolRecord } from "@/types";

function makeOptions(overrides: Partial<Parameters<typeof useSchoolHeadAccountActions>[0]> = {}) {
  return {
    isPanelOpen: true,
    isSaving: false,
    pushToast: vi.fn(),
    updateSchoolHeadAccountStatus: vi.fn(),
    activateSchoolHeadAccount: vi.fn(),
    issueSchoolHeadAccountActionVerificationCode: vi.fn(),
    issueSchoolHeadSetupLink: vi.fn(),
    issueSchoolHeadPasswordResetLink: vi.fn(),
    issueSchoolHeadTemporaryPassword: vi.fn(),
    upsertSchoolHeadAccountProfile: vi.fn(),
    removeSchoolHeadAccount: vi.fn(),
    ...overrides,
  };
}

function makePendingSetupRecord(): SchoolRecord {
  return {
    id: "school-1",
    schoolName: "AMA Computer College - Santiago",
    schoolHeadAccount: {
      id: "head-1",
      name: "School Head",
      email: "head@example.test",
      accountStatus: "pending_setup",
    },
  } as unknown as SchoolRecord;
}

describe("useSchoolHeadAccountActions", () => {
  it("preserves backend setup-link 503 messages in user-visible toasts", async () => {
    const issueSchoolHeadSetupLink = vi.fn().mockRejectedValue(
      new ApiError(
        "Account setup token storage is unavailable. Run database migrations first.",
        503,
        {
          message: "Account setup token storage is unavailable. Run database migrations first.",
          errorCode: "account_setup_storage_unavailable",
        },
      ),
    );
    const pushToast = vi.fn();

    const { result } = renderHook(() => useSchoolHeadAccountActions(makeOptions({
      issueSchoolHeadSetupLink,
      pushToast,
    })));

    await act(async () => {
      await result.current.handleIssueSchoolHeadSetupLink(makePendingSetupRecord());
    });

    expect(pushToast).toHaveBeenCalledWith(
      "Account setup token storage is unavailable. Run database migrations first.",
      "warning",
    );
    expect(pushToast).not.toHaveBeenCalledWith(SERVICE_UNAVAILABLE_MESSAGE, "warning");
  });
});
