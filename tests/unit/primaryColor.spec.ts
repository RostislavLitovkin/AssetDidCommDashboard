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
