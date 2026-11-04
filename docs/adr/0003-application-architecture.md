# 3. Application Architecture: Single Next.js App in a pnpm Workspace

Date: 2026-10-30

## Status

Accepted. Replaces the original ADR 0003 (Next.js + tRPC BFF) and ADR 0004 (FastAPI + Celery + Redis data engine) from commit `3de4acf`.

## Context

ADR 0002 makes this a single-user, local-first tool. The original design split work across Next.js, a FastAPI service and Celery workers backed by Redis. That split existed to keep heavy work away from a shared web server and to scale workers horizontally. Neither concern applies to one user.

The app still needs:
- a desktop-first UI with dense tables and long forms,
- background work that must not block the UI (AI extraction takes 3–8 s on CPU; scheduled reminders; scraping in Phase 2),
- HTTP endpoints the browser extension can call (Phase 2),
- Python-grade PDF table extraction for government notifications (Phase 2).

## Decision

### One full-stack Next.js 15 app (Phase 1)

- **React Server Components** read from the database directly.
- **Server Actions** handle all mutations from the UI. They are type-safe end to end, with Zod validation on every input.
- **Route Handlers** expose plain HTTP endpoints only where something outside the UI needs them: the extension, and health checks.
- **No tRPC.** In a single app, Server Actions already give typed client→server calls. The extension needs plain HTTP anyway.
- **No TanStack Query and no SSE in Phase 1.** Server Components plus `revalidatePath` cover data loading for one user. Task status is polled. Either can be added if a concrete screen needs it.

### Background work: worker process plus a `tasks` table

- A `tasks` table in the database holds queued work: type, payload, status, attempts, last error, run-after time. It is named `tasks` to avoid confusion with job *postings*.
- A separate Node process (`apps/web/src/worker.ts`, run with `tsx`) polls the table, runs tasks with retry and backoff, and hosts cron schedules (`node-cron`).
- It is a separate process because Next.js has no reliable hook for long-running background work, and AI calls must never block a request.
- Redis and Celery are not used. A database-backed queue is durable, can be inspected with plain SQL, and is plenty for one user.

### Repository layout: pnpm workspace

```
apps/web/            Next.js app + worker            (Phase 1)
apps/extension/      Plasmo Web Clipper              (Phase 2)
packages/shared/     Zod schemas, enums, types       (Phase 2, when a 2nd consumer exists)
services/ingest/     Python ingestion service        (Phase 2, not a pnpm package)
```

- The workspace layout is created on day one, with only `apps/web`. That avoids moving the app and rewriting CI/Docker paths later.
- Code moves into `packages/*` only when it has **two real consumers**. Dependencies point one way only: `apps → packages`.
- Internal packages export TypeScript source directly (`"exports": "./src/index.ts"`) and are compiled by the consuming bundler (`transpilePackages` in Next.js). There is no separate build step.
- Shared dependency versions (React, Zod, TypeScript) are pinned once via pnpm **catalogs**.
- No Turborepo or Nx. `pnpm -r` and `pnpm --filter` are enough at this size.

### Python is deferred to Phase 2

- `services/ingest` is added when scraping and government-PDF parsing arrive. Python's table-extraction tooling (pdfplumber, camelot) is clearly better than the TS equivalents.
- It is managed with `uv` and its own `pyproject.toml`, outside the pnpm workspace.
- **FastAPI vs a plain worker is decided at that point.** FastAPI is worth it only if Next.js needs synchronous calls (for example "parse this PDF now"). In that case its OpenAPI spec generates the TypeScript client types. If the service only consumes the `tasks` table, a plain Python worker is enough.
- Only the TypeScript side (drizzle-kit) runs schema migrations. Python reads and writes the existing tables.

### UI foundation

Tailwind CSS (theme tokens as CSS variables), Radix UI primitives, `cmdk` for searchable comboboxes, TanStack Table v8 for data tables (no Kanban boards), React Hook Form with Zod resolvers, `date-fns`, and fonts loaded through `next/font`. Visual direction lives in `docs/DESIGN.md`.

### Auth

- **Local:** none by default. An optional passcode (a middleware check against a hashed value) protects the app if it is exposed on a LAN.
- **Network exposure:** the servers bind to `127.0.0.1` by default (`-H 127.0.0.1` on `next dev` and `next start`; in Docker the process inside the container must bind `0.0.0.0` (via `-H 0.0.0.0` or the `HOSTNAME` variable, confirmed in M1), otherwise the published port cannot reach it, and the host publishes it as `127.0.0.1:3000` only). Middleware also rejects any request whose `Host` header (compared without the port) is not `localhost`, `127.0.0.1` or `[::1]`. This check is skipped under `DEMO_MODE`, where the app is public, read-only and served from a real domain. The second check matters because a DNS-rebinding page passes Next.js's Origin-versus-Host check (both headers carry the attacker's domain), and without it any website could reach Reveal recovery key, backup download and restore when no passcode is set. Using the app from another device on a LAN is an explicit opt-in that requires a passcode (design settled in Phase 1 M4).
- **Demo:** none, because it is read-only.
- Auth.js is not used.

## Consequences

- **Positive:** Phase 1 is one language, one app and one database file. `pnpm dev` plus the worker is the whole system.
- **Positive:** The workspace layout absorbs the extension and the Python service later without restructuring.
- **Negative:** The worker is a second process to run. Mitigated by a single `pnpm dev` script that starts both, and, for those who want a container, by both running inside one optional Docker image.
- **Negative:** Without tRPC, the extension's HTTP contract is not automatically typed. Mitigated by validating both ends with the same Zod schema from `packages/shared`.
- **Trade-off accepted:** The design does not scale to many concurrent users. That is intentional (ADR 0002). If hosting is ever revisited, this ADR must be revisited with it.
