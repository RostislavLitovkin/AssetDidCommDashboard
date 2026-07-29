# Chat composer: grow to three lines, with an app-styled scrollbar

Date: 2026-07-29

## Problem

Both chat composers are `<textarea rows="1">` with a pinned height. Nothing ever
resizes them, so the moment a message passes one line the text scrolls inside a
40px slot and the writer loses sight of what they typed. `/indexed-bucket/[id]`
already declares `max-height: 120px` and `/messages/bucket/[id]` declares
`max-height: 120px` inline; both are dead today because no code ever sets a
height for the cap to clamp.

The scrollbar that appears in that slot is the browser default — a grey system
bar with square ends, jammed against a `999px` rounded pill.

## Goals

- A composer that grows with its content up to three lines, then scrolls.
- A scrollbar inside the composer that belongs to this app's visual language.
- Both chat pages behave identically, while keeping their distinct looks.

## Non-goals

- Enter-to-send / Shift+Enter-for-newline. It is the natural partner to a
  multi-line composer, but it was not asked for and changes send semantics.
- Scrollbar styling anywhere else in the app (chat viewport, sidebars, modals).
  Explicitly scoped to the composers.

## Design

### 1. `app/composables/useAutoGrowTextarea.ts`

The two composers stay visually separate but share the growth mechanic through a
composable, since they are otherwise different enough that a shared component
would fight both call sites.

```
el.style.height = "auto"                            // release, so the measurement is honest
el.style.height = `${el.scrollHeight + borderY}px`  // fit, adding back what scrollHeight omits
```

Two details the browser will not forgive:

- **Release before measuring.** `scrollHeight` on a height-pinned textarea
  reports the pinned box, not the content. Skip the `auto` reset and the
  composer grows but never shrinks back after the message is sent.
- **Add the border back.** `scrollHeight` spans content + padding but never the
  border, and `* { box-sizing: border-box }` is global here. Skip it and the
  indexed-bucket composer (4px of border) renders 4px short of its own text and
  scrolls against a cap it should not have reached.

The **ceiling stays in CSS** as `max-height`. The browser clamps whatever height
we set and `overflow-y: auto` produces the scrollbar, so no JavaScript needs to
know how many lines are allowed — each page keeps its cap next to the
line-height it is derived from.

Resize re-runs when the bound value changes, when the element itself changes
(the composer swaps the textarea out for an attachment chip and back), and on
window resize, since rewrapping at a new width changes the line count and would
otherwise strand text outside a box no longer tall enough for it.

### 2. Three-line caps

Derived per composer from its own metrics, with `border-box` totals:

| | line-height | padding-y | border-y | 1 line | `max-height` (3 lines) | radius |
|---|---|---|---|---|---|---|
| `.ib-composer-input` | 22px | 16 | 4 | 42px | **86px** | 21px |
| `.chat-input` | 24px | 20 | 0 | 44px | **92px** | 22px |

### 3. Border radius

Both composers are `border-radius: 999px`. At 86px tall that resolves to a 43px
curve — a stadium, with text hugging the bends. Setting the radius to exactly
half the one-line height keeps an identical pill at rest and relaxes into a
rounded rectangle as the box grows. No class toggling and no JavaScript.

### 4. Scrollbar

`.composer-scroll` in `globals.css` carries the grow-then-scroll behaviour for
both textareas; the scrollbar itself is styled **app-wide** rather than scoped to
the composers, so every scroller in the app matches.

- 10px track with the arrow buttons removed and track/corner painted
  transparent, leaving the handle as the only visible part.
- Thumb is flat `var(--color-primary)` with a `999px` radius, inset 2px via
  `border: 2px solid transparent` + `background-clip: content-box`, so the pill
  floats clear of rounded container edges instead of jamming into the curve.
- **Chrome ≥121 ignores `::-webkit-scrollbar` whenever `scrollbar-width` is
  set.** The standard `scrollbar-width` / `scrollbar-color` fallback therefore
  sits behind `@supports not selector(::-webkit-scrollbar)`: Firefox gets its
  native thin bar, Chromium keeps the inset pill.

### 5. Untangling `.chat-input`

The messages-page textarea carries an inline style that overrides its own class
on `min-height`, `max-height`, `border-radius`, `padding` and `background` —
exactly the properties this change touches — while `height: 48px` leaks through
from the class because the inline style never mentions it. That is why the
textarea renders 48px tall beside a 44px send button.

The inline geometry moves into `.chat-input` at its currently-rendered values
(`min-height: 44px`, `padding: 10px 16px`, `background: #f0f2f5`) and `height:
48px` is dropped, since a pinned height would fight the composable. Appearance
is preserved apart from the intended 4px correction that aligns the composer
with its send button.

## Testing

`vitest` runs `environment: "node"` and jsdom is not a dependency, so no test
here can touch a real element. The measurement is therefore a pure function over
a two-property interface (`style.height`, `scrollHeight`), and
`tests/unit/useAutoGrowTextarea.spec.ts` drives it with a stub whose
`scrollHeight` getter reports its content height only while unpinned — the way a
real textarea does.

That stub is what makes the test worth writing: it fails on both silent bugs
above. Drop the `auto` reset and the stub returns the stale pinned height; drop
the border term and the result is short by the border.

The visual outcome — the three-line cap, pill-to-rectangle, the scrollbar — is
confirmed in the browser at `localhost:3000/indexed-bucket/1`, since a layout
engine is the only thing that can prove it.
