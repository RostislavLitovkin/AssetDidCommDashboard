<script setup lang="ts">
import { ArrowLeft, Check, KeyRound, MessageSquare, UserRoundPlus, Wallet } from "lucide-vue-next"
import type { Component } from "vue"
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { SETUP_STEPS, tutorialActive, useSetupTutorial } from "../../composables/useSetupTutorial"
import type { SetupStepId } from "../../composables/useSetupTutorial"

/** Applied to the live sidebar control so it lifts clear of the scrim. Global
 *  rather than scoped, because the element it lands on belongs to the shell. */
const FOCUS_CLASS = "rxm-tutorial-focus"
/** How far outside the control the spotlight ring sits. */
const RING_INSET = 5
/** The scrim's cut-out. Wider than the ring so the ring's line lands inside the
 *  hole and only its outer glow spills onto the dimmed area. */
const HOLE_INSET = 8
const HOLE_RADIUS = 14
/** Gap between the sidebar's edge and the bubble. */
const BUBBLE_GAP = 20
/** Keeps the bubble and its arrow off the window edges. */
const EDGE_MARGIN = 16
const ARROW_MARGIN = 28
/** Long enough to read "you're all set", short enough not to be in the way. */
const FINALE_MS = 2400

const STEP_ICONS: Record<SetupStepId, Component> = {
  wallet: Wallet,
  key: KeyRound,
  profile: UserRoundPlus,
  chat: MessageSquare
}

const tutorial = useSetupTutorial()
const {
  activeIndex,
  activeStep,
  allDone,
  celebrating,
  isBlocking,
  isReleased,
  isRunning
} = tutorial

const bubbleRef = ref<HTMLElement | null>(null)
const skipRef = ref<HTMLElement | null>(null)
const hasTarget = ref(false)
const targetRect = ref({ top: 0, left: 0, width: 0, height: 0 })
const sidebarRight = ref(260)
const viewportWidth = ref(0)
const viewportHeight = ref(0)
const bubbleHeight = ref(240)
const stageHeight = ref<number | null>(null)

const stepIcon = computed(() => STEP_ICONS[activeStep.value.id])
const stepLabel = computed(() =>
  celebrating.value ? "Setup complete" : `Step ${activeIndex.value + 1} of ${SETUP_STEPS.length}`
)
/** Re-keys the swapping panel: one entry per step, plus the finale. */
const stageKey = computed(() => (celebrating.value ? "complete" : activeStep.value.id))

const targetCenterY = computed(() => targetRect.value.top + targetRect.value.height / 2)

const ringStyle = computed(() => ({
  top: `${targetRect.value.top - RING_INSET}px`,
  left: `${targetRect.value.left - RING_INSET}px`,
  width: `${targetRect.value.width + RING_INSET * 2}px`,
  height: `${targetRect.value.height + RING_INSET * 2}px`
}))

/** Centred on the control, then pulled back inside the window so a control near
 *  the top or bottom of the sidebar never pushes the bubble off screen. */
const bubbleTop = computed(() => {
  const lowest = Math.max(EDGE_MARGIN, viewportHeight.value - bubbleHeight.value - EDGE_MARGIN)
  return Math.min(Math.max(targetCenterY.value - bubbleHeight.value / 2, EDGE_MARGIN), lowest)
})

const bubbleStyle = computed(() => ({
  top: `${bubbleTop.value}px`,
  left: `${sidebarRight.value + BUBBLE_GAP}px`
}))

/** The arrow keeps pointing at the control even after the bubble is clamped. */
const arrowStyle = computed(() => {
  const lowest = Math.max(ARROW_MARGIN, bubbleHeight.value - ARROW_MARGIN)
  const offset = Math.min(Math.max(targetCenterY.value - bubbleTop.value, ARROW_MARGIN), lowest)
  return { top: `${offset}px` }
})

/**
 * The scrim with a rounded hole punched out of it, as a single even-odd path:
 * the viewport rectangle, then the control's. The hole is real geometry, so the
 * highlighted control is neither dimmed nor covered — no layering to get wrong,
 * and nothing between the pointer and the button.
 *
 * Both sub-paths keep a fixed command sequence, which is what lets the browser
 * interpolate the hole from one control to the next instead of jumping.
 */
