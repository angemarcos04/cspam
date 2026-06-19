import { expect, test, type Page } from "@playwright/test";
const monitorLogin = "monitor-e2e@cspams.local";
const monitorPassword = "E2eMonitor@2026!";

async function signInAsMonitor(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const response = await fetch("/sanctum/csrf-cookie", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`CSRF bootstrap failed with status ${response.status}.`);
    }
  });
  await expect
    .poll(() => page.evaluate(() => document.cookie.includes("XSRF-TOKEN")), {
      message: "XSRF cookie should be available before monitor login",
    })
    .toBe(true);
  await page.getByRole("button", { name: "Division Monitor" }).click();
  await page.getByLabel("Login ID").fill(monitorLogin);
  await page.locator("#passcode").fill(monitorPassword);
  const loginRequestPromise = page.waitForRequest((request) => request.url().includes("/api/auth/login"));
  const loginResponsePromise = page.waitForResponse((response) => response.url().includes("/api/auth/login"));
  await page.getByRole("button", { name: "Sign In" }).click();
  const loginRequest = await loginRequestPromise;
  expect(loginRequest.headers()["x-xsrf-token"]).toBeTruthy();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).not.toBe(419);
  await expect(page.getByRole("heading", { name: "Queue List" })).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
}

async function openSchoolDetail(page: Page, schoolName: string) {
  const queueRow = page.locator("tr", { hasText: schoolName }).first();
  await expect(queueRow.getByText("For Review")).toBeVisible();
  const detailResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.ok() && /^\/api\/indicators\/submissions\/\d+$/.test(url.pathname);
  }, { timeout: 45_000 });
  await queueRow.getByRole("button", { name: "Review" }).click();

  const drawer = page.locator("aside", { hasText: "School Detail" });
  await expect(drawer.getByText(schoolName)).toBeVisible();
  await expect(drawer.getByText("FM-QAD-001")).toBeVisible();
  await detailResponsePromise;
  await drawer.getByLabel("Monitor school detail academic year").selectOption("2025-2026");
  return drawer;
}

async function waitForSuccessfulScopeReview(page: Page) {
  const response = await page.waitForResponse((candidate) =>
    candidate.url().includes("/api/indicators/submissions/") &&
    candidate.url().includes("/scope-review"),
  );
  expect(response.ok(), `Scope review request should succeed, got HTTP ${response.status()}`).toBe(true);
  return response;
}

test.describe("live monitor review flow", () => {
  test("previews and verifies a real sent file scope", async ({ page }) => {
    await signInAsMonitor(page);

    const drawer = await openSchoolDetail(page, "AMA Computer College-Santiago City");
    const fileRow = drawer.locator("tr", { hasText: "FM-QAD-001" }).first();

    await expect(fileRow.getByText("For Review", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(fileRow.getByRole("button", { name: "View" })).toBeVisible();
    await expect(fileRow.getByRole("button", { name: "Verify" })).toBeEnabled();
    await expect(fileRow.getByRole("button", { name: "Return" })).toBeEnabled();
    await expect(fileRow.getByRole("button", { name: "Download" })).toHaveCount(0);

    await fileRow.getByRole("button", { name: "View" }).click();
    await expect(page.getByText("FM-QAD-001 Report")).toBeVisible();
    await expect(page.getByRole("button", { name: "Download" })).toBeVisible();
    await page.getByLabel("Close file preview").click();

    const verifyResponsePromise = waitForSuccessfulScopeReview(page);
    await fileRow.getByRole("button", { name: "Verify" }).click();
    await verifyResponsePromise;
    await expect(fileRow.locator("span").filter({ hasText: /^Verified$/ })).toBeVisible({ timeout: 30_000 });

    await expect(page.locator("tr", { hasText: "AMA Computer College-Santiago City" }).first().getByText("For Review")).toHaveCount(0);
    await expect(page.locator("tr", { hasText: "CSPAMS Return Flow School" }).first().getByText("For Review")).toBeVisible();
    await page.getByRole("button", { name: "Open Schools" }).click();
    const schoolCard = page.locator("article", { hasText: "AMA Computer College-Santiago City" }).first();
    await expect(schoolCard).toBeVisible();
    await expect(schoolCard.getByText(/For review/i)).toHaveCount(0);
    await expect(schoolCard.getByText(/Returned/i)).toHaveCount(0);
    await expect(schoolCard.getByText(/Incomplete/i)).toHaveCount(0);
  });

  test("returns a real sent file scope and hides review actions until resend", async ({ page }) => {
    await signInAsMonitor(page);

    const drawer = await openSchoolDetail(page, "CSPAMS Return Flow School");
    const fileRow = drawer.locator("tr", { hasText: "FM-QAD-001" }).first();

    await expect(fileRow.getByText("For Review", { exact: true })).toBeVisible({ timeout: 30_000 });
    await fileRow.getByRole("button", { name: "Return" }).click();
    const returnSubmitButton = page.getByRole("button", { name: "Return requirement", exact: true });
    await expect(page.getByText("A note is optional.")).toBeVisible();
    await expect(page.getByLabel("Return note")).toHaveCount(0);
    await expect(returnSubmitButton).toBeEnabled();

    await page.getByLabel("Include a note to the School Head").check();
    await expect(returnSubmitButton).toBeDisabled();
    await page.getByLabel("Return note").fill("Please upload the corrected FM-QAD file.");
    await expect(returnSubmitButton).toBeEnabled();
    const returnResponsePromise = waitForSuccessfulScopeReview(page);
    await returnSubmitButton.click();
    await returnResponsePromise;

    await expect(fileRow.locator("span").filter({ hasText: /^Returned$/ })).toBeVisible();
    await expect(fileRow.getByText("Return note: Please upload the corrected FM-QAD file.")).toBeVisible();
    await expect(fileRow.getByRole("button", { name: "View" })).toBeDisabled();
    await expect(fileRow.getByRole("button", { name: "Verify" })).toBeDisabled();
    await expect(fileRow.getByRole("button", { name: "Return" })).toBeDisabled();
    await expect(fileRow.getByRole("button", { name: "Download" })).toHaveCount(0);

    const queueRow = page.locator("tr", { hasText: "CSPAMS Return Flow School" }).first();
    await expect(queueRow.getByText("Returned for Correction")).toBeVisible();
  });
});
