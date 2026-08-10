# Setup and Running

Prerequisites
- Bun (recommended) installed. See https://bun.sh
- A local Ollama server if you want to run the embeddings/LLM locally (optional if you adapt to another provider)

Install dependencies

```bash
bun install
```

Run the example

```bash
bun run index.ts
```

Notes about configuration
- The project contains an `env.ts` file that validates environment variables with `zod`. It provides defaults for `LLM`, `EMBEDDING_MODEL`, and `OLLAMA_HOST`.
- `index.ts` configures `Settings.llm` and `Settings.embedModel` using `ollama` and `OllamaEmbedding`. Adjust the values in `env.ts` or set environment variables as needed for your setup.

Running Ollama locally
- If using Ollama locally, ensure the Ollama daemon is running and reachable at the host/port used by `OLLAMA_HOST`.

Troubleshooting
- If the scraper fails to extract content, check that the target site allows headless browsers and that the `puppeteer-real-browser` connection is successful.
- If you see network errors connecting to Ollama, verify that `OLLAMA_HOST` is valid and not using `127.0.01` by mistake.
