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
  - `toSearchQuery(message)`: The search planner. Asks `classifyQuestion` first. A `skip` verdict returns "no search" without calling the model at all. Otherwise it calls `QUERY_MODEL` with a JSON schema generated from the `SearchPlanSchema` `zod` definition and returns `{ needsSearch, queries }`. A forced search that comes back with no queries falls back to the question itself, so it cannot silently skip searching.
  - `queryModel(...)`: Wraps the Ollama call. Separates three failure modes: the model being unreachable, a reply that is not JSON, and a reply that does not fit the schema. Each returns its own message rather than throwing.
- `prompt/triggers.ts`: `classifyQuestion(message)` decides whether the web is needed before the planner model is asked. It returns `force`, `skip`, or `ask`, along with the score and the signal groups that fired.
  - Pasted links are stripped before scoring. A slug is not the asker's wording, and hyphens are word boundaries, so a URL ending in "the-current-price" used to force a search on its own.
  - Signals are weighted, and phrases count for more than bare words. A flat word list over-fired, because one word is weak evidence. "live" appears in "how does live reload work", and "top" in "what is a top-level domain".
  - `skip` is the conservative case. It needs a definitional marker and no currency signal whatsoever. It is what lets an obviously static question avoid the slowest step in a turn.
- `prompt/prompts/system.txt`: System prompt for the answering chat engine.
- `prompt/prompts/query.txt`: Instructs the planner to decide whether search is needed and how many queries to produce.
- `prompt/prompts/force_query.txt`: Same output format but `needsSearch` is always `true`.

The planner uses its own Ollama client pointed at `OLLAMA_HOST`, rather than the library's default client.

## Scraping

- `scraper/scraper.ts`:
  - `Scraper.openBrowser()`: Launches Chrome with `--no-sandbox`, Turnstile handling, a 1280x1024 viewport, headless per `headless_browser`, and the Tor proxy when enabled.
  - `Scraper.openPage(url, page)`: Navigates and reports `{ status, contentType, finalUrl, settled }`. The response status used to be discarded, so a 404 or a 503 was scraped and indexed as if it were an article. An error status or a non-HTML content type ends the page here, before anything tries to read it.
  - `waitForContent(page, minChars, timeoutMs)`: Waits until the body actually has text. A server rendered page satisfies this at once. A client rendered page is empty at `DOMContentLoaded` and fills in later, which is why those used to be discarded as too short. `settled` reports whether the wait was met.
  - `describeNavigationError(err)`: Turns Chrome's `ERR_*` strings into something a reader can act on, such as "the domain does not resolve".
  - `preparePage(page)`: Sets the page timeout and, when `block_page_resources` is on, drops images, fonts, stylesheets and media before they are fetched. Best effort: if the driver already installed its own handler, scraping carries on unblocked.
  - `withBrowser(work)`: Opens a browser, runs `work` against it, and always closes it in a `finally`. Both scraping phases of a turn run inside one call, so a turn uses one browser instead of two and cannot leak a Chrome process when something throws.
  - `delay(ms)`: Small sleep helper used for pacing.
  - `ScraperBrowser` and `ScraperPage` are derived from what `connect()` returns. `puppeteer-real-browser` bundles its own puppeteer, whose types are not the same as the top-level `puppeteer` package.
- `scraper/extract.ts`: Content extraction and page triage. The `*InPage` functions run inside the browser, so they must be self contained. Puppeteer serialises them, and everything they need arrives as an argument.
  - `extractArticleInPage(options)`: Readability-style main content pick against the live DOM. Noise elements are removed, then candidate containers are scored by how much text they hold against how much of it is link text, with a bonus for `article` and `main` and for content-shaped class names, and a penalty for nav-shaped ones. Taking all of `body.innerText` drags in menus, cookie banners and related-article lists. It falls back to the body when no candidate holds enough of the page.
  - `extractSearchResultsInPage(limit)`: Pulls result rows out of the DuckDuckGo HTML endpoint, skipping sponsored rows, and reports whether the page was a challenge or had no results.
  - `judgePage(page, minCharacters)`: Decides whether an extracted page is worth indexing. Length alone is not enough, so the title and the leading text are checked for error and sign-in phrases, and a page that is mostly links is rejected. Two details keep real articles out of the net. The error-title pattern matches titles that are about an error rather than titles that merely contain the word, because "Error Handling in Rust" is a real article. And a marker only counts when it appears near the top, because an error page leads with that sentence while an article reaches it partway down.
  - `NOISE_SELECTOR`: The elements that never carry the text we want.
- `scraper/searchQueryScraper.ts`: `executeSeachQueries(session, queries)`. Loads the DuckDuckGo HTML endpoint for each query on one page, pacing requests by `search_request_delay_ms`, and returns the URLs worth fetching.
  - Asks for several times more results than it needs, so filtering has something to fall back on.
  - `rejectionReason(url, host, perDomain)`: Rejects a result before it costs a page load. Unreadable document types, hosts in `skip_domains`, and more than `max_results_per_domain` from one site are dropped here. Filtering at this point is far cheaper than fetching a sign-in wall and discarding it afterwards.
  - `unwrapResultURL(href)`: Reads the real target from the `uddg` query parameter using `URL`. String surgery on the href corrupts targets that contain encoded separators of their own.
  - Tries the lighter `html.duckduckgo.com` endpoint first and retries on the main host when that answers with a challenge or nothing.
- `scraper/dataScraper.ts`: `getDataFromURLs(session, urls)`. Fetches URLs `scraper_concurrency` at a time, one page per worker rather than one per URL, each closed when its worker is done.
  - Extraction runs inside the page rather than by shipping the whole body HTML out to a parser. That sees the DOM the site's JavaScript produced, and moves only the extracted text across the wire.
  - The page title is prepended to the text, since it names the page for the embedder.

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

## Tests

- `tests/fixtures.ts`: The local HTTP server that stands in for the web, plus the probes that let a suite skip when MongoDB, Chroma, or Ollama is not running. Its pages are deliberately hostile. See `docs/setup.md` for the list.
- `tests/*.test.ts`: One file per workflow step, plus `workflow.test.ts` for the whole chain under adversarial input.
- `tests/debugProbe.ts`: Run as a subprocess by the debug tests, because the debug flag is read once at import and a single process cannot observe it both ways.
- `unwrapResultURL`, `hostOf` and `rejectionReason` are exported from `scraper/searchQueryScraper.ts` so the filter rules can be tested directly. They are not used elsewhere in the app.

## Notes

- Conversation messages are never written to Chroma. See `docs/overview.md` for the reasoning.
- The codebase is intentionally minimal. Expect to harden error handling further and add authentication before any production use.