const holePath = computed(() => {
  const view = `M0 0H${Math.round(viewportWidth.value)}V${Math.round(viewportHeight.value)}H0Z`
  const x = Math.round(targetRect.value.left - HOLE_INSET)
  const y = Math.round(targetRect.value.top - HOLE_INSET)
  const width = Math.round(targetRect.value.width + HOLE_INSET * 2)
  const height = Math.round(targetRect.value.height + HOLE_INSET * 2)
  const r = Math.min(HOLE_RADIUS, width / 2, height / 2)
  const arc = `A${r} ${r} 0 0 1`

  return (
    `${view} M${x + r} ${y}` +
    `H${x + width - r}${arc} ${x + width} ${y + r}` +
    `V${y + height - r}${arc} ${x + width - r} ${y + height}` +
    `H${x + r}${arc} ${x} ${y + height - r}` +
    `V${y + r}${arc} ${x + r} ${y}Z`
  )
})

/** Centre of the scrim's light pool, which follows the control it lights up. */
const scrimStyle = computed(() => ({
  "--tutorial-spot-x": `${targetRect.value.left + targetRect.value.width / 2}px`,
  "--tutorial-spot-y": `${targetCenterY.value}px`,
  clipPath: `path(evenodd, "${holePath.value}")`
}))

const stageStyle = computed(() =>
  stageHeight.value === null ? undefined : { height: `${stageHeight.value}px` }
)

let frame = 0
let focusedTarget: HTMLElement | null = null
let cachedTarget: HTMLElement | null = null
let cachedTargetName = ""
let cachedSidebar: HTMLElement | null = null
let finaleTimer: ReturnType<typeof setTimeout> | undefined
let motionQuery: MediaQueryList | null = null
let desktopQuery: MediaQueryList | null = null
let bubbleObserver: ResizeObserver | null = null

function prefersReducedMotion(): boolean {
  return Boolean(motionQuery?.matches)
}

function findTarget(name: string): HTMLElement | null {
  if (cachedTargetName === name && cachedTarget?.isConnected) {
    return cachedTarget
  }

  cachedTarget = document.querySelector<HTMLElement>(`[data-tutorial-target="${name}"]`)
  cachedTargetName = cachedTarget ? name : ""
  return cachedTarget
}

function findSidebar(): HTMLElement | null {
  if (!cachedSidebar?.isConnected) {
    cachedSidebar = document.querySelector<HTMLElement>(".app-shell-sidebar")
  }

  return cachedSidebar
}

/**
 * Hands the spotlight to a control: it is raised above the scrim, scrolled into
 * view and focused, so the highlighted thing is also the thing a keyboard lands
 * on. Scrolling and focus only happen when the spotlight actually moves.
 *
 * The class is re-asserted on every pass because it is applied to an element
 * Vue owns: any re-render of that node — the router marking the link active, for
 * one — rewrites the class attribute from the template and drops it again.
 */
function setFocusTarget(next: HTMLElement | null): void {
  if (focusedTarget === next) {
    next?.classList.add(FOCUS_CLASS)
    return
  }

  focusedTarget?.classList.remove(FOCUS_CLASS)
  focusedTarget = next

  if (!next) {
    return
  }

  next.classList.add(FOCUS_CLASS)
  next.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" })
  next.focus({ preventScroll: true })
}

/**
 * Follows the control frame by frame rather than reacting to individual events:
 * the sidebar reflows whenever a step completes (a connected wallet adds a row
 * above the buttons, a generated key swaps one out), and polling a single rect
 * is cheaper than the observers it would take to catch every one of those.
 * State only changes when the numbers do, so the CSS transitions run undisturbed.
 */
