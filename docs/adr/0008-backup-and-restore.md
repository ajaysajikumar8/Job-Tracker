# 8. Backup and Restore: Encrypted Portable Archive

Date: 2026-11-02

## Status

Accepted (2026-11-02). The open questions are answered at the end, using ADR 0009 for where the recovery key lives.

Amended 2026-11-04: the restore flow now validates after migrating and swaps the database during bootstrap instead of inside the running app; restore runs as a worker task; the manifest is authenticated; files are database rows (ADR 0004 amendment).

## Context

The app is local-first and single-user (ADR 0002). There is no account and no hosted copy, so a lost disk or a broken upgrade means total data loss. A backup is the only safety net.

Current state of the docs:

- ADR 0004 originally treated a backup as a file copy, with the README explaining how to back up the key and `data/`. That is a manual procedure, not a feature.
- The canvas (Settings → Data & privacy, and the first-run screen) already shows **Back up everything**, **Restore from a backup**, a **Recovery key**, and a **Restore from a backup (.zip)** button on first run. The PRD and ADRs do not describe any of it.

Problems with "just copy `data/`":

1. **Version coupling.** A raw `app.db` only opens with a compatible schema and libSQL version. A backup from an older release is a trap.
2. **Unencrypted resumes.** Originally `data/files/` sat outside database encryption, so a plain copy leaked resumes. ADR 0004's 2026-11-04 amendment moved files into the encrypted database, so this no longer applies, but the backup must not undo it.
3. **WAL consistency.** Copying `app.db` while the web app and worker are writing can produce a corrupt copy.
4. **Machine moves.** A new machine needs one portable file, not a folder and several instructions.

The data is sensitive (DOB, category, CTC, resume text), so a backup must not be weaker than the live database.

## Decision

### One backup format: an encrypted ZIP

A backup is a single `.zip` file with two entries:

| Entry | Content |
|:---|:---|
| `manifest.json` (plaintext) | `format_version`, `app_version`, `schema_version` (latest Drizzle migration), `created_at`, `embedding_model`, row counts, `kdf_salt`, `payload_sha256`. No personal data. |
| `payload.enc` (encrypted) | An archive of one JSON file per table (the `files` table exports its metadata as JSON and each BLOB as a binary entry named by file id), encrypted with AES-256-GCM. |

- **Logical export, not a database copy.** Tables are exported as JSON, validated against the same Zod schemas the app uses. This decouples the backup from the SQLite file format and makes version upgrades a migration problem, which Drizzle already owns (ADR 0004).
- **Encryption key:** the existing **recovery key** (the one that opens the database, supplied as the `RECOVERY_KEY` environment variable, see ADR 0009). A per-backup encryption key is derived from it with HKDF and the random salt in the manifest. One secret to protect, and restoring on a new machine needs only the key the user must already keep.
- **The manifest is authenticated.** Its exact bytes are passed to AES-GCM as additional authenticated data, so changing `schema_version`, `app_version` or the row counts makes decryption fail. Those fields drive migration decisions, so they must not be editable without detection.
- **Implementation:** Node's built-in `node:crypto`, so no new crypto dependency. The ZIP reader/writer is a streaming library, chosen at implementation time.

### What is included and excluded

| Included | Excluded |
|:---|:---|
| Profile, jobs and their edit history, applications and stage history, notes, reminder dismissals, roadmaps and progress (when they exist), settings that are not secrets, `scraper_sources` | **Secrets:** a BYOK API key saved in Settings (a key from the environment is never in the database), extension pairing token, passcode hash |
| The `files` table (resumes, notification PDFs) | **Derived data:** embeddings (re-queued after restore), the `tasks` queue |
| Custom lookup rows the user added (ADR 0010). Seeded lookup rows are rebuilt from the seed files at start-up, so they are not exported | Seeded lookup rows |

Secrets are excluded by **column-level redaction** in the table registry (a table can export with named columns or keyed rows dropped), because the `settings` table holds both exportable values and secrets.

Secrets are excluded so a backup file that leaks, or is restored on another machine, does not silently carry credentials. After a restore the user re-enters the API key (if it was saved in Settings rather than the environment), re-pairs the extension, and sets a passcode if wanted. These are the same choices the first-run screen already asks for.

