# AI Agent Instructions (AGENTS.md)

## Project
Job Discovery & Application Tracking System: a local-first tracker for government and private job applications. Product scope is in `PRD.md`.

## Project Guidelines
1. **Context Maintenance**: Always review `MEMORY.md` and `PRD.md` before making sweeping changes or suggesting new features. Update `MEMORY.md` when completing a major milestone.
2. **Architecture Decisions**: Any major technical choice (database selection, framework change, API design pattern) must be documented as an ADR in `docs/adr/`. Once code refers to an ADR, do not rewrite or renumber it: supersede it with a new ADR (or add a dated amendment section).
3. **Phased Execution**: Adhere strictly to the Phased Rollout strategy outlined in `PRD.md`. Do not build Phase 3 features (like the LMS) when we are executing Phase 1 (Core Tracker).
4. **Code Quality**: Write modular, typed, and well-documented code. We are building a scalable system brick by brick.

## Frontend Design Rules (Avoid Generic AI-Looking UI)
These apply to any UI work in the Next.js app or the Plasmo extension.

### Aesthetic Direction
- Before writing UI code, pick one clear aesthetic direction (e.g., editorial, brutalist, retro-technical, soft organic, industrial). State it in one sentence, then apply it consistently.
- Once a direction is set for the app, record it in `docs/DESIGN.md` and reuse it. Do not invent a new direction per screen.

### Typography
- Do not use Inter, Roboto, Arial, Helvetica, or `system-ui` as the main fonts.
- Pair a distinctive display font for headings with a clean humanist sans for body text. Use a monospace or tabular-figure font for numbers in data tables.
- Load fonts via `next/font` (Google or self-hosted). Always define a real fallback stack.
- Use a defined type scale. Build hierarchy with weight and size contrast.

### Color
- Do not use purple-to-blue gradients, especially on white backgrounds.
- Use a monochromatic base (neutrals, or one hue in several tones).
- Add one sharp, intentional accent color. Use it sparingly, only for key actions and highlights.
- Status colors (eligible / ineligible, lifecycle stages, deadlines) are a separate semantic set. Do not reuse the accent color for them.
- Define all colors as CSS variables exposed through the Tailwind theme. Support light and dark mode.

### Layout and Surfaces
- Do not default to uniform grids of identical rounded-corner cards.
- On dashboard and overview screens, use asymmetric layouts, varied column widths, and deliberate whitespace.
- Add depth with layered gradients, subtle textures (dot grids, grain, fine lines), and considered borders or shadows. Keep textures off dense data areas.
- Vary corner radius on purpose. Do not apply one radius everywhere.
- Data tables (TanStack Table) put density and scanability first: aligned columns, tabular numbers, sticky headers. Decorative layout rules do not override readability there.

### Motion
- Use a few meaningful animations (page-load reveal, hover, state change).
- Prefer CSS transitions. Keep durations short (roughly 150–300 ms). Respect `prefers-reduced-motion`.

### UI Quality
- Every data view has loading, empty, and error states.
- Use searchable comboboxes for long lists (organizations, skills, categories).
- Disable submit buttons and show progress while a request is in flight.
- Meet WCAG AA contrast. Keep focus states visible; Radix primitives must stay keyboard-accessible.
- Layouts are responsive but desktop-first, per the PRD NFR.

### Stack
- Next.js 15 (App Router), React, TypeScript, Tailwind, Radix UI primitives.
- Build shared components in one place and reuse them. Do not copy and paste markup.

### Output Format for UI Work
- State the aesthetic direction, the two fonts, and the accent color first (or confirm the existing ones from `docs/DESIGN.md`).
- Then give the code.
- End with a short checklist: which of these rules were met, and which were skipped and why.

## AI Tools
- For deep research or codebase exploration, utilize your subagent capabilities.
- When creating new ADRs, increment the numerical prefix (e.g., `0002-choose-database.md`).
