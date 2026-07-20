# Indexed-Bucket Sender Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the indexed-bucket chat page, show each incoming sender's profile-picture bubble with an arrow pointing at it, and keep the avatar + arrow visible (sticky) while any part of the message bubble is on screen.

**Architecture:** A small pure module (`avatarResolver.ts`) resolves sender addresses to profile-picture URLs (reusing `ProfileClient`) and is unit-tested. `ChatMessageEntry.vue` gains an opt-in `showAvatars` prop that, for incoming messages, renders a sticky avatar-unit (circular image + CSS-triangle arrow); when no URL is available it shows the bundled `xcavateprofilepicture.png` default via a template `src` (same technique `AppShell.vue` uses). The indexed-bucket page resolves avatars after loading messages and passes them in.

**Tech Stack:** Nuxt 4 (SSR off, SPA), Vue 3 `<script setup>` + TypeScript (strict), Pinia, `@polkadot/util-crypto` (SS58 encode/decode), vitest (unit tests). No new dependencies.

## Global Constraints

- No new npm dependencies — everything used already exists in `package.json`.
- TypeScript is strict (`typescript.strict: true`, `typeCheck: true`); the typecheck gate is `npm run typecheck` and must pass.
- Do **not** change the live bucket page (`app/pages/messages/bucket/[id]/index.vue`) or its rendering. The avatar feature is opt-in via a prop defaulting to `false`.
- Default avatar asset: `app/assets/Images/xcavateprofilepicture.png`, referenced in a Vue template as `src="@/assets/Images/xcavateprofilepicture.png"` (the `@` alias resolves to `app/`). Do **not** add a JS `import` of the image (avoids a TS ambient-module shim).
- Avatars are shown for **incoming messages only** (not messages from the connected user), **one per message** (no consecutive-run grouping).
- Profile API keys on the generic SS58 format (prefix 42); normalize addresses with `toSs58Prefix42` before lookup.
- Unit tests live in `tests/unit/*.spec.ts` and import app code via `../../app/...` (see existing `tests/unit/profileClient.spec.ts`).

---

### Task 1: Avatar resolver module (pure logic + unit tests)

**Files:**
- Create: `app/services/profile/avatarResolver.ts`
- Test: `tests/unit/avatarResolver.spec.ts`

**Interfaces:**
- Consumes: `Profile` from `app/types/profile.ts` (`{ ss58Address, nickname, bio, profilePicture, x25519Key }`); `encodeAddress`, `decodeAddress` from `@polkadot/util-crypto`.
- Produces:
  - `toSs58Prefix42(address: string): string` — re-encodes an SS58 address to prefix 42; returns the input unchanged if it is not a decodable address.
  - `resolveAvatarUrls(addresses: string[], getProfile: (address: string) => Promise<Profile | null>): Promise<Record<string, string>>` — returns a map keyed by the **input** address, containing only addresses whose resolved profile has a non-empty `profilePicture`. Dedupes, trims, drops blanks, and skips addresses whose `getProfile` throws.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/avatarResolver.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { resolveAvatarUrls, toSs58Prefix42 } from "../../app/services/profile/avatarResolver"
import type { Profile } from "../../app/types/profile"

function profile(overrides: Partial<Profile>): Profile {
  return { ss58Address: "5Example", nickname: null, bio: null, profilePicture: null, x25519Key: null, ...overrides }
}

describe("resolveAvatarUrls", () => {
  it("maps each address to its non-empty profile picture, keyed by the input address", async () => {
    const getProfile = vi.fn(async (address: string) =>
      address === "addrA" ? profile({ profilePicture: "https://pics.test/a.png" }) : null
    )

    await expect(resolveAvatarUrls(["addrA", "addrB"], getProfile)).resolves.toEqual({
      addrA: "https://pics.test/a.png"
    })
  })

  it("dedupes addresses and skips blanks", async () => {
    const getProfile = vi.fn(async () => profile({ profilePicture: "https://pics.test/x.png" }))

    await resolveAvatarUrls(["addrA", " addrA ", "", "  "], getProfile)

    expect(getProfile).toHaveBeenCalledTimes(1)
    expect(getProfile).toHaveBeenCalledWith("addrA")
  })

  it("skips addresses whose lookup throws", async () => {
    const getProfile = vi.fn(async (address: string) => {
      if (address === "boom") throw new Error("network")
      return profile({ profilePicture: "https://pics.test/ok.png" })
    })

    await expect(resolveAvatarUrls(["boom", "ok"], getProfile)).resolves.toEqual({
      ok: "https://pics.test/ok.png"
    })
  })

  it("skips profiles with a null or blank picture", async () => {
    const getProfile = vi.fn(async (address: string) =>
      address === "blank" ? profile({ profilePicture: "  " }) : profile({ profilePicture: null })
    )

    await expect(resolveAvatarUrls(["blank", "none"], getProfile)).resolves.toEqual({})
  })
})

