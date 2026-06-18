import { expect, test, type Page, type Route } from "@playwright/test";

type ReviewState = "forReview" | "verified" | "returned";

const monitorUser = {
  id: 1,
  name: "Division Monitor",
  email: "monitor@cspams.local",
  role: "monitor",
  schoolId: null,
  schoolCode: null,
  schoolName: null,
};

const nowIso = "2026-06-14T06:39:00.000Z";

function jsonResponse(route: Route, payload: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

function buildRecord(state: ReviewState) {
  const indicatorStatus = state === "verified" ? "validated" : state === "returned" ? "returned" : "submitted";

  return {
    id: "record-1",
    schoolId: "401777",
    schoolCode: "401777",
    schoolName: "AMA Computer College-Santiago City",
    level: "High School",
    district: "Santiago City",
    address: "Santiago City",
    type: "private",
    studentCount: 0,
    teacherCount: 0,
    region: "Region II",
    status: "active",
    submittedBy: "School Head",
    lastUpdated: nowIso,
    deletedAt: null,
    schoolHeadAccount: null,
    indicatorLatest: {
      id: "sub-1",
      status: indicatorStatus,
      submittedAt: state === "forReview" ? nowIso : null,
      reviewedAt: state === "forReview" ? null : nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  };
}

function buildTargetsMetItem(code: string, name: string, actualDisplay: string) {
  return {
    id: `item-${code}`,
    metric: {
      id: code,
      code,
      name,
      category: "School Achievements",
      framework: "GROUP_B",
      dataType: "text",
      inputSchema: null,
      unit: null,
      sortOrder: 1,
      isAutoCalculated: false,
    },
    targetValue: null,
    actualValue: null,
    varianceValue: null,
    targetTypedValue: null,
    actualTypedValue: { values: { "2025-2026": actualDisplay } },
    targetDisplay: null,
    actualDisplay,
    complianceStatus: "recorded",
    remarks: null,
  };
}

function buildSubmission(state: ReviewState, reviewNotes: string | null = null) {
  const fileVisible = state !== "returned";
  const submittedScopeIds = state === "returned" ? [] : ["fm_qad_001"];
  const scopeReviews =
    state === "forReview"
      ? []
      : [
          {
            id: `review-${state}`,
            scopeId: "fm_qad_001",
            scopeType: "file",
            decision: state === "verified" ? "verified" : "returned",
            notes: state === "returned" ? reviewNotes : null,
            reviewedBy: {
              id: "1",
              name: "Division Monitor",
              email: "monitor@cspams.local",
            },
            reviewedAt: nowIso,
            updatedAt: nowIso,
          },
        ];

  return {
    id: "sub-1",
    formType: "indicator",
    status: "draft",
    statusLabel: "Draft",
    reportingPeriod: null,
    version: state === "forReview" ? 1 : 2,
    schoolId: "record-1",
    schoolType: "private",
    school: {
      id: "record-1",
      schoolCode: "401777",
      name: "AMA Computer College-Santiago City",
      type: "private",
    },
    academicYear: {
      id: "ay-2025",
      name: "2025-2026",
    },
    notes: null,
    reviewNotes: null,
    summary: {
      totalIndicators: 1,
      metIndicators: 0,
      belowTargetIndicators: 0,
      recordedIndicators: 1,
      complianceRatePercent: 0,
    },
    files: fileVisible
      ? {
          fm_qad_001: {
            type: "fm_qad_001",
            uploaded: true,
            path: "monitor-visible-test-file",
            originalFilename: "Profile-1.pdf",
            sizeBytes: 1024,
            uploadedAt: nowIso,
            viewUrl: "/api/submissions/sub-1/view/fm_qad_001",
            downloadUrl: "/api/submissions/sub-1/download/fm_qad_001",
          },
        }
      : {},
    completion: {
      hasImetaFormData: true,
      hasBmefFile: false,
      hasSmeaFile: false,
      isComplete: fileVisible,
      requiredFileTypes: ["fm_qad_001"],
      uploadedFileTypes: fileVisible ? ["fm_qad_001"] : [],
      missingFileTypes: fileVisible ? [] : ["fm_qad_001"],
    },
    presentation: {
      activeFileTypes: ["fm_qad_001"],
      activeReportFileTypes: ["fm_qad_001"],
      activeWorkspaceFileTypes: ["fm_qad_001"],
      secondaryHistoricalFileTypes: [],
    },
    scopeProgress: {
      requiredScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "fm_qad_001"],
      submittedScopeIds,
      pendingScopeIds: state === "returned" ? ["fm_qad_001"] : [],
      submittedRequiredScopeCount: submittedScopeIds.length,
      totalRequiredScopeCount: 3,
    },
    scopeReviews,
    indicators: [buildTargetsMetItem("IMETA_HEAD_NAME", "NAME OF SCHOOL HEAD", "Maria Santos")],
    items: [buildTargetsMetItem("IMETA_HEAD_NAME", "NAME OF SCHOOL HEAD", "Maria Santos")],
    createdBy: {
      id: "2",
      name: "School Head",
      email: "school-head@cspams.local",
    },
    submittedBy: {
      id: "2",
      name: "School Head",
      email: "school-head@cspams.local",
    },
    reviewedBy: null,
    submittedAt: null,
    reviewedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

async function installMonitorApiMocks(page: Page, stateRef: { value: ReviewState; reviewNotes: string | null }) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/auth/login") {
      return jsonResponse(route, {
        token: "e2e-monitor-token",
        tokenType: "Bearer",
        expiresAt: null,
        refreshAfter: null,
        user: monitorUser,
      });
    }

    if (path === "/api/auth/me") {
      return jsonResponse(route, { user: monitorUser });
    }

    if (path === "/api/dashboard/records") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "X-Sync-Record-Count": "1",
          "X-Synced-At": nowIso,
        },
        body: JSON.stringify({
          data: [buildRecord(stateRef.value)],
          meta: {
            syncedAt: nowIso,
            scope: "division",
            recordCount: 1,
            targetsMet: {
              generatedAt: nowIso,
              schoolsMonitored: 1,
              activeSchools: 1,
              pendingSchools: 0,
              inactiveSchools: 0,
              reportedStudents: 0,
              reportedTeachers: 0,
              trackedLearners: 0,
              enrolledLearners: 0,
              atRiskLearners: 0,
              dropoutLearners: 0,
              completerLearners: 0,
              transfereeLearners: 0,
              studentTeacherRatio: null,
              studentClassroomRatio: null,
              enrollmentRatePercent: 0,
              retentionRatePercent: 0,
              dropoutRatePercent: 0,
              completionRatePercent: 0,
              atRiskRatePercent: 0,
              transitionRatePercent: 0,
            },
            alerts: [],
          },
        }),
      });
    }

    if (path === "/api/indicators/submissions") {
      return jsonResponse(route, {
        data: [buildSubmission(stateRef.value, stateRef.reviewNotes)],
        meta: {
          current_page: 1,
          last_page: 1,
          per_page: 100,
          total: 1,
        },
      });
    }

    if (path === "/api/indicators/metrics") {
      return jsonResponse(route, { data: [] });
    }

    if (path === "/api/indicators/academic-years") {
      return jsonResponse(route, {
        data: [{ id: "ay-2025", name: "2025-2026", isCurrent: true }],
      });
    }

    if (path === "/api/dashboard/students" || path === "/api/dashboard/teachers") {
      return jsonResponse(route, {
        data: [],
        meta: {
          syncedAt: nowIso,
          scope: "division",
          recordCount: 0,
          currentPage: 1,
          lastPage: 1,
          perPage: 25,
          total: 0,
          from: null,
          to: null,
          hasMorePages: false,
        },
      });
    }

    if (path === "/api/notifications") {
      return jsonResponse(route, {
        data: [],
        meta: {
          currentPage: 1,
          lastPage: 1,
          perPage: 40,
          total: 0,
          unreadCount: 0,
        },
      });
    }

    if (path === "/api/indicators/submissions/sub-1/scope-review") {
      const payload = request.postDataJSON() as { decision?: string; notes?: string | null };
      stateRef.value = payload.decision === "verified" ? "verified" : "returned";
      stateRef.reviewNotes = typeof payload.notes === "string" && payload.notes.trim() ? payload.notes.trim() : null;
      return jsonResponse(route, { data: buildSubmission(stateRef.value, stateRef.reviewNotes) });
    }

    if (path === "/api/submissions/sub-1/view/fm_qad_001") {
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: "%PDF-1.4\n% CSPAMS monitor preview smoke\n%%EOF",
      });
    }

    if (path === "/api/submissions/sub-1/download/fm_qad_001") {
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: {
          "Content-Disposition": "attachment; filename=\"Profile-1.pdf\"",
        },
        body: "%PDF-1.4\n% CSPAMS monitor download smoke\n%%EOF",
      });
    }

    return jsonResponse(route, { data: [], meta: {} });
  });
}

