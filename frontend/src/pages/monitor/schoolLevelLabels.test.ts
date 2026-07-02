import { describe, expect, it } from "vitest";
import {
  CANONICAL_SCHOOL_COVERAGE_VALUES,
  coverageTokensToStoredLevel,
  formatSchoolCoverageLabel,
  formatSchoolLevelLabel,
  hasSchoolCoverageToken,
  isLegacyHighSchoolCoverage,
  normalizeSchoolLevelToken,
  parseSchoolCoverage,
} from "@/pages/monitor/schoolLevelLabels";

describe("schoolLevelLabels", () => {
  it("parses known coverage values and aliases into canonical ordered tokens", () => {
    expect(parseSchoolCoverage("Elementary").tokens).toEqual(["elementary"]);
    expect(parseSchoolCoverage("elem").tokens).toEqual(["elementary"]);
    expect(parseSchoolCoverage("Junior High").tokens).toEqual(["junior_high"]);
    expect(parseSchoolCoverage("Junior High School").tokens).toEqual(["junior_high"]);
    expect(parseSchoolCoverage("JHS").tokens).toEqual(["junior_high"]);
    expect(parseSchoolCoverage("Senior High").tokens).toEqual(["senior_high"]);
    expect(parseSchoolCoverage("Senior High School").tokens).toEqual(["senior_high"]);
    expect(parseSchoolCoverage("SHS").tokens).toEqual(["senior_high"]);
  });

  it("parses multi-coverage separators, removes duplicates, and preserves canonical order", () => {
    expect(parseSchoolCoverage("Senior High / Elementary").tokens).toEqual(["elementary", "senior_high"]);
    expect(parseSchoolCoverage("Elementary, Junior High").tokens).toEqual(["elementary", "junior_high"]);
    expect(parseSchoolCoverage("Senior High + Junior High").tokens).toEqual(["junior_high", "senior_high"]);
    expect(parseSchoolCoverage("Junior High & Senior High").tokens).toEqual(["junior_high", "senior_high"]);
    expect(parseSchoolCoverage("Elementary | JHS | Elementary").tokens).toEqual(["elementary", "junior_high"]);
  });

  it("formats and stores coverage using canonical labels", () => {
    expect(coverageTokensToStoredLevel(["senior_high", "elementary"])).toBe("Elementary / Senior High");
    expect(formatSchoolCoverageLabel("Elementary / Junior High / SHS")).toBe("Elementary / Junior High / Senior High");
    expect(formatSchoolCoverageLabel(null)).toBe("N/A");
    expect(formatSchoolLevelLabel("Junior High")).toBe("Junior High");
    expect(CANONICAL_SCHOOL_COVERAGE_VALUES).toContain("Elementary / Junior High / Senior High");
  });

  it("flags legacy High School without converting it into Junior or Senior High", () => {
    expect(parseSchoolCoverage("High School")).toMatchObject({ tokens: [], legacyHighSchool: true, unknownLabel: null });
    expect(parseSchoolCoverage("secondary")).toMatchObject({ tokens: [], legacyHighSchool: true, unknownLabel: null });
    expect(isLegacyHighSchoolCoverage("High School")).toBe(true);
    expect(formatSchoolCoverageLabel("High School")).toBe("High School");
    expect(hasSchoolCoverageToken("High School", "junior_high")).toBe(false);
    expect(normalizeSchoolLevelToken("High School")).toBe("high_school");
  });

  it("flags empty and unknown coverage safely", () => {
    expect(parseSchoolCoverage("").tokens).toEqual([]);
    expect(parseSchoolCoverage("integrated").unknownLabel).toBe("integrated");
    expect(formatSchoolCoverageLabel("integrated school")).toBe("Integrated School");
    expect(normalizeSchoolLevelToken("integrated")).toBe("unknown");
  });
});
