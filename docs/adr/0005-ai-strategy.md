# 5. AI Strategy: Optional, Local-First, Provider-Agnostic

Date: 2026-10-30

## Status

Accepted. Replaces the original ADR 0007 (`local | cloud | hybrid` AIClient with an OpenAI fallback) from commit `3de4acf`.

Amended (November 2026): the "Configuration: environment defaults, database overrides" section was added, and the entry for a chain provider that is not configured was clarified (below).

Amended (2026-11-09): embeddings may run on BYOK, and the pinned unit is the model and vector size, not the provider (amendment at the end; the sections it affects were updated in place).

## Context

AI speeds up several tasks but is not required for any of them:

| Task | Phase | Without AI |
|:---|:---|:---|
| Resume text → structured skills | 1 | Manual skill entry (already required by Epic 7) |
| Semantic fit score (private jobs) | 1 | No score shown |
| Skill extraction from job descriptions | 1–2 | Manual tags |
| Duplicate detection in the Backlog | 2 | Exact/fuzzy title + organisation match |
| Post-mortem keyword extraction | 2 | Manual tags |
| Government PDF table parsing | 2–3 | Rule-based parsing, then manual correction |

Government eligibility (age, category, degree, domicile) is **rule-based and never uses an LLM**.

ADR 0002 rules out paying for inference on anyone's behalf and requires personal data to stay local by default.

## Decision

### Three provider modes, set by the user

| Mode | Meaning |
|:---|:---|
| `none` | AI features hidden. The app is fully usable. **Default** until a provider is configured. |
| `ollama` | Local Ollama server, installed by the user. Free and private. |
| `byok` | The user's own key for any OpenAI-compatible endpoint (OpenAI, Groq, OpenRouter, Gemini, Anthropic compatibility endpoints). |

Ollama is not bundled. The README documents installing it and pulling the models.

### Configuration: environment defaults, database overrides

- **Defaults come from the environment** (`.env.local`, or the Docker env): `AI_MODE`, `OLLAMA_BASE_URL`, `EMBEDDING_MODEL`, `EXTRACTION_MODEL`, `BYOK_BASE_URL`, `BYOK_API_KEY`, `BYOK_MODEL`. All are optional. With none set, the mode is `none`. They are validated by the shared `env.ts` (Zod).
- **Settings → AI can override any field.** Overrides are stored in the database. A single resolver (`getAiConfig()`, used by the worker, where all AI runs) returns the database override if there is one, otherwise the environment value, otherwise the built-in default.
- **Each field shows its source** ("from environment" or "overridden") and has **Reset to default**, which deletes the override.
- **Secrets are never returned to the browser**, whether they came from the environment or from an override. The UI shows only "set" or "not set".
- **Consent is not configurable by env.** "Allow cloud processing of personal data" lives only in Settings and defaults to off, so a Docker config cannot silently send personal data to a provider.
- **Backups:** an API key saved as an override is a secret in the database and is excluded from backups (ADR 0008). A key supplied by the environment is not in the database at all, so there is nothing to export and nothing to re-enter after a restore.
- **Changing the embedding model** is allowed in both places. It is a guarded action and never re-embeds silently (see "Embeddings are pinned").
- **Docker:** inside a container `localhost` is the container itself, so `OLLAMA_BASE_URL` must point at the host (for example `http://host.docker.internal:11434/v1`). The README says so.
- **Mode and chains:** `AI_MODE` is the master switch. In `none` no chain runs. In `ollama` or `byok`, a chain entry whose provider is not configured (no URL, or no key) is skipped rather than treated as a failure.

### One client, OpenAI-compatible

- A single `AIClient` built on the `openai` npm SDK. Switching provider changes only `baseURL`, key and model name.
- Rejected: **LangChain** (the calls are single structured requests, not chains or agents). **Vercel AI SDK** would also work, and is worth reconsidering only if a non-OpenAI-compatible provider is ever needed.

### Per-task routing with fallback chains

