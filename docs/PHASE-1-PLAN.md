# Phase 1 Implementation Plan: Core Tracker MVP

> Scope: PRD §6 Phase 1 (Epics 2, 4, 7, encrypted backup/restore, optional AI, read-only demo).
> Status: Draft, 2026-11-02. This file is the task list. Tick boxes as work lands.
> Each task has a **Done when** line. A milestone is finished only when all its gates pass.

## Ground rules

- **Real data rule:** no real personal data (DOB, category, CTC, resume) goes in until **M8 (backup/restore)** is done. The PRD calls backup the only safety net.
- **Phase gate:** nothing from "Not in Phase 1" below gets built here.
- A new ADR is needed for every major technical choice. Next free number: **0011**. Do not rewrite or renumber an ADR once code refers to it; supersede it or add a dated amendment.
- Update `MEMORY.md` at the end of each milestone.

## Milestone order

```
M1 Scaffold ─▶ M2 Data layer ─▶ M3 Worker ─▶ M4 Design system + shell
      ─▶ M5 Profile ─▶ M6 Eligibility ─▶ M7 Jobs/tracker + dashboard
      ─▶ M8 Backup/restore  ── real data allowed from here ──
      ─▶ M9 Optional AI ─▶ M10 Demo ─▶ M11 Docker, docs, e2e
```

M5–M7 give a usable slice with no AI. M8 comes before AI because the schema is still moving and the restore fixture tests are cheapest to start early.

---

## M1: Scaffold and tooling

- [ ] **pnpm workspace** with only `apps/web` (`pnpm-workspace.yaml`, catalogs for React, Zod, TypeScript). **Done when:** `pnpm install` works from a clean clone.
- [ ] **Next.js 15 App Router + TypeScript strict** in `apps/web` (`noUncheckedIndexedAccess` on). **Done when:** `pnpm --filter web dev` serves a placeholder page.
- [ ] **Biome** (lint + format) and **Vitest**. **Done when:** `pnpm lint`, `pnpm typecheck`, `pnpm test` all run from the root, and a trivial test passes.
- [ ] **`pnpm keygen` script** (ADR 0009): generates `RECOVERY_KEY` into the root `.env.local` only if absent or empty, never overwrites a non-empty key, prints the key once. **Done when:** a second run leaves the key unchanged, an empty `RECOVERY_KEY=` line is filled in (not duplicated), and the file is written with `0600` permissions.
- [ ] **Single `pnpm dev` launcher** (also behind `pnpm start` and the Docker entrypoint) that runs bootstrap, then starts web and worker together (worker is a stub at this point), with the web server bound to `127.0.0.1` (ADR 0003). If either process exits with code 75 (a staged restore, ADR 0008) it stops the other and runs bootstrap again. **Done when:** one command starts both, Ctrl-C stops both, exit code 75 triggers a clean restart, and the app is not reachable from another machine.
- [ ] **Env validation:** one Zod-parsed `env.ts`, shared by web, worker, bootstrap and the launcher. It loads the root `.env.local` with `loadEnvConfig` from `@next/env` (ADR 0009), because Next.js alone reads only `apps/web` and `tsx` reads nothing. `RECOVERY_KEY` must be 64 hex chars unless `DEMO_MODE=1`, where it is neither required nor read; the app fails fast with a readable message (including the generator command) and never prints the key. AI variables (`AI_MODE`, `OLLAMA_BASE_URL`, `EMBEDDING_MODEL`, `EXTRACTION_MODEL`, `BYOK_*`) are optional with defaults; an invalid `AI_MODE` fails fast. An empty value (`BYOK_BASE_URL=` copied from `.env.example`) counts as unset, so the schema must not run `.url()` on `""`. **Done when:** a missing or malformed key stops startup, `DEMO_MODE=1` starts without one, web and worker read the same file, and a test asserts the key never appears in logs or error output.
- [ ] **GitHub Actions:** typecheck, lint, test, build on PRs. **Done when:** a PR runs green.