### Export flow

1. A Server Action enqueues a `backup_export` task. Export is a long-running job, so it runs in the worker (ADR 0003), never in a request.
2. The worker writes the archive to `data/backups/`, reading tables inside one read transaction so the snapshot is consistent.
3. The UI shows progress. When the task completes, a Route Handler streams the file as a download.
4. Settings shows the **last backup date**. If there has never been a backup, or the last one is over 30 days old, the dashboard shows an in-app reminder (the Phase 1 reminder mechanism in the PRD).

### Restore flow

Restore uses the same code path on first run (empty install) and from Settings (replacing existing data).

Like export, the heavy work runs in the worker (ADR 0003): after the upload, a Server Action enqueues one `backup_restore` task, and steps 2–7 are that task. Only one can be queued or running at a time. The task never retries, and stale-task recovery marks it failed instead of re-queuing it (see step 3). The UI polls the task for progress.

1. **Upload:** streamed to `data/restore/` with a size cap, never held in memory.
2. **Read the manifest** and reject unknown `format_version` or a `schema_version` newer than the running app ("made by a newer version, update the app first").
3. **Ask for the recovery key that encrypted the backup.** Decrypt in two passes, with the manifest as AAD. The first pass streams the ciphertext through AES-GCM and discards the output, only to verify the tag. The second pass decrypts again straight into the archive reader, so no plaintext file is ever written to `data/restore/`. Nothing is parsed until the tag has verified: a wrong key or a tampered file fails in the first pass and nothing is touched. This key is entered by the user and may differ from the running `RECOVERY_KEY` (for example after a key rotation, ADR 0009). It is used only to decrypt. It travels in the task payload (a row in the encrypted database, excluded from backups) and is overwritten as soon as the second pass has ended, whether it succeeded or failed. Steps 4 and 5 consume that pass's output as it streams, so the key is gone before step 6 begins. It is never logged, never put in `last_error`, and never kept after that point.
4. **Check the archive:** verify `payload_sha256`, accept only the file names the table registry expects (no paths, so no zip-slip), and cap total uncompressed size (zip bomb).
5. **Build a staging database at the backup's schema version.** Create `data/restore/staged.db`, encrypted with the running `RECOVERY_KEY`. Apply migrations up to the manifest's `schema_version` (`migrateTo`, ADR 0004 amendment), and insert the rows in one transaction. Unknown tables or columns are rejected, and SQLite's own constraints apply. Then apply the remaining migrations to reach the current version, which is where any change to a column's shape (including JSON columns) is handled. Finally, validate every row against the **current** Zod schemas. Validating before migrating would reject every older backup.
6. **Back up first:** if there is existing data, write `data/backups/pre-restore-<timestamp>.zip` using the export code. This matches the canvas copy: "Your current data is backed up first."
7. **Stage and restart:** write `data/restore/pending.json`, mark the task done (so stale-task recovery does not report it as failed if the swap later fails), then the worker exits with code 75 to ask the launcher to restart. The launcher is the one script behind `pnpm dev`, `pnpm start` and the Docker entrypoint: when either process exits with code 75 it stops the other and runs bootstrap again. If the app was started some other way, the UI says "restore staged, restart the app to finish". The running database is untouched until then.
8. **Swap in bootstrap, before any connection opens.** Bootstrap sees `pending.json`, checks that the staged file opens with the running key, deletes any stale `app.db-wal` and `app.db-shm`, and renames the staged file over `app.db` (same filesystem, so atomic). Then migrations and seeding run as usual (ADR 0010). If anything fails, the old `app.db` stays, `pending.json` is renamed to `failed-<timestamp>.json` so it is not retried on every start, and the failure is shown as a banner. Bootstrap also deletes leftover uploads and staged files in `data/restore/` that no `pending.json` refers to. This is why the swap is not done inside the running app: both the web process and the worker hold the file open, and renaming over a live file leaves them on the old inode.
9. **Re-queue embeddings** for every job. With AI off this is a no-op.

### Not offered in the public demo

Export and restore are disabled in the read-only demo (ADR 0002).

### Copy rules for the UI

