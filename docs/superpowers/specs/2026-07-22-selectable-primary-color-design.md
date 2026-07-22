# Selectable Primary Color — Design

**Date:** 2026-07-22
**Status:** Approved

## Goal

Let the user choose the app's primary accent color on the Settings page
(`/settings`) from three fixed options:

| Swatch | Hex | Name |
| ------ | --- | ---- |
| LightBlue (current default) | `#57a0c5` | Light blue |
| XcavateBlue | `#3B4F74` | Xcavate blue |
| Gold | `#f7cb4d` | Gold |

Selecting a color re-themes the whole app immediately and persists the choice
across sessions.

## Background

- `--color-primary` is defined once in `app/assets/styles/tokens.css`
  (`#57a0c5`) and consumed app-wide via `var(--color-primary)` and
  `color-mix(...)` derivations in `app/assets/styles/globals.css` and many
  components. Overriding that single custom property on `:root` at runtime
  re-themes everything, including the derived hover/focus tints.
- Settings are managed by a Pinia store (`app/stores/settings.ts`) using a
  consistent per-setting pattern: a storage key, a validating loader, a state
  field, and a setter that persists to `localStorage`.
- The Settings page (`app/pages/settings.vue`) is organized as `card` sections.
- The pre-hydration splash (`app/splash/splash.css`, `app/splash/splash.js`)
  hardcodes the blue and runs before app JS — it is a separate concern.

## Decisions

- **Apply timing:** Live on click. Clicking a swatch immediately applies and
  persists; there is no Save button for this setting.
- **Splash:** The pre-hydration splash keeps its hardcoded blue. Not threaded
  through to the chosen color (out of scope).

## Components

### 1. Settings store (`app/stores/settings.ts`)

Add, following the existing per-setting pattern:

- Constants:
  - `PRIMARY_COLOR_STORAGE_KEY = "asset-didcomm.primary-color"`
  - `PRIMARY_COLORS = ["#57a0c5", "#3B4F74", "#f7cb4d"]` (the allowlist)
  - `DEFAULT_PRIMARY_COLOR = "#57a0c5"`
- `normalizePrimaryColor(value): string | undefined` — returns the value only
  if it is a case-insensitive match of an allowlisted color (normalized to the
  canonical casing used in the allowlist); otherwise `undefined`.
- `loadStoredPrimaryColor(): string` — reads storage, runs it through
  `normalizePrimaryColor`, falls back to `DEFAULT_PRIMARY_COLOR` for
  missing/invalid values. Returns default on the server (`!import.meta.client`).
- State field `primaryColor: DEFAULT_PRIMARY_COLOR`.
- `applyPrimaryColor(value)` — client-only; sets
  `document.documentElement.style.setProperty("--color-primary", value)`.
- `setPrimaryColor(value)` — normalizes; if invalid, throws an `Error`
  (mirrors `setSs58Prefix`). On success: updates state, persists to
  `localStorage`, and calls `applyPrimaryColor`.
- `initialize()` — additionally loads the stored color into state **and** calls
  `applyPrimaryColor` so the persisted choice takes effect.

### 2. Startup application (`app/plugins/primary-color.client.ts`)

A Nuxt client plugin that resolves the settings store (via
`useSettingsStore()`) and calls `settings.initialize()`. This guarantees the
persisted color is applied on every route, not only after the user visits
Settings. `initialize()` is idempotent (guards on `this.initialized`), so
calling it from both the plugin and the Settings page is safe.

_Alternative considered:_ apply in a root layout/`app.vue` watcher — rejected
because a plugin runs earlier in startup and keeps the theming concern out of
the layout markup. Because the CSS default already equals the Blue option, only
Navy/Gold cause an override, so any flash is negligible.

### 3. Settings UI (`app/pages/settings.vue`)

Add a new `card stack` section titled **Appearance**:

- A row of three swatch buttons, each rendering a color chip plus its name.
- The active color's button is visually highlighted (ring + checkmark) and
  carries `aria-pressed="true"`; others `aria-pressed="false"`.
- Each button has an accessible label (e.g. `aria-label="Blue"`).
- Clicking a button calls `settings.setPrimaryColor(color)` — the change is
  immediate; no Save button.
- A short helper line describes the setting (matching the muted-caption style
  used by the other sections).

The selected color is read reactively from `settings.primaryColor`.

## Data Flow

1. App boots → `primary-color.client.ts` plugin → `settings.initialize()` →
   `loadStoredPrimaryColor()` → `applyPrimaryColor()` sets `--color-primary` on
   `:root`.
2. User opens `/settings`, clicks a swatch → `setPrimaryColor(color)` →
   validate → set state → persist to `localStorage` → `applyPrimaryColor()`
   updates `:root` live → all `var(--color-primary)` consumers re-render.
3. Next session → step 1 re-applies the saved color.

## Error Handling

- `setPrimaryColor` throws on a non-allowlisted value; the UI only ever passes
  allowlisted values, so this is a defensive guard (consistent with the store's
  existing validators).
- `loadStoredPrimaryColor` never throws: invalid/missing storage → default.
- All DOM writes are guarded by `import.meta.client`.

## Testing

Extend the unit tests (alongside `tests/unit/blockTime.spec.ts`) to cover the
store's color logic:

- `setPrimaryColor` accepts each allowlisted color: updates state and persists
  to `localStorage`.
- `setPrimaryColor` throws for a non-allowlisted value and leaves state
  unchanged.
- `loadStoredPrimaryColor` returns the default when storage is empty or holds
  an invalid value, and returns the stored color when valid.

DOM application (`applyPrimaryColor` / `setProperty`) is verified in whatever
way the existing test environment supports; if `document` is unavailable in the
unit environment, the validation/persistence behavior is the testable surface
and the DOM write is exercised manually in the running app.

## Out of Scope

- Theming the pre-hydration splash.
- Dark-mode variants (the app currently has no dark theme despite
  `@nuxtjs/color-mode` being installed).
- Arbitrary/custom color input — only the three fixed options.
