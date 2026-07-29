import { expect, test, type Page } from "@playwright/test"

/**
 * Pages built on `.chat-custom-page` scroll internally: `.info-content-scroll`
 * is the scroller, not the shell. That element therefore owns the page's
 * scrollbar, so it has to span the shell's content area edge to edge — a
 * scroller that stops short of the right edge parks its scrollbar in the middle
 * of the screen. The reading column stays capped and centred inside it.
 *
 * Needs a running dev/preview server: `npm run dev`, then
 * `npx playwright test tests/e2e/content-scroll-layout.spec.ts`
 * (override the target with PLAYWRIGHT_BASE_URL when it is not on :3000).
 */

const BOOT_TIMEOUT = 60_000
// Comfortably past the 1100px reading column, so a centred scroller is
// unmistakably offset from the shell's right edge.
const WIDE_VIEWPORT = { width: 1600, height: 900 }

// A dev server compiles each route on first visit, which can outlast the
// default 30s per-test budget.
test.describe.configure({ timeout: 120_000 })

interface ScrollerGeometry {
  scrollerLeft: number
  scrollerRight: number
  shellLeft: number
  shellRight: number
  columnWidth: number
  columnLeft: number
  columnRight: number
}

async function readScrollerGeometry(page: Page): Promise<ScrollerGeometry> {
  return await page.evaluate(() => {
    const scroller = document.querySelector(".info-content-scroll")
    const shell = document.querySelector(".app-shell-content")
    const column = scroller?.firstElementChild

    if (!scroller || !shell || !column) {
      throw new Error("Expected .app-shell-content, .info-content-scroll and a content column")
    }

    const scrollerBox = scroller.getBoundingClientRect()
    const shellBox = shell.getBoundingClientRect()
    const columnBox = column.getBoundingClientRect()

    return {
      scrollerLeft: scrollerBox.left,
      scrollerRight: scrollerBox.right,
      shellLeft: shellBox.left,
      shellRight: shellBox.right,
      columnWidth: columnBox.width,
      columnLeft: columnBox.left,
      columnRight: columnBox.right
    }
  })
}

async function openScrollingPage(page: Page, path: string): Promise<void> {
  await page.setViewportSize(WIDE_VIEWPORT)
  await page.goto(path)
  await expect(page.locator(".info-content-scroll")).toBeVisible({ timeout: BOOT_TIMEOUT })
}

for (const path of ["/messages/my-buckets", "/messages/bucket/1/info"]) {
  test(`keeps the scroller flush with the shell edges on ${path}`, async ({ page }) => {
    await openScrollingPage(page, path)

    const geometry = await readScrollerGeometry(page)

    expect(Math.abs(geometry.scrollerRight - geometry.shellRight)).toBeLessThanOrEqual(1)
    expect(Math.abs(geometry.scrollerLeft - geometry.shellLeft)).toBeLessThanOrEqual(1)
  })

  test(`keeps the reading column capped and centred on ${path}`, async ({ page }) => {
    await openScrollingPage(page, path)

    const geometry = await readScrollerGeometry(page)

    // .container's cap, minus the 4px gutter it puts inside that width.
    expect(geometry.columnWidth).toBeLessThanOrEqual(1092)
    expect(geometry.columnWidth).toBeGreaterThan(900)

    const leftGap = geometry.columnLeft - geometry.shellLeft
    const rightGap = geometry.shellRight - geometry.columnRight
    // The scroller's own scrollbar eats into the right gap, so the two sides are
    // allowed to differ by roughly a scrollbar's width but no more.
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(20)
  })
}