Each task declares an ordered chain of providers and a `containsPii` flag:

```ts
fitScoring:      { chain: ["byok", "ollama"], containsPii: true }
skillExtraction: { chain: ["ollama", "byok"], containsPii: false }
embedJob:        { chain: ["ollama", "byok"], pinned: true, containsPii: false }
embedProfile:    { chain: ["ollama", "byok"], pinned: true, containsPii: true }
```

Fallback rules:
- **Retry, then fall back** on timeouts, 5xx and 429.
- **Fall back and surface a warning** on 401/403, since a bad key is a configuration bug.
- **Do not fall back** on 400, because the next provider would fail the same way.
- **Model not found** (404, or a "model not found" error): permanent for that provider and model, so it is not retried. Generative tasks move to the next provider in the chain. Embeddings never move to a different model (see "Embeddings are pinned").
- **Invalid structured output:** retry once, then try the next provider in the chain.
- A simple circuit breaker skips a provider after repeated failures, so a dead provider doesn't add a timeout to every task.
- **PII guard:** a task with `containsPii: true` never goes to a `byok` provider unless the user has explicitly allowed cloud processing of personal data in settings.

### Structured output is always validated

Every extraction prompt has a Zod schema. Model output is parsed with it, and invalid output is treated as a failure. Small local models produce malformed JSON often enough that this is required.

### Embeddings are pinned

- **The pinned identity is the model id plus the vector size.** It is stored in settings (`embedding_model`, `embedding_dimensions`) when the first vector is written, and every vector row also stores `embedding_model`. The default is `nomic-embed-text` at 768. Vectors from different models are **never** compared, and embeddings **never** fall back to a different model.
- **Any provider that serves the pinned model at the pinned size may be used**, in the order `ollama`, `byok`. Switching between `none`, `ollama` and `byok` in any direction is free while the model is unchanged: stored vectors stay valid and nothing is re-embedded. With `none`, no embedding task is queued and existing vectors are left unused.
- **PII:** a profile embedding is built from resume text, so `embedProfile` is `containsPii: true` and reaches a BYOK provider only if cloud processing is allowed. A job embedding is built from a job description and is treated like skill extraction (`containsPii: false`).
- **The vector size is fixed by the schema.** The column is `F32_BLOB(768)` (ADR 0004). Settings offers only models that return exactly that size, natively or through the provider's output-size parameter. The connection test checks it, and every response length is checked again: a wrong-length vector fails the task and is never written. Moving to a different size is a maintainer release, not a setting: a new Drizzle migration for the column plus a forced full re-embed. Vectors are derived data (ADR 0008), so nothing is lost.
- **Changing the model is a guarded action.** Settings shows the number of rows affected and, on BYOK, a warning that the re-embed makes one API call per row. After the user confirms, a full re-embed is queued. Until it finishes, similarity features skip rows whose `embedding_model` differs from the active model.
- **Re-embeds that can cost money are never silent.** If the configured model differs from the pinned one at start-up (for example after an env change), the app shows a banner and offers the re-embed. After a restore (ADR 0008), vectors are rebuilt automatically on Ollama, and on BYOK the app asks first. A new default model shipped in a release therefore applies to new installs only, and existing installs keep their pin until the user re-embeds.
- **Provider down** (timeout, 5xx, 429): the task stays queued and retries later.
- **Model unavailable** (the provider no longer serves the pinned model: removed from Ollama, or retired by a cloud provider): this is permanent and not retried. Embedding tasks pause and a banner says so. Existing vectors stay valid, and Settings shows coverage ("N of M jobs have embeddings"). Similarity features skip rows without a vector, and duplicate detection falls back to title and organisation matching. The fix is to choose another model and run the guarded re-embed. A provider that cannot serve embeddings at all (for example an Anthropic key, since Anthropic offers no embedding model) is reported the same way by the connection test.

### Provenance on every AI output

Every AI-generated value stores `provider`, `model` and `prompt_version`. The UI can show "scored by local model", and stale results can be re-run after a prompt or model change.

