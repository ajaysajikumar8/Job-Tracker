# Design

> Visual source of truth for the Next.js app and the Plasmo extension. Reuse it; do not invent a new direction per screen.
> Derived from the "Job Tracker — All Screens" canvas (26 screens), then checked against the frontend rules in `.agents/rules/AGENTS.md`. Where this file differs from the canvas, the difference is listed in "Changes from the canvas" and this file wins. The canvas is a private claude.ai artifact (`https://claude.ai/artifact/5rr6QGN6RRdUUV5iLwgWuu`) that outside readers cannot open, so nothing here may depend on seeing it.
> Last updated: 2026-11-04

## Direction

**Retro-technical utility.** A precise instrument for a serious job: sharp 2px corners, hairline ink borders, small uppercase mono labels, a faint dot grid on empty areas, and one lime accent. Dense data stays quiet and scannable. It is not a card-heavy SaaS dashboard.

## Typography

Loaded with `next/font` (Google). Every stack has a real fallback.

| Role | Font | Weights | Used for |
|:---|:---|:---|:---|
| Display | **Bricolage Grotesque** (variable, `opsz`) | 700, 800 | Page titles, empty-state titles, brand mark. Tight tracking (`-0.03em`) |
| Body / UI | **Source Sans 3** | 400, 500, 600, 700 | Everything else |
| Numbers and labels | **JetBrains Mono** | 400, 500, 600 | All table numbers, dates, ages, IDs, uppercase labels. Always `font-variant-numeric: tabular-nums` |

```
--fd: 'Bricolage Grotesque', 'Segoe UI', sans-serif
--fb: 'Source Sans 3', 'Segoe UI', 'Helvetica Neue', sans-serif
--fm: 'JetBrains Mono', ui-monospace, Menlo, monospace
```

**Type scale** (px). Hierarchy comes from weight and size contrast.

| Token | Size | Use |
|:---|:---|:---|
| `display` | 40 / 1.0 | Page title (`h1`), 800 |
| `title` | 26 | Empty-state and section titles (`h2`), display font |
| `brand` | 18 | Brand mark, large figures |
| `body` | 15 / 1.45 | Default text |
| `table` | 14 | Table cells, form text |
| `small` | 13 | Secondary lines in rows, mono values in prose |
| `caption` | 12 | Chips, hints |
| `label` | 11 | Uppercase mono labels, table headers (`letter-spacing .06–.1em`). **Minimum size: 11** |

## Colour

All colours are CSS variables, exposed through the Tailwind theme. Light and dark are both supported, and "System" is the default (Settings can force one).

| Token | Light | Dark | Role |
|:---|:---|:---|:---|
| `--bg` | `#F2F3F0` | `#101215` | Page |
| `--sf` | `#FFFFFF` | `#171A1E` | Panels, tables, sidebar |
| `--sf2` | `#E8E9E4` | `#1F2328` | Hover, skeleton, inactive fill |
| `--ink` | `#15171B` | `#ECEDE8` | Text, primary borders |
| `--ink2` | `#474B54` | `#B7BBC2` | Secondary text |
| `--ink3` | `#5E626C` | `#959AA3` | Tertiary text, **control borders** |
| `--line` | `#D6D8D1` | `#2C3138` | Decorative rules and row dividers only |
| `--acc` | `#C8F03C` | `#C8F03C` | The accent |
| `--acc-hover` | `#B5DE2A` | `#B5DE2A` | Accent hover (was hard-coded in every screen) |
| `--onacc` | `#15171B` | `#15171B` | Text on the accent |
| `--scrim` | `rgba(21,23,27,.45)` | `rgba(0,0,0,.6)` | Behind dialogs |
| `--dot` | `rgba(21,23,27,.13)` | `rgba(236,237,232,.09)` | Dot-grid texture |

**Status colours are a separate semantic set** and never use the accent:

