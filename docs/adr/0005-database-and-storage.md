# 5. Database and Storage Strategy

Date: 2026-10-14

## Status

Accepted

## Context

The system has diverse data storage requirements:
1. **Relational/structured data** — Users, Jobs, Applications, Scraper sources. Requires strict referential integrity, foreign keys, and ACID transactions.
2. **Flexible hierarchical data** — LMS syllabus trees. A deeply nested, user-customizable structure that doesn't fit neatly into normalized relational rows.
3. **Vector data** — Semantic embeddings for job descriptions and user profiles, required for fit scoring and duplicate detection.
4. **Ephemeral/cache data** — Frequently accessed dashboard data, Celery task state, API rate limit counters.
5. **File storage** — User resume PDFs, downloaded government notification PDFs.

## Decision

### Primary Database: PostgreSQL 16

PostgreSQL is chosen as the single primary database. It handles all five storage requirements through its feature set, eliminating the need for multiple database systems:

- **Relational data** → Standard normalized SQL tables with foreign key constraints.
- **Flexible hierarchical data** → `JSONB` column type. The LMS syllabus (`UserLearningRoadmap.customized_nodes`) is stored as JSONB. This avoids a 6-table JOIN to load a single study checklist while retaining the ability to query and index specific JSONB paths.
- **Vector data** → `pgvector` extension. Job description embeddings and resume embeddings are stored as `vector(1536)` columns (OpenAI) or `vector(768)` columns (nomic-embed-text). pgvector's IVFFlat index handles similarity search at our scale (thousands of jobs) without a separate vector database.

**Rejected alternatives:**
- **MongoDB** — Would give document flexibility everywhere, but sacrifices relational integrity for entities like `ApplicationTracker` where foreign key constraints prevent orphaned records.
- **Pinecone / Weaviate** — Dedicated vector databases. Adds cost, operational complexity, and a third infrastructure dependency. pgvector is sufficient for our scale.
- **Supabase** — A managed PostgreSQL wrapper. Rejected to avoid vendor lock-in; we can always move to Supabase later if managed hosting is needed.

### ORM Strategy

Two ORMs are used, one per language:
- **Prisma v5** (TypeScript/Next.js) — Best-in-class DX for TypeScript. Schema defined in `schema.prisma`, auto-generates fully typed client. Prisma Migrate handles all schema changes.
- **SQLAlchemy 2.0 async** (Python/FastAPI) — Industry standard for Python. Alembic manages Python-side migrations if needed. In practice, Prisma Migrate is the single source of truth for schema changes; SQLAlchemy reflects the same schema.

### Cache and Task Broker: Redis

Redis serves dual purpose:
1. **Celery broker + backend** — Persists task messages and results for the scraping/AI worker queue.
2. **Application cache** — Caches frequently accessed, slow-to-compute data (e.g., dashboard stats, scraper run status). Avoids hammering PostgreSQL with repeated heavy aggregation queries.
3. **Rate limit store** — Server-side enforcement of API rate limits.

### File Storage

- **Phase 1 — Local filesystem** — Resume uploads and downloaded PDFs stored on the server filesystem. Simplest approach for a self-hosted single-user tool.
- **Phase 2+ — Cloudflare R2** — S3-compatible object storage. Zero egress fees (unlike AWS S3). Files referenced by URL in the database.

AWS S3 was considered and rejected due to egress costs. Cloudflare R2 provides the same API with no egress charges.

## Consequences

- **Positive:** One database engine (PostgreSQL) handles relational, document, and vector storage. Zero polyglot persistence overhead.
- **Positive:** pgvector eliminates the need for a separate vector database, saving ~$70+/month in managed vector DB costs.
- **Positive:** JSONB for LMS roadmaps gives document-like flexibility exactly where needed, without contaminating the rest of the schema.
- **Negative:** pgvector's IVFFlat index requires a minimum number of rows to be effective (~1000+). Below that threshold, exact nearest-neighbor search is used, which is slower but correct. Not a concern at MVP scale.
- **Negative:** Two ORMs (Prisma + SQLAlchemy) means schema changes must be coordinated. Prisma Migrate is the single source of truth; SQLAlchemy models must be kept in sync manually.
