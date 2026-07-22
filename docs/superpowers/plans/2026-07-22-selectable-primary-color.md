# Selectable Primary Color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick the app's primary accent color on `/settings` from three fixed options; the choice re-themes the whole app immediately and persists across sessions.

**Architecture:** A pure helper module (`app/services/theme/primaryColor.ts`) owns the allowlist, canonical-casing normalizer, and default fallback — mirroring the existing `app/services/chain/blockTime.ts` pattern so the logic is unit-testable in the `node` vitest environment. The Pinia settings store consumes those helpers to load/persist the choice and to write the `--color-primary` CSS custom property on `:root` (which every `var(--color-primary)` / `color-mix(...)` consumer already reads). A client plugin applies the saved color on startup for every route; the Settings page renders three swatch buttons that call the store live.

**Tech Stack:** Nuxt 4 (SPA, `ssr: false`), Vue 3 `<script setup>`, Pinia, Vitest (node env), `lucide-vue-next` icons, CSS custom properties.

## Global Constraints

- The three selectable colors, in display order: `#57a0c5` "Light blue" (default), `#3B4F74` "Xcavate blue", `#f7cb4d` "Gold". Copy these hex values and names verbatim.
- `DEFAULT_PRIMARY_COLOR` is `#57a0c5` and must equal the CSS `--color-primary` default in `app/assets/styles/tokens.css`.
- localStorage key: `asset-didcomm.primary-color` (follows the `asset-didcomm.*` convention in `app/stores/settings.ts`).
- The store's existing per-setting pattern (storage key + validating loader + state field + persisting setter, all DOM/storage writes guarded by `import.meta.client`) must be followed.
- Applying a color means: `document.documentElement.style.setProperty("--color-primary", value)`.
- No Save button for this setting — selection applies live on click.
- Out of scope: theming the pre-hydration splash, dark-mode variants, arbitrary/custom colors.
- Indentation: 2 spaces. Strings: double quotes, no semicolons (match surrounding files).

---

### Task 1: Pure primary-color helper module

**Files:**
- Create: `app/services/theme/primaryColor.ts`
- Test: `tests/unit/primaryColor.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PRIMARY_COLOR_STORAGE_KEY: string`
  - `interface PrimaryColorOption { value: string; name: string }`
  - `PRIMARY_COLOR_OPTIONS: readonly PrimaryColorOption[]`
  - `PRIMARY_COLORS: readonly string[]`
  - `DEFAULT_PRIMARY_COLOR: string`
  - `normalizePrimaryColor(value: unknown): string | undefined` — canonical allowlisted color (case-insensitive) or `undefined`
  - `resolvePrimaryColor(value: unknown): string` — `normalizePrimaryColor(value) ?? DEFAULT_PRIMARY_COLOR`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/primaryColor.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  DEFAULT_PRIMARY_COLOR,
  PRIMARY_COLORS,
  PRIMARY_COLOR_OPTIONS,
  normalizePrimaryColor,
  resolvePrimaryColor
} from "../../app/services/theme/primaryColor"

describe("PRIMARY_COLOR_OPTIONS", () => {
  it("lists the three selectable colors in display order", () => {
    expect(PRIMARY_COLOR_OPTIONS.map((option) => option.value)).toEqual([
      "#57a0c5",
      "#3B4F74",
      "#f7cb4d"
    ])
  })

  it("gives each color its display name", () => {
    expect(PRIMARY_COLOR_OPTIONS.map((option) => option.name)).toEqual([
      "Light blue",
      "Xcavate blue",
      "Gold"
    ])
  })
})

describe("DEFAULT_PRIMARY_COLOR", () => {
  it("is the light blue that matches the CSS token default", () => {
    expect(DEFAULT_PRIMARY_COLOR).toBe("#57a0c5")
    expect(PRIMARY_COLORS).toContain(DEFAULT_PRIMARY_COLOR)
  })
})