| State | Token | Text | Background (light / dark) | Maps to |
|:---|:---|:---|:---|:---|
| OK | `--ok` / `--okbg` | `#0A6B4D` / `#5AD3A5` | `#DCF0E6` / `#0F2E25` | eligible |
| Warn | `--warn` / `--warnbg` | `#8F4500` / `#F2AA5C` | `#FBE9D2` / `#36250F` | needs info, deadline soon |
| Bad | `--bad` / `--badbg` | `#AF2A20` / `#FF8F85` | `#FADFDB` / `#3A1A17` | ineligible, errors, deadline very close |

- Status is always shown with a **text label and a dot**, never colour alone.
- Lifecycle stages (Discovered, Applied, Assessment, Interview, Offer) are neutral outlined mono chips. Only `Rejected` uses the bad colour.
- Engine result → chip: `eligible` → ok "Eligible", `needs_info` → warn "Needs info", `ineligible` → bad "Ineligible", `not_evaluated` → neutral "Not checked".

**Accent rules.** Use it sparingly, for key actions and highlights only:
- Allowed: the primary button (at most one per screen area), the count pill on the active nav item, the "on" state of a switch, the brand-mark dot, the avatar fill.
- Not allowed: status, deadlines, progress or score bars, links, or **as text colour on a light background** (contrast 1.2:1). As text it is only acceptable on a dark surface.
- **The accent alone never carries state.** Lime against white is 1.31:1, below the 3:1 that WCAG 1.4.11 requires for a state indicator. A switch's "on" state must also show through the thumb position and an `--ink` border (and `aria-checked`), not the fill colour only.

**Contrast (measured).** All text pairs pass WCAG AA in both themes (lowest: `--ink3` on `--sf2` in light, 5.0:1; ok/warn/bad on their tinted backgrounds, 5.2 to 7.9:1; `--onacc` on `--acc`, 13.7:1). Control borders must reach 3:1 (WCAG 1.4.11), which `--line` does not (about 1.3:1), so inputs, selects and checkboxes use `--ink3`.

## Surfaces and layout

- **Shell:** a fixed-flex sidebar (about 232px, `--sf`, right hairline) and a fluid main area (`padding: 28px 40px 48px`). Desktop-first per the PRD. Layouts reflow with `flex-wrap` but are not optimised for phones in Phases 1 and 2. This is a deliberate project override of the author's general mobile-first habit, made because of the dense tables, syllabus trees and the extension.
- **Page header:** a mono `label`, then the `display` title, then one line of context, with the primary action on the right.
- **Panels:** `1px solid var(--ink)` for the main data container, `1px solid var(--line)` for secondary ones. No shadows, except dialogs and popovers.
- **Dashboard:** asymmetric. Unequal flex columns (for example 7:5 and 4:7), not a uniform grid of identical cards.
- **Texture:** the dot grid (`radial-gradient(var(--dot) 1px, transparent 1px)`, 14px) on empty states and background areas only. **Never inside a data table.**
- **Radius scale, used on purpose:**

| Radius | Use |
|:---|:---|
| 2px | Buttons, fields, table containers, segmented controls, stage chips |
| 3px | Status chips, keyboard hints |
| 6px | Nav items, brand mark |
| 14px | Dialogs and large sheets |
| 999px | Count pills |
| 50% | Avatars, status dots |

## Data tables (TanStack Table)

Density and scanability come first; decoration never overrides them.
- Sticky header: mono 11px uppercase, `--ink3`, `1px solid var(--ink)` under it.
- Rows: `13px 12px` padding (comfortable) or `7px 12px` (compact toggle), `--line` dividers, `--sf2` on hover.
- Numbers right-aligned, mono, tabular. Dates and ages mono.
- Row actions and links are real links or buttons with a visible focus ring.

## Components

