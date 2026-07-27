import { describe, expect, it } from "vitest";
import {
  normalizeSchoolIdentityValue,
  reviewInboxRowMatchesSchoolIdentity,
  schoolIdentitiesMatch,
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

  it("does not cross-match a database id against an unrelated school code", () => {
    const recordA = { id: "12", schoolId: "0401777", schoolCode: "0401777" };
    const recordB = { id: "77", schoolId: "12", schoolCode: "12" };

    expect(schoolRecordMatchesIdentity(recordA, { id: "12" })).toBe(true);
    expect(schoolRecordMatchesIdentity(recordB, { id: "12" })).toBe(false);
    expect(schoolRecordMatchesIdentity(recordA, { schoolCode: "12" })).toBe(false);
    expect(schoolRecordMatchesIdentity(recordB, { schoolCode: "12" })).toBe(true);
  });

  it("compares canonical identities without crossing ids and school codes", () => {
    expect(schoolIdentitiesMatch({ id: "12" }, { schoolCode: "12" })).toBe(false);
    expect(schoolIdentitiesMatch({ schoolId: "0401777" }, { schoolCode: "0401777" })).toBe(true);
  });

  it("matches Review Inbox rows by school code or a typed school key", () => {
    const row = {
      schoolKey: "code:sch-001",
      schoolId: "12",
      schoolCode: "SCH-001",
      schoolName: "Example School",
    };

    expect(reviewInboxRowMatchesSchoolIdentity(row, { schoolCode: "SCH-001" })).toBe(true);
    expect(reviewInboxRowMatchesSchoolIdentity(row, { schoolId: "SCH-001" })).toBe(true);
    expect(reviewInboxRowMatchesSchoolIdentity(row, { id: "12" })).toBe(true);
    expect(reviewInboxRowMatchesSchoolIdentity(row, { id: "SCH-001" })).toBe(false);
  });

  it("keeps Review Inbox database ids separate from school codes", () => {
    const row = {
      schoolKey: "code:12",
      schoolId: "77",
      schoolCode: "12",
      schoolName: "Collision School",
    };

    expect(reviewInboxRowMatchesSchoolIdentity(row, { id: "12" })).toBe(false);
    expect(reviewInboxRowMatchesSchoolIdentity(row, { schoolCode: "12" })).toBe(true);
  });
});
