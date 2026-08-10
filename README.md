# RAG system for ollama

Minimal Retrieval-Augmented Generation (RAG) prototype using `llamaindex`, Ollama embeddings, and a Chroma vector store.

Quick start

Install dependencies:

```bash
bun install
```

Run the example:

```bash
bun run start
```

Documentation

- Overview: docs/overview.md
- Setup and running: docs/setup.md
- Components: docs/components.md

Current structure

- `index.ts`
- `database/` for indexer and vector store setup
- `scraper/` for web scraping
- `utils/` for terminal input helpers
- `env.ts` for environment validation

This project was bootstrapped with `bun init`. See the `docs/` folder for more information and implementation notes.