## M2: Data layer

**Spike first. It gates the rest of this milestone.**

- [ ] **Spike (throwaway script, not committed to `apps/`):** against `@libsql/client` with a local `file:` URL, verify all seven:
  1. `encryptionKey` works on a local file.
  2. `F32_BLOB(768)` columns and vector functions work **together with** encryption.
  3. Two separate processes (web + worker) can open the same encrypted file in WAL mode, with one writing and one reading.
  4. The Drizzle migrator runs on the encrypted file, including the sliced `migrateTo(version)` used by restore (ADR 0004 amendment).
  5. A wrong key on an existing file fails with a detectable error and creates nothing (ADR 0009).
  6. The native `libsql` module bundles under `next dev` / `next build` and loads in the planned Docker base image (use Debian slim rather than Alpine if musl fails).
  7. A **Python** process can open the same encrypted file with the same key while another process has it open. Phase 2 depends on this, and learning it now is cheaper than after the schema exists.

  Vector search uses brute-force `vector_distance_cos` over `F32_BLOB(768)`; do **not** create a vector index (hundreds of rows do not need one, and it avoids another encryption risk). **Done when:** all of 1–6 pass, 7 is answered either way, and the outcome is recorded in ADR 0004 (an amendment, even when everything passes). **Gate:** if 1–3 fail, stop and amend ADR 0004 (options include `sqlite-vec`, or file-level encryption) before writing the schema. If only 7 fails, record the Phase 2 fallback (Python posts results through an authenticated local Route Handler) in ADR 0004.
- [ ] **DB client module:** a singleton that survives Next.js dev HMR (store on `globalThis`), WAL on, `busy_timeout` set, key read from `RECOVERY_KEY` (ADR 0009). Wrong key on an existing DB exits with "RECOVERY_KEY does not match this database" and never creates a new file. **Done when:** repeated hot reloads do not open multiple connections, and the wrong-key case is tested.
- [ ] **Drizzle schema, Phase 1 tables:** `profile` (single row), `files` (BLOB uploads, ADR 0004 amendment), `job_postings`, `job_posting_history`, `applications`, `stage_history`, `settings`, `reminder_dismissals`, `tasks`. Notes:
  - No `user_id` columns (ADR 0004).
  - Enums as text with a Zod check. `lifecycle_stage` keeps `BACKLOG` in the enum for forward compatibility, but Phase 1 never writes it.
  - `preparedness_score` column may exist, but nothing computes it.
  - Every AI-derived column has `provider`, `model`, `prompt_version`, `generated_at`.
  - `embedding F32_BLOB(768)` plus `embedding_model`.
  - Add `created_at` / `updated_at` everywhere. `job_posting_history` keeps the old values after corrigendum edits (deadline extensions).
  - References to lookup rows are stored as text keys, with no foreign keys to `ref_*` tables (ADR 0010).

  **Done when:** schema reviewed against PRD §5 and ADR 0004, with indexes on `lifecycle_stage`, `deadline`, and `tasks(status, run_after)`.
