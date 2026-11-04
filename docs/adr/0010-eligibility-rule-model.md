# 10. Eligibility Rule Model: Limits Stored per Job, Lookup Data in the Database, Pure Engine

Date: 2026-11-03

## Status

Accepted (2026-11-03).

## Context

PRD Epic 2 needs a hard-filter check for government jobs: age, degree, category and domicile, using the user's manually entered profile. ADR 0005 already rules out an LLM here.

Facts that shape the design:

- **The notification is the source of truth.** Each job states its own age limits, cutoff date and accepted qualifications. Posts from the same organisation can differ.
- **The age limit depends on the candidate.** A notification gives a limit for General candidates and different limits for other categories or statuses.
- **The candidate does not change.** Category and status flags are fixed. They are entered once in the profile.
- **Wording varies.** "Not above 30", "below 30" and "30 years" mean different cutoffs.
- **A wrong answer has a cost.** A false "eligible" wastes an application fee. A false "ineligible" hides a real opportunity.

## Decision

### Three parts

```
 lookup tables (database)        per-job criteria (JSON on the job)       engine (pure TypeScript)
 ────────────────────────        ──────────────────────────────────       ────────────────────────
 categories, regions,            what THIS notification says:             evaluate(profile, criteria)
 qualification levels,           age limits, cutoff date,                    → EligibilityResult
 disciplines                     accepted degrees, domicile
```

1. **Lookup tables** hold the lists the forms and the engine need. They are seeded from files shipped with the app.
2. **Each job stores its own criteria**, copied from its notification by the user. This includes the age limits for each category. There are no relaxation templates or shared rule sets.
3. **The engine is a pure TypeScript function.** It imports nothing from Next.js or Drizzle. A thin loader reads the database and passes plain objects in.

### Lookup tables

| Table | Purpose | Key columns |
|:---|:---|:---|
| `ref_categories` | Reservation categories and special statuses | `key`, `label`, `kind` (`reservation` / `special`) |
| `ref_regions` | States and union territories, for domicile | `key`, `name`, `kind` |
| `ref_qualification_levels` | Ordered ladder | `key`, `rank`, `label` (10th, 12th, diploma, bachelor, master, doctorate) |
| `ref_disciplines` | Tree of fields of study | `key`, `name`, `parent_key` |

**Identity is one text `key` per row, the primary key of all four tables.** Seeded rows use a readable, permanent key from the seed file (for example `cat:obc`, `disc:cs`). Custom rows use `custom:<uuid>`. Seed files may not use the `custom:` prefix (a CI check), so a custom row can never collide with a seeded row added by a later release. Everything that points at a lookup row (profile, per-job criteria, applications) stores this key, never an auto-increment id, so references mean the same thing on every installation and in every backup. No foreign key points at a `ref_*` table; a row is never deleted, only deprecated, so a stored key always resolves, and restore does not depend on table order. One exception: a backup from a newer release restored onto an older one may hold a seeded key the older seed files lack. The UI shows such a key as "unknown" and the check gives `needs_info`; the next update resolves it.

Each row also has `deprecated` and `is_custom`. Users can add their own rows for a state, category or discipline the list lacks. Seeded rows are read-only in the UI. Backups include only the custom rows (ADR 0008); seeded rows are rebuilt from the seed files at start-up.

#### Seeding rules

Seeding runs on every start (see "Bootstrap") and is idempotent. For each seed row:

| Database state | Action |
|:---|:---|
| No row with this `key` | Insert it. |
| Row exists, and its values differ from the seed row | Update that same row in place. Updating (not deleting and re-adding) keeps every reference to it valid. |
| Row exists, values identical | Nothing. |
| Row is no longer in the seed files | Set `deprecated = 1`. Never delete, because jobs and profiles may refer to it. |
| A deprecated row reappears in the seed files | Clear `deprecated`. |

