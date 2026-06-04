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