function track(): void {
  frame = requestAnimationFrame(track)

  if (!isRunning.value) {
    setFocusTarget(null)
    hasTarget.value = false
    return
  }

  const right = findSidebar()?.getBoundingClientRect().right ?? sidebarRight.value
  if (Math.abs(right - sidebarRight.value) > 0.5) {
    sidebarRight.value = right
  }

  if (viewportHeight.value !== window.innerHeight) {
    viewportHeight.value = window.innerHeight
  }

  if (viewportWidth.value !== window.innerWidth) {
    viewportWidth.value = window.innerWidth
  }

  // Released: the bar only needs the sidebar's edge to stay clear of it.
  if (!isBlocking.value) {
    setFocusTarget(null)
    hasTarget.value = false
    return
  }

  const element = findTarget(activeStep.value.target)
  setFocusTarget(element)

  if (!element) {
    hasTarget.value = false
    return
  }

  const box = element.getBoundingClientRect()
  const current = targetRect.value

  if (
    Math.abs(box.top - current.top) > 0.5 ||
    Math.abs(box.left - current.left) > 0.5 ||
    Math.abs(box.width - current.width) > 0.5 ||
    Math.abs(box.height - current.height) > 0.5
  ) {
    targetRect.value = { top: box.top, left: box.left, width: box.width, height: box.height }
  }

  hasTarget.value = true
}

/** The panel is swapped out, so its replacement reports the height to grow to. */
function onStageEnter(element: Element): void {
  stageHeight.value = (element as HTMLElement).offsetHeight
}

/**
 * Holds the keyboard inside the tutorial: the highlighted control and the skip
 * button are the only two stops, which matches what the scrim leaves clickable.
 * The wallet picker opens above the tutorial and runs its own focus, so it is
 * left alone.
 */
function onKeydown(event: KeyboardEvent): void {
  if (!isBlocking.value || event.key !== "Tab") {
    return
  }

  if (document.querySelector(".wallet-modal-backdrop")) {
    return
  }

  const stops = [focusedTarget, skipRef.value].filter((stop): stop is HTMLElement => Boolean(stop))
  if (!stops.length) {
    return
  }

  event.preventDefault()
  const index = stops.indexOf(document.activeElement as HTMLElement)
  const step = event.shiftKey ? -1 : 1
  stops[(index + step + stops.length) % stops.length]?.focus()
}

function onDesktopChange(): void {
  tutorial.setDesktop(Boolean(desktopQuery?.matches))
}

function skip(): void {
  tutorial.dismiss()
}

watch(bubbleRef, (element) => {
  bubbleObserver?.disconnect()

  if (!element) {
    return
  }

  bubbleHeight.value = element.offsetHeight
  bubbleObserver = new ResizeObserver(() => {
    bubbleHeight.value = element.offsetHeight
  })
  bubbleObserver.observe(element)
})

watch(tutorial.settled, () => tutorial.evaluate())

watch(isRunning, (value) => {
  tutorialActive.value = value
}, { immediate: true })

// The last step finishes by arriving somewhere rather than by flipping a stored
// flag, so the finale is the only part of the tutorial that runs on a timer.
watch(allDone, (done) => {
  if (!done || !isRunning.value || celebrating.value) {
    return
  }

  tutorial.celebrate()
  finaleTimer = setTimeout(() => tutorial.dismiss(), FINALE_MS)
})

onMounted(() => {
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
  desktopQuery = window.matchMedia(tutorial.desktopQuery)
  desktopQuery.addEventListener("change", onDesktopChange)
  onDesktopChange()

  viewportWidth.value = window.innerWidth
  viewportHeight.value = window.innerHeight
  document.addEventListener("keydown", onKeydown, true)
  frame = requestAnimationFrame(track)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  clearTimeout(finaleTimer)
  document.removeEventListener("keydown", onKeydown, true)
  desktopQuery?.removeEventListener("change", onDesktopChange)
  bubbleObserver?.disconnect()
  setFocusTarget(null)
  tutorialActive.value = false
})
</script>

