# 5. AI Strategy: Optional, Local-First, Provider-Agnostic

Date: 2026-10-30

## Status

Accepted. Replaces the original ADR 0007 (`local | cloud | hybrid` AIClient with an OpenAI fallback) from commit `3de4acf`.

Amended (November 2026): the "Configuration: environment defaults, database overrides" section was added, and the entry for a chain provider that is not configured was clarified (below).

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
- **Changing the embedding model** is allowed in both places and triggers the full re-embed described below.
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
embeddings:      { chain: ["ollama"], pinned: true }
```

Fallback rules:
- **Retry, then fall back** on timeouts, 5xx and 429.
- **Fall back and surface a warning** on 401/403, since a bad key is a configuration bug.
- **Do not fall back** on 400, because the next provider would fail the same way.
- **Invalid structured output:** retry once, then try the next provider in the chain.
- A simple circuit breaker skips a provider after repeated failures, so a dead provider doesn't add a timeout to every task.
- **PII guard:** a task with `containsPii: true` never goes to a `byok` provider unless the user has explicitly allowed cloud processing of personal data in settings.

### Structured output is always validated

Every extraction prompt has a Zod schema. Model output is parsed with it, and invalid output is treated as a failure. Small local models produce malformed JSON often enough that this is required.

### Embeddings are pinned

- One embedding model per installation (`nomic-embed-text`, 768 dimensions). Embeddings **never** fall back to a different model, because vectors from different models cannot be compared.
- Each vector row stores `embedding_model`. Changing the model triggers a full re-embed task.
- If the embedding provider is down, the task stays queued and retries later.

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
