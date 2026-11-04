# 2. Product Direction: Local-First Personal Tool with a Precomputed Public Demo

Date: 2026-10-30

## Status

Accepted

## Context

The first architecture draft (commit `3de4acf`) assumed a hosted, multi-user SaaS: shared server-side scrapers, community-requested sources, per-user auth, PostgreSQL + Redis + Celery, and a cloud LLM fallback.

On review, that direction does not hold up:

- **No clear market for a paid tracker.** Generic job trackers (Huntr, Teal, Simplify) give tracking away for free and monetise AI resume tooling. The target audience (Indian government + private job seekers) pays for exam-prep content, not for tracking.
- **Hosting other people's data is a liability.** The app stores DOB, reservation category, CTC and full resumes. Holding that for other users brings DPDP Act 2023 obligations, breach risk and support load.
- **Running inference for others costs money.** Either we pay for cloud LLM calls per user, or we operate GPU/CPU-heavy model servers.
- **The real goal is personal.** The project exists to make the author's own job search faster, to use AI without recurring API bills, and to serve as a strong portfolio project.

## Decision

1. **The product is a local-first, single-user personal tool.** It runs on the user's own machine. All personal data (profile, resume, applications) stays on that machine.
2. **AI is optional and runs locally by default.** Inference uses the user's own Ollama install, or the user's own API key (BYOK). With AI disabled, every core feature still works through manual entry. See ADR 0005.
3. **No multi-tenant hosting.** We do not create accounts for other people or store their data. There is no auth system beyond an optional local passcode.
4. **A public demo exists for showcase purposes only:**
   - It runs on **fake, seeded data**. Real data entry and uploads are disabled.
   - All AI results are **precomputed** locally and exported into the demo database. The demo makes **zero live AI calls**, so it costs nothing to run and cannot be abused.
   - It is **read-only**. Mutating actions are disabled behind a `DEMO_MODE` flag.
5. **Distribution happens through the public GitHub repository.** Anyone who wants to use the tool for real runs their own copy by following the README (Docker image or `pnpm` scripts). Feature requests and feedback go through GitHub issues.

## Alternatives Considered

| Option | Why not |
|:---|:---|
| Hosted freemium SaaS | PII liability, per-user LLM cost, scraper operations. No validated willingness to pay. |
| Open core (OSS plus a paid hosted tier) | Keeps every SaaS cost. Can be revisited later if real demand appears. Nothing in this design blocks it. |
| Interactive demo with guest sessions | Needs session isolation, nightly resets and abuse protection. Read-only covers the showcase need. |

## Consequences

- **Positive:** No infrastructure bill, no PII held for anyone but the author, no inference cost.
- **Positive:** The stack can be sized for one user (ADRs 0003 and 0004), which removes most of the operational complexity of the earlier design.
- **Positive:** The demo is static in practice. It cannot break from load, abuse or provider outages.
- **Negative:** Real users must self-host, so the realistic audience is developers rather than every job seeker.
- **Negative:** Demo visitors cannot try the AI features live. They only see precomputed output.
- **License: MIT** (decided 2026-11-03, `LICENSE` at the repo root). The repository was already public with no license, which legally meant "all rights reserved". MIT fits the goals of a portfolio project that others can self-host. AGPL-3.0 would only matter for protecting a future hosted tier, and that direction was dropped here. If an open-core hosted option is ever revived, the license is the first thing to revisit, and relicensing stays easy only while there are no outside contributors.
