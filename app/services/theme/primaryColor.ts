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
