import { expect, test, type Page } from "@playwright/test"

/**
 * `?primaryColor=` is how a host (native shell / embedding page) brands the
 * app. It has to take effect on whatever page the host links to — not only the
 * settings page — and stick from there on.
 *
 * Needs a running dev/preview server: `npm run dev`, then
 * `npx playwright test tests/e2e/primary-color-query.spec.ts`
 * (override the target with PLAYWRIGHT_BASE_URL when it is not on :3000).
 */

const GOLD = "#f7cb4d"
const DEFAULT_BLUE = "#57a0c5"
const BOOT_TIMEOUT = 60_000

// A dev server compiles each route on first visit, which can outlast the
// default 30s per-test budget.
test.describe.configure({ timeout: 120_000 })

function readPrimaryColor(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim()
  )
}

/** Resolves once the client plugins have run, so colour assertions are not racing the boot. */
async function waitForAppBoot(page: Page): Promise<void> {
  await expect
    .poll(
      () => page.evaluate(() => typeof (window as unknown as { assetDidComm?: unknown }).assetDidComm),
      { timeout: BOOT_TIMEOUT }
    )
    .toBe("object")
}

test("applies the query color on a page other than settings", async ({ page }) => {
  await page.goto(`/did?primaryColor=${encodeURIComponent(GOLD)}`)

  await expect.poll(() => readPrimaryColor(page), { timeout: BOOT_TIMEOUT }).toBe(GOLD)
})

test("keeps the query color after navigating and reloading without the parameter", async ({ page }) => {
  await page.goto(`/did?primaryColor=${encodeURIComponent(GOLD)}`)
  await expect.poll(() => readPrimaryColor(page), { timeout: BOOT_TIMEOUT }).toBe(GOLD)

  await page.goto("/messages/my-buckets")
  await waitForAppBoot(page)
  expect(await readPrimaryColor(page)).toBe(GOLD)
})

test("ignores an unknown query color without breaking app startup", async ({ page }) => {
  await page.goto("/did?primaryColor=red")

  // The host-injection bridge installs right after the settings store is
  // initialized, so it only appears if reading the parameter did not throw.
  await waitForAppBoot(page)
  expect(await readPrimaryColor(page)).toBe(DEFAULT_BLUE)
})
