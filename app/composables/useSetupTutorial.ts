import { computed, ref, watch } from "vue"
import { useRoute } from "vue-router"
import { useProfileStatus } from "./useProfileStatus"
import { useWallet } from "./useWallet"
import { useSettingsStore } from "../stores/settings"

/** Versioned: bump it and everyone sees the tutorial again, which is what you
 *  want if the steps themselves ever change. */
const STORAGE_KEY = "rxm.setupTutorial.v1"
const STORAGE_VALUE = "done"

/** Where step 4 lands. Reaching it is what completes the tutorial. */
const CHAT_ROUTE = "/messages/my-buckets"

/** The coach marks point at sidebar controls, so they need a real sidebar to
 *  point at. Below 961px it collapses into a topbar, and this threshold keeps a
 *  comfortable margin above that plus room for the bubble beside it. */
const DESKTOP_QUERY = "(min-width: 1024px)"

export type SetupStepId = "wallet" | "key" | "profile" | "chat"

export type SetupStep = {
  id: SetupStepId
  /** `data-tutorial-target` of the sidebar control this step points at. */
  target: string
  title: string
  body: string
  /** The control's own label, echoed in the bubble so the click is unambiguous. */
  cue: string
  /** Route prefixes where the step's real work happens. The scrim lifts while
   *  the user is on one of them — otherwise the step would send them to a page
   *  it then blocks them from using — and closes again the moment they leave. */
  worksOn?: string[]
  /** Shown in the compact bar while the scrim is lifted. */
  releaseNote?: string
}

export const SETUP_STEPS: SetupStep[] = [
  {
    id: "wallet",
    target: "wallet",
    title: "Connect a wallet",
    body: "Your wallet signs everything you send, and its address is how people reach you. Nothing else works until it's connected.",
    cue: "Connect Wallet"
  },
  {
    id: "key",
    target: "x25519",
    title: "Create an encryption key",
    body: "This key is what unlocks messages sent to you. Generating it downloads the only copy — keep that file somewhere safe.",
    cue: "Generate"
  },
  {
    id: "profile",
    target: "profile",
    title: "Create a profile",
    body: "A profile is how people recognise you instead of a wallet address, and it's what makes you findable.",
    cue: "Profile",
    worksOn: ["/profile"],
    releaseNote: "Fill in your profile and save it to continue."
  },
  {
    id: "chat",
    target: "messages",
    title: "Start chatting",
    body: "Setup is done. Open your messages to join a conversation or create your first bucket.",
    cue: "Messages"
  }
]

/**
 * True from the moment the tutorial takes over until it is done with. Read by
 * the app shell, which drops the account-setup banners for the duration: they
 * prompt for the same things the tutorial is already walking the user through,
 * and stacking both leaves three separate calls to action on the profile page.
 * A module-level ref rather than a return value: the shell only reads it, and
 * the tutorial component is the single writer.
 */
export const tutorialActive = ref(false)

function loadDismissed(): boolean {
  if (!import.meta.client) {
    return true
  }

  try {
    return window.localStorage.getItem(STORAGE_KEY) === STORAGE_VALUE
  } catch {
    // A blocked storage means we cannot remember a dismissal, and a tutorial
    // that reappears on every load is worse than one that never runs.
    return true
  }
}

function persistDismissed(): void {
  if (!import.meta.client) {
    return
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, STORAGE_VALUE)
  } catch {
    // Non-fatal: the tutorial still ends for this session.
  }
}

/**
 * First-run setup tutorial: four ordered steps, each finished by a real change
 * in app state rather than by a "next" button, so the tutorial can never claim
 * progress the user has not actually made.
 *
 * Call once, from the tutorial component.
 */
export function useSetupTutorial() {
  const route = useRoute()
  const wallet = useWallet()
  const settings = useSettingsStore()
  const profileStatus = useProfileStatus()

  const dismissed = ref(loadDismissed())
  const started = ref(false)
  const celebrating = ref(false)
  const isDesktop = ref(false)

  // Owns its own profile lookup rather than relying on the setup banners to
  // have run one: the shell hides those for as long as the tutorial is up, and
  // step one hands over a wallet whose profile nobody has asked about yet. The
  // store collapses a repeat request for an address it already has in flight.
  watch(() => wallet.accountAddress.value, () => profileStatus.refresh(), { immediate: true })

  const completed = computed(() => [
    wallet.walletStatus.value === "connected" && Boolean(wallet.accountAddress.value),
    Boolean(settings.x25519SecretJwk),
    profileStatus.hasAccount.value,
    route.path === CHAT_ROUTE
  ])

  /**
   * The wallet session is restored synchronously from storage, but the profile
   * lookup is a round trip. Judging before it lands would flash "create a
   * profile" at people who set one up months ago, so wait for the answer.
   * A failed lookup never settles, and the tutorial simply stays away.
   */
  const settled = computed(
    () => !wallet.accountAddress.value || profileStatus.status.value === "ready"
  )

  const activeIndex = computed(() => {
    const index = completed.value.findIndex((done) => !done)
    return index === -1 ? SETUP_STEPS.length - 1 : index
  })

  const activeStep = computed(() => SETUP_STEPS[activeIndex.value]!)
  const allDone = computed(() => completed.value.every(Boolean))

  const isRunning = computed(() => started.value && !dismissed.value && isDesktop.value)

  /** Lifted while the user is on the page a step sends them to. */
  const isReleased = computed(() => {
    if (celebrating.value) {
      return false
    }

    const prefixes = activeStep.value.worksOn
    return Boolean(prefixes?.some((prefix) => route.path.startsWith(prefix)))
  })

  const isBlocking = computed(() => isRunning.value && !isReleased.value)

  /**
   * Starts the tutorial, but only for someone who genuinely still has setting up
   * to do. The final step is a navigation rather than a stored fact, so it is
   * deliberately not part of this test: a fully set-up account that simply has
   * not opened its messages this session is finished, not new.
   */
  function evaluate(): void {
    if (dismissed.value || started.value || !isDesktop.value || !settled.value) {
      return
    }

    const hasSetupLeft = completed.value.slice(0, 3).some((done) => !done)

    if (hasSetupLeft) {
      started.value = true
      return
    }

    // Nothing to teach — retire the tutorial rather than lie in wait for the
    // next time this account looks incomplete for a moment.
    dismissed.value = true
    persistDismissed()
  }

  function setDesktop(value: boolean): void {
    isDesktop.value = value
    evaluate()
  }

  /** Ends the tutorial for good. Used by both the skip button and the finale. */
  function dismiss(): void {
    celebrating.value = false
    dismissed.value = true
    persistDismissed()
  }

  function celebrate(): void {
    celebrating.value = true
  }

  return {
    activeIndex,
    activeStep,
    allDone,
    celebrating: computed(() => celebrating.value),
    isBlocking,
    isReleased,
    isRunning,
    settled,
    celebrate,
    dismiss,
    evaluate,
    setDesktop,
    desktopQuery: DESKTOP_QUERY
  }
}
