# Undecryptable Message Glitch Effect — Design

**Date:** 2026-08-02
**Status:** Implemented

## Goal

When a bucket message cannot be decrypted, stop rendering the raw JWE
ciphertext in the chat bubble. Replace it with a small, self-contained tile
that says "Unable to decrypt message" over a glitchy particle animation
visually related to the existing `ParticleLoader`.

## Current behaviour

`decryptReceivedMessages` in `app/pages/messages/bucket/[id]/index.vue` catches
a decrypt failure, records the error in `messageDecryptErrorById`, and falls
back to storing the *encrypted* payload in `decryptedMessagePayloadById`. That
payload becomes `ChatMessage.body`, so `ChatMessageEntry.vue` renders a wall of
ciphertext followed by a `⚠ <error>` line. `app/pages/indexed-bucket/[id]/index.vue`
does the same through its own `decryptErrorById` map.

## Scope

Decrypt failures only. Payload-*fetch* failures (`messagePayloadErrorById` /
`payloadErrorById`, e.g. IPFS content unavailable) keep the existing `⚠`
warning line — there is no ciphertext to hide in that case, and "unable to
decrypt" would misdescribe it.

## Components

### `app/components/common/GlitchParticles.vue` (new)

Sibling of `ParticleLoader.vue`, reusing its canvas engine so the two read as
one family: CSS-pixel sizing with a DPR-scaled backing store, a label box
measured from the rendered label, `ResizeObserver` re-measure, `visibilitychange`
pause, and a `prefers-reduced-motion` fallback.

Props:

| Prop | Type | Default |
| --- | --- | --- |
| `label` | `string` | `"Unable to decrypt message"` |

Motion differences from `ParticleLoader` — decay instead of convergence:

- Particles **drift outward** from behind the label and dissolve as they reach
  the edge, the inverse of the loader's inward flight.
- **Per-frame horizontal jitter**: each particle's drawn x snaps to a random
  offset a few px wide, re-rolled every frame, producing the datamosh shimmer.
- **Tear bands**: at random intervals every particle whose y falls inside a
  randomly placed horizontal band is displaced sideways for 2–4 frames, then
  snaps back, with a faint seam line across the band. Displacing the particles
  as they are drawn avoids a canvas readback entirely.
- The label box is a **soft mask**, not the hard keep-out zone `ParticleLoader`
  uses: particles crossing the label are dimmed (×0.5) rather than excluded.
  The label nearly fills a tile this small, so a keep-out rect would leave
  particles nowhere to go.
- Color comes from a `--glitch-color` custom property read off the root
  element, falling back to `--status-error`. The component therefore knows
  nothing about chat bubble variants; the outgoing bubble overrides the
  property to a white tone for contrast against its primary background.
- The label carries a subtle CSS RGB-split flicker and occasional opacity drop.

Performance: a bucket can contain many undecryptable messages, and one
`requestAnimationFrame` loop per instance would be wasteful. Each instance
pauses via `IntersectionObserver` when scrolled out of the chat viewport, in
addition to the inherited `visibilitychange` pause. Density stays at
`ParticleLoader`'s 0.22 per sqrt(px area), giving ~21 particles on the tile —
an earlier attempt at half that read as a few stray dots rather than a field.

Reduced motion: static particles plus the plain label, no animation — matching
`ParticleLoader`'s fallback approach.

The initial burst must be staggered (`dist = startDist + travel * random()`)
the way `ParticleLoader` staggers its own. Every particle spawns at
`progress = 0`, where the fade-in ramp makes it fully transparent; without the
stagger the tile paints an empty canvas on its first frame — which is all the
reduced-motion path ever draws — and pulses in unison for its first cycle.

### `app/components/common/ChatMessageEntry.vue` (modified)

- `ChatMessageProps` gains `decryptFailed?: boolean`.
- When `decryptFailed` is true, the bubble renders `<GlitchParticles />` in
  place of both the attachment and plain-text branches, and suppresses the
  `chat-warning` line — the tile already states the failure.
- The bubble gets a `chat-bubble-undecryptable` class: `width: auto` (overriding
  the default `width: 100%`) with the tile sized ~200×44, so the bubble hugs
  the notice instead of spanning the chat column.
- Sender label, timestamp, and the Debug `<details>` are unchanged.

### Chat pages (modified)

`app/pages/messages/bucket/[id]/index.vue` and
`app/pages/indexed-bucket/[id]/index.vue` set `decryptFailed` from their
decrypt-error map alone:

- `Boolean(messageDecryptErrorById.value[message.id])`
- `Boolean(decryptErrorById.value[m.id])`

`payloadError` continues to be the coalesced fetch-or-decrypt error so the
Debug panel keeps reporting the underlying reason. The ciphertext is still
present on `ChatMessage.body` in memory but is never rendered to the DOM.

## Data flow

```
decrypt throws
  → messageDecryptErrorById[id] = reason      (unchanged)
  → toChatMessageProps: decryptFailed = true  (new)
  → ChatMessageEntry: glitch tile branch      (new)
  → GlitchParticles renders label + canvas
```

## Error handling

The tile is itself the error state, so it has no failure mode of its own. If
the canvas 2D context is unavailable, the label still renders — the canvas is
decorative and `aria-hidden`, and the label is the accessible content.

## Testing

No component-test harness exists in this repo, so per the project's established
approach the visuals were verified with a throwaway preview page plus a
Playwright script (both deleted after use) rendering four bubbles: a normal
message, an undecryptable incoming, an undecryptable outgoing, and a
payload-fetch failure. Measured results:

| Check | Result |
| --- | --- |
| Undecryptable bubble does not span the column | 203 px incoming / 200 px outgoing, vs 389 px for a short normal message |
| Label text | "Unable to decrypt message" on both |
| Ciphertext in bubble `textContent` | absent on both |
| Label colour | `rgb(159,63,63)` incoming, `rgb(255,255,255)` outgoing |
| Canvas actually painted | yes, ~2% of pixels lit, animated and reduced-motion alike |
| Successive frames differ | yes (animation confirmed running) |
| Fetch-failure bubble unchanged | still renders "⚠ Payload unavailable", no tile |

## Out of scope

- Changing how or when decryption is attempted.
- Retry / "unlock with key" affordances on the failed bubble.
- Applying the effect to payload-fetch failures.
