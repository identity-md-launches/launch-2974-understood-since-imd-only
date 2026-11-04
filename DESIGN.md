# Hamster Friendship: design system

Extracted from the final source: `site/style.css` (tokens and components), `site/index.html`
(structure), `site/js/app.js` (states and dynamic copy), `site/js/game.js` (canvas art).
`dist/` is a copy of `site/`. None of this was confirmed in a rendered browser (see
`artifacts/validation.md`), so the responsive notes below come from the CSS, not from screenshots.

## Overview

A warm, small, friendly arcade page for casual players. The game is the product: the first screen
is a short headline, one line saying what this is, then the game card with its Play button. The
Top 100 sits beside the game on wide screens and below it on phones. Wallet connection is
secondary: an outlined button in the header, never filled. Character comes from the hamster
illustrations and a cream, sand and toasted-orange palette. Chrome stays flat: hairline borders,
no gradients in the interface, one soft shadow for floating panels.

## Colors

Hex notation. Primitives are named by hue in `:root` (`site/style.css`, top of file). Components
use only the semantic tokens.

| Token | Value (primitive) | Use |
| --- | --- | --- |
| `--color-bg-page` | `#fff8ee` (`--cream-50`) | Page background |
| `--color-bg-surface` | `#ffffff` (`--white`) | Cards, sheet, overlay box, table header |
| `--color-bg-subtle` | `#fcefd9` (`--cream-100`) | HUD tiles, icon buttons, "you" row, address box |
| `--color-bg-hover` | `#f6e2c3` (`--cream-200`) | Hover/pressed for neutral controls, held move buttons |
| `--color-border` | `#e9d6bc` (`--sand-300`) | Card borders, table row separators, rows in the sheet |
| `--color-border-strong` | `#8a6a4c` (`--brown-500`) | Secondary button border, hovered rows, held state |
| `--color-text-primary` | `#3b2412` (`--brown-900`) | Headings and body |
| `--color-text-secondary` | `#6b4a2e` (`--brown-700`) | Lede, labels, captions, hints |
| `--color-accent-solid` | `#b4530f` (`--orange-600`) | The one filled action per view (Play / Sign in), "You" tag |
| `--color-accent-solid-hover` / `-pressed` | `#96430b` / `#7c370a` | Primary hover / active |
| `--color-accent-text` | `#96430b` (`--orange-700`) | Ghost button label (Refresh) |
| `--color-on-accent` | `#ffffff` | Text on the accent fill |
| `--color-text-error` | `#a12c2c` (`--red-700`) | Error lines in the sheet and leaderboard |
| `--color-focus` | `#3b2412` | 2px focus ring |
| `--color-backdrop` | `rgb(59 36 18 / 0.45)` | Dialog backdrop |

Contrast ratios computed from the declared hex pairs with the WCAG formula, not measured in a
browser: secondary text on white about 7.9:1, on cream-100 about 7:1; white on accent about 5.0:1;
accent-text on white about 6.8:1; error on white about 7.2:1.

Canvas-only colors (in `site/js/game.js`, not tokens): fur `#e8a15a` and friend furs `FUR[]`, belly
`#fff6e6`, seed `#3f3a36`, heart `#e0577a`, burr `#6e4b2a`, grass `#9cc278`, sky gradient
`#fff4df` → `#fde3b8`. Stage fallback background `#fdebc8`.

## Typography

- Family: `--font-body`: `ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", system-ui, -apple-system, sans-serif`.
  No web font is bundled: Apple platforms get SF Rounded, others the system sans. Addresses use
  `ui-monospace, "SF Mono", Menlo, Consolas, monospace` (`.addr`).
- Weights: 400 body, 700 controls/labels/brand, 800 headings and HUD values.
- Scale (5 sizes): `--text-sm` 14px (labels, captions, table, notes), `--text-md` 16px (body, buttons),
  `--text-lg` 20px (h2, HUD values, overlay title), `--text-xl` 28px (h1 under 48rem),
  `--text-2xl` 40px (h1 from 48rem).
- Line height: 1.5 body, 1.15 headings, 1.2 buttons and the overlay title.
- Letter spacing: h1 −0.01em (−0.02em at 40px); none elsewhere. No uppercase anywhere.
- Wrapping: headings `text-wrap: balance`; lede, notes, hints `text-wrap: pretty`; lede capped at 40rem.
- Numbers: HUD and table use `font-variant-numeric: tabular-nums`.
- Sentence case on every label and heading.

## Layout

