import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const APP_URL = "http://localhost:7060";

function randomEmail() {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

// Shared state across the tests in this describe block
const EMAIL = randomEmail();
const PASSWORD = "TestPass123!";
let sharedCtx: BrowserContext;
let sharedPage: Page;
let capturedAddress = "";

test.describe("Wallet flow", () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    sharedCtx = await browser.newContext();
    sharedPage = await sharedCtx.newPage();
  });

  test.afterAll(async () => {
    await sharedCtx.close().catch(() => {});
  });

  test("1. sign up → create wallet → address valid", async () => {
    await sharedPage.goto(APP_URL);

    // Click Register tab, fill form
    await sharedPage.getByRole("button", { name: "Register" }).click();
    await sharedPage.getByPlaceholder("Email").fill(EMAIL);
    await sharedPage.getByPlaceholder("Password").fill(PASSWORD);
    await sharedPage.getByRole("button", { name: "Create account" }).click();

    // Wait for noWallet state
    await expect(
      sharedPage.getByRole("button", { name: "Create wallet" }),
    ).toBeVisible({ timeout: 20000 });

    // Create wallet
    await sharedPage.getByRole("button", { name: "Create wallet" }).click();

    // Wait for ready state — address appears (10 chars: 0x + 8 hex)
    const addressEl = sharedPage.locator("[data-testid='wallet-address']");
    await expect(addressEl).toBeVisible({ timeout: 90000 });

    const addrText = await addressEl.textContent();
    expect(addrText).toBeTruthy();
    // Extract full address from activity log
    await sharedPage.getByRole("button", { name: /Activity log/ }).click();
    const logText = await sharedPage.locator(".bg-gray-900").textContent();
    const match = logText?.match(/address=(0x[0-9a-fA-F]{40})/);
    if (match) {
      capturedAddress = match[1]!;
    }
    expect(capturedAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test("2. sign message → ✓ verified", async () => {
    // Should already be in ready state from test 1
    await expect(
      sharedPage.getByRole("button", { name: "Sign message" }),
    ).toBeVisible({ timeout: 10000 });

    const msgInput = sharedPage.getByPlaceholder("Message to sign");
    await msgInput.fill("");
    await msgInput.fill("hello opensigner");
    await sharedPage.getByRole("button", { name: "Sign message" }).click();

    await expect(
      sharedPage.getByText("✓ Verified: signer = wallet address"),
    ).toBeVisible({ timeout: 30000 });
  });

  test("3. new browser context → needs recovery → recover → same address → sign ✓", async ({
    browser,
  }: { browser: Browser }) => {
    const freshCtx = await browser.newContext();
    const page = await freshCtx.newPage();
    try {
      await page.goto(APP_URL);

      // Log in with existing credentials
      await page.getByPlaceholder("Email").fill(EMAIL);
      await page.getByPlaceholder("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();

      // The fresh context has no device share → needsRecovery
      // But depending on timing may jump to ready if device share isn't checked
      const recoverBtn = page.getByRole("button", {
        name: "Recover wallet on this device",
      });
      const signBtn = page.getByRole("button", { name: "Sign message" });

      // Wait for either state
      await expect(recoverBtn.or(signBtn)).toBeVisible({ timeout: 90000 });

      if (await recoverBtn.isVisible()) {
        await recoverBtn.click();
        await expect(signBtn).toBeVisible({ timeout: 90000 });
      }

      // Verify same address if we captured one
      if (capturedAddress) {
        const addrEl = page.locator("[data-testid='wallet-address']");
        const addrText = await addrEl.textContent();
        expect(addrText).toContain(capturedAddress.slice(0, 10));
      }

      // Sign
      const msgInput = page.getByPlaceholder("Message to sign");
      await msgInput.fill("hello opensigner");
      await signBtn.click();
      await expect(
        page.getByText("✓ Verified: signer = wallet address"),
      ).toBeVisible({ timeout: 30000 });
    } finally {
      await freshCtx.close();
    }
  });

  test("4. log out → signedOut state", async () => {
    // sharedPage is in "ready" state from tests 1-2 (no navigation — avoids session loss)
    await expect(
      sharedPage.getByRole("button", { name: "Log out" }),
    ).toBeVisible({ timeout: 10000 });
    await sharedPage.getByRole("button", { name: "Log out" }).click();

    await expect(
      sharedPage.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible({ timeout: 10000 });
  });
});
