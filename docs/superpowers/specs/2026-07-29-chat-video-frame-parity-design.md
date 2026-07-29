# Video attachments framed like image attachments

**Date:** 2026-07-29
**Pages:** `/indexed-bucket/[id]` (e.g. http://localhost:3000/indexed-bucket/1)
and `/messages/bucket/[id]` — both render through `ChatMessageEntry.vue`.

## Problem

Inside a chat bubble, an image attachment and a video attachment are framed
differently, so a video message reads as a different kind of object than an
image message sitting right above it.

| | Image (`.chat-attachment-img`) | Video (`.chat-attachment-video`) |
|---|---|---|
| Width | `calc(100% - 24px)` + 12px side margins — inset, aligned with the bubble's text | `100%` — bleeds out to the bubble's outer edge |
| Corners | own `border-radius: 10px` | only the wrapper's clip, at the bled-out edge |
| Fit | `object-fit: cover` | browser default — black letterbox bars |
| Height cap | `max-height: 420px` | `max-height: 420px` (already matches) |

The two rules were written independently, which is how they diverged.

## Goal

A video attachment occupies the same box as an image attachment: inset from
the bubble edge by the same amount, same corner radius, same height cap. The
video keeps its native `controls` — only the frame changes.

## Approach

Purely presentational, confined to the `<style scoped>` block of
`app/components/common/ChatMessageEntry.vue`. Template and script are
untouched, and the `.chat-attachment-media` wrapper is left alone so image
framing cannot shift.

Rather than restyling video on its own, the frame becomes **one shared rule**
that both media types are routed through, so the two cannot drift apart again:

```css
/* One box for every inline medium: image and video are framed identically.
   Margin rather than padding so the radius rounds the medium itself, not the
   transparent padding box around it. */
.chat-attachment-img,
.chat-attachment-video {
  display: block;
  width: calc(100% - 24px);
  margin: 0 12px;
  max-height: 420px;
  border-radius: 10px;
}

.chat-attachment-img { object-fit: cover; cursor: pointer; }
.chat-attachment-img:hover { opacity: 0.92; }

/* Contain, not cover: a portrait clip keeps every frame instead of being
   cropped mid-playback. The leftover space is tinted to the bubble rather
   than left as the browser's black slab. */
.chat-attachment-video {
  object-fit: contain;
  background: color-mix(in srgb, var(--color-primary) 10%, var(--color-white));
}
.chat-bubble-outgoing .chat-attachment-video { background: rgba(0, 0, 0, 0.14); }
```

### Why `contain` for video where images use `cover`

This is the one place "identical to images" and correct video behaviour pull
apart. `cover` crops a portrait clip once its height hits the 420px cap,
hiding footage the sender chose to send — acceptable for an image thumbnail,
not for a clip being played. `contain` fits the whole frame and leaves space
at the sides.

That leftover space is tinted instead of left black so it still reads as part
of the bubble. The per-variant override follows the pattern already used for
`.chat-attachment-caption`: a light primary tint sits naturally inside the
incoming bubble, while a translucent black deepens the solid-primary outgoing
bubble instead of punching a bright block into it.

A landscape 16:9 clip at the bubble's width lands under the 420px cap, so
`object-fit` and the backdrop never come into play for the common case.

## Verification

Manual, in the browser: load `/indexed-bucket/1` and compare a video bubble
against an image bubble — matching left/right edges, matching corner radius,
no black bars — in both incoming and outgoing bubbles.

No automated test. The repo has no component-test harness (no
`@vue/test-utils` and no DOM environment; `tests/unit` is all logic). An
end-to-end geometry assertion would need a live server plus a bucket that
happens to hold both an image and a video **and** a loaded X25519 key to
decrypt them — a test that only passes on one machine is worse than none for
a rule with no behaviour attached.

## Out of scope

- Image framing, and the `.chat-attachment-media` wrapper's bleed margins.
- Audio and generic-file attachments.
- Playback behaviour: no poster frame, no click-to-play overlay; native
  `controls` stay as they are.
- The `BucketFileCard.vue` file-library treatment, which is a list row with a
  `Film` icon rather than an inline medium.