- Call it an "encrypted backup" in the UI. The current canvas text "a ZIP (JSON + PDFs)" should be updated to match.
- State plainly that **the recovery key is not inside the backup** and that a backup without the key cannot be opened.

## Alternatives Considered

| Option | Why not |
|:---|:---|
| Copy `app.db` (the original ADR 0004 text) | Version-coupled, and risk of copying mid-write. Stays documented as a manual route for advanced users, with the key. |
| Plain ZIP of JSON + PDFs (as the canvas wording suggests) | Readable by anyone who finds the file. A backup must not be weaker than the live database. |
| `VACUUM INTO` / libSQL encrypted copy | Still tied to the engine and schema version, and cannot be re-encrypted under a different key or validated row by row. |
| Separate backup passphrase | A second secret to lose. The recovery key is already mandatory. |
| ZIP-level AES encryption (WinZip AES) | Library support is uneven, and file names stay visible. Encrypting one payload keeps the format under our control. |
| Cloud or scheduled remote backup | Conflicts with "personal data never leaves the machine" (PRD). Could be an opt-in later, as its own ADR. |

## Consequences

- **Positive:** One file moves a user to a new machine or recovers from a bad upgrade.
- **Positive:** Backups are no weaker than the live database, and tampering is detected.
- **Positive:** Versioned, logical format. Old backups keep working through migrations.
- **Negative:** A bug-free migration path is now a requirement. Every schema change needs a test that restores a fixture backup from an earlier `schema_version`.
- **Negative:** Rotating the recovery key makes old backups readable only with the old key. Rotation is done by backup then restore (ADR 0009), so the UI must warn before a rotation, and the first-run flow must make the user confirm the key is saved.
- **Negative:** Excluding secrets means a small amount of re-setup after a restore. That is deliberate.
- **Negative:** Exporting and restoring are tied to the worker, so they need the worker running. The same limit as every other background task.
- **Negative:** During a restore the old backup's key briefly sits in a `tasks` row (Resolved Question 4). It is overwritten right after decryption.
- **Negative:** Finishing a restore needs a process restart, which depends on the launcher (or a manual restart). That is the price of never swapping a database file under a live connection.
- **Scalability:** Single user means small data, so streaming each table is enough. Uploaded files dominate size, which is why upload is size-capped (10 MB) and streamed.
- **Security:** Restore accepts a user-supplied file and replaces all data, so it is the highest-risk input path in the app. It requires the passcode (when set) and runs the validation in the order above before any write. The servers bind to localhost and reject unknown `Host` headers (ADR 0003), so a web page cannot reach these endpoints through DNS rebinding. If the user opts into LAN access, the passcode is mandatory, since anyone on the network could otherwise download or restore backups.

## Resolved Questions

1. **Where does the app keep the recovery key at runtime?** In the `RECOVERY_KEY` environment variable, supplied through `.env.local` or the Docker environment, outside `data/`. The app never writes env files. A `pnpm keygen` script generates the key. **Reveal recovery key** in Settings reads the variable. First-run does not create the key; it asks the user to confirm they saved it. Details: ADR 0009.
2. **Same key for backups and the database?** Yes. The backup file is what leaves the machine, and the key stays in the env file, so a leaked backup is unreadable. Backups kept in `data/backups/` are no more exposed than the live database, which sits next to the same key. This is documented as a limit. Details: ADR 0009.
3. **Backup retention for `pre-restore-*` files.** Keep the latest 3 and say so in the UI. Older ones are deleted after a successful restore. This is a default and can be changed later without a new ADR.
4. **Where does restore run? (2026-11-04)** In the worker, as a `backup_restore` task, like export. The alternative was a Route Handler that keeps the typed key in memory only. The worker wins on consistency, a responsive UI and surviving a closed tab. The cost is that the backup's key sits in the task payload until decryption finishes. That is acceptable: the row is inside the encrypted database, tasks are excluded from backups, and the key only protects a backup file the user already holds, so anyone who could read it from `app.db` already has the data. Rules that keep the exposure short: overwrite the payload right after decryption (success or failure), no retries, stale recovery fails the task, and a test asserts the key is absent from `tasks` afterwards. Freed space may still hold the old bytes inside the encrypted file until pages are reused; that is covered by the same encryption.
