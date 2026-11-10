# Product Requirements Document (PRD): Automated Job Discovery & Application Tracking System

## 0. Product Context

- **What it is:** A local-first, single-user tool for tracking government and private job applications, checking eligibility, and planning preparation. It runs on the user's own machine, and personal data never leaves it by default.
- **Who it's for:** The author first. Anyone else can self-host it from the public GitHub repository.
- **AI:** Optional. It runs on the user's local model (Ollama) or the user's own API key. Every feature works without AI through manual entry.
- **Public demo:** Read-only, with fake data and precomputed AI results. It exists for showcase purposes only.
- **Out of scope:** Hosted multi-user accounts, payments, and storing anyone else's data.

See ADR `0002-product-direction.md`.

## 1. Epic & Scope Breakdown

### Epic 1: Multi-Source Data Ingestion & Duplication Triage

Jobs enter the tracker three ways (see ADR `0006-data-ingestion.md`):

- **Manual Entry (Phase 1):**
  - A job form, with an optional "paste job description" field that AI can pre-fill when enabled.

- **Curated Scraper Adapters (Phase 2, automated):**
  - A vetted set of aggregator sites (e.g., FreeJobAlert, SarkariResult), each with a custom adapter.
  - Runs on a daily schedule on the user's own machine. Each installation scrapes only for itself.
  - Targets and run-state are stored in the `scraper_sources` table, seeded from `sources.json` on first boot.
  - New sites are added through GitHub issues and pull requests.

- **Web Clipper (Phase 2, client-side):**
  - For any other site (LinkedIn, Naukri, company career pages), the browser extension clips the current page into the local app.

- **The "Backlog / Triage" Pipeline Stage:**
  - All scraped and clipped jobs land in a "Backlog" queue before entering the main tracker.

- **Duplicate Resolution:**
  - Scraping multiple aggregators causes duplicates. A "Duplicate Check" action groups likely duplicates for manual review (Merge/Delete). It uses embedding similarity when AI is enabled and title + organisation matching otherwise.

### Epic 2: Eligibility, Fit, and Preparedness Engine
- **Government Job Eligibility Validator:**
  - Implement hard-filter validation rules (degree, age, category) using manually onboarded user data.
- **Private Job Semantic Fit Matching:**
  - Compare job descriptions against the structured user profile and unstructured uploaded resume.
- **The Preparedness Score (Public Sector Focus):**
  - The system calculates a "Preparedness Score" (e.g., 65% Ready) by cross-referencing the specific exam syllabus required for the government job against the user's actual progress inside the Interactive LMS (Epic 6).

### Epic 3: Focused Micro Upskilling & Post-Mortem Feedback
- **Iterative, Foundation-Based Upskilling:** 
  - The system analyzes shortlisted private jobs and identifies the most demanded missing skills, suggesting the next highest-ROI skill based on what the user *already knows*.
- **Interview Post-Mortem Feedback Loop:**
  - When a job is moved to the `REJECTED` stage, the user is prompted to log a brief post-mortem (e.g., "Failed System Design round", "Weak in React Hooks").
  - This failure data is instantly fed back into the learning engine, dynamically reprioritizing the user's focus skills and syllabus tracker to ensure they learn from direct failures.

### Epic 4: Centralized Command Center & Notification Engine
- **Unified Summary Dashboard:**
  - A clean landing page displaying high-level stats, the top 3 most urgent approaching deadlines, and the highest "Preparedness Score" or "Fit Score" job available right now.
- **Sector-Specific Tabs:**
  - **Government/Public Tab:** Dedicated interface for hard-filters, Vacancies, Preparedness Scores, Category quotas, and exam dates.
  - **Private/IT Tab:** Dedicated interface for semantic fit scores, required tech stacks, and recruiter links.
- **Proactive Notification Engine:**
  - A low-friction alert system that pings the user when an application deadline is 24 hours away or a Spaced Repetition revision is due.
  - Phase 1: in-app reminders on the dashboard. Later: browser/extension notifications, plus an optional email digest through the user's own SMTP settings.
