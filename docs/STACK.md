# Tech Stack Reference

> This is the canonical single-page reference for every technology used in this project.
> For the *why* behind each decision, read the corresponding ADR in `docs/adr/`.
> Last updated: 2026-10-14

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                 USER BROWSER (Desktop)                  │
│                                                         │
│  ┌────────────────────┐    ┌──────────────────────────┐ │
│  │  Next.js App       │    │  Plasmo Extension        │ │
│  │  React + tRPC      │    │  Web Clipper             │ │
│  │  TanStack Table    │    │  LinkedIn Rate Limiter   │ │
│  │  TanStack Query    │    └────────────┬─────────────┘ │
│  │  Recharts          │                 │ HTTP POST      │
│  └────────┬───────────┘                 │               │
└───────────┼─────────────────────────────┼───────────────┘
            │ tRPC / SSE                  │
            ▼                             ▼
┌───────────────────────────────────────────────────────┐
│          Next.js Server (Route Handlers / BFF)        │
│          Auth.js v5 | tRPC Router | Zod               │
│          File Upload Handler                          │
└───────────────────────────────┬───────────────────────┘
                                │ HTTP (internal network)
                                ▼
┌───────────────────────────────────────────────────────┐
│            FastAPI (Python Data Engine)               │
│            Pydantic v2 | SQLAlchemy 2.0 (async)      │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │              Celery Workers                     │  │
│  │  ScrapeJob | ParseResumeJob                     │  │
│  │  EmbedJob | DuplicateCheckJob                   │  │
│  └──────────────────┬──────────────────────────────┘  │
│                     │                                  │
│  ┌──────────────────▼──────────────────────────────┐  │
│  │              AI Client (Provider-Agnostic)      │  │
│  │  Ollama (local) ←→ OpenAI SDK (cloud fallback)  │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────┬─────────────────────────────────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
   ┌─────────────┐ ┌──────┐ ┌──────────────┐
   │ PostgreSQL  │ │Redis │ │ File Storage │
   │ + pgvector  │ │      │ │ Local → R2   │
   └─────────────┘ └──────┘ └──────────────┘
