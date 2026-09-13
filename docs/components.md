# Components

All functions that can fail return a `FunctionResponse` of shape `{ error: string | null, data: any }`, built with `utils/returnCreator.ts`. Callers check `error` before using `data`.

## Entry point

- `index.ts`: Configures `llamaindex` `Settings` with the Ollama embedding model and the answering LLM (temperature and `num_ctx` from `config.json`). On start it connects to MongoDB, opens the Chroma index, and builds a chat engine with the system prompt and `similarity_topk`. The main loop reads a question, runs the search planner, performs search and indexing when required, then prints the chat engine's answer. A spinner runs while a question is being processed.

## Configuration

- `env.ts`: Validates `process.env` with `zod` and exports `env`. Defines defaults for `LLM`, `QUERY_MODEL`, `EMBEDDING_MODEL`, `OLLAMA_HOST`, `VECTOR_STORE_COLLECTION_NAME`, `TOR_PROXY_URL`, and `MONGODB_CONNECT`.
- `config.json`: Tunable runtime values imported by `index.ts`, `prompt/prompt.ts`, and `scraper/scraper.ts`. See `docs/setup.md` for each key.

## Prompts and search planning

- `prompt/prompt.ts`:
  - `getPrompt(type, replace?)`: Reads `prompt/prompts/<type>.txt` and applies optional term substitutions from a `ReplaceObject[]`.
  - `toSearchQuery(message)`: The search planner. Picks `force_query` when the message contains a word from the `SEARCH_TRIGGERS` list, otherwise `query`. Calls `QUERY_MODEL` through the `ollama` client with a JSON schema generated from the `SearchPlanSchema` `zod` definition, parses the reply, and returns `{ needsSearch, queries }` with queries capped at `QUERIES_HARD_LIMIT` (7).
  - `queryModel(...)`: Thin wrapper around `ollama.chat` that optionally enforces and parses the JSON schema.
- `prompt/prompts/system.txt`: System prompt for the answering chat engine.
- `prompt/prompts/query.txt`: Instructs the planner to decide whether search is needed and how many queries to produce (1 for simple lookups, up to 8 for complex research).
- `prompt/prompts/force_query.txt`: Same output format but `needsSearch` is always `true`.

## Scraping

- `scraper/scraper.ts`: `Scraper` class wrapping `puppeteer-real-browser`.
  - `openBrowser()`: Launches Chrome with `--no-sandbox`, Turnstile handling, a 1280x1024 viewport, and the Tor proxy when `tor_proxy_enabled` is set. Returns `{ browser, page }`.
  - `getHTMLcontent(url, page)`: Validates the URL scheme, navigates with `domcontentloaded`, and returns the body's inner HTML. Navigation failures and empty bodies are returned as errors rather than thrown.
- `scraper/searchQueryScraper.ts`: `executeSeachQueries(queries)`. Opens a browser, loads `https://duckduckgo.com/html/?q=<query>` for each query, extracts the first 3 `a.result__snippet` links, unwraps the DuckDuckGo redirect (`uddg` parameter), and returns a `Set` of unique URLs. Closes the browser when done.
- `scraper/dataScraper.ts`: `getDataFromURLs(urls)`. Opens a browser, fetches each URL, removes `script`, `style`, `noscript`, `iframe`, `svg`, `footer`, `nav`, `header`, `input`, `button`, `form`, `head`, and `a` elements with `cheerio`, collapses whitespace, and returns `RawData[]` (`{ url, data }`). Pages that fail are logged and skipped.

Both scrapers currently construct `new Scraper(false)`, so Chrome runs headed and a window is visible while they work.

## Storage and indexing

- `database/chroma/chroma.ts`: `createStorageContext()`. Creates a `ChromaVectorStore` for `VECTOR_STORE_COLLECTION_NAME` (connecting to the Chroma server at its default `http://localhost:8000`) and wraps it in a `llamaindex` storage context.
- `database/chroma/indexer.ts`:
  - `normalizeUrl(url)`: Strips the fragment, `utm_source`, `utm_medium`, `utm_campaign`, and a trailing slash so the same page always maps to one document id.
  - `toDocument(text, url)`: Builds a `Document` with the normalized URL as both `id_` and `metadata.url`.
  - `createIndex()`: Opens the Chroma-backed `VectorStoreIndex`.
  - `indexData(index, document)`: Skips the document if its hash matches the stored one, deletes the old version if the hash changed, then inserts.
  - `indexDataBulk(index, documents)`: Runs `indexData` for every document with `Promise.allSettled` and returns success and failure counts.
- `database/mongodb/mongodb.ts`: `connectMongoDB()`. Connects Mongoose to `MONGODB_CONNECT` and logs connection events.
- `database/mongodb/schemas/messageSchema.ts`: Placeholder `messages` model with an empty schema. Conversation persistence is not implemented yet.

## Utilities and types

- `utils/readline.ts`: `input(prompt)` returns a promise for one line of terminal input. `loader()` starts a spinner on stdout and returns its interval handle. `stopLoader(handle)` clears it and the line.
- `utils/returnCreator.ts`: `returnCreator(error, data?)` builds the `{ error, data }` result object used throughout the project.
- `types/types.ts`:
  - `FunctionResponse`: `{ error: string | null, data: any }`.
  - `RawData`: `{ url: string, data: string }` produced by the page scraper.
  - `PromptType`: `"system" | "query" | "force_query"`.
  - `ReplaceObject`: `{ term, replace }` pair for prompt substitution.
  - `DataFromURL`: legacy `{ error, data }` shape from the original single-URL scraper. No longer referenced.

## Notes

- `uuid` is listed in `package.json` but is not imported anywhere.
- The codebase is intentionally minimal. Expect to harden error handling, add rate limiting for scraping, and make headless mode configurable before any production use.
