# 9. Recovery Key Storage: Environment Variable

Date: 2026-11-02

## Status

Accepted. Amends ADR 0004 (adds where the encryption key lives). Resolves open questions 1 and 2 of ADR 0008.

## Context

ADR 0004 encrypts `data/app.db` at rest and says the key must be backed up, but not where the app reads it from. ADR 0008 uses the same key, called the **recovery key**, to encrypt backups, and lists "where does the key live at runtime" as a blocker.

Every process that opens the database needs the key on every start: the web app, the worker, and (Phase 2) the Python ingest service.

## Decision

### The key is an environment variable

- Variable: `RECOVERY_KEY`.
- Format: 32 random bytes, hex-encoded (64 characters). Generated with `openssl rand -hex 32`, or by the key script below.
- Read once at startup by a single `env.ts` module (Zod-validated), shared by web, worker and later Python. It is **never** prefixed `NEXT_PUBLIC_`, never logged, never put in an error message, and never sent to the browser.
- Local development and self-hosting: **one file, `.env.local` at the repo root** (git-ignored by `.env.*` in `.gitignore`). Docker: `env_file` or `-e`, or a Docker secret mounted as the variable. The key file lives **outside `data/`** so `data/` can be copied or synced without it.
- **Loading.** Next.js only reads env files from `apps/web`, and a `tsx` worker reads none. So `env.ts` loads the root file explicitly with `loadEnvConfig` from `@next/env` (already shipped with Next.js, no new dependency). The worker, bootstrap and the launcher call it, and the launcher starts web and worker with that environment, so all of them see the same values. `next.config.ts` cannot do it: Next.js has already made (and cached) its own `loadEnvConfig` call for `apps/web`, so a second call for another directory is ignored. Starting `next dev` directly, bypassing the launcher, therefore does not see the root file. The web app only validates what it inherited (`parseEnv(process.env)`). Variables already set in the process environment (Docker) win over the file.

### The app never writes env files

The app does not create or edit `.env*` itself. That keeps the key out of any code path that a bug or a restore could reach, and matches the repo rule that env edits are a deliberate user action.

- `pnpm keygen` (a small script the user runs) generates a key and writes it to `.env.local` **only if** the variable is absent. An empty `RECOVERY_KEY=` line (what copying `.env.example` produces) counts as absent: the script fills that line in rather than appending a second one. It refuses to overwrite a non-empty key, writes the file with `0600` permissions, and prints the key once with a "save this now" warning.
- The script is not called `pnpm setup`: that is a built-in pnpm command (it configures `PNPM_HOME` and edits shell config), so a package script of that name would never run.
- Docker users generate the key themselves (`openssl rand -hex 32`) and pass it in. The README documents both.

### Startup rules (fail fast, never guess)

| State | Behaviour |
|:---|:---|
| `RECOVERY_KEY` missing or malformed | Process exits with a readable message and the generator command. It does **not** auto-generate a key. |
| Key set, no `data/app.db` | First run: create the encrypted database, then show the first-run screen. |
| Key set, `app.db` exists, key correct | Normal start. |
| Key set, `app.db` exists, key **wrong** | Exit with "RECOVERY_KEY does not match this database". It never creates a new database over an existing file. |

With `DEMO_MODE=1` there is no local database and no key: the env schema does not require or read `RECOVERY_KEY`, and the rows above do not apply.

Auto-generating on a missing key would silently create a second, empty database and hide data loss, so it is rejected.

### First-run screen

The key already exists (from `pnpm keygen` or the Docker env), so the screen does not create it. It does:
1. Show that the database is encrypted, and ask the user to confirm they have saved the key somewhere outside this machine (a password manager).
2. Offer an optional passcode.
3. Offer **Restore from a backup (.zip)**.

**Reveal recovery key** in Settings reads the variable and shows it. It is passcode-gated when a passcode is set, rate-limited, and sends `Cache-Control: no-store`.

### Same key for the database and backups (ADR 0008, question 2)

Yes, keep one key. Reasoning:
- A backup file is the thing that leaves the machine (downloaded, copied to a USB stick or cloud drive). The key stays in the env file, so a leaked backup is unreadable. This is the threat the backup encryption exists for.
- Backups left in `data/backups/` sit next to a machine that already holds the key, so they are no more exposed than the live database. That is acceptable and documented.
- A second secret (a backup passphrase) is another thing to lose.

### Rotation

There is no in-place rekey. To change the key:
1. Take a backup (encrypted with the **old** key) and download it.
2. Stop the app, set the new `RECOVERY_KEY`, and move the old `data/` aside.
3. Start the app, choose **Restore from a backup**, and enter the **old** key when asked.

This works with ADR 0008's restore flow as written, because restore asks for the key that encrypted the backup separately from the running `RECOVERY_KEY`, then writes data under the running key. The Settings screen warns before any rotation, and the README documents the steps.

### Demo

The read-only demo uses Turso with its own credentials and holds only fake data. It does not use `RECOVERY_KEY`.

## Alternatives Considered

| Option | Why not |
|:---|:---|
| Key file under `data/` | Ends up next to the database in any copy, sync or backup of `data/`, which defeats encryption at rest. |
| OS keychain | Best for desktop theft, but differs per OS, is awkward in Docker and headless setups, and adds a native dependency. Could be added later as an optional source with the env var as the fallback. |
| App generates and stores the key itself | The app would have to write secrets to disk, and a missing key would silently create a new empty database. |
| Prompt for a passphrase at every start | Blocks the worker and cron from running unattended. |

## Consequences

- **Positive:** One mechanism that works the same locally, in Docker and for the Python service. Simple to explain in the README.
- **Positive:** Wrong or missing keys fail loudly instead of creating a fresh database.
- **Negative:** The key sits in a plaintext file on the same machine. Encryption at rest therefore protects against copying `app.db` (a synced folder, a stray backup of `data/`, a leaked file), **not** against someone with access to the whole logged-in machine. Full-disk encryption is still needed for that case. The README must say so plainly.
- **Negative:** Losing the key means losing the data and every backup made with it. The first-run confirmation and the README are the only safeguards.
- **Negative:** No in-place rotation. Rotation costs a backup and a restore.
- **Security:** Env vars can leak through process listings, crash reports, debug endpoints and `docker inspect`. Mitigation: never log the environment, never expose it in a health or debug route, and prefer Docker secrets or an `env_file` with restricted file permissions (`chmod 600`).
- **Scalability:** Not a concern for a single user. If the project ever hosts for others (ADR 0002 would need to be revisited), per-tenant keys and a secrets manager replace this.
- **Spike dependency:** This ADR fixes *where* the key lives. Whether `@libsql/client` accepts a 32-byte key for local-file encryption is verified by the Phase 1 M2 spike. If the spike fails, ADR 0004 is amended, and this ADR's storage decision still stands.
