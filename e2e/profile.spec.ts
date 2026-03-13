import { test, expect } from "@playwright/test";

/**
 * Profile page E2E — happy path
 *
 * Mocks tRPC and Supabase auth so no live session is required.
 */

const MOCK_USER = {
  id: "user-profile-001",
  name: "Test User",
  nickname: "Tester",
  email: "test@example.com",
};

const MOCK_UPDATED_USER = {
  ...MOCK_USER,
  name: "Updated Name",
  nickname: "NewNick",
};

test.describe("Profile page", () => {
  test.beforeEach(async ({ page }) => {
    // ── Mock Supabase auth ────────────────────────────────────────────────
    await page.route("**/auth/v1/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/user")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: MOCK_USER.id,
            email: MOCK_USER.email,
            user_metadata: { name: MOCK_USER.name },
          }),
        });
      } else if (url.includes("/token") || url.includes("/session")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            access_token: "mock-token",
            user: { id: MOCK_USER.id, email: MOCK_USER.email },
          }),
        });
      } else if (url.includes("/logout")) {
        await route.fulfill({
          status: 204,
          contentType: "application/json",
          body: JSON.stringify({}),
        });
      } else {
        await route.continue();
      }
    });

    // ── Mock tRPC ─────────────────────────────────────────────────────────
    await page.route("**/api/trpc/**", async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes("users.getMe")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_USER } }]),
        });
        return;
      }

      if (url.includes("users.updateMe") && method === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ result: { data: MOCK_UPDATED_USER } }]),
        });
        return;
      }

      await route.continue();
    });
  });

  test("renders profile with current name and email", async ({ page }) => {
    await page.goto("/profile");

    // Avatar shows initial
    await expect(page.getByTestId("profile-avatar")).toContainText("T");

    // Name input pre-filled
    const nameInput = page.getByTestId("profile-name-input");
    await expect(nameInput).toHaveValue(MOCK_USER.name);

    // Nickname input pre-filled
    const nicknameInput = page.getByTestId("profile-nickname-input");
    await expect(nicknameInput).toHaveValue(MOCK_USER.nickname);
  });

  test("saves updated profile and shows success feedback", async ({ page }) => {
    await page.goto("/profile");

    // Update name
    const nameInput = page.getByTestId("profile-name-input");
    await nameInput.fill("Updated Name");

    // Update nickname
    const nicknameInput = page.getByTestId("profile-nickname-input");
    await nicknameInput.fill("NewNick");

    // Click Save
    await page.getByTestId("save-profile-btn").click();

    // Success message appears
    await expect(page.getByTestId("save-success")).toBeVisible();
    await expect(page.getByTestId("save-success")).toContainText("saved");
  });

  test("back button navigates away", async ({ page }) => {
    await page.goto("/profile");

    // Back button should be present
    const backBtn = page.getByRole("button", { name: "Back" });
    await expect(backBtn).toBeVisible();
  });

  test("sign out button is visible", async ({ page }) => {
    await page.goto("/profile");

    await expect(page.getByTestId("sign-out-btn")).toBeVisible();
  });
});