describe("toSs58Prefix42", () => {
  it("is idempotent on a generic (prefix-42) address", () => {
    const alice = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
    expect(toSs58Prefix42(alice)).toBe(alice)
  })

  it("returns the input unchanged when it is not a valid address", () => {
    expect(toSs58Prefix42("not-an-address")).toBe("not-an-address")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit -- avatarResolver`
Expected: FAIL — cannot resolve module `../../app/services/profile/avatarResolver`.

- [ ] **Step 3: Write the implementation**

Create `app/services/profile/avatarResolver.ts`:

```ts
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto"
import type { Profile } from "../../types/profile"

/** Re-encode an SS58 address to the generic Substrate prefix (42), which the profile API keys on. */
export function toSs58Prefix42(address: string): string {
  const trimmed = address.trim()
  try {
    return encodeAddress(decodeAddress(trimmed), 42)
  } catch {
    return trimmed
  }
}

/**
 * Resolve profile-picture URLs for a set of sender addresses.
 *
 * Returns a map keyed by the *input* address. An address is present only when its
 * resolved profile has a non-empty `profilePicture`. Blank/duplicate addresses are
 * collapsed, and a lookup that throws is skipped (the caller falls back to a default).
 */
export async function resolveAvatarUrls(
  addresses: string[],
  getProfile: (address: string) => Promise<Profile | null>
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(addresses.map((a) => a.trim()).filter(Boolean)))
  const result: Record<string, string> = {}

  await Promise.all(
    unique.map(async (address) => {
      try {
        const profile = await getProfile(address)
        const picture = profile?.profilePicture?.trim()
        if (picture) {
          result[address] = picture
        }
      } catch {
        // Skip — a failed lookup falls back to the default avatar downstream.
      }
    })
  )

  return result
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- avatarResolver`
Expected: PASS — 6 tests green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add app/services/profile/avatarResolver.ts tests/unit/avatarResolver.spec.ts
git commit -m "feat: add avatar resolver for sender profile pictures"
```

---

### Task 2: Avatar + arrow + sticky in `ChatMessageEntry.vue`

**Files:**
- Modify: `app/components/common/ChatMessageEntry.vue`

**Interfaces:**
- Consumes: nothing from Task 1 (this task is display-only). Reads the existing `--color-primary`, `--border-default`, `--surface-bg` CSS tokens.
- Produces:
  - `ChatMessageProps` gains optional `avatarUrl?: string`.
  - The component gains a prop `showAvatars?: boolean` (default `false`). When `showAvatars` is true and the message is incoming, it renders a sticky avatar-unit; the URL comes from `message.avatarUrl`, falling back to `@/assets/Images/xcavateprofilepicture.png`. Task 3 relies on these two names.

This task has no runnable unit test (the repo has no Vue component test harness). Its gates are `npm run typecheck` plus a smoke check that the default avatar renders; full visual verification happens in Task 3 once the page passes real data.

- [ ] **Step 1: Add `avatarUrl` to the props interface**

In the first `<script lang="ts">` block, extend `ChatMessageProps` (currently ends with `debugEntries?: { key: string; value: string }[]`):

```ts
export interface ChatMessageProps {
  id: string
  body: string
  outgoing: boolean
  senderLabel: string
  senderAddress?: string
  tag?: string
  contentType?: string
  attachment?: ChatMessageAttachment
  reference?: string
  payloadError?: string
  timestampLabel: string
  debugEntries?: { key: string; value: string }[]
  avatarUrl?: string
}
```

- [ ] **Step 2: Add the `showAvatars` prop and the image-error flag**

In `<script setup lang="ts">`, change the import and `defineProps`. Replace:

```ts
import { computed } from "vue"
import { Paperclip } from "lucide-vue-next"
import { useSettingsStore } from "../../stores/settings"

const props = defineProps<{
  message: ChatMessageProps
}>()

const settings = useSettingsStore()
```

with:

```ts
import { computed, ref } from "vue"
import { Paperclip } from "lucide-vue-next"
import { useSettingsStore } from "../../stores/settings"

const props = withDefaults(defineProps<{
  message: ChatMessageProps
  showAvatars?: boolean
}>(), {
  showAvatars: false
})

const settings = useSettingsStore()

// Per-instance: flip to the default avatar if the real picture URL fails to load.
const avatarFailed = ref(false)
```

(`props` stays referenced elsewhere; `withDefaults` keeps `props.message` working.)

- [ ] **Step 3: Render the avatar-unit in the template**

Replace the opening of the template:

```html
  <div class="chat-row" :class="message.outgoing ? 'chat-row-outgoing' : 'chat-row-incoming'">
    <div class="chat-message">
```

with:

```html
  <div class="chat-row" :class="[
    message.outgoing ? 'chat-row-outgoing' : 'chat-row-incoming',
    { 'chat-row-has-avatar': showAvatars && !message.outgoing }
  ]">
    <div v-if="showAvatars && !message.outgoing" class="chat-avatar-unit">
      <img
        v-if="!avatarFailed && message.avatarUrl"
        class="chat-avatar"
        :src="message.avatarUrl"
        :alt="message.senderLabel"
        @error="avatarFailed = true"
      />
      <img v-else class="chat-avatar" src="@/assets/Images/xcavateprofilepicture.png" alt="" />
      <span class="chat-avatar-arrow" aria-hidden="true"></span>
    </div>
    <div class="chat-message">
```

(The rest of the template — `.chat-message`, bubble, timestamp, closing `</div>` tags — is unchanged.)

- [ ] **Step 4: Add the styles**

In the `<style scoped>` block, immediately after the existing row rules:

```css
.chat-row { display: flex; width: 100%; }
.chat-row-incoming { justify-content: flex-start; }
.chat-row-outgoing { justify-content: flex-end; }
```

add:

```css
/* Incoming rows carrying an avatar: bottom-align so the avatar sits by the last line. */
.chat-row-has-avatar { align-items: flex-end; }
.chat-row-has-avatar .chat-message { max-width: min(78%, 520px); }

/* Avatar + arrow travel together and stay visible while the bubble is on screen. */
.chat-avatar-unit {
  position: sticky;
  top: 8px;
  bottom: 8px;
  align-self: flex-end;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 3px;
  margin-right: 8px;
}

.chat-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
  flex-shrink: 0;
  background: var(--surface-bg);
  border: 2px solid color-mix(in srgb, var(--color-primary) 30%, var(--border-default));
}

/* CSS triangle pointing left, from the bubble toward the avatar bubble. */
.chat-avatar-arrow {
  width: 0;
  height: 0;
  flex-shrink: 0;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  border-right: 7px solid color-mix(in srgb, var(--color-primary) 35%, var(--border-default));
}
```

Then, inside the existing `@media (max-width: 840px)` block, which currently contains:

```css
@media (max-width: 840px) {
  .chat-message { max-width: 100%; }
  .chat-debug-item { grid-template-columns: 1fr; }
}
```

add the avatar-aware override so incoming bubbles leave room for the avatar column:

```css
@media (max-width: 840px) {
  .chat-message { max-width: 100%; }
  .chat-row-has-avatar .chat-message { max-width: calc(100% - 56px); }
  .chat-debug-item { grid-template-columns: 1fr; }
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add app/components/common/ChatMessageEntry.vue
git commit -m "feat: sticky sender avatar with pointer in chat message entry"
```

---

### Task 3: Wire the indexed-bucket page and verify end-to-end

**Files:**
- Modify: `app/pages/indexed-bucket/[id]/index.vue`

**Interfaces:**
- Consumes: `resolveAvatarUrls`, `toSs58Prefix42` (Task 1); `ChatMessageEntry`'s `showAvatars` prop and `ChatMessageProps.avatarUrl` (Task 2).
- Produces: the finished feature; nothing downstream depends on it.

- [ ] **Step 1: Import the resolver and `ProfileClient`**

After the existing service imports near the top of `<script setup>` (the block importing `subqueryClient` and `didCommRepository`), add:

```ts
import { ProfileClient } from "../../../services/profile/profileClient"
import { resolveAvatarUrls, toSs58Prefix42 } from "../../../services/profile/avatarResolver"
```

- [ ] **Step 2: Instantiate the client and add avatar state**

After the existing `const didCommRepository = new DidCommRepository(...)` construction, add:

```ts
const profileClient = new ProfileClient()
```

In the `// ── State ──` section, after `const messages = ref<IndexedMessage[]>([])`, add:

```ts
const avatarUrlByAddress = ref<Record<string, string>>({})
```

- [ ] **Step 3: Add `loadAvatars`**

Add a new section after the `hydrateAttachments` function (before the "Send message" section):

```ts
// ── Sender avatars ─────────────────────────────────────────────────
async function loadAvatars(msgs: IndexedMessage[]) {
  // Incoming senders only: skip messages sent by the connected wallet.
  const incoming = msgs
    .map(m => m.contributor)
    .filter(addr => Boolean(addr) && !(session.accountAddress && addressesEqual(addr, session.accountAddress)))

  try {
    const resolved = await resolveAvatarUrls(incoming, addr => profileClient.getProfile(toSs58Prefix42(addr)))
    avatarUrlByAddress.value = { ...avatarUrlByAddress.value, ...resolved }
  } catch {
    // Non-fatal: unresolved senders fall back to the default avatar.
  }
}
```

- [ ] **Step 4: Resolve avatars at the end of `loadAll`**

In `loadAll`, the try block currently ends with:

```ts
    // 6. Resolve file attachments referenced by CID-pointer messages
    await hydrateAttachments(detail.messages)
  } catch (e) {
```

Change it to:

```ts
    // 6. Resolve file attachments referenced by CID-pointer messages
    await hydrateAttachments(detail.messages)

    // 7. Resolve sender profile pictures for incoming messages
    await loadAvatars(detail.messages)
  } catch (e) {
```

- [ ] **Step 5: Expose `avatarUrl` on chat messages**

In the `chatMessages` computed, the returned object currently starts:

```ts
    return {
      id: m.id, body, outgoing,
      senderLabel: outgoing ? "You" : formatAddress(m.contributor),
      senderAddress: m.contributor, tag: m.tag ?? undefined,
```

Insert the `avatarUrl` line (incoming only):

```ts
    return {
      id: m.id, body, outgoing,
      senderLabel: outgoing ? "You" : formatAddress(m.contributor),
      senderAddress: m.contributor, tag: m.tag ?? undefined,
      avatarUrl: outgoing ? undefined : avatarUrlByAddress.value[m.contributor],
```

- [ ] **Step 6: Turn avatars on in the template**

Change the message list line:

```html
        <ChatMessageEntry v-for="msg in chatMessages" :key="msg.id" :message="msg" />
```

to:

```html
        <ChatMessageEntry v-for="msg in chatMessages" :key="msg.id" :message="msg" :show-avatars="true" />
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 8: Verify in the running app**

Run: `npm run dev`, open `http://localhost:3000/indexed-bucket/3` (any bucket with incoming messages).

Confirm:
- Each incoming message shows a circular avatar bubble on its left with a small arrow pointing at it.
- A sender with a profile picture shows it; a sender without one (or an unreachable URL) shows the xcavate default picture.
- Outgoing (your own) messages have **no** avatar and look unchanged.
- On a **tall** message (long text or an image attachment), scroll so the message's bottom is below the viewport while its top is still visible — the avatar + arrow stay pinned near the viewport bottom, and they leave only once the bubble is fully scrolled away. This holds scrolling both up and down.

- [ ] **Step 9: Run the full unit suite (no regressions)**

Run: `npm run test:unit`
Expected: PASS (including `avatarResolver` from Task 1).

- [ ] **Step 10: Commit**

```bash
git add app/pages/indexed-bucket/[id]/index.vue
git commit -m "feat: show sticky sender avatars on the indexed-bucket chat"
```

---

## Self-Review

**Spec coverage:**
- Profile-picture bubble for incoming senders → Task 2 (render) + Task 3 (data). ✓
- Except the user's own messages → `!message.outgoing` gate (Task 2) + incoming-only filter (Task 3). ✓
- Arrow pointing from bubble to avatar → `.chat-avatar-arrow` (Task 2). ✓
- Avatar **and** arrow stick while the bubble is visible → one sticky `.chat-avatar-unit` wrapping both (Task 2). ✓
- Default `xcavateprofilepicture.png` when no picture → template `v-else` `<img>` (Task 2); resolver omits blank pictures so the default shows (Task 1/3). ✓
- One avatar per message, no grouping → per-message render, no grouping logic. ✓
- Reuse `ProfileClient` + prefix-42 normalization → Task 1 `toSs58Prefix42`, Task 3 closure. ✓
- Live bucket page untouched → `showAvatars` defaults to `false`; only the indexed page passes `:show-avatars="true"`. ✓
- Verification via typecheck + visual → Task 3 steps 7–9. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" — all code and commands are concrete. ✓

**Type consistency:** `resolveAvatarUrls(addresses: string[], getProfile)` and `toSs58Prefix42(address: string)` are defined identically in Task 1 and called with those exact signatures in Task 3. `showAvatars` / `avatarUrl` are defined in Task 2 and used verbatim in Task 3. `Profile.profilePicture` matches `app/types/profile.ts`. ✓
