# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2026-09-13 (debug mode)

### Added

- **`DEBUG_MODE` environment variable.** Set it to `true` to trace a question from the moment it is read to the moment the answer comes back. Each line reports the time since the previous step, so the slow stage is obvious. In a sample run the planner alone accounted for nearly eight of fourteen seconds.
  - `utils/debug.ts`: `debugTurn()` opens a timed section, `debugStep()` logs one step with `key=value` detail, and `debugTurnEnd()` closes with the total. Long strings and arrays are truncated so lines stay readable. Every function returns immediately when debug is off.
  - Steps are reported from the main loop, the planner, both scrapers, the indexer, and the conversation store.
  - The spinner is suppressed while debug mode is on, since it would overwrite the output.
- `DEBUG_MODE` accepts `true`, `false`, `1`, `0`, `yes`, and `no`. It uses `z.stringbool()` rather than `z.coerce.boolean()`, which reads the string `"false"` as true because every non-empty string is truthy.

### Fixed

- **Reaching end of input crashed with a stack trace.** Asking a closed readline interface for another line throws `ERR_USE_AFTER_CLOSE`, so Ctrl+D, or a piped stream running out, ended in an unhandled error. `input()` now resolves with an empty string once input has ended, which callers already treat as "stop". Found by running the app rather than by reading it.
- A debug step logged before any `debugTurn()` reported the whole unix epoch as its duration.

### Notes

- Verified end to end against live Ollama, Chroma, and MongoDB, using a throwaway collection and database that were both deleted afterwards.
- The deduplication fix from the audit is now confirmed against a real Chroma server: indexing the same pages from a fresh index left the collection at three chunks rather than six.
- Known limitation: questions must be typed interactively. Piping a script of questions does not work, because readline drops lines that arrive while no prompt is pending.

---

## [Unreleased] - 2026-09-13 (implementation audit)

An audit of the whole implementation, and the fixes it turned up.

### Fixed

- **Search triggers matched substrings instead of words.** `definitelyNeedsSearch` used `includes`, so ordinary questions were forced into a web search: "now" sits inside "know", "top" inside "stop", "list" inside "listen", "live" inside "delivery". Triggers are now matched on word boundaries, and four duplicate entries were removed from the list.
- **The vector store gained a fresh copy of every re-scraped page.** The dedupe check read the index's document store, which is in memory and starts empty on each run, so the stored hash was always undefined and nothing was ever replaced. Measured on the existing collection before the fix: 63 chunks stored, 43 distinct, 20 redundant. A URL's previous chunks are now deleted from the Chroma collection before that URL is re-indexed.
- **Planner failures reported the wrong cause.** `toSearchQuery` never checked the error from `queryModel`, then dereferenced its null data, so an unreachable Ollama surfaced as `TypeError: null is not an object`. The error is now checked, and three failure modes are reported separately: unreachable model, non-JSON reply, and a reply that does not fit the schema. Validation uses `safeParse`.
- **`createIndex` dereferenced null on failure** and printed "Connected to chroma instance" even when the connection had failed. It returns the error instead, and the collection is touched at startup so an unreachable Chroma is reported immediately.
- **Both scrapers leaked Chrome processes.** `browser.close()` sat after the loop with no `try`/`finally`, so any throw left an orphaned browser for the rest of the session. Cleanup now runs through `withBrowser`, which always closes.
- **Empty pages and sign-in walls were indexed as content.** The collection held seven copies of an empty chunk plus LinkedIn sign-in boilerplate. Pages below `min_page_characters` are dropped, and short pages carrying a known sign-in or bot-check phrase are skipped.
- **`OLLAMA_HOST` reached only the embedding client.** The answering model and the planner both used the library default, so a remote server only half worked. Both now take the configured host.
- **Anchor text was destroyed.** `dataScraper` removed `a` elements, which deletes the words inside them, not just the links. Anchors are unwrapped into their text instead.
- **DuckDuckGo links were unwrapped with string replacement**, which corrupts targets containing encoded separators. The real target is read from the `uddg` parameter with `URL`.
- `readline.question` was called with a third argument, so the promise's rejection path could never fire. The interface is also closed on exit now.
- The spinner called `clearLine`, which does not exist on a piped stream, and overwrote log lines printed by the scrapers. It is a no-op off a TTY and runs only around the model call.
- `normalizeUrl` threw on a malformed URL and took the turn down with it. It falls back to the raw URL.
- The query cap disagreed with itself: the prompt and schema allowed eight queries while the code sliced to seven, silently dropping one. One constant now drives both.

### Added

