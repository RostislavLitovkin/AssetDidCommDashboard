import { expect, test } from "@playwright/test"

test("US3 DID forms visible", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Register DID" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Update DID" })).toBeVisible()
})