async function signInAsMonitor(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Division Monitor" }).click();
  await page.getByLabel("Login ID").fill("monitor@cspams.local");
  await page.locator("#passcode").fill("monitor-passcode");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("heading", { name: "Queue List" })).toBeVisible();
}

async function openSchoolDetail(page: Page) {
  const queueRow = page.locator("tr", { hasText: "AMA Computer College-Santiago City" }).first();
  await expect(queueRow.getByText("For Review")).toBeVisible();
  await queueRow.getByRole("button", { name: "Review" }).click();

  const drawer = page.locator("aside", { hasText: "School Detail" });
  await expect(drawer.getByText("AMA Computer College-Santiago City")).toBeVisible();
  await expect(drawer.getByText("FM-QAD-001")).toBeVisible();
  return drawer;
}

test.describe("monitor review smoke flow", () => {
  test("previews a sent file from View and updates the visible queue after Verify", async ({ page }) => {
    const stateRef = { value: "forReview" as ReviewState, reviewNotes: null as string | null };
    await installMonitorApiMocks(page, stateRef);
    await signInAsMonitor(page);

    const drawer = await openSchoolDetail(page);
    const fileRow = drawer.locator("tr", { hasText: "FM-QAD-001" }).first();

    await expect(fileRow.getByRole("button", { name: "View" })).toBeVisible();
    await expect(fileRow.getByRole("button", { name: "Verify" })).toBeEnabled();
    await expect(fileRow.getByRole("button", { name: "Return" })).toBeEnabled();
    await expect(fileRow.getByRole("button", { name: "Download" })).toHaveCount(0);

    await fileRow.getByRole("button", { name: "View" }).click();
    await expect(page.getByText("FM-QAD-001 Report")).toBeVisible();
    await expect(page.getByRole("button", { name: "Download" })).toBeVisible();
    await page.getByLabel("Close file preview").click();

    await fileRow.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByText("No Missing, Returned, or For Review schools found.")).toBeVisible();
    await page.getByRole("button", { name: "Open Schools" }).click();
    const schoolCard = page.locator("article", { hasText: "AMA Computer College-Santiago City" }).first();
    await expect(schoolCard).toBeVisible();
    await expect(schoolCard.getByText(/For review/i)).toHaveCount(0);
    await expect(schoolCard.getByText(/Returned/i)).toHaveCount(0);
    await expect(schoolCard.getByText(/Incomplete/i)).toHaveCount(0);
  });

  test("returns a sent file with an optional note and disables returned review actions", async ({ page }) => {
    const stateRef = { value: "forReview" as ReviewState, reviewNotes: null as string | null };
    await installMonitorApiMocks(page, stateRef);
    await signInAsMonitor(page);

    const drawer = await openSchoolDetail(page);
    const fileRow = drawer.locator("tr", { hasText: "FM-QAD-001" }).first();

    await fileRow.getByRole("button", { name: "Return" }).click();
    const returnSubmitButton = page.getByRole("button", { name: "Return requirement", exact: true });
    await expect(page.getByText("A note is optional.")).toBeVisible();
    await expect(page.getByLabel("Return note")).toHaveCount(0);
    await expect(returnSubmitButton).toBeEnabled();

    await page.getByLabel("Include a note to the School Head").check();
    await expect(returnSubmitButton).toBeDisabled();
    await page.getByLabel("Return note").fill("Please upload the corrected FM-QAD file.");
    await expect(returnSubmitButton).toBeEnabled();
    await returnSubmitButton.click();

    await expect(fileRow.getByText("Returned")).toBeVisible();
    await expect(fileRow.getByText("Return note: Please upload the corrected FM-QAD file.")).toBeVisible();
    await expect(fileRow.getByRole("button", { name: "View" })).toBeDisabled();
    await expect(fileRow.getByRole("button", { name: "Verify" })).toBeDisabled();
    await expect(fileRow.getByRole("button", { name: "Return" })).toBeDisabled();
    await expect(fileRow.getByRole("button", { name: "Download" })).toHaveCount(0);

    const queueRow = page.locator("tr", { hasText: "AMA Computer College-Santiago City" }).first();
    await expect(queueRow.getByText("Returned for Correction")).toBeVisible();
  });
});
