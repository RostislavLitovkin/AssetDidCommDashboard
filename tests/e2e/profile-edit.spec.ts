import { expect, test } from "@playwright/test"

const ADDRESS = "So1anaWalletAddress1111111111111111111111111"
const PROFILE_PICTURE = "https://images.example/profile.png"
const X25519_KEY = "kQ8fVz2Rm7pYtLc4XwEjN1oBsHdG9uAiTvZ0nKrMbCe"
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
)

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(({ address }) => {
    localStorage.setItem("rxm.setupTutorial.v1", "done")
    localStorage.setItem("rxm.walletSession", JSON.stringify({
      address,
      provider: "Phantom",
      kind: "solana"
    }))
    const publicKey = { toBase58: () => address }
    Object.assign(window, {
      phantom: {
        solana: {
          publicKey,
          connect: async () => ({ publicKey }),
          signMessage: async () => ({ signature: new Uint8Array(64).fill(9) })
        }
      }
    })
  }, { address: ADDRESS })
  await page.route(`https://profile-api.xcavate.io/api/profiles/${ADDRESS}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ss58Address: ADDRESS,
        nickname: "Mobile person",
        bio: "A biography loaded from the existing profile.",
        profilePicture: PROFILE_PICTURE,
        x25519Key: X25519_KEY
      })
    })
  })
})

test("renders the mobile profile editor with a local avatar preview", async ({ page }) => {
  await page.goto("/profile/edit")

  const cover = page.locator(".profile-edit-cover")
  const title = page.getByRole("heading", { name: "Edit profile" })
  await expect(cover).toBeVisible()
  await expect(title).toBeVisible()

  const coverBox = await cover.boundingBox()
  const titleBox = await title.boundingBox()
  expect(coverBox).not.toBeNull()
  expect(titleBox).not.toBeNull()
  expect(Math.abs((titleBox!.x + titleBox!.width / 2) - (coverBox!.x + coverBox!.width / 2))).toBeLessThanOrEqual(2)

  await expect(page.getByLabel("Nickname", { exact: true })).toHaveValue("Mobile person")
  await expect(page.getByLabel("Bio", { exact: true })).toHaveValue("A biography loaded from the existing profile.")
  await expect(page.getByLabel("Wallet address")).toHaveValue(ADDRESS)
  await expect(page.getByLabel("X25519 encryption public key")).toHaveValue(X25519_KEY)

  const avatar = page.locator(".profile-edit-avatar")
  await expect(avatar).toHaveAttribute("src", PROFILE_PICTURE)
  await page.getByLabel("Profile picture file").setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: PNG })
  await expect(avatar).toHaveAttribute("src", /^blob:/)

  const cancel = page.getByRole("link", { name: "Cancel", exact: true })
  await expect(cancel).toHaveAttribute("href", "/profile")
  const save = page.locator(".profile-save")
  expect((await cancel.boundingBox())!.height).toBeGreaterThanOrEqual(48)
  expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(48)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