- **Button:** min height 44px, 2px radius, `1px solid var(--ink)`, 600 weight. Variants: default (`--sf`), accent (`--acc`, `--onacc`). **While a request is in flight the button is disabled and shows progress** (`aria-busy`).
- **Field / select:** min height 44px, 2px radius, border `--ink3`. Visible label, always.
- **Combobox (`cmdk`):** for every long list (organisation, skill, category, domicile, discipline), with an "Add new" row where the user may add one.
- **Segmented control:** ink border, pressed state fills `--ink` with `--bg` text.
- **Chips:** status chip (dot + label, tinted background), stage chip (mono, outlined), count pill.
- **Skeleton:** `--sf2` bars with a 1.2s pulse.
- **Empty state:** dashed `--ink3` border on the dot grid, a `title`, one sentence, one accent action.
- **Error state:** `--bad` border on `--badbg`, `role="alert"`, a plain explanation, a Retry button.
- **Icons:** inline stroke SVG, `aria-hidden` when decorative. No emoji. Use SVG, not text glyphs, for check and close marks.

## Every data view has three states

| State | Requirement |
|:---|:---|
| Loading | Skeleton rows or blocks, `aria-busy="true"` and an `aria-label` |
| Empty | What this view is for, and the single next action |
| Error | `role="alert"`, what failed, that the data is safe on disk, Retry |

## Motion

Short and meaningful, CSS only: hover and state transitions at 150ms (`background`, `color`, `transform`), a page-load reveal of about 250ms, and the skeleton pulse. Nothing above 300ms except the pulse. Everything is gated behind `prefers-reduced-motion: no-preference`.

## Accessibility

- WCAG AA for text and for control boundaries (see Contrast).
- Focus: `:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px }`. Never removed.
- Targets: 44px minimum for form fields and buttons. Controls inside dense data tables (row actions, links, checkboxes, the compact row mode) may be smaller but never under 24 by 24px (WCAG 2.2 AA, criterion 2.5.8).
- Real `<button>`, `<a>`, `<input>` with `<label>`. No `onClick` on a `div`. Radix primitives stay keyboard-accessible.
- Switches use `role="switch"` and `aria-checked`.

## Implementation notes

- Define the tokens once in `apps/web/src/app/globals.css` on `:root` (light) and `.dark` (dark), and expose them through the Tailwind theme (`bg`, `surface`, `ink`, `accent`, `ok`, `warn`, `bad`, and so on). No hard-coded hex values in components.
- Fonts through `next/font/google` with `display: 'swap'` and CSS variables `--fd`, `--fb`, `--fm`. Load only the weights listed above.
- Shared components (button, field, chips, table shell, states) live in one place and are reused. No copy-pasted markup.
- The extension (Plasmo) imports the same tokens file.

## Changes from the canvas

1. **Control borders use `--ink3`**, not `--line`, to meet 3:1 non-text contrast.
2. **`--acc-hover` is a token**, not a hard-coded `#B5DE2A` in each screen.
3. **Minimum text size is 11px.** The canvas has some 10 and 10.5px labels.
4. **`needs_info` is labelled "Needs info"**, not "Review", so the chip matches the engine result (ADR 0010).
5. **No accent as text on a light background.** The canvas does this once (Backlog).
6. **One `--scrim` value** per theme (PostMortem differs slightly from the others).

## Canvas follow-ups (not blocking the build)

- **Age limits** (`AddJob`, `Government`): the canvas pre-fills "standard central rules" and shows "18–32 +3". ADR 0010 stores final limits per category on each job and has no pre-filled rules. The form needs a General limit, rows for other categories or flags, and a line for the user's own category. The table should show the limit that applies to the user.
- **Settings → Data & privacy:** use "encrypted backup", not "a ZIP (JSON + PDFs)", and state that the recovery key is not inside the backup (ADR 0008).
- **Loading, empty and error states** are drawn for six screens (Dashboard, Government, Private, Backlog, Revisions, Skill gaps). The other data views (Sources, Learning, Templates, Duplicates, Job detail, Preparedness) still need them.
- **Onboarding:** domicile, degree and skills should be searchable comboboxes (no combobox found).
- **In-flight progress** is drawn for Add job only. Onboarding, Settings, backup, restore and AI actions need it.
- **The email digest screen** hard-codes its colours and has no dark variant. Acceptable for email, but note it.
