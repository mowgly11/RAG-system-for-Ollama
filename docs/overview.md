# Overview

This repository is a search-augmented Retrieval-Augmented Generation (RAG) prototype. It runs entirely against local services: Ollama for the language and embedding models, a Chroma server for vectors, and MongoDB for (planned) conversation storage.

## Goals

- Demonstrate an end-to-end loop: question, search planning, web scraping, indexing, and answering, using only local models.
- Keep the code small enough to read in one sitting and easy to extend.
- Keep behaviour configurable through prompt templates, `config.json`, and environment variables rather than code edits.

## Request flow

Every question typed at the terminal goes through the following steps in `index.ts`.

1. **Startup.** The app connects to MongoDB, opens the Chroma collection named by `VECTOR_STORE_COLLECTION_NAME`, and builds a `llamaindex` chat engine on top of it. The chat engine uses the system prompt from `prompt/prompts/system.txt` and retrieves `similarity_topk` chunks per question.
2. **Search planning.** `toSearchQuery` in `prompt/prompt.ts` sends the question to the small `QUERY_MODEL`. The model must return JSON matching `{ needsSearch: boolean, queries: string[] }`, enforced through a JSON schema derived from a `zod` definition. If the question contains one of the hard-coded trigger words (for example "latest", "today", "price", "news"), the `force_query` prompt is used instead and search is always performed. Queries are capped at 7.
3. **Web search.** `executeSeachQueries` in `scraper/searchQueryScraper.ts` opens Chrome through `puppeteer-real-browser`, loads the DuckDuckGo HTML endpoint for each query, and collects the first 3 result links per query into a deduplicated set.
4. **Page scraping.** `getDataFromURLs` in `scraper/dataScraper.ts` visits each link, strips scripts, styles, navigation, forms, links, and similar noise with `cheerio`, and keeps the remaining body text.
5. **Indexing.** Each page becomes a `Document` whose id is the normalized URL (hash removed, `utm_*` parameters removed, trailing slash removed). `indexDataBulk` inserts new documents, replaces documents whose content hash changed, and skips unchanged ones.
6. **Answering.** The chat engine retrieves the most similar chunks from Chroma and asks the main `LLM` to answer. The reply is printed to the terminal.

If the planner decides no search is needed, steps 3 to 5 are skipped and the question is answered from whatever is already in the index plus model knowledge.

## Current limitations

- The browser runs in headed mode, so a Chrome window opens during search and scraping.
- MongoDB is connected at startup but nothing is written yet. The `messages` schema is empty and chat history is not persisted.
- The chat loop is capped at 999 turns as a guard against runaway loops.
- Errors from the planner abort the loop. Scraping errors for individual pages are logged and skipped.

See `docs/setup.md` to run it and `docs/components.md` for a file-by-file reference.
