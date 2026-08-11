# Overview

This repository implements a small Retrieval-Augmented Generation (RAG) prototype using `llamaindex`, `@llamaindex/ollama`, and a Chroma vector store. The project scrapes web pages, converts text to documents, indexes them, and exposes a simple chat-style query flow with customizable prompts.

Main goals
- Demonstrate end-to-end scraping -> indexing -> query using local LLMs and embeddings
- Provide a minimal, easy-to-run example you can extend
- Support flexible prompt management for system and query customization

Quick summary
- Scrape a URL with `scraper.ts`
- Convert scraped text to `Document` objects and build an index with `indexer.ts`
- Persist vectors using the Chroma vector store in `chroma.ts`
- Manage prompts with `prompt/prompt.ts` for customizable system behavior
- Query the index from `index.ts`, the entry point which wires up `llamaindex` and `ollama` with system prompts

See the docs folder for setup and component details.
