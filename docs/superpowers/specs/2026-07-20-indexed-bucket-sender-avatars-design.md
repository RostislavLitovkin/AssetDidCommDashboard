# Sender avatars with a sticky pointer on the indexed-bucket chat

**Date:** 2026-07-20
**Status:** Approved

## Problem

The indexed-bucket chat page (`/indexed-bucket/[id]`, e.g. `/indexed-bucket/3`) renders
incoming messages with only a small text sender label above each bubble. There is no
visual identity for who sent a message, and nothing that ties a bubble to its sender the
way mainstream messenger apps do.

## Goal

For **incoming** messages on the indexed-bucket page:

1. Show the sender's **profile-picture bubble** (a circular avatar) next to the message.
2. Add a **message arrow** pointing from the message bubble toward the profile-picture
   bubble, similar to other messenger apps.
3. Make the avatar **and** the arrow **stick within the viewport** as the user scrolls:
   if the avatar's natural position scrolls off-screen while any part of the message
   bubble is still visible, the avatar+arrow stay visible alongside the bubble.

Messages sent by the connected user (outgoing) get **no avatar** and are unchanged.

## Decisions (made with the user)

1. **One avatar per message** — no grouping of consecutive same-sender messages. Every
   incoming message shows its own avatar.
2. **Default picture** — when a sender's profile has no picture (or the profile is
   missing / still loading / the URL fails to load), show
   `app/assets/Images/xcavateprofilepicture.png` as the default avatar.
3. **Incoming only** — outgoing messages (sent by the connected user) show no avatar.
4. **Indexed-bucket page only** — `ChatMessageEntry.vue` is shared with the live bucket
   page (`/messages/bucket/[id]`). The feature is gated behind an opt-in prop so that
   page is unaffected.

## Avatar source

Reuse the profile-resolution pattern already proven in
`app/pages/messages/bucket/[id]/info.vue`:

- `ProfileClient.getProfile(address)` returns `{ nickname, profilePicture (URL|null), ... }`.
- Addresses are normalized to the generic Substrate SS58 format (prefix 42) via
  `toSs58Prefix42` (`encodeAddress(decodeAddress(addr), 42)` from
  `@polkadot/util-crypto`), because the profile API keys on prefix-42 addresses.

## Changes

### Page — `app/pages/indexed-bucket/[id]/index.vue`

- Import `ProfileClient` and `encodeAddress` / `decodeAddress` (`@polkadot/util-crypto`);
  instantiate one `ProfileClient`. Add a local `toSs58Prefix42` helper mirroring
  `info.vue` (decode/encode with a try/catch that returns the input on failure).
- New state: `avatarUrlByAddress = ref<Record<string, string>>({})` mapping a sender's
  **original bucket address** → their profile-picture URL. An address is present in the
  map only when a non-null `profilePicture` was resolved.
