import { defineStore } from "pinia"

const SETTINGS_STORAGE_KEY = "asset-didcomm.ss58-prefix"
const DEFAULT_SS58_PREFIX = 42
const MAX_SS58_PREFIX = 16383

function normalizeSs58Prefix(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10)

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SS58_PREFIX) {
    return undefined
  }

  return parsed
}

function loadStoredSs58Prefix(): number {
  if (!import.meta.client) {
    return DEFAULT_SS58_PREFIX
  }

  const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
  const parsed = normalizeSs58Prefix(raw)
  return parsed ?? DEFAULT_SS58_PREFIX
}

export const useSettingsStore = defineStore("settings", {
  state: () => ({
    initialized: false,
    ss58Prefix: DEFAULT_SS58_PREFIX
  }),
  actions: {
    initialize(): void {
      if (this.initialized) {
        return
      }

      this.ss58Prefix = loadStoredSs58Prefix()
      this.initialized = true
    },
    setSs58Prefix(prefix: number): void {
      const nextPrefix = normalizeSs58Prefix(prefix)
      if (nextPrefix === undefined) {
        throw new Error(`SS58 prefix must be an integer between 0 and ${MAX_SS58_PREFIX}.`)
      }

      this.ss58Prefix = nextPrefix

      if (import.meta.client) {
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, String(nextPrefix))
      }
    }
  }
})
