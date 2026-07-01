import { describe, expect, it } from "vitest";
import {
  BACKEND_SUPPORTED_SCHOOL_LEVEL_OPTIONS,
  coerceBackendSupportedSchoolLevel,
  formatSchoolLevelLabel,
  normalizeSchoolLevelToken,
} from "@/pages/monitor/schoolLevelLabels";

describe("schoolLevelLabels", () => {
  it("normalizes known school level values into stable frontend tokens", () => {
    expect(normalizeSchoolLevelToken(null)).toBe("unknown");
    expect(normalizeSchoolLevelToken("")).toBe("unknown");
    expect(normalizeSchoolLevelToken("Elementary")).toBe("elementary");
    expect(normalizeSchoolLevelToken("High School")).toBe("high_school");
    expect(normalizeSchoolLevelToken("secondary")).toBe("high_school");
    expect(normalizeSchoolLevelToken("junior_high")).toBe("junior_high");
    expect(normalizeSchoolLevelToken("Junior High School")).toBe("junior_high");
    expect(normalizeSchoolLevelToken("JHS")).toBe("junior_high");
    expect(normalizeSchoolLevelToken("senior-high")).toBe("senior_high");
    expect(normalizeSchoolLevelToken("Senior High School")).toBe("senior_high");
    expect(normalizeSchoolLevelToken("SHS")).toBe("senior_high");
    expect(normalizeSchoolLevelToken("integrated")).toBe("unknown");
  });

  it("formats school level labels safely for monitor display", () => {
    expect(formatSchoolLevelLabel("Elementary")).toBe("Elementary");
    expect(formatSchoolLevelLabel("high_school")).toBe("High School");
    expect(formatSchoolLevelLabel("secondary")).toBe("High School");
    expect(formatSchoolLevelLabel("Junior High")).toBe("Junior High");
    expect(formatSchoolLevelLabel("JHS")).toBe("Junior High");
    expect(formatSchoolLevelLabel("Senior High")).toBe("Senior High");
    expect(formatSchoolLevelLabel("SHS")).toBe("Senior High");
    expect(formatSchoolLevelLabel(null)).toBe("N/A");
    expect(formatSchoolLevelLabel("integrated school")).toBe("Integrated School");
  });

  it("keeps backend-supported form options limited until persistence support changes", () => {
    expect(BACKEND_SUPPORTED_SCHOOL_LEVEL_OPTIONS).toEqual(["Elementary", "High School"]);
    expect(coerceBackendSupportedSchoolLevel("secondary")).toBe("High School");
    expect(coerceBackendSupportedSchoolLevel("Junior High")).toBe("Elementary");
    expect(coerceBackendSupportedSchoolLevel("Senior High", "High School")).toBe("High School");
  });
});
