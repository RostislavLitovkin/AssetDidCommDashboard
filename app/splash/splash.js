/* Pre-hydration splash screen.
 *
 * Inlined as a classic <script> at bodyOpen (see nuxt.config.ts), so it runs
 * synchronously during HTML parse — before the deferred module bundle. That is
 * what pulls First Contentful Paint forward: the large "realXmessage" title
 * paints immediately instead of waiting ~30s for @polkadot/api to download and
 * hydrate. The overlay is appended to <body> (a sibling of #__nuxt) so Vue
 * mounting into #__nuxt never touches it; app/plugins/splash.client.ts calls
 * window.__appReady() on app:mounted to fade it out and hand off to the in-app
 * ParticleLoader components.
 *
 * The particle field mirrors components/common/ParticleLoader.vue (squares
 * flying to centre, accelerating, fading, with a keep-out box around the text).
 */
(function () {
  if (window.__rxSplash) return
  window.__rxSplash = true

  var PRIMARY = "87, 160, 197" // --color-primary #57a0c5
  var DURATION = 6000 // ms to sweep 0 -> CAP%
  var CAP = 95 // hold here until the app is genuinely mounted
  var MAX_LIFETIME = 30000 // never trap the app if app:mounted never fires

  var reduce = false
  try {
    reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch (e) {}

  // --- DOM -----------------------------------------------------------------
  var root = document.createElement("div")
  root.id = "rx-splash"
  root.setAttribute("role", "status")
  root.setAttribute("aria-label", "Loading realXmessage")

  var canvas = document.createElement("canvas")
  canvas.setAttribute("aria-hidden", "true")
  root.appendChild(canvas)

  var center = document.createElement("div")
  center.className = "rx-splash__center"
  var logo = document.createElement("img")
  logo.className = "rx-splash__logo"
  logo.alt = "realXmessage"
  // Replaced at build time with a base64 data URI of realXmessenger.svg
  // (see nuxt.config.ts), so the logo needs no network request.
  logo.src = "__RX_LOGO__"
  logo.addEventListener("load", function () {
    if (!finished && !reduce) measure()
  })
  var pct = document.createElement("div")
  pct.className = "rx-splash__pct"
  pct.textContent = "0%"
  center.appendChild(logo)
  center.appendChild(pct)
  root.appendChild(center)

  ;(document.body || document.documentElement).appendChild(root)

  // --- Progress (timed sweep) ---------------------------------------------
  var startTime = performance.now()
  var displayed = 0
  var ready = false
  var readyStart = 0
  var readyFrom = 0

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

  // --- Particles -----------------------------------------------------------
  var ctx = null
  var W = 0
  var H = 0
  var refDist = 100
  var holdW = 60
  var holdH = 30
  var particles = []
  var raf = 0
  var last = 0
  var SIZE_MIN = 1.5
  var SIZE_MAX = 4
  var RATE_MIN = 0.35
  var RATE_MAX = 2.4
  var FADE_IN_END = 0.14
  var FADE_OUT_START = 0.62

  function exitDistance(dx, dy, hw, hh) {
    var tx = Math.abs(dx) < 1e-6 ? Infinity : hw / Math.abs(dx)
    var ty = Math.abs(dy) < 1e-6 ? Infinity : hh / Math.abs(dy)
    return Math.min(tx, ty)
  }

  function spawn(p) {
    var hw = W / 2
    var hh = H / 2
    var minTravel = Math.max(8, refDist * 0.06)
    var x = 0
    var y = 0
    var dist = 0
    var kill = 0
    var placed = false
    for (var i = 0; i < 12; i++) {
      x = (Math.random() * 2 - 1) * hw
      y = (Math.random() * 2 - 1) * hh
      dist = Math.sqrt(x * x + y * y)
      if (dist < 1) continue
      kill = exitDistance(x / dist, y / dist, holdW, holdH)
      if (dist - kill >= minTravel) {
        placed = true
        break
      }
    }
    if (!placed) {
      var a = Math.random() * Math.PI * 2
      var dx = Math.cos(a)
      var dy = Math.sin(a)
      kill = exitDistance(dx, dy, holdW, holdH)
      var edge = exitDistance(dx, dy, hw, hh)
      dist = Math.max(Math.min(kill + minTravel, edge), kill + 1)
      x = dx * dist
      y = dy * dist
    }
    p.dirX = x / dist
    p.dirY = y / dist
    p.killDist = kill
    p.startDist = dist
    p.travel = Math.max(dist - kill, 1)
    p.dist = dist
    p.size = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN)
    p.maxAlpha = 0.45 + Math.random() * 0.55
  }

  function measure() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2)
    W = Math.max(window.innerWidth, 1)
    H = Math.max(window.innerHeight, 1)
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    canvas.style.width = W + "px"
    canvas.style.height = H + "px"
    ctx = canvas.getContext("2d")
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    refDist = Math.sqrt(W * W + H * H) / 2

    // The text block is centred, so its padded half-extents are the keep-out box.
    var r = center.getBoundingClientRect()
    var pad = 28
    holdW = Math.min(r.width / 2 + pad, W * 0.46)
    holdH = Math.min(r.height / 2 + pad, H * 0.46)

    var target = Math.min(Math.max(Math.round(Math.sqrt(W * H) * 0.16), 40), 240)
    while (particles.length > target) particles.pop()
    while (particles.length < target) {
      var p = {}
      spawn(p)
      p.dist = p.killDist + p.travel * Math.random() // stagger the first burst
      particles.push(p)
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame)

    var v = progressAt(now)
    if (v > displayed) displayed = v
    pct.textContent = Math.round(displayed) + "%"
    if (ready && displayed >= 100) {
      finish()
      return
    }

    if (!ctx) return // reduced motion: text-only, no particle field
    var dt = Math.min((now - last) / 1000, 0.05)
    last = now
    if (dt <= 0) return

    ctx.clearRect(0, 0, W, H)
    var cx = W / 2
    var cy = H / 2
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i]
      var prog = (p.startDist - p.dist) / p.travel
      if (prog >= 1) {
        spawn(p)
        continue
      }
      var speed = refDist * (RATE_MIN + (RATE_MAX - RATE_MIN) * prog * prog)
      p.dist -= speed * dt
      var fi = prog < FADE_IN_END ? prog / FADE_IN_END : 1
      var fo = prog > FADE_OUT_START ? 1 - (prog - FADE_OUT_START) / (1 - FADE_OUT_START) : 1
      var alpha = p.maxAlpha * fi * fo
      if (alpha <= 0.01) continue
      var half = p.size / 2
      ctx.fillStyle = "rgba(" + PRIMARY + ", " + alpha + ")"
      ctx.fillRect(cx + p.dirX * p.dist - half, cy + p.dirY * p.dist - half, p.size, p.size)
    }
  }

  var finished = false
  function finish() {
    if (finished) return
    finished = true
    if (raf) cancelAnimationFrame(raf)
    window.removeEventListener("resize", onResize)
    root.className = "rx-splash--hide"
    var done = function () {
      if (root.parentNode) root.parentNode.removeChild(root)
    }
    root.addEventListener("transitionend", done, { once: true })
    setTimeout(done, 700) // fallback if transitionend never fires
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

  function onResize() {
    if (!reduce) measure()
  }

  // Safety net: never let a hung bundle leave the splash covering the app.
  setTimeout(function () {
    if (window.__appReady) window.__appReady()
  }, MAX_LIFETIME)

  if (reduce) {
    // Text-only progress, no animation. rAF only updates the number.
    startTime = performance.now()
    raf = requestAnimationFrame(frame)
  } else {
    window.addEventListener("resize", onResize)
    measure()
    last = performance.now()
    startTime = last
    raf = requestAnimationFrame(frame)
    // Refine the keep-out box once the custom font swaps in and reflows the text.
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () {
        if (!finished) measure()
      })
    }
  }
})()
