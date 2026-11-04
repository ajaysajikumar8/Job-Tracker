# 4. Data Storage: SQLite (libSQL) with Drizzle

Date: 2026-10-30

## Status

Accepted. Replaces the original ADR 0005 (PostgreSQL + pgvector + Redis + Cloudflare R2) from commit `3de4acf`.

## Context

Storage needs for a single-user, local-first tool (ADR 0002):

1. **Relational data:** profile, job postings, applications, tasks, scraper sources. These need foreign keys and transactions.
2. **Flexible nested data:** LMS syllabus trees and eligibility criteria. These are user-customisable and awkward to fully normalise.
3. **Vectors:** embeddings for fit scoring and duplicate detection.
4. **Files:** uploaded resumes and downloaded notification PDFs.
5. **Encryption at rest:** the PRD requires it because the DB holds DOB, category, CTC and resume text.

Running a database server (PostgreSQL) and a cache/broker (Redis) for one user adds installation and operational burden with no benefit.

## Decision

### Database: SQLite via libSQL

- **One file** (`data/app.db`). Nothing to install. Backups are encrypted exports (ADR 0008), not raw file copies.
- **libSQL** (the SQLite fork used by Turso) adds:
  - **native vector columns** (`F32_BLOB(768)` for `nomic-embed-text`) with vector search, so no pgvector or separate vector store is needed;
  - **encryption at rest** for local database files through the client's encryption key. The key is the **recovery key**, read from the `RECOVERY_KEY` environment variable at startup (see ADR 0009 for format, storage, startup rules and rotation);
  - a **hosted option (Turso)** that uses the same driver, used for the read-only demo.
- **Nested data** is stored as JSON columns (`text` with Zod-validated shape) and queried with SQLite JSON functions where needed.
- **WAL mode** is enabled so the web app and worker can read while one writes.

### ORM and migrations: Drizzle

- Typed, close-to-SQL queries. SQLite/libSQL support is first-class, and there is no engine binary.
- `drizzle-kit` owns all migrations, and it is the **only** migration tool in the repo. The Phase 2 Python service reads and writes existing tables but never migrates.
- If the project ever moves to PostgreSQL, Drizzle supports it with the same schema style.

### Files: BLOBs in the database

- Uploaded resumes (and, in Phase 3, notification PDFs) are stored as BLOBs in a `files` table (`id`, `kind`, `mime`, `size`, `sha256`, `content`, `created_at`), so they are covered by database encryption and by one consistent snapshot. Other tables reference a file by `file_id`.
- Uploads are capped at 10 MB. There is no file path on disk, so path traversal and file-versus-database drift cannot happen.
- Text extraction and parsing read the BLOB in the worker, never a user-supplied path.
- `data/` is git-ignored as a whole (`/data/` in `.gitignore`).

### Single-user schema

There is exactly one profile, so tables do not carry `user_id` foreign keys. Adding multi-user support later would be a deliberate migration, not a hidden assumption.

## Alternatives Considered

| Option | Why not |
|:---|:---|
| PostgreSQL + pgvector | A database server to install and operate for one user. |
| Redis (cache / broker) | The `tasks` table replaces the broker (ADR 0003). One user does not need a cache layer. |
| Prisma | Heavier, ships an engine binary, and libSQL support is weaker than Drizzle's. |
| `sqlite-vec` extension | A reasonable choice, but libSQL's built-in vectors avoid loading an extension and match the Turso demo. |
| Cloudflare R2 / S3 | No hosted file storage is needed. |

## Consequences

- **Positive:** Zero infrastructure. Setting up locally means installing dependencies and starting the app, which applies migrations itself (see the amendment below).
- **Positive:** The local app and the demo use the same engine, driver and schema.
- **Negative:** SQLite allows one writer at a time. That is fine for one user plus one worker in WAL mode, and a known limit if usage ever grows.
- **Negative:** Files live in the database, so the file grows with every upload and backups carry them. At single-user scale (a handful of resumes, 10 MB cap) this is fine. If large document volumes ever appear, move files out and encrypt them at file level.
- **Negative:** Losing the encryption key means losing the data. The README must document how to back up the key. Data backup is the in-app feature defined in ADR 0008.
- **Negative:** The key lives in an env file on the same machine (ADR 0009). Encryption at rest protects a copied `app.db` (resumes included), not a compromised logged-in machine. Full-disk encryption covers that case.
- **Trade-off accepted:** JSON columns trade some query power for flexibility. Shapes are enforced by Zod at the application boundary.

## Amendment (2026-11-03): migrations run automatically at start-up

`drizzle-kit` still generates and owns the migration files, and remains the only tool that creates them. The change is who **applies** them: the app's `bootstrap` step applies pending migrations itself on every start, so an update (`git pull` or a new Docker image) needs no separate migrate command.

- Before applying any pending migration, bootstrap checkpoints the WAL (`PRAGMA wal_checkpoint(TRUNCATE)`, so the copy contains every committed write) and copies the database to `data/backups/pre-migrate-<timestamp>`, keeping the latest 3. This is the rollback. Nothing else has the file open at that point, because bootstrap runs before web and worker.
- A failed migration is fatal: the app does not start, and the log names the failing migration and the copy to restore.
- Bootstrap runs once, before the web app and worker start (`pnpm dev`, `pnpm start`, the Docker entrypoint), so web and worker never migrate concurrently. It also runs after a restore, where it performs the database swap (ADR 0008).
- Bootstrap exposes a `migrateTo(version)` helper that applies only the first N generated migrations (the Drizzle migrator on a sliced list). Restore uses it to rebuild a database at an older backup's `schema_version` before migrating forward.
- Applying uses the Drizzle runtime migrator on the already-generated files. No schema generation happens at runtime.
- In `DEMO_MODE` bootstrap makes no writes.
- Seeding of reference data runs right after migrations in the same step (ADR 0010).
- **Risk:** a destructive migration (dropping or rewriting a column) runs without a prompt. Mitigated by the pre-migration copy, by reviewing every generated migration before release, and by the restore-fixture tests in ADR 0008. A migration that cannot be made safe should be split into an additive release followed by a cleanup release.

## Amendment (2026-11-04): uploaded files are stored in the database

The original decision kept resumes and PDFs under `data/files/`, outside database encryption. That left the most sensitive document next to the key, in plain text, and forced restore to swap two paths consistently. Files are now BLOBs in a `files` table (see "Files: BLOBs in the database"). Effects: resumes are encrypted at rest, a backup is one consistent snapshot, restore swaps a single file, and no code path handles a user-supplied file path. Cost: a larger database file, accepted at single-user scale.

