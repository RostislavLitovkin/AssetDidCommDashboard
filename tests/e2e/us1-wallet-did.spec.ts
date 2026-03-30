import { expect, test } from "@playwright/test"

test("US1 dashboard shell renders", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Asset DIDComm Admin Dashboard" })).toBeVisible()
})
