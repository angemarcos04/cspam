import { describe, expect, it } from "vitest";
import {
  normalizeSchoolIdentityValue,
  schoolRecordMatchesIdentity,
} from "@/utils/schoolRecordIdentity";

const record = {
  id: "12",
  schoolId: "401777",
  schoolCode: "0401777",
};

describe("schoolRecordIdentity", () => {
  it("normalizes numeric and whitespace-padded identity values", () => {
    expect(normalizeSchoolIdentityValue(12)).toBe("12");
    expect(normalizeSchoolIdentityValue(" 12 ")).toBe("12");
    expect(normalizeSchoolIdentityValue(null)).toBe("");
  });

  it.each([
    [{ id: "12" }, "database id"],
    [{ id: 12 }, "numeric database id"],
    [{ schoolId: " 401777 " }, "schoolId"],
    [{ schoolCode: "0401777" }, "school code"],
    [{ id: "401777" }, "route identity stored as schoolId"],
  ])("matches by $1", (identity, _label) => {
    expect(schoolRecordMatchesIdentity(record, identity)).toBe(true);
  });

  it("preserves significant leading zeros in school codes", () => {
    expect(schoolRecordMatchesIdentity(record, { schoolCode: "0401777" })).toBe(true);
    expect(schoolRecordMatchesIdentity(record, { schoolCode: 401777 })).toBe(true);
    expect(normalizeSchoolIdentityValue("0401777")).toBe("0401777");
  });

  it("does not match empty or unrelated identities", () => {
    expect(schoolRecordMatchesIdentity(record, {})).toBe(false);
    expect(schoolRecordMatchesIdentity(record, { id: "13" })).toBe(false);
    expect(schoolRecordMatchesIdentity(record, { schoolCode: " " })).toBe(false);
  });
});