- **Follow-up Reminders (private jobs):**
  - Follow-up only makes sense once a person has engaged. An application in `ASSESSMENT` or `INTERVIEW`, or in `APPLIED` with a recruiter contact on it, with no activity for a set number of days shows "No reply from <organisation> in N days. Follow up?" on the dashboard. Defaults: 7 days after applying, 5 days after an assessment or interview, editable in settings. Activity is the latest of the last stage change and `last_contact_at`.
  - A cold `APPLIED` application (no recruiter contact) never gets a follow-up reminder: silence from a large company is the normal outcome. The table shows "days since applied" instead.
  - Housekeeping: cold `APPLIED` applications with no response for 45 days (editable) appear in one quiet, grouped line, "N applications with no response. Close them?". The app only suggests, never closes anything itself.
  - "Followed up" sets `last_contact_at` and restarts the clock. The user can also snooze to a chosen date, stored in `next_action_due`, which overrides the default threshold for that application.
  - The application keeps an optional recruiter name and contact (email or profile link), so the reminder links straight to who to message.
  - After repeated follow-ups with no reply, the reminder suggests closing the application as `REJECTED` with reason `no_response`. Closing is reversible: "Reopen" returns the application to a stage the user picks (for example `INTERVIEW` when a recruiter calls back weeks later), clears the reason, and `StageHistory` keeps the full trail.
  - Reminders are derived from current data when the dashboard loads. Nothing is sent to the recruiter and no background process is needed. Government applications are excluded (exam and result dates, no recruiter to chase). Out of scope: sending email, reading the user's inbox to detect replies, AI-drafted messages (possible later in Phase 2).

### Epic 5: Vacancy Extraction
- **Vacancy Tracking:**
  - Accurately extract the exact number of vacancies/openings from notifications (especially for government roles), including category-wise breakdowns if available.

### Epic 6: Interactive LMS, Revision Tracking ("Rewatches")
- **Native Curriculum Engine (Starter Templates):**
  - A native library of high-level starter templates (e.g., GATE CS Basics, Core Frontend) to get users moving quickly.
- **Deep Customization (Build-from-Scratch):**
  - Users have full micro-level CRUD capabilities to generate, edit, and inject their own granular syllabus nodes.
- **Interactive Progress Tracking & Checklists:**
  - Gamified checklist interfaces mapping visual progress metrics.
- **Spaced Repetition & Revision Tracking ("Rewatch" System):**
  - Concept-based revision tracking counters prioritizing mastery.
  - Users can increment the revision counter for a single sub-topic or cascade the count across entire subjects.

### Epic 7: Hybrid User Onboarding & Profile Generation
- **Manual Core Intake (Guaranteed Accuracy):**
  - Deliberately require manual input for critical structured data: Demographics (DOB, Category, Domicile), Top Skills, Years of Experience, and CTC.
- **Contextual Resume Upload:**
  - Allow users to upload their master resume (PDF/Docx) as a rich text corpus to provide extra context to the Semantic Fit Engine for private jobs.

### Epic 8: Browser Extension Ecosystem
- **Universal Job Web Clipper (On-the-fly Ingestion):**
  - Manually trigger the extension to parse the DOM of any career page and send the job to the Backlog.
- **Connection Mapping (Referral Engine):**
  - When the user explicitly clicks "Find Referrals" in the dashboard, the extension runs a single, secure background query to LinkedIn using the active local session.
- **Client-Side Guardrails & Rate Limiting:**
  - To prevent LinkedIn bans, the extension enforces a hard local rate limit (e.g., Maximum of 10 referral checks per 24-hour rolling window).

---

## 2. Non-Functional Requirements (NFRs)
- **Data Security & Privacy:** The application ingests highly sensitive Personal Identifiable Information (PII), including exact DOB, caste/category, current salary (CTC), and full resumes.
  - All personal data is stored locally. The database is encrypted at rest.
  - PII is never sent to a cloud AI provider unless the user explicitly allows it in settings.
  - LinkedIn session tokens never leave the browser extension.
  - The local API used by the extension requires a pairing token.
  - A local install listens on localhost only and rejects unknown `Host` headers (the public demo is exempt, since it holds only fake data). Using it from another device on a network is an explicit opt-in that requires the passcode (ADR `0003-application-architecture.md`).
  - Uploaded files (resumes) are stored inside the encrypted database (ADR `0004-data-storage.md`).
