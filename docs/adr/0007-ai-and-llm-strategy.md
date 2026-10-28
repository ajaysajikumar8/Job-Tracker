# 7. AI and LLM Strategy: Provider-Agnostic Client with Local-First Approach

Date: 2026-10-14

## Status

Accepted

## Context

The system requires LLM capabilities for several distinct tasks:
1. **Vector embedding generation** — For semantic fit scoring and duplicate detection
2. **Skill extraction** — Extract structured skill lists from unstructured job descriptions
3. **Post-mortem keyword extraction** — Extract failure topics from free-text post-mortem notes
4. **Duplicate detection** — Identify near-identical job postings scraped from different sources
5. **Semantic fit scoring** — Score how well a user's profile/resume matches a specific job description
6. **PDF table parsing** — Extract vacancy numbers and eligibility data from government PDFs

These tasks have very different complexity profiles. Sending all tasks to a cloud LLM (e.g., GPT-4o) on every scrape run would be:
- **Expensive at scale** — Sending full HTML/PDF content per job, per scrape
- **Privacy-sensitive** — Resume and profile data (DOB, category, CTC) sent to a third party
- **Unnecessary** — Most tasks are simple enough for small local models

The system is designed to run on a self-hosted VPS (personal deployment) where a local model server is a viable option.

## Decision

### Architecture: Provider-Agnostic AIClient

A single `AIClient` class in the Python service abstracts all LLM interactions. It holds references to both a local Ollama client and a cloud OpenAI client, routing each task to the appropriate provider based on complexity and a configurable mode.

```python
class AIClient:
    def __init__(self, mode: str):  # "local" | "cloud" | "hybrid"
        self.local = OpenAI(
            base_url="http://localhost:11434/v1",
            api_key="ollama"
        )
        self.cloud = OpenAI(api_key=settings.OPENAI_API_KEY)
        self.mode = mode
```

The key insight: **Ollama exposes an OpenAI-compatible API**. The same `openai` Python SDK is used for both providers — only the `base_url` and `model` name differ. Switching providers requires no business logic changes.

### Local Model Server: Ollama

Ollama runs as a separate process (or Docker container) on the same host as the Python service. It serves quantized models that run on CPU without a GPU.

| Model | Size (RAM) | Used For |
|:---|:---|:---|
| `nomic-embed-text` | ~300 MB | Vector embeddings (primary) |
| `phi3:mini` (3.8B, 4-bit) | ~2.3 GB | Skill extraction, keyword extraction |
| `llama3.2:3b` (4-bit) | ~2.0 GB | General structured extraction |

### Task Routing: Local vs Cloud

| Task | Complexity | Provider | Rationale |
|:---|:---|:---|:---|
| Vector embeddings | Low | **Local (`nomic-embed-text`)** | High quality, free, fast, privacy-preserving |
| Duplicate detection | None (math) | **No LLM** | Pure cosine similarity on stored embeddings |
| Skill extraction from JD | Medium | **Local (`phi3:mini`)** | Structured JSON output, small models handle well |
| Post-mortem keyword extraction | Low | **Local (`phi3:mini`)** | Simple keyword identification |
| Semantic fit scoring | High | **Cloud (`gpt-4o-mini`)** | Requires nuanced multi-document reasoning |
| Complex PDF table parsing | High | **Cloud (`gpt-4o-mini`)** | Government PDFs have chaotic structure |

### Configuration

Provider routing is controlled entirely via environment variables:

```env
AI_PROVIDER=hybrid              # "local" | "cloud" | "hybrid"
OLLAMA_BASE_URL=http://localhost:11434/v1
EMBEDDING_MODEL=nomic-embed-text
EXTRACTION_MODEL=phi3:mini
CLOUD_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...           # Only required if AI_PROVIDER != "local"
```

### Why NOT LangChain

LangChain was considered and rejected:
- Our LLM use cases are **well-defined, non-chained calls** — not complex agent pipelines
- LangChain adds abstraction layers that make debugging harder and error messages less clear
- The direct OpenAI SDK is simpler, more transparent, and sufficient for our use cases
- LangChain's value proposition (chains, agents, memory) is not needed here

### Cost Estimate

For a personal deployment with one user:

| Mode | Estimated Monthly Cost |
|:---|:---|
| Full cloud (OpenAI) | ~$2–5/month |
| Hybrid (local + gpt-4o-mini for complex tasks) | ~$0.20–0.50/month |
| Full local (Ollama only) | $0 (electricity cost only) |

Hybrid mode is the recommended default — maximizes privacy and minimizes cost while maintaining quality for complex tasks.

## Consequences

- **Positive:** Resume, profile, and demographic data (DOB, category, CTC) never leave the local machine when using local embeddings — strong privacy guarantee.
- **Positive:** System remains functional for 70–80% of tasks even without an internet connection or OpenAI API key.
- **Positive:** Switching between local and cloud is a config change, not a code change.
- **Positive:** Duplicate detection is zero-cost (pure math on stored vectors).
- **Negative:** Local models (`phi3:mini`, `llama3.2:3b`) are slower than cloud APIs on CPU — expect 3–8 seconds per extraction task. Acceptable since these run in Celery background workers, not in the request path.
- **Negative:** Ollama adds an additional process to manage in Docker Compose. Adds ~2.5 GB RAM requirement to the server.
- **Trade-off Accepted:** Quality of local model outputs for complex tasks is lower than GPT-4o. The routing strategy mitigates this by using cloud models only for the tasks where quality difference is meaningful.
