# Phase 2 Implementation Plan: Discovery Pipeline and Backlog

> Scope: PRD §6 Phase 2 (Epics 1, 3 and 8). ADRs 0006 and 0007.
> Status: Draft, 2026-11-02. Planned at a coarser grain than Phase 1 on purpose: Phase 1 will surface things that change this. **Re-read and refine this file at the start of Phase 2 (task P2-M0).**
> Ground rules from `PHASE-1-PLAN.md` still apply (an ADR for major choices; update `MEMORY.md` per milestone).

## Entry gate

Phase 2 starts only when Phase 1 is done and used for real for at least a couple of weeks. Specifically:

- [ ] Phase 1 M1–M8 complete (backup/restore working with fixtures), plus the README from M11. The Docker image (M11) is optional and not part of this gate. M9 (AI) and M10 (public demo) may still be open: Phase 1's own risk table lets them slip, and nothing in Phase 2 requires them, except that the embedding duplicate matcher (P2-M2) needs M9.
- [ ] Real jobs have been entered by hand. The pain points (which fields get retyped, which sites are copied from most) decide **which scraper adapters to build first**, not a guess made now.
- [ ] Next free ADR number is 0011 or higher (check `docs/adr/`).

## Milestone order

```
P2-M0 Refine + decisions ─▶ P2-M1 Backlog + schema ─▶ P2-M2 Duplicate check
      ─▶ P2-M3 Python ingest service ─▶ P2-M4 Scraper adapters
      ─▶ P2-M5 Clip API + shared package ─▶ P2-M6 Extension clipper
      ─▶ P2-M7 Referral bridge ─▶ P2-M8 Post-mortem + upskilling ─▶ P2-M9 Hardening
```

The Backlog and duplicate check come before any ingestion source, because every source feeds them. Manual entry can use them from day one, so they can be tested without scrapers.

---

## P2-M0: Refine and decide

