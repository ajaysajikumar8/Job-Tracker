# 1. Record architecture decisions

Date: 2026-10-10

## Status

Accepted

## Context

We need a structured, historical log of the critical technical decisions made on this project so that future developers (and AI agents) understand the "why" behind the codebase.

## Decision

We will use Architecture Decision Records (ADRs), as described by Michael Nygard. We will store them in the `docs/adr` directory as markdown files, using a sequential numerical prefix (e.g., `0001`, `0002`).

## Consequences

- We will have a clear, searchable history of technical decisions.
- AI agents will have a canonical source of truth for understanding the system's architecture, preventing hallucinations or recommendations that contradict established patterns.
