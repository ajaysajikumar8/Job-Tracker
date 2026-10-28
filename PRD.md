# Product Requirements Document (PRD): Automated Job Discovery & Application Tracking System

## 1. Epic & Scope Breakdown

### Epic 1: Multi-Source Data Ingestion & Duplication Triage

Data ingestion follows a **Three-Tier Model** (see ADR `0002-data-ingestion-and-scraping-strategy.md`):

- **Tier 1 — Platform-Curated Sources (Server-Side, Automated):**
  - The platform maintains a vetted set of aggregator sites (e.g., FreeJobAlert, SarkariResult) with custom scraper adapters per site.
  - These run on a daily cron schedule and are shared across all users at zero per-user cost.
  - Targets and run-state are stored in the `scraper_sources` DB table. A `sources.json` seed file populates this on first boot.

- **Tier 2 — Community-Requested Sources:**
  - Users can vote on or request new sites. A developer reviews, writes one adapter, and it becomes available to all users.
  - Prevents user-controlled server-side scraping while still expanding coverage organically.

- **Tier 3 — User's Own Sites (Client-Side Only — Web Clipper):**
  - For any site not in Tiers 1/2 (LinkedIn, Naukri, AngelList, niche boards), the Browser Extension allows manual one-click clipping from any page.
  - Zero server involvement: no IP ban risk, no infrastructure cost, no legal liability.

- **The "Backlog / Triage" Pipeline Stage:**
  - All automated pulls (Tier 1/2) and manual clips (Tier 3) initially land in a dedicated "Backlog" or "Needs Review" queue before entering the main tracker.

- **AI-Assisted Duplicate Resolution:**
  - Scraping multiple aggregators will inevitably cause duplicates. The system includes an "AI Duplicate Check" action that scans the Backlog and groups potential duplicates for manual user review (Merge/Delete).

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
  - A low-friction alert system (e.g., Daily Email Digest or Browser Extension push notification) that proactively pings the user when an application deadline is 24 hours away or a Spaced Repetition revision is due, ensuring nothing is missed even if the dashboard is closed.

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
  - To protect the user from their own enthusiasm and prevent LinkedIn bans, the extension enforces a hard local rate limit (e.g., Maximum of 10 referral checks per 24-hour rolling window).

---

## 2. Non-Functional Requirements (NFRs)
- **Data Security & Privacy:** The application ingests highly sensitive Personal Identifiable Information (PII) including exact DOB, caste/category, current salary (CTC), and full resumes. The database must utilize encryption at rest. Furthermore, LinkedIn session tokens are NEVER transmitted to the backend; all networking queries remain strictly on the client side via the extension.
- **Desktop-First Form Factor:** Given the complexity of high-density data tables, dual-sector views, syllabus trees, and the mandatory browser extension, Phase 1 & 2 of this MVP are explicitly constrained to a **Desktop-First** experience. Mobile responsiveness is de-prioritized to prevent development bloat.

---

## 3. Edge Cases & Scope Refinements
- **Data Freshness and Corrigendums:** Government jobs frequently issue "corrigendums" extending deadlines. The system must support updating existing job entities.
- **Geographic & Domicile Constraints:** Validated as a hard filter using manual intake data.
- **Quota & Category Processing:** Public sector eligibility relies heavily on reservation categories to calculate age relaxations and specific cut-offs.

---

## 4. High-Priority User Stories & Acceptance Criteria

### Feature 1: The Triage Backlog & AI Duplicate Check
**User Story:** As a job seeker, I want automated scraped jobs and my manually clipped jobs to go into a review queue first, so I can merge duplicates and verify the data before it clutters my main tracker.

### Feature 2: Interview Post-Mortem & Adaptive Learning
**User Story:** As a candidate who just failed an interview, I want to log the reason for my rejection so the learning engine can immediately adapt my syllabus to fix my weak points before my next interview.

**Acceptance Criteria:**
- Moving a job to `REJECTED` triggers a mandatory or optional "Post-Mortem" input field.
- Extracted keywords from the post-mortem (e.g., "Dynamic Programming") automatically highlight or inject new nodes into the user's LMS roadmap.

### Feature 3: Browser Extension (Job Clipping & Safe Referrals)
**User Story:** As a job seeker, I want an extension that acts as a manual job clipper while browsing, and acts as a secure bridge to LinkedIn only when I explicitly request a referral search, strictly bound by rate limits to ensure zero risk to my account.

---

## 5. Data Contract (Core Entities & Schema)

### Entity: `UserProfile`
- `user_id` (UUID), `manual_demographics` (Object), `manual_professional_data` (Object), `resume_corpus_text` (String)

### Entity: `JobPosting`
- `job_id` (UUID), `source_url_or_ref` (String), `sector_type` (Enum)
- `organization`, `title`, `work_model`, `dates` (Object)
- `vacancies` (Integer), `preparedness_score` (Float)
- `eligibility_criteria` (Object), `extracted_skills` (List of Strings)

### Entity: `ApplicationTracker` (Mapping Table)
- `application_id`, `user_id`, `job_id`
- `eligibility_status`, `ineligibility_reason`, `fit_score`
- `lifecycle_stage` (Enum): `BACKLOG`, `DISCOVERED`, `APPLIED`, `ASSESSMENT`, `INTERVIEW`, `OFFER`, `REJECTED`
- `post_mortem_notes` (Text): Logged failure reasons.
- `next_action_due` (DateTime)
- `network_matches` (List of Objects)

### Entity: `UserLearningRoadmap`
- `roadmap_id` (UUID), `user_id` (UUID)
- `current_focus_skills` (List of Strings)
- `customized_nodes` (List of Objects)
- `progress_tracking` (Map<String, Object>)

---

## 6. Proposed Phased Rollout (MVP Strategy)
- **Phase 1 (The Core Tracker MVP):** Epics 2, 4, & 7. Focus on the Summary Dashboard, Sector Tabs, manual onboarding, hybrid eligibility engine, and Desktop-First NFRs.
- **Phase 2 (The Discovery Pipeline & Backlog):** Epics 1, 3, & 8. Introduce automated aggregator scraping, the Web Clipper extension (with rate limits), the Backlog triage stage, and foundation-based upskilling with Post-Mortems.
- **Phase 3 (The LMS Ecosystem & Preparedness):** Epics 5 & 6. Integrate the native starter templates, Spaced Repetition tracking system, and Preparedness Scores.