describe("normalizePrimaryColor", () => {
  it("returns the canonical value for each allowlisted color", () => {
    for (const color of PRIMARY_COLORS) {
      expect(normalizePrimaryColor(color)).toBe(color)
    }
  })

  it("matches case-insensitively and returns canonical casing", () => {
    expect(normalizePrimaryColor("#3b4f74")).toBe("#3B4F74")
    expect(normalizePrimaryColor("#F7CB4D")).toBe("#f7cb4d")
    expect(normalizePrimaryColor("  #57A0C5  ")).toBe("#57a0c5")
  })

  it("returns undefined for non-allowlisted or non-string values", () => {
    expect(normalizePrimaryColor("#000000")).toBeUndefined()
    expect(normalizePrimaryColor("red")).toBeUndefined()
    expect(normalizePrimaryColor("")).toBeUndefined()
    expect(normalizePrimaryColor(null)).toBeUndefined()
    expect(normalizePrimaryColor(undefined)).toBeUndefined()
    expect(normalizePrimaryColor(0x57a0c5)).toBeUndefined()
  })
})

describe("resolvePrimaryColor", () => {
  it("returns the canonical color for valid input", () => {
    expect(resolvePrimaryColor("#3b4f74")).toBe("#3B4F74")
  })

  it("falls back to the default for missing or invalid input", () => {
    expect(resolvePrimaryColor(null)).toBe(DEFAULT_PRIMARY_COLOR)
    expect(resolvePrimaryColor("")).toBe(DEFAULT_PRIMARY_COLOR)
    expect(resolvePrimaryColor("#123456")).toBe(DEFAULT_PRIMARY_COLOR)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- primaryColor`
Expected: FAIL — cannot resolve `../../app/services/theme/primaryColor` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `app/services/theme/primaryColor.ts`:

```ts
/**
 * Primary accent color options and validation. Pure helpers (no DOM/storage)
 * so they can be unit-tested and shared between the settings store, the
 * startup plugin, and the settings UI.
 */

export const PRIMARY_COLOR_STORAGE_KEY = "asset-didcomm.primary-color"

export interface PrimaryColorOption {
  value: string
  name: string
}

/** The three selectable accent colors, in display order. */
export const PRIMARY_COLOR_OPTIONS: readonly PrimaryColorOption[] = [
  { value: "#57a0c5", name: "Light blue" },
  { value: "#3B4F74", name: "Xcavate blue" },
  { value: "#f7cb4d", name: "Gold" }
]

/** Allowlisted color values, in canonical casing. */
export const PRIMARY_COLORS: readonly string[] = PRIMARY_COLOR_OPTIONS.map(
  (option) => option.value
)

/** The default accent color (matches the CSS `--color-primary` default). */
export const DEFAULT_PRIMARY_COLOR = "#57a0c5"

/**
 * Returns the canonical allowlisted color for `value` (case-insensitive), or
 * `undefined` if it is not one of the three selectable colors.
 */
export function normalizePrimaryColor(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const lower = value.trim().toLowerCase()
  return PRIMARY_COLORS.find((color) => color.toLowerCase() === lower)
}

/**
 * Returns the canonical allowlisted color for `value`, falling back to
 * `DEFAULT_PRIMARY_COLOR` for missing/invalid input.
 */
export function resolvePrimaryColor(value: unknown): string {
  return normalizePrimaryColor(value) ?? DEFAULT_PRIMARY_COLOR
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- primaryColor`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add app/services/theme/primaryColor.ts tests/unit/primaryColor.spec.ts
git commit -m "feat: add primary color options and validation helpers"
```

---

### Task 2: Settings store integration

**Files:**
- Modify: `app/stores/settings.ts`

**Interfaces:**
- Consumes (from Task 1): `DEFAULT_PRIMARY_COLOR`, `PRIMARY_COLORS`, `PRIMARY_COLOR_STORAGE_KEY`, `normalizePrimaryColor`, `resolvePrimaryColor`.
- Produces (used by Tasks 3 & 4):
  - store state field `primaryColor: string`
  - store action `setPrimaryColor(value: string): void` — validates, updates state, persists, applies to `:root`; throws `Error` on a non-allowlisted value
  - `initialize()` additionally loads and applies the saved color

There is no Pinia store test in this repo and the vitest environment is `node` (no `document`/`localStorage`, `import.meta.client` is falsy), so this task's logic is covered by Task 1's pure-helper tests plus `npm run typecheck`. The store code here is thin delegation to those tested helpers.

- [ ] **Step 1: Add the import**

In `app/stores/settings.ts`, immediately after the existing first line `import { defineStore } from "pinia"`, add:

```ts
import {
  DEFAULT_PRIMARY_COLOR,
  PRIMARY_COLORS,
  PRIMARY_COLOR_STORAGE_KEY,
  normalizePrimaryColor,
  resolvePrimaryColor
} from "../services/theme/primaryColor"
```

- [ ] **Step 2: Add the loader and apply helpers**

In `app/stores/settings.ts`, directly after the existing `loadStoredNotificationsEnabled()` function (the last module-level `loadStored*` helper, which ends with its closing `}` just before `export const useSettingsStore`), add:

```ts
function loadStoredPrimaryColor(): string {
  if (!import.meta.client) {
    return DEFAULT_PRIMARY_COLOR
  }

  return resolvePrimaryColor(window.localStorage.getItem(PRIMARY_COLOR_STORAGE_KEY))
}

function applyPrimaryColor(value: string): void {
  if (!import.meta.client) {
    return
  }

  document.documentElement.style.setProperty("--color-primary", value)
}
```

- [ ] **Step 3: Add the state field**

In the `state: () => ({ ... })` object, add a `primaryColor` field after `notificationsEnabled: false`. The block becomes:

```ts
  state: () => ({
    initialized: false,
    ss58Prefix: DEFAULT_SS58_PREFIX,
    x25519SecretJwk: null as X25519SecretJwk | null,
    showMessageDebug: false,
    notificationsEnabled: false,
    primaryColor: DEFAULT_PRIMARY_COLOR
  }),
```

- [ ] **Step 4: Load and apply on initialize**

In the `initialize()` action, after the existing line `this.notificationsEnabled = loadStoredNotificationsEnabled()` and before `this.initialized = true`, add:

```ts
      this.primaryColor = loadStoredPrimaryColor()
      applyPrimaryColor(this.primaryColor)
```

- [ ] **Step 5: Add the setPrimaryColor action**

In the `actions: { ... }` object, after the existing `setNotificationsEnabled(value: boolean)` action (add a comma after its closing `}`), add:

```ts
    setPrimaryColor(value: string): void {
      const nextColor = normalizePrimaryColor(value)
      if (nextColor === undefined) {
        throw new Error(`Primary color must be one of: ${PRIMARY_COLORS.join(", ")}.`)
      }

      this.primaryColor = nextColor
      applyPrimaryColor(nextColor)

      if (import.meta.client) {
        window.localStorage.setItem(PRIMARY_COLOR_STORAGE_KEY, nextColor)
      }
    }
```

- [ ] **Step 6: Verify types and the existing unit tests**

Run: `npm run typecheck`
Expected: PASS — no type errors.

Run: `npm run test:unit`
Expected: PASS — `blockTime` and `primaryColor` suites green (no regressions).

- [ ] **Step 7: Commit**

```bash
git add app/stores/settings.ts
git commit -m "feat: persist and apply selectable primary color in settings store"
```

---

### Task 3: Apply the saved color on startup

**Files:**
- Create: `app/plugins/primary-color.client.ts`

**Interfaces:**
- Consumes: `useSettingsStore` (Task 2's `initialize()` applies the saved color).
- Produces: nothing (side effect only — runs on client startup).

This is a Nuxt runtime plugin (no unit-test harness in this repo); verified by `npm run typecheck` and manual run in Task 4's verification.

- [ ] **Step 1: Create the plugin**

Create `app/plugins/primary-color.client.ts`:

```ts
import { useSettingsStore } from "../stores/settings"

/**
 * Applies the user's saved primary accent color on startup, across every
 * route. Initializing the settings store reads the persisted choice and writes
 * it to the `--color-primary` CSS custom property on :root. `initialize()` is
 * idempotent, so this is safe to call alongside the settings page and the other
 * plugins that also initialize the store.
 */
export default defineNuxtPlugin(() => {
  const settings = useSettingsStore()
  settings.initialize()
})
```

- [ ] **Step 2: Verify types**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/plugins/primary-color.client.ts
git commit -m "feat: apply saved primary color on app startup"
```

---

### Task 4: Appearance section on the Settings page

**Files:**
- Modify: `app/pages/settings.vue`

**Interfaces:**
- Consumes: `PRIMARY_COLOR_OPTIONS` (Task 1), `settings.primaryColor` + `settings.setPrimaryColor` (Task 2).
- Produces: user-facing UI (no exported interface).

No component test harness exists in this repo (vitest is `node`-env, no `@vue/test-utils`/`@nuxt/test-utils`); verified by `npm run typecheck`, `npm run lint`, and a manual run.

- [ ] **Step 1: Add imports to the script block**

In `app/pages/settings.vue`, the `<script setup lang="ts">` block currently starts:

```ts
import { computed, ref } from "vue"
import { useSettingsStore } from "../stores/settings"
```

Add two imports directly below them:

```ts
import { Check } from "lucide-vue-next"
import { PRIMARY_COLOR_OPTIONS } from "../services/theme/primaryColor"
```

- [ ] **Step 2: Add the click handler**

In the same script block, after the existing `saveSettings()` function's closing `}` (the last statement before `</script>`), add:

```ts
function selectPrimaryColor(color: string): void {
  settings.setPrimaryColor(color)
}
```

- [ ] **Step 3: Add the Appearance section to the template**

In the `<template>`, insert this new `<section>` directly after the closing `</section>` of the "Chain Configuration" card (the one containing the SS58 Prefix input) and before the "Notifications" `<section>`:

```html
    <section class="card stack" style="gap: 10px">
      <h4 style="margin: 0; font-size: 16px;">Appearance</h4>
      <span style="font-weight: 600; font-size: 14px;">Primary color</span>
      <div class="swatch-row">
        <button
          v-for="option in PRIMARY_COLOR_OPTIONS"
          :key="option.value"
          type="button"
          class="swatch"
          :class="{ 'swatch-active': option.value === settings.primaryColor }"
          :style="`--swatch-color: ${option.value}`"
          :aria-label="option.name"
          :aria-pressed="option.value === settings.primaryColor"
          @click="selectPrimaryColor(option.value)"
        >
          <span class="swatch-chip" aria-hidden="true">
            <Check v-if="option.value === settings.primaryColor" class="swatch-check" :size="14" />
          </span>
          <span>{{ option.name }}</span>
        </button>
      </div>
      <span class="muted" style="font-size: 13px;">Sets the app's accent color. Applied immediately.</span>
    </section>
```

- [ ] **Step 4: Add scoped styles**

In the `<style scoped>` block, add these rules (place after the existing `.toggle-row input { ... }` rule, before the `@media` query):

```css
.swatch-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.swatch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--surface-card);
  color: var(--text-primary);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}

.swatch:hover,
.swatch:focus-visible {
  border-color: var(--swatch-color);
}

.swatch-active {
  border-color: var(--swatch-color);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--swatch-color) 30%, transparent);
}

.swatch-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--swatch-color);
}

