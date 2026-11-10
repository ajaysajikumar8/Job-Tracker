# Tech Stack Reference

> Current tools only, each with a one-line reason. The reasoning behind each decision is in the linked ADR.
> Last updated: 2026-11-04

---

## Architecture Overview

```
                ┌────────────────────── Your machine ──────────────────────┐
                │                                                          │
  Browser ──────┼──▶  apps/web  (Next.js 15)                               │
                │       RSC reads · Server Actions writes · Route Handlers │
                │            │                                             │
  Extension ────┼──▶  /api/clips (pairing token)        [Phase 2]          │
  (Plasmo)      │            │                                             │
                │            ▼                                             │
                │     data/app.db  (SQLite / libSQL, encrypted)            │
                │       tables · JSON columns · vectors · `tasks` queue    │
                │            ▲                     ▲                       │
                │            │                     │                       │
                │     worker.ts (Node)       services/ingest (Python)      │
                │     AI tasks · cron        scrapers · PDF tables         │
                │            │               [Phase 2]                     │
                │            ▼                                             │
                │     Ollama (optional) ── or ── BYOK cloud endpoint       │
                └──────────────────────────────────────────────────────────┘

  Public demo:  Vercel (DEMO_MODE, read-only) ──▶ Turso (fake, precomputed data). No AI calls.
```

---

## 1. Core App: Phase 1 ([ADR 0003](adr/0003-application-architecture.md))

| Tool | Why |
|:---|:---|
| **Next.js 15 (App Router)** | One app for the UI and the backend: RSC reads, Server Actions writes, Route Handlers for the extension. |
| **TypeScript (strict)** | The eligibility rules are edge-case heavy; types catch mistakes early. |
| **Zod** | One schema validates forms, Server Action input, extension payloads and LLM output. |
| **pnpm workspaces + catalogs** | `apps/*` and `packages/*` in one repo, with one lockfile and aligned versions. |
| **tsx** | Runs the `worker.ts` background process. |
| **node-cron** | Recurring schedules (deadline reminders, daily scrapes) inside the worker. |

## 2. UI: Phase 1

| Tool | Why |
|:---|:---|
| **Tailwind CSS** | Theme tokens as CSS variables, light/dark mode, separate status-color set. |
| **Radix UI primitives** | Accessible, keyboard-navigable dialogs, menus, selects. |
| **cmdk** | Searchable comboboxes for long lists (organisations, skills, categories). |
| **TanStack Table v8** | Dense, sortable, filterable application tables with sticky headers. |
| **React Hook Form + Zod resolver** | The long onboarding form without re-rendering on every keystroke; reuses server schemas. |
| **date-fns** | Deadline math and "age as of cutoff date" calculations. |
| **next/font** | Self-hosted fonts with no layout shift; choices recorded in `docs/DESIGN.md`. |

## 3. Data: Phase 1 ([ADR 0004](adr/0004-data-storage.md))

| Tool | Why |
|:---|:---|
| **SQLite via libSQL** (`@libsql/client`) | A single-file DB with native vectors and encryption at rest; nothing to install. |
| **Drizzle ORM + drizzle-kit** | Typed queries; the only migration tool in the repo. |
| **`files` table (BLOBs)** | Resumes and PDFs inside the encrypted database; no file paths. |
| **Bootstrap step** | Before web and worker start: applies a staged restore, migrations (after a pre-migration copy) and lookup seeding. |
| **Turso** | Hosted libSQL for the read-only demo; same driver as local. |

## 4. AI: Optional ([ADR 0005](adr/0005-ai-strategy.md))

| Tool | Why |
|:---|:---|
| **`openai` npm SDK** | One client for Ollama and any OpenAI-compatible BYOK provider. |
| **Ollama** (user-installed) | Free, private local inference. |
| **`nomic-embed-text`** | Default embedding model (768-dim), pinned per install. Runs on Ollama or BYOK. |
| **`llama3.2:3b`** (configurable) | Structured extraction, always validated with Zod. |
| **unpdf** | Resume PDF → text. |
| **mammoth** | Resume `.docx` → text. |

Modes: `none` (default) · `ollama` · `byok`. Each task has a fallback chain plus a PII guard.

## 5. Phase 2 Additions ([ADR 0006](adr/0006-data-ingestion.md), [ADR 0007](adr/0007-browser-extension.md))

