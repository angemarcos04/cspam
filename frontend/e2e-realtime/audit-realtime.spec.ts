import { expect, test, type Browser, type Page } from "@playwright/test";

const monitorLogin = "monitor-e2e@cspams.local";
const monitorPassword = "E2eMonitor@2026!";
const schoolHeadLogin = "401777";
const schoolHeadPassword = "E2eSchoolHead@2026!";
const verifySchoolName = "AMA Computer College-Santiago City";

async function bootstrapCsrfCookie(page: Page) {
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
}

async function signInAsMonitor(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await bootstrapCsrfCookie(page);
  await page.getByRole("button", { name: "Division Monitor" }).click();
  await page.getByLabel("Login ID").fill(monitorLogin);
  await page.locator("#passcode").fill(monitorPassword);
  const loginResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/auth/login"
  ), { timeout: 60_000 });
  await page.getByRole("button", { name: "Sign In" }).click();
  const response = await loginResponse;
  if (!response.ok()) {
    throw new Error(`Monitor E2E login returned HTTP ${response.status()}.`);
  }
  await expect(page.getByRole("heading", { name: "Review Inbox" })).toBeVisible({ timeout: 30_000 });
}

async function signInAsSchoolHead(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await bootstrapCsrfCookie(page);
  await page.getByRole("button", { name: "School Head" }).click();
  await page.getByLabel("Login ID").fill(schoolHeadLogin);
  await page.locator("#passcode").fill(schoolHeadPassword);
  const loginResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/auth/login"
  ), { timeout: 60_000 });
  await page.getByRole("button", { name: "Sign In" }).click();
  const response = await loginResponse;
  if (!response.ok()) {
    throw new Error(`School Head E2E login returned HTTP ${response.status()}.`);
  }
  await expect(page.getByRole("heading", { name: "School Head Dashboard" })).toBeVisible({ timeout: 30_000 });
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

async function openMonitorSchoolDetail(page: Page) {
  const queueRow = page.locator("tr", { hasText: verifySchoolName }).first();
  await expect(queueRow.getByText("For Review", { exact: true })).toBeVisible({ timeout: 90_000 });

  const detailResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.ok() && /^\/api\/indicators\/submissions\/\d+$/.test(url.pathname);
  });
  await queueRow.getByRole("button", { name: "Review" }).click();
  await detailResponse;

  const drawer = page.locator("aside", { hasText: "School Detail" });
  await expect(drawer.getByText(verifySchoolName)).toBeVisible();
  return drawer;
}

test("refreshes an open Monitor drawer after School Head sends a saved file scope", async ({ browser }: { browser: Browser }) => {
  const monitorContext = await browser.newContext();
  const schoolHeadContext = await browser.newContext();
  const monitorPage = await monitorContext.newPage();
  const schoolHeadPage = await schoolHeadContext.newPage();
  let schoolHeadClosed = false;

  try {
    await signInAsMonitor(monitorPage);
    await waitForRealtimeSubscription(monitorPage);
    const drawer = await openMonitorSchoolDetail(monitorPage);
    const savedFileRow = drawer.locator("tr", { hasText: "FM-QAD-002" }).first();
    const unsentSiblingRow = drawer.locator("tr", { hasText: "FM-QAD-003" }).first();

    await expect(savedFileRow.getByText("Missing", { exact: true })).toBeVisible();
    await expect(savedFileRow.getByRole("button", { name: "View" })).toBeDisabled();
    await expect(unsentSiblingRow.getByText("Missing", { exact: true })).toBeVisible();
    await expect(unsentSiblingRow.getByRole("button", { name: "View" })).toBeDisabled();

    // The drawer is now open and subscribed. Stop only existing page loads so
    // the Windows single-threaded PHP test server can hydrate the sender; the
    // Reverb connection remains open for the assertion below.
    await monitorPage.evaluate(() => window.stop());

    await signInAsSchoolHead(schoolHeadPage);
    const workspace = schoolHeadPage.locator("#imeta-compliance");
    const fileTab = workspace.locator('[data-category-id="fm_qad_002"]');
    await expect(fileTab).toBeVisible({ timeout: 90_000 });
    await fileTab.click();

    const sendButton = workspace.getByRole("button", { name: "Send", exact: true });
    await expect(sendButton).toBeEnabled({ timeout: 90_000 });

    const sendResponse = schoolHeadPage.waitForResponse((response) => (
      response.request().method() === "POST"
      && /\/api\/indicators\/submissions\/\d+\/submit-scopes$/.test(new URL(response.url()).pathname)
    ));
    await sendButton.click();
    expect((await sendResponse).ok()).toBe(true);

    // The isolated PHP server is single-threaded; close the sender after the
    // successful request so its post-send refresh does not delay the observer.
    await schoolHeadContext.close();
    schoolHeadClosed = true;

    await expect(savedFileRow.getByText("For Review", { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(savedFileRow.getByRole("button", { name: "View" })).toBeEnabled();
    await expect(savedFileRow.getByRole("button", { name: "Verify" })).toBeEnabled();
    await expect(savedFileRow.getByRole("button", { name: "Return" })).toBeEnabled();
    await expect(savedFileRow.getByRole("button", { name: "Download" })).toHaveCount(0);
    await expect(unsentSiblingRow.getByText("Missing", { exact: true })).toBeVisible();
    await expect(unsentSiblingRow.getByRole("button", { name: "View" })).toBeDisabled();
  } finally {
    if (!schoolHeadClosed) {
      await schoolHeadContext.close();
    }
    await monitorContext.close();
  }
});

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
