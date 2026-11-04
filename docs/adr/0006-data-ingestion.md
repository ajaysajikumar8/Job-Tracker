# 6. Data Ingestion: Manual Entry, Curated Scrapers and the Web Clipper

Date: 2026-10-30

## Status

Accepted. Replaces the original ADR 0002 (Three-Tier Model with community-requested sources) from commit `3de4acf`.

## Context

Jobs reach the tracker in three ways. Under ADR 0002 there is no shared platform, so "community-requested sources shared across all users" no longer applies: each installation scrapes only for its own user.

Rejected approaches carried over from the original analysis:
- **Scraping primary government portals directly:** unstandardised HTML, CAPTCHAs, frequent restructuring, ambiguous scraping policies.
- **Sending raw HTML to an LLM on every scrape:** slow on local models, non-deterministic, and wasteful for structured listing pages.
- **Arbitrary user-entered URLs fetched by a server:** SSRF and abuse risk. This matters again if the app is ever exposed beyond localhost.

## Decision

### 1. Manual entry (Phase 1)

Phase 1 has no scrapers. Jobs are added through a form, with an optional "paste the job description" field that AI can pre-fill when it's enabled. This is the baseline every other ingestion path falls back to.

### 2. Curated scraper adapters (Phase 2)

- A small set of vetted aggregator sites (for example FreeJobAlert, SarkariResult) each get a dedicated adapter implementing a common `BaseScraper` interface.
- Adapters live in `services/ingest` (Python) and are registered in a `SCRAPER_REGISTRY` map keyed by `adapter_key`.
- Sources and run state live in a `scraper_sources` table, seeded from `sources.json`.
- The worker schedules runs daily. **Each installation scrapes for itself.** Keep the frequency low and identify politely (honest user agent, respect `robots.txt`, back off on errors).
- Adding a source means writing one adapter class, adding a registry entry and adding a seed row. The core engine does not change.
- Adding a new site happens through a GitHub issue and pull request.

### 3. Web Clipper (Phase 2)

For any other site (LinkedIn, Naukri, company career pages), the browser extension clips the current page in the user's own browser and sends it to the local app. See ADR 0007.

### Everything lands in the Backlog

Scraped and clipped jobs enter the `BACKLOG` stage first and are triaged by the user (merge duplicates, correct fields) before reaching the tracker. Corrigendums (for example extended deadlines) update the existing posting instead of creating a new one.

## Consequences

- **Positive:** Phase 1 is fully usable with no scraping infrastructure.
- **Positive:** Adapters are isolated and additive. A broken site breaks one adapter, not the pipeline.
- **Negative:** Scrapers break whenever a site changes its HTML. This is the main ongoing maintenance cost of the project.
- **Negative:** Every self-hosted copy scrapes independently. That is acceptable at personal scale. A shared, published dataset of parsed notifications is a possible future option, but out of scope.
