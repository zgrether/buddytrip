import { test, expect } from "@playwright/test";

const MOCK_USER_ID = "user-001";

// ── Helpers ─────────────────────────────────────────────────────────────
// All auth E2E tests run against the login page with mocked Supabase
// responses to avoid hitting the real auth service.

function mockSupabaseAuth(page: import("@playwright/test").Page) {
  // Mock the Supabase auth endpoints to prevent real API calls
  return page.route("**/auth/v1/**", async (route) => {
    const url = route.request().url();

    if (url.includes("/token?grant_type=password")) {
      // signInWithPassword
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "mock-token",
          refresh_token: "mock-refresh",
          user: { id: MOCK_USER_ID, email: "test@example.com" },
        }),
      });
    } else if (url.includes("/signup")) {
      // signUp — simulate email confirmation required (no session)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: MOCK_USER_ID,
          email: "newuser@example.com",
          confirmation_sent_at: new Date().toISOString(),
          user_metadata: { name: "New User", nickname: "newbie" },
          identities: [],
        }),
      });
    } else if (url.includes("/otp")) {
      // signInWithOtp (magic link)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    } else if (url.includes("/recover")) {
      // resetPasswordForEmail
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    } else {
      await route.continue();
    }
  });
}

// ── Tests ───────────────────────────────────────────────────────────────

test.describe("Auth flows", () => {
  test("signup shows confirm-pending state when email confirmation required", async ({
    page,
  }) => {
    await mockSupabaseAuth(page);
    await page.goto("/login");

    // Switch to signup mode
    await page.getByRole("button", { name: "Sign up" }).click();

    // Fill signup form
    await page.getByLabel("Full Name").fill("Test User");
    await page.getByLabel("Email").fill("newuser@example.com");
    await page.getByLabel("Password").fill("TestPass123!");

    // Submit
    await page.getByRole("button", { name: "Create account" }).click();

    // Should show confirm-pending state, not redirect
    await expect(page.getByText("Check your email")).toBeVisible();
    await expect(
      page.getByText(/We sent a confirmation link to/)
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend email" })).toBeVisible();
    await expect(page.getByText("Back to sign in")).toBeVisible();
  });

  test("Google OAuth button renders on signin page", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByTestId("google-auth-btn")
    ).toBeVisible();
    await expect(
      page.getByText("Continue with Google")
    ).toBeVisible();
  });

  test("Google OAuth button renders on signup page", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(
      page.getByTestId("google-auth-btn-signup")
    ).toBeVisible();
  });

  test("magic link flow shows sent state", async ({ page }) => {
    await mockSupabaseAuth(page);
    await page.goto("/login");

    // Click magic link option
    await page.getByText("Sign in with a magic link").click();

    // Should show magic link form
    await expect(
      page.getByText(/Enter your email and we'll send you a link/)
    ).toBeVisible();

    // Fill email and submit
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByRole("button", { name: "Send magic link" }).click();

    // Should show sent state
    await expect(page.getByText("Check your email")).toBeVisible();
    await expect(
      page.getByText(/We sent a magic link to/)
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend" })).toBeVisible();
  });

  test("password reset shows request-sent state", async ({ page }) => {
    await mockSupabaseAuth(page);
    await page.goto("/login");

    // Click forgot password
    await page.getByText("Forgot password?").click();

    // Should show reset form
    await expect(page.getByText("Reset your password")).toBeVisible();

    // Fill email and submit
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByRole("button", { name: "Send reset link" }).click();

    // Should show confirmation
    await expect(
      page.getByText(/Reset link sent/)
    ).toBeVisible();
  });
});
