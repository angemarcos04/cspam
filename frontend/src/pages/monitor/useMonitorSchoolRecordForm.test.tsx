import { act, renderHook, waitFor } from "@testing-library/react";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { useMonitorSchoolRecordForm } from "@/pages/monitor/useMonitorSchoolRecordForm";

function submitEvent() {
  return { preventDefault: vi.fn() } as unknown as FormEvent<HTMLFormElement>;
}

describe("useMonitorSchoolRecordForm", () => {
  it("starts Add School with empty coverage and validates that coverage is required", () => {
    const { result } = renderHook(() =>
      useMonitorSchoolRecordForm({
        isSaving: false,
        addRecord: vi.fn(),
        updateRecord: vi.fn(),
        clearDeleteError: vi.fn(),
        clearBulkImportError: vi.fn(),
        clearBulkImportFeedback: vi.fn(),
      }),
    );

    act(() => {
      result.current.openCreateRecordForm();
    });

    expect(result.current.schoolRecordFormProps.recordForm.level).toBe("");

    act(() => {
      result.current.schoolRecordFormProps.onSubmit(submitEvent());
    });

    expect(result.current.schoolRecordFormProps.recordFormErrors.level).toBe("School coverage is required.");
  });

  it("submits selected school coverage as a canonical level string", async () => {
    const addRecord = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() =>
      useMonitorSchoolRecordForm({
        isSaving: false,
        addRecord,
        updateRecord: vi.fn(),
        clearDeleteError: vi.fn(),
        clearBulkImportError: vi.fn(),
        clearBulkImportFeedback: vi.fn(),
      }),
    );

    act(() => {
      result.current.openCreateRecordForm();
      result.current.schoolRecordFormProps.onFieldChange("schoolId", "955566");
      result.current.schoolRecordFormProps.onFieldChange("schoolName", "Coverage Hook School");
      result.current.schoolRecordFormProps.onFieldChange("level", "Senior High / Elementary");
      result.current.schoolRecordFormProps.onFieldChange("address", "Main Road");
      result.current.schoolRecordFormProps.onCreateSchoolHeadAccountChange(false);
    });

    await act(async () => {
      await result.current.schoolRecordFormProps.onSubmit(submitEvent());
    });

    await waitFor(() => {
      expect(addRecord).toHaveBeenCalledWith(expect.objectContaining({ level: "Elementary / Senior High" }));
    });
  });
});