Custom rows (`is_custom = 1`) are never touched. Seeding runs in one transaction, and the primary key makes concurrent runs safe. The seeder reads the existing seeded rows once, compares them with the seed files in memory, and writes only the rows that changed. Tree parents are referenced by `parent_key`, which is stored as is (no id lookup). Seed files are validated with Zod at load. A CI test checks required fields, unique keys, no `custom:` prefix, and that every parent key exists.

**When seeding inserts or changes a lookup row**, it enqueues one `recompute_eligibility` task in the same transaction as the seed writes (the worker does not exist yet while bootstrap runs, and the task survives until it does). The worker recomputes all open applications and records each application's previous status. If any status changed, the user gets a reminder listing each application with its old status, new status and the reason. The change is applied automatically but never silently.

#### Bootstrap

Updating the app brings new seed files with the new code, and the next start picks them up. A single `bootstrap` step runs before the web app and the worker start: validate the environment (ADR 0009), apply a staged restore if one is pending (ADR 0008), copy the database and apply pending migrations (amendment in ADR 0004), then run the seeding above. It is wired into `pnpm dev`, `pnpm start` and the Docker entrypoint, runs again after a restore (ADR 0008), and is also available as `pnpm bootstrap` and `pnpm seed`. In `DEMO_MODE` it makes no writes.

A failed migration stops the app. A failed seeding step does not: the existing data is still valid, so the app starts and shows a "rule update check failed" banner.

### Profile inputs the engine reads

`dob` (plain `YYYY-MM-DD`), `category` (one `ref_categories` key), `flags` (set of special-status keys, for example `special:pwbd`, `special:ex_serviceman`), `domicile_region` (a `ref_regions` key), and `qualifications[]` (`level` and `discipline` as lookup keys, `status` = `completed` / `pursuing`, `completed_on`). Nationality is not an input: no check uses it, and a notification that requires it goes in `manual_checks`.

### Per-job criteria (JSON, `schema_version: 1`)

```ts
type EligibilityCriteria = {
  schema_version: 1;
  age?: {
    min?: number;                      // completed years, inclusive
    max: number;                       // limit for General candidates, completed years, inclusive
    limits?: AgeLimit[];               // other rows from the notification
    as_on: string;                     // YYYY-MM-DD cutoff date
    as_on_basis?: "last_date" | "jan_1" | "custom";   // how the date was chosen, used only to prompt on changes
  };
  qualifications?: {                   // acceptable alternatives (any one satisfies)
    options: {
      min_level: string;               // ref_qualification_levels.key
      disciplines?: string[];          // ref_disciplines keys; omitted = any discipline
      must_be_completed_by?: string;   // YYYY-MM-DD
      allow_final_year?: boolean;      // true only if the notification says so; default false
    }[];
  };
  domicile?: { allowed_regions: string[] };   // ref_regions keys
  allowed_categories?: string[];       // ref_categories keys; posts open only to some categories; omitted = open to all
  manual_checks?: string[];            // things the engine cannot judge (height, experience, gender)
};

type AgeLimit = {
  category?: string;                   // ref_categories key; matches the profile category
  flags?: string[];                    // ref_categories keys; all of these must be in the profile flags
  max: number;                         // the final limit for this row, completed years, inclusive
};
```

**How the age limit is chosen**
1. A row matches the profile when its `category` (if set) equals the profile category and every code in its `flags` (if set) is in the profile flags. A row with neither field matches everyone.
2. The effective maximum is the **highest** `max` among `age.max` and all matching rows. There is no adding, no stacking and no cap logic.
3. The user types the final number for each row, as the notification prints it or as they work it out (30 + 3 = 33).
4. The engine never guesses limits that the job does not list.

