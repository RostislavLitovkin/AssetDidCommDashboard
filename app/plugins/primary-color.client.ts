import { PRIMARY_COLOR_QUERY_KEY } from "../services/theme/primaryColor"
import { useSettingsStore } from "../stores/settings"

/**
 * Applies the primary accent color on startup, across every route.
 * Initializing the settings store reads the persisted choice — plus any
 * `?primaryColor=` on the entry URL, which takes precedence — and writes it to
 * the `--color-primary` CSS custom property on :root. `initialize()` is
 * idempotent, so this is safe to call alongside the settings page and the other
 * plugins that also initialize the store.
 *
 * The router hook covers the rest: a navigation can arrive with a parameter the
 * entry URL did not carry, and the store persists what it is given, so the
 * color also outlives the navigations that drop the parameter again.
 */
export default defineNuxtPlugin(() => {
  const settings = useSettingsStore()
  settings.initialize()

  useRouter().afterEach((to) => {
    settings.applyQueryPrimaryColor(to.query[PRIMARY_COLOR_QUERY_KEY])
  })
})
