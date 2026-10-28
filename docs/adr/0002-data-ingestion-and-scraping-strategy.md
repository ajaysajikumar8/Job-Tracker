# 2. Data Ingestion & Scraping Architecture Strategy

Date: 2026-10-14

## Status

Accepted

## Context

The system needs to automatically discover job listings from multiple external websites on behalf of users. Several approaches were considered:

1. **Direct scraping of primary government portals** (e.g., ISRO, UPSC websites) — Rejected. These sites are highly unstandardized, frequently restructure their HTML, use CAPTCHAs, and have legally ambiguous scraping policies.
2. **LLM-based extraction on every scrape** — Rejected for daily use. Sending full HTML pages to an LLM on a recurring schedule incurs high token costs and introduces non-determinism into a critical data pipeline.
3. **LLM-assisted selector discovery + generic CSS adapter** — Viable for scale, but adds unnecessary complexity for Phase 1 where only 2–3 known sites are targeted.
4. **Allowing users to add arbitrary URLs for server-side scraping** — Rejected. Introduces serious security risks (SSRF), unpredictable infrastructure costs, IP ban risk from shared server IPs, and legal liability at scale.

## Decision

We adopt a **Three-Tier Data Ingestion Model**:

---

### Tier 1: Platform-Curated Sources (Server-Side)

- The platform maintains a small set of high-quality, vetted aggregator sites (e.g., FreeJobAlert, SarkariResult).
- Each site has a dedicated, custom **Scraper Adapter** (`FreeJobAlertAdapter`, `SarkariResultAdapter`) implementing a standard `BaseScraper` interface (Strategy Pattern / Open-Closed Principle).
- These adapters run on a daily cron schedule and are **shared across all users**.
- Scraping targets (URLs, schedule, health status) are stored in a `scraper_sources` database table. A `sources.json` seed file populates this table on first boot during Phase 1 to avoid needing an Admin UI prematurely.
- **Zero per-user cost. Deterministic. Rock-solid reliability.**

### Tier 2: Community-Requested Sources

- Users can **vote on or request** new sites to be added to Tier 1.
- A developer reviews the request, writes one adapter, and it is **shared for everyone**.
- This scales platform knowledge without introducing security or cost risks.
- The `adapter_key` in the `scraper_sources` table maps a DB row to a specific Python class in `SCRAPER_REGISTRY`.

### Tier 3: User's Own Sites (Client-Side Only — Web Clipper)

- For sites not covered by Tiers 1 or 2 (LinkedIn, Naukri, AngelList, niche boards), the **Browser Extension (Web Clipper)** allows users to manually clip any job from any page into their personal Backlog.
- **Zero server-side involvement.** The scraping runs entirely on the user's machine via the browser extension.
- This eliminates IP ban risk, server cost, legal liability, and SSRF attack vectors entirely for user-defined sources.

---

### Scraper Registry Pattern

```python
# The Python engine maintains a registry dict
SCRAPER_REGISTRY = {
    "free_job_alert":       FreeJobAlertAdapter,     # Phase 1
    "sarkari_result":       SarkariResultAdapter,    # Phase 1
    "generic_rss":          GenericRssAdapter,       # Phase 1
    # Future Phase 2 additions:
    # "css_selector_generic": GenericCssSelectorAdapter,
}
```

The cron worker reads active rows from `scraper_sources`, looks up `adapter_key` in `SCRAPER_REGISTRY`, and dispatches accordingly. Adding a new curated source requires:
1. Writing a new adapter class (~15–30 min).
2. Adding it to `SCRAPER_REGISTRY`.
3. Inserting a row in `scraper_sources` (or adding to `sources.json`).

The **core engine never changes**. This is the Open/Closed Principle in practice.

## Consequences

- **Positive:** Eliminates IP bans, SSRF risk, unpredictable LLM costs, and legal liability from user-defined server scraping.
- **Positive:** The Web Clipper covers 100% of user-specific sources without any server involvement.
- **Positive:** Community voting scales site coverage without engineering overhead.
- **Positive:** The Adapter + Registry pattern makes adding new curated sources fast and safe.
- **Negative:** Platform only auto-discovers jobs from vetted Tier 1 sources. Users who want automatic daily scraping of obscure sites cannot configure it themselves.
- **Trade-off Accepted:** The Web Clipper is positioned as the primary and sufficient tool for user-specific discovery. Server-side scraping is a platform-level, not user-level, concern.

## Future Consideration (Phase 3+)

If genuine demand arises, a `css_selector_generic` adapter with **LLM-assisted one-time selector discovery** (stored in `scraper_config` JSONB column) can be introduced for community-submitted sites. The LLM would be called **once** to discover selectors from cleaned/stripped HTML, not on every scrape. The stored selectors would then drive all future runs at near-zero cost.