- Spacing scale (4px base): `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16,
  `--space-5` 24, `--space-6` 32, `--space-7` 48.
- Content width: `max-width: 72rem`, centered, applied to `.top-inner`, `.intro`, `.layout`, `.foot`.
- Inline margins: 16px under 48rem, 32px from 48rem.
- `.layout` is one column. From **60rem** it becomes two: `minmax(0, 3fr) minmax(18rem, 2fr)`,
  game left, Top 100 right, top-aligned.
- Game card order: HUD (4 equal tiles) → stage (4:3, canvas fills it) → controls (left button,
  hint, right button) → mode note → hidden status region.
- Overflow: the stage clips the canvas to its radius. The overlay box scrolls vertically if its
  text is taller than the stage, so nothing is cut off. The table scrolls inside `.table-wrap`
  (max 32rem) with a sticky header. The header button truncates with an ellipsis at 60vw.
- Phones (under 40rem): the wallet dialog is a bottom sheet with no bottom radius and safe-area padding.

## Elevation & depth

Flat by default. Cards use a 1px `--color-border` and no shadow. Two floating surfaces use
`--shadow-sheet` (`0 1px 2px` at 8% plus `0 12px 32px` at 18% of brown-900) and no border: the
game overlay box and the wallet dialog. The overlay dims the field with `rgb(255 248 238 / 0.72)`.
The dialog uses the native `::backdrop`.

## Shapes

`--radius-sm` 8px (tags, wallet icons, skip link), `--radius-md` 12px (buttons, HUD tiles, stage,
rows), `--radius-lg` 24px (cards, overlay box, dialog). Card padding is 12px on phones and 16px
from 48rem, with the 12px stage inside, so inner radii stay close to concentric.

## Components

All in `site/style.css`, built in `site/index.html` or `site/js/app.js`.

| Component | Classes | States / behavior |
| --- | --- | --- |
| Button | `.btn` + `.btn-primary` (filled accent, min 10rem), `.btn-secondary` (white, strong border), `.btn-ghost` (accent text, light border), `.btn-icon` (48px square, subtle fill), `.btn-x` (40px close) | Min height 44px. Hover only under `(hover: hover)`. Active `scale: 0.96` (off under reduced motion). Disabled 60% opacity. `:focus-visible` 2px brown ring, 2px offset. Transitions name their properties, 150ms `cubic-bezier(0.2, 0, 0, 1)`. |
| HUD | `.hud` (`<dl>`) | Score, Best (guest best or wallet best), Friends, Lives |
| Game stage + overlay | `.stage`, `#field`, `.overlay`, `.overlay-box`, `.overlay-title`, `.overlay-text` | Ready → "Play". Paused → "Resume". Over → "Play again" with the result. Focus moves to the button when the overlay shows, and to the game card when play starts. |
| Move controls | `.controls`, `.btn-icon.is-held`, `.hint` | Hold with a pointer. Arrow keys / A, D. Drag on the canvas. P or Escape pauses. The tab being hidden pauses. |
| Mode note | `.mode-note` | Says whether the next run is guest or ranked |
| Leaderboard | `.board`, `.board-head`, `.board-sub`, `.you`, `.board-state`, `.table-wrap`, `table`, `tr.is-you`, `.tag`, `.addr` | Not configured / loading / error (red, "select Refresh") / empty ("take the first spot") / rows. Your row is tinted and tagged "You". The full address is in `title`. |
| Wallet sheet | `dialog.sheet`, `.sheet-head`, `.sheet-intro`, `.sheet-body`, `.row`, `.account`, `.sheet-note` | Native modal `<dialog>`: focus moves in, Escape, backdrop click and × close it, and focus returns to the header button. Rows are 48px with a 28px icon: EIP-6963 wallets (MetaMask first), else "Browser wallet", else "Get MetaMask". Phones with no wallet get "Open in MetaMask / Coinbase Wallet / Phantom". While a prompt is open, rows are disabled and the pending row reads "<wallet>: opening…". A rejection shows one calm line, never an alert. When connected, it shows the full address, "Sign in to rank scores" (primary) and "Disconnect". |
| Skip link | `.skip` | First focusable element; jumps to `#play` |

## Do's and don'ts

- Do keep one filled `.btn-primary` per view: Play on the page, "Sign in to rank scores" in the sheet. Everything else is secondary, ghost or icon.
- Do use the semantic `--color-*` tokens. Add a role token rather than using a primitive or hex in a component.
- Do stay within the five type sizes and the 4px spacing steps.
- Do put directions next to their controls (as `.hint` and `.mode-note` do), not in the intro.
- Don't add uppercase labels, eyebrow text above headings, gradient text, or shadows on bordered cards.
- Don't use `transition: all`. Name the properties.
- Recipe for a new page or section: a `<section class="card">` inside `.layout` with an `h2` at
  `--text-lg`/800, a `--text-sm` secondary sub-line, content in `--space-2`/`--space-3` gaps, and
  at most one `.btn-primary`.
