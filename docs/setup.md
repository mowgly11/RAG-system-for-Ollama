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

Enter a number to continue that chat, which reloads its recent history into the model, up to `max_replayed_messages`. Press Enter to start a new one. Anything that is not a listed number also starts a new one. The prompt is skipped entirely the first time you run the app, since there is nothing to continue.

A conversation is labelled by its first question, shortened to 60 characters. Conversations that were opened but never used are not offered.

The app then prompts `What is your question:` in a loop. Type `exit` or `quit`, or submit an empty line, to leave. The chat ID is printed on the way out. Ctrl+C also works but skips that.

## Tests

```bash
bun test
```

Chrome is the only hard requirement, and the scraper already needs it. A local HTTP server stands in for the web, so the suite is deterministic and works offline. Tests that need a service skip themselves when it is not running, and say so rather than failing.

| File | Covers |
| --- | --- |
| `tests/returnCreator.test.ts` | The result union, including that checking `ok` narrows the payload. |
| `tests/triggers.test.ts` | The search decision: the three verdicts, whole-word matching, scoring, pasted links, and hostile input. |
| `tests/pageTriage.test.ts` | `judgePage`, including the phrases that must not reject a real article, and the structure rules that outrank them. |
| `tests/searchFilters.test.ts` | Link unwrapping and the filters that reject a result before it costs a page load. |
| `tests/prompt.test.ts` | Template loading, substitution, and a missing or traversing path. |
| `tests/indexer.test.ts` | Document identity, so one page cannot become several documents. |
| `tests/scraping.test.ts` | Navigation and extraction in a real browser: status codes, content types, the wait for client rendered pages, and result parsing. |
| `tests/conversations.test.ts` | The MongoDB store, including injection-shaped input. Needs MongoDB. |
| `tests/workflow.test.ts` | The whole chain end to end against hostile pages and misleading questions. |
| `tests/fixtures.ts` | The local server and its pages. Not a test file. |

Some of those pages exist to attack the triage from both sides. A troubleshooting article titled "403 Forbidden: 9 Ways to Fix It" must be indexed. An article that deliberately opens with "Access denied. Page not found." to repel scrapers must also be indexed. A genuine error page or login wall given one heading to look structured must still be rejected.

The fixture server serves pages built to break things: a soft 404 returned as HTTP 200, an error body under a friendly title, a login wall, a login wall padded long enough to slip past the wall check, a page whose article is buried in wrapper divs, hidden keyword stuffing, a page that renders only after a delay, a shell that never renders, a page far past the size cap, and a results page seeded with sponsored rows, `javascript:` links and sign-in-wall domains.

Three tests currently skip on a machine with only MongoDB running. Two need Ollama for the live planner, and one is the placeholder that reports MongoDB was unavailable.

## Debug mode

Set `DEBUG_MODE=true` to trace a question from the moment it is read to the moment the answer comes back. Each line shows the time since the previous step, so the slow stage is obvious at a glance.

```
[debug] ===== turn 1 =====
[debug]      +0ms  question received        chars=37
[debug]      +1ms  search decision          decision="force" score=5 signals=["time sensitive", "volatile subject"]
[debug]   +7869ms  planner model called     model="llama3.2:1b"
[debug]      +2ms  planner plan parsed      needsSearch=true queries=["Boston weather today", ...+4]
[debug]    +981ms  result rejected          url="https://www.linkedin.com/..." reason="linkedin.com serves a sign-in wall"
[debug]   +1136ms  search results read      query="Boston weather today" accepted=3 offered=10 total=3
[debug]    +687ms  page skipped             url="https://www.easeweather.com/..." reason="The site returned HTTP 403"
[debug]    +473ms  page scraped             url="https://weather.com/..." chars=388 of=388 via="main" status=200
[debug]     +49ms  scraping finished        requested=3 kept=2 skipped=1 failed=0 workers=3
[debug]    +528ms  previous chunks cleared  url="https://weather.com/..."
[debug]   +1306ms  document indexed         url="https://weather.com/..."
[debug]     +12ms  chat engine built        similarityTopK=12 historyMessages=4
[debug]   +2204ms  answer received          chars=612
[debug]     total  14.02s
```

