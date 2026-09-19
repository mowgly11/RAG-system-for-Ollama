# Roadmap

Where this project is going, what the finished thing looks like, and the point
at which we can call it done.

This is a direction document, not a schedule. It records the goal so it does
not get lost, and it names what actually stands in the way of each part.

## The goal

A search-augmented RAG **pipeline**, not a terminal program. Something that:

- Answers a question by reaching the live web when the question needs it, and
  by staying local when it does not.
- Runs against **any Ollama model**. Swap the answering model, the planner, or
  the embedder in `.env`, restart, and it works. No code change, no manual
  surgery on the vector store.
- Can be **integrated** by something other than a person at a terminal. Today
  the only caller is the readline loop in `index.ts`. In the end state the
  pipeline is a unit that anything can call.
- Exposes an **HTTP API**, so another service, another app, or another user can
  ask a question and get the answer with its sources.
- **Streams** its results, so a caller sees progress instead of a blank wait.

Everything here is built on the current design. Chroma for page vectors,
MongoDB for conversations, a real Chrome for scraping, Ollama for the models.
Nothing below requires replacing any of those.

## Where this is today

The turn logic works. A question is classified, searched, scraped, filtered,
indexed and answered, and the result is stored with its provenance. That is the
hard half and it exists.

What does not exist yet is any way to call it that is not a person typing.
`main()` in `index.ts` owns the readline loop, the conversation picker, the
turn loop, the chat engine construction and the printing, all in one function.
There is no seam to call.

See `docs/overview.md` for the current flow and its limitations, and
`docs/setup.md` for what the test suite does and does not verify.

## The end state, part by part

### 1. The pipeline as a callable unit

The single most important change, because everything else depends on it.

Extract the body of the turn loop into one function, roughly:

```ts
answerQuestion(chatID: string, question: string): Promise<FunctionResponse<TurnResult>>
```

returning the answer, the sources that grounded it, and what the planner
decided. `index.ts` becomes a thin terminal client over that function. The API
becomes a second client over the same function. Neither knows about the other.

Until this exists, an API means duplicating the turn logic, and two copies of
it will drift.

### 2. Any Ollama model

Three env variables already select the models, and all three clients already
respect `OLLAMA_HOST`. The remaining work is the things that silently break
when a model actually changes:

- **The embedding dimension.** A Chroma collection is built around the vector
  size of whatever embedded into it. Point `EMBEDDING_MODEL` at a model with a
  different dimension and the existing collection is wrong. The fix is to
  derive the collection name from the embedding model, so each model gets its
  own collection and switching back and forth is free.
- **The context window.** `context_window_size` in `config.json` is one number
  applied to whichever model is loaded. A model with a smaller window will be
  overfed. Read the real window from Ollama at startup, or at minimum refuse to
  start when the configured value exceeds what the model reports.
- **Structured output.** The planner and the relevance judge both rely on the
  model honouring a JSON schema. Small models vary in how well they do this.
  Both paths already fail safe, but neither has been measured across models.

Done means: change one line in `.env`, restart, and the pipeline works or tells
you clearly why it cannot.

### 3. The web connection and advanced search

The web connection works today: DuckDuckGo's HTML endpoint, result filtering
before anything is fetched, real Chrome for the pages.

"Advanced search" is the vaguest item here and needs pinning down. The
candidates, roughly in order of value:

- **Turn-scoped retrieval.** Freshly indexed pages currently compete with
  everything indexed before, which widening `similarity_topk_after_search` only
  partly offsets. The installed llamaindex retriever accepts
  `preFilters?: MetadataFilters`, so filtering to the current turn's URLs needs
  no new dependency. This is the highest-value item on the list and it is
  already a known gap.
- **Follow-up search.** One round of search per question today. Letting the
  model say "this did not answer it, search for X instead" is the difference
  between a lookup and research.
- **More than one engine.** DuckDuckGo is a single point of failure and a
  single set of blind spots.
- **Reranking** retrieved chunks before they reach the answering model.

Pick which of these "advanced" means before building any of it.

### 4. The API

A single HTTP service over `answerQuestion`. Bun has a built-in server, so this
needs no new dependency.

Minimum surface:

- `POST /ask` with a question and an optional chat ID. Returns the answer, the
  sources, and the chat ID to continue with.
- `GET /conversations` and `GET /conversations/:id` for history.

What the API forces us to deal with, none of which matters in a single-user
terminal:

- **Concurrency.** `withBrowser` opens a Chrome per call. Two simultaneous
  requests means two Chromes, ten means ten. This needs a queue or a pooled
  browser with a hard ceiling.
- **Indexing races.** `indexDataBulk` is sequential on purpose, because each
  document clears its own previous chunks and concurrent deletes against one
  collection can race. Two requests indexing at once reintroduce exactly that.
- **Identity.** Conversations are global today. There is no user concept, so
  every chat is visible to every caller. An API makes that a real problem
  rather than a note in the docs.
- **Abuse.** An open endpoint that scrapes the web on demand is an open proxy
  for scraping the web. Rate limiting is not optional here.

### 5. Streaming

Wanted as a feature, and worth being precise about what should stream.

The chat engine in the installed version accepts `stream: true`, so token
streaming is available without changing libraries.

But token streaming alone solves the smaller half of the problem. In the
recorded debug trace, a searching turn took about 14 seconds, of which the
answer itself was roughly 2. The other 12 were the planner, the search and the
scraping. Streaming only the tokens leaves the caller staring at nothing for
most of the wait.

So the target is an **event stream**, not just a token stream. Server-sent
events over the same endpoint, emitting the stages the debug tracer already
knows about:

```
event: decision   { needsSearch: true, queries: [...] }
event: searching  { queries: 3 }
event: page       { url, kept: true }
event: indexed    { count: 2 }
event: token      { text: "It" }
event: done       { sources: [...] }
```

`utils/debug.ts` already instruments every one of these points. The work is
routing those events to a caller instead of only to stdout.

## Definition of done

The project is finished, and worth announcing, when all of the following are
true. Each one is checkable rather than a matter of opinion.

**The pipeline**

1. `answerQuestion` exists as a single callable unit, and `index.ts` is a thin
   client over it.
2. Two clients exist, the terminal and the API, sharing that one
   implementation with no duplicated turn logic.

**Model agnosticism**

3. Changing `LLM`, `QUERY_MODEL` or `EMBEDDING_MODEL` in `.env` requires no
   code change and no manual collection surgery.
4. Changing the embedding model does not corrupt or silently misuse an existing
   collection.
5. A model whose context window is smaller than `context_window_size` is
   detected at startup rather than overfed.

**The API**

6. `POST /ask` answers a question end to end and returns the answer with its
   sources.
7. Concurrent requests are safe: bounded Chrome instances, no racing writes to
   the collection.
8. There is rate limiting, and some notion of who is asking.

**Streaming**

9. A caller receives stage events during the slow part of a turn, not only
   tokens at the end.
10. The terminal client uses the same event stream, so the two cannot drift.

**Trustworthiness**

11. Chroma has test coverage, including that re-indexing a URL replaces its
    chunks rather than duplicating them. `tests/chroma.test.ts` asserts that
    now, but it skips unless a Chroma server and Ollama are both up, and it has
    not yet been run against either. The item is done when it has.
12. MongoDB and `answerQuestion` have test coverage.
13. The relevance gate has been run against a real model and
    `bun run test:consistency` reports numbers we are willing to stand behind.
14. `README.md`, `docs/` and `CHANGELOG.md` describe what the code actually
    does, including what it does not cover.

Items 11 through 13 are the ones most likely to be skipped under momentum, and
they are the ones that decide whether anyone else can trust this pipeline
enough to integrate with it.

## Order of work

The dependencies are real, so the order is not arbitrary.

1. **Extract `answerQuestion`.** Everything else is blocked on it.
2. **Cover the storage layer with tests.** Before building on top of a half
   that has never been verified.
3. **Turn-scoped retrieval.** The one search improvement that is already a
   known defect rather than a new feature.
4. **The API, without streaming.** Get concurrency and browser pooling right
   while the surface is still small.
5. **Streaming, as events first and tokens second.**
6. **Model agnosticism hardening.** Can happen in parallel with any of the
   above; it is independent.
7. **Whatever "advanced search" turns out to mean**, once it is decided.

## Non-goals

Recorded so they do not get picked up by accident.

- Cloud or hosted models. This stays local against Ollama.
- A web UI. The API is the interface; a UI is someone else's project.
- Replacing Chroma or MongoDB. Each is doing the job it is good at, and
  `docs/overview.md` explains why they are separate.
- Multi-tenancy beyond knowing who is calling. Identity is needed so callers do
  not read each other's chats, not so this becomes a SaaS.
