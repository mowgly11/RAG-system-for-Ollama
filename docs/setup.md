# Setup and Running

## Prerequisites

- **Bun**. See https://bun.sh.
- **Ollama** running locally with three models pulled. With the defaults from `env.ts`:

  ```bash
  ollama pull llama3.2:3b        # LLM (answers questions)
  ollama pull llama3.2:1b        # QUERY_MODEL (search planner)
  ollama pull nomic-embed-text   # EMBEDDING_MODEL
  ```

- **Chroma server**. The `chromadb` JavaScript client only talks to a server. It defaults to `http://localhost:8000`. The repository's `.chroma/` folder is a server data directory and is git-ignored:

  ```bash
  pip install chromadb
  chroma run --path .chroma
  ```

- **MongoDB** reachable at `MONGODB_CONNECT`. The app awaits the connection at startup and exits if it cannot connect.
- **Google Chrome** installed, since `puppeteer-real-browser` drives a real Chrome instance. On Linux you also need `xvfb`.
- **Tor** (optional). Only needed when `tor_proxy_enabled` is `true` in `config.json`.

## Install and run

```bash
bun install
bun run start
```

The app prompts `What is your question:` in a loop. Press Ctrl+C to stop.

## Environment variables

Variables are validated in `env.ts` with `zod`. Put them in a `.env` file at the project root (Bun loads it automatically). All have defaults.

| Variable | Default | Purpose |
| --- | --- | --- |
| `LLM` | `llama3.2:3b` | Ollama model used by the chat engine to answer questions. |
| `QUERY_MODEL` | `llama3.2:1b` | Ollama model used by the search planner to decide whether to search and to generate queries. |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Ollama embedding model used for indexing and retrieval. |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama server URL. See the caveat below. |
| `VECTOR_STORE_COLLECTION_NAME` | `rag_store` | Chroma collection name. |
| `TOR_PROXY_URL` | `socks5://127.0.0.1:9050` | Proxy passed to Chrome when Tor is enabled. |
| `MONGODB_CONNECT` | `mongodb://127.0.0.1:27017/rag_system_conversations` | MongoDB connection string. |

**Caveat on `OLLAMA_HOST`.** Only the embedding client is given this value. The chat LLM in `index.ts` and the planner call in `prompt/prompt.ts` use the `ollama` client default of `127.0.0.1:11434`. If your Ollama server runs elsewhere, you must also pass the host to those two clients in code.

## `config.json`

Runtime tuning lives in `config.json` and is imported directly by the code.

| Key | Default | Effect |
| --- | --- | --- |
| `query_model_temperature` | `0` | Temperature for the search planner. Keep at 0 for deterministic JSON. |
| `llm_temperature` | `0.7` | Temperature for the answering LLM. |
| `context_window_size` | `32768` | `num_ctx` passed to Ollama and the context window reported to `llamaindex`. |
| `similarity_topk` | `5` | Number of chunks retrieved from Chroma per question. |
| `tor_proxy_enabled` | `false` | When `true`, Chrome is launched with `--proxy-server=$TOR_PROXY_URL`. |

## Prompts

Templates live in `prompt/prompts/` and are loaded by name at runtime, so they can be edited without touching code.

- `system.txt`: system prompt for the answering chat engine.
- `query.txt`: planner prompt. The model decides whether to search and returns JSON.
- `force_query.txt`: planner prompt used when the question contains a search trigger word. The model must always return `needsSearch: true`.

## Troubleshooting

- **Chroma connection errors at startup**: make sure `chroma run` is listening on port 8000. The message `Connected to chroma instance` is printed once the storage context is created.
- **App exits immediately with a Mongoose error**: MongoDB is not reachable at `MONGODB_CONNECT`.
- **Planner errors such as invalid JSON**: try a larger `QUERY_MODEL`. The response is parsed strictly against the schema and a parse failure aborts the loop.
- **Chrome fails to launch or pages time out**: confirm Chrome is installed and, if Tor is enabled, that the Tor SOCKS proxy is running. Cloudflare Turnstile challenges are handled by `puppeteer-real-browser`, but some sites still block automated traffic.
- **No search results**: DuckDuckGo may rate-limit or change its HTML markup. The scraper reads `a.result__snippet` links from `https://duckduckgo.com/html/`.