Steps are logged from the planner, both scrapers, the indexer, the conversation store, and the main loop. Long strings and arrays are truncated so a line stays readable. The spinner is suppressed while debug mode is on, since it would overwrite these lines.

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
| `DEBUG_MODE` | `false` | Log every workflow step with timings. See below. |

`DEBUG_MODE` accepts `true`, `false`, `1`, `0`, `yes`, and `no`. Anything else is rejected at startup rather than quietly treated as true.

All three Ollama clients use `OLLAMA_HOST`: the embedding model, the answering model, and the planner. A remote Ollama server needs no code change.

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
| `skip_planner_for_static` | `true` | Let a plainly definitional question skip the planner model entirely. The planner is the slowest step in a turn, so this removes several seconds from questions that were never going to need the web. |

Scraping:

| Key | Default | Effect |
| --- | --- | --- |
| `headless_browser` | `false` | Run Chrome hidden. Headed is the default because bot checks pass more often that way. |
| `tor_proxy_enabled` | `false` | When `true`, Chrome is launched with `--proxy-server=$TOR_PROXY_URL`. |
| `block_page_resources` | `false` | Drop images, fonts, stylesheets and media before they are fetched. Measured as no faster on a fast connection, because intercepting every request costs a round trip of its own. Left in for slow or metered links. |
| `page_timeout_ms` | `20000` | Navigation timeout per page. |
| `content_settle_ms` | `4000` | How long to wait for a client rendered page to put text on screen. |
| `scraper_concurrency` | `3` | How many pages are fetched at once. |
| `search_results_per_query` | `3` | Links kept from each search result page, after filtering. |
| `max_results_per_domain` | `2` | Ceiling per site across a turn, so one domain cannot fill the whole batch. |
| `max_pages_per_turn` | `8` | Hard ceiling on pages fetched for one question. |
| `search_request_delay_ms` | `700` | Pause between DuckDuckGo requests, to avoid rate limiting. |
| `min_page_characters` | `200` | Pages with less text than this are dropped instead of indexed. |
| `max_page_characters` | `20000` | Scraped text is truncated to this length. |
| `skip_domains` | social sites | Hosts rejected before they cost a page load, because they reliably serve a sign-in wall. |

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
- **The planner searches for things it should already know**: run with `DEBUG_MODE=true` and read the `search decision` line, which prints the score and which signal groups fired. Adjust the offending group in `prompt/triggers.ts`.
- **A question is answered without searching when it should have searched**: the same `search decision` line will say `skip`. Either the question read as definitional and carried no currency signal, or `skip_planner_for_static` is on and should be off.
- **Most results are thrown away**: `DEBUG_MODE=true` prints a `result rejected` line per filtered result and a `page skipped` line per discarded page, each with its reason. HTTP errors, non-HTML documents, sign-in walls, error pages and link indexes are all excluded on purpose.
- **`Export named 'connection' not found` from mongoose**: Bun resolves `connect`, `Schema`, and `model` as named exports of mongoose but not `connection`. Reach it off the default import, as `database/mongodb/mongodb.ts` does.
- **Planner errors such as invalid JSON**: try a larger `QUERY_MODEL`. The response is parsed strictly against the schema and a parse failure aborts the loop.
- **Chrome fails to launch or pages time out**: confirm Chrome is installed and, if Tor is enabled, that the Tor SOCKS proxy is running. Cloudflare Turnstile challenges are handled by `puppeteer-real-browser`, but some sites still block automated traffic.
- **No search results**: DuckDuckGo may rate-limit or change its HTML markup. The scraper reads `a.result__snippet` links from `https://duckduckgo.com/html/`.
