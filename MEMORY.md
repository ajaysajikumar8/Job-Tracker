# Project Memory: Job Discovery & Application Tracking System

## Core Context
This project is an automated, AI-assisted Job Discovery & Application Tracking System. It features a dual-engine approach handling both Public Sector (government) roles via strict hard-filters, and Private Sector roles via semantic skill-matching. It also integrates dynamic learning roadmaps.

## Current State
- **Product Scope**: Fully defined in `PRD.md` with 8 epics and a 3-phase rollout strategy.
- **Architecture**: Fully documented. 7 ADRs committed in `docs/adr/`. Single-page stack reference in `docs/STACK.md`.
- **Next Step**: Initialize project boilerplate (Next.js app, FastAPI service, Docker Compose).

## Key Technical Decisions

### Data Ingestion (ADR 0002)
- **Three-Tier Model:** Tier 1 (platform-curated server-side scrapers) → Tier 2 (community-requested) → Tier 3 (Web Clipper, client-side only).
- **No user-controlled server-side scraping** — SSRF risk, IP bans, legal liability.
- **Scraper Pattern:** Strategy Pattern + `SCRAPER_REGISTRY` dict. `BaseScraper` interface. Open/Closed Principle.
- Scraper targets stored in `scraper_sources` DB table. Seeded from `sources.json` on first boot.

### Frontend & API Gateway (ADR 0003)
- **Next.js 15 (App Router)** — UI + BFF (Route Handlers). No separate Node.js API server in Phase 1.
- **tRPC** — End-to-end type-safe API. Eliminates manual type sync between frontend and backend.
- **TanStack Table v8** — High-density tables with virtualization. No Kanban boards.
- **TanStack Query** — Client-side async state, caching, optimistic updates.
- **Auth.js v5** — Authentication standard for Next.js.
- **SSE** (not WebSockets) — One-directional real-time scraper status updates.

### Python Data Engine (ADR 0004)
- **FastAPI** — Async-first, Pydantic v2, auto OpenAPI docs.
- **Celery + Redis** — Distributed task queue for scraping and AI jobs. NOT APScheduler.
- **Playwright** — JS-rendered page scraping. **BeautifulSoup4** — Static HTML.
- **PyMuPDF** — PDF parsing for government notifications and resumes.

### Database & Storage (ADR 0005)
- **PostgreSQL 16** — Single DB for relational, JSONB (LMS syllabus), and vector data.
- **pgvector** — Semantic embeddings stored natively. No separate vector DB needed.
- **Redis** — Celery broker/backend + application cache.
- **Prisma v5** (TypeScript ORM) + **SQLAlchemy 2.0 async** (Python ORM).
- **Cloudflare R2** — File storage in Phase 2+ (S3-compatible, zero egress fees).

### Browser Extension (ADR 0006)
- **Plasmo** — React/TypeScript, Manifest V3, multi-browser (Chrome + Firefox).
- LinkedIn rate limit (10/24h) enforced client-side via `chrome.storage.local`. Session tokens NEVER sent to server.

### AI / LLM Strategy (ADR 0007)
- **Provider-agnostic `AIClient`** — Routes to local Ollama or cloud OpenAI via same SDK (`base_url` switch).
- **Local (Ollama):** Embeddings (`nomic-embed-text`), skill extraction (`phi3:mini`), keyword extraction. Free, private.
- **Cloud fallback (`gpt-4o-mini`):** Complex PDF parsing, nuanced semantic fit scoring.
- **No LangChain** — Direct OpenAI SDK. Simpler, more transparent for our well-defined non-chained use cases.
- **Config-driven:** `AI_PROVIDER=local|cloud|hybrid` in `.env`.

## Open Items
- Initialize project boilerplate: Next.js app, FastAPI service, Docker Compose, Prisma schema.
- Write initial `scraper_sources` seed file (`sources.json`).
- Implement `BaseScraper` interface and first two adapters (FreeJobAlert, SarkariResult).
