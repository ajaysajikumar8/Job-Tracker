# 6. Browser Extension Framework

Date: 2026-10-14

## Status

Accepted

## Context

The system requires a browser extension with two distinct functions:

1. **Universal Web Clipper (Tier 3 Data Ingestion)** — User manually triggers clipping of any job listing page. The extension parses the current tab's DOM, extracts relevant fields (title, company, URL, deadline if visible), and sends the structured data to the Next.js backend as a Backlog entry.

2. **LinkedIn Referral Mapper** — When the user explicitly requests referrals for a job, the extension queries LinkedIn's internal API using the user's *already active* browser session (not stored credentials). A hard client-side rate limit (max 10 queries per 24-hour rolling window) prevents account flagging. LinkedIn session tokens are **never** transmitted to any backend server.

The extension must:
- Work on Chrome (primary) and Firefox (secondary)
- Use React/TypeScript for consistency with the main Next.js codebase
- Support Manifest V3 (the current extension standard)
- Communicate with the Next.js backend over HTTP using the user's auth session

## Decision

### Framework: Plasmo

Plasmo is chosen over writing raw Manifest V3 extensions because:

1. **React + TypeScript** — Same language and component model as the Next.js frontend. No context switching.
2. **Built-in HMR** — Hot module replacement during development, significantly faster iteration.
3. **Manifest V3 handled** — Plasmo abstracts the painful Manifest V3 service worker model and handles Chrome/Firefox build targets from a single codebase.
4. **Content Scripts as React** — Plasmo allows writing content scripts (DOM-injected UI) as React components, enabling the popup and injected UI to share components.

### Client-Side Rate Limiting

LinkedIn rate limits are enforced entirely client-side using `chrome.storage.local`:
```
{
  "linkedin_referral_count": 7,
  "linkedin_referral_window_start": 1728901234567
}
```
On each referral request: check if `count >= 10` within the 24h window → reject with user-facing message if exceeded. This requires no server round-trip and ensures the limit is always enforced even offline.

### Data Flow for Web Clipper

```
User clicks "Clip Job" in extension popup
         ↓
Extension content script reads DOM of current tab
(document.title, meta tags, visible text heuristics)
         ↓
Extension popup shows extracted fields for user review/correction
         ↓
User confirms → Extension sends HTTP POST to Next.js API
(with auth cookie from active browser session)
         ↓
Next.js creates JobPosting + ApplicationTracker record
with lifecycle_stage = BACKLOG
```

## Consequences

- **Positive:** Plasmo handles Manifest V3 complexity, multi-browser builds, and HMR — significant time savings over raw extension development.
- **Positive:** Shared TypeScript types between the extension and Next.js backend (via a shared `packages/types` module) prevents API contract drift.
- **Positive:** Client-side LinkedIn rate limiting means zero risk of accidentally transmitting session tokens to the server.
- **Negative:** Plasmo adds a build step and its own abstractions. If Plasmo is abandoned or breaks, migration to raw Manifest V3 is a known path.
- **Negative:** DOM heuristics for web clipping are inherently fragile — different job sites structure their pages differently. The extension will capture "best effort" data; the user reviews and corrects before confirming. This is acceptable UX.