<template>
  <div v-if="isRunning" class="tutorial" :class="{ 'is-celebrating': celebrating }">
    <Transition name="tutorial-scrim">
      <div v-if="isBlocking" class="tutorial-scrim" :style="scrimStyle" aria-hidden="true" />
    </Transition>

    <Transition name="tutorial-ring">
      <div v-if="isBlocking && hasTarget" class="tutorial-ring" :style="ringStyle" aria-hidden="true">
        <span :key="stageKey" class="tutorial-ring-burst" />
        <span v-if="celebrating" class="tutorial-ring-halo" />
      </div>
    </Transition>

    <Transition name="tutorial-bubble" appear>
      <section
        v-if="isBlocking && hasTarget"
        ref="bubbleRef"
        class="tutorial-bubble"
        :style="bubbleStyle"
        role="region"
        aria-label="First-time setup"
      >
        <span class="tutorial-arrow" :style="arrowStyle" aria-hidden="true" />

        <header class="tutorial-head">
          <span class="tutorial-rail" aria-hidden="true">
            <span
              v-for="(step, index) in SETUP_STEPS"
              :key="step.id"
              class="tutorial-rail-slot"
              :class="{
                'is-done': celebrating || index < activeIndex,
                'is-active': !celebrating && index === activeIndex
              }"
            ><i /></span>
          </span>
          <span class="tutorial-step">{{ stepLabel }}</span>
        </header>

        <div class="tutorial-stage" :style="stageStyle">
          <Transition name="tutorial-swap" @enter="onStageEnter">
            <div :key="stageKey" class="tutorial-panel" aria-live="polite">
              <div class="tutorial-lede">
                <span class="tutorial-badge" aria-hidden="true">
                  <Check v-if="celebrating" :size="19" />
                  <component :is="stepIcon" v-else :size="19" />
                </span>
                <div class="tutorial-copy">
                  <h2 class="tutorial-title">
                    {{ celebrating ? "You're all set" : activeStep.title }}
                  </h2>
                  <p class="tutorial-text">
                    {{
                      celebrating
                        ? "Wallet, key and profile are ready. Your messages are waiting."
                        : activeStep.body
                    }}
                  </p>
                </div>
              </div>

              <p v-if="!celebrating" class="tutorial-cue">
                <ArrowLeft class="tutorial-cue-arrow" :size="15" aria-hidden="true" />
                <span class="tutorial-cue-label">{{ activeStep.cue }}</span>
              </p>
            </div>
          </Transition>
        </div>

        <footer v-if="!celebrating" class="tutorial-foot">
          <button ref="skipRef" class="tutorial-skip" type="button" @click="skip">
            Skip setup
          </button>
        </footer>
      </section>
    </Transition>

    <Transition name="tutorial-bar">
      <aside
        v-if="isReleased"
        class="tutorial-bar"
        :style="{ left: `${sidebarRight + 24}px` }"
        role="region"
        aria-label="First-time setup"
      >
        <span class="tutorial-bar-mark" aria-hidden="true">{{ activeIndex + 1 }}</span>
        <p class="tutorial-bar-copy">
          <strong>{{ activeStep.title }}</strong>
          <span>{{ activeStep.releaseNote }}</span>
        </p>
        <button class="tutorial-skip" type="button" @click="skip">Skip setup</button>
      </aside>
    </Transition>
  </div>
</template>

<style>
/* The spotlight lands on a live sidebar control, so this rule has to reach an
   element the tutorial does not own. Nothing else ever sets the class.
   The scrim's cut-out already leaves the control clear; this keeps it above the
   scrim regardless, for browsers that drop the clip-path. */
.rxm-tutorial-focus {
  position: relative;
  z-index: 45;
}

/* The spotlight ring is drawn around this exact control and is a far louder
   focus indicator than the app's outline, which would otherwise sit inside it
   as a second ring. */
.rxm-tutorial-focus:focus-visible {
  outline: none;
}

/* Registered so the light pool can glide with the spotlight instead of jumping
   between controls; where it is unsupported the gradient simply snaps. */
@property --tutorial-spot-x {
  syntax: "<length>";
  inherits: false;
  initial-value: 0px;
}

@property --tutorial-spot-y {
  syntax: "<length>";
  inherits: false;
  initial-value: 0px;
}
</style>

<style scoped>
/* Layering, from the app's own stack: notifications sit at 30 and the wallet
   picker at 50. The tutorial slots into the gap so the picker — which step one
   opens — still comes out on top of the scrim. */
.tutorial {
  --tut-travel: 540ms cubic-bezier(0.3, 1.05, 0.35, 1);
  --tut-accent-ink: color-mix(in srgb, var(--color-primary) 58%, var(--color-gray-900));
  --tut-tint: color-mix(in srgb, var(--color-primary) 12%, var(--color-white));
}

