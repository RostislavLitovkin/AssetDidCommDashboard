import { defineStore } from "pinia"

const SETTINGS_STORAGE_KEY = "asset-didcomm.ss58-prefix"
const X25519_SECRET_JWK_STORAGE_KEY = "asset-didcomm.x25519-secret-jwk"
const DEFAULT_SS58_PREFIX = 42
const MAX_SS58_PREFIX = 16383

interface X25519SecretJwk {
  kty: "OKP"
  crv: "X25519"
  d: string
  x?: string
  kid?: string
  [key: string]: unknown
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeSs58Prefix(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10)

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SS58_PREFIX) {
    return undefined
  }

  return parsed
}

function normalizeX25519SecretJwk(value: unknown): X25519SecretJwk | undefined {
  if (!isObjectRecord(value)) {
    return undefined
  }

  const candidate = isObjectRecord(value.privateJwk) ? value.privateJwk : value
  const wrappedPublicJwk = isObjectRecord(value.publicJwk) ? value.publicJwk : undefined

  if (candidate.kty !== "OKP" || candidate.crv !== "X25519") {
    return undefined
  }

  if (typeof candidate.d !== "string" || !candidate.d.trim()) {
    return undefined
  }

  if (candidate.x !== undefined && typeof candidate.x !== "string") {
    return undefined
  }

  if (candidate.kid !== undefined && typeof candidate.kid !== "string") {
    return undefined
  }

  if (candidate.x === undefined && wrappedPublicJwk?.x !== undefined) {
    if (typeof wrappedPublicJwk.x !== "string") {
      return undefined
    }

    candidate.x = wrappedPublicJwk.x
  }

  return candidate as X25519SecretJwk
}

function loadStoredSs58Prefix(): number {
  if (!import.meta.client) {
    return DEFAULT_SS58_PREFIX
  }

  const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
  const parsed = normalizeSs58Prefix(raw)
  return parsed ?? DEFAULT_SS58_PREFIX
}

function loadStoredX25519SecretJwk(): X25519SecretJwk | null {
  if (!import.meta.client) {
    return null
  }

  const raw = window.localStorage.getItem(X25519_SECRET_JWK_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    return normalizeX25519SecretJwk(parsed) ?? null
  } catch {
    return null
  }
}

export const useSettingsStore = defineStore("settings", {
  state: () => ({
    initialized: false,
    ss58Prefix: DEFAULT_SS58_PREFIX,
    x25519SecretJwk: null as X25519SecretJwk | null
  }),
  actions: {
    initialize(): void {
      if (this.initialized) {
        return
      }

      this.ss58Prefix = loadStoredSs58Prefix()
      this.x25519SecretJwk = loadStoredX25519SecretJwk()
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
    },
    setX25519SecretJwk(value: unknown): void {
      const normalized = normalizeX25519SecretJwk(value)

      if (!normalized) {
        throw new Error("X25519 secret key must be a JSON JWK with kty=OKP, crv=X25519, and a non-empty private field d.")
      }

      this.x25519SecretJwk = normalized

      if (import.meta.client) {
        window.localStorage.setItem(X25519_SECRET_JWK_STORAGE_KEY, JSON.stringify(normalized))
      }
    },
    clearX25519SecretJwk(): void {
      this.x25519SecretJwk = null

      if (import.meta.client) {
        window.localStorage.removeItem(X25519_SECRET_JWK_STORAGE_KEY)
      }
    }
  }
})