- **Backup & Portability:** The user can export everything as one encrypted file and restore it on any installation (see ADR `0008-backup-and-restore.md`).
  - Backups are encrypted with the user's recovery key. The key is never stored inside the backup.
  - API keys, the extension pairing token and the passcode are not exported.
  - Restore validates the file first, backs up the current data, and never leaves a half-restored database.
- **Local-First & Single-User:** One profile per installation. No accounts, no hosted backend. The full system runs with one command (`pnpm dev`, or optionally one Docker image).
- **AI Is Optional:** Every feature remains usable with AI disabled. AI work runs in the background and never blocks the UI.
- **Public Demo:** Read-only, fake seeded data, precomputed AI output, zero live AI calls. Real data entry and uploads are disabled.
- **Desktop-First Form Factor:** Given the complexity of high-density data tables, dual-sector views, syllabus trees, and the mandatory browser extension, Phase 1 & 2 of this MVP are explicitly constrained to a **Desktop-First** experience. Mobile responsiveness is de-prioritized to prevent development bloat.

---

## 3. Edge Cases & Scope Refinements
- **Data Freshness and Corrigendums:** Government jobs frequently issue "corrigendums" extending deadlines. The system must support updating existing job entities.
- **Geographic & Domicile Constraints:** Validated as a hard filter using manual intake data.
- **Quota & Category Processing:** Public sector eligibility relies heavily on reservation categories, which change the age limit and the cut-offs. The user enters each job's final age limit per category or flag as the notification prints it; the engine picks the highest limit that applies to the profile and never calculates relaxations itself (ADR `0010-eligibility-rule-model.md`).

---

## 4. High-Priority User Stories & Acceptance Criteria

### Feature 1: The Triage Backlog & AI Duplicate Check
**User Story:** As a job seeker, I want automated scraped jobs and my manually clipped jobs to go into a review queue first, so I can merge duplicates and verify the data before it clutters my main tracker.

### Feature 2: Interview Post-Mortem & Adaptive Learning
**User Story:** As a candidate who just failed an interview, I want to log the reason for my rejection so the learning engine can immediately adapt my syllabus to fix my weak points before my next interview.

**Acceptance Criteria:**
- Moving a job to `REJECTED` asks for a reason (`rejected`, `no_response`, `withdrawn`). Only `rejected` triggers the mandatory or optional "Post-Mortem" input field; a company that never replied has no failure to learn from.
- Extracted keywords from the post-mortem (e.g., "Dynamic Programming") are confirmed by the user and then reprioritise their focus skills (Phase 2). Once the LMS exists (Phase 3), the same skills highlight matching nodes in the roadmap, or propose a new node that the user confirms. Nothing is added silently.

### Feature 3: Browser Extension (Job Clipping & Safe Referrals)
**User Story:** As a job seeker, I want an extension that acts as a manual job clipper while browsing, and acts as a secure bridge to LinkedIn only when I explicitly request a referral search, strictly bound by rate limits to ensure zero risk to my account.

### Feature 4: Encrypted Backup & Restore
**User Story:** As a user whose data lives only on my machine, I want to export everything to one file and restore it on a new machine, so a lost disk or a bad upgrade does not erase my job search.

**Acceptance Criteria:**
- Settings → Data & privacy has "Back up everything" and shows the last backup date. The dashboard reminds the user if there is no backup, or the last one is over 30 days old.
- The export is a single `.zip` that cannot be read without the recovery key. It never contains the recovery key.
- Restore works on first run (empty install) and from Settings (replacing existing data).
- Restore asks for the recovery key. A wrong key or a damaged file is rejected with a clear message, and nothing changes.
- A backup made by a newer app version is rejected. A backup from an older version is migrated forward.
- Before replacing existing data, the app saves a pre-restore backup.
- After restore, the user is told to re-enter the API key, re-pair the extension, and set a passcode if wanted.
- Export and restore are disabled in the public demo.

---

## 5. Data Contract (Core Entities & Schema)

Single-user installation: there is exactly one profile, so entities do not carry `user_id` (see ADR `0004-data-storage.md`).

### Entity: `UserProfile` (single row)
- `manual_demographics` (Object: DOB, category, flags, domicile region), `manual_professional_data` (Object: qualifications with level, discipline, status and completion date; skills; years of experience; CTC), `resume_corpus_text` (String), `resume_file_id` (reference to `File`)
- Category, flags, region, level and discipline are keys into the lookup tables below (ADR `0010-eligibility-rule-model.md`).