- [ ] **Lookup tables (ADR 0010):** `ref_categories`, `ref_regions`, `ref_qualification_levels`, `ref_disciplines`, each with a text primary `key` (seeded: permanent key from the seed file; custom: `custom:<uuid>`), `deprecated`, and `is_custom` for user-added rows. Seeded read-only from JSON; seeding inserts missing rows, updates a row in place when its values differ, marks removed rows `deprecated`, never touches custom rows, and enqueues `recompute_eligibility` in the same transaction when anything changed. Registered in the backup table registry (custom rows only). **Done when:** tests cover re-seeding twice (no change), a changed value updating the same row (its key and references stay valid), a removed row being deprecated and not deleted, custom rows surviving, a first start inserting everything, two concurrent runs not duplicating rows, and a changed seed enqueuing exactly one recompute task. A CI check validates seed files (required fields, unique keys, no `custom:` prefix, every parent key exists).
- [ ] **Bootstrap step** (ADR 0010, ADR 0004 amendment): validate env → apply a staged restore if `data/restore/pending.json` exists (ADR 0008 step 8) → WAL checkpoint and pre-migration copy, only when migrations are pending (keep latest 3) → apply migrations → seed. Run by the launcher (`pnpm dev`, `pnpm start`, the Docker entrypoint) before web and worker start, and again after a staged restore. Also available as `pnpm bootstrap` and `pnpm seed`. Seeding failure is non-fatal with a visible banner; migration failure is fatal. No writes in `DEMO_MODE`. **Done when:** a simulated app update with a newer seed file updates the lookup rows on the next start with no manual command, and a failed migration leaves the pre-migrate copy and refuses to start.
- [ ] **`scraper_sources`:** **create in Phase 2, not now.** ADR 0008 lists it in the backup, so the backup code must tolerate a table that does not exist yet (export is driven by a table registry, not a hard-coded list). **Done when:** the decision is recorded in the M8 task below.
- [ ] **First migration** generated with drizzle-kit and applied by the bootstrap step (ADR 0004 amendment), not by a manual command. Requires the recovery key (ADR 0009) to exist first. **Done when:** starting the app on an empty `data/` creates `data/app.db`, and opening that file without the key fails.
- [ ] **Zod schemas for every JSON column** and every entity, in one place, reused by forms, Server Actions and backup validation. **Done when:** a round-trip test (insert → read → parse) passes for each table.
- [ ] **Repository layer** (thin query functions per aggregate) so Server Actions stay small. **Done when:** no component imports `db` directly.

## M3: Worker and task queue

- [ ] **`worker.ts` poll loop** with an **atomic claim** (single `UPDATE ... WHERE status='queued' AND run_after <= now ... RETURNING`). **Done when:** two worker instances never run the same task (tested).
- [ ] **Retry with exponential backoff**, `attempts` cap, `last_error` stored. A task type can opt out of retry and of stale re-queue (needed by `backup_restore`, ADR 0008: its key is gone after the first attempt). **Done when:** a task that always throws ends as `failed` after N attempts, and a crashed non-retryable task ends as `failed`, not `queued`.
- [ ] **Stale-task recovery:** on start, tasks stuck in `running` past a timeout go back to `queued`. **Done when:** killing the worker mid-task and restarting finishes the task.
- [ ] **Handler registry** keyed by task `type`, payload validated with Zod. **Done when:** an unknown type or bad payload fails the task, not the process.
- [ ] **`node-cron` host** with a daily maintenance stub. Reminders themselves are derived at read time (M7), so a run missed while the machine was off loses nothing. **Done when:** a log line appears on schedule.
- [ ] **Worker heartbeat and banner (ADR 0007 amendment):** the worker writes a timestamp to a settings row every ~10 s (excluded from backups); the app shows "Background worker isn't running, tasks are waiting" when it is older than ~30 s. **Done when:** stopping the worker shows the banner within a minute, and restarting it clears the banner and runs the queued tasks.
- [ ] **Graceful shutdown** (finish or release the current task on SIGTERM). **Done when:** shutdown during a task leaves no `running` orphan.

## M4: Design system and app shell

*Requires `docs/DESIGN.md`.*

