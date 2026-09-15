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
4. **Search decision.** `classifyQuestion` in `prompt/triggers.ts` scores the question against weighted signals and returns one of three outcomes. `force` searches without asking. `skip` answers from knowledge without calling the planner at all. `ask` hands the decision to the `QUERY_MODEL`, which must return JSON matching `{ needsSearch: boolean, queries: string[] }`, enforced through a JSON schema derived from a `zod` definition.
5. **Web search.** One browser is opened for the whole turn. `executeSeachQueries` in `scraper/searchQueryScraper.ts` loads the DuckDuckGo HTML endpoint for each query, pausing `search_request_delay_ms` between queries, and reads the result rows inside the page. Results are filtered before they cost anything: unreadable document types, hosts in `skip_domains`, and more than `max_results_per_domain` from one site are all dropped. The turn stops at `max_pages_per_turn` URLs.
6. **Page scraping.** `getDataFromURLs` in `scraper/dataScraper.ts` visits those links `scraper_concurrency` at a time on the same browser. Each response is checked before it is read: an HTTP error status or a non-HTML content type ends that page there. Text is then extracted inside the page, picking the container that holds the most prose relative to its link text rather than taking the whole body. Pages that are too short, mostly links, an error page, or a sign-in wall are dropped. The browser is always closed, including when a page throws.
7. **Indexing.** Each page becomes a `Document` whose id is the normalized URL (hash removed, `utm_*` parameters removed, trailing slash removed). Before inserting, every chunk previously stored for that URL is deleted from the collection, so re-scraping replaces a page rather than adding a second copy of it.
8. **Answering and saving.** The user message is written to MongoDB before the model runs, so a question survives a failed reply. The chat engine is built for the turn, retrieving `similarity_topk_after_search` chunks when pages were just indexed and `similarity_topk` otherwise. The reply is printed and saved with the URLs that were indexed for that turn.

If the planner decides no search is needed, steps 5 to 7 are skipped and the question is answered from whatever is already in the index plus model knowledge.

## What is stored per turn

Each message row carries the chat ID it belongs to, its role, its text, and the search metadata for that turn. The planner's decision and the queries it generated are stored on the user message. The URLs that grounded the answer are stored on the assistant message. That gives provenance for any answer and a record of when the planner chose to search.

## Tracing a question

Set `DEBUG_MODE=true` to print every step of the flow above with the time it took, from the question being read to the answer coming back. The planner, both scrapers, the indexer, the conversation store, and the main loop all report into it. See `docs/setup.md` for sample output.

## Current limitations

- The browser runs headed by default, because `puppeteer-real-browser` evades bot checks better that way. Set `headless_browser` to `true` to hide it, at the cost of being blocked more often.
- Blocked-page and error-page detection are heuristics over known phrases plus the HTTP status. A wall or an error worded unusually, and served as HTTP 200, can still get through.
- Main content extraction scores containers by text against link density. It suits articles and documentation. A page whose value is a table or a list of links will score badly and may be dropped.
- A client rendered page is given `content_settle_ms` to put text on screen. A site slower than that still yields nothing.
- Only the ten most recent conversations are offered at startup. There is no search over past chats and no way to resume one by typing its chat ID.
- Conversations are global. There is no user or account concept, so every chat in the database is offered to whoever runs the app.
- Retrieval is never scoped to the current turn. Freshly indexed pages compete with everything indexed before, which widening the retrieval count after a search only partly offsets.
- The chat loop is capped at 999 turns as a guard against runaway loops.
- Individual page failures are logged and skipped. A planner or model failure skips the turn rather than ending the session.
- Questions must be typed interactively. Piping a script of questions into the process does not work, because the readline interface drops lines that arrive while no prompt is pending. Reaching end of input exits cleanly rather than failing.

See `docs/setup.md` to run it and `docs/components.md` for a file-by-file reference.