.swatch-check {
  color: var(--color-white);
}
```

- [ ] **Step 5: Verify types and lint**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run lint`
Expected: PASS (no new errors).

- [ ] **Step 6: Manual verification in the running app**

Run: `npm run dev`, open `http://localhost:3000/settings`.
Confirm:
1. The Appearance section shows three swatches: Light blue, Xcavate blue, Gold.
2. The currently active swatch shows a white check in its chip and a highlighted ring.
3. Clicking "Xcavate blue" immediately re-themes accents across the app (buttons, focus rings, links) to `#3B4F74`; clicking "Gold" switches to `#f7cb4d`.
4. Reloading the page keeps the last-selected color (persisted), and navigating to other routes shows the chosen accent everywhere.
5. `localStorage` has key `asset-didcomm.primary-color` set to the chosen hex.

- [ ] **Step 7: Commit**

```bash
git add app/pages/settings.vue
git commit -m "feat: add primary color picker to settings page"
```

---

## Self-Review Notes

- **Spec coverage:** Store constants/state/loader/apply/setter/initialize → Task 2; startup plugin → Task 3; Appearance UI with highlighted active swatch + `aria-pressed` + accessible labels → Task 4; validation/allowlist/default-fallback testing → Task 1 (the spec's "test setPrimaryColor accept/reject and loadStoredPrimaryColor fallback" is realized as tests of the pure `normalizePrimaryColor`/`resolvePrimaryColor` helpers the store delegates to, since the repo's vitest runs in a `node` env without a store harness). Out-of-scope items (splash, dark mode, custom colors) intentionally untouched.
- **Type consistency:** `setPrimaryColor(value: string)`, `normalizePrimaryColor(value: unknown): string | undefined`, `resolvePrimaryColor(value: unknown): string`, and `primaryColor: string` are used consistently across Tasks 1, 2, and 4.
- **No placeholders:** every code and test step contains complete content.
```