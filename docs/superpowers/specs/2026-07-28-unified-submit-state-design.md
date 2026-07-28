# Unified Submit-State UX — Design

Date: 2026-07-28

## Problem

Every page that submits user-entered data hand-rolls its own submit button. The
five form pages disagree on labels, on whether a success state exists at all,
and on how failure is shown:

| Page | Current behaviour |
| --- | --- |
| `app/pages/profile/edit.vue:237` | `Saving...` / `Save changes` / `Create profile` — no success state |
| `app/pages/messages/namespaces/new.vue:87` | `Submitting...` / `Create` |
| `app/pages/messages/bucket/create/[namespaceId].vue:160` | `Submitting...` / `Bucket successfully created` / `Create Bucket` |
| `app/pages/messages/bucket/add-member/[id].vue:63` | `Submitting...` / `Submitted successfully` / `Submit` |
| `app/pages/messages/namespace/managers/[namespaceId].vue:112` | `Submitting...` / `Add Manager` |

Two further problems:

1. **The signing step is invisible.** `BucketsRepository.runMutation`
   (`app/services/buckets/bucketsRepository.ts:380`) calls `sign(rawBody)` —
   which opens the wallet popup — and only then issues the network request, but
   it emits a single `pending` update covering both. The user cannot tell
   "waiting for your signature" from "waiting for the server".
2. **Copy implies a blockchain.** The app persists to a REST/GraphQL profile
   API. It writes nothing to a chain and submits no transactions. Several
   helper strings still say otherwise.

## Goals

- One consistent submit-state vocabulary across every page where the user
  submits information.
- The button reports the true stage of the operation, including signing.
- Remove user-visible copy that implies blockchain persistence or transaction
  submission.

## Non-goals

- The chat message composers (`messages/bucket/[id]/index.vue:1451`,
  `indexed-bucket/[id]/index.vue:1038`). These are high-frequency sends with
  their own optimistic-message pipeline; a sticky success state would be wrong.
- `settings.vue`'s Save button (`settings.vue:190`). It writes to localStorage
  only — no signature, no network — so a five-phase machine has nothing to
  report. Its *copy* is in scope; its button is not.
- Internal code comments mentioning "on-chain". Only user-visible strings change.

## Scope

Submit-state treatment applies to:

1. `app/pages/profile/edit.vue` — create/edit profile
2. `app/pages/messages/namespaces/new.vue` — create namespace
3. `app/pages/messages/bucket/create/[namespaceId].vue` — create bucket
4. `app/pages/messages/bucket/add-member/[id].vue` — add bucket member
5. `app/pages/messages/namespace/managers/[namespaceId].vue` — add namespace manager
6. `app/pages/messages/bucket/[id]/info.vue:1423` — create & share encryption key
7. `app/pages/indexed-bucket/[id]/index.vue:895` and `:961` — two buttons that
   both invoke `createAndShareEncryptionKey` and today share one `creatingKey`
   ref. They keep sharing a single `useSubmitState()` instance — it is one
   operation — but declare different `idle` labels, since one sits in a
   "viewers are missing the key" warning and the other in the empty-bucket setup
   timeline. Both can be on screen at once, and both correctly show the same
   non-idle phase.

Eight buttons across seven files.

## Design

### 1. Phase machine — `app/composables/useSubmitState.ts` (new)

```ts
export type SubmitPhase = "idle" | "signing" | "submitting" | "success" | "error"
```

`useSubmitState()` returns:

| Member | Purpose |
| --- | --- |
| `phase: Ref<SubmitPhase>` | Current phase. |
| `errorMessage: Ref<string>` | Message captured from the rejected task. |
| `isBusy: ComputedRef<boolean>` | `phase === "signing" \|\| phase === "submitting"`. |
| `run(task: () => Promise<T>): Promise<T \| undefined>` | Sets `signing`, awaits `task`, lands on `success` or `error`. Swallows the rejection after recording it, returning `undefined`, so callers need no try/catch. |
| `applyUpdate(update: OperationUpdate): void` | Maps a repository stage onto the phase. |
| `reset(): void` | Returns to `idle` and clears `errorMessage`. |

