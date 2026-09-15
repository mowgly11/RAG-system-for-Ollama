# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2026-09-15 (test suite)

### Added

- **A test suite**, run with `bun test`. 224 tests across 10 files: one per workflow step, plus an end-to-end run of the whole chain under adversarial input.
- **A local HTTP server as the web** (`tests/fixtures.ts`), so the scraping tests are deterministic and need no network. Its pages are built to break things: a soft 404 returned as HTTP 200, an error body under a friendly title, a login wall, a login wall padded long enough to slip past the wall check, an article buried in wrapper divs, hidden keyword stuffing, a page that renders only after a delay, a shell that never renders, a page far past the size cap, and a results page seeded with sponsored rows, `javascript:` links, and sign-in-wall domains.
- **Service probes**, so tests that need MongoDB, Chroma, or Ollama skip and say so rather than failing.
- `unwrapResultURL`, `hostOf` and `rejectionReason` are exported from the search scraper so the filter rules can be tested directly.

### Fixed

Both found by tests written against the existing behaviour.

- **A short article mentioning an error phrase was thrown away.** Marker checks searched the whole text, so a 1300 character article about error handling was rejected for containing "access denied". An error page leads with that sentence while an article reaches it partway down, so position is now part of the evidence: a marker counts only when it appears near the top, or on a page too small for position to mean anything.
- **A pasted link decided the question on its own.** Hyphens are word boundaries, so `https://example.com/what-is-the-current-price` scored on "current" and "price" and forced a search. Links are stripped before scoring, since a slug is not the asker's wording. The words around a link still count.

### Notes

- Three tests skip on a machine running only MongoDB: two need Ollama for the live planner, and one is the placeholder reporting that MongoDB was unavailable.
- Two test expectations turned out to be wrong rather than the code: the force prompt describes its output shape with an example rather than the word "JSON", and every fixture page shares the loopback host, so the per-domain cap was the binding limit on the search stage. Both tests now assert what the code actually guarantees, and the scrape stage is fed its candidates directly so it faces every trap at once.
- The long padded login wall is covered by a test that records it getting through, so the tradeoff stays visible rather than being forgotten.

---

## [Unreleased] - 2026-09-15 (extraction, triage and search)

### Added

- **Main content extraction.** `scraper/extract.ts` scores candidate containers by how much text they hold against how much of it is link text, with a bonus for `article` and `main` and for content-shaped class names, and a penalty for nav-shaped ones. Taking all of `body.innerText` dragged in menus, cookie banners and related-article lists.
- **Extraction runs inside the page.** It sees the DOM the site's JavaScript produced, and moves only the extracted text across the wire instead of the whole body markup.
- **A wait for client rendered pages.** After `DOMContentLoaded` the page is given `content_settle_ms` to put text on screen. A single-page app is empty at that moment and fills in later, so those were previously discarded as too short.
- **Page triage before indexing.** `judgePage()` rejects pages that are too short, mostly links, an error page, or a sign-in wall. The error-title pattern matches titles that are about an error rather than titles that merely contain the word, so "Error Handling in Rust" survives.
- **Result filtering before fetching.** Unreadable document types, hosts in the new `skip_domains` list, and more than `max_results_per_domain` from one site are rejected at search time. Verified against a live query: two LinkedIn results were dropped without ever being loaded, and the quota refilled from the remaining pool.
- **Richer search result extraction**, reading title, snippet and link per row inside the page, skipping sponsored rows, and reporting a bot challenge or an empty result page as distinct outcomes.
- New `config.json` keys: `block_page_resources`, `content_settle_ms`, `max_results_per_domain`, `skip_planner_for_static`, `skip_domains`.

### Fixed

- **HTTP error responses were scraped and indexed as content.** The status from the navigation was discarded entirely, so a 404 or a 503 became a document. Status and content type are now checked before anything reads the page. A live run confirmed it: a weather site answering 403 is excluded, where it previously produced an empty document.
- **Non-HTML responses were fed to the text extractor.** A PDF or an image is now rejected on content type.
- **Navigation failures reported raw Chrome internals.** `ERR_NAME_NOT_RESOLVED` and friends are translated into something a reader can act on.
- **A container could report more text than the whole page.** The body snapshot was taken before the candidate walk, so a page still rendering appeared smaller than a container inside it. It is read afterwards now.
- **A page of nothing but links was kept.** When every candidate was filtered out for link density, the fallback to body text reported a density of zero and lost the signal.

### Changed

- **The search trigger system is scored rather than binary.** A flat word list forced a search whenever any single word matched, which over-fired: "live" appears in "how does live reload work", "top" in "what is a top-level domain". Signals are weighted now, phrases count for more than bare words, and definitional phrasing counts against searching. `prompt/triggers.ts` returns one of three verdicts.
- **A plainly definitional question no longer calls the planner model.** The planner is the slowest step in a turn, measured at close to eight seconds, and a question like "what is binary search" was never going to need the web. Controlled by `skip_planner_for_static`.
- Search pacing dropped from 1200ms to 700ms between queries, and the lighter `html.duckduckgo.com` endpoint is tried first, with the main host as a fallback for a challenge or an empty page.
- The page scraper uses one page per worker rather than one per URL.
- The page title is prepended to the extracted text, since it names the page for the embedder.
- Dropped the `cheerio` dependency. Extraction moved into the browser, so nothing imports it.

### Notes

- **Resource blocking did not deliver and is off by default.** Blocking images, fonts, stylesheets and media measured at a mean of 4641ms against 4663ms without it, over a fixed six-page list, with run-to-run variance far larger than the difference. Intercepting every request costs a round trip of its own, which cancels the bandwidth saved. The code is kept behind `block_page_resources` for slow or metered connections, but no speed claim is made for it.
- Verified with 33 checks on the pure classifier and triage logic, and 27 browser checks driven against a local server covering 404, 503, PDF content type, a refused connection, a client rendered page, a soft 404, a link index, and the search result markup. A live search and scrape run confirmed the behaviour end to end.
- Corrected three stale claims in the docs that the code had already outgrown: the note that only the embedding client used `OLLAMA_HOST`, the claim that a continued conversation replays its full history, and a debug sample predating the search decision line.

---

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
