# Overview

This repository is a search-augmented Retrieval-Augmented Generation (RAG) prototype. It runs entirely against local services: Ollama for the language and embedding models, a Chroma server for vectors, and MongoDB for conversation history.

## Goals

- Demonstrate an end-to-end loop: question, search planning, web scraping, indexing, and answering, using only local models.
- Keep the code small enough to read in one sitting and easy to extend.
- Keep behaviour configurable through prompt templates, `config.json`, and environment variables rather than code edits.

## Two stores, two jobs

The project uses both databases on purpose, and they hold different things.

- **Chroma** holds scraped web page text as embeddings. It answers "which passages resemble this question".
- **MongoDB** holds conversations. It answers "replay this chat in order". That is a keyed, time-sorted lookup, which a vector store does not do well.

Conversation messages are deliberately never written into the Chroma collection. The chat engine retrieves from that collection on every question, so storing replies there would feed the model its own earlier output back as if it were a source.

## Request flow

Every session goes through the following steps in `index.ts`.

1. **Startup.** The app connects to MongoDB, then opens the Chroma collection named by `VECTOR_STORE_COLLECTION_NAME`. The collection is touched during startup so an unreachable Chroma fails immediately with a clear message.
2. **Conversation choice.** Recent conversations are listed with their title, message count, and last activity. Entering a number continues that chat. Pressing Enter starts a new one and registers a fresh chat ID. When no conversations exist yet, a new one starts without a prompt.
3. **History replay.** The most recent messages of the chosen chat are loaded in order, up to `max_replayed_messages`, and given to the chat engine as its prior history. The cap keeps a long chat from overflowing `context_window_size`.
4. **Search planning.** `toSearchQuery` in `prompt/prompt.ts` sends the question to the small `QUERY_MODEL`. The model must return JSON matching `{ needsSearch: boolean, queries: string[] }`, enforced through a JSON schema derived from a `zod` definition. If the question contains a trigger word such as "latest", "today", "price", or "news", the `force_query` prompt is used instead and search is always performed. Triggers match whole words only.
5. **Web search.** One browser is opened for the whole turn. `executeSeachQueries` in `scraper/searchQueryScraper.ts` loads the DuckDuckGo HTML endpoint for each query, pausing `search_request_delay_ms` between queries, and collects up to `search_results_per_query` links from each. The turn stops collecting at `max_pages_per_turn` URLs.
6. **Page scraping.** `getDataFromURLs` in `scraper/dataScraper.ts` visits those links `scraper_concurrency` at a time on the same browser. Scripts, styles, navigation, and forms are stripped, links are unwrapped into their text, and the result is capped at `max_page_characters`. Pages below `min_page_characters`, and pages that served a sign-in or bot check, are dropped. The browser is always closed, including when a page throws.
7. **Indexing.** Each page becomes a `Document` whose id is the normalized URL (hash removed, `utm_*` parameters removed, trailing slash removed). Before inserting, every chunk previously stored for that URL is deleted from the collection, so re-scraping replaces a page rather than adding a second copy of it.
8. **Answering and saving.** The user message is written to MongoDB before the model runs, so a question survives a failed reply. The chat engine is built for the turn, retrieving `similarity_topk_after_search` chunks when pages were just indexed and `similarity_topk` otherwise. The reply is printed and saved with the URLs that were indexed for that turn.

If the planner decides no search is needed, steps 5 to 7 are skipped and the question is answered from whatever is already in the index plus model knowledge.

## What is stored per turn

Each message row carries the chat ID it belongs to, its role, its text, and the search metadata for that turn. The planner's decision and the queries it generated are stored on the user message. The URLs that grounded the answer are stored on the assistant message. That gives provenance for any answer and a record of when the planner chose to search.

## Current limitations

- The browser runs headed by default, because `puppeteer-real-browser` evades bot checks better that way. Set `headless_browser` to `true` to hide it, at the cost of being blocked more often.
- Blocked-page detection is a heuristic over known sign-in and bot-check phrases. A wall worded differently will still be indexed.
- Only the ten most recent conversations are offered at startup. There is no search over past chats and no way to resume one by typing its chat ID.
- Conversations are global. There is no user or account concept, so every chat in the database is offered to whoever runs the app.
- Retrieval is never scoped to the current turn. Freshly indexed pages compete with everything indexed before, which widening the retrieval count after a search only partly offsets.
- The chat loop is capped at 999 turns as a guard against runaway loops.
- Individual page failures are logged and skipped. A planner or model failure skips the turn rather than ending the session.

See `docs/setup.md` to run it and `docs/components.md` for a file-by-file reference.
