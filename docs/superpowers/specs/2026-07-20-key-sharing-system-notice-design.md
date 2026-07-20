# Key-sharing messages as a centered system notice

**Date:** 2026-07-20
**Page:** `/indexed-bucket/[id]` (e.g. http://localhost:3000/indexed-bucket/3)

## Problem

Key-sharing messages (`tag === "didcomm/key-sharing-v1"`) currently render as
normal chat bubbles in `ChatMessageEntry.vue` — with an avatar, sender label,
a body, and a timestamp. These are protocol/system events, not conversation,
so a chat bubble is the wrong visual treatment.

## Goal

Render key-sharing messages as a centered "system notice" with a separation
line and no profile picture:

```
──────────  🔑 Alice has set a new Encryption key at 20/07/2026, 14:32  ──────────
```

Text: `{sender} has set a new Encryption key at {timestamp}`
(matching the requested wording, including the capital "Encryption").

- `{sender}` = nickname if available, otherwise the formatted address. Never
  "You", even for the connected user's own key rotations.
- `{timestamp}` = the existing `timestampLabel` (a date/time, or `Block #N`
  fallback / in message-debug mode).

## Approach

Keep all message-row rendering inside `ChatMessageEntry.vue`; the parent
already passes `tag`, `senderLabel`, `senderAddress`, and `timestampLabel`.

1. **Parent — `app/pages/indexed-bucket/[id]/index.vue`**
   In the `chatMessages` computed, for key-sharing messages set `senderLabel`
   to `profile?.nickname || formatAddress(senderAddress)` (never "You").

2. **Component — `app/components/common/ChatMessageEntry.vue`**
   Add `isKeySharing = message.tag === "didcomm/key-sharing-v1"`. When true,
   render a centered notice **instead of** the avatar + bubble layout:
   - full-width row, centered
   - muted, small text flanked by a thin horizontal rule on each side
     (the "separation line"), using `--text-secondary` / `--border-default`
   - a small `KeyRound` lucide icon before the text
   - no avatar, no bubble, no debug block

## Out of scope

- Decryption / key logic is unchanged; this is purely presentation.
- Other message types (text, attachments) are unchanged.