```

---

## Layer-by-Layer Stack

### 1. Frontend (Next.js App)

| Tool | Version | Purpose |
|:---|:---|:---|
| **Next.js** | 15 (App Router) | React framework, SSR, routing |
| **TypeScript** | 5.x | Type safety across the stack |
| **TailwindCSS** | 3.x | Utility-first styling |
| **TanStack Table** | v8 | High-density data tables (sort, filter, virtualization) |
| **TanStack Query** | v5 | Async data fetching, caching, background refetch |
| **tRPC** | v11 | End-to-end type-safe API layer |
| **React Hook Form** | v7 | Complex form management |
| **Zod** | v3 | Schema validation (shared with tRPC) |
| **Recharts** | v2 | Dashboard stats and charts |
| **Radix UI** | latest | Headless accessible primitives (modals, dropdowns) |

### 2. API / Backend Gateway (Next.js Server)

| Tool | Version | Purpose |
|:---|:---|:---|
| **Next.js Route Handlers** | (App Router) | BFF — handles CRUD, file upload, SSE |
| **tRPC** | v11 | Type-safe procedure router |
| **Auth.js v5 (NextAuth)** | v5 | Authentication — email/password + OAuth |
| **Zod** | v3 | Input validation for all procedures |
| **Prisma** | v5 | TypeScript ORM, schema management, migrations |

### 3. Python Data Engine (FastAPI Service)

| Tool | Version | Purpose |
|:---|:---|:---|
| **FastAPI** | 0.115+ | Async API framework for heavy lifting |
| **Pydantic** | v2 | Data contracts and validation |
| **SQLAlchemy** | 2.0 (async) | Python ORM |
| **Alembic** | latest | Python-side DB migrations |
| **Celery** | v5 | Distributed async task queue |
| **Celery Beat** | (bundled) | Cron scheduler for daily scraping jobs |
| **httpx** | latest | Async HTTP client (replaces `requests`) |
| **BeautifulSoup4** | latest | Static HTML parsing |
| **Playwright (Python)** | latest | Headless browser for JS-rendered sites |
| **PyMuPDF (fitz)** | latest | PDF parsing (government notifications, resumes) |
| **python-docx** | latest | Docx resume parsing |

### 4. AI / LLM Layer (Provider-Agnostic)

| Tool | Purpose | Mode |
|:---|:---|:---|
| **Ollama** | Local model server (CPU-runnable) | Local |
| **`nomic-embed-text`** (via Ollama) | Vector embeddings | Local — free |
| **`phi3:mini`** (via Ollama) | Skill extraction, keyword extraction | Local — fast on CPU |
| **`llama3.2:3b`** (via Ollama) | General extraction tasks | Local |
| **OpenAI SDK** | Same SDK used for both Ollama + cloud | Hybrid |
| **`gpt-4o-mini`** (OpenAI) | Complex reasoning, nuanced fit scoring, difficult PDFs | Cloud fallback |

**Routing logic:** `AI_PROVIDER=local | cloud | hybrid` in `.env`
- `local` → all tasks go to Ollama
- `hybrid` → simple tasks (embeddings, extraction) → Ollama; complex tasks → `gpt-4o-mini`
- `cloud` → all tasks go to OpenAI (development/testing)

### 5. Database & Storage

| Tool | Purpose |
|:---|:---|
| **PostgreSQL 16** | Primary relational database |
| **pgvector** | Semantic vector search (embeddings stored natively) |
| **Redis** | Celery broker + backend; application cache; rate limit store |
| **Prisma Migrate** | Schema migrations (TypeScript side) |
| **Alembic** | Schema migrations (Python side) |
| **Local filesystem (Phase 1)** | Resume and file storage |
| **Cloudflare R2 (Phase 2)** | S3-compatible object storage, zero egress fees |

### 6. Browser Extension

| Tool | Purpose |
|:---|:---|
| **Plasmo** | Extension framework (React/TypeScript, manifest v3, multi-browser) |
| **Chrome Storage API** | Client-side rate limit state for LinkedIn referral checks |
| **fetch()** | Send clipped jobs to Next.js backend (authenticated) |

### 7. Infrastructure & Developer Tooling

| Tool | Purpose |
|:---|:---|
| **Docker Compose** | Orchestrates all 4 services locally (Next.js, FastAPI, PostgreSQL, Redis) |
| **Ollama** | Runs as a separate local process / Docker container |
| **ESLint + Prettier** | TypeScript code quality |
| **Ruff** | Python linting and formatting |
| **pytest** | Python unit and integration tests |
| **Jest + Testing Library** | TypeScript unit tests |

---

## Data Ingestion: Three-Tier Model

See `docs/adr/0002-data-ingestion-and-scraping-strategy.md` for full rationale.

| Tier | Mechanism | Who Controls It |
|:---|:---|:---|
| **Tier 1** — Platform-curated scrapers | Server-side cron (Celery Beat), custom adapters per site | Platform (developer) |
| **Tier 2** — Community-requested | User votes → developer reviews → writes adapter → shared for all | Platform (developer) |
| **Tier 3** — User-specific sites | Web Clipper browser extension (client-side only) | User |

**Scraper Registry pattern:**
```python
SCRAPER_REGISTRY = {
    "free_job_alert":   FreeJobAlertAdapter,
    "sarkari_result":   SarkariResultAdapter,
    "generic_rss":      GenericRssAdapter,
}
```

---

## Key Design Decisions (Quick Reference)

| Decision | Choice | Rejected Alternative |
|:---|:---|:---|
| UI layout pattern | High-density Data Tables (TanStack Table) | Kanban boards |
| API type safety | tRPC | REST + manual types / GraphQL |
| Async task queue | Celery + Redis | APScheduler (in-process, no retry) |
| LLM abstraction | Provider-agnostic AIClient (Ollama / OpenAI SDK) | LangChain |
| Vector search | pgvector (in Postgres) | Pinecone / Weaviate (separate infra) |
| Flexible LMS data | JSONB column | Deeply normalized relational tables |
| File storage | Local → Cloudflare R2 | AWS S3 (egress costs) |
| Real-time updates | Server-Sent Events (SSE) | WebSockets |
| User-defined scraping | Web Clipper (client-side) | User-controlled server scrapers (SSRF risk) |

---

## ADR Index

| ADR | Decision |
|:---|:---|
| [0001](adr/0001-record-architecture-decisions.md) | Use ADRs for all major architectural decisions |
| [0002](adr/0002-data-ingestion-and-scraping-strategy.md) | Three-Tier data ingestion model |
| [0003](adr/0003-frontend-and-api-gateway.md) | Next.js + tRPC + TanStack as frontend and BFF |
| [0004](adr/0004-python-data-engine.md) | FastAPI + Celery + Redis as the data engine |
| [0005](adr/0005-database-and-storage.md) | PostgreSQL + pgvector + Redis + Cloudflare R2 |
| [0006](adr/0006-browser-extension.md) | Plasmo (React/TypeScript) for browser extension |
| [0007](adr/0007-ai-and-llm-strategy.md) | Provider-agnostic AI client: Ollama (local) + OpenAI (cloud fallback) |