`run` opens on `signing` rather than a generic busy state because signing is
always the first thing that happens on every path in scope.

**Validation is not part of the machine.** `profile/edit.vue` performs an async
nickname availability check before saving, and it already surfaces that through
field-level text ("Checking nickname..."). Folding it into the submit phases
would make the button report a stage it is not actually in.

### 2. Truthful signing stage — `app/services/buckets/`

`OperationUpdate.stage` (`app/services/buckets/types.ts:28`) widens:

```ts
// before
export interface OperationUpdate { stage: "pending" | "success" | "error"; message: string }
// after
export interface OperationUpdate { stage: "signing" | "submitting" | "success" | "error"; message: string }
```

`"pending"` is removed rather than kept, because after this change nothing emits
it and leaving it in the union would let a caller construct a stage the UI has
no mapping for.

`runMutation` (`bucketsRepository.ts:372`) wraps the signer so the transition
fires at the real boundary:

```ts
const sign = this.requireSign(ownerAddress)
onUpdate?.({ stage: "signing", message: `Waiting for signature to ${method}…` })
const signWithProgress = async (rawBody: string) => {
  const headers = await sign(rawBody)
  onUpdate?.({ stage: "submitting", message: `Submitting ${method}…` })
  return headers
}
const data = await this.client.mutate<T>(document, variables, signWithProgress)
```

This is the only viable place for it: `useBucketsRepository`
(`app/composables/useBucketsRepository.ts:26`) wires the signer at repository
construction, not per call, so a page cannot wrap it itself.

`profile/edit.vue` needs none of the above — `ProfileClient.saveProfile`
(`app/services/profile/profileClient.ts:70`) accepts the signer as an argument,
so the page wraps `wallet.signProfileRequest` locally to drive the same
transition.

### 3. Notification volume is unchanged

`operations.add()` (`app/stores/operations.ts:14`) pushes a notification for
every entry it records. To keep popup count identical to today, each page's
`logOperationUpdate` ignores the `signing` stage:

```ts
function logOperationUpdate(update: OperationUpdate): void {
  submit.applyUpdate(update)
  if (update.stage === "signing") return
  operations.add(/* … */)
}
```

The `signing` phase therefore drives the button and nothing else.

Six existing call sites interpolate `update.stage` into an operation label
(e.g. `` `namespace:${update.stage}` ``); widening the union keeps them
compiling unchanged.

### 4. Presentation — `app/components/common/SubmitButton.vue` (new)

Props:

| Prop | Type | Notes |
| --- | --- | --- |
| `phase` | `SubmitPhase` | Drives label, icon, colour, disabled state. |
| `labels` | `{ idle, signing, submitting, success, error }` | All five required. |
| `disabled` | `boolean` | Page-level gating (invalid form, missing permission). ORed with the phase's own disabled rule. |

Per-phase rendering:

| Phase | Icon | Styling | Clickable |
| --- | --- | --- | --- |
| `idle` | page-supplied slot icon | `.btn.btn-primary` | yes (unless `disabled`) |
| `signing` | spinner | primary | no |
| `submitting` | spinner | primary | no |
| `success` | `Check` | `--status-success` | no |
| `error` | `RotateCw` | `--status-error` | **yes** |

Error stays clickable so the button itself is the retry affordance, matching the
approved failure behaviour. The detailed API error renders below the form as it
does today.

Styling uses the existing `--status-success` / `--status-error` tokens from
`app/assets/styles/tokens.css:20-22`. The spinner reuses the keyframes already
defined at `indexed-bucket/[id]/index.vue:1714`, lifted into the component.

Accessibility: `aria-busy` while busy, and an `aria-live="polite"` label so the
phase transitions are announced.

### 5. Re-arm on edit

Success is held, not auto-cleared. Every input in each form calls `reset()` on
`@input` (or `@click` for the add-member role selector), returning the button to
`idle`. This generalises the behaviour `bucket/create` already has via its
`onBucketNameInput` handler.

In `add-member/[id].vue`, the three `watch`ers at lines 176-193 exist solely to
clear `submittedId`/`submittedMethod`; they collapse into `reset()` calls.

### 6. Per-page labels

