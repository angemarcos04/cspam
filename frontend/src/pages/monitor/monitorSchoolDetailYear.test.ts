import { describe, expect, it } from "vitest";
import { buildMonitorDrawerYearDetail } from "@/pages/monitor/monitorSchoolDetailYear";
import type { SchoolDetailSnapshot } from "@/pages/monitor/monitorDrawerTypes";
import type { IndicatorSubmission } from "@/types";

const schoolDetail: SchoolDetailSnapshot = {
  schoolKey: "school-1",
  schoolCode: "401777",
  schoolName: "AMA CC - Santiago City",
  region: "II",
  level: "High School",
  type: "Public",
  schoolTypeRaw: "public",
  requirementModeLabel: "Public school requirements",
  activePackageLabel: "BMEF and SMEA",
  address: "N/A",
  hasComplianceRecord: true,
  indicatorStatus: "draft",
  hasActivePackageSubmission: true,
  missingCount: 0,
  awaitingReviewCount: 1,
  lastActivityAt: null,
  reportedStudents: 0,
  reportedTeachers: 0,
  synchronizedStudents: 0,
  synchronizedTeachers: 0,
};

function buildSubmission(fileAvailable: boolean): IndicatorSubmission {
  return {
    id: "sub-1",
    formType: "indicator",
    status: "draft",
    statusLabel: "Draft",
    reportingPeriod: "ANNUAL",
    version: 1,
    schoolId: "school-1",
    schoolType: "public",
    academicYearId: "ay-1",
    academicYear: {
      id: "ay-1",
      name: "2025-2026",
    },
    notes: null,
    reviewNotes: null,
    summary: {
      totalIndicators: 0,
      metIndicators: 0,
      belowTargetIndicators: 0,
      complianceRatePercent: 0,
    },
    files: {
      bmef: {
        type: "bmef",
        uploaded: true,
        available: fileAvailable,
        missingFromStorage: !fileAvailable,
        path: null,
        originalFilename: "bmef.pdf",
        sizeBytes: 2048,
        uploadedAt: "2026-06-14T06:39:00.000Z",
        downloadUrl: fileAvailable ? "/api/submissions/sub-1/download/bmef" : null,
        viewUrl: fileAvailable ? "/api/submissions/sub-1/view/bmef" : null,
      },
    },
    completion: {
      hasImetaFormData: false,
      hasBmefFile: true,
      hasSmeaFile: false,
      isComplete: false,
      requiredFileTypes: ["bmef", "smea"],
      uploadedFileTypes: ["bmef"],
      missingFileTypes: ["smea"],
    },
    scopeProgress: {
      requiredScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "bmef", "smea"],
      submittedScopeIds: ["bmef"],
      pendingScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "smea"],
      submittedRequiredScopeCount: 1,
      totalRequiredScopeCount: 4,
    },
    scopeReviews: [],
    indicators: [],
    submittedAt: null,
    reviewedAt: null,
    createdAt: "2026-06-14T06:00:00.000Z",
    updatedAt: "2026-06-14T06:39:00.000Z",
  };
}

describe("buildMonitorDrawerYearDetail", () => {
  it("marks sent file rows with missing storage as unavailable and not reviewable", () => {
    const detail = buildMonitorDrawerYearDetail(
      schoolDetail,
      "ay-1",
      [buildSubmission(false)],
      [],
    );

    const bmefRow = detail?.packageRows.find((row) => row.id === "bmef");

    expect(bmefRow).toBeDefined();
    expect(bmefRow?.statusLabel).toBe("For Review");
    expect(bmefRow?.detail).toBe("Submitted file record exists, but stored file is missing. Ask the School Head to re-upload and resend.");
    expect(bmefRow?.available).toBe(false);
    expect(bmefRow?.missingFromStorage).toBe(true);
    expect(bmefRow?.fileUnavailableReason).toBe("Submitted file record exists, but stored file is missing. Ask the School Head to re-upload and resend.");
    expect(bmefRow?.viewUrl).toBeNull();
    expect(bmefRow?.downloadUrl).toBeNull();
    expect(bmefRow?.canReview).toBe(false);
  });
});