- **Bounded, parallel scraping.** One browser serves a whole turn instead of two. Pages are fetched `scraper_concurrency` at a time with an explicit `page_timeout_ms`, capped at `max_pages_per_turn`, and DuckDuckGo requests are paced by `search_request_delay_ms`.
- **Retrieval widens after a search.** The chat engine is rebuilt each turn and uses `similarity_topk_after_search` when pages were just indexed, so fresh pages are not crowded out by everything indexed before.
- **A cap on replayed history.** `max_replayed_messages` bounds how much of a conversation is fed back, protecting `context_window_size`.
- New `config.json` keys for all of the above, plus `headless_browser`, `min_page_characters`, and `max_page_characters`.

### Changed

- **`FunctionResponse` is now a typed discriminated union.** It was `{ error, data: any }`, which erased type safety at every call site and allowed the null dereferences above. Checking `ok` narrows `data` to a real value. The change caught a latent browser type mismatch during the refactor.
- `createIndex` returns an `IndexBundle` of the index and its vector store, since deduplication needs the collection directly.
- The scrapers take a browser session and return plain arrays, leaving lifecycle to `withBrowser`.
- `tsconfig.json` includes the DOM library, which was missing and made `page.evaluate` fail to type-check.
- Dropped the unused `readline` dependency. The import resolves to the built-in module.
- Removed the unused `DataFromURL` type.

### Notes

- The project type-checks with no errors, including three that pre-dated this work.
- Verified against live MongoDB, and against the shipped source of the pure helpers. Chroma and Ollama were not running, so the deduplication delete and the chat engine wiring are type-checked and signature-checked but not exercised end to end.
- Existing duplicate chunks are not removed retroactively. They clear as each page is next re-scraped.

---

## [2026-09-13] Conversation persistence

### Added
- **Conversation persistence in MongoDB.** Every message is stored and every chat is resumable.
  - `database/mongodb/schemas/conversationSchema.ts`: new `conversations` collection holding one row per chat with `chatID`, `title`, `messageCount`, and `lastMessageAt`.
  - `database/mongodb/schemas/messageSchema.ts`: the previously empty `messages` schema now holds `chatID`, `role`, `content`, and the turn's search metadata. Compound index on `chatID` and `createdAt`.
  - `database/mongodb/conversations.ts`: store exposing `createConversation()`, `listConversations()`, `loadHistory()`, and `saveMessage()`.
- **Chat IDs.** Each conversation gets a UUID at creation, carried on every message, and used to reload that conversation later. The `uuid` dependency was already installed but unused until now.
- **Conversation picker in the CLI.** On startup the most recently used conversations are listed with their title, message count, and last activity. Entering a number continues that chat and replays its history into the model. Pressing Enter starts a new one.
- **Automatic conversation titles**, taken from the first user message, whitespace collapsed and shortened.
- **Clean exit.** `exit`, `quit`, or an empty question leaves the loop and prints the chat ID.
- New types: `MessageRole`, `MessageRecord`, `ChatHistoryMessage`, and `ConversationSummary`.

### Changed
- `index.ts` resolves a conversation before building the chat engine and passes the stored history as `chatHistory`. The user message is saved before the model runs, so a question survives a failed reply. The assistant reply is saved with the URLs indexed for that turn.
- A planner failure skips the turn instead of ending the session.
- Search results are spread into an array before reaching the page scraper, which expected an array and was receiving a `Set`.

### Fixed
- **MongoDB connection crashed at startup.** `database/mongodb/mongodb.ts` imported `connection` as a named export of mongoose, which Bun does not provide, so `bun run start` failed with `Export named 'connection' not found`. Mongoose is reached through its default import now.
- Connection event listeners are registered before connecting, so the first `connected` event is no longer missed.

### Notes
- Conversation messages are deliberately kept out of Chroma. The chat engine retrieves from that collection on every question, so storing replies there would feed the model its own earlier output back as a source.

---

## [2026-09-02]

### Added
- **Search planner** (`prompt/prompt.ts`): `toSearchQuery()` asks a small `QUERY_MODEL` whether a question needs web search and which queries to run. Output is constrained to JSON via a schema generated from a `zod` definition, and queries are capped at 7.
- **Force search**: a list of trigger words (for example "latest", "today", "price", "news") switches to the `force_query.txt` prompt so that search always happens for time-sensitive questions.
- **DuckDuckGo search scraper** (`scraper/searchQueryScraper.ts`): loads the DuckDuckGo HTML endpoint for each query and collects the top 3 result links per query.
- **Page data scraper** (`scraper/dataScraper.ts`): visits each result URL, strips non-content elements with `cheerio`, and returns cleaned body text as `RawData`.
- **Bulk indexing** (`database/chroma/indexer.ts`): `indexDataBulk()` indexes many documents with `Promise.allSettled` and reports success and failure counts. `indexData()` now skips unchanged documents and replaces changed ones by hash.
- **URL normalization**: document ids are normalized URLs (fragment, `utm_*` parameters, and trailing slash removed) so repeated scrapes do not duplicate pages.
- **Tor proxy support**: `TOR_PROXY_URL` env var and `tor_proxy_enabled` in `config.json` route Chrome through a SOCKS proxy.
- **MongoDB connection** (`database/mongodb/mongodb.ts`): Mongoose connects to `MONGODB_CONNECT` at startup. A placeholder `messages` schema was added but is still empty.
- **`config.json`**: `query_model_temperature`, `llm_temperature`, `context_window_size`, `similarity_topk`, and `tor_proxy_enabled` moved out of code.
- New env vars: `QUERY_MODEL`, `VECTOR_STORE_COLLECTION_NAME`, `TOR_PROXY_URL`, `MONGODB_CONNECT`.
- New types: `FunctionResponse`, `RawData`, and the `force_query` member of `PromptType`.
- `utils/returnCreator.ts` for the shared `{ error, data }` result shape.

