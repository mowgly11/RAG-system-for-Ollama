# Components

All functions that can fail return a `FunctionResponse<T>`, built with `utils/returnCreator.ts`. It is a discriminated union: checking `ok` narrows `data` to a real value, so a failed call cannot be dereferenced by accident.

```ts
const result = await doSomething();

if (!result.ok) return console.error(result.error);

result.data // typed, and known to exist
```

## Entry point

- `index.ts`: Configures `llamaindex` `Settings` with the Ollama embedding model and the answering LLM, both pointed at `OLLAMA_HOST`. On start it connects to MongoDB, opens the Chroma index, resolves which conversation to work in, and replays that chat's recent history. Each turn reads a question, runs the search planner, gathers and indexes sources when required, saves the question, builds the chat engine for that turn, then prints and saves the answer.
  - `pickConversation()`: Lists recent conversations and reads the user's choice. Returns the chat ID to work in, creating a new conversation when the user declines, gives an invalid answer, or has no history yet. Returns `null` only when the conversation could not be created.
  - `gatherSources(bundle, queries)`: Runs search, scraping, and indexing for one question inside a single browser, and returns the URLs that were indexed.
  - `fitTitle(title)`: Pads a title to the picker's column width, or shortens it with an ellipsis.
  - `toText(content)`: Flattens a chat reply into a plain string. The engine may answer with text or with a list of content parts.

The chat engine is rebuilt each turn rather than once per session. That is what lets retrieval widen to `similarity_topk_after_search` on a turn that just indexed fresh pages.

## Configuration

- `env.ts`: Validates `process.env` with `zod` and exports `env`. Defines defaults for `LLM`, `QUERY_MODEL`, `EMBEDDING_MODEL`, `OLLAMA_HOST`, `VECTOR_STORE_COLLECTION_NAME`, `TOR_PROXY_URL`, `MONGODB_CONNECT`, and `DEBUG_MODE`. The boolean uses `z.stringbool()` rather than `z.coerce.boolean()`, which would read the string `"false"` as true.
- `config.json`: Tunable runtime values for the models, retrieval, and the scraper. See `docs/setup.md` for each key.

## Prompts and search planning

- `prompt/prompt.ts`:
  - `getPrompt(type, replace?)`: Reads `prompt/prompts/<type>.txt` and applies optional term substitutions from a `ReplaceObject[]`.
  - `toSearchQuery(message)`: The search planner. Picks `force_query` when the message contains a trigger word, otherwise `query`. Calls `QUERY_MODEL` with a JSON schema generated from the `SearchPlanSchema` `zod` definition and returns `{ needsSearch, queries }`. A forced search that comes back with no queries falls back to the question itself, so it cannot silently skip searching.
  - `queryModel(...)`: Wraps the Ollama call. Separates three failure modes: the model being unreachable, a reply that is not JSON, and a reply that does not fit the schema. Each returns its own message rather than throwing.
  - `definitelyNeedsSearch(input)`: Whole-word match against `SEARCH_TRIGGERS`. Word boundaries matter here. A substring test fires on ordinary questions, since "now" sits inside "know" and "top" inside "stop".
- `prompt/prompts/system.txt`: System prompt for the answering chat engine.
- `prompt/prompts/query.txt`: Instructs the planner to decide whether search is needed and how many queries to produce.
- `prompt/prompts/force_query.txt`: Same output format but `needsSearch` is always `true`.

The planner uses its own Ollama client pointed at `OLLAMA_HOST`, rather than the library's default client.

## Scraping

- `scraper/scraper.ts`:
  - `Scraper.openBrowser()`: Launches Chrome with `--no-sandbox`, Turnstile handling, a 1280x1024 viewport, headless per `headless_browser`, and the Tor proxy when enabled.
  - `Scraper.getHTMLcontent(url, page)`: Validates the URL scheme, navigates with `domcontentloaded` and an explicit `page_timeout_ms`, and returns the body's inner HTML. Navigation failures and empty bodies come back as errors rather than thrown.
  - `withBrowser(work)`: Opens a browser, runs `work` against it, and always closes it in a `finally`. Both scraping phases of a turn run inside one call, so a turn uses one browser instead of two and cannot leak a Chrome process when something throws.
  - `delay(ms)`: Small sleep helper used for pacing.
  - `ScraperBrowser` and `ScraperPage` are derived from what `connect()` returns. `puppeteer-real-browser` bundles its own puppeteer, whose types are not the same as the top-level `puppeteer` package.
- `scraper/searchQueryScraper.ts`: `executeSeachQueries(session, queries)`. Loads the DuckDuckGo HTML endpoint for each query on one page, pacing requests by `search_request_delay_ms`, and returns unique URLs up to `max_pages_per_turn`.
  - `unwrapResultURL(href)`: Reads the real target from the `uddg` query parameter using `URL`. String surgery on the href corrupts targets that contain encoded separators of their own.
  - Prefers the `result__a` anchor and falls back to `result__snippet` if DuckDuckGo's markup changes.
