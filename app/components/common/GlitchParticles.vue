<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue"

const props = withDefaults(
  defineProps<{
    label?: string
  }>(),
  {
    label: "Unable to decrypt message"
  }
)

/** The inverse of ParticleLoader's particle: it drifts *outward* from behind
 *  the label and dissolves at the edge, so the whole path is fixed at spawn and
 *  everything else interpolates from `progress`. */
type Particle = {
  dirX: number
  dirY: number
  startDist: number
  travel: number
  dist: number
  size: number
  maxAlpha: number
  /** Outward speed as a fraction of the half-diagonal per second. */
  rate: number
  /** Frames left drawing as a smeared bar instead of a square. */
  smear: number
}

/** Slower and more uneven than the loader's accelerating inward rush — this
 *  reads as decay, not progress. */
const RATE_MIN = 0.16
const RATE_MAX = 0.5
/** Squares, in CSS px. */
const SIZE_MIN = 1
const SIZE_MAX = 3.5
/** Particles per sqrt(px area), matching ParticleLoader. The tile is small
 *  enough that anything lower leaves a few stray dots rather than a field. */
const DENSITY = 0.22
const COUNT_MIN = 14
const COUNT_MAX = 48
const FADE_IN_END = 0.12
const FADE_OUT_START = 0.62
/** Per-frame horizontal displacement, in CSS px — the datamosh shimmer. */
const JITTER = 2.5
/** Alpha multiplier while a particle is crossing the label. The label covers
 *  most of a tile this size, so dimming much harder than this would erase the
 *  effect rather than just keeping the text legible. */
const LABEL_DIM = 0.5
const SMEAR_CHANCE = 0.012
const SMEAR_FRAMES = 3
/** Chance per frame of starting a tear band. */
const TEAR_CHANCE = 0.02

const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const labelEl = ref<HTMLElement | null>(null)
const reducedMotion = ref(false)

let ctx: CanvasRenderingContext2D | null = null
let particles: Particle[] = []
let frame = 0
let lastTime = 0
let rgb = "159, 63, 63"
/** Canvas size in CSS pixels (the backing store is scaled by DPR). */
let width = 0
let height = 0
/** Half-extents of the label's box, centred on the canvas. */
let holdW = 8
let holdH = 8
/** Half the canvas diagonal — the reference length all speeds are scaled by. */
let refDist = 100
/** Active tear band: a horizontal slice whose particles are displaced sideways. */
let tearFrames = 0
let tearY = 0
let tearH = 0
let tearOffset = 0
/** Whether the tile is scrolled into view — a bucket can hold many of these. */
let onScreen = true