### Changed
- `index.ts` now runs the full loop: plan search, scrape, index, then answer. It also sets `num_ctx` and the reported context window from `config.json`.
- `scraper/scraper.ts` is now a `Scraper` class with `openBrowser()` and `getHTMLcontent(url, page)`. Navigation errors and empty bodies are returned as errors instead of thrown. Browsers are closed after each batch.
- `database/` was reorganized into `database/chroma/` and `database/mongodb/`.
- Prompt helpers return `FunctionResponse` instead of throwing.
- `query.txt` was simplified and now requires strict JSON output.
- The `TEMPERATURE` env var was removed in favour of `config.json`.
- The system prompt was replaced with a plain helpful-assistant prompt.
- Dependencies added: `mongoose`, `ollama`, `puppeteer`, `chromadb`.

### Technical Details
- **Commit range**: `3a04a74` (2026-08-11) to `7d00dff` (2026-09-02)
- **Author**: John (mowgly11)

---

## [2026-08-10]

### Added
- **Prompt Management System**: New `getPrompt()` function in `prompt/prompt.ts` for managing and loading prompt templates
  - Supports multiple prompt types (system, query) via `PromptType` enum
  - Implements dynamic prompt replacement via `ReplaceObject` interface
  - Includes error handling and logging for missing or malformed prompt files
- **Enhanced Ollama API Integration**: 
  - Configured `OllamaEmbedding` for semantic search with embeddings
  - Configured `Ollama` LLM instance with temperature settings (0.7) for controlled generation
  - Integrated system prompt into chat engine via `chatEngine.asChatEngine()` with similarity top-k (5)

### Changed
- Updated llamaindex Settings to use Ollama-based embedding and LLM models
- Integrated prompt management into the main chat loop (`index.ts`)
- Chat engine now uses system prompts loaded from template files

### Technical Details
- **Commit Hash**: `676fa81b62089bc4c13f0259524464bd9987087b`
- **Author**: John (mowgly11)
- **Files Modified**:
  - `prompt/prompt.ts` - New prompt management module
  - `index.ts` - Ollama integration and chat engine setup
  - `types/types.ts` - New type definitions (PromptType, ReplaceObject)
  - `prompt/prompts/system.txt` - System prompt template file

---

## Previous Commits

### Update README.md
- Improved documentation and project overview
- Hash: `1c45d74b2986dd8ff82da595ff7eb7d5fa3c8079`

### Add CLI loader spinner and integrate into main
- Added loading spinner feedback for user experience
- Integrated into main chat loop
- Hash: `715c380b5088677243d9ec4ca7ee3cdd2e6edfdf`

### Initialize vector store, add chat loop, add uuid
- Set up vector store for embeddings
- Implemented interactive chat loop
- Added UUID support for tracking
- Hash: `9cd313b238ee07206acdec26e0c6fa31b0b57fd8`

### Add interactive query loop; fix chroma import
- Added interactive prompt for user queries
- Fixed Chroma vector store imports
- Hash: `3be667fc37bfaa37a62d13cbedf4d67cb4454b6b`

### Initialize Chroma storage and index workflow
- Set up Chroma vector database
- Implemented indexing workflow
- Hash: `1ab793e22dc65eb137ce4b8f16855fd48d5a9b4e`

### Added .chroma to gitignore
- Excluded Chroma storage directory from version control
- Hash: `cca8bce13d93be4b692e5fccf1b5493938f849cb`

### Restructure project layout and use env vars
- Reorganized project directory structure
- Implemented environment variable configuration
- Hash: `a5cc7183b7992679791bb6c3e39c75b7ff554783`

### Add docs, env validation, and README updates
- Added comprehensive documentation in docs/ folder
- Implemented environment variable validation
- Updated README with setup instructions
- Hash: `161e0613c405a1afa2d944a7fac14b8de891f6f9`

### Initial commit
- Bootstrap project structure
- Hash: `a64cf6eb64e6183d5549a842a0fa3e0d7ad34d00`