### Entity: `JobPosting`
- `job_id` (UUID), `source_url_or_ref` (String), `source_type` (Enum: `MANUAL`, `SCRAPER`, `CLIPPER`), `sector_type` (Enum)
- `organization`, `title`, `work_model`, `dates` (Object)
- `vacancies` (Integer), `preparedness_score` (Float)
- `eligibility_criteria` (Object, versioned: age limits per category or flag, cutoff date, accepted qualifications, domicile, manual checks), `extracted_skills` (List of Strings)
- `embedding` (Vector), `embedding_model` (String)
- Edits to a posting (for example a corrigendum extending the deadline) keep the previous values in `JobPostingHistory`.

### Entity: `ApplicationTracker`
- `application_id`, `job_id`
- `eligibility_status`, `ineligibility_reason`, the full eligibility result with `engine_version` and evaluation time, an optional user override with a note, `fit_score`
- Every stage change writes a `StageHistory` row.
- `lifecycle_stage` (Enum): `BACKLOG`, `DISCOVERED`, `APPLIED`, `ASSESSMENT`, `INTERVIEW`, `OFFER`, `REJECTED`
- `rejection_reason` (Enum, set on `REJECTED`): `rejected`, `no_response`, `withdrawn`
- `post_mortem_notes` (Text): Logged failure reasons.
- `last_contact_at` (DateTime): last time the user followed up. Starts the follow-up clock together with the last stage change.
- `next_action_due` (DateTime, optional): user-chosen snooze or "remind me on" date. When set, it replaces the default follow-up threshold for this application.
- `recruiter_name`, `recruiter_contact` (Text, optional)
- `network_matches` (List of Objects)

### Entity: `UserLearningRoadmap`
- `roadmap_id` (UUID)
- `current_focus_skills` (List of Strings)
- `customized_nodes` (List of Objects)
- `progress_tracking` (Map<String, Object>)

### Entity: `Task` (background work queue)
- `task_id`, `type`, `payload` (Object), `status`, `attempts`, `last_error`, `run_after` (DateTime)

### Supporting entities
- `File`: uploaded resumes and PDFs stored as BLOBs (`kind`, `mime`, `size`, `sha256`, `content`), capped at 10 MB.
- Lookup tables `ref_categories`, `ref_regions`, `ref_qualification_levels`, `ref_disciplines`: seeded from files shipped with the app, plus user-added rows. Each row has a text `key`.
- `Setting`: key/value settings, including AI overrides.
- `ReminderDismissal`: which derived reminders the user has dismissed.
- `JobPostingHistory` and `StageHistory`: audit rows described above.

### AI Provenance (on every AI-generated value)
- `provider`, `model`, `prompt_version`, `generated_at`

---

## 6. Proposed Phased Rollout (MVP Strategy)
- **Phase 1 (The Core Tracker MVP):** Epics 2, 4, & 7.
  - Manual job entry, the Summary Dashboard and Sector Tabs.
  - Manual onboarding and resume upload.
  - A first-run screen: confirm the recovery key is saved outside the machine, optionally set a passcode, or restore from a backup.
  - Encrypted backup and restore (Feature 4). Phase 1, because a local-only app has no other safety net.
  - The rule-based eligibility engine.
  - Optional AI (resume parsing, fit scoring).
  - The read-only public demo.
  - Desktop-First NFRs.
  - Vacancy counts are typed by hand in Phase 1; automatic extraction (Epic 5) is Phase 3.
  - Preparedness Scores depend on the LMS and arrive in Phase 3.
- **Phase 2 (The Discovery Pipeline & Backlog):** Epics 1, 3, & 8.
  - Curated scraper adapters (Python ingestion service).
  - The Web Clipper extension, with pairing token and rate limits.
  - The Backlog triage stage and duplicate check.
  - Foundation-based upskilling with Post-Mortems.
- **Phase 3 (The LMS Ecosystem & Preparedness):** Epics 5 & 6.
  - Vacancy extraction from notification PDFs.
  - Native starter templates and the Spaced Repetition tracking system.
  - Preparedness Scores.
