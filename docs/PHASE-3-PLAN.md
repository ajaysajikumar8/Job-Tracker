# Phase 3 Implementation Plan: LMS Ecosystem and Preparedness

> Scope: PRD §6 Phase 3 (Epics 5 and 6, plus the Preparedness Score from Epic 2).
> Status: Draft, 2026-11-02. This is the furthest-out phase and the least certain. Treat it as a map of the work and the open questions, not a commitment. **Re-plan at the start of Phase 3 (task P3-M0).**
> Ground rules from `PHASE-1-PLAN.md` still apply.

## Entry gate

- [ ] Phase 2 complete (or deliberately cut short), with the Python ingest service running.
- [ ] Phase 1/2 used for real. Phase 3 is the largest feature set and the easiest to over-build: confirm you will actually study with it before investing.
- [ ] Next free ADR number checked.

## Milestone order

```
P3-M0 Re-plan + decisions ─▶ P3-M1 Syllabus data model ─▶ P3-M2 Curriculum CRUD + templates
      ─▶ P3-M3 Progress + revision ("rewatch") ─▶ P3-M4 Vacancy extraction
      ─▶ P3-M5 Preparedness Score ─▶ P3-M6 Post-mortem to roadmap link ─▶ P3-M7 Polish
```

The LMS (M1–M3) must exist before the Preparedness Score (M5), because the score reads LMS progress. Vacancy extraction (M4) is independent of the LMS and can be built in parallel or first if government notifications are the bigger daily pain.

---

## P3-M0: Re-plan and decisions

- [ ] **Re-read the PRD, ADRs and Phase 1/2 outcomes.** Rewrite this file. **Done when:** every task below is confirmed or replaced.
- [ ] **ADR: syllabus data model.** The PRD lists `customized_nodes` (List of Objects) and `progress_tracking` (Map) as JSON on `UserLearningRoadmap`. That works for reading but is poor for per-node queries, the cascading revision count and the Preparedness Score. Decide between: (a) JSON tree in one column, (b) normalised `syllabus_nodes` table with `parent_id` (adjacency list) plus a `node_progress` table, (c) a hybrid. **Recommendation to evaluate:** (b), because cascading updates and score aggregation are table operations, and the template content can stay JSON. **Done when:** ADR Accepted with the cascade and aggregation queries sketched.
- [ ] **ADR: spaced-repetition scheduling.** The PRD describes a manual "revision counter" ("Rewatch") with cascading increments, plus reminders when a revision is due. Decide: counter only, or counter + due dates (a simple interval ladder such as 1/3/7/21 days vs SM-2). Avoid overbuilding. **Done when:** ADR Accepted, with the reminder trigger defined.
- [ ] **ADR: Preparedness Score formula.** Define it precisely before any code: how syllabus coverage and revision count combine, how topic weights are set (equal, per-exam weightage, user-set), and what "65% ready" means. **Done when:** ADR has the formula, a worked example, and explains why the number is not misleading (for example, shows coverage and revision confidence separately as well as combined).
- [ ] **Decide the template content source.** Who writes "GATE CS Basics" and "Core Frontend", and under what license? Do not copy copyrighted syllabus text. **Done when:** a content policy and source are recorded.
- [ ] **Decide vacancy-extraction acceptance bar.** Government PDFs vary wildly. Set a target (for example "correct total + category split on 8 of 10 sample notifications, and every miss flagged for review"). **Done when:** a sample set of real notification PDFs is collected and the bar is written down.

## P3-M1: Syllabus data model and engine

- [ ] **Migration** per the P3-M0 ADR: syllabus tables, node progress, revision log. *Migration: confirm first.* **Done when:** it applies on a Phase 2 database copy and all earlier backup fixtures still restore.
- [ ] **Backup registry + fixtures:** add the new tables, bump `schema_version`, add a fixture. **Done when:** a Phase 2 backup restores into Phase 3 and Phase 3 round-trips.
- [ ] **Tree operations in a pure, tested module:** add, move, reorder, delete (with subtree), aggregate. Reject cycles and cap depth. **Done when:** property-style tests cover move-into-own-subtree and large trees.
- [ ] **Zod schemas for nodes and progress**, shared with forms and backup validation.
- [ ] **Link `UserLearningRoadmap.current_focus_skills` (Phase 2) to nodes** by a skill-to-node mapping. **Done when:** a focus skill can resolve to zero or more nodes.

