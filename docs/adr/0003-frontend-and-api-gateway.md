# 3. Frontend Framework and API Gateway

Date: 2026-10-14

## Status

Accepted

## Context

The system requires a desktop-first UI with:
- High-density data tables displaying 50–100+ job applications with sorting, filtering, and bulk actions
- A dashboard with charts/stats (deadline countdowns, fit scores, pipeline summary)
- Complex multi-step forms (onboarding, post-mortem logging, LMS syllabus editing)
- Real-time status updates for async scraping jobs ("Scraping in progress...")
- An API layer that communicates with both the database (via ORM) and the Python FastAPI service

The primary constraint is **Desktop-First** — no mobile responsiveness required in Phase 1 or 2. This frees us from choosing a heavy, opinionated component library and allows a premium custom UI.

## Decision

### Frontend: Next.js 15 (App Router) + TypeScript

Next.js is chosen as the primary framework. It serves dual roles:
1. **UI** — React Server Components for initial page loads; Client Components for interactive tables and forms.
2. **BFF (Backend For Frontend)** — Route Handlers handle CRUD, file uploads, and SSE streams. This eliminates the need for a separate Node.js API server in Phase 1–2.

### API Layer: tRPC

tRPC provides end-to-end type safety between the Next.js frontend and the Next.js Route Handler backend. Procedure input/output types are defined once in the tRPC router and are automatically available in the React components. This eliminates the manual synchronization of API types that REST requires.

Zod is used for all schema validation and is shared between tRPC procedures, form validation (React Hook Form), and data contract definitions.

### Data Fetching: TanStack Query

TanStack Query manages all async state on the client side: loading/error states, background refetch, optimistic updates, and cache invalidation. It works natively with tRPC.

### Tables: TanStack Table v8

TanStack Table is the only headless table library that handles the full feature set required:
- Column sorting, filtering, and grouping
- Row virtualization (renders only visible rows — critical for 100+ job lists)
- Bulk selection and actions
- Fully custom rendering (no fighting a UI library's design system)

### Real-time Updates: Server-Sent Events (SSE)

For streaming scraper progress to the UI (e.g., "Found 14 new jobs from FreeJobAlert"), SSE is preferred over WebSockets. Reason: our updates are strictly one-directional (server → client). SSE is simpler to implement, works natively through Next.js Route Handlers, and requires no additional server infrastructure.

### Authentication: Auth.js v5 (NextAuth)

Auth.js is the de facto authentication standard for Next.js. It handles:
- Email/password credentials
- OAuth providers (Google, GitHub) for optional social login
- JWT + database session management
- Built-in CSRF protection

### Styling: TailwindCSS + Radix UI (selective)

TailwindCSS for all styling — utility-first, enables fast iteration on a custom design system without fighting an opinionated component library. Radix UI headless primitives are used selectively only for accessibility-critical components (modals, dropdowns, tooltips) where WAI-ARIA compliance would be expensive to implement from scratch.

## Consequences

- **Positive:** Single language (TypeScript) and single runtime (Node.js) for frontend and BFF. Massive reduction in context-switching.
- **Positive:** tRPC eliminates an entire category of bugs (mismatched API types between frontend and backend).
- **Positive:** TanStack Table's virtualization means the UI remains fast even with hundreds of job rows.
- **Positive:** SSE is simpler than WebSockets and sufficient for our unidirectional update use case.
- **Negative:** Next.js App Router introduces a server/client component boundary that requires discipline. All interactive components (tables, forms) must be explicitly marked as `"use client"`.
- **Trade-off:** If the API grows complex enough in Phase 3+, the BFF can be extracted into a standalone Fastify server without changing the frontend — tRPC supports this via HTTP adapter.
