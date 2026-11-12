# Project Memory: Job Discovery & Application Tracking System

## Core Context
A local-first, single-user, AI-assisted tracker for government jobs (rule-based eligibility filters) and private jobs (semantic fit scoring), with learning roadmaps. It is built for the author's own use and as a portfolio project. Others can self-host it from the GitHub repo. The public demo is read-only and runs on fake, precomputed data.

## Current State
- **Product scope:** `PRD.md` (8 epics, 3 phases). Section 0 holds the product context.
- **Architecture:** 10 ADRs in `docs/adr/` (all Accepted). 0002–0007 were rewritten on 2026-10-30 for the local-first direction; 0008–0010 are new (2026-11-02 to 11-03) and 0004/0008 were amended on 2026-11-04. The original SaaS-oriented set is preserved in commit `3de4acf`. Next free ADR number: 0011.
- **Stack snapshot:** `docs/STACK.md`, the single source for "what we use". ADRs hold the "why".
- **Next step:** Scaffold the pnpm workspace with `apps/web` (Next.js, Drizzle + libSQL, worker).

## Key Decisions (details in the ADRs; don't duplicate them here)
- **0002 Product direction:** local-first, single user, no multi-tenant hosting, read-only precomputed demo, distributed via GitHub.
- **0003 App architecture:** one Next.js 16 app (RSC, Server Actions, Route Handlers) plus a `worker.ts` process polling a `tasks` table. pnpm workspace. No tRPC, Celery, Redis or Auth.js. Python deferred to Phase 2.
- **0004 Storage:** SQLite/libSQL (vectors, encryption at rest) + Drizzle. drizzle-kit generates migrations; bootstrap applies them at start-up. Uploaded files are BLOBs in the encrypted DB (no `data/files/`). No `user_id` columns.
- **0005 AI:** modes `none` (default) / `ollama` / `byok`. Config: env defaults, Settings (DB) overrides, Reset to default; consent toggle Settings-only. Per-task fallback chains, PII guard, Zod-validated output, pinned embedding model + size (Ollama or BYOK; guarded re-embed), provenance fields. AI runs only in the worker.
- **0006 Ingestion:** manual entry (Phase 1) → curated scraper adapters + Web Clipper (Phase 2), everything through the Backlog.
- **0007 Extension:** Plasmo, pairing token + origin check for the localhost API, LinkedIn limit of 10 per 24 h client-side.
- **0008 Backup/restore:** one encrypted ZIP (plaintext manifest + AES-256-GCM payload), keyed from the recovery key. Logical JSON export, versioned by Drizzle `schema_version`. Secrets and embeddings excluded. Restore builds a staged DB (migrate, then validate), backs up current data, then bootstrap swaps it in after a launcher restart (never under a live connection). Manifest is GCM AAD. Worker runs the export and the restore (a `backup_restore` task: no retry; the typed backup key sits in the task payload only until decryption ends, then is overwritten; the worker exits 75 so the launcher restarts). Keeps the latest 3 `pre-restore-*` files.
- **0010 Eligibility rules:** age limits are stored per job as final limits per category/flag (highest matching row wins); no relaxation templates or rule sets. Lookup tables (categories, regions, levels, disciplines) use a stable text `key` (`custom:<uuid>` for user rows), are seeded and update directly, with a recompute-and-report of changed verdicts. Missing data is `needs_info`, never a pass. Bootstrap step runs migrations (auto pre-migrate copy) and seeding on every start.
- **0009 Recovery key:** `RECOVERY_KEY` env var (32 bytes hex) in the root `.env.local`, outside `data/`. The app never writes env files; `pnpm keygen` generates it (never `pnpm setup`, a pnpm built-in). Missing or wrong key fails fast. Same key for DB and backups. Rotation = backup, new key, restore.

## Open Items
- UI source of truth: `docs/DESIGN.md` (from the design mockups: retro-technical, Bricolage Grotesque + Source Sans 3 + JetBrains Mono, lime accent `#C8F03C`). Its "Mockup follow-ups" list the mockup screens that still contradict ADRs 0008/0010 or lack states.
- Open question in ADR 0010: accept date-bound age limits ("born not before X") in the job form? Decide before M6.
- Servers bind 127.0.0.1 and check `Host`, except under `DEMO_MODE` (ADR 0003); the M2 spike also tests Python opening the encrypted DB.
- Phase 2: decide FastAPI vs a plain Python worker for `services/ingest`.
- Plans: `docs/PHASE-1-PLAN.md`, `PHASE-2-PLAN.md`, `PHASE-3-PLAN.md` hold the task lists. License: MIT (`LICENSE`).