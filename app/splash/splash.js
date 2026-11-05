/* Pre-hydration splash screen.
 *
 * Inlined as a classic <script> at bodyOpen (see nuxt.config.ts), so it runs
 * synchronously during HTML parse — before the deferred module bundle. That is
 * what pulls First Contentful Paint forward: the large "realXmessage" title
 * paints immediately instead of waiting ~30s for @polkadot/api to download and
 * hydrate. The overlay is appended to <body> (a sibling of #__nuxt) so Vue
 * mounting into #__nuxt never touches it; app/plugins/splash.client.ts calls
 * window.__appReady() on app:mounted to fade it out and hand off to the in-app
 * loading components.
 */
(function () {
  if (window.__rxSplash) return
  window.__rxSplash = true

  var DURATION = 6000
  var CAP = 95
  var MAX_LIFETIME = 30000

  var reduce = false
  try {
    reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch (e) {}

  var root = document.createElement("div")
  root.id = "rx-splash"
  root.setAttribute("role", "status")
  root.setAttribute("aria-label", "Loading realXmessage")

  var center = document.createElement("div")
  center.className = "rx-splash__center"
  var logo = document.createElement("img")
  logo.className = "rx-splash__logo"
  logo.alt = "realXmessage"
  logo.src = "__RX_LOGO__"
  var pct = document.createElement("div")
  pct.className = "rx-splash__pct"
  pct.textContent = "0%"
  center.appendChild(logo)
  center.appendChild(pct)
  root.appendChild(center)

  ;(document.body || document.documentElement).appendChild(root)

  var startTime = performance.now()
  var displayed = 0
  var ready = false
  var readyStart = 0
  var readyFrom = 0
  var raf = 0

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3)
  }

  function progressAt(now) {
    if (ready) {
      var rt = Math.min((now - readyStart) / 400, 1)
      return readyFrom + (100 - readyFrom) * rt
    }
    var t = Math.min((now - startTime) / DURATION, 1)
    return CAP * easeOutCubic(t)
  }

  function frame(now) {
    raf = requestAnimationFrame(frame)

    var v = progressAt(now)
    if (v > displayed) displayed = v
    pct.textContent = Math.round(displayed) + "%"
    if (ready && displayed >= 100) finish()
  }

  var finished = false
  function finish() {
    if (finished) return
    finished = true
    if (raf) cancelAnimationFrame(raf)
    root.className = "rx-splash--hide"
    var done = function () {
      if (root.parentNode) root.parentNode.removeChild(root)
    }
    root.addEventListener("transitionend", done, { once: true })
    setTimeout(done, 700)
  }

  window.__appReady = function () {
    if (ready) return
    ready = true
    readyStart = performance.now()
    readyFrom = displayed
    if (reduce) {
      displayed = 100
      pct.textContent = "100%"
      finish()
    }
  }

  setTimeout(function () {
    if (window.__appReady) window.__appReady()
  }, MAX_LIFETIME)

  raf = requestAnimationFrame(frame)
})()
