import { expect, test, type Browser, type Page } from "@playwright/test";

const monitorLogin = "monitor-e2e@cspams.local";
const monitorPassword = "E2eMonitor@2026!";
const verifySchoolName = "AMA Computer College-Santiago City";

async function signInAsMonitor(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const response = await fetch("/sanctum/csrf-cookie", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`CSRF bootstrap failed with status ${response.status}.`);
    }
  });

  await expect.poll(() => page.evaluate(() => document.cookie.includes("XSRF-TOKEN"))).toBe(true);
  await page.getByRole("button", { name: "Division Monitor" }).click();
  await page.getByLabel("Login ID").fill(monitorLogin);
  await page.locator("#passcode").fill(monitorPassword);
  const recordsResponse = page.waitForResponse((response) => (
    response.ok() && new URL(response.url()).pathname === "/api/dashboard/records"
  ), { timeout: 60_000 });
  const submissionsResponse = page.waitForResponse((response) => (
    response.ok() && new URL(response.url()).pathname === "/api/indicators/submissions"
  ), { timeout: 60_000 });
  await page.getByRole("button", { name: "Sign In" }).click();
  await Promise.all([recordsResponse, submissionsResponse]);
  await expect(page.getByRole("heading", { name: "Queue List" })).toBeVisible({ timeout: 30_000 });
}

async function waitForRealtimeSubscription(page: Page) {
  await expect.poll(
    () => page.evaluate(() => window.echoSubscriptionReady === true),
    { timeout: 30_000, message: "Monitor Reverb subscription did not become ready." },
  ).toBe(true);
}

async function captureRealtimeEvents(page: Page) {
  await page.addInitScript(() => {
    const testWindow = window as Window & { __cspamsRealtimeEvents?: unknown[] };
    testWindow.__cspamsRealtimeEvents = [];
    window.addEventListener("cspams:update", (event) => {
      testWindow.__cspamsRealtimeEvents?.push((event as CustomEvent).detail);
    });
  });
}

function captureReverbFrameTypes(page: Page): () => string[] {
  const frameTypes: string[] = [];

  page.on("websocket", (socket) => {
    if (!socket.url().includes(":8086/")) {
      return;
    }

    socket.on("framereceived", (frame) => {
      if (typeof frame.payload !== "string") {
        return;
      }

      try {
        const payload = JSON.parse(frame.payload) as { event?: unknown };
        if (typeof payload.event === "string") {
          frameTypes.push(payload.event);
        }
      } catch {
        // Reverb protocol diagnostics deliberately retain only parsed event names.
      }
    });
  });

  return () => frameTypes;
}

async function receivedAuditLogEvent(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const testWindow = window as Window & { __cspamsRealtimeEvents?: Array<{ eventType?: unknown }> };
    return testWindow.__cspamsRealtimeEvents?.some((event) => event?.eventType === "audit.log_created") === true;
  });
}

async function verifySentFile(page: Page) {
  const queueRow = page.locator("tr", { hasText: verifySchoolName }).first();
  await expect(queueRow.getByText("For Review", { exact: true })).toBeVisible({ timeout: 30_000 });

  const detailResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.ok() && /^\/api\/indicators\/submissions\/\d+$/.test(url.pathname);
  });
  await queueRow.getByRole("button", { name: "Review" }).click();
  await detailResponse;

  const drawer = page.locator("aside", { hasText: "School Detail" });
  await expect(drawer.getByText(verifySchoolName)).toBeVisible();
  const fileRow = drawer.locator("tr", { hasText: "FM-QAD-001" }).first();
  const reviewResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes("/scope-review")
  ));
  await fileRow.getByRole("button", { name: "Verify" }).click();
  expect((await reviewResponse).ok()).toBe(true);
}

test("refreshes Monitor Audit Trail through real Reverb after a scope review", async ({ browser }: { browser: Browser }) => {
  const observerContext = await browser.newContext();
  const reviewerContext = await browser.newContext();
  const observerPage = await observerContext.newPage();
  const reviewerPage = await reviewerContext.newPage();
  let reviewerClosed = false;
  const receivedFrameTypes = captureReverbFrameTypes(observerPage);
  let auditRequests = 0;

  observerPage.on("request", (request) => {
    if (request.url().includes("/api/audit-logs?")) {
      auditRequests += 1;
    }
  });

  try {
    await captureRealtimeEvents(observerPage);
    await signInAsMonitor(observerPage);
    await waitForRealtimeSubscription(observerPage);
    await observerPage.getByRole("button", { name: "Open Audit Trail" }).click();
    await expect(observerPage.locator("#monitor-audit-trail")).toBeVisible();
    await expect(observerPage.getByText("Verified requirement", { exact: true })).toHaveCount(0);
    auditRequests = 0;

    await signInAsMonitor(reviewerPage);
    await verifySentFile(reviewerPage);
    // The test harness uses PHP's single-threaded development server. Closing
    // the reviewer avoids its post-review refresh work starving the observer's
    // independent audit refresh request; production PHP workers are concurrent.
    await reviewerContext.close();
    reviewerClosed = true;

    // Assert the actual browser event first so delivery failures are not
    // misreported as an Audit Trail rendering failure.
    const didReceiveAuditEvent = await expect.poll(() => receivedAuditLogEvent(observerPage), {
      timeout: 30_000,
    }).toBe(true).then(() => true).catch(() => false);
    if (!didReceiveAuditEvent) {
      throw new Error(`The observer did not receive audit.log_created. Reverb event types received: ${JSON.stringify(receivedFrameTypes())}`);
    }

    // No manual refresh: a queued audit broadcast must trigger this second audit API request.
    await expect(observerPage.getByText("Verified requirement", { exact: true })).toBeVisible({ timeout: 90_000 });
    expect(auditRequests).toBeGreaterThan(0);
  } finally {
    if (!reviewerClosed) {
      await reviewerContext.close();
    }
    await observerContext.close();
  }
});
