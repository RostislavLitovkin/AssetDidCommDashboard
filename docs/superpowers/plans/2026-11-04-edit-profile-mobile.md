# Edit Profile Mobile Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard Edit Profile page match the mobile app's cover, avatar picker, fields, and paired actions without changing profile behavior.

**Architecture:** Change only the existing Nuxt page's template, scoped CSS, and local image-preview state. Cover the new anatomy and preview behavior with a Playwright test that uses a mocked wallet and profile API.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, scoped CSS, lucide-vue-next, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-04-edit-profile-mobile-design.md`

## Global Constraints

- Preserve all profile loading, validation, signing, upload, and post-save navigation logic.
- Reuse the existing landscape and default avatar assets.
- Match mobile navy `#3B4F74`, 48px pill buttons, compact labels, rounded fields, and 160px cover treatment.
- Keep wallet address and X25519 controls below Nickname and Bio.
- Do not add dependencies or change global styles.

## Review Focus

- No selected image: show the saved profile picture or the default avatar; test this in Task 1, Step 1.
- Replacement selection: preview the local image immediately without changing the upload payload; test this in Task 1, Step 1.
- Narrow viewport: retain usable 48px actions and non-overflowing fields; test this in Task 1, Step 1.
- Existing profile: retain Nickname, Bio, wallet, and X25519 values; test this in Task 1, Step 1.
- Save states: retain the existing dynamic labels and validation behavior; verify through the existing unit suite in Task 2, Step 3.

---

### Task 1: Add the mobile-profile browser regression test

**Files:**
- Create: `tests/e2e/profile-edit.spec.ts`

**Interfaces:**
- Consumes: `rxm.walletSession` local storage and `https://profile-api.xcavate.io/api/profiles/{address}`.
- Produces: selectors for the cover, avatar, camera file input, profile fields, and paired actions used by the redesigned page.

- [ ] **Step 1: Write the failing browser test**

Create a test that installs a Solana wallet session, returns a profile containing a nickname, bio, picture, and valid X25519 key, then opens `/profile/edit` at a 390px viewport. Assert the mobile cover and centered navigation title are visible; Nickname and Bio retain their values; wallet and X25519 fields remain; Cancel links to `/profile`; the avatar initially uses the saved picture; selecting a small PNG through the camera input changes the avatar to a `blob:` preview; and both actions are at least 48px high with no horizontal document overflow.

- [ ] **Step 2: Run the test to verify it fails**

Start the dev server, then run `npx playwright test tests/e2e/profile-edit.spec.ts --project=chromium`.

Expected: FAIL because the mobile cover, overlapping avatar, camera control, and paired actions do not exist.

### Task 2: Port the mobile Edit Profile anatomy and styling

**Files:**
- Modify: `app/pages/profile/edit.vue`

**Interfaces:**
- Consumes: existing `profilePicture`, `selectedImage`, `selectImage(event: Event): void`, `saveProfile(): Promise<void>`, and `SubmitButton` state.
- Produces: a local object-URL preview and camera input trigger; no external interface changes.

- [ ] **Step 1: Implement local avatar preview lifecycle**

Add a preview URL derived from `selectedImage`, revoke replaced/unmounted object URLs, and make the camera button activate the existing image file input. Keep `selectedImage` as the upload source.

- [ ] **Step 2: Replace the page template and scoped styles**

Use the full-width landscape cover with a 45px translucent navy navigation overlay and centered title; add the 80px circular overlapping avatar and 25px camera badge; render Nickname and Bio with the mobile placeholders and compact rounded fields; retain wallet and X25519 fields in the same single column; finish with equal-width gray Cancel and navy Save pill actions. Add scoped full-bleed shell overrides matching the profile page and responsive rules for narrow screens.

- [ ] **Step 3: Run the browser test to verify it passes**

Run `npx playwright test tests/e2e/profile-edit.spec.ts --project=chromium`.

Expected: PASS, including avatar preview, retained values, action sizing, and overflow checks.

- [ ] **Step 4: Run project regression checks**

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.

Expected: all commands exit successfully. Pre-existing unrelated failures must be reported rather than fixed.

### Task 3: Verify the delivered screen

**Files:**
- Verify: `app/pages/profile/edit.vue`
- Verify: `tests/e2e/profile-edit.spec.ts`

**Interfaces:**
- Consumes: the running Nuxt page and mocked browser fixture from Task 1.
- Produces: visual confirmation at mobile and desktop widths.

- [ ] **Step 1: Inspect rendered screenshots**

Capture the mocked Edit Profile page at 390px and 1440px widths and compare its hierarchy and treatments with `ModifyUserProfilePage.xaml`.

Expected: cover/navigation, overlapping avatar, compact fields, retained advanced fields, and paired actions are visually coherent with no clipping or overflow.

- [ ] **Step 2: Check final workspace changes**

Run `git status --short` and remove only artifacts created by this verification that are not part of the requested change.

Expected: only the design/plan, edit page, and new profile browser test remain from this task; unrelated existing changes are untouched.
