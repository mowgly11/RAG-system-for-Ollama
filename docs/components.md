# Components

- `index.ts`: Application entry point. Wires up `llamaindex` settings with Ollama embedding and LLM clients, creates the chat engine with system prompts, and opens a chat-style query loop against the index.
- `scraper/scraper.ts`: Uses `puppeteer-real-browser` and `cheerio` to load a web page and extract paragraph text. Returns a concatenated string of `<p>` text nodes.
- `database/indexer.ts`: Converts plain text into `Document` objects and builds a `VectorStoreIndex` using the provided `storageContext` from `database/chroma.ts`.
- `database/chroma.ts`: Creates a `ChromaVectorStore` collection and builds a `storageContext` via `storageContextFromDefaults` for `llamaindex`.
- `prompt/prompt.ts`: Manages prompt templates with dynamic replacement. Loads prompt files from `prompt/prompts/` directory and supports term substitution via `ReplaceObject` interface.
- `prompt/prompts/system.txt`: System prompt template loaded by the chat engine to control LLM behavior.
- `utils/readline.ts`: Small helper to collect user input from the terminal (used by `index.ts`).
- `types/types.ts`: Type definitions used across the project (for example the `DataFromURL` shape returned by the scraper, `PromptType` for prompt templates, and `ReplaceObject` for prompt substitution).
- `env.ts`: Contains environment validation using `zod` with defaults for `LLM`, `EMBEDDING_MODEL`, and `OLLAMA_HOST`.

Notes
- The codebase is intentionally minimal to illustrate the flow. Expect to adapt or harden pieces before production use: error handling, rate limits, authentication, and storage configuration.