- [ ] **Re-read the PRD, ADR 0006/0007 and this file against what Phase 1 taught us.** Update this plan. **Done when:** unclear or stale tasks are rewritten.
- [ ] **ADR: FastAPI vs plain Python worker** (ADR 0003 deferred it). FastAPI only if Next.js needs a *synchronous* call (for example "parse this PDF now"). Otherwise the Python service consumes the `tasks` table. **Done when:** ADR Accepted. **Default:** plain worker, because it avoids a second HTTP server, a second port and a second auth surface.
- [ ] **ADR: Python and the shared database.** Python reads and writes existing tables but never migrates (ADR 0004). Decide how it opens the **encrypted** libSQL file (Python libSQL bindings must support the same encryption and the same key mechanism from Phase 1's key ADR) and how it avoids violating the single-writer limit. Phase 1 M2's spike already tests this (check 7); start from its recorded result in ADR 0004. **Done when:** a spike proves Python can open the encrypted file while web + worker are running. **Gate:** if Python cannot open the file, the fallback is Python posting results back through a local Route Handler (authenticated), and the ADR records it.
- [ ] **ADR: scraper legality and politeness policy.** `robots.txt` handling, user agent, per-source rate limit, backoff, and a per-source kill switch. Review each target site's terms before writing its adapter. **Done when:** policy written and linked from each adapter.
- [ ] **Decide the first 2 adapters** from real usage (candidates: FreeJobAlert, SarkariResult). **Done when:** chosen and recorded.
- [ ] **LinkedIn risk decision.** ADR 0007 already says the rate limit reduces but does not remove account-ban risk. Accept the risk before P2-M7, or drop the referral feature. **Done when:** the decision is recorded.

## P2-M1: Backlog stage and schema changes

- [ ] **Migration:** `scraper_sources`, `source_run` (last run, status, counts, error), job `source_type` already exists, add `dedupe_key`, `clip_id` (nullable, unique: idempotency key for clips, ADR 0007 amendment), `raw_payload` (original scraped data for debugging) and `content_hash` (to detect corrigendums). **Done when:** the migration applies cleanly on a copy of a Phase 1 database, and the Phase 1 backup fixtures still restore.
- [ ] **Update the backup table registry** (Phase 1 M8) with `scraper_sources`. Bump `schema_version`, add a new fixture. **Done when:** a Phase 1 backup restores into Phase 2 and a Phase 2 backup round-trips.
- [ ] **Backlog screen:** a TanStack table of `BACKLOG` items with bulk actions: Accept (→ `DISCOVERED`), Edit then Accept, Reject/Delete, Merge. **Done when:** the page has loading, empty and error states, and Accept runs in a transaction.
- [ ] **Corrigendum handling:** an incoming item whose source reference matches an existing posting but has a different `content_hash` updates that posting and writes a history row (Phase 1 history table), instead of creating a new one. **Done when:** a changed deadline shows as an update, not a new Backlog item.
- [ ] **Manual entry stays available** and can optionally route through the Backlog. **Done when:** unchanged Phase 1 behaviour by default.

## P2-M2: Duplicate check

- [ ] **Non-AI matcher (always available):** normalised organisation + title + deadline/post date fuzzy match, with a similarity score and the reason. **Done when:** a test set of known duplicates and near-misses has recorded precision/recall.
- [ ] **Embedding matcher (when AI is on):** reuse Phase 1's pinned embeddings and libSQL vector search. Never compare vectors from different `embedding_model` values. **Done when:** with AI off the feature still works, and with AI on it finds duplicates the fuzzy matcher misses.
- [ ] **Duplicate groups UI:** side-by-side compare, Merge (pick field winners, keep the history) or Keep both. **Done when:** a merge is a single transaction and is undoable for 24 h (soft delete).
- [ ] **"Duplicate Check" action** enqueues a worker task and shows progress. **Done when:** running twice produces no duplicate groups for already-resolved items.

## P2-M3: Python ingest service

- [ ] **`services/ingest`** with `uv`, `pyproject.toml`, Ruff and pytest, outside the pnpm workspace. **Done when:** `uv run pytest` passes.
- [ ] **Task consumer** per the P2-M0 ADR (claims tasks atomically, same rules as the TS worker: retry, backoff, stale-task recovery). **Done when:** a `scrape_source` task is picked up by Python and a `duplicate_check` task is still picked up by Node. Task types are partitioned so the two workers never compete for the same type.
- [ ] **`BaseScraper` interface** and `SCRAPER_REGISTRY` keyed by `adapter_key`, with output validated by Pydantic against a schema that mirrors the TS Zod one. **Done when:** a contract test fails if the two schemas drift (generate one from the other, or compare against a shared JSON Schema).
- [ ] **HTTP layer:** `httpx`, honest user agent, `robots.txt` check, per-domain rate limit, retry with backoff, timeout, response-size cap, SSRF guard (only URLs from `sources.json`; no user-entered URLs fetched by a server). **Done when:** each rule has a test using a fake server.
- [ ] **Scheduler:** daily cron in the Node worker (ADR 0003) enqueues one `scrape_source` task per enabled source. **Done when:** a disabled source is never run, and a failing source is backed off, not retried in a tight loop.
- [ ] **`pnpm dev` also starts the Python process** if present; Docker changes are in P2-M9.

## P2-M4: Scraper adapters

Each adapter is additive and isolated: one class, one registry entry, one seed row (ADR 0006).

- [ ] **`sources.json` + seeding** into `scraper_sources` on first boot, never overwriting user changes (enable/disable). **Done when:** re-seeding is idempotent.
- [ ] **Adapter 1** (from P2-M0). Saved HTML fixtures committed for tests, so tests never hit the network. **Done when:** parsing fixtures yields correct organisation, title, dates and source reference, and a changed fixture produces a clear parse error, not silent empty data.
- [ ] **Adapter 2.** **Done when:** same as adapter 1.
- [ ] **Per-source health in Settings:** last run, count, last error, enable/disable toggle, "run now". **Done when:** a broken adapter is visible in the UI with its error.
- [ ] **Breakage canary:** a run that returns zero items from a source that usually returns many is flagged as suspected breakage. **Done when:** it shows a warning and does not silently mark the run healthy.
- [ ] **Contributor guide:** how to add an adapter through a GitHub issue + PR. **Done when:** a new adapter can be added by following the doc alone.

## P2-M5: Clip API and `packages/shared`

*This milestone creates `packages/shared`, because the clip payload is its first real second consumer (ADR 0003, ADR 0007).*

- [ ] **`packages/shared`:** clip payload Zod schema, enums. Exports TypeScript source, no build step, `transpilePackages` in Next.js. **Done when:** `apps/web` imports it.
- [ ] **`POST /api/clips` Route Handler:** pairing token check (constant-time compare), origin allow-list (`chrome-extension://<id>` with a pinned extension ID; Firefox's random `moz-extension://` origin cannot be allow-listed, so the token is its only gate, ADR 0007; no CORS `*`), payload validated with the shared schema, request size cap, creates a `BACKLOG` posting only. Exposes **no reads**. **Done when:** missing token, wrong token, wrong origin and oversized/malformed payloads are each rejected with tests.
- [ ] **Idempotent clips (ADR 0007 amendment):** the clip payload schema includes a client-generated `clip_id`; the handler returns success without creating anything for a `clip_id` it already holds. **Done when:** posting the same clip twice leaves one `BACKLOG` posting.
- [ ] **`GET /api/health` for the extension:** returns only `{ ok: true }` (no version, no counts, no reads), allowed from the extension origin. **Done when:** the response body is exactly that, and it still returns 403 under `DEMO_MODE`.
- [ ] **Pairing in Settings:** generate / rotate / revoke the token. It is shown once, stored hashed if feasible, and **excluded from backups** (Phase 1 ADR 0008). **Done when:** rotating invalidates the old token immediately.
- [ ] **`DEMO_MODE` and passcode interplay:** the clip endpoint is disabled in the demo. **Done when:** it returns 403 under `DEMO_MODE`.
- [ ] **Rate limit on the endpoint** (local abuse by a malicious page). **Done when:** repeated bad-token requests are throttled.

## P2-M6: Extension: Web Clipper

- [ ] **`apps/extension`** with Plasmo (React + TS), Chrome first, Firefox second. **Done when:** it loads unpacked in Chrome.
- [ ] **Permissions kept minimal:** `activeTab` and `storage`, no blanket host permissions. **Done when:** the manifest has no `<all_urls>` unless a written reason exists.
- [ ] **Pairing UI:** paste token + app URL, with a connection test. **Done when:** a wrong token shows a clear error.
- [ ] **Content-script extractors:** a generic one (JSON-LD `JobPosting`, meta tags, visible-text heuristics) plus optional per-site extractors (Naukri, LinkedIn, company pages). **Done when:** a fixture-page test set records what each extractor gets right.
- [ ] **Review popup:** the user sees and corrects extracted fields before sending. Clips are best-effort, never auto-submitted. **Done when:** nothing is sent without the user confirming.
- [ ] **Outbox and send flow (ADR 0007 amendment):** a confirmed clip is validated with the shared schema, given a `clip_id`, and stored in `chrome.storage.local` before any request. It is POSTed with the token and retried with backoff via `chrome.alarms`. The popup shows the pending count. **Done when:** a clip confirmed while the app is off is delivered once, after the app starts, even if the popup and browser were closed in between, and a double send creates one posting.
- [ ] **Health check and error messages:** on popup open, call `/api/health` with a 3 s timeout and show a status dot. Messages per ADR 0007 amendment: unreachable ("Start the app, then retry; your clip is saved"), 401 (re-pair), 403 (check extension ID), 422 (names the field), 5xx. Only unreachable and 5xx are retried; others stay in the outbox as "needs attention". **Done when:** each case has a test against a fake server, and a wrong token is never retried.

## P2-M7: Extension: LinkedIn referral bridge

*Only if the P2-M0 risk decision says go.*

- [ ] **Hard rate limit:** 10 checks per rolling 24 h in `chrome.storage.local`, enforced **before** any request and working offline. **Done when:** the 11th attempt is blocked in a test, including after a browser restart.
- [ ] **Explicit trigger only:** a "Find Referrals" action in the dashboard, passed to the extension; never a background poll. **Done when:** no LinkedIn request occurs without a user click.
- [ ] **Session tokens never leave the browser;** only names and profile URLs go to the app. **Done when:** a network capture of the app-bound request contains no LinkedIn cookies or tokens.
- [ ] **Store results** in `network_matches` on the application, with a "last checked" time. **Done when:** results are visible on the job page and are covered by backup/restore.
- [ ] **Failure behaviour:** on a captcha, 429 or unexpected response, stop, show a warning and stop further checks for the day (do not retry). **Done when:** tested with a mocked response.

## P2-M8: Post-mortem and foundation-based upskilling (Epic 3)

**Scope tension (resolved in the PRD, 2026-11-04):** the PRD's Feature 2 now says that in Phase 2 the post-mortem feeds `current_focus_skills` (a skill-priority list) only, and Phase 3 connects those skills to syllabus nodes. Nobody builds half an LMS here.

- [ ] **Post-mortem prompt on `REJECTED` with reason `rejected`** (mandatory or optional, per the user setting): free text plus tags. Stored in `post_mortem_notes`. `no_response` and `withdrawn` skip it. **Done when:** moving to `REJECTED` with reason `rejected` offers it, skipping is allowed if the setting says so, and `no_response` never prompts.
- [ ] **Keyword extraction:** non-AI path (match against a known skill list the user already has from Phase 1 skill combobox) and an AI path (validated Zod output, provenance fields). **Done when:** with AI off, matching skills are still suggested, and the user confirms them before they affect anything.
- [ ] **Reprioritise `current_focus_skills`** from confirmed post-mortem skills (transaction, with an audit trail). **Done when:** a confirmed skill moves up the focus list.
- [ ] **Skill-gap analysis:** across shortlisted private jobs (stages `APPLIED` and later, or a "shortlisted" flag), count demanded skills the profile lacks, and rank by demand count and by closeness to skills already known. **Done when:** output is deterministic and explained ("needed by 7 of 12 jobs; you already know X which it builds on").
- [ ] **"Next skill to learn" panel** on the Private tab and dashboard. **Done when:** it has loading/empty/error states, and an empty state when too few jobs exist.
- [ ] **Scope guard:** no syllabus tree, no checklists, no revision counters. **Done when:** none of those tables exist.

## P2-M9: Hardening, Docker and docs

- [ ] **Docker (optional, only if the Phase 1 image was built):** the single image now also runs Python, so move to Compose (`docs/STACK.md`: "Compose only once Python arrives"). **Done when:** `docker compose up` runs web + worker + ingest with `data/` mounted, and the encrypted DB opens from all three.
- [ ] **CI:** add Ruff + pytest and extension build. **Done when:** PRs run both toolchains.
- [ ] **Extension distribution:** unpacked-load instructions at minimum; store submission is optional and decided separately. **Done when:** the README explains installing it.
- [ ] **End-to-end test:** a fixture scrape → Backlog → duplicate check → accept → tracker. **Done when:** it runs in CI without network.
- [ ] **Security review** of the clip endpoint, the Python-to-DB path and the extension permissions. **Done when:** findings are fixed or recorded.
- [ ] **Demo update:** add sample Backlog items and a duplicate group to the fake dataset; the clip endpoint and scraper controls stay disabled. **Done when:** the demo shows the Backlog read-only.
- [ ] **Update `MEMORY.md`, `docs/STACK.md`, ADR index and backup fixtures.**

---

## Not in Phase 2

- Vacancy extraction from notification PDFs (Epic 5), LMS and spaced repetition (Epic 6), Preparedness Score → **Phase 3**.
- Shared/published dataset of parsed notifications → out of scope (ADR 0006).
- Email digest and extension notifications → later.
- Store-listed extension, Firefox parity beyond a working build → optional.

## Risks and scalability notes

| Risk | Mitigation |
|:---|:---|
| Scrapers break whenever a site changes HTML (ADR 0006's main maintenance cost) | Fixture tests, zero-result canary, per-source health, per-source kill switch |
| Scraping policy or terms violations | P2-M0 policy ADR, honest user agent, `robots.txt`, low frequency |
| Python cannot open the encrypted libSQL file | P2-M0 spike; fallback is an authenticated local Route Handler |
| Two writers (Node and Python) on one SQLite file | Short transactions, `busy_timeout`, task types partitioned between workers |
| TS and Python schemas drift | Contract test against a shared schema |
| Any web page can hit `localhost` | Pairing token, origin allow-list, create-only endpoint, no reads |
| LinkedIn terms and account risk | Explicit opt-in, hard limit, P2-M0 go/no-go |
| Clipper DOM heuristics are fragile | Review popup, per-site extractors, fixture tests |
| Backlog grows unbounded | Retention rule for rejected items and old `raw_payload` |