| Tool | Why |
|:---|:---|
| **Python + uv** (`services/ingest`) | Python's PDF-table and scraping tools are the strongest available. |
| **FastAPI or a plain worker** | Decided in Phase 2: FastAPI only if Next.js needs synchronous calls. |
| **pdfplumber** (camelot fallback) | Vacancy, eligibility and date tables from government PDFs. |
| **httpx + BeautifulSoup4** | Static HTML scraping for curated adapters. |
| **Playwright (Python)** | Only for sources that render with JavaScript. |
| **Pydantic v2** | Python-side schemas; OpenAPI generates TS types if FastAPI is used. |
| **Plasmo** (`apps/extension`) | MV3 Web Clipper + LinkedIn referral bridge, Chrome and Firefox. |
| **`packages/shared`** | Clip payload schema and enums shared by the web app and the extension. |

## 6. Quality, CI and Distribution

| Tool | Why |
|:---|:---|
| **Vitest** | Unit tests, especially for the eligibility engine. |
| **Playwright (TS)** | A few end-to-end smoke tests against the demo build. |
| **Biome** | Lint and format in one fast tool (replaces ESLint + Prettier). |
| **Ruff + pytest** | Python lint/format and tests (Phase 2). |
| **GitHub Actions** | Typecheck, lint, test and build on every PR. |
| **Docker (single image, optional)** | Self-host convenience: web app + worker, with `data/` mounted as a volume. The app also runs as plain processes. Compose only if Python arrives and the image was built. |
| **Vercel** | Hosts the read-only demo. |
| **Seed/export script** | Runs the AI pipeline locally over sample data and exports it to the demo DB. |

---

## Repository Layout

```
apps/web/            Next.js app + worker.ts          Phase 1
apps/extension/      Plasmo extension                 Phase 2
packages/shared/     Zod schemas, enums, types        Phase 2 (created when a 2nd consumer exists)
services/ingest/     Python ingestion (uv)            Phase 2, outside the pnpm workspace
docs/                PRD support, ADRs, STACK, DESIGN
data/                Local DB, backups, restore staging (git-ignored)
.env.local           Recovery key and AI defaults, repo root (git-ignored)
```

Rules: `apps → packages` only; a package exists only once it has two consumers; internal packages export TS source (no build step).

---

## Deliberately Not Used

| Dropped | Reason |
|:---|:---|
| PostgreSQL + pgvector | A database server for one user; libSQL covers relational data, JSON and vectors. |
| Redis + Celery | The `tasks` table + worker is enough for one user. |
| tRPC | Server Actions already give typed calls in a single app. |
| TanStack Query, SSE | Not needed for one user; add only if a concrete screen needs it. |
| Auth.js | Single user; optional local passcode only. |
| Prisma | Heavier; weaker libSQL support than Drizzle. |
| Cloudflare R2 / S3 | No hosted file storage. |
| LangChain | No chains or agents; single structured calls. |
| Turborepo / Nx | Unnecessary with 1–3 packages. |
| Kanban boards | Dense tables suit the data better. |

---

## ADR Index

| ADR | Decision |
|:---|:---|
| [0001](adr/0001-record-architecture-decisions.md) | Use ADRs for architectural decisions |
| [0002](adr/0002-product-direction.md) | Local-first personal tool; precomputed read-only demo; distributed via GitHub |
| [0003](adr/0003-application-architecture.md) | Single Next.js app + worker in a pnpm workspace; Python deferred to Phase 2 |
| [0004](adr/0004-data-storage.md) | SQLite (libSQL) + Drizzle; files as BLOBs in the encrypted DB; auto-migration at start-up; single-user schema |
| [0005](adr/0005-ai-strategy.md) | Optional AI: `none` / `ollama` / `byok`, fallback chains, PII guard, pinned embeddings |
| [0006](adr/0006-data-ingestion.md) | Manual entry → curated scrapers → Web Clipper, all via the Backlog |
| [0007](adr/0007-browser-extension.md) | Plasmo extension with pairing token and LinkedIn rate limits |
| [0008](adr/0008-backup-and-restore.md) | Encrypted, versioned ZIP backup keyed by the recovery key; stage the restore, swap the database in bootstrap |
| [0009](adr/0009-recovery-key-storage.md) | Recovery key lives in the `RECOVERY_KEY` env var (root `.env.local`); app never writes env files; `pnpm keygen`; rotation via backup + restore |
| [0010](adr/0010-eligibility-rule-model.md) | Age limits typed per job (highest matching row wins); seeded lookup lists keyed by stable text keys; pure eligibility engine |
