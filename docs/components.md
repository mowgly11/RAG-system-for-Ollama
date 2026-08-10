# Components

- `index.ts`: Application entrypoint. Wires up `llamaindex` settings, creates embedding and LLM clients, runs the scraper, indexes the scraped content, and opens a chat-style query against the index.
- `scraper/scraper.ts`: Uses `puppeteer-real-browser` and `cheerio` to load a web page and extract paragraph text. Returns a concatenated string of `<p>` text nodes.
- `database/indexer.ts`: Converts plain text into `Document` objects and builds a `VectorStoreIndex` using the provided `storageContext` from `database/chroma.ts`.
- `database/chroma.ts`: Creates a `ChromaVectorStore` collection and builds a `storageContext` via `storageContextFromDefaults` for `llamaindex`.
- `utils/readline.ts`: Small helper to collect user input from the terminal (used by `index.ts`).
- `types/types.ts`: Type definitions used across the project (for example the `DataFromURL` shape returned by the scraper).
- `env.ts`: Contains environment validation using `zod` with defaults for `LLM`, `EMBEDDING_MODEL`, and `OLLAMA_HOST`.

Notes
- The codebase is intentionally minimal to illustrate the flow. Expect to adapt or harden pieces before production use: error handling, rate limits, authentication, and storage configuration.
