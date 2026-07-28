# Unified Submit-State UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every page where the user submits information one consistent submit button that reports the true stage of the operation (idle → signing → submitting → success/error), and remove user-visible copy implying blockchain persistence.

**Architecture:** A `useSubmitState()` composable owns the phase machine. A pure `resolveSubmitButtonView()` function maps a phase plus five labels onto a label/icon/variant/disabled view, and a thin `SubmitButton.vue` renders it. `BucketsRepository.runMutation` wraps its signer so the `signing → submitting` transition fires at the real wallet/network boundary; `profile/edit.vue` wraps `wallet.signProfileRequest` locally to get the same transition.

**Tech Stack:** Nuxt 4, Vue 3 `<script setup>`, TypeScript, Pinia, vitest 4 (node environment), lucide-vue-next icons.

**Spec:** `docs/superpowers/specs/2026-07-28-unified-submit-state-design.md`

## Global Constraints

- **`Signing…` is identical on every button.** It is the same wallet-popup moment regardless of operation. Use the ellipsis character `…`, not three periods.
- **Success is held, not auto-cleared.** It returns to idle only when the user edits a field. The one exception is `profile/edit.vue`, which redirects — see Task 8.
- **Error stays clickable.** The button is the retry affordance. The detailed message renders below the form as it does today.
- **The `signing` stage must never reach `operations.add()`.** That store pushes a notification per entry (`app/stores/operations.ts:14`); logging signing would add a popup per submit. All **seven** `logOperationUpdate` functions return early on `signing` — including the two on the chat pages, whose buttons are otherwise out of scope. Task 3 Step 7 does this in one pass.
- **Loggers drive phases; pages log outcomes.** *(Added after Task 4 review — supersedes the stage-logging in Tasks 4-7's original snippets, and is implemented for every page by Task 11.)* A `logOperationUpdate` must not call `operations.add()` at all. Each page logs exactly one terminal entry per submit — success or failure — in its own plain language. This is what makes one submit produce one notification instead of three.
- **No user-visible notification may name a GraphQL mutation.** For `bucket_write`, `operations.add()` uses `targetRef` as the notification title (`app/stores/operations.ts:16`), so passing `result.method` or `currentBucketCall.value` puts `createNamespace` / `rotateKey+write` in front of the user. Pass a human label. This is the same transaction-receipt wording the in-page copy changes remove.
- **Never wire `applyUpdate` into a shared logger.** Three pages route several different operations through one `logOperationUpdate`; feeding the phase machine from there would let an unrelated operation drive a button. Those pages get a dedicated wrapper instead.
- **No new dependencies.** vitest runs in the `node` environment and the repo has no `@vue/test-utils` or DOM shim. All new logic that needs testing lives in plain `.ts` modules; `.vue` files stay thin enough not to need component tests.
- **No user-visible string may reference a blockchain**, chain, on-chain storage, transactions, extrinsics, or block numbers. Code comments are exempt.
- Existing indentation is 2 spaces, double-quoted strings, no semicolons at statement ends in `.ts`/`.vue` script blocks. Match it.

---

### Task 1: Submit phase machine

**Files:**
- Create: `app/composables/useSubmitState.ts`
- Test: `tests/unit/useSubmitState.spec.ts`

**Interfaces:**
- Consumes: `OperationUpdate` from `app/services/buckets/types.ts` (still `"pending" | "success" | "error"` at this point — Task 3 widens it; the composable only matches on `"signing"` and `"submitting"`, so it compiles against both shapes).
- Produces: `useSubmitState()` returning `{ phase, errorMessage, isBusy, markSigning, markSubmitting, applyUpdate, fail, reset, run }`, and the exported type `SubmitPhase = "idle" | "signing" | "submitting" | "success" | "error"`. Tasks 2 and 4-9 depend on these exact names.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useSubmitState.spec.ts`:

```ts
// tests/unit/useSubmitState.spec.ts
import { describe, expect, it } from "vitest"
import { useSubmitState } from "../../app/composables/useSubmitState"

describe("useSubmitState", () => {
  it("starts idle and not busy", () => {
    const state = useSubmitState()
    expect(state.phase.value).toBe("idle")
    expect(state.errorMessage.value).toBe("")
    expect(state.isBusy.value).toBe(false)
  })

  it("run() opens on signing and lands on success", async () => {
    const state = useSubmitState()
    const seen: string[] = []

    const result = await state.run(async () => {
      seen.push(state.phase.value)
      return "done"
    })

    expect(seen).toEqual(["signing"])
    expect(result).toBe("done")
    expect(state.phase.value).toBe("success")
    expect(state.isBusy.value).toBe(false)
  })

  it("run() records the rejection message and does not rethrow", async () => {
    const state = useSubmitState()

    const result = await state.run(async () => {
      throw new Error("nickname taken")
    })

    expect(result).toBeUndefined()
    expect(state.phase.value).toBe("error")
    expect(state.errorMessage.value).toBe("nickname taken")
  })

  it("run() falls back to a generic message for non-Error rejections", async () => {
    const state = useSubmitState()
    await state.run(async () => {
      throw "boom"
    })
    expect(state.errorMessage.value).toBe("Something went wrong")
  })

  it("run() clears a previous error message when it starts", async () => {
    const state = useSubmitState()
    await state.run(async () => {
      throw new Error("first")
    })
    expect(state.errorMessage.value).toBe("first")

    await state.run(async () => "ok")
    expect(state.errorMessage.value).toBe("")
    expect(state.phase.value).toBe("success")
  })

  it("applyUpdate maps repository stages onto in-flight phases", () => {
    const state = useSubmitState()

    state.applyUpdate({ stage: "signing", message: "" })
    expect(state.phase.value).toBe("signing")
    expect(state.isBusy.value).toBe(true)

    state.applyUpdate({ stage: "submitting", message: "" })
    expect(state.phase.value).toBe("submitting")
    expect(state.isBusy.value).toBe(true)
  })

  it("applyUpdate ignores terminal stages so run() stays the only authority", () => {
    const state = useSubmitState()
    state.applyUpdate({ stage: "submitting", message: "" })

    state.applyUpdate({ stage: "success", message: "" })
    expect(state.phase.value).toBe("submitting")

    state.applyUpdate({ stage: "error", message: "" })
    expect(state.phase.value).toBe("submitting")
  })

  it("fail() reports a pre-flight validation failure without running a task", () => {
    const state = useSubmitState()
    state.fail("Namespace name is required")
    expect(state.phase.value).toBe("error")
    expect(state.errorMessage.value).toBe("Namespace name is required")
  })

  it("reset() returns to idle from every terminal phase", async () => {
    const state = useSubmitState()

    await state.run(async () => "ok")
    state.reset()
    expect(state.phase.value).toBe("idle")

    state.fail("nope")
    state.reset()
    expect(state.phase.value).toBe("idle")
    expect(state.errorMessage.value).toBe("")
  })

  it("markSigning and markSubmitting drive the phase directly", () => {
    const state = useSubmitState()
    state.markSigning()
    expect(state.phase.value).toBe("signing")
    state.markSubmitting()
    expect(state.phase.value).toBe("submitting")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/useSubmitState.spec.ts`
Expected: FAIL — `Failed to resolve import "../../app/composables/useSubmitState"`.

- [ ] **Step 3: Write the implementation**

Create `app/composables/useSubmitState.ts`:

```ts
import { computed, ref, type ComputedRef, type Ref } from "vue"
import type { OperationUpdate } from "../services/buckets/types"

export type SubmitPhase = "idle" | "signing" | "submitting" | "success" | "error"

export interface SubmitState {
  phase: Ref<SubmitPhase>
  errorMessage: Ref<string>
  isBusy: ComputedRef<boolean>
  markSigning: () => void
  markSubmitting: () => void
  applyUpdate: (update: OperationUpdate) => void
  fail: (message: string) => void
  reset: () => void
  run: <T>(task: () => Promise<T>) => Promise<T | undefined>
}

/**
 * Phase machine shared by every page that submits user-entered data.
 *
 * Validation deliberately sits outside the machine: pages that check something
 * asynchronously before submitting (profile nickname availability) surface that
 * through their own field-level text, and folding it in here would make the
 * button report a stage the operation is not actually in.
 */
export function useSubmitState(): SubmitState {
  const phase = ref<SubmitPhase>("idle")
  const errorMessage = ref("")
  const isBusy = computed(() => phase.value === "signing" || phase.value === "submitting")

  function markSigning(): void {
    phase.value = "signing"
  }

  function markSubmitting(): void {
    phase.value = "submitting"
  }

  /** Only the in-flight stages come from the caller — run() owns the outcome,
   *  because it is the only thing that sees the resolved value or the throw. */
  function applyUpdate(update: OperationUpdate): void {
    if (update.stage === "signing") markSigning()
    else if (update.stage === "submitting") markSubmitting()
  }

  function fail(message: string): void {
    errorMessage.value = message
    phase.value = "error"
  }

  function reset(): void {
    phase.value = "idle"
    errorMessage.value = ""
  }

  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    // Signing is always the first thing that happens on every path in scope.
    errorMessage.value = ""
    phase.value = "signing"
    try {
      const result = await task()
      phase.value = "success"
      return result
    } catch (error) {
      fail(error instanceof Error ? error.message : "Something went wrong")
      return undefined
    }
  }

  return { phase, errorMessage, isBusy, markSigning, markSubmitting, applyUpdate, fail, reset, run }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/useSubmitState.spec.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add app/composables/useSubmitState.ts tests/unit/useSubmitState.spec.ts
git commit -m "feat: add useSubmitState phase machine for submit buttons"
```

---

### Task 2: SubmitButton presentation

**Files:**
- Create: `app/components/common/submitButtonView.ts`
- Create: `app/components/common/SubmitButton.vue`
- Test: `tests/unit/submitButtonView.spec.ts`

**Interfaces:**
- Consumes: `SubmitPhase` from `app/composables/useSubmitState.ts` (Task 1).
- Produces: `SubmitButtonLabels` (`{ idle, signing, submitting, success, error }` — all required strings) and `resolveSubmitButtonView(phase, labels, disabled)` returning `{ label, icon, variant, disabled }`. `SubmitButton.vue` takes props `phase`, `labels`, `disabled?`, `type?` and emits `click`. Tasks 4-9 use the component.

The mapping lives in a plain `.ts` module because vitest runs in the `node` environment with no DOM shim — this keeps it testable without adding `@vue/test-utils`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/submitButtonView.spec.ts`:

```ts
// tests/unit/submitButtonView.spec.ts
import { describe, expect, it } from "vitest"
import { resolveSubmitButtonView, type SubmitButtonLabels } from "../../app/components/common/submitButtonView"

const labels: SubmitButtonLabels = {
  idle: "Create namespace",
  signing: "Signing…",
  submitting: "Creating namespace…",
  success: "Namespace created",
  error: "Create failed — retry"
}

describe("resolveSubmitButtonView", () => {
  it("shows the idle label, no icon, and follows the disabled prop", () => {
    expect(resolveSubmitButtonView("idle", labels, false)).toEqual({
      label: "Create namespace", icon: "none", variant: "primary", disabled: false
    })
    expect(resolveSubmitButtonView("idle", labels, true).disabled).toBe(true)
  })

  it("spins and locks while signing", () => {
    expect(resolveSubmitButtonView("signing", labels, false)).toEqual({
      label: "Signing…", icon: "spinner", variant: "primary", disabled: true
    })
  })

  it("spins and locks while submitting", () => {
    expect(resolveSubmitButtonView("submitting", labels, false)).toEqual({
      label: "Creating namespace…", icon: "spinner", variant: "primary", disabled: true
    })
  })

  it("locks on success regardless of the disabled prop", () => {
    expect(resolveSubmitButtonView("success", labels, false)).toEqual({
      label: "Namespace created", icon: "check", variant: "success", disabled: true
    })
  })

  it("stays clickable on error so the button is the retry affordance", () => {
    expect(resolveSubmitButtonView("error", labels, false)).toEqual({
      label: "Create failed — retry", icon: "retry", variant: "error", disabled: false
    })
  })

  it("still honours the disabled prop on error", () => {
    expect(resolveSubmitButtonView("error", labels, true).disabled).toBe(true)
  })

  it("locks while busy even when the disabled prop is false", () => {
    expect(resolveSubmitButtonView("signing", labels, false).disabled).toBe(true)
    expect(resolveSubmitButtonView("submitting", labels, false).disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/submitButtonView.spec.ts`
Expected: FAIL — `Failed to resolve import ".../submitButtonView"`.

- [ ] **Step 3: Write the mapping**

Create `app/components/common/submitButtonView.ts`:

```ts
import type { SubmitPhase } from "../../composables/useSubmitState"

export interface SubmitButtonLabels {
  idle: string
  signing: string
  submitting: string
  success: string
  error: string
}

export type SubmitButtonIcon = "none" | "spinner" | "check" | "retry"
export type SubmitButtonVariant = "primary" | "success" | "error"

export interface SubmitButtonView {
  label: string
  icon: SubmitButtonIcon
  variant: SubmitButtonVariant
  disabled: boolean
}

/** `disabled` is the page's own gating (invalid form, missing permission). The
 *  in-flight and success phases lock the button on top of it; the error phase
 *  does not, so the button itself is the retry affordance. */
export function resolveSubmitButtonView(
  phase: SubmitPhase,
  labels: SubmitButtonLabels,
  disabled: boolean
): SubmitButtonView {
  switch (phase) {
    case "signing":
      return { label: labels.signing, icon: "spinner", variant: "primary", disabled: true }
    case "submitting":
      return { label: labels.submitting, icon: "spinner", variant: "primary", disabled: true }
    case "success":
      return { label: labels.success, icon: "check", variant: "success", disabled: true }
    case "error":
      return { label: labels.error, icon: "retry", variant: "error", disabled }
    default:
      return { label: labels.idle, icon: "none", variant: "primary", disabled }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/submitButtonView.spec.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Write the component**

Create `app/components/common/SubmitButton.vue`. The spinner CSS is lifted from `app/pages/indexed-bucket/[id]/index.vue:1714-1727` so every button shares one definition:

```vue
<script setup lang="ts">
import { computed } from "vue"
import { Check, RotateCw } from "lucide-vue-next"
import type { SubmitPhase } from "../../composables/useSubmitState"
import { resolveSubmitButtonView, type SubmitButtonLabels } from "./submitButtonView"

const props = withDefaults(
  defineProps<{
    phase: SubmitPhase
    labels: SubmitButtonLabels
    disabled?: boolean
    type?: "button" | "submit"
  }>(),
  { disabled: false, type: "button" }
)

const emit = defineEmits<{ click: [] }>()

const view = computed(() => resolveSubmitButtonView(props.phase, props.labels, props.disabled))
const busy = computed(() => props.phase === "signing" || props.phase === "submitting")
</script>

<template>
  <button
    class="btn btn-primary submit-button"
    :class="`submit-button-${view.variant}`"
    :type="props.type"
    :disabled="view.disabled"
    :aria-busy="busy"
    @click="emit('click')"
  >
    <span v-if="view.icon === 'spinner'" class="submit-button-spinner" aria-hidden="true" />
    <Check v-else-if="view.icon === 'check'" :size="16" aria-hidden="true" />
    <RotateCw v-else-if="view.icon === 'retry'" :size="16" aria-hidden="true" />
    <slot v-else name="icon" />
    <span aria-live="polite">{{ view.label }}</span>
  </button>
</template>

<style scoped>
.submit-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  white-space: nowrap;
}

.submit-button-success:disabled,
.submit-button-success {
  background: var(--status-success);
  border-color: var(--status-success);
  color: var(--color-white);
  opacity: 1;
}

.submit-button-error {
  background: var(--status-error);
  border-color: var(--status-error);
  color: var(--color-white);
}

.submit-button-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--color-white) 40%, transparent);
  border-top-color: var(--color-white);
  animation: submit-button-spin 700ms linear infinite;
}

@keyframes submit-button-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
```

The `.submit-button-success` rule repeats itself under `:disabled` because `.btn:disabled` (`app/assets/styles/globals.css:117`) dims disabled buttons, and the success state must stay legibly green.

- [ ] **Step 6: Verify the component compiles**

Run: `npm run typecheck`
Expected: PASS, no errors mentioning `SubmitButton.vue`.

- [ ] **Step 7: Commit**

```bash
git add app/components/common/submitButtonView.ts app/components/common/SubmitButton.vue tests/unit/submitButtonView.spec.ts
git commit -m "feat: add SubmitButton with phase-driven presentation"
```

---

### Task 3: Emit a real signing stage from the repository

**Files:**
- Modify: `app/services/buckets/types.ts:28`
- Modify: `app/services/buckets/bucketsRepository.ts:371-392`
- Test: `tests/unit/bucketsRepository.mutations.spec.ts:37,44,73,79,120`

**Interfaces:**
- Produces: `OperationUpdate.stage` becomes `"signing" | "submitting" | "success" | "error"`. Tasks 4-9 rely on the `signing` stage arriving before the wallet popup resolves and `submitting` after.

`"pending"` is removed rather than kept alongside the new stages: after this change nothing emits it, and leaving it in the union would let a caller construct a stage the UI has no mapping for.

- [ ] **Step 1: Update the existing tests to the new stage sequence**

In `tests/unit/bucketsRepository.mutations.spec.ts`, the test helper's `sign` always resolves, so every mutation now reports `signing` then `submitting` before its outcome. Make these five edits:

Line 37: `expect(updates.map((u) => u.stage)).toEqual(["pending", "success"])`
→ `expect(updates.map((u) => u.stage)).toEqual(["signing", "submitting", "success"])`

Line 44: `expect(updates.map((u) => u.stage)).toEqual(["pending", "error"])`
→ `expect(updates.map((u) => u.stage)).toEqual(["signing", "submitting", "error"])`

Line 73 (the test name): `it("removeBucketAdmin rejects and emits pending→error when the API returns false", async () => {`
→ `it("removeBucketAdmin rejects and emits signing→submitting→error when the API returns false", async () => {`

Line 79: `expect(updates.map((u) => u.stage)).toEqual(["pending", "error"])`
→ `expect(updates.map((u) => u.stage)).toEqual(["signing", "submitting", "error"])`

Line 120: `expect(updates.map((u) => u.stage)).toEqual(["pending", "error"])`
→ `expect(updates.map((u) => u.stage)).toEqual(["signing", "submitting", "error"])`

- [ ] **Step 2: Add a test proving signing precedes the signature and submitting follows it**

Append to the `describe("createNamespace", ...)` block in the same file:

```ts
  it("emits signing before the signature resolves and submitting after", async () => {
    const order: string[] = []
    let releaseSignature: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      releaseSignature = resolve
    })

    const repo = new BucketsRepository({
      apiUrl: "https://profile-api.example",
      sign: async (address) => {
        order.push("sign-start")
        await held
        order.push("sign-end")
        return { "X-SS58-Address": address, "X-Signature": "0xsig", "X-Timestamp": "t" }
      },
      fetcher: async () => {
        order.push("fetch")
        return new Response(JSON.stringify({ data: { createNamespace: { id: "4", namespaceId: "4" } } }), { status: 200 })
      }
    })

    const updates: OperationUpdate[] = []
    const pending = repo.createNamespace("my ns", "5OWNER", (u) => {
      order.push(`stage:${u.stage}`)
      updates.push(u)
    })

    // The signing update must already be out while the wallet is still open.
    await Promise.resolve()
    expect(updates.map((u) => u.stage)).toEqual(["signing"])

    releaseSignature()
    await pending

    expect(order).toEqual([
      "stage:signing", "sign-start", "sign-end", "stage:submitting", "fetch", "stage:success"
    ])
  })

  it("emits signing then error and never submitting when the signature is rejected", async () => {
    const repo = new BucketsRepository({
      apiUrl: "https://profile-api.example",
      sign: async () => {
        throw new Error("User rejected the signature")
      },
      fetcher: async () => new Response("{}", { status: 200 })
    })

    const updates: OperationUpdate[] = []
    await expect(repo.createNamespace("x", "5OWNER", (u) => updates.push(u))).rejects.toThrow(
      "User rejected the signature"
    )
    expect(updates.map((u) => u.stage)).toEqual(["signing", "error"])
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/bucketsRepository.mutations.spec.ts`
Expected: FAIL — the updated assertions report `["pending", …]` received, and the new ordering test fails because no `submitting` stage exists.

- [ ] **Step 4: Widen the stage union**

In `app/services/buckets/types.ts`, replace line 28:

```ts
export interface OperationUpdate { stage: "pending" | "success" | "error"; message: string }
```

with:

```ts
export interface OperationUpdate { stage: "signing" | "submitting" | "success" | "error"; message: string }
```

- [ ] **Step 5: Wrap the signer in runMutation**

In `app/services/buckets/bucketsRepository.ts`, replace the body of `runMutation` (lines 379-392, from `const sign = …` through the closing brace) with:

```ts
    const sign = this.requireSign(ownerAddress)
    // The signature is a wallet popup and the request is a network round trip.
    // They are separate waits, so the UI gets separate stages: the boundary is
    // the moment `sign` resolves.
    onUpdate?.({ stage: "signing", message: `Waiting for signature to ${method}…` })
    const signWithProgress = async (rawBody: string): Promise<HeadersInit> => {
      const headers = await sign(rawBody)
      onUpdate?.({ stage: "submitting", message: `Submitting ${method}…` })
      return headers
    }
    try {
      const data = await this.client.mutate<T>(document, variables, signWithProgress)
      const id = extractId(data)
      onUpdate?.({ stage: "success", message: `${method} confirmed` })
      return { id, method }
    } catch (error) {
      const message = error instanceof Error ? error.message : `${method} failed`
      onUpdate?.({ stage: "error", message })
      throw error
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/bucketsRepository.mutations.spec.ts`
Expected: PASS.

- [ ] **Step 7: Stop every existing logger from reporting the new stage**

`operations.add()` pushes a notification per entry, so the new `signing` stage would add a popup to *every* signed operation in the app — including the chat message sends that are out of scope for the button work. Seven `logOperationUpdate` functions feed that store. Add this guard as the first line of each, immediately before its `operations.add(...)` call:

```ts
  // Signing drives the submit button only — logging it would add a notification
  // popup to every signed operation.
  if (update.stage === "signing") return
```

The seven sites:

| File | Function at line |
| --- | --- |
| `app/pages/messages/namespaces/new.vue` | 21 |
| `app/pages/messages/bucket/create/[namespaceId].vue` | 65 |
| `app/pages/messages/bucket/add-member/[id].vue` | 206 |
| `app/pages/messages/namespace/managers/[namespaceId].vue` | 35 |
| `app/pages/messages/bucket/[id]/index.vue` | 1264 |
| `app/pages/messages/bucket/[id]/info.vue` | 1201 |
| `app/pages/indexed-bucket/[id]/index.vue` | 538 |

The last two of these are shared loggers — `indexed-bucket`'s is wrapped by `submitPending` (`:588`) for chat sends, and the chat page's serves the same role. They get the guard but no phase wiring; their pages' buttons are out of scope.

- [ ] **Step 8: Verify nothing else referenced the removed stage**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "pending" || echo "no pending references"`
Expected: `no pending references`. The six `logOperationUpdate` call sites interpolate `update.stage` into a template string, so they keep compiling untouched.

- [ ] **Step 9: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add app/services/buckets/types.ts app/services/buckets/bucketsRepository.ts tests/unit/bucketsRepository.mutations.spec.ts app/pages
git commit -m "feat: split mutation progress into signing and submitting stages"
```

---

### Task 4: Wire create-namespace

**Files:**
- Modify: `app/pages/messages/namespaces/new.vue`

**Interfaces:**
- Consumes: `useSubmitState` (Task 1), `SubmitButton` (Task 2), the `signing`/`submitting` stages (Task 3).

This is the smallest page — it proves the whole stack end to end and establishes the pattern the next five tasks repeat.

Note the destructure-and-rename pattern used here and in every following task. Vue only auto-unwraps refs that are *top-level* setup bindings, so `submit.phase` in a template would be a `Ref` object, not a string. Destructuring gives template-friendly names.

- [ ] **Step 1: Replace the script block**

Replace lines 1-59 of `app/pages/messages/namespaces/new.vue` with:

```vue
<script setup lang="ts">
import type { OperationUpdate } from "../../../services/buckets/types"
import WalletConnectPrompt from "../../../components/common/WalletConnectPrompt.vue"
import PageHeader from "../../../components/common/PageHeader.vue"
import SubmitButton from "../../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../../components/common/submitButtonView"
import { computed, ref } from "vue"
import { useSubmitState } from "../../../composables/useSubmitState"
import { useOperationsStore } from "../../../stores/operations"
import { useSessionStore } from "../../../stores/session"

const bucketsRepository = useBucketsRepository()
const session = useSessionStore()
const operations = useOperationsStore()

const {
  phase: submitPhase,
  errorMessage: submitError,
  applyUpdate: applySubmitUpdate,
  fail: failSubmit,
  reset: resetSubmit,
  run: runSubmit
} = useSubmitState()

const isWalletConnected = computed(() => session.walletStatus === "connected" && Boolean(session.accountAddress))

const namespaceName = ref("")

const submitLabels: SubmitButtonLabels = {
  idle: "Create namespace",
  signing: "Signing…",
  submitting: "Creating namespace…",
  success: "Namespace created",
  error: "Create failed — retry"
}

function logOperationUpdate(update: OperationUpdate): void {
  applySubmitUpdate(update)
  // Signing drives the button only — logging it would add a notification popup
  // to every submit.
  if (update.stage === "signing") return
  operations.add("bucket_write", `namespace:${update.stage}`, update.stage === "error" ? "error" : "info", update.message)
}

async function submitCreateNamespace(): Promise<void> {
  const name = namespaceName.value.trim()
  if (!name) {
    failSubmit("Namespace name is required")
    return
  }

  const address = session.accountAddress
  if (!address) {
    failSubmit("Connect wallet before creating a namespace")
    return
  }

  await runSubmit(async () => {
    const result = await bucketsRepository.createNamespace(name, address, logOperationUpdate)
    operations.add("bucket_write", name, "success", `Namespace created: ${result.id}`)
    // Clearing programmatically does not fire @input, so the success state holds
    // until the user actually types again.
    namespaceName.value = ""
  })
}
</script>
```

- [ ] **Step 2: Replace the form body in the template**

Replace lines 70-95 (the `<section v-else …>` block) with:

```vue
    <section v-else class="card stack" style="gap: 10px" aria-live="polite">
      <label class="stack" style="gap: 6px">
        <span>Namespace name</span>
        <input
          v-model="namespaceName"
          class="input"
          type="text"
          name="namespace-name"
          placeholder="e.g. asset-messages"
          :disabled="submitPhase === 'signing' || submitPhase === 'submitting'"
          @input="resetSubmit"
        />
      </label>

      <div class="row" style="justify-content: flex-end">
        <SubmitButton :phase="submitPhase" :labels="submitLabels" @click="submitCreateNamespace" />
      </div>

      <p v-if="submitError" class="error-text">{{ submitError }}</p>
    </section>
```

This deletes the "Submitted via {{ submittedMethod }} successfully." paragraph (old lines 92-94) — the button carries success now, and naming the GraphQL mutation read like a transaction receipt.

- [ ] **Step 3: Delete the now-unused success-text style**

In the `<style scoped>` block, delete the `.success-text` rule (old lines 117-120). `.error-text` stays.

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. Any complaint about an unused `submittedId`/`submittedMethod` means Step 1's replacement was incomplete.

- [ ] **Step 5: Commit**

```bash
git add app/pages/messages/namespaces/new.vue
git commit -m "feat: unify submit states on create-namespace page"
```

---

### Task 5: Wire create-bucket

**Files:**
- Modify: `app/pages/messages/bucket/create/[namespaceId].vue`

**Interfaces:**
- Consumes: `useSubmitState` (Task 1), `SubmitButton` (Task 2).

- [ ] **Step 1: Update imports and state**

In `app/pages/messages/bucket/create/[namespaceId].vue`, add to the import block (after the `ParticleLoader` import on line 5):

```ts
import SubmitButton from "../../../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../../../components/common/submitButtonView"
import { useSubmitState } from "../../../../composables/useSubmitState"
```

Replace lines 33-44 (from `const bucketName = ref("")` through the closing brace of `onBucketNameInput`) with:

```ts
const {
  phase: submitPhase,
  errorMessage: submitError,
  applyUpdate: applySubmitUpdate,
  fail: failSubmit,
  reset: resetSubmit,
  run: runSubmit
} = useSubmitState()

const bucketName = ref("")
const category = ref("")

const submitLabels: SubmitButtonLabels = {
  idle: "Create bucket",
  signing: "Signing…",
  submitting: "Creating bucket…",
  success: "Bucket created",
  error: "Create failed — retry"
}

const submitting = computed(() => submitPhase.value === "signing" || submitPhase.value === "submitting")
```

`submitting` stays as a computed because the page's inputs already bind `:disabled="submitting || …"`.

- [ ] **Step 2: Rewrite the handler**

Replace lines 65-111 (`logOperationUpdate` and `submitCreateBucket`) with:

```ts
// Drives the button only. The page logs one terminal entry per submit below —
// see the "Loggers drive phases; pages log outcomes" global constraint.
function logOperationUpdate(update: OperationUpdate): void {
  applySubmitUpdate(update)
}

async function submitCreateBucket(): Promise<void> {
  const namespace = namespaceId.value.trim()
  if (!namespace) {
    failSubmit("Namespace id is required")
    return
  }

  const name = bucketName.value.trim()
  if (!name) {
    failSubmit("Bucket name is required")
    return
  }

  const address = session.accountAddress
  if (!address) {
    failSubmit("Connect wallet before creating a bucket")
    return
  }

  await runSubmit(async () => {
    const result = await bucketsRepository.createBucket(
      namespace,
      name,
      address,
      logOperationUpdate,
      category.value
    )
    operations.add("bucket_write", "Create bucket", "success", `Bucket created: ${result.id}`)
    bucketName.value = ""
    category.value = ""
  })

  if (submitPhase.value === "error") {
    operations.add("bucket_write", "Create bucket", "error", submitError.value)
  }
}
```

`runSubmit` has already captured the failure message, so logging after it returns keeps the success and failure entries symmetrical without a second try/catch. The `targetRef` is a human label rather than `result.method` — for `bucket_write`, `operations.add` uses `targetRef` as the notification title.

- [ ] **Step 3: Update the template**

Replace lines 146-169 (the Bucket Name label through the closing `</p>` of the submitted message) with:

```vue
          <label class="stack" style="gap: 6px">
            <span>Bucket Name</span>
            <input v-model="bucketName" class="input" type="text" name="bucket-name" placeholder="e.g. primary-bucket"
              :disabled="submitting || (!managersLoading && !isManager)" @input="resetSubmit" />
          </label>

          <label class="stack" style="gap: 6px">
            <span>Category (Optional)</span>
            <input v-model="category" class="input" type="text" name="category" placeholder="e.g. communication"
              :disabled="submitting || (!managersLoading && !isManager)" @input="resetSubmit" />
          </label>

          <div class="row" style="justify-content: flex-end; gap: 8px">
            <SubmitButton
              :phase="submitPhase"
              :labels="submitLabels"
              :disabled="managersLoading || !isManager"
              @click="submitCreateBucket"
            />
          </div>

          <p v-if="submitError" style="margin: 0; color: var(--status-error)">{{ submitError }}</p>
```

This deletes the old hand-rolled button (with its `bucketCreated` label branch) and the "Submitted via …" paragraph.

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. Errors naming `bucketCreated`, `onBucketNameInput`, `submittedId`, or `submittedMethod` mean a leftover reference — delete it.

- [ ] **Step 5: Commit**

```bash
git add "app/pages/messages/bucket/create/[namespaceId].vue"
git commit -m "feat: unify submit states on create-bucket page"
```

---

### Task 6: Wire add-namespace-manager

**Files:**
- Modify: `app/pages/messages/namespace/managers/[namespaceId].vue`

**Interfaces:**
- Consumes: `useSubmitState` (Task 1), `SubmitButton` (Task 2).

- [ ] **Step 1: Replace the script block**

Replace lines 1-80 of `app/pages/messages/namespace/managers/[namespaceId].vue` with:

```vue
<script setup lang="ts">
import { computed, ref } from "vue"
import { useRoute } from "nuxt/app"
import type { OperationUpdate } from "../../../../services/buckets/types"
import { useOperationsStore } from "../../../../stores/operations"
import { useSessionStore } from "../../../../stores/session"
import { useSubmitState } from "../../../../composables/useSubmitState"
import WalletConnectPrompt from "../../../../components/common/WalletConnectPrompt.vue"
import PageHeader from "../../../../components/common/PageHeader.vue"
import SubmitButton from "../../../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../../../components/common/submitButtonView"

const route = useRoute()
const session = useSessionStore()
const operations = useOperationsStore()
const bucketsRepository = useBucketsRepository()

const {
  phase: submitPhase,
  errorMessage: submitError,
  applyUpdate: applySubmitUpdate,
  fail: failSubmit,
  reset: resetSubmit,
  run: runSubmit
} = useSubmitState()

const namespaceId = computed(() => {
  const rawId = route.params.namespaceId
  const value = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "")

  try {
    return decodeURIComponent(String(value))
  } catch {
    return String(value)
  }
})

const namespaceRoutePath = computed(() => `/messages/namespace/${encodeURIComponent(namespaceId.value)}`)

const managerAddress = ref("")

const submitLabels: SubmitButtonLabels = {
  idle: "Add manager",
  signing: "Signing…",
  submitting: "Adding manager…",
  success: "Manager added",
  error: "Add failed — retry"
}

// Drives the button only. The page logs one terminal entry per submit below —
// see the "Loggers drive phases; pages log outcomes" global constraint.
function logOperationUpdate(update: OperationUpdate): void {
  applySubmitUpdate(update)
}

async function submitAddManager(): Promise<void> {
  const namespace = namespaceId.value.trim()
  if (!namespace) {
    failSubmit("Namespace id is required")
    return
  }

  const manager = managerAddress.value.trim()
  if (!manager) {
    failSubmit("Manager address is required")
    return
  }

  const address = session.accountAddress
  if (!address) {
    failSubmit("Connect wallet before adding a namespace manager")
    return
  }

  await runSubmit(async () => {
    const result = await bucketsRepository.addNamespaceManager(namespace, manager, address, logOperationUpdate)
    operations.add("namespace_write", "Add manager", "success", `Manager added: ${result.id}`)
    managerAddress.value = ""
  })

  if (submitPhase.value === "error") {
    operations.add("namespace_write", "Add manager", "error", submitError.value)
  }
}
</script>
```

The old validation message "Connect wallet before submitting namespace manager mutations" is reworded — "mutations" is jargon.

- [ ] **Step 2: Update the template**

Replace lines 92-114 (the Manager Address label through the closing `</div>` of the button row) with:

```vue
          <label class="stack" style="gap: 8px">
            <span style="font-weight: 600; font-size: 14px;">Manager Address</span>
            <input v-model="managerAddress" class="input" type="text" name="manager-address"
              placeholder="Enter SS58 address"
              :disabled="submitPhase === 'signing' || submitPhase === 'submitting'" @input="resetSubmit" />
          </label>

          <label class="stack" style="gap: 8px">
            <span style="font-weight: 600; font-size: 14px;">Namespace ID</span>
            <input class="input" type="text" :value="namespaceId" disabled />
          </label>

          <p v-if="submitError" style="margin: 0; color: var(--status-error); font-size: 13px;">{{ submitError }}</p>

          <div class="row" style="justify-content: flex-end; gap: 12px; margin-top: 8px;">
            <NuxtLink class="btn" :to="namespaceRoutePath">Cancel</NuxtLink>
            <SubmitButton
              :phase="submitPhase"
              :labels="submitLabels"
              :disabled="!managerAddress"
              @click="submitAddManager"
            />
          </div>
```

This deletes the "Submitted via {{ submittedMethod }} with id {{ submittedId }}" paragraph.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/pages/messages/namespace/managers/[namespaceId].vue"
git commit -m "feat: unify submit states on add-namespace-manager page"
```

---

### Task 7: Wire add-bucket-member

**Files:**
- Modify: `app/pages/messages/bucket/add-member/[id].vue`

**Interfaces:**
- Consumes: `useSubmitState` (Task 1), `SubmitButton` (Task 2).

This page has the most bookkeeping to remove: a `submitButtonLabel` computed and three `watch`ers that exist only to clear `submittedId`/`submittedMethod`.

- [ ] **Step 1: Update imports**

Add after line 11 (`import PageHeader …`):

```ts
import SubmitButton from "../../../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../../../components/common/submitButtonView"
import { useSubmitState } from "../../../../composables/useSubmitState"
```

- [ ] **Step 2: Replace the submit state and label computed**

Replace lines 42-73 (from `const submitting = ref(false)` through the end of the `submitButtonLabel` computed) with:

```ts
const {
  phase: submitPhase,
  errorMessage: submitError,
  isBusy: submitting,
  applyUpdate: applySubmitUpdate,
  fail: failSubmit,
  reset: resetSubmit,
  run: runSubmit
} = useSubmitState()

type ProfileStatus = "idle" | "loading" | "found" | "notFound" | "noKey" | "error"
const profile = ref<Profile | null>(null)
const profileStatus = ref<ProfileStatus>("idle")
const profileError = ref("")

let lookupTimer: ReturnType<typeof setTimeout> | null = null
let lastQueriedAddress = ""

const submitLabels: SubmitButtonLabels = {
  idle: "Add member",
  signing: "Signing…",
  submitting: "Adding member…",
  success: "Member added",
  error: "Add failed — retry"
}

const canSubmit = computed(() =>
  Boolean(memberAddress.value.trim()) &&
  Boolean(namespaceId.value.trim()) &&
  profileStatus.value === "found" &&
  Boolean(profile.value?.x25519Key)
)
```

`isBusy` is renamed to `submitting` so the existing `:disabled="submitting"` bindings on the address input and role buttons keep working. `canSubmit` no longer needs its own `!submitting` term — `resolveSubmitButtonView` locks the button while busy.

- [ ] **Step 3: Collapse the three watchers**

Replace lines 176-193 (the `memberAddress`, `namespaceId`, and `role` watchers) with:

```ts
watch(memberAddress, () => {
  resetSubmit()
  profile.value = null
  profileError.value = ""
  profileStatus.value = "idle"
  scheduleLookup()
})

watch(namespaceId, resetSubmit)
watch(role, resetSubmit)
```

- [ ] **Step 4: Rewrite the handler**

Replace lines 206-264 (`logOperationUpdate` and `submitAddMember`) with:

```ts
// Drives the button only. The page logs one terminal entry per submit below —
// see the "Loggers drive phases; pages log outcomes" global constraint.
function logOperationUpdate(update: OperationUpdate): void {
  applySubmitUpdate(update)
}

async function submitAddMember(): Promise<void> {
  const bucket = bucketId.value.trim()
  if (!bucket) {
    failSubmit("Bucket id is required")
    return
  }

  const namespace = namespaceId.value.trim()
  if (!namespace) {
    failSubmit("Namespace id is required")
    return
  }

  const member = memberAddress.value.trim()
  if (!member) {
    failSubmit("Member address is required")
    return
  }

  const address = session.accountAddress
  if (!address) {
    failSubmit("Connect wallet before adding bucket members")
    return
  }

  const x25519Key = profile.value?.x25519Key
  if (profileStatus.value !== "found" || !x25519Key) {
    failSubmit("A profile with an X25519 key is required for this address")
    return
  }

  await runSubmit(async () => {
    const result = await bucketsRepository.addBucketMemberWithRole(
      role.value,
      namespace,
      bucket,
      normalizeApiAddress(member),
      x25519Key,
      address,
      logOperationUpdate
    )
    operations.add("bucket_write", "Add member", "success", `Member added: ${result.id}`)
  })

  if (submitPhase.value === "error") {
    operations.add("bucket_write", "Add member", "error", submitError.value)
  }
}
```

`result.method` is dropped from the message: it is the GraphQL mutation name, and this entry becomes the notification the user reads.

The old code cleared `memberAddress` on success. That is deliberately dropped here: clearing it fires the `memberAddress` watcher from Step 3, which calls `resetSubmit()` and would wipe the success state the moment it was earned. The address stays on screen as part of the confirmation, and the watcher clears the state when the user starts a new entry.

- [ ] **Step 5: Replace the submit button in the template**

Replace lines 325-329 (the button row) with:

```vue
        <div class="row" style="justify-content: flex-end; gap: 12px; margin-top: 8px;">
          <SubmitButton
            :phase="submitPhase"
            :labels="submitLabels"
            :disabled="!canSubmit"
            @click="submitAddMember"
          />
        </div>
```

The error paragraph at line 323 already binds `submitError` and needs no change.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. Errors naming `submitButtonLabel`, `submittedId`, or `submittedMethod` mean a leftover reference.

- [ ] **Step 7: Commit**

```bash
git add "app/pages/messages/bucket/add-member/[id].vue"
git commit -m "feat: unify submit states on add-bucket-member page"
```

---

### Task 8: Wire create/edit profile

**Files:**
- Modify: `app/pages/profile/edit.vue`

**Interfaces:**
- Consumes: `useSubmitState` (Task 1), `SubmitButton` (Task 2).

This page does not go through `BucketsRepository`. `ProfileClient.saveProfile` takes the signer as an argument (`app/services/profile/profileClient.ts:70`), so the page wraps `wallet.signProfileRequest` to drive the same transition. The wrapper marks signing on *entry* and submitting on *exit*, because a profile save with a new image signs twice — once for the profile body, once for the image upload — and the button should honestly return to `Signing…` for the second.

**Redirect decision:** this page currently calls `router.push("/profile")` on success, which would make a held success state invisible. Keep the redirect but pause ~900 ms first so the confirmation is seen. This is the one deliberate exception to the "hold until edit" rule, and it is why the labels below use past-tense confirmations.

- [ ] **Step 1: Update imports and state**

In `app/pages/profile/edit.vue`, add to the import block after line 11:

```ts
import SubmitButton from "../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../components/common/submitButtonView"
import { useSubmitState } from "../../composables/useSubmitState"
```

Replace line 20 (`const saving = ref(false)`) with:

```ts
const {
  phase: submitPhase,
  errorMessage: submitError,
  isBusy: saving,
  markSigning,
  markSubmitting,
  fail: failSubmit,
  reset: resetSubmit,
  run: runSubmit
} = useSubmitState()
```

Delete line 30 (`const error = ref("")`) — `submitError` replaces it.

- [ ] **Step 2: Add the labels**

After the `isFormValid` computed (line 46), add:

```ts
const submitLabels = computed<SubmitButtonLabels>(() => ({
  idle: profileExists.value ? "Save changes" : "Create profile",
  signing: "Signing…",
  submitting: profileExists.value ? "Saving changes…" : "Creating profile…",
  success: profileExists.value ? "Changes saved" : "Profile created",
  error: profileExists.value ? "Save failed — retry" : "Create failed — retry"
}))

/** Marks signing on entry and submitting on exit, so a save that also uploads an
 *  image (two signatures) reports both rounds honestly. */
const signWithProgress: typeof wallet.signProfileRequest = async (method, path, body) => {
  markSigning()
  const headers = await wallet.signProfileRequest(method, path, body)
  markSubmitting()
  return headers
}
```

- [ ] **Step 3: Replace `error.value` assignments in loadProfile**

In `loadProfile` (lines 48-69), replace `error.value = ""` on line 50 with `resetSubmit()`, and replace line 65:

```ts
    error.value = loadError instanceof Error ? loadError.message : "Unable to load profile"
```

with:

```ts
    failSubmit(loadError instanceof Error ? loadError.message : "Unable to load profile")
```

- [ ] **Step 4: Rewrite saveProfile**

Replace lines 97-139 (the whole `saveProfile` function) with:

```ts
async function saveProfile(): Promise<void> {
  resetSubmit()
  submitAttempted.value = true
  await validateNickname()

  // The profile is always written for the currently connected wallet — the
  // address field is display-only and never feeds this call.
  const address = wallet.accountAddress.value
  if (!address) {
    failSubmit("Connect a wallet before saving your profile.")
    return
  }
  if (!isFormValid.value) return

  await runSubmit(async () => {
    const saved = await profileClient.saveProfile(address, {
      nickname: nickname.value,
      bio: bio.value,
      profilePicture: profilePicture.value,
      x25519Key: x25519Key.value
    }, signWithProgress)
    let savedProfile = saved
    if (selectedImage.value) {
      // The profile must exist before the image endpoint accepts an upload, so
      // this runs after saveProfile. Resize to a small square JPEG to avoid 413s.
      const resized = await resizeProfileImage(selectedImage.value, address)
      profilePicture.value = await profileClient.uploadProfileImage(
        address,
        resized,
        signWithProgress
      )
      savedProfile = { ...saved, profilePicture: profilePicture.value }
    }
    // Keeps the account-setup banners in step without a second round trip.
    profileStatus.setProfile(savedProfile)
  })

  if (submitPhase.value !== "success") return
  // Let the confirmation land before leaving the page.
  await new Promise((resolve) => setTimeout(resolve, 900))
  await router.push("/profile")
}
```

- [ ] **Step 5: Update the template**

Replace lines 232-239 (the error paragraph and the actions row) with:

```vue
      <p v-if="submitError" class="form-error" aria-live="polite">{{ submitError }}</p>
      <div class="profile-form-actions">
        <NuxtLink class="btn" to="/profile">Cancel</NuxtLink>
        <SubmitButton
          class="profile-save"
          type="submit"
          :phase="submitPhase"
          :labels="submitLabels"
          :disabled="nicknameChecking || !isFormValid"
        >
          <template #icon><Save :size="16" /></template>
        </SubmitButton>
      </div>
```

`type="submit"` means the enclosing `<form @submit.prevent="saveProfile">` fires the handler — do **not** also bind `@click`, or it would run twice.

Add `@input="resetSubmit"` to the nickname input (line 194), the bio textarea (line 202), and the x25519 textarea (lines 215-224), and `@change="resetSubmit"` alongside the existing `@change="selectImage"` on the file input (line 208) — Vue supports multiple handlers via `@change="selectImage($event); resetSubmit()"`.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. Errors naming `error` or `saving` mean a leftover reference.

- [ ] **Step 7: Commit**

```bash
git add app/pages/profile/edit.vue
git commit -m "feat: unify submit states on profile edit page"
```

---

### Task 9: Wire the two key-rotation flows

**Files:**
- Modify: `app/pages/messages/bucket/[id]/info.vue` (state at `:110-112`, handler at `:639-737`, button at `:1423-1429`, copy at `:1433`)
- Modify: `app/pages/indexed-bucket/[id]/index.vue` (state at `:135-136`, handler at `:750-818`, buttons at `:895-900` and `:961-967`, copy at `:951`)

**Interfaces:**
- Consumes: `useSubmitState` (Task 1), `SubmitButton` (Task 2).

These flows sign several times in sequence, so they legitimately cycle `Signing… → Sharing key… → Signing… → Sharing key… → Key shared`. That is accurate, not a defect.

`indexed-bucket` has **two** buttons invoking the same `createAndShareEncryptionKey` and sharing one `creatingKey` ref. They keep sharing a single `useSubmitState()` instance — it is one operation — but declare different `idle` labels, because one sits in a "viewers are missing the key" warning and the other in the empty-bucket setup timeline. Both can be on screen at once and both correctly show the same non-idle phase.

- [ ] **Step 1: Wire info.vue state**

In `app/pages/messages/bucket/[id]/info.vue`, add to the imports:

```ts
import SubmitButton from "../../../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../../../components/common/submitButtonView"
import { useSubmitState } from "../../../../composables/useSubmitState"
```

Replace lines 110-111 (`generatingEncryptionKey` and `encryptionKeyError`) with:

```ts
const {
  phase: keyPhase,
  errorMessage: encryptionKeyError,
  isBusy: generatingEncryptionKey,
  applyUpdate: applyKeyUpdate,
  fail: failKey,
  run: runKey
} = useSubmitState()

const keyLabels: SubmitButtonLabels = {
  idle: "Create & share key",
  signing: "Signing…",
  submitting: "Sharing key…",
  success: "Key shared",
  error: "Key sharing failed — retry"
}
```

Keep `encryptionKeySuccess` (line 112) as-is — it carries the generated `keyId`, which the button cannot.

- [ ] **Step 2: Wire info.vue handler**

Replace `generateAndShareEncryptionKey` in full (lines 639-740) with the following. The body between the two console-group calls is unchanged apart from `session.accountAddress` becoming `ownerAddress` — TypeScript does not carry the guard's narrowing into the nested closure, so the address must be captured before `runKey`:

```ts
async function generateAndShareEncryptionKey(): Promise<void> {
  if (!session.accountAddress) {
    failKey("Connect wallet before generating encryption keys")
    return
  }

  if (!connectedAdmin.value) {
    failKey("Only bucket admins can generate and distribute encryption keys")
    return
  }

  const namespaceId = resolveNamespaceIdFromBucket(bucket.value)
  if (!namespaceId) {
    failKey("Namespace id is required to rotate bucket encryption keys")
    return
  }

  // Captured before the closure: the guard above narrows `session.accountAddress`
  // for this function body, but that narrowing does not survive into runKey's callback.
  const ownerAddress = session.accountAddress
  encryptionKeySuccess.value = ""
  console.groupCollapsed(`[Bucket Key Rotation] bucket=${bucketId.value}`)

  await runKey(async () => {
    try {
      console.log("--- [ADMIN] 4a. Generating Bucket Keys ---")
      const { publicKey, privateKey } = await jose.generateKeyPair("ECDH-ES+A256KW", {
        crv: "X25519",
        extractable: true
      })

      const bucketPkJwk = await jose.exportJWK(publicKey)
      const bucketSkJwk = await jose.exportJWK(privateKey)

      const numericKeyId = randomNumericKeyId()
      const keyId = numericKeyId.toString()

      bucketPkJwk.use = "enc"
      bucketSkJwk.use = "enc"
      bucketPkJwk.kid = keyId
      bucketSkJwk.kid = keyId

      console.log("Generated bucketPkJwk:", bucketPkJwk)
      console.log("Generated bucketSkJwk:", bucketSkJwk)

      const bucketEncryptionKey = typeof bucketPkJwk.x === "string" ? bucketPkJwk.x.trim() : ""
      if (!bucketEncryptionKey) {
        throw new Error("Generated public key is missing JWK.x and cannot be used for key rotation")
      }

      console.log(`🔑 Bucket Public Key generated. keyId: ${numericKeyId}`)

      console.log("--- [ADMIN] 4b. Preparing recipients and encrypting key-sharing payload ---")
      const { recipientJwks, readerAddresses } = buildRecipientJwks(bucketPkJwk)
      console.log(`Using ${readerAddresses.length} viewer reader(s):`, readerAddresses)

      const keySharingMessage = buildKeySharingMessage(bucketSkJwk, readerAddresses)
      console.log("Constructed Key-Sharing Message:", JSON.parse(keySharingMessage) as unknown)

      const plaintextBytes = new TextEncoder().encode(keySharingMessage)
      const jweObject = await encryptJweForMultipleRecipients(plaintextBytes, recipientJwks)
      const jweString = JSON.stringify(jweObject)
      console.log(`Encrypted key-sharing JWE length: ${jweString.length}`)
      console.log(`Encrypted key-sharing JWE: ${jweString}`)

      const jweDigestBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jweString))
      const jweDigest = Array.from(new Uint8Array(jweDigestBuffer)).map((value) => value.toString(16).padStart(2, "0")).join("")
      console.log(`Key-sharing JWE digest (sha256): 0x${jweDigest}`)
      console.log("--- [ADMIN] 4c. Submitting rotateKey + write mutation ---")
      currentBucketCall.value = "rotateKey+write"
      const batchResult = await bucketsRepository.rotateBucketKeyAndShare(
        namespaceId,
        bucketId.value,
        bucketEncryptionKey,
        keySharingTag,
        jweString,
        ownerAddress,
        logKeyRotationUpdate
      )
      console.log(`✅ Bucket key rotation + tag + key-sharing message finalized. Result id: ${batchResult.id}`)

      latestGeneratedKeyId.value = keyId
      latestGeneratedPublicJwk.value = JSON.stringify(bucketPkJwk, null, 2)
      encryptionKeySuccess.value = `New encryption key generated and shared. keyId=${keyId}`

      operations.add(
        "bucket_write",
        batchResult.method,
        "success",
        `Bucket key rotated and shared. keyId=${keyId}, id=${batchResult.id}`
      )

      await loadMessages()
    } catch (error) {
      // runKey records the message for the button; this inner catch keeps the
      // operation-log entry and console trace the page already had.
      const message = error instanceof Error ? error.message : "Unable to rotate bucket encryption key"
      operations.add("bucket_write", currentBucketCall.value, "error", message)
      console.error("❌ Error rotating bucket key", error)
      throw error instanceof Error ? error : new Error(message)
    } finally {
      console.groupEnd()
    }
  })
}
```

The `throw new Error("… cannot be used for on-chain key rotation")` at old line 685 loses its `on-chain` wording above. It is a developer-facing guard rather than helper text, but it can surface in the error paragraph, so it is reworded.

Note the handler above passes `logKeyRotationUpdate`, **not** `logOperationUpdate`. This page's `logOperationUpdate` is shared by three call sites (`:546`, `:715`, `:1241` — member operations as well as key rotation), so wiring `applyKeyUpdate` into it would let a member change drive the key-rotation button's phase. Add a separate wrapper next to it, leaving the shared logger exactly as Task 3 Step 7 left it:

```ts
/** Key rotation only. The shared logOperationUpdate also serves the member
 *  operations on this page, which must not drive this button's phase. */
function logKeyRotationUpdate(update: OperationUpdate): void {
  applyKeyUpdate(update)
  logOperationUpdate(update)
}
```

In the handler above, change the `rotateBucketKeyAndShare` argument from `logOperationUpdate` to `logKeyRotationUpdate`.

- [ ] **Step 3: Wire info.vue template**

Replace lines 1423-1429 (the button) with:

```vue
            <SubmitButton
              :phase="keyPhase"
              :labels="keyLabels"
              :disabled="!session.accountAddress || !connectedAdmin || !viewerRecipients.length"
              @click="generateAndShareEncryptionKey"
            />
```

Replace the helper paragraph at lines 1432-1436 with:

```vue
          <p class="muted" style="margin: 0">
            Generates a fresh X25519 encryption keypair, registers the public key ID, ensures the key-sharing tag
            exists,
            then encrypts and shares the new secret key with all viewers using their X25519 keys.
          </p>
```

- [ ] **Step 4: Wire indexed-bucket state**

In `app/pages/indexed-bucket/[id]/index.vue`, add to the imports:

```ts
import SubmitButton from "../../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../../components/common/submitButtonView"
import { useSubmitState } from "../../../composables/useSubmitState"
```

Replace lines 135-136 (`creatingKey` and `createKeyError`) with:

```ts
const {
  phase: keyPhase,
  errorMessage: createKeyError,
  isBusy: creatingKey,
  applyUpdate: applyKeyUpdate,
  fail: failKey,
  run: runKey
} = useSubmitState()

// Two buttons drive this one operation: the "viewers are missing the key"
// warning and step 2 of the empty-bucket setup timeline. Same phase, different
// idle wording.
const keyWarningLabels: SubmitButtonLabels = {
  idle: "Regenerate encryption key",
  signing: "Signing…",
  submitting: "Sharing key…",
  success: "Key shared",
  error: "Key sharing failed — retry"
}
const keyTimelineLabels: SubmitButtonLabels = {
  ...keyWarningLabels,
  idle: "Create & share encryption key"
}
```

- [ ] **Step 5: Wire indexed-bucket handler**

Replace `createAndShareEncryptionKey` in full (lines 750-819) with:

```ts
async function createAndShareEncryptionKey(): Promise<void> {
  if (!session.accountAddress) {
    failKey("Connect wallet before generating encryption keys")
    return
  }

  if (!canManageBucket.value) {
    failKey("Only bucket admins and namespace managers can generate and distribute encryption keys")
    return
  }

  const namespaceId = bucket.value?.namespaceId != null ? String(bucket.value.namespaceId) : ""
  if (!namespaceId) {
    failKey("Namespace id is required to rotate bucket encryption keys")
    return
  }

  // Captured before the closure: the guard above narrows `session.accountAddress`
  // for this function body, but that narrowing does not survive into runKey's callback.
  const ownerAddress = session.accountAddress

  await runKey(async () => {
    try {
      const { publicKey, privateKey } = await jose.generateKeyPair("ECDH-ES+A256KW", {
        crv: "X25519",
        extractable: true
      })

      const bucketPkJwk = await jose.exportJWK(publicKey)
      const bucketSkJwk = await jose.exportJWK(privateKey)

      const keyId = randomNumericKeyId().toString()
      bucketPkJwk.use = "enc"
      bucketSkJwk.use = "enc"
      bucketPkJwk.kid = keyId
      bucketSkJwk.kid = keyId

      const bucketEncryptionKey = typeof bucketPkJwk.x === "string" ? bucketPkJwk.x.trim() : ""
      if (!bucketEncryptionKey) {
        throw new Error("Generated public key is missing JWK.x and cannot be used for key rotation")
      }

      const { recipientJwks, readerAddresses } = buildRecipientJwks(bucketPkJwk)
      const keySharingMessage = buildKeySharingMessage(bucketSkJwk, readerAddresses)
      const plaintextBytes = new TextEncoder().encode(keySharingMessage)
      const jweObject = await encryptJweForMultipleRecipients(plaintextBytes, recipientJwks)

      const batchResult = await bucketsRepository.rotateBucketKeyAndShare(
        namespaceId,
        bucketId.value,
        bucketEncryptionKey,
        KEY_SHARING_MESSAGE_TAG,
        JSON.stringify(jweObject),
        ownerAddress,
        logKeyRotationUpdate
      )

      operations.add(
        "bucket_write",
        batchResult.method,
        "success",
        `Bucket key rotated and shared. keyId=${keyId}, id=${batchResult.id}`
      )

      await loadAll()
    } catch (e) {
      // runKey records the message for the button; this inner catch keeps the
      // operation-log entry the page already had.
      const message = e instanceof Error ? e.message : "Unable to rotate bucket encryption key"
      operations.add("bucket_write", "rotateKey+write", "error", message)
      throw e instanceof Error ? e : new Error(message)
    }
  })
}
```

As in info.vue, the `on-chain key rotation` wording in the JWK.x guard is dropped.

Note the handler above passes `logKeyRotationUpdate`, **not** `logOperationUpdate`. This page's `logOperationUpdate` is shared with the chat message-send path (`submitPending` wraps it at `:588`), so wiring `applyKeyUpdate` into it would make every chat message drive the key-rotation button's phase. Add a separate wrapper next to it instead, leaving the shared logger exactly as Task 3 Step 7 left it:

```ts
/** Key rotation only. The shared logOperationUpdate also serves chat sends,
 *  which must not drive this button's phase. */
function logKeyRotationUpdate(update: OperationUpdate): void {
  applyKeyUpdate(update)
  logOperationUpdate(update)
}
```

- [ ] **Step 6: Wire indexed-bucket template**

Replace lines 895-900 (the warning-banner button) with:

```vue
        <SubmitButton
          class="ib-key-warning-btn"
          :phase="keyPhase"
          :labels="keyWarningLabels"
          @click="createAndShareEncryptionKey"
        >
          <template #icon><KeyRound :size="14" /></template>
        </SubmitButton>
```

Replace lines 961-967 (the timeline button) with:

```vue
                <SubmitButton
                  class="ib-tl-btn"
                  :phase="keyPhase"
                  :labels="keyTimelineLabels"
                  :disabled="!keyStepActive || loading || !session.accountAddress || !viewerRecipients.length"
                  @click="createAndShareEncryptionKey"
                >
                  <template #icon><KeyRound :size="16" /></template>
                </SubmitButton>
```

Replace the helper paragraph at lines 950-953 with:

```vue
                <p class="muted ib-tl-desc">
                  Generates a fresh X25519 encryption keypair, registers the public key ID, and shares
                  the new secret key with all viewers using their X25519 keys.
                </p>
```

- [ ] **Step 7: Delete the page-local spinner styles**

In `app/pages/indexed-bucket/[id]/index.vue`, delete the `.ib-tl-btn-spinner` rule and the `@keyframes ib-tl-spin` block (lines 1714-1727) — `SubmitButton` owns the spinner now. Verify no other reference remains:

Run: `grep -rn "ib-tl-btn-spinner\|ib-tl-spin" app/`
Expected: no output.

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add "app/pages/messages/bucket/[id]/info.vue" "app/pages/indexed-bucket/[id]/index.vue"
git commit -m "feat: unify submit states on key rotation flows"
```

---

### Task 10: Remove remaining chain copy and verify

**Files:**
- Modify: `app/pages/settings.vue:175,238`

**Interfaces:**
- Consumes: nothing. Copy-only, plus a full verification sweep.

`settings.vue`'s Save button is deliberately untouched — it writes to localStorage only, with no signature and no network, so a five-phase machine would have nothing to report.

- [ ] **Step 1: Rename the section heading**

In `app/pages/settings.vue`, replace line 175:

```vue
      <h4 style="margin: 0; font-size: 16px;">Chain Configuration</h4>
```

with:

```vue
      <h4 style="margin: 0; font-size: 16px;">Address Format</h4>
```

- [ ] **Step 2: Rewrite the developer-options helper**

Replace line 238:

```vue
      <span class="muted" style="font-size: 13px;">This will display extra data like on-chain ids, block numbers and extra debugging windows. Keep disabled if you are unsure what this does.</span>
```

with:

```vue
      <span class="muted" style="font-size: 13px;">This will display extra data like internal record ids and extra debugging windows. Keep disabled if you are unsure what this does.</span>
```

- [ ] **Step 3: Confirm no user-visible chain copy survives**

Run:

```bash
grep -rniE "blockchain|on-chain|onchain|extrinsic|block number" app/pages app/components --include="*.vue"
```

Expected: only matches inside `//` or `<!-- -->` comments (e.g. `BucketFileCard.vue:9`, `my-buckets.vue:43`, and the `on-chain key rotation` error strings in `throw new Error(...)`, which are developer-facing guards, not helper text). No match inside rendered template text.

- [ ] **Step 4: Run the full test suite**

Run: `npm run test`
Expected: PASS — unit and integration.

- [ ] **Step 5: Typecheck and lint the whole project**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Manual verification**

Start the app with `npm run dev` and, with a wallet connected, confirm on each of the eight buttons:

1. The button reads `Signing…` with a spinner while the wallet popup is open.
2. It switches to its submitting label once the signature is approved.
3. It lands on its green success label and is not clickable.
4. Editing any field in the form returns it to its idle label.
5. Rejecting the wallet signature lands on the red error label, the button stays clickable, and the message renders below the form.
6. Notification popups appear at the same rate as before the change — one per completed operation, none for signing.

For `profile/edit`, confirm the success label is visible for roughly a second before the redirect to `/profile`.

- [ ] **Step 7: Commit**

```bash
git add app/pages/settings.vue
git commit -m "refactor: drop blockchain wording from settings copy"
```

---

### Task 11: One submit, one plain-language notification

*(Added after the Task 4 review surfaced this; approved by the user.)*

**Files:**
- Modify: `app/services/buckets/bucketsRepository.ts` (the three `onUpdate` message strings in `runMutation`)
- Modify: `app/pages/messages/namespaces/new.vue` (retrofit — Task 4 landed before this rule existed)
- Modify: `app/pages/messages/bucket/[id]/index.vue` (shared logger + explicit entries)
- Modify: `app/pages/indexed-bucket/[id]/index.vue` (shared logger + explicit entries)
- Modify: `app/pages/messages/bucket/[id]/info.vue` (shared logger + explicit entries)

**Interfaces:**
- Consumes: everything from Tasks 1-10. Changes no exported signature.

**Why this task exists.** Before this plan, a successful create-namespace fired three notifications: `namespace:pending`, `namespace:success`, and the page's own "Namespace created". Two of the three had titles naming a GraphQL mutation. That is the same transaction-receipt wording the in-page copy changes remove, so it gets the same treatment. Verified: every flow that routes through a `logOperationUpdate` already has an explicit terminal `operations.add` on both its success and failure paths, so silencing the stage-driven entries mutes nothing.

- [ ] **Step 1: Drop mutation names from the repository's progress messages**

In `app/services/buckets/bucketsRepository.ts`, the three `onUpdate` calls in `runMutation` interpolate `${method}`. Replace those message strings:

| Stage | Before | After |
| --- | --- | --- |
| `signing` | `` `Waiting for signature to ${method}…` `` | `"Waiting for your signature…"` |
| `submitting` | `` `Submitting ${method}…` `` | `"Submitting…"` |
| `success` | `` `${method} confirmed` `` | `"Submitted"` |

Leave the `error` branch alone — its message is the API's own text, and its `` `${method} failed` `` fallback is only reached for non-`Error` throws.

These strings no longer reach a notification after Step 2, but they remain the `OperationUpdate.message` any future consumer would read, and they should not name mutations either.

- [ ] **Step 2: Make every logger phase-only**

Seven `logOperationUpdate` functions currently call `operations.add`. Remove that call from all of them.

On the four in-scope form pages (Tasks 4-7), the function keeps its `applySubmitUpdate(update)` body and the `signing` guard becomes unnecessary — delete it, since the function no longer logs anything:

```ts
// Drives the button only. The page logs one terminal entry per submit —
// see the "Loggers drive phases; pages log outcomes" global constraint.
function logOperationUpdate(update: OperationUpdate): void {
  applySubmitUpdate(update)
}
```

On `messages/bucket/[id]/index.vue`, `indexed-bucket/[id]/index.vue`, and `messages/bucket/[id]/info.vue`, `logOperationUpdate` would become an empty function. Delete it entirely and remove it from the argument lists of the repository calls that pass it — those calls take the handler as an optional parameter, so dropping the argument is valid.

Two call sites need care rather than deletion:

- `indexed-bucket/[id]/index.vue:588` — `submitPending` wraps the logger in `onOperationUpdate` to catch `update.stage === "error"` and mark the pending chat bubble failed. Keep that wrapper and its error branch; only remove its inner `logOperationUpdate(update)` call.
- `messages/bucket/[id]/info.vue` and `indexed-bucket/[id]/index.vue` — Task 9 added `logKeyRotationUpdate` wrappers that call the shared logger. With the shared logger gone, those wrappers reduce to `applyKeyUpdate(update)`; inline them and pass `applyKeyUpdate` directly.

- [ ] **Step 3: Retrofit the create-namespace page**

`app/pages/messages/namespaces/new.vue` was implemented before this rule. Apply Step 2's logger shape, then give it the symmetrical terminal entries the other form pages get:

```ts
  await runSubmit(async () => {
    const result = await bucketsRepository.createNamespace(name, address, logOperationUpdate)
    operations.add("bucket_write", "Create namespace", "success", `Namespace created: ${result.id}`)
    namespaceName.value = ""
  })

  if (submitPhase.value === "error") {
    operations.add("bucket_write", "Create namespace", "error", submitError.value)
  }
```

- [ ] **Step 4: Replace mutation-name notification titles**

`operations.add(category, targetRef, status, message)` uses `targetRef` as the notification title when `category === "bucket_write"` (`app/stores/operations.ts:16`). Several explicit calls pass `result.method` or `currentBucketCall.value`, putting `createMessage` or `rotateKey+write` in front of the user. Replace each with a human label describing the action:

| File | Current `targetRef` | Use |
| --- | --- | --- |
| `messages/bucket/[id]/index.vue:553` | `result.method` | `"Remove admin"` |
| `messages/bucket/[id]/index.vue:557` | `currentBucketCall.value` | `"Remove admin"` |
| `messages/bucket/[id]/index.vue:589` | `result.method` | `"Remove contributor"` |
| `messages/bucket/[id]/index.vue:593` | `currentBucketCall.value` | `"Remove contributor"` |
| `messages/bucket/[id]/index.vue:768,779` | `batchResult.method` / `currentBucketCall.value` | `"Encryption key"` |
| `messages/bucket/[id]/index.vue:1353,1364` | `result.method` / `currentBucketCall.value` | `"Send message"` |
| `indexed-bucket/[id]/index.vue:613` | `result.method` | `"Send message"` |
| `indexed-bucket/[id]/index.vue:808,818` | `batchResult.method` / `"rotateKey+write"` | `"Encryption key"` |
| `messages/bucket/[id]/info.vue:549,553` | `result.method` / `currentBucketCall.value` | `"Remove member"` |
| `messages/bucket/[id]/info.vue:723,734` | `batchResult.method` / `currentBucketCall.value` | `"Encryption key"` |
| `messages/bucket/[id]/info.vue:1251` | `result.method` | `"Send message"` |

Line numbers will have drifted from the earlier tasks — locate each by its surrounding `operations.add` call. Also strip `${result.method}` / `keyId=` style internals from the *message* text where it names a mutation; keep ids, which are useful.

- [ ] **Step 4b: Two loose ends from the Task 8 review**

In `app/pages/profile/edit.vue`:

- The destructure includes `isBusy: saving`, but nothing reads `saving` any more — `SubmitButton` computes its own disabled state from the phase. Drop `isBusy: saving,` from the destructure.
- `adoptActiveX25519Key` (the "Use my active key" button) assigns `x25519Key.value` programmatically, which does not fire the textarea's `@input` and so does not reset the phase. If someone uses it to fix a key right after a failed save, the button keeps its stale `Save failed — retry` label until the next real keystroke. Add `resetSubmit()` to that function:

```ts
function adoptActiveX25519Key(): void {
  x25519Key.value = activeX25519Key.value
  x25519Touched.value = true
  resetSubmit()
}
```

- [ ] **Step 5: Verify one notification per submit**

Confirm no user-visible notification path can name a mutation:

```bash
grep -rn "operations.add" app/pages app/components --include="*.vue"
```

Expected: every call passes a quoted human label as its second argument — no `result.method`, no `batchResult.method`, no `currentBucketCall.value`.

```bash
grep -rn "logOperationUpdate\|logKeyRotationUpdate" app/pages --include="*.vue"
```

Expected: matches only on the four form pages, each a phase-only function with no `operations.add` in its body.

- [ ] **Step 6: Full sweep**

Run: `npm run test && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 7: Manual verification**

With a wallet connected, submit once on each of the five form pages and confirm exactly **one** notification appears per submit, its title is a plain action label, and its text names no GraphQL mutation. Reject a signature and confirm exactly one error notification appears. Send a chat message and confirm it still produces its single "Send message" notification.

- [ ] **Step 8: Commit**

```bash
git add app/services/buckets/bucketsRepository.ts app/pages
git commit -m "refactor: one plain-language notification per submit"
```

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-07-28-unified-submit-state-design.md`:

- Spec §1 (phase machine) → Task 1. `markSigning`/`markSubmitting`/`fail` are additions beyond the spec's listed API: `markSigning`/`markSubmitting` are what let `profile/edit.vue` drive the transition from its locally wrapped signer (spec §2), and `fail` covers the pre-flight validation messages every page already had.
- Spec §2 (signing stage) → Task 3.
- Spec §3 (notification volume) → Task 3 Step 7, which guards all seven loggers in one pass. This went beyond the spec: the spec framed the guard as a per-scoped-page concern, but the two chat-page loggers also feed `operations.add()`, so without them the change would have added a notification popup to every chat message send. Tasks 4-7 carry the guard in their rewritten loggers as well.
- Shared loggers → `info.vue` (3 call sites) and `indexed-bucket` (shared with `submitPending` chat sends) get a `logKeyRotationUpdate` wrapper rather than phase-wiring the shared function. The spec did not anticipate this; wiring the shared logger would have let a chat send or a member change drive the key-rotation button.
- Spec §4 (presentation) → Task 2. The spec called for component tests; vitest runs in the `node` environment with no DOM shim and no `@vue/test-utils`, so the logic moved into a pure `submitButtonView.ts` tested there instead, keeping the "no new dependencies" constraint.
- Spec §5 (re-arm on edit) → the `@input="resetSubmit"` bindings in Tasks 4-8.
- Spec §6 (labels) → Tasks 4-9, all eight buttons.
- Spec §7 (copy) → Tasks 4, 5, 6 (three "Submitted via" deletions), Task 9 (two on-chain rewrites), Task 10 (settings).
- Spec §8 (dead code) → Tasks 4-7.