/* --- The blocked screen ------------------------------------------------- */

/* Not a flat dim: the light pools around whatever the tutorial is pointing at
   and falls away from there, so the cut-out reads as lit rather than as merely
   uncovered. Both the pool and the hole travel on the same curve as the ring. */
.tutorial-scrim {
  position: fixed;
  inset: 0;
  z-index: 44;
  background: radial-gradient(
    460px 460px at var(--tutorial-spot-x) var(--tutorial-spot-y),
    color-mix(in srgb, var(--color-gray-900) 30%, transparent) 0%,
    color-mix(in srgb, var(--color-gray-900) 62%, transparent) 58%,
    color-mix(in srgb, var(--color-gray-900) 72%, transparent) 100%
  );
  backdrop-filter: blur(2.5px);
  transition:
    --tutorial-spot-x var(--tut-travel),
    --tutorial-spot-y var(--tut-travel),
    clip-path var(--tut-travel);
}

.tutorial-scrim-enter-active {
  transition: opacity 320ms ease;
}

.tutorial-scrim-leave-active {
  transition: opacity 460ms ease;
}

.tutorial-scrim-enter-from,
.tutorial-scrim-leave-to {
  opacity: 0;
}

/* --- The spotlight ------------------------------------------------------ */

.tutorial-ring {
  position: fixed;
  z-index: 46;
  border-radius: 11px;
  pointer-events: none;
  box-shadow:
    0 0 0 2px var(--color-primary),
    0 0 0 7px color-mix(in srgb, var(--color-primary) 20%, transparent),
    0 14px 38px -6px color-mix(in srgb, var(--color-primary) 45%, transparent);
  transition:
    top var(--tut-travel),
    left var(--tut-travel),
    width var(--tut-travel),
    height var(--tut-travel),
    box-shadow 420ms ease;
}

/* A slow sonar ping outward — the only thing on screen still moving once the
   bubble has settled, which is what keeps the eye on the control to click. */
.tutorial-ring::after {
  content: "";
  position: absolute;
  inset: -3px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 60%, transparent);
  animation: tutorial-ping 2600ms ease-out infinite;
}

/* Replayed on every step change: the spotlight lets go of the control it just
   finished with as it sets off for the next one. */
.tutorial-ring-burst {
  position: absolute;
  inset: -2px;
  border-radius: 13px;
  border: 2px solid var(--color-primary);
  opacity: 0;
  animation: tutorial-burst 760ms cubic-bezier(0.22, 1, 0.36, 1);
}

.tutorial-ring-halo {
  position: absolute;
  inset: -2px;
  border-radius: 13px;
  border: 2px solid var(--status-success);
  animation: tutorial-burst 1100ms cubic-bezier(0.22, 1, 0.36, 1) 160ms 2;
}

.tutorial.is-celebrating .tutorial-ring {
  box-shadow:
    0 0 0 2px var(--status-success),
    0 0 0 7px color-mix(in srgb, var(--status-success) 22%, transparent),
    0 14px 38px -6px color-mix(in srgb, var(--status-success) 45%, transparent);
}

.tutorial.is-celebrating .tutorial-ring::after {
  animation: none;
  opacity: 0;
}