/** Reads `--glitch-color`, falling back to `--status-error`. Hex only. */
function readColor(): string {
  if (!root.value) return rgb
  const style = getComputedStyle(root.value)
  const raw =
    style.getPropertyValue("--glitch-color").trim() ||
    style.getPropertyValue("--status-error").trim()
  const hex = raw.replace("#", "")
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex
  if (full.length !== 6 || !/^[0-9a-f]{6}$/i.test(full)) return rgb
  const n = parseInt(full, 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

/** Distance from the centre to the edge of a centred rect along a unit vector. */
function exitDistance(dirX: number, dirY: number, halfW: number, halfH: number): number {
  const tx = Math.abs(dirX) < 1e-6 ? Infinity : halfW / Math.abs(dirX)
  const ty = Math.abs(dirY) < 1e-6 ? Infinity : halfH / Math.abs(dirY)
  return Math.min(tx, ty)
}

function spawn(p: Particle): void {
  const halfW = width / 2
  const halfH = height / 2

  // Take the direction from a uniformly sampled point rather than a uniform
  // angle: on a tile this wide and flat, angles would bunch particles above and
  // below the label instead of spreading them across it.
  let dirX = 1
  let dirY = 0
  for (let i = 0; i < 10; i++) {
    const x = (Math.random() * 2 - 1) * halfW
    const y = (Math.random() * 2 - 1) * halfH
    const len = Math.hypot(x, y)
    if (len < 1) continue
    dirX = x / len
    dirY = y / len
    break
  }

  const exit = exitDistance(dirX, dirY, halfW, halfH)
  // Start anywhere across the inner two-thirds so the field looks scattered
  // from the first frame; the floor stops a particle dying where it spawned.
  const start = Math.min(exit * Math.random() * 0.66, Math.max(exit - 4, 0))

  p.dirX = dirX
  p.dirY = dirY
  p.startDist = start
  p.travel = Math.max(exit - start, 1)
  p.dist = start
  p.size = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN)
  p.maxAlpha = 0.5 + Math.random() * 0.5
  p.rate = RATE_MIN + Math.random() * (RATE_MAX - RATE_MIN)
  p.smear = 0
}

function resize(): void {
  const el = root.value
  const cv = canvas.value
  if (!el || !cv) return

  const rect = el.getBoundingClientRect()
  width = Math.max(rect.width, 1)
  height = Math.max(rect.height, 1)

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  cv.width = Math.round(width * dpr)
  cv.height = Math.round(height * dpr)
  cv.style.width = `${width}px`
  cv.style.height = `${height}px`

  ctx = cv.getContext("2d")
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)

  // The label is centred over the canvas, so its bounding box shares the canvas
  // centre. Unlike ParticleLoader this is a *soft* mask, not a keep-out zone:
  // the label nearly fills a tile this small, so excluding particles from it
  // would leave them nowhere to go.
  const labelRect = labelEl.value?.getBoundingClientRect()
  if (labelRect && labelRect.width > 0) {
    holdW = labelRect.width / 2
    holdH = labelRect.height / 2
  } else {
    holdW = width * 0.35
    holdH = height * 0.3
  }

  refDist = Math.hypot(width, height) / 2

  rgb = readColor()

  const target = Math.round(
    Math.min(Math.max(Math.sqrt(width * height) * DENSITY, COUNT_MIN), COUNT_MAX)
  )
  while (particles.length > target) particles.pop()
  while (particles.length < target) {
    const p: Particle = {
      dirX: 1,
      dirY: 0,
      startDist: 0,
      travel: 1,
      dist: 0,
      size: SIZE_MIN,
      maxAlpha: 1,
      rate: RATE_MIN,
      smear: 0
    }
    spawn(p)
    // Stagger the initial burst so the field is already scattered on mount.
    // Without this every particle sits at progress 0, where the fade-in makes
    // it fully transparent — the tile would paint nothing at all on the first
    // frame, and then pulse in unison for the first cycle.
    p.dist = p.startDist + p.travel * Math.random()
    particles.push(p)
  }

  if (reducedMotion.value) drawFrame(0, false)
}

function drawFrame(dt: number, animated: boolean): void {
  if (!ctx) return

  ctx.clearRect(0, 0, width, height)

  const cx = width / 2
  const cy = height / 2

  // A tear displaces every particle in one horizontal band sideways for a few
  // frames — the signal-corruption beat that sets this apart from the loader.
  if (animated) {
    if (tearFrames > 0) {
      tearFrames -= 1
    } else if (Math.random() < TEAR_CHANCE) {
      tearFrames = 2 + Math.floor(Math.random() * 3)
      tearY = Math.random() * height
      tearH = 3 + Math.random() * 8
      tearOffset = (Math.random() * 2 - 1) * 10
    }
  }

  for (const p of particles) {
    const progress = (p.dist - p.startDist) / p.travel
    if (progress >= 1) {
      if (animated) spawn(p)
      continue
    }
    if (animated) p.dist += refDist * p.rate * dt

    const fadeIn = progress < FADE_IN_END ? progress / FADE_IN_END : 1
    const fadeOut =
      progress > FADE_OUT_START ? 1 - (progress - FADE_OUT_START) / (1 - FADE_OUT_START) : 1
    let alpha = p.maxAlpha * fadeIn * fadeOut
    if (alpha <= 0.01) continue

    let x = cx + p.dirX * p.dist
    const y = cy + p.dirY * p.dist

    if (Math.abs(x - cx) < holdW && Math.abs(y - cy) < holdH) alpha *= LABEL_DIM

    if (animated) {
      x += (Math.random() * 2 - 1) * JITTER
      if (tearFrames > 0 && y >= tearY && y <= tearY + tearH) x += tearOffset

      if (p.smear > 0) p.smear -= 1
      else if (Math.random() < SMEAR_CHANCE) p.smear = SMEAR_FRAMES
    }

    ctx.fillStyle = `rgba(${rgb}, ${alpha})`
    if (p.smear > 0) {
      ctx.fillRect(x - p.size * 2, y - 0.5, p.size * 4, 1)
    } else {
      const half = p.size / 2
      ctx.fillRect(x - half, y - half, p.size, p.size)
    }
  }

  if (animated && tearFrames > 0) {
    ctx.fillStyle = `rgba(${rgb}, 0.12)`
    ctx.fillRect(0, tearY, width, 1)
  }
}

