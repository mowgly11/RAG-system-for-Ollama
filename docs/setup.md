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

### A session

On startup the app offers the ten most recently used conversations:

```
Previous conversations:

   1. weather today                                 2 messages  9/13/26, 10:08 PM
   2. Compare the current housing markets in Ph...  4 messages  9/13/26, 09:41 PM

Enter a number to continue that conversation, or press Enter to start a new one:
```

Enter a number to continue that chat, which reloads its full history into the model. Press Enter to start a new one. Anything that is not a listed number also starts a new one. The prompt is skipped entirely the first time you run the app, since there is nothing to continue.

A conversation is labelled by its first question, shortened to 60 characters. Conversations that were opened but never used are not offered.

The app then prompts `What is your question:` in a loop. Type `exit` or `quit`, or submit an empty line, to leave. The chat ID is printed on the way out. Ctrl+C also works but skips that.

## Conversation storage

Two MongoDB collections are created on first use, in the database named by `MONGODB_CONNECT`.

| Collection | Holds | Key fields |
| --- | --- | --- |
| `conversations` | One row per chat | `chatID`, `title`, `messageCount`, `lastMessageAt` |
| `messages` | One row per message | `chatID`, `role`, `content`, `searchPerformed`, `queries`, `sources` |

`chatID` is a UUID generated when a conversation starts, and it is what links the two collections. Search metadata is split across the turn: `searchPerformed` and `queries` are set on the user message, `sources` on the assistant reply.

Conversation history is never written to Chroma. See `docs/overview.md` for why that separation matters.

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

Models and retrieval:

| Key | Default | Effect |
| --- | --- | --- |
| `query_model_temperature` | `0` | Temperature for the search planner. Keep at 0 for deterministic JSON. |
| `llm_temperature` | `0.7` | Temperature for the answering LLM. |
| `context_window_size` | `32768` | `num_ctx` passed to Ollama and the context window reported to `llamaindex`. |
| `similarity_topk` | `5` | Chunks retrieved per question when no search ran. |
| `similarity_topk_after_search` | `12` | Chunks retrieved on a turn that just indexed pages, so fresh pages are not crowded out by older ones. |
| `max_replayed_messages` | `40` | How many of a conversation's most recent messages are replayed into the model. |

Scraping:

| Key | Default | Effect |
| --- | --- | --- |
| `headless_browser` | `false` | Run Chrome hidden. Headed is the default because bot checks pass more often that way. |
| `tor_proxy_enabled` | `false` | When `true`, Chrome is launched with `--proxy-server=$TOR_PROXY_URL`. |
| `page_timeout_ms` | `20000` | Navigation timeout per page. |
| `scraper_concurrency` | `3` | How many pages are fetched at once. |
| `search_results_per_query` | `3` | Links taken from each search result page. |
| `max_pages_per_turn` | `8` | Hard ceiling on pages fetched for one question. |
| `search_request_delay_ms` | `1200` | Pause between DuckDuckGo requests, to avoid rate limiting. |
| `min_page_characters` | `200` | Pages with less text than this are dropped instead of indexed. |
| `max_page_characters` | `20000` | Scraped text is truncated to this length. |

## Prompts

Templates live in `prompt/prompts/` and are loaded by name at runtime, so they can be edited without touching code.

- `system.txt`: system prompt for the answering chat engine.
- `query.txt`: planner prompt. The model decides whether to search and returns JSON.
- `force_query.txt`: planner prompt used when the question contains a search trigger word. The model must always return `needsSearch: true`.

## Troubleshooting

- **Chroma connection errors at startup**: make sure `chroma run` is listening on port 8000. The app now checks the collection during startup and refuses to continue without it, rather than failing later on the first question. The message `Connected to chroma instance` is printed once the collection is reachable.
- **App exits immediately with a Mongoose error**: MongoDB is not reachable at `MONGODB_CONNECT`.
- **A continued conversation gives worse answers than a new one**: its replayed history may be crowding out the retrieved context. Lower `max_replayed_messages`, or start a new conversation.
- **A question takes a long time**: it triggered a search. The ceiling is `max_pages_per_turn` pages at `page_timeout_ms` each, divided by `scraper_concurrency`. Lower the page ceiling for faster, shallower answers.
- **The planner searches for things it should already know**: check whether the question contains a word from the trigger list in `prompt/prompt.ts`, which forces a search. Triggers match whole words, so removing an over-eager entry is usually the fix.
- **`Export named 'connection' not found` from mongoose**: Bun resolves `connect`, `Schema`, and `model` as named exports of mongoose but not `connection`. Reach it off the default import, as `database/mongodb/mongodb.ts` does.
- **Planner errors such as invalid JSON**: try a larger `QUERY_MODEL`. The response is parsed strictly against the schema and a parse failure aborts the loop.
- **Chrome fails to launch or pages time out**: confirm Chrome is installed and, if Tor is enabled, that the Tor SOCKS proxy is running. Cloudflare Turnstile challenges are handled by `puppeteer-real-browser`, but some sites still block automated traffic.
- **No search results**: DuckDuckGo may rate-limit or change its HTML markup. The scraper reads `a.result__snippet` links from `https://duckduckgo.com/html/`.