## P3-M2: Curriculum CRUD and starter templates (Epic 6)

- [ ] **Syllabus tree UI:** expand/collapse, inline add/rename/delete, drag-and-drop reorder with a keyboard alternative (Radix primitives must stay accessible). **Done when:** every action works by keyboard alone and on a 500-node tree without lag (virtualise if needed).
- [ ] **Build-from-scratch flow:** create a subject, add topics and sub-topics, attach notes and links. **Done when:** full micro-level CRUD works, with undo for delete.
- [ ] **Starter templates:** import a template into your roadmap (copied, so later edits never change the template). Templates are versioned JSON in the repo. **Done when:** importing twice does not silently duplicate, and re-importing a newer template version offers a merge.
- [ ] **Seed 2 templates** (from P3-M0 content policy). **Done when:** both import cleanly and render.
- [ ] **Add loading/empty/error states** to every LMS screen.

## P3-M3: Progress tracking and revision ("Rewatch") system

- [ ] **Checklist progress:** mark a node done/not done, with parent progress derived from children (computed, not hand-stored, to avoid drift). **Done when:** toggling a leaf updates every ancestor and the totals match a recomputation test.
- [ ] **Revision counters:** increment on one sub-topic or **cascade** across a subject. Cascades run in one transaction and write a revision log entry (so a mistaken cascade can be undone). **Done when:** a cascade over 200 nodes is atomic and reversible.
- [ ] **Revision-due reminders** (per the P3-M0 scheduling ADR) generated by the worker cron into the Phase 1 reminders system. **Done when:** a due revision appears on the dashboard and can be dismissed or snoozed.
- [ ] **Progress visuals:** per-subject progress, revision heat/confidence view. Follow `docs/DESIGN.md`; avoid decorative gamification that hides the numbers. **Done when:** every visual has a text/number equivalent for accessibility.
- [ ] **Performance check:** aggregate queries on a seeded 2,000-node roadmap. **Done when:** numbers are recorded.

## P3-M4: Vacancy extraction (Epic 5)

