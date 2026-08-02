# Gate the composer on decrypting the *latest* Encryption key

**Date:** 2026-08-02
**Page:** `/indexed-bucket/[id]` (e.g. http://localhost:3000/indexed-bucket/1)

## Problem

The composer is gated on `activeSecretJwk`, which is the newest bucket key the
connected user *could* decrypt — not the newest key that was actually shared.

`decryptKeySharingFromMessages` collects every key-sharing message
(`tag === "didcomm/key-sharing-v1"`) the user can open into `bucketKeyEntries`
and `activeSecretJwk` takes the last one. So a user who was a recipient of key
#1 but is *not* a recipient of key #2 still gets a fully enabled composer, and
sends a message encrypted to a retired key that nobody in the bucket reads
anymore.

The page has no way to say "you are locked out", either: the only signal is the
muted "Decrypt the bucket key to enable sending." hint under a disabled send
button, which reads as "you forgot a step" rather than "an admin has not shared
the key with you".

## Goal

1. Show a card when the connected user cannot decrypt the **latest**
   key-sharing message, with the text
   **"You do not have access to the Encryption key."**
2. Do not render the message entry bar unless the user can decrypt that latest
   key.

## Key access states

Failing to decrypt the latest key has three distinct causes, and they need
different words. Resolved in this precedence order:

| State | Condition | Card |
|---|---|---|
| `no-key-shared` | The bucket has no key-sharing message at all | **No encryption key shared yet** — "An admin needs to create and share the bucket encryption key before messages can be sent." |
| `no-secret` | No X25519 secret is loaded in settings | **Encryption key not loaded** — "Generate or load your X25519 encryption key in the sidebar to read and send messages in this bucket." |
| `no-access` | Latest key-sharing message is not among the ones we decrypted | **You do not have access to the Encryption key.** — "Ask an admin to re-share it with you." |
| `ok` | Latest key-sharing message was decrypted | (composer) |

`no-key-shared` outranks `no-secret` deliberately: when no key exists, nobody
can send, and loading a secret would not change that. Telling the user to load
a key they cannot use with a bucket that has no key is a dead end.

The card is informational for everyone — no admin "regenerate key" action.
Admins already have that button in the existing viewers-missing-key warning at
the top of the page, and in step 2 of the empty-bucket setup timeline.

## Approach

### 1. New pure module — `app/services/messages/keyAccess.ts`

Mirrors the shape of the existing `keySharingCoverage.ts`: no Vue, no jose, so
it is unit-testable on its own.

```ts
export type KeyAccessState = "ok" | "no-key-shared" | "no-secret" | "no-access"

export interface KeySharingRef {
  id: string
  createdAt: string
  messageId: string
}

export function latestKeySharingMessage<T extends KeySharingRef>(
  messages: readonly T[]
): T | null

export function resolveKeyAccessState(input: {
  hasSecret: boolean
  keySharingMessages: readonly KeySharingRef[]
  decryptedIds: Iterable<string>
}): KeyAccessState
```

`latestKeySharingMessage` picks the max by `Date.parse(createdAt)`, tie-broken
by **numeric** `messageId` — the same ordering the decrypt path already uses,
rather than trusting the order the API returned the messages in. (The existing
`checkViewerKeyAccess` takes `keySharingMessages[length - 1]` on trust; it
switches to this helper too.)

Unparseable `createdAt`/`messageId` values sort as `0` rather than poisoning
the comparison with `NaN`.

### 2. Page — `app/pages/indexed-bucket/[id]/index.vue`

- `BucketKeyEntry` gains `id` (the message's unique id) so a recovered key maps
  back to exactly the key-sharing message it came from.
- `keyAccessState` computed from `settings.x25519SecretJwk`,
  `keySharingMessages`, and the ids in `bucketKeyEntries`.
- Footer variant chain becomes:
  (A) no wallet → (B) not a contributor → **(D) key-access notice** → (C) composer.
  (D) renders when `!loading && !showSetupTimeline && keyAccessState !== "ok"`.
- The now-unreachable "Decrypt the bucket key to enable sending." hint under
  the composer is removed. The `!activeSecretJwk` `disabled` guards stay: (C)
  still renders during `loading`, when no key has been recovered yet.

### 3. Styling

(B) "Not a contributor" and (D) share one `.ib-footer-notice` block instead of
each carrying its own copy of the same flex/padding/color rules;
`.ib-not-contributor` becomes a thin modifier over it.

## Deliberate calls

- **While `loading`, the composer stays as it is today** (visible, send
  disabled) instead of swapping to a card. `loadAll` re-runs after every send
  and on Reload, so gating the card on load state would flicker the footer
  card → composer → card on each round trip.
- **No card while the empty-bucket setup timeline is showing.** The timeline
  already walks an admin through "Create & share encryption key", and the
  composer is hidden there for the same reason.

## Testing

`tests/unit/keyAccess.spec.ts` covers the ordering helper (empty, out-of-order
input, numeric tie-break) and each of the four states — including the
regression this whole change exists for: only an *older* key-sharing message
decrypted resolves to `no-access`, not `ok`.
