# 4. Python Data Engine: FastAPI + Celery + Redis

Date: 2026-10-14

## Status

Accepted

## Context

The system requires a separate service for all compute-heavy and I/O-heavy operations that must not block the Next.js process:
- Scheduled daily web scraping (multiple sites, potentially slow)
- Headless browser rendering for JS-heavy pages
- PDF parsing (government notification PDFs, user resumes)
- LLM API calls (skill extraction, semantic fit, post-mortem analysis)
- Vector embedding generation
- Duplicate detection

These tasks are inherently slow (seconds to minutes), must be retried on failure, and should run on a schedule. Running them inside the Next.js process would block the event loop and degrade UI performance.

## Decision

### Framework: FastAPI (Python)

FastAPI is chosen over Flask, Django, or a Node.js service for the data engine because:
1. **Python ecosystem** — BeautifulSoup, Playwright, PyMuPDF, and all LLM/ML libraries are Python-first.
2. **Async-first** — FastAPI's async handlers match the I/O-heavy nature of scraping and LLM calls.
3. **Pydantic v2** — Strict data contracts are enforced on all inputs and outputs, matching the rigor of our TypeScript types.
4. **Auto-generated OpenAPI docs** — Useful for debugging and for Next.js to understand the service contract.

### Task Queue: Celery + Redis

Celery is chosen over APScheduler, RQ, or Dramatiq for scheduled and async task execution:

- **APScheduler (Rejected):** In-memory. If the server restarts, all scheduled state is lost. Cannot distribute tasks across workers. Not suitable for production.
- **Celery (Chosen):** Tasks are persisted in Redis. Failed tasks are automatically retried with configurable backoff. Multiple worker processes can run concurrently. Celery Beat handles cron scheduling (e.g., `0 6 * * *` for daily scraping).

Redis serves as both the Celery broker (receives task messages) and the Celery backend (stores task results/status). This is also the same Redis instance used for application-level caching.

### Web Scraping: httpx + BeautifulSoup4 + Playwright

- **httpx** replaces `requests` for async HTTP — non-blocking, compatible with FastAPI's async model.
- **BeautifulSoup4** handles static HTML parsing for aggregator sites (FreeJobAlert, SarkariResult).
- **Playwright (Python)** handles JS-rendered pages where the job listings are injected by JavaScript after page load. Playwright is preferred over Selenium for speed and reliability.

### PDF Parsing: PyMuPDF (fitz)

PyMuPDF is the fastest Python PDF library and handles the two PDF use cases:
1. **Government notification PDFs** — Extract vacancy counts, eligibility tables, and important dates.
2. **User resume PDFs** — Extract full text corpus for the semantic fit engine.

`python-docx` handles Docx resume uploads.

### Adapter Pattern for Scrapers

All scraper adapters implement a `BaseScraper` abstract interface:
```python
class BaseScraper(ABC):
    @abstractmethod
    def fetch_listings(self, url: str) -> List[RawJobItem]:
        pass
```

A `SCRAPER_REGISTRY` dict maps `adapter_key` strings (stored in the `scraper_sources` DB table) to concrete adapter classes. Adding a new site requires writing one new class and adding one entry to the registry — the core engine never changes. This is the Open/Closed Principle.

## Consequences

- **Positive:** Strict separation of concerns — Next.js never blocks on slow I/O, Python never handles UI concerns.
- **Positive:** Celery ensures scraping jobs are retried on failure and can be scaled horizontally by adding workers.
- **Positive:** The Adapter + Registry pattern means new scraping targets are additive, never modifying existing code.
- **Negative:** Adds operational complexity — two services (Next.js + FastAPI) must be running, plus Redis and PostgreSQL. Mitigated by Docker Compose for local development.
- **Negative:** Python type system is weaker than TypeScript. Pydantic v2 compensates but does not fully close the gap.