- [ ] **Python parser in `services/ingest`:** `pdfplumber` first, `camelot` as the fallback, extracting total vacancies and the category-wise breakdown (UR/OBC/SC/ST/EWS/PwBD) from notification PDFs. Uses the same task queue as the scrapers. **Done when:** the sample set meets the P3-M0 acceptance bar.
- [ ] **PDF acquisition:** from a Backlog/clip item's URL (an allow-listed source only) or a user upload. No server-side fetching of arbitrary user URLs (SSRF). **Done when:** an upload goes through the same size/MIME/magic-byte checks as resumes.
- [ ] **Human-in-the-loop review screen:** extracted numbers shown next to the PDF page, with sum checks (category total must equal grand total) and confidence flags. **Done when:** nothing is saved to the posting without the user confirming, and a failed sum check is highlighted.
- [ ] **Store** `vacancies` and the category breakdown with provenance (source page, parser version, confirmed by user). **Done when:** it is covered by backup/restore.
- [ ] **Rule-based first, AI optional:** use AI only for text sections (for example extracting eligibility prose), validated by Zod, never for the vacancy numbers without user confirmation. **Done when:** with AI off the table parser still works.
- [ ] **Link to eligibility:** quota data feeds the Government tab (category vacancies for the user's category). **Done when:** the tab shows "vacancies for your category" when known.
- [ ] **Regression suite:** a PDF fixture per supported layout, run in CI. **Done when:** a parser change that breaks a fixture fails CI.

## P3-M5: Preparedness Score (Epic 2)

*Requires the formula ADR and M3 data.*

- [ ] **Pure scoring module:** `score(syllabusForExam, progress) → { coverage, revisionConfidence, overall, gaps[] }`. No I/O. **Done when:** it has tests for empty, partial, complete and weighted cases.
- [ ] **Exam-to-syllabus mapping:** a government job references an exam syllabus (a node subtree or a template). **Done when:** a job can be linked to a syllabus and the link is editable.
- [ ] **Populate `preparedness_score`** (the Phase 1 column) from a worker task, recomputed when progress changes. **Done when:** the stored value matches a fresh computation, and provenance/version of the formula is stored.
- [ ] **Surface it:** Government tab column, job detail breakdown ("weakest 5 topics"), dashboard highlight ("highest Preparedness Score job right now", PRD Epic 4). **Done when:** each place shows coverage and confidence, not only one opaque number.
- [ ] **Edge cases:** no linked syllabus (show "not set up", not 0%), changed syllabus after progress exists, partially linked topics. **Done when:** none of these displays a misleading number.

## P3-M6: Post-mortem to roadmap link (closes the Phase 2 gap)

- [ ] **Inject or highlight nodes** from confirmed post-mortem skills (Phase 2 `current_focus_skills`): highlight matching nodes, or offer to create a node when none exist. Never create nodes silently. **Done when:** a rejection note mentioning "Dynamic Programming" highlights or proposes the matching node, and the user confirms before anything is added.
- [ ] **Reprioritise the review queue** so highlighted nodes surface first in revision reminders. **Done when:** order changes are explainable ("added from post-mortem on <job>").
- [ ] **Undo** for an injection. **Done when:** removing an injected node leaves no orphaned progress rows.

## P3-M7: Polish, demo and release

- [ ] **Demo data:** a fake roadmap with progress, fake vacancy breakdowns and precomputed preparedness scores. LMS writes and PDF uploads stay disabled under `DEMO_MODE` (confirm the Phase 1 write guard covers every new action). **Done when:** the demo guard test passes with the new endpoints.
- [ ] **Backup/restore full-cycle test** on a Phase 3 database from an empty install. **Done when:** progress, revisions and vacancy data survive a restore.
- [ ] **Security and privacy review:** PDF upload and parser inputs (untrusted files), any new Route Handlers. **Done when:** findings are fixed or recorded.
- [ ] **Docs:** README feature list, contributor guide for templates, update `MEMORY.md`, `docs/STACK.md`, ADR index and PRD status.
- [ ] **Retrospective:** what was cut, what to do next, and whether the "open core / hosted" question (ADR 0002) is worth revisiting. **Done when:** written down.

---

## Not in Phase 3 (candidates for later)

- Email digest, browser/extension push notifications.
- Cloud backup or sync (would need its own ADR; conflicts with "data never leaves the machine" unless opt-in).
- Multi-user or hosted version (ADR 0002 must be revisited first).
- Community template marketplace.
- Mobile layout (PRD NFR: desktop-first).

## Risks and scalability notes

| Risk | Mitigation |
|:---|:---|
| Government PDFs are inconsistent; extraction silently gives wrong numbers | Sum checks, confidence flags, mandatory user confirmation, fixture regression suite |
| A misleading Preparedness Score drives real decisions | Formula ADR, show coverage and confidence separately, "not set up" state instead of 0% |
| JSON-tree syllabus makes cascades and aggregates slow and error-prone | P3-M0 data-model ADR, normalised nodes, derived (not stored) parent progress |
| LMS scope creep (gamification, social, content library) | Epic 6 stays to: templates, CRUD, checklists, revision counters |
| Template content licensing | P3-M0 content policy; original or openly licensed content only |
| Cascade operations corrupt progress on error | Transactions, revision log, undo |
| Schema keeps growing, old backups break | Fixture restore per `schema_version` in CI (from Phase 1 M8) |
| Large syllabus trees slow the UI | Virtualised tree, aggregate queries tested at 2,000 nodes |
