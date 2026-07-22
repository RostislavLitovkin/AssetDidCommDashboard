<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"

type LoaderSize = "inline" | "block" | "page"

const props = withDefaults(
  defineProps<{
    label?: string
    size?: LoaderSize
  }>(),
  {
    label: "Loading...",
    size: "block"
  }
)

/** A particle flies straight at the centre, so its whole path is fixed at spawn.
 *  We track only how far out it currently is and interpolate everything else
 *  from `progress`, which keeps the per-frame work to a couple of multiplies. */
type Particle = {
  dirX: number
  dirY: number
  startDist: number
  killDist: number
  travel: number
  dist: number
  size: number
  maxAlpha: number
}

/** Speed as a fraction of the area's half-diagonal per second, so motion scales
 *  with the loader's size instead of with each particle's own path length —
 *  otherwise particles spawning near the text would crawl. */
const RATE_MIN = 0.35
const RATE_MAX = 2.4
/** Squares, in CSS px. */
const SIZE_MIN = 1.5
const SIZE_MAX = 4
/** Particles per sqrt(px area). Tuned so `block` gets ~45 and `page` ~130. */
const DENSITY = 0.22
const COUNT_MIN = 6
const COUNT_MAX = 160
const FADE_IN_END = 0.14
const FADE_OUT_START = 0.62

const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const labelEl = ref<HTMLElement | null>(null)
const reducedMotion = ref(false)

const text = computed(() => (props.size === "inline" ? "" : props.label))
const ariaLabel = computed(() => props.label || "Loading")

let ctx: CanvasRenderingContext2D | null = null
let particles: Particle[] = []
let frame = 0
let lastTime = 0
let rgb = "87, 160, 197"
/** Canvas size in CSS pixels (the backing store is scaled by DPR). */
let width = 0
let height = 0
/** Half-extents of the rectangle particles must not enter, centred on the canvas. */
let holdW = 8
let holdH = 8
/** Half the canvas diagonal — the reference length all speeds are scaled by. */
let refDist = 100

