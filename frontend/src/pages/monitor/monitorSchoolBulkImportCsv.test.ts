import { describe, expect, it } from "vitest";

import { parseSchoolBulkImportCsv } from "./monitorSchoolBulkImportCsv";

describe("parseSchoolBulkImportCsv", () => {
  it("accepts school-only CSV rows without student or teacher counts", () => {
    const result = parseSchoolBulkImportCsv(
      [
        "school_id,school_name,level,type,address",
        "955551,School Only Elementary,elementary,public,\"District 1, Santiago City\"",
      ].join("\n"),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        schoolId: "955551",
        schoolName: "School Only Elementary",
        level: "elementary",
        type: "public",
        address: "District 1, Santiago City",
        district: null,
        region: null,
        status: "active",
        schoolHeadName: null,
        schoolHeadEmail: null,
      },
    ]);
  });

  it("accepts optional district, region, and status columns", () => {
    const result = parseSchoolBulkImportCsv(
      [
        "code,school,level,type,address,district,region,status",
        "955552,Santiago Private High,secondary,private,Main Street,District A,Region II,pending",
      ].join("\n"),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      schoolId: "955552",
      schoolName: "Santiago Private High",
      level: "secondary",
      type: "private",
      address: "Main Street",
      district: "District A",
      region: "Region II",
      status: "pending",
    });
  });

  it("does not require legacy count columns", () => {
    const result = parseSchoolBulkImportCsv("school_id,school_name,level,type,address\n955553,No Counts,High School,public,Main");

    expect(result.errors.join(" ")).not.toContain("student_count");
    expect(result.errors.join(" ")).not.toContain("teacher_count");
    expect(result.rows).toHaveLength(1);
  });

  it("accepts School Head account columns when name and email are both present", () => {
    const result = parseSchoolBulkImportCsv(
      [
        "school_id,school_name,level,type,address,school_head_name,school_head_email",
        "955556,With Head,Elementary,public,Main,Head Teacher,HEAD@example.com",
      ].join("\n"),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      schoolHeadName: "Head Teacher",
      schoolHeadEmail: "head@example.com",
    });
  });

  it("rejects rows with only one School Head account field", () => {
    const missingEmail = parseSchoolBulkImportCsv(
      "school_id,school_name,level,type,address,school_head_name\n955557,Missing Email,Elementary,public,Main,Head Teacher",
    );
    const missingName = parseSchoolBulkImportCsv(
      "school_id,school_name,level,type,address,school_head_email\n955558,Missing Name,Elementary,public,Main,head@example.com",
    );

    expect(missingEmail.errors).toEqual(["Row 2: School Head name and email must be provided together."]);
    expect(missingName.errors).toEqual(["Row 2: School Head name and email must be provided together."]);
  });

  it("rejects invalid School Head email values", () => {
    const result = parseSchoolBulkImportCsv(
      "school_id,school_name,level,type,address,school_head_name,school_head_email\n955559,Bad Email,Elementary,public,Main,Head Teacher,not-email",
    );

    expect(result.errors).toEqual(["Row 2: School Head email must be a valid email address."]);
    expect(result.rows).toEqual([]);
  });

  it("rejects invalid school code, type, and status values", () => {
    const result = parseSchoolBulkImportCsv(
      [
        "school_id,school_name,level,type,address,status",
        "ABC,Invalid Code,Elementary,public,Main,active",
        "955554,Invalid Type,Elementary,charter,Main,active",
        "955555,Invalid Status,Elementary,public,Main,paused",
      ].join("\n"),
    );

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      "Row 2: School Code must be 6 digits.",
      "Row 3: Type must be public or private.",
      "Row 4: Status must be active, inactive, or pending.",
    ]);
  });
});
