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
