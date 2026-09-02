import { describe, expect, it } from "vitest"
import {
  DEFAULT_PRIMARY_COLOR,
  PRIMARY_COLORS,
  PRIMARY_COLOR_OPTIONS,
  normalizePrimaryColor,
  resolvePrimaryColor,
  secondaryColorFor
} from "../../app/services/theme/primaryColor"

describe("PRIMARY_COLOR_OPTIONS", () => {
  it("lists the four selectable colors in display order", () => {
    expect(PRIMARY_COLOR_OPTIONS.map((option) => option.value)).toEqual([
      "#f7cb4d",
      "#57a0c5",
      "#3B4F74",
      "#00463F"
    ])
  })

  it("gives each color its display name", () => {
    expect(PRIMARY_COLOR_OPTIONS.map((option) => option.name)).toEqual([
      "Gold",
      "Light blue",
      "Xcavate blue",
      "realXhub green"
    ])
  })
})

describe("DEFAULT_PRIMARY_COLOR", () => {
  it("is the gold that matches the CSS token default", () => {
    expect(DEFAULT_PRIMARY_COLOR).toBe("#f7cb4d")
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

describe("secondaryColorFor", () => {
  it("returns the secondary color for realXhub green", () => {
    expect(secondaryColorFor("#00463F")).toBe("#78B36E")
  })

  it("matches case-insensitively like the other lookups", () => {
    expect(secondaryColorFor("#00463f")).toBe("#78B36E")
    expect(secondaryColorFor("  #00463F  ")).toBe("#78B36E")
  })

  it("returns undefined for colors without a secondary companion", () => {
    for (const color of ["#f7cb4d", "#57a0c5", "#3B4F74"]) {
      expect(secondaryColorFor(color)).toBeUndefined()
    }
  })

  it("returns undefined for missing or invalid input", () => {
    expect(secondaryColorFor(null)).toBeUndefined()
    expect(secondaryColorFor("")).toBeUndefined()
    expect(secondaryColorFor("#123456")).toBeUndefined()
  })
})
