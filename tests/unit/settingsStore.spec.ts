import { beforeEach, describe, expect, it } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import { useSettingsStore } from "../../app/stores/settings"
import { DEFAULT_PRIMARY_COLOR, REALXHUB_PRIMARY_COLOR } from "../../app/services/theme/primaryColor"

// The DOM/localStorage halves of the color actions are guarded by
// import.meta.client and are dead under vitest's node environment (same
// situation as documented in sessionStore.spec.ts) — what is exercised here
// is the in-memory override bookkeeping.
describe("useSettingsStore — bucket accent override", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it("starts without a bucket override", () => {
    const store = useSettingsStore()
    expect(store.bucketPrimaryColorOverride).toBeNull()
    expect(store.primaryColor).toBe(DEFAULT_PRIMARY_COLOR)
  })

  it("applies the realXhub green override without touching the saved color", () => {
    const store = useSettingsStore()
    store.setPrimaryColor("#3B4F74")

    store.setBucketPrimaryColor(REALXHUB_PRIMARY_COLOR)

    expect(store.bucketPrimaryColorOverride).toBe(REALXHUB_PRIMARY_COLOR)
    expect(store.primaryColor).toBe("#3B4F74")
  })

  it("clearing the override keeps the saved color", () => {
    const store = useSettingsStore()
    store.setPrimaryColor("#3B4F74")

    store.setBucketPrimaryColor(REALXHUB_PRIMARY_COLOR)
    store.setBucketPrimaryColor(null)

    expect(store.bucketPrimaryColorOverride).toBeNull()
    expect(store.primaryColor).toBe("#3B4F74")
  })

  it("clearing with no active override is a no-op", () => {
    const store = useSettingsStore()

    store.setBucketPrimaryColor(null)

    expect(store.bucketPrimaryColorOverride).toBeNull()
    expect(store.primaryColor).toBe(DEFAULT_PRIMARY_COLOR)
  })

  it("ignores a non-allowlisted override value", () => {
    const store = useSettingsStore()

    store.setBucketPrimaryColor("#123456")

    expect(store.bucketPrimaryColorOverride).toBeNull()
    expect(store.primaryColor).toBe(DEFAULT_PRIMARY_COLOR)
  })
})
