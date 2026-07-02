import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonitorSchoolRecordForm, type MonitorSchoolRecordFormProps } from "@/pages/monitor/MonitorSchoolRecordForm";

afterEach(() => {
  cleanup();
});

function buildProps(overrides: Partial<MonitorSchoolRecordFormProps> = {}): MonitorSchoolRecordFormProps {
  return {
    show: true,
    editingRecordId: null,
    isSaving: false,
    recordForm: {
      schoolId: "",
      schoolName: "",
      level: "Elementary",
      type: "public",
      district: "",
      region: "",
      address: "",
      createSchoolHeadAccount: true,
      schoolHeadAccountName: "",
      schoolHeadAccountEmail: "",
    },
    recordFormErrors: {},
    recordFormError: "",
    recordFormMessage: "",
    recordFormProvisioning: null,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    onFieldChange: vi.fn(),
    onCreateSchoolHeadAccountChange: vi.fn(),
    onCopyTemporaryPassword: vi.fn(),
    ...overrides,
  };
}

describe("MonitorSchoolRecordForm", () => {
  it("does not render the redundant form header or public submission requirement hint", () => {
    render(<MonitorSchoolRecordForm {...buildProps()} />);

    expect(screen.queryByRole("heading", { name: "Add School Record" })).toBeNull();
    expect(screen.queryByText("Public School Head workspace uses BMEF and SMEA as the active package requirements.")).toBeNull();
    expect(screen.getByLabelText("School Code")).toBeTruthy();
  });

  it("does not render the private submission requirement hint for private schools", () => {
    render(
      <MonitorSchoolRecordForm
        {...buildProps({
          recordForm: {
            schoolId: "",
            schoolName: "",
            level: "Elementary",
            type: "private",
            district: "",
            region: "",
            address: "",
            createSchoolHeadAccount: true,
            schoolHeadAccountName: "",
            schoolHeadAccountEmail: "",
          },
        })}
      />,
    );

    expect(screen.queryByText("Private School Head workspace uses FM-QAD uploads only. BMEF and SMEA are not part of the active package.")).toBeNull();
    expect(screen.getByLabelText("Type")).toBeTruthy();
  });

  it("explains that temporary passwords remain visible to the monitor until the first password change", () => {
    render(<MonitorSchoolRecordForm {...buildProps()} />);

    expect(
      screen.getAllByText(
        "A temporary password will be generated after save. The School Head must change it on first login, and it remains visible in the monitor panel until then.",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("renders school coverage checkboxes instead of a level dropdown", () => {
    render(<MonitorSchoolRecordForm {...buildProps()} />);

    expect(screen.getByText("School Coverage")).toBeTruthy();
    expect(screen.queryByLabelText("Level")).toBeNull();
    expect(screen.getByLabelText("Elementary")).toBeTruthy();
    expect(screen.getByLabelText("Junior High")).toBeTruthy();
    expect(screen.getByLabelText("Senior High")).toBeTruthy();
  });

  it("updates the level field with canonical school coverage values", () => {
    const onFieldChange = vi.fn();

    render(
      <MonitorSchoolRecordForm
        {...buildProps({
          recordForm: {
            schoolId: "",
            schoolName: "",
            level: "Junior High",
            type: "public",
            district: "",
            region: "",
            address: "",
            createSchoolHeadAccount: true,
            schoolHeadAccountName: "",
            schoolHeadAccountEmail: "",
          },
          onFieldChange,
        })}
      />,
    );

    fireEvent.click(screen.getByLabelText("Senior High"));

    expect(onFieldChange).toHaveBeenCalledWith("level", "Junior High / Senior High");
  });
});