- [ ] **Theme tokens as CSS variables** exposed through Tailwind, light + dark. Status colors are a separate semantic set from the accent. **Done when:** both themes pass WCAG AA on text and focus rings.
- [ ] **Fonts via `next/font`** with real fallback stacks; tabular-figure font for numbers. **Done when:** no layout shift, and no banned fonts in use.
- [ ] **Shared primitives** (Radix-based): Button (with in-flight state), Dialog, Select, Combobox (cmdk), Toast, Form field. **Done when:** each is keyboard-accessible and used by at least one screen.
- [ ] **Shared data-view states:** `Loading`, `Empty`, `Error` components. **Done when:** every list screen later uses them, with no ad-hoc versions.
- [ ] **App shell:** sidebar/nav, theme toggle, desktop-first layout. **Done when:** navigation between placeholder routes works with the keyboard.
- [ ] **Host allow-list middleware** (ADR 0003): reject any request whose `Host` (port stripped) is not `localhost`, `127.0.0.1` or `[::1]`, on every route and Route Handler. Skipped under `DEMO_MODE`, otherwise the Vercel demo would reject every request. LAN use is an explicit opt-in that requires the passcode; settle that mechanism here. **Done when:** a request with a foreign `Host` header gets a 4xx, a test covers a rebinding-style request, and `DEMO_MODE=1` serves a non-localhost `Host`.
- [ ] **Passcode middleware (optional, off by default):** hashed passcode check, cookie session. **Done when:** with a passcode set, every route and Route Handler is gated.
- [ ] **`DEMO_MODE` write guard, built now, not at M10.** One helper (`assertWritable()`) called by **every** Server Action and mutating Route Handler, plus a lint rule or test that fails if a Server Action file lacks the call. Hiding buttons alone is not enough. **Done when:** with `DEMO_MODE=1`, a direct POST to any action is rejected server-side.

## M5: First-run flow and Profile (Epic 7)