| Page | idle | signing | submitting | success | error |
| --- | --- | --- | --- | --- | --- |
| profile/edit *(new profile)* | Create profile | Signing… | Creating profile… | Profile created | Create failed — retry |
| profile/edit *(existing)* | Save changes | Signing… | Saving changes… | Changes saved | Save failed — retry |
| namespaces/new | Create namespace | Signing… | Creating namespace… | Namespace created | Create failed — retry |
| bucket/create | Create bucket | Signing… | Creating bucket… | Bucket created | Create failed — retry |
| add-member | Add member | Signing… | Adding member… | Member added | Add failed — retry |
| namespace/managers | Add manager | Signing… | Adding manager… | Manager added | Add failed — retry |
| info.vue key rotation | Create & share key | Signing… | Sharing key… | Key shared | Key sharing failed — retry |
| indexed-bucket `:895` *(warning banner)* | Regenerate encryption key | Signing… | Sharing key… | Key shared | Key sharing failed — retry |
| indexed-bucket `:961` *(setup timeline)* | Create & share encryption key | Signing… | Sharing key… | Key shared | Key sharing failed — retry |

`Signing…` is deliberately identical everywhere: it is the same wallet-popup
moment regardless of the operation.

The two key-rotation flows sign exactly once: `rotateBucketKeyAndShare` submits
the key rotation and the key-sharing message as a single mutation, so each
cycles `Signing… → Sharing key… → Key shared` in one round.

### 7. Copy changes

**Deleted** — the button now carries this, and naming the GraphQL mutation
("Submitted via `createNamespace`") reads like a transaction receipt:

- `app/pages/messages/namespaces/new.vue:92-94`
- `app/pages/messages/bucket/create/[namespaceId].vue:167-169`
- `app/pages/messages/namespace/managers/[namespaceId].vue:104-106`

**Rewritten** to drop the chain reference:

- `app/pages/messages/bucket/[id]/info.vue:1433` — "stores the public key ID
  on-chain" → "registers the public key ID"
- `app/pages/indexed-bucket/[id]/index.vue:951` — same change
- `app/pages/settings.vue:175` — section heading "Chain Configuration" →
  "Address Format"
- `app/pages/settings.vue:238` — "extra data like on-chain ids, block numbers
  and extra debugging windows" → "extra data like internal record ids and extra
  debugging windows"

### 8. Dead code removed

Once the button owns success reporting, these become unused:

- `submittedId` / `submittedMethod` in `namespaces/new.vue`,
  `bucket/create/[namespaceId].vue`, `add-member/[id].vue`,
  `namespace/managers/[namespaceId].vue`
- `bucketCreated` and `onBucketNameInput` in `bucket/create/[namespaceId].vue`
- `submitButtonLabel` computed in `add-member/[id].vue:63`
- The three `watch`ers in `add-member/[id].vue:176-193`

`MutationResult.method` stays on the service return type — it is still used for
operation-log messages.

## Testing

Unit (vitest, alongside the existing suite in `tests/unit/`):

- `useSubmitState` — phase sequence for success and failure; `applyUpdate`
  mapping; `reset()` from every terminal phase; `run()` records the rejection
  message and does not rethrow.
- `bucketsRepository` — a mutation emits `signing` before the signer resolves
  and `submitting` after, then `success`; a failing signer emits `signing` then
  `error` and never `submitting`. Extends
  `tests/unit/bucketsRepository.mutations.spec.ts`.

Component:

- `SubmitButton` — renders the correct label per phase; disabled in
  `signing`/`submitting`/`success`; enabled in `error`; `disabled` prop ORs
  correctly with phase state.

Manual:

- With a wallet connected, confirm each of the eight buttons shows
  `Signing…` while the wallet popup is open and switches to the submitting
  label once approved.
- Rejecting the wallet signature lands on the error phase with a clickable
  retry.
- Editing any field after success returns the button to idle.

## Risks

- **Widening `OperationUpdate.stage` is a breaking type change.** Contained: all
  producers and consumers are in this repo, enumerated in section 3.
- **Wallet providers that never surface a popup** resolve `sign` almost
  instantly, so `Signing…` may flash by. Acceptable — the state is still
  truthful, and the submitting label carries the wait.
