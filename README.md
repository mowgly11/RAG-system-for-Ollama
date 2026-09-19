# Search-augmented RAG for Ollama

A small Retrieval-Augmented Generation (RAG) prototype built with Bun, `llamaindex`, Ollama, and a Chroma vector store.

For each question typed at the terminal, a lightweight planner model decides whether a web search is needed. If so, the app searches DuckDuckGo, scrapes the result pages with a real Chrome browser, indexes the text into Chroma, and then answers the question with the main LLM using the indexed context.

Conversations are stored in MongoDB. On startup the app lists your recent chats and lets you pick one to continue, which reloads its full history into the model.

## Quick start

Prerequisites: Bun, a running Ollama server with the three models pulled, a running Chroma server, a running MongoDB instance, and Google Chrome. See `docs/setup.md` for the exact commands.

```bash
bun install
bun run start
```

Run the test suite:

```bash
bun test
```

The tests need Chrome, which the scraper already requires. A local server stands in for the web, so they need no network. The suite is deliberately small and covers the logic that fails silently: page triage, result filtering, scraping, the search decision, and the relevance gate failing open. It does not cover MongoDB, `index.ts`, or debug output. The Chroma and embedding tests only run when a Chroma server and Ollama are both up, and skip otherwise. See `docs/setup.md` for what a green run does and does not prove.

## Documentation

- Overview and request flow: `docs/overview.md`
- Setup, environment variables, and configuration: `docs/setup.md`
- Component reference: `docs/components.md`
- Where this is going and what "done" means: `docs/roadmap.md`
- History: `CHANGELOG.md`

## Project structure

- `index.ts`: entry point and chat loop
- `config.json`: tunable settings for the models, retrieval, and the scraper
- `env.ts`: environment variable validation with `zod`
- `prompt/`: prompt loader, search planner, and the prompt templates in `prompt/prompts/`
- `scraper/`: Chrome-based scraper, DuckDuckGo search scraper, and page text extractor
- `database/chroma/`: Chroma storage context and document indexer
- `database/mongodb/`: MongoDB connection, conversation store, and the two schemas
- `types/`: shared TypeScript types
- `utils/`: terminal input, loading spinner, debug logging, and the result helper
- `tests/`: unit tests per workflow step, plus an end-to-end run against deliberately hostile pages

This project was bootstrapped with `bun init`.