### Where AI runs

All AI calls run in the **worker** (ADR 0003), never inside a web request. The demo makes **no AI calls**: a seed/export script runs the pipeline locally over sample data and writes the results into the demo database (ADR 0002).

### Default local models (configurable)

| Model | Use |
|:---|:---|
| `nomic-embed-text` | Embeddings |
| `llama3.2:3b` (or another small instruct model) | Structured extraction |

## Consequences

- **Positive:** Zero AI cost to the author. Personal data stays local unless the user opts in.
- **Positive:** Every feature degrades gracefully to manual entry, so AI never blocks core use.
- **Positive:** Provenance and pinned embeddings keep scores comparable and debuggable.
- **Negative:** Local models on CPU are slow (3–8 s per call) and lower quality for nuanced fit scoring. This is acceptable because the calls run in the background.
- **Negative:** Ollama needs roughly 2.5 GB of extra RAM, which is the user's cost to choose.

## Amendment (2026-11-09): embeddings may use BYOK; the model is pinned, the provider is not

The sections above were updated in place (routing, fallback rules, "Embeddings are pinned"). This section records why.

**Problem.** The original decision set `embeddings: { chain: ["ollama"], pinned: true }`, which tied two rules together. What must stay fixed is the embedding **model** and its vector size, because vectors from different models cannot be compared. The provider that serves it does not matter. An Ollama-only chain left a user with a BYOK key and no Ollama without similarity features, and the ADR gave no privacy reason for it.

**What changed**
- The chain is `ollama`, `byok`, and the pinned unit is model id plus vector size, not the provider.
- The single `embeddings` task is split into `embedJob` (no PII, like skill extraction) and `embedProfile` (resume text, PII), so the consent switch applies to the profile embedding only.
- Changing the model, a start-up mismatch and a restore never start a paid re-embed silently.
- Model-not-found is a permanent failure with a defined degraded state (coverage shown, duplicate detection falls back to fuzzy matching).
- ADR 0004 (vector size) and ADR 0008 (restore step 9) were aligned.

### Alternatives considered

| Option | Why not |
|:---|:---|
| Lock the user to one provider mode (Ollama or BYOK) | The mode governs every AI task, not only embeddings. What decides vector compatibility is the model. Locking also strands a user who uninstalls Ollama or whose cloud model is retired. |
| Runtime-configurable vector size | Bootstrap applies only pre-generated migrations (ADR 0004), so Settings cannot change the column. A different size is a release change. |
| Keep embeddings Ollama-only | BYOK-only users lose similarity features for no technical reason. |
| Lock the embedding model for good, with no change path | Cloud embedding models are retired from time to time. A guarded re-embed is the safer exit. |

### Consequences

- **Positive:** a user whose BYOK provider has a suitable embedding model gets similarity features without Ollama.
- **Positive:** provider and mode can change without touching stored vectors.
- **Negative:** with BYOK, resume text leaves the machine for embeddings. The consent switch gates it, and the README must say so.
- **Negative:** Settings offers only models that return 768 values. A model of another size needs a release.
- **Negative:** a model change or restore on BYOK costs one API call per row.
- **Open question:** the same model name on two different hosts is assumed to give equivalent vectors. Quantisation or normalisation differences could break that. If it matters, a provider change with the same model name would also need a re-embed.
- **Open question:** which cloud embedding models return 768 values, and whether their endpoint is OpenAI-compatible, has not been verified. Check before documenting any as supported. (Voyage AI, the provider Anthropic points to, lists 256, 512, 1024 and 2048 and no 768.)
- **Open question:** how `fit_score` is computed (embedding similarity, a generative model's judgement, or both) is not specified. It decides whether a BYOK user without embeddings still gets a score. Settle it before M9.
- **Follow-ups:** `docs/PHASE-1-PLAN.md` M9 (done alongside this amendment) carries the tests for the length check, the mismatch banner and the model-unavailable state.