- [ ] **First-run screen** (ADR 0009: the key already exists in the env, so the screen does not create it): confirm the user has saved the key outside this machine, optional passcode, and a **Restore from a backup (.zip)** entry point (wired up in M8). (The PRD's Phase 1 list includes it.) **Done when:** a fresh install cannot reach the app until the user confirms the key is saved.
- [ ] **"Reveal recovery key"** in Settings: reads the env var, passcode-gated when set, rate-limited, `Cache-Control: no-store`. **Done when:** the key is absent from every other response and from client bundles (tested by grep on the build output).
- [ ] **Manual intake form** (React Hook Form + shared Zod schema): DOB, category, domicile, degrees, top skills, years of experience, CTC. Searchable comboboxes for skills and categories. **Done when:** invalid input is rejected on both client and server, and the form survives a reload.
- [ ] **Profile page** with view/edit. **Done when:** edits persist and `updated_at` changes.
- [ ] **Resume upload (PDF/DOCX):** 10 MB cap, MIME + magic-byte check, stored as a BLOB in the `files` table (ADR 0004 amendment), so there is no file path and no user-supplied filename on disk. Text extraction (`unpdf`, `mammoth`) runs as a **worker task** reading the BLOB, not in the request. **Done when:** a malformed or renamed file is rejected, and extracted text appears on the profile without AI.

## M6: Rule-based eligibility engine (Epic 2, government)

*Requires ADR 0010.*

- [ ] **Pure TypeScript module** (no DB, no I/O): `evaluate(profile, criteria) → EligibilityResult` as specified in ADR 0010. The age limit is the highest `max` among the General limit and all matching rows (no adding or stacking). A separate thin loader reads the DB. **Done when:** it imports nothing from Next.js or Drizzle.
- [ ] **Criteria entry UI:** job form section with the General limit and rows for other categories or flags, each holding the final limit. Always shows a line for the profile's own category and flags ("does the notification give you a different limit?"). Normalises age wording ("not above N" / "below N" / "N years") to inclusive numbers. Offers `as_on` presets (last date of application, 1 January of the year, custom) and asks, never silently changes, when a corrigendum moves the deadline. Has an "allow final-year candidates" checkbox per qualification option, and keeps `manual_checks`. **Done when:** each phrasing stores the right numbers (tested), and a `pursuing` qualification without the checkbox yields `needs_info`.
- [ ] **Eligibility override** with a note, never overwritten by recompute. **Done when:** a recompute leaves overrides intact.
- [ ] **Recompute-and-report after lookup-data changes:** when seeding changes a lookup row it has already enqueued `recompute_eligibility` (M2); the worker recomputes all open applications, records each previous status, and raises a reminder listing any application whose status changed (old status, new status, reason). **Done when:** a seeded change to the discipline tree that flips one verdict produces exactly one reminder naming that application, and an unchanged verdict produces none.
- [ ] **Age check** with `date-fns`, cutoff-date based, timezone-safe (plain `YYYY-MM-DD` dates, never timestamps). Adds a warning when a candidate fails and more than one limit row matched. **Done when:** the ADR's worked examples pass: birthday on the cutoff, leap-day DOB, combined-row warning.
- [ ] **Degree, domicile and category checks**, each returning a reason string for ineligibility. **Done when:** every failure path has a human-readable reason.
- [ ] **`needs-info` result** when profile data is missing, instead of guessing. **Done when:** an empty profile never produces a false "eligible".
- [ ] **Test suite in Vitest** with a table of cases from real notification wording. **Done when:** 100% branch coverage on the module.
- [ ] **Wire into jobs:** eligibility is recomputed when the profile or job criteria change, and stored on the application with the reason. **Done when:** changing DOB on the profile updates affected applications.

## M7: Jobs, tracker and dashboard (Epics 2, 4)

- [ ] **Job form (manual entry):** sector type, organization (combobox), title, work model, dates, vacancies, source URL, eligibility criteria (structured), optional pasted description. Enters at `DISCOVERED`. **Done when:** create/edit/delete work, with Zod validation on every input and the submit button disabled while in flight.
- [ ] **Corrigendum support:** editing a posting records the previous values (deadline extensions are common for government jobs). **Done when:** the job page shows "deadline changed from X to Y".
- [ ] **Applications table (TanStack Table):** sticky header, tabular numbers, sort, filter by stage/sector/deadline, URL-synced filters. **Done when:** it stays usable at 500 rows (pagination or virtualisation decision recorded).
- [ ] **Lifecycle transitions:** `DISCOVERED → APPLIED → ASSESSMENT → INTERVIEW → OFFER`, and `REJECTED`. Transitions run inside a transaction and write a stage-history row. Moving to `REJECTED` records a required `rejection_reason` (`rejected` / `no_response` / `withdrawn`) and a plain note field: the post-mortem prompt is Phase 2. A `REJECTED` application can be **reopened** to any earlier stage the user picks (recruiters sometimes reply weeks later): same transaction, a stage-history row, and `rejection_reason` cleared (history keeps it). **Done when:** an invalid transition is rejected server-side, `REJECTED` without a reason is rejected, and a `no_response` application reopened to `INTERVIEW` shows the full trail in its history.
- [ ] **Sector tabs:** Government (eligibility, vacancies, category quotas, exam dates) and Private/IT (skills, recruiter name and contact, fit score placeholder). **Done when:** each tab has loading, empty and error states.
- [ ] **Follow-up action (private applications):** a "Followed up" button on the application (sets `last_contact_at`, optional snooze date into `next_action_due`) and optional `recruiter_name` / `recruiter_contact` fields. Defaults of 7 days after applying (only when a recruiter contact is set), 5 days after an assessment or interview, and 45 days for the housekeeping line live in `settings`. **Done when:** the button restarts the clock, snoozing overrides the default threshold, and both are validated with Zod.
- [ ] **Dashboard:** counts, top 3 upcoming deadlines, best fit/eligible job right now, and in-app reminders. Asymmetric layout per the design rules. **Done when:** a deadline within 24 h shows a reminder, with no AI.
- [ ] **Reminders are derived at read time** (decision recorded here): deadline-within-24h, no backup or backup older than 30 days (M8), and recompute-changed-verdict reports are computed from current data when the dashboard loads, so a sleeping machine never misses one. Only dismissals are stored (`reminder_dismissals`, keyed by reminder type + subject + trigger date). **Done when:** a reminder can be dismissed and does not reappear until its trigger changes (for example a new deadline).
- [ ] **Follow-up reminder** (derived like the rest): a private application in `ASSESSMENT` or `INTERVIEW`, or in `APPLIED` with a `recruiter_contact`, whose latest activity (last stage change or `last_contact_at`) is older than the threshold, or whose `next_action_due` has passed, shows "No reply from <organisation> in N days". Trigger date is the due date, so a new follow-up lets it return. Group as "N applications awaiting reply" above a cap so a backfill does not flood the dashboard, and suggest closing with `no_response` after repeated follow-ups. Cold `APPLIED` applications (no recruiter contact) get no follow-up reminder; the table shows days since applied, and after 45 days they join one grouped, dismissible "N applications with no response. Close them?" line that closes only the ones the user selects. Government applications are excluded. **Done when:** an `APPLIED` application with a recruiter contact, 8 days old, shows the reminder; the same one without a contact does not; "Followed up" removes it until the next threshold; a snoozed one stays hidden until its date; 20 stale applications render as one grouped line; and nothing is ever closed without a user action.

## M8: Encrypted backup and restore (Feature 4, ADR 0008)

*Requires ADR 0008 Accepted and ADR 0009.*

- [ ] **Table registry** that drives export, import and validation (so `scraper_sources` and future tables are added in one place; a missing table is tolerated). It supports column-level redaction (for the secrets in `settings`) and custom-rows-only export (for the `ref_*` tables). **Done when:** adding a table without registering it fails a test.
- [ ] **Export task** in the worker: one read transaction for a consistent snapshot, JSON per table (file BLOBs as binary entries named by file id), `payload.enc` with AES-256-GCM (HKDF-derived key + random salt in manifest, manifest bytes as AAD), `manifest.json` with `payload_sha256`. Written to `data/backups/`. **Done when:** the file cannot be opened without the key, and contains no secrets (API key, pairing token, passcode hash), no embeddings and no `tasks` rows.
- [ ] **Download Route Handler** (streams the file, passcode-gated, blocked in `DEMO_MODE`). **Done when:** unauthenticated requests get 401 when a passcode is set.
- [ ] **Restore pipeline**, in this order, with a test per step (ADR 0008): stream upload to `data/restore/` with size cap, then a Server Action enqueues one `backup_restore` worker task (one at a time, no retry, the typed key in its payload); the rest runs in that task → read manifest → reject unknown `format_version` / newer `schema_version` → verify the GCM tag in a first pass, then decrypt in a second pass straight into the archive reader, with no plaintext file on disk (wrong key, tamper or an edited manifest fails the first pass, nothing parsed) → overwrite the key in the task payload, on success and on failure → verify hash → file-name and zip-bomb checks → build `staged.db` at the backup's `schema_version` with `migrateTo`, insert rows, migrate forward, Zod-validate every row against the current schemas → pre-restore backup → write `pending.json`, mark the task done and the worker exits 75 for a launcher restart → bootstrap swaps (delete stale `-wal`/`-shm`, atomic rename) before any connection opens, or renames `pending.json` to `failed-<timestamp>.json` and keeps the old database → re-queue embeddings. **Done when:** a failure injected at each step leaves the original data untouched, an old-version fixture restores, web and worker both read the new data after the restart (no process keeps the old file open), and the backup key is absent from the `tasks` table after a success, a wrong key and a worker crash.
- [ ] **Fixture harness:** a committed backup fixture per released `schema_version`, and a test that restores each one. Must be in place before the schema churns further. **Done when:** CI restores the oldest fixture on every run.
- [ ] **Settings → Data & privacy:** Back up everything, last backup date, Restore, Reveal recovery key, post-restore checklist (re-enter API key, re-pair extension, set passcode). Uses the UI copy rules from ADR 0008. **Done when:** the whole flow works from both an empty install and Settings.
- [ ] **Retention** of `pre-restore-*` files (default: keep latest 3, shown in UI). Manual backups are never auto-deleted; Settings shows how many exist and their total size.
- [ ] **Dashboard backup reminder** (ties into M7 reminders). **Done when:** it shows on "never backed up" and ">30 days".
- [ ] **Passcode required for restore when a passcode is set**, and a LAN-exposure warning at first run. **Done when:** restore is rejected without a valid session.

> **Gate:** M8 finished means the real-data rule is lifted.

## M9: Optional AI (ADR 0005)

- [ ] **`AIClient`** on the `openai` SDK: `baseURL`, key and model per provider. Modes `none` (default) / `ollama` / `byok`. **Done when:** with `none`, no AI UI is shown and no AI task is ever queued.
- [ ] **AI configuration (ADR 0005):** a `getAiConfig()` resolver: database override, else environment default, else built-in default. **Settings → AI** shows each field's source ("from environment" / "overridden"), lets the user override it, and has Reset to default. Includes a connection test and the "allow cloud processing of personal data" toggle (Settings only, default off, never from env). **Done when:** an override beats the environment, Reset restores the environment value, and neither a saved nor an environment API key is ever returned to the browser (only "set" / "not set"). A key saved in Settings is excluded from backups.
- [ ] **Per-task routing**: fallback chains, retry rules (429/5xx retry then fall back; 401/403 fall back with a warning; 400 no fallback; invalid output retry once then next), circuit breaker. **Done when:** each rule has a unit test with a fake provider.
- [ ] **PII guard** as a single choke point in the client, not per call site. **Done when:** a `containsPii` task (including `embedProfile`) cannot reach `byok` unless allowed (tested).
- [ ] **Zod-validated structured output** for every prompt, with `prompt_version` constants. **Done when:** malformed model output is a handled failure, never a crash.
- [ ] **Tasks:** `resume_parse` (resume text → skills, shown as suggestions the user confirms, never auto-overwriting manual intake), `skill_extract` (job description → skills), `embed_job` / `embed_profile`, `fit_score` (private jobs only). **Done when:** each runs in the worker and writes provenance fields.
- [ ] **Embedding pinning (ADR 0005 amendment):** the pin is model id + vector size, stored in settings; the chain is `ollama`, `byok`, with no fallback model; the size is fixed at 768 by the schema. Changing the model, a start-up mismatch and a restore on BYOK ask for confirmation before a full re-embed. A 404 "model not found" pauses embedding tasks with a banner and a coverage count. **Done when:** vectors from different models are never compared, and tests cover the wrong-length vector (rejected, never written), the mismatch banner, the model-unavailable state, and switching `none` / `ollama` / `byok` without a re-embed.
- [ ] **UI:** fit score with "scored by <model>" tooltip, a stale badge when `prompt_version` is old, and a clear "queued / failed, retry" state. **Done when:** Ollama stopped mid-task leaves the task queued, not lost.
- [ ] **Do not apply AI to government eligibility.** **Done when:** a test asserts the eligibility module has no AI import.

## M10: Read-only public demo (ADR 0002)

- [ ] **Fake sample dataset**: a profile, 30–50 jobs across both sectors, varied stages and deadlines. No real person's data. **Done when:** a reviewer cannot identify any real person or organisation's confidential data.
- [ ] **Seed/export script** that runs the AI pipeline locally over the sample data and writes results (scores, skills, embeddings) into the demo DB. **Done when:** the demo DB contains every precomputed value the UI shows.
- [ ] **Turso database** for the demo, same driver. **Done when:** the app runs against it with `DEMO_MODE=1`.
- [ ] **Audit the M4 write guard**: enumerate every Server Action and Route Handler and confirm each is covered; disable uploads, export, restore, AI settings and the worker. **Done when:** a script that POSTs to each endpoint gets rejections on all of them.
- [ ] **Demo banner** and disabled-state UI with an explanation ("read-only demo"). Zero live AI calls. **Done when:** the network log shows no outbound AI requests.
- [ ] **Vercel deployment.** **Done when:** the demo URL loads and every screen has populated data.

## M11: Docker, docs and end-to-end tests

- [ ] **Single Docker image (optional; the app also runs as plain processes with `pnpm dev` / `pnpm start`)** (web + worker, `data/` as a volume, non-root user, healthcheck Route Handler, the process binds `0.0.0.0` inside the container so the published port can reach it, and the port is published as `127.0.0.1:3000` only). Add a `.dockerignore` first (`.env*`, `data/`, `.git`), because `COPY . .` would otherwise bake the recovery key and the database into the image. **Done when:** `docker run` on a clean machine reaches first-run, data survives a container restart, and `docker history` / a file listing of the image shows no `.env.local` or `data/`.
- [ ] **README:** install (pnpm and Docker), Ollama setup (in Docker, `host.docker.internal`), recovery key and backup instructions, the full-disk-encryption caveat (the key sits in `.env.local`, ADR 0009), the localhost-only default and the LAN opt-in warning, how to restore a `pre-migrate-*` copy by hand. **Done when:** a fresh reader can run it without asking.
- [ ] **Playwright smoke tests** against the demo build: load each main screen, confirm writes are rejected. **Done when:** they run in CI.
- [ ] **Performance and scale pass:** the applications table with seeded 2,000 rows, dashboard query timings, DB indexes reviewed. **Done when:** numbers are recorded in this file.
- [ ] **Update `MEMORY.md`, `docs/STACK.md` and the ADR index.**

---

## Not in Phase 1

Out of scope for Phase 1:

- Backlog / Triage queue, duplicate check, scraper adapters, `scraper_sources` table, `services/ingest` (Python) → **Phase 2**. Manual jobs enter at `DISCOVERED`.
- Web Clipper, LinkedIn referrals, pairing token, `/api/clips` → **Phase 2** (`apps/extension`, `packages/shared`).
- Post-mortem prompt on `REJECTED`, keyword-to-roadmap injection, foundation-based upskilling (Epic 3) → **Phase 2**.
- Duplicate detection via embeddings → **Phase 2**.
- Vacancy extraction from PDFs (Epic 5), LMS, starter templates, spaced repetition, **Preparedness Score computation** (Epic 6) → **Phase 3**. The column may exist; nothing fills it.
- Email digest, browser/extension notifications → later. Phase 1 reminders are in-app only.
- Sending follow-up emails, reading the inbox to detect replies, AI-drafted follow-up messages → not planned (drafting may come in Phase 2).

## Risks and scalability notes

| Risk | Mitigation |
|:---|:---|
| libSQL encryption + vectors + two-process WAL may not work together | M2 spike is a hard gate |
| Lost recovery key means lost data and unreadable backups | ADR 0009, forced save at first run, clear UI copy |
| Key sits in `.env.local` on the same machine | Documented; full-disk encryption covers a compromised machine (ADR 0009). Resumes are inside the encrypted DB (ADR 0004 amendment) |
| Another web page reaches the localhost app (DNS rebinding, LAN) | Bind `127.0.0.1`, Host allow-list, passcode required for LAN (ADR 0003) |
| Restore is the highest-risk input path | Validate-before-write order, fault-injection tests, passcode gate, swap only in bootstrap |
| Server Action missing the demo guard | Single helper plus a test that scans every action file |
| Schema churn breaking old backups | Fixture-restore tests from M8 onward |
| SQLite single writer | Fine for one user + one worker; keep transactions short and `busy_timeout` set |
| Phase 1 is large for one person | M5–M7 are a shippable slice; M9 and M10 can slip without blocking real use |