.tutorial-ring-enter-active {
  transition: opacity 260ms ease, transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

.tutorial-ring-leave-active {
  transition: opacity 260ms ease, transform 260ms ease;
}

.tutorial-ring-enter-from {
  opacity: 0;
  transform: scale(1.16);
}

.tutorial-ring-leave-to {
  opacity: 0;
  transform: scale(1.08);
}

@keyframes tutorial-ping {
  0% {
    transform: scale(1);
    opacity: 0.65;
  }

  70%,
  100% {
    transform: scale(1.07);
    opacity: 0;
  }
}

@keyframes tutorial-burst {
  from {
    opacity: 0.85;
    transform: scale(1);
  }

  to {
    opacity: 0;
    transform: scale(1.45);
  }
}

/* --- The bubble --------------------------------------------------------- */

.tutorial-bubble {
  position: fixed;
  z-index: 47;
  width: 336px;
  padding: 18px 20px 16px;
  border-radius: 16px;
  border: 1px solid var(--border-default);
  background: var(--surface-card);
  box-shadow:
    0 28px 64px -20px rgba(12, 15, 22, 0.42),
    0 8px 22px -12px rgba(12, 15, 22, 0.3);
  /* Only the vertical travel is animated: the bubble holds its column beside the
     sidebar while the spotlight moves down it. */
  transition: top var(--tut-travel);
}

.tutorial-arrow {
  position: absolute;
  left: -7px;
  width: 13px;
  height: 13px;
  margin-top: -6.5px;
  background: var(--surface-card);
  border-left: 1px solid var(--border-default);
  border-bottom: 1px solid var(--border-default);
  border-bottom-left-radius: 3px;
  transform: rotate(45deg);
  transition: top var(--tut-travel);
}

.tutorial-bubble-enter-active {
  transition:
    opacity 360ms ease 130ms,
    transform 520ms cubic-bezier(0.22, 1, 0.36, 1) 130ms;
}

.tutorial-bubble-leave-active {
  transition: opacity 240ms ease, transform 240ms ease;
}

.tutorial-bubble-enter-from {
  opacity: 0;
  transform: translateX(-16px) scale(0.97);
}

.tutorial-bubble-leave-to {
  opacity: 0;
  transform: translateX(-8px) scale(0.98);
}

/* --- Header: progress rail + counter ------------------------------------ */

.tutorial-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.tutorial-rail {
  display: flex;
  gap: 4px;
}

.tutorial-rail-slot {
  width: 20px;
  height: 4px;
  border-radius: 999px;
  background: var(--color-gray-200);
  overflow: hidden;
}

.tutorial-rail-slot i {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
}

.tutorial-rail-slot.is-done i {
  transform: scaleX(1);
}

.tutorial-rail-slot.is-active i {
  transform: scaleX(1);
  opacity: 0.34;
  animation: tutorial-rail-pulse 1900ms ease-in-out infinite;
}

.tutorial.is-celebrating .tutorial-rail-slot i {
  background: var(--status-success);
}

@keyframes tutorial-rail-pulse {
  0%,
  100% {
    opacity: 0.22;
  }

  50% {
    opacity: 0.6;
  }
}

.tutorial-step {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

/* --- Body: the panel that swaps between steps --------------------------- */

/* Height is driven from the incoming panel's measured height so the bubble
   grows into its next size instead of snapping while the copy crossfades. The
   bubble is also gliding to its next position at the same moment, and a height
   that jumped mid-glide reads as broken.
   Animating height does cost a layout pass per frame, and the usual escapes do
   not apply: grid-template-rows only interpolates 0fr to 1fr, not one content
   height to another, and a scaleY would stretch the type. Containment is the
   answer instead — the panel inside is already sized by its own content and
   clipped, so nothing within the stage needs re-laying-out as the box resizes,
   and the work stays off the rest of the page. Three transitions of 380ms in
   the tutorial's whole life. */
.tutorial-stage {
  position: relative;
  overflow: hidden;
  contain: layout paint;
  transition: height 380ms cubic-bezier(0.4, 0, 0.2, 1);
}

.tutorial-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.tutorial-swap-enter-active {
  transition:
    opacity 280ms ease 90ms,
    transform 420ms cubic-bezier(0.22, 1, 0.36, 1) 90ms;
}

/* Taken out of flow on the way out, so the arriving panel alone sets the height
   the stage animates to. */
.tutorial-swap-leave-active {
  position: absolute;
  inset: 0;
  transition: opacity 150ms ease, transform 260ms ease;
}

.tutorial-swap-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

.tutorial-swap-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.tutorial-lede {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.tutorial-badge {
  display: grid;
  place-items: center;
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: var(--tut-tint);
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  color: var(--tut-accent-ink);
}

.tutorial.is-celebrating .tutorial-badge {
  background: color-mix(in srgb, var(--status-success) 12%, var(--color-white));
  border-color: color-mix(in srgb, var(--status-success) 34%, transparent);
  color: var(--status-success);
}

.tutorial-copy {
  min-width: 0;
}

.tutorial-title {
  margin: 1px 0 5px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.011em;
  line-height: 1.25;
  color: var(--text-primary);
}

.tutorial-text {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--text-secondary);
}

/* Names the control by the exact label it wears in the sidebar, so there is
   never a guess about which highlighted thing to click. */
.tutorial-cue {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--tut-tint);
  border: 1px solid color-mix(in srgb, var(--color-primary) 26%, transparent);
  font-size: 13px;
  font-weight: 600;
  color: var(--tut-accent-ink);
}

.tutorial-cue-arrow {
  flex: 0 0 auto;
  animation: tutorial-nudge 1800ms ease-in-out infinite;
}

.tutorial-cue-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes tutorial-nudge {
  0%,
  100% {
    transform: translateX(0);
  }

  50% {
    transform: translateX(-4px);
  }
}

/* --- Footer ------------------------------------------------------------- */

.tutorial-foot {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border-default);
}