function render(now: number): void {
  frame = requestAnimationFrame(render)

  // Clamp so a backgrounded tab doesn't teleport every particle on resume.
  const dt = Math.min((now - lastTime) / 1000, 0.05)
  lastTime = now
  if (dt <= 0) return

  drawFrame(dt, true)
}

function start(): void {
  if (frame || reducedMotion.value) return
  lastTime = performance.now()
  frame = requestAnimationFrame(render)
}

function stop(): void {
  if (!frame) return
  cancelAnimationFrame(frame)
  frame = 0
}

/** One gate for every reason to pause: reduced motion, hidden tab, off-screen. */
function syncRunning(): void {
  if (reducedMotion.value || document.hidden || !onScreen) stop()
  else start()
}

let observer: ResizeObserver | null = null
let intersection: IntersectionObserver | null = null
let motionQuery: MediaQueryList | null = null

function onMotionChange(): void {
  reducedMotion.value = !!motionQuery?.matches
  if (reducedMotion.value) {
    stop()
    drawFrame(0, false)
  } else {
    resize()
    syncRunning()
  }
}

onMounted(() => {
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
  reducedMotion.value = motionQuery.matches
  motionQuery.addEventListener("change", onMotionChange)

  resize()
  observer = new ResizeObserver(() => resize())
  if (root.value) observer.observe(root.value)

  // Many undecryptable messages in one bucket would otherwise mean many idle
  // rAF loops, so each tile only animates while it is actually on screen.
  intersection = new IntersectionObserver((entries) => {
    onScreen = entries.some((entry) => entry.isIntersecting)
    syncRunning()
  })
  if (root.value) intersection.observe(root.value)

  document.addEventListener("visibilitychange", syncRunning)
  syncRunning()
})

onBeforeUnmount(() => {
  stop()
  observer?.disconnect()
  observer = null
  intersection?.disconnect()
  intersection = null
  motionQuery?.removeEventListener("change", onMotionChange)
  motionQuery = null
  document.removeEventListener("visibilitychange", syncRunning)
})

// The soft mask is derived from the rendered label, so re-measure when it
// changes. `flush: "post"` so the label is already patched when we measure it.
watch(() => props.label, () => resize(), { flush: "post" })
</script>

<template>
  <div ref="root" class="glitch-particles">
    <canvas ref="canvas" class="glitch-particles-canvas" aria-hidden="true" />
    <span
      ref="labelEl"
      class="glitch-particles-label"
      :class="{ 'glitch-particles-label--still': reducedMotion }"
    >{{ label }}</span>
  </div>
</template>

<style scoped>
.glitch-particles {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 200px;
  min-height: 44px;
  padding: 6px 12px;
  overflow: hidden;
  border-radius: inherit;
}

.glitch-particles-canvas {
  position: absolute;
  inset: 0;
  display: block;
}

.glitch-particles-label {
  position: relative;
  z-index: 1;
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  text-align: center;
  color: var(--glitch-color, var(--status-error));
  animation: glitch-particles-text 4.2s steps(1, end) infinite;
}

/* Mostly clean, with brief chromatic-split stutters — a glitch reads as an
   interruption, so the quiet stretches between them are doing the work. */
@keyframes glitch-particles-text {
  0%,
  90%,
  100% {
    transform: translateX(0);
    opacity: 1;
    text-shadow: none;
  }

  91% {
    transform: translateX(-1px);
    opacity: 0.82;
    text-shadow: -1px 0 rgba(255, 0, 60, 0.55), 1px 0 rgba(0, 220, 255, 0.55);
  }

  93% {
    transform: translateX(1px);
    opacity: 1;
    text-shadow: 1px 0 rgba(255, 0, 60, 0.5), -1px 0 rgba(0, 220, 255, 0.5);
  }

  95% {
    transform: translateX(0);
    opacity: 0.55;
    text-shadow: none;
  }
}

/* Reduced motion: the canvas still shows a static scatter, but nothing moves. */
.glitch-particles-label--still {
  animation: none;
}
</style>
