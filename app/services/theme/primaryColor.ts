/**
 * Primary accent color options and validation. Pure helpers (no DOM/storage)
 * so they can be unit-tested and shared between the settings store, the
 * startup plugin, and the settings UI.
 */

export const PRIMARY_COLOR_STORAGE_KEY = "asset-didcomm.primary-color"

/** URL query parameter a host uses to brand the app, e.g. `?primaryColor=%23f7cb4d`. */
export const PRIMARY_COLOR_QUERY_KEY = "primaryColor"

export interface PrimaryColorOption {
  value: string
  name: string
  /** Optional companion accent applied to `--color-secondary` when the theme is active. */
  secondaryColor?: string
}

/** The four selectable accent colors, in display order. */
export const PRIMARY_COLOR_OPTIONS: readonly PrimaryColorOption[] = [
  { value: "#f7cb4d", name: "Gold" },
  { value: "#57a0c5", name: "Light blue" },
  { value: "#3B4F74", name: "Xcavate blue" },
  { value: "#00463F", name: "realXhub green", secondaryColor: "#78B36E" },
]

/** Allowlisted color values, in canonical casing. */
export const PRIMARY_COLORS: readonly string[] = PRIMARY_COLOR_OPTIONS.map(
  (option) => option.value
)

/** The default accent color (matches the CSS `--color-primary` default). */
export const DEFAULT_PRIMARY_COLOR = "#f7cb4d"

/**
 * Returns the canonical allowlisted color for `value` (case-insensitive), or
 * `undefined` if it is not one of the four selectable colors.
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

/**
 * Returns the secondary companion color for a (canonical or raw) primary
 * color value, or `undefined` when the theme has no secondary color.
 */
export function secondaryColorFor(value: unknown): string | undefined {
  const canonical = normalizePrimaryColor(value)
  if (canonical === undefined) {
    return undefined
  }

  return PRIMARY_COLOR_OPTIONS.find((option) => option.value === canonical)?.secondaryColor
}