.tutorial-skip {
  padding: 4px 2px;
  border: 0;
  background: none;
  font-size: 12.5px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  transition: color 160ms ease;
}

.tutorial-skip:hover,
.tutorial-skip:focus-visible {
  color: var(--text-primary);
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* --- The released bar --------------------------------------------------- */

/* Step three sends people to the profile form, which the scrim would then stop
   them filling in. The tutorial steps back for as long as they are on it and
   keeps only this reminder, out of the way in the corner the notifications
   leave free. */
.tutorial-bar {
  position: fixed;
  bottom: 24px;
  z-index: 47;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 460px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--border-default);
  background: var(--surface-card);
  box-shadow: 0 18px 40px -18px rgba(12, 15, 22, 0.38);
}

.tutorial-bar-mark {
  display: grid;
  place-items: center;
  flex: 0 0 26px;
  width: 26px;
  height: 26px;
  border-radius: 9px;
  background: var(--tut-tint);
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  font-size: 12px;
  font-weight: 700;
  color: var(--tut-accent-ink);
}

.tutorial-bar-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  min-width: 0;
}

.tutorial-bar-copy strong {
  font-size: 13px;
  line-height: 1.3;
}

.tutorial-bar-copy span {
  font-size: 12.5px;
  line-height: 1.35;
  color: var(--text-secondary);
}

.tutorial-bar .tutorial-skip {
  margin-left: auto;
  flex: 0 0 auto;
  white-space: nowrap;
}

.tutorial-bar-enter-active {
  transition: opacity 300ms ease, transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

.tutorial-bar-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}

.tutorial-bar-enter-from,
.tutorial-bar-leave-to {
  opacity: 0;
  transform: translateY(14px);
}

/* --- Reduced motion ----------------------------------------------------- */

/* Everything still appears and still moves to the right place; nothing slides,
   pulses or breathes on the way. */
@media (prefers-reduced-motion: reduce) {
  .tutorial-ring,
  .tutorial-bubble,
  .tutorial-arrow,
  .tutorial-stage,
  .tutorial-rail-slot i {
    transition-duration: 1ms;
  }

  /* Keeps the cut-out and the light pool in step with the ring above. */
  .tutorial-scrim {
    transition: none;
  }

  .tutorial-ring::after,
  .tutorial-ring-burst,
  .tutorial-ring-halo,
  .tutorial-rail-slot.is-active i,
  .tutorial-cue-arrow {
    animation: none;
  }

  .tutorial-ring-burst,
  .tutorial-ring-halo {
    display: none;
  }

  .tutorial-bubble-enter-active,
  .tutorial-bubble-leave-active,
  .tutorial-bar-enter-active,
  .tutorial-bar-leave-active,
  .tutorial-swap-enter-active,
  .tutorial-swap-leave-active,
  .tutorial-scrim-enter-active,
  .tutorial-scrim-leave-active,
  .tutorial-ring-enter-active,
  .tutorial-ring-leave-active {
    transition: opacity 140ms ease;
  }

  .tutorial-bubble-enter-from,
  .tutorial-bubble-leave-to,
  .tutorial-bar-enter-from,
  .tutorial-bar-leave-to,
  .tutorial-swap-enter-from,
  .tutorial-swap-leave-to,
  .tutorial-ring-enter-from,
  .tutorial-ring-leave-to {
    transform: none;
  }
}
</style>