**Edge cases and the guards for them**
- **Combined rows.** A candidate with a category and a flag (for example OBC and a disability) matches both rows. The highest wins. If the notification has a combined limit and the user did not enter it, the result can be too low. So when a candidate **fails** the age check and more than one row matched, the result carries a warning: "several limits matched you; check whether the notification gives a combined one".
- **Missing own-category row.** The job form always shows a line for the profile's own category and flags and asks whether the notification gives them a different limit, so a forgotten row is visible. Leaving it empty means no relaxation.
- **Wording is normalised at entry.** The form offers "not above N", "below N" and "N years" for the block and stores inclusive numbers, so "below 30" becomes `29`. The original wording stays in a free-text note on the job.
- **Cutoff date presets.** "Last date of application" (copied from the job's deadline), "1 January of the year" and a custom date. The form stores a plain date and the basis. If a corrigendum moves the deadline on a job whose basis is `last_date`, the form asks whether to move `as_on` too. It never changes it silently.

### Age calculation

- Age is the number of **completed years on `as_on`**, computed from plain date components (`date-fns` on date-only values), never from timestamps or the machine's timezone.
- A candidate born on 29 February is treated as having the birthday on 1 March in non-leap years. The result carries a warning, because notifications do not agree.
- Age depends on `as_on` and the DOB, not on today's date, so a verdict does not go stale as time passes. A passed deadline is a separate "closed" state.

### Qualification matching

A profile qualification satisfies an option when its level rank is `>=` `min_level` and its discipline equals or is a descendant of one of the option's disciplines (if any are listed). Then, by status:

| Qualification status | Result |
|:---|:---|
| `completed`, and `must_be_completed_by` is unset or `completed_on` is on or before it | `pass` |
| `completed`, but `completed_on` is after `must_be_completed_by` | `fail` |
| `pursuing`, option has `allow_final_year: true` | `pass` with a warning "final-year candidate; confirm the notification's terms" |
| `pursuing`, option does not allow it | `needs_info`: degree not yet completed, and the notification does not say final-year candidates may apply |

### Engine output

```ts
type CheckStatus = "pass" | "fail" | "needs_info" | "not_applicable";

type EligibilityResult = {
  status: "eligible" | "ineligible" | "needs_info" | "not_evaluated";
  checks: {
    check: "age" | "qualification" | "domicile" | "category";
    status: CheckStatus;
    code: string;                      // stable machine code, e.g. "AGE_ABOVE_MAX"
    message: string;                   // human-readable reason
    detail?: Record<string, unknown>;  // e.g. { age: 31, effective_max: 33, matched_rows: 2 }
  }[];
  manual_checks: string[];
  warnings: string[];
  engine_version: number;
};
```

Aggregation: any `fail` gives `ineligible` (listing every failing reason). Otherwise any `needs_info` gives `needs_info`. Otherwise, if no check applied, `not_evaluated`. Otherwise `eligible`.

**Missing data never counts as a pass.** An empty profile field gives `needs_info` for that check. This is the main guard against a false "eligible".

### Worked examples

Example numbers only. Limits are `max` values in completed years.

| # | Profile | Job criteria | Result |
|:---|:---|:---|:---|
| 1 | Born 1994-06-15, OBC | `as_on` 2026-01-01, General 30, OBC row 33 | Age 31, limit 33: `pass` |
| 2 | Same person | General 30 only, no OBC row | Age 31 > 30: `fail`. The form asked about the OBC row, so this means the notification gives none |
| 3 | Born 1996-01-01 | `as_on` 2026-01-01, General 30 | Age 30, birthday on the cutoff: `pass` |
| 4 | Born 1995-01-01 | Same job | Age 31: `fail` |
| 5 | OBC and disability, age 42 | General 30, OBC 33, disability 40, no combined row | Highest match 40: `fail`, with the "several limits matched" warning |
| 6 | Born 2000-02-29 | `as_on` 2026-02-28, General 30 | Birthday treated as 1 March, age 25: `pass`, with a leap-day warning |
| 7 | B.Tech in progress | Option requires bachelor, no `allow_final_year` | `needs_info` |
| 8 | DOB not entered | Any job with an age block | `needs_info` |

### Storage on the application

The `applications` row stores `eligibility_status`, `ineligibility_reason` (first fail message, for table display), the full `EligibilityResult` JSON, `eligibility_evaluated_at` and `engine_version`. A user may set `eligibility_override` (`eligible` / `ineligible`) with a note. The engine result is kept alongside and the override is shown as such. Overrides are for notifications the model cannot express, and a recompute never overwrites them.

### When the verdict is recomputed

- **Job criteria saved:** inside the same Server Action transaction (cheap and pure).
- **Profile saved:** a `recompute_eligibility` task for all open applications, run by the worker.
- **Lookup rows changed by seeding:** the same task, plus the status-change report described above.
- **`ENGINE_VERSION` bumped:** the worker recomputes everything on the next start.

### UI rules

- Never present a verdict as official. Show "checked against the criteria you entered", with the reasons one click away and a link to the source notification.
- `needs_info` names the missing field and links to the profile form.

### Out of scope for Phase 1

- State-specific reservation lists (an OBC certificate valid in one state may not count in another), creamy-layer or income checks, physical standards, experience and gender rules (these go in `manual_checks`), and anything involving an LLM.
- Relaxation templates, shared rule sets, and arithmetic on relaxation years. If retyping the same limits becomes a real annoyance, add a "copy from a previous job" action first. Shared, maintained rule sets would need their own ADR.

## Alternatives Considered

| Option | Why not |
|:---|:---|
| Relaxation templates or shared rule sets, in a seeded catalog | A large amount of machinery (catalog, copies, update notices) to save retyping a few rows. It also ships numbers that could be wrong. The notification is the source of truth anyway. |
| Relaxations stored as years added to a base age, with groups, stacking and a cap | A small rules language the engine does not need. The user already reads the final numbers from the notification. |
| Rules hard-coded in TypeScript | Each new state or category needs a code release. |
| A rules DSL or library (json-logic, json-rules-engine) | Far more power than four checks need. |
| LLM reads the notification and decides | Rejected in ADR 0005. An LLM may help pre-fill criteria from pasted text (ADR 0005), but the user confirms and the engine decides. |
| Approval gate on each lookup update | Brings back pending-value columns and a larger review screen for factual lists. See Resolved Question 6. |

## Consequences

- **Positive:** The engine is deterministic and easy to test (plain objects in, result out), and every verdict has reasons and the numbers behind it.
- **Positive:** No relaxation data ships with the app, so there is no seeded number to get wrong, and a job's age limits change only when the user edits that job.
- **Positive:** Much less to build: two tables fewer, no template screens, no update review cards.
- **Negative:** The user types the age limits for each job. A few rows per job.
- **Negative:** The user can mistype or forget a row, and the engine cannot catch it. Mitigated by the own-category line on the form and the combined-row warning.
- **Negative:** Lookup rows update without approval. The safeguard is the recompute-and-report step, so the discipline and level seed files deserve the most review.
- **Negative:** The criteria JSON has a versioned shape. Changing it needs a migration of stored criteria and a backup fixture (ADR 0008).
- **Security / privacy:** The engine reads DOB and category, the most sensitive profile data. It runs locally, makes no network calls, logs reasons without the raw DOB, and the full result is stored only in the encrypted database.
- **Scalability:** Single user, hundreds of jobs. Evaluation takes microseconds per job, so a full recompute is trivial.

## Open Questions

1. **Date-bound age limits.** Many notifications state the limit as "born not earlier than X and not later than Y" instead of an age on a cutoff date. The model stores age as a number on `as_on`, which expresses the same thing only after the user converts it. Decide before M6 whether the form accepts date bounds and converts them to `as_on` + `max`, or leaves the conversion to the user. This does not change the engine, only the entry form.

## Resolved Questions

Decided 2026-11-03 unless noted.

1. **Leap-day birthday:** treated as 1 March in non-leap years, with a warning.
2. **"Pursuing" degrees:** `needs_info` unless the option sets `allow_final_year`.
3. **Relaxations:** stored per job from the notification, as final limits per category or flag. No templates or rule sets.
4. **Cutoff date:** presets for "last date of application", "1 January of the year" and a custom date, with a prompt when a corrigendum moves the deadline.
5. **Automatic migrations at start-up:** yes, recorded as an amendment in ADR 0004.
6. **Lookup data updates:** automatic, with no approval step. The safeguard is the recompute that reports any changed verdict.
