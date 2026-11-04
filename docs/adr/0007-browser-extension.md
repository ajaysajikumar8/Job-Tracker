# 7. Browser Extension: Plasmo Web Clipper and LinkedIn Referral Bridge

Date: 2026-10-30

## Status

Accepted (Phase 2). Revises the original ADR 0006 from commit `3de4acf` for a local, single-user backend.

## Context

The extension has two jobs:

1. **Web Clipper:** the user clicks "Clip Job" on any page. The extension extracts title, organisation, URL and deadline from the DOM, the user reviews the fields, and the job is sent to the local app's Backlog.
2. **LinkedIn Referral Mapper:** when the user explicitly asks for referrals for a job, the extension runs one query using the user's already-active LinkedIn session.

The backend is now the user's own app on `localhost` (ADR 0002), not a hosted server with auth cookies.

## Decision

### Framework: Plasmo

- React + TypeScript, the same stack as `apps/web`.
- Handles Manifest V3 service workers and Chrome (primary) / Firefox (secondary) builds from one codebase, with HMR in development.
- Lives at `apps/extension` in the pnpm workspace (ADR 0003).

### Shared contract

- The clip payload is a Zod schema in `packages/shared`.
- The extension validates the payload before sending, and the Route Handler validates it again on arrival.
- This is the first real second consumer, so it is what creates `packages/shared`.

### Talking to the local app securely

Any website the user visits can send requests to `localhost`, so the local API is a real security boundary:
- **Pairing token:** the app generates a random token in settings. The user pastes it into the extension once. Every request carries it, and the app rejects requests without it.
- **Origin check:** the clip endpoint accepts only the extension's origin (`chrome-extension://<id>`). CORS is not opened to `*`. The request must be sent from the popup or service worker, because a content script's requests carry the web page's origin. Pin the extension ID with a manifest `key` so the allowed origin is stable across builds. Firefox gives each install a random `moz-extension://<uuid>` origin, so on Firefox the pairing token is the only gate.
- The endpoint only *creates* Backlog entries. It does not expose reads of profile or PII data.

### LinkedIn guardrails

- **Hard client-side rate limit:** at most 10 referral checks per rolling 24 hours, stored in `chrome.storage.local`. It is enforced before any request, and works offline.
- **LinkedIn session tokens never leave the browser.** Only the derived results (names, profile URLs) are sent to the local app.
- Referral checks run only on explicit user action, never in the background.

### Clip flow

```
User clicks "Clip Job"
  → content script reads the DOM (title, meta tags, visible-text heuristics)
  → popup shows extracted fields for review and correction
  → user confirms → POST http://localhost:<port>/api/clips  (pairing token)
  → app validates with the shared Zod schema → JobPosting in BACKLOG
```

## Consequences

- **Positive:** Covers every site the curated scrapers don't, with no server-side scraping.
- **Positive:** The pairing token and origin check keep a local API safe from arbitrary web pages.
- **Negative:** DOM heuristics are fragile across sites. Clips are "best effort" and always reviewed by the user.
- **Negative:** Using LinkedIn's internal endpoints may violate its terms. The rate limit reduces account risk but does not remove it. The feature stays explicit and opt-in.
- **Negative:** Plasmo adds its own build abstractions. Migrating to raw Manifest V3 is a known path if needed.
