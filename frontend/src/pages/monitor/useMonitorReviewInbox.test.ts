import { describe, expect, it } from "vitest";
import { buildMonitorReviewInboxUrl } from "@/pages/monitor/useMonitorReviewInbox";

describe("buildMonitorReviewInboxUrl", () => {
  it("maps URL-backed monitor filters to the review inbox API params", () => {
    const url = buildMonitorReviewInboxUrl(
      {
        search: "Santiago",
        status: "active",
        workflow: "waiting",
        lane: "for_review",
        preset: "pending",
        sector: "public",
        level: "elementary",
        schoolId: "42",
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
        academicYearId: "7",
      },
      3,
      25,
    );

    expect(url).toBe(
      "/api/dashboard/review-inbox?search=Santiago&status=active&workflow=waiting&lane=for_review&preset=pending&sector=public&level=elementary&school_id=42&date_from=2026-01-01&date_to=2026-12-31&academic_year_id=7&page=3&per_page=25",
    );
  });

  it("omits all/default filters and keeps pagination", () => {
    expect(buildMonitorReviewInboxUrl({
      search: "",
      status: "all",
      workflow: "all",
      lane: "all",
      preset: "all",
      sector: "all",
      level: "all",
    }, 1, 10)).toBe("/api/dashboard/review-inbox?page=1&per_page=10");
  });
});