- New `loadAvatars(msgs: IndexedMessage[])`:
  - Collect unique **incoming** sender addresses: `m.contributor` values where the
    message is not outgoing — i.e. not `addressesEqual(m.contributor, session.accountAddress)`,
    reusing the same `useAddress().addressesEqual` the page already uses to compute
    `outgoing` (it tolerates SS58-prefix differences).
  - `Promise.all` over them; for each, `try { profileClient.getProfile(toSs58Prefix42(addr)) }`
    and store `profile.profilePicture` when it is a non-empty string. `catch` → skip
    (leave the address out of the map so the default shows). Non-fatal, like
    `info.vue`'s `loadMemberProfiles`.
  - Merge results into `avatarUrlByAddress` (don't drop already-resolved entries).
- Call `await loadAvatars(detail.messages)` at the end of `loadAll()`'s try block, after
  messages are loaded. A failure here must not break the page (wrap defensively).
- In the `chatMessages` computed, add to each **incoming** entry:
  `avatarUrl: avatarUrlByAddress.value[m.contributor]` (leave `undefined` for outgoing).
- In the template, pass `:show-avatars="true"` to `<ChatMessageEntry>` on this page only.

### Component — `app/components/common/ChatMessageEntry.vue`

- Extend `ChatMessageProps` with `avatarUrl?: string`.
- Add a component prop `showAvatars?: boolean` (default `false`) so the live bucket page,
  which does not pass it, renders exactly as before.
- `import defaultAvatar from "@/assets/Images/xcavateprofilepicture.png"` (the `@` alias
  resolves to `app/`, the same way `AppShell.vue` references that folder).
- `avatarSrc = computed(() => props.message.avatarUrl || defaultAvatar)`.
- Track a per-instance "image failed" flag; an `@error` on the `<img>` sets it so the
  displayed src falls back to `defaultAvatar` when a real URL fails to load.
- Template: when `showAvatars && !message.outgoing`, render an **avatar unit** as the
  first child of `.chat-row` (before `.chat-message`):
  - a ~36px circular `<img class="chat-avatar" :src=…>` — the profile-picture bubble;
  - a small CSS-triangle **arrow** on the bubble-facing (right) side of the avatar,
    pointing toward the avatar, colored to echo the incoming bubble
    (`--color-primary`-tinted border/background). The arrow lives **inside** the avatar
    unit so it moves together with the avatar.
- Outgoing rows render no avatar unit and are visually unchanged.

## Sticky behavior

- Incoming rows: `align-items: flex-end` so the avatar sits at the bottom of the message
  (next to the last line / the arrow), Telegram-style.
- The **avatar unit** (avatar + arrow, a single wrapper) gets
  `position: sticky; top: 8px; bottom: 8px;`.
- Why it works: the sticky element's scrolling ancestor is `.ib-chat-viewport`, and
  nothing between the avatar and that viewport clips overflow. The element is therefore
  pinned within an 8px gutter of the viewport whenever its containing block (`.chat-row`)
  intersects that band, and otherwise rides with the row. Consequences:
  - Short message fully on screen → avatar sits at the row's bottom (natural position).
  - Tall message whose bottom is scrolled below the viewport (scrolling up into older
    content) → avatar pins to the bottom gutter, staying visible while the bubble's top
    is visible.
  - Tall message taller than the viewport → avatar stays within the gutter band.
  - Bubble fully leaves the viewport → avatar leaves with the row.
- Both directions ("up/down") are covered, and the arrow tracks the avatar because they
  are one unit.

## Layout details

- Avatar: ~36px circle, `object-fit: cover`, a subtle ring/border so it reads as a
  "bubble".
- A gap separates the avatar unit from `.chat-message`. The existing `chat-sender` label
  and `chat-timestamp` remain.
- `.chat-message` max-width is reduced on incoming rows to leave room for the avatar
  column so bubbles don't overflow, including at the `≤840px` breakpoint (where the
  message currently expands to `100%`).

## Edge cases

- Profile still loading, no picture set, or image URL fails → default
  `xcavateprofilepicture.png` shows; it swaps to the real picture reactively once
  resolved.
- A failed profile lookup for one sender does not affect others or the page.
- Consecutive messages from the same sender each show their own avatar (per the
  one-per-message decision).

## Non-goals

- No change to the live bucket page (`/messages/bucket/[id]`).
- No grouping of consecutive same-sender messages.
- No change to the sender-label text or the outgoing message layout.
- No backend / indexer changes.

## Verification

- `nuxt typecheck` passes (the project has `typescript.typeCheck: true`).
- Run the app and load `/indexed-bucket/3`:
  - Incoming messages show a circular avatar with the arrow pointing at it; senders with
    a profile picture show it, others show the xcavate default.
  - Outgoing messages have no avatar and look unchanged.
  - On a tall message (long text or an image attachment), scrolling keeps the avatar +
    arrow visible while any part of the bubble is on screen, and they leave once the
    bubble is fully scrolled away.