function readPrimaryColor(): string {
  if (!root.value) return rgb
  const raw = getComputedStyle(root.value).getPropertyValue("--color-primary").trim()
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
  // Enough runway that a particle is never born already dissolving.
  const minTravel = Math.max(8, refDist * 0.06)

  // Sample uniformly over the rectangle and reject anything landing inside the
  // keep-out box. Picking an angle first would bias towards the short axis,
  // bunching particles above and below a wide label instead of spreading them.
  let x = 0
  let y = 0
  let dist = 0
  let kill = 0
  let placed = false
  for (let i = 0; i < 12; i++) {
    x = (Math.random() * 2 - 1) * halfW
    y = (Math.random() * 2 - 1) * halfH
    dist = Math.hypot(x, y)
    if (dist < 1) continue
    kill = exitDistance(x / dist, y / dist, holdW, holdH)
    if (dist - kill >= minTravel) {
      placed = true
      break
    }
  }
  if (!placed) {
    // Cramped area (the label nearly fills it): fall back to a ring just
    // outside the keep-out box rather than looping forever.
    const angle = Math.random() * Math.PI * 2
    const dirX = Math.cos(angle)
    const dirY = Math.sin(angle)
    kill = exitDistance(dirX, dirY, holdW, holdH)
    const edge = exitDistance(dirX, dirY, halfW, halfH)
    dist = Math.max(Math.min(kill + minTravel, edge), kill + 1)
    x = dirX * dist
    y = dirY * dist
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

  // The label is centred over the canvas, so its bounding box shares the
  // canvas centre and becomes the keep-out rect directly.
  const pad = props.size === "inline" ? 4 : 10
  const labelRect = labelEl.value?.getBoundingClientRect()
  if (labelRect && labelRect.width > 0) {
    holdW = labelRect.width / 2 + pad
    holdH = labelRect.height / 2 + pad
  } else {
    const r = Math.max(Math.min(width, height) * 0.12, 5)
    holdW = r
    holdH = r
  }
  // Never let the keep-out zone swallow the whole area.
  holdW = Math.min(holdW, width * 0.44)
  holdH = Math.min(holdH, height * 0.44)

  refDist = Math.hypot(width, height) / 2

  rgb = readPrimaryColor()

  const target = Math.round(
    Math.min(Math.max(Math.sqrt(width * height) * DENSITY, COUNT_MIN), COUNT_MAX)
  )
  while (particles.length > target) particles.pop()
  while (particles.length < target) {
    const p: Particle = {
      dirX: 1,
      dirY: 0,
      startDist: 0,
      killDist: 0,
      travel: 1,
      dist: 0,
      size: SIZE_MIN,
      maxAlpha: 1
    }
    spawn(p)
    // Stagger the initial burst so the field is already in flight on mount.
    p.dist = p.killDist + p.travel * Math.random()
    particles.push(p)
  }
}

function render(now: number): void {
  frame = requestAnimationFrame(render)
  if (!ctx) return

  // Clamp so a backgrounded tab doesn't teleport every particle on resume.
  const dt = Math.min((now - lastTime) / 1000, 0.05)
  lastTime = now
  if (dt <= 0) return

  ctx.clearRect(0, 0, width, height)

  const cx = width / 2
  const cy = height / 2

  for (const p of particles) {
    const progress = (p.startDist - p.dist) / p.travel
    if (progress >= 1) {
      spawn(p)
      continue
    }

    const speed = refDist * (RATE_MIN + (RATE_MAX - RATE_MIN) * progress * progress)
    p.dist -= speed * dt

    const fadeIn = progress < FADE_IN_END ? progress / FADE_IN_END : 1
    const fadeOut =
      progress > FADE_OUT_START ? 1 - (progress - FADE_OUT_START) / (1 - FADE_OUT_START) : 1
    const alpha = p.maxAlpha * fadeIn * fadeOut
    if (alpha <= 0.01) continue

    const half = p.size / 2
    ctx.fillStyle = `rgba(${rgb}, ${alpha})`
    ctx.fillRect(cx + p.dirX * p.dist - half, cy + p.dirY * p.dist - half, p.size, p.size)
  }
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

function onVisibility(): void {
  if (document.hidden) stop()
  else start()
}

let observer: ResizeObserver | null = null
let motionQuery: MediaQueryList | null = null

function onMotionChange(): void {
  reducedMotion.value = !!motionQuery?.matches
  if (reducedMotion.value) {
    stop()
    ctx?.clearRect(0, 0, width, height)
  } else {
    resize()
    start()
  }
}

onMounted(() => {
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
  reducedMotion.value = motionQuery.matches
  motionQuery.addEventListener("change", onMotionChange)

  resize()
  observer = new ResizeObserver(() => resize())
  if (root.value) observer.observe(root.value)
  document.addEventListener("visibilitychange", onVisibility)
  start()
})

onBeforeUnmount(() => {
  stop()
  observer?.disconnect()
  observer = null
  motionQuery?.removeEventListener("change", onMotionChange)
  motionQuery = null
  document.removeEventListener("visibilitychange", onVisibility)
})

// The keep-out rect is derived from the rendered label, so re-measure when it
// changes. `flush: "post"` so the label is already patched when we measure it.
watch([text, () => props.size], () => resize(), { flush: "post" })
</script>

<template>
  <div
    ref="root"
    class="particle-loader"
    :class="`particle-loader--${size}`"
    role="status"
    aria-live="polite"
    :aria-label="text ? undefined : ariaLabel"
  >
    <canvas v-show="!reducedMotion" ref="canvas" class="particle-loader-canvas" aria-hidden="true" />
    <div v-if="reducedMotion" class="particle-loader-fallback" aria-hidden="true">
      <span /><span /><span />
    </div>
    <span v-if="text" ref="labelEl" class="particle-loader-label">{{ text }}</span>
  </div>
</template>

<style scoped>
.particle-loader {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  justify-content: center;
  width: 100%;
  overflow: hidden;
}

.particle-loader--inline {
  height: 22px;
  min-width: 48px;
}

.particle-loader--block {
  height: 120px;
}

.particle-loader--page {
  height: 100%;
  min-height: 220px;
}

.particle-loader-canvas {
  position: absolute;
  inset: 0;
  display: block;
}

.particle-loader-label {
  position: relative;
  z-index: 1;
  max-width: 80%;
  color: var(--text-secondary);
  font-size: 0.9rem;
  text-align: center;
  overflow-wrap: anywhere;
}

.particle-loader--page .particle-loader-label {
  font-size: 1rem;
}

.particle-loader-fallback {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
}

.particle-loader-fallback span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  animation: particle-loader-pulse 1.8s ease-in-out infinite;
}

.particle-loader-fallback span:nth-child(2) {
  animation-delay: 0.3s;
}

.particle-loader-fallback span:nth-child(3) {
  animation-delay: 0.6s;
}

/* Reduced-motion fallback: opacity only, no movement. */
@keyframes particle-loader-pulse {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 1;
  }
}
</style>
