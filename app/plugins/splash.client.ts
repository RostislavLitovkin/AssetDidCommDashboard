/**
 * Signals the pre-hydration splash (app/splash/splash.js) that the app shell is
 * mounted, so it can ease the percentage to 100%, fade out, and hand off to the
 * in-app ParticleLoader components. The splash defines window.__appReady during
 * initial HTML parse, long before this client plugin runs.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook("app:mounted", () => {
    ;(window as unknown as { __appReady?: () => void }).__appReady?.()
  })
})
