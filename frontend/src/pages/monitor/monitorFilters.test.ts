import { describe, expect, it } from "vitest";
import { isValidSchoolLevelFilter } from "@/pages/monitor/monitorFilters";

describe("monitor school coverage filters", () => {
  it("retains Kindergarten and existing persisted filter values", () => {
    expect(isValidSchoolLevelFilter("kindergarten")).toBe(true);
    expect(isValidSchoolLevelFilter("elementary")).toBe(true);
    expect(isValidSchoolLevelFilter("junior_high")).toBe(true);
    expect(isValidSchoolLevelFilter("senior_high")).toBe(true);
    expect(isValidSchoolLevelFilter("legacy_high_school")).toBe(true);
    expect(isValidSchoolLevelFilter("high_school")).toBe(true);
    expect(isValidSchoolLevelFilter("nursery")).toBe(false);
  });
});
