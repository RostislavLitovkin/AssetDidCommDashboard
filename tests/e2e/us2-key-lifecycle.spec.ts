import { expect, test } from "@playwright/test"

test("US2 key panel visible", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "X25519 Keys" })).toBeVisible()
})
