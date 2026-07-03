import { describe, expect, it } from "vitest";
import {
  buildTargetsMetFilename,
  findSchoolHeadName,
  formatMetadataValue,
  sanitizeFilenamePart,
} from "@/pages/monitor/exportTargetsMetPdf";
import type { SchoolDetailSnapshot } from "@/pages/monitor/monitorDrawerTypes";

function schoolDetail(overrides: Partial<SchoolDetailSnapshot> = {}): SchoolDetailSnapshot {
  return {
    schoolKey: "school-1",
    schoolCode: "123334",
    schoolName: "AMA CC - Santiago City",
    region: "II",
    level: "Secondary",
    type: "Private",
    schoolTypeRaw: "private",
    requirementModeLabel: "Active package requirements: BMEF and SMEA.",
    activePackageLabel: "BMEF and SMEA",
    address: "Santiago City",
    hasComplianceRecord: true,
    indicatorStatus: "submitted",
    hasActivePackageSubmission: true,
    missingCount: 0,
    awaitingReviewCount: 0,
    lastActivityAt: null,
    reportedStudents: 0,
    reportedTeachers: 0,
    synchronizedStudents: 0,
    synchronizedTeachers: 0,
    ...overrides,
  };
}

describe("exportTargetsMetPdf helpers", () => {
  it("sanitizes filename parts for safe downloads", () => {
    expect(sanitizeFilenamePart(" AMA CC - Santiago City ")).toBe("ama-cc-santiago-city");
    expect(sanitizeFilenamePart("2025 / 2026")).toBe("2025-2026");
    expect(sanitizeFilenamePart("///")).toBe("");
  });

  it("builds a school-code based TARGETS-MET filename", () => {
    expect(buildTargetsMetFilename({
      schoolDetail: schoolDetail(),
      academicYearLabel: "2025-2026",
    })).toBe("targets-met-123334-2025-2026.pdf");
  });

  it("falls back to school name and then generic filename", () => {
    expect(buildTargetsMetFilename({
      schoolDetail: schoolDetail({ schoolCode: "" }),
      academicYearLabel: "2025-2026",
    })).toBe("targets-met-ama-cc-santiago-city-2025-2026.pdf");

    expect(buildTargetsMetFilename({
      schoolDetail: schoolDetail({ schoolCode: "", schoolName: "" }),
      academicYearLabel: "2025-2026",
    })).toBe("targets-met-report.pdf");
  });

  it("finds the optional school head row safely", () => {
    expect(findSchoolHeadName([
      { key: "enrolment", label: "TOTAL NUMBER OF ENROLMENT", value: "500" },
      { key: "school_head_name", label: " NAME OF SCHOOL HEAD ", value: "Dr. Maria Santos" },
    ])).toBe("Dr. Maria Santos");

    expect(findSchoolHeadName([
      { key: "school_head_name", label: "NAME OF SCHOOL HEAD", value: "-" },
    ])).toBeNull();
  });

  it("normalizes blank metadata values to N/A", () => {
    expect(formatMetadataValue("  Public  ")).toBe("Public");
    expect(formatMetadataValue("")).toBe("N/A");
    expect(formatMetadataValue(null)).toBe("N/A");
  });
});