- `scraper/dataScraper.ts`: `getDataFromURLs(session, urls)`. Fetches URLs `scraper_concurrency` at a time using extra pages on the shared browser, each closed when its page is done.
  - `extractText(html)`: Removes scripts, styles, navigation, and forms, then unwraps anchors into their text rather than deleting them. Removing an `a` element deletes the words inside it, which are part of the sentence. Output is capped at `max_page_characters`.
  - `looksBlocked(text)`: Flags short pages carrying a sign-in or bot-check phrase, so login walls are not indexed as if they were answers. Long pages are exempt, since an article may quote such a phrase in passing.

## Storage and indexing

- `database/chroma/chroma.ts`: `createVectorStore()`. Creates a `ChromaVectorStore` for `VECTOR_STORE_COLLECTION_NAME` and touches the collection so an unreachable server is reported at startup.
- `database/chroma/indexer.ts`:
  - `normalizeUrl(url)`: Strips the fragment, `utm_*` parameters, and a trailing slash so one page maps to one document id. A malformed URL falls back to its raw form instead of throwing.
  - `toDocument(text, url)`: Builds a `Document` with the normalized URL as both `id_` and `metadata.url`.
  - `createIndex()`: Returns an `IndexBundle` of the index and its vector store, or an error. The vector store is carried along because deduplication needs to reach the Chroma collection directly.
  - `dropExistingChunks(vectorStore, url)`: Deletes every chunk previously stored for a URL, matching on the `url` metadata field. This is what stops a re-scrape from appending a second copy of a page. The index's own document store is in memory and starts empty each run, so its hash check cannot recognise a page indexed by an earlier run.
  - `indexData(bundle, document)`: Skips documents below `min_page_characters`, skips a document already indexed in this run, then clears the URL's previous chunks and inserts.
  - `indexDataBulk(bundle, documents)`: Indexes sequentially and returns success and failure counts. Sequential on purpose, since each document clears its own previous chunks and concurrent deletes against one collection can race.

## Conversation storage

- `database/mongodb/mongodb.ts`: `connectMongoDB()`. Registers the connection event listeners, then connects. Listeners are attached first so the initial `connected` event is not missed. Mongoose is reached through its default import because Bun does not expose `connection` as a named export.
- `database/mongodb/schemas/conversationSchema.ts`: The `conversations` model. One row per chat with `chatID` (unique), `title`, `messageCount`, and `lastMessageAt`. Indexed on `lastMessageAt` descending for the picker.
- `database/mongodb/schemas/messageSchema.ts`: The `messages` model. One row per message with `chatID`, `role`, `content`, and the turn's search metadata. Compound index on `chatID` and `createdAt`, which is how history is read.
- `database/mongodb/conversations.ts`:
  - `createConversation()`: Generates a UUID, registers it, and returns the chat ID.
  - `listConversations(limit?)`: Recent conversations first. Conversations with no messages are filtered out.
  - `loadHistory(chatID)`: The most recent `max_replayed_messages` messages of a chat, in chronological order, shaped for the chat engine.
  - `saveMessage(record)`: Writes one message, then updates its conversation's counters. The first user message also sets the conversation title.

## Utilities and types

- `utils/debug.ts`: Step logging for the whole workflow, switched on with `DEBUG_MODE`.
  - `debugEnabled`: read once at startup. Every function here returns immediately when it is off, so the normal path pays nothing.
  - `debugTurn(label)`: starts a timed section and resets the step clock.
  - `debugStep(step, detail?)`: one step, timed from the previous one. Detail values are rendered as `key=value`, with long strings and arrays truncated.
  - `debugTurnEnd()`: closes a section with its total wall time.
- `utils/readline.ts`: `input(prompt)` resolves with one line of terminal input, or with an empty string once input has ended. End of input is Ctrl+D, or a piped stream running out. Asking a closed interface for another line throws `ERR_USE_AFTER_CLOSE`, so this used to end in a stack trace. Callers already treat an empty line as "stop", so end of input now follows the same path. `closeInput()` closes the interface on exit. `loader()` starts a spinner and `stopLoader(handle)` clears it. Both are no-ops when output is not a TTY, since `clearLine` does not exist on a piped stream. The spinner runs only around the model call, because search and indexing print progress of their own and the two used to overwrite each other.
- `utils/returnCreator.ts`: `returnCreator(error, data?)` builds the result union. Overloaded so a success carries a typed payload and a failure carries none.
- `types/types.ts`:
  - `FunctionResponse<T>`, `Success<T>`, `Failure`: the result union described at the top.
  - `RawData`: `{ url, data }` produced by the page scraper.
  - `SearchPlan`: `{ needsSearch, queries }` returned by the planner.
  - `IndexingSummary`: `{ successes, failures }` returned by bulk indexing.
  - `PromptType`, `ReplaceObject`: prompt selection and substitution.
  - `MessageRole`, `MessageRecord`, `ChatHistoryMessage`, `ConversationSummary`: conversation storage.

## Notes

- Conversation messages are never written to Chroma. See `docs/overview.md` for the reasoning.
- The codebase is intentionally minimal. Expect to harden error handling further and add authentication before any production use.
