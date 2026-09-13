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

## Documentation

- Overview and request flow: `docs/overview.md`
- Setup, environment variables, and configuration: `docs/setup.md`
- Component reference: `docs/components.md`
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
- `utils/`: terminal input, loading spinner, and the `{ error, data }` result helper

This project was bootstrapped with `bun init`.
