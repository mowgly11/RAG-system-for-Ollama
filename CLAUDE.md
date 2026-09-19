# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install
bun run start            # interactive chat loop (index.ts)
bun test                 # full suite, --timeout 30000 is required, not optional
bun test tests/triggers.test.ts        # one file
bun test -t "fails open"               # one test by name
bun run test:consistency # opt in, needs Ollama, takes minutes
DEBUG_MODE=true bun run start          # per-step trace with timings
```

There is no build, lint, or typecheck script. Bun runs the TypeScript directly and
`tsconfig.json` is `noEmit`. Use `bunx tsc --noEmit` if you want a type check.

`bun test` needs Google Chrome, which the scraper already requires. A local HTTP server
in `tests/fixtures.ts` stands in for the web, so the suite is offline and deterministic.
The service probes are `ollamaUp` and `chromaUp` in `tests/fixtures.ts`. Every test that
needs a live model or a live Chroma server skips itself when it is down. Do not make
them fail instead.

With Chroma and Ollama both down, a full run is **213 pass, 17 skip, 0 fail, about 80
seconds**. Nearly all of that time is real Chrome navigation, so trimming unit tests
does not speed it up.

### What the suite covers, and what it does not

The suite is deliberately small. The rule is: **test the logic that fails silently.**
A bad page reaching the index, a result URL unwrapped wrong, a source deleted by a
confused judge. Those are invisible until answers quietly get worse.

Covered: `judgePage` triage, search result filtering, scraping in real Chrome (status
codes, content types, client-render waits), `classifyQuestion`, document identity, the
relevance gate failing open, and the whole chain end to end against hostile fixtures.

**Not covered. A green run says nothing about any of these:**

- **Chroma, unless a server is up.** `tests/chroma.test.ts` covers `createVectorStore`,
  `createIndex`, `indexData`, `indexDataBulk` and the delete-by-URL that `indexData`
  relies on, but it needs both a Chroma server and Ollama and skips entirely without
  them. Offline, only its two "Chroma unreachable" cases run.
- **MongoDB.** No test contacts it. The conversation store is exercised only by running
  the app.
- **The live model paths.** Three tests in `tests/workflow.test.ts` need Ollama. With
  Ollama down they skip and a fourth runs in their place asserting the gate fails open,
  so the suite is at its greenest when no model is reachable.
- **`index.ts`.** The chat loop, `pickConversation`, `gatherSources`, `toText` and
  history capping.
- **`utils/debug.ts`.** Print formatting; a wrong line is visible the moment you read it.

Do not add tests that restate the type system, assert the shape of a log line, or
re-check a one-line pure function from six angles. That kind of test was removed once
already. If a test cannot fail for a reason that would reach a user, it is not worth
its maintenance.

## Running services

The app needs four things up: Ollama (three models: `LLM`, `QUERY_MODEL`,
`EMBEDDING_MODEL`), a Chroma **server** (`chroma run --path .chroma`, the JS client
cannot talk to a file), MongoDB, and Chrome. Exact commands are in `docs/setup.md`.

## Architecture

A question goes through: search decision, web search, scrape, index, answer. All of it
is orchestrated in `index.ts`; the rest of the repo is the steps.

1. `prompt/triggers.ts` `classifyQuestion` scores the question against weighted signals
   and returns `force`, `skip`, or `ask`, **before** any model runs. `skip` answers
   without calling the planner at all, which is the single slowest step in a turn.
2. `prompt/prompt.ts` `toSearchQuery` calls `QUERY_MODEL` with a JSON schema derived
   from a `zod` definition and returns `{ needsSearch, queries }`.
3. `scraper/searchQueryScraper.ts` reads the DuckDuckGo HTML endpoint and filters
   results (document type, `skip_domains`, per-domain cap) before anything is fetched.
4. `scraper/dataScraper.ts` fetches pages `scraper_concurrency` at a time.
   `scraper/extract.ts` runs extraction and triage inside the browser.
5. `prompt/relevance.ts` is the last gate. `database/chroma/indexer.ts` indexes what
   survives.
6. The chat engine is rebuilt every turn so retrieval can widen to
   `similarity_topk_after_search` when fresh pages were just indexed.

### Two stores, two jobs

**Chroma** holds scraped page text as embeddings. **MongoDB** holds conversations.
Conversation messages are never written to Chroma: the chat engine retrieves from that
collection on every question, so storing replies there feeds the model its own output
back as if it were a source. Keep that separation.

### The four page filters, cheapest first

Element removal, then line-level boilerplate filtering, then `judgePage` triage
(length, link density, HTTP status, phrasing), then the relevance gate. The ordering is
deliberate: the only expensive check is reached rarely.

Two rules hold that design together, and both have tests:

- **Structure outranks wording.** A page built like an article (four paragraphs, or two
  headings, or a code snippet plus paragraphs) is never rejected on phrasing. Wording is
  the one thing a page controls freely, so it is the weakest evidence available. This is
  what keeps "403 Forbidden: 9 Ways to Fix It" indexable.
- **Position matters.** Error and wall phrases only count near the top, because an error
  page leads with its phrase and an article reaches it partway down.

### Fail open wherever a model decides

`shouldKeep` in `prompt/relevance.ts` keeps the page on a timeout, an unreachable model,
or an unparseable answer. A page dropped by the gate is gone without the asker ever
learning why, so an uncertain judge must not delete sources.

Scraped page text always travels to the judge as delimited user content, never spliced
into the instructions. Scraped text is exactly where an instruction aimed at the judge
would arrive.

## Conventions

- **Every fallible function returns `FunctionResponse<T>`** built with
  `utils/returnCreator.ts`. Check `ok` to narrow `data`. Do not throw across module
  boundaries and do not return bare values from anything that can fail.
- **Tunables go in `config.json`**, hosts and secrets in `.env` via `env.ts` (`zod`
  validated). Do not hardcode either.
- **Prompts go in `prompt/prompts/*.txt`**, loaded by name through `getPrompt`, so they
  can be edited without touching code.
- Use `z.stringbool()` for env booleans. `z.coerce.boolean()` reads the string `"false"`
  as `true`.
- All three Ollama clients (embedding, answering, planner) must point at `OLLAMA_HOST`.
  The planner builds its own client for this reason.
- The `*InPage` functions in `scraper/extract.ts` are serialised and run in the browser.
  They must be self contained, and everything they need arrives as an argument.
- `puppeteer-real-browser` bundles its own puppeteer, whose types differ from the
  top-level `puppeteer` package. Use `ScraperBrowser` and `ScraperPage` from
  `scraper/scraper.ts`, derived from what `connect()` returns.
- Reach mongoose's `connection` off the default import. Bun does not resolve it as a
  named export.
- Scraping in a turn goes through one `withBrowser` call, which always closes the
  browser in a `finally`. Do not open a second browser per turn.

## Things already tried that did not work

- **Resource blocking for speed.** Measured at 4641ms vs 4663ms mean over six pages,
  well inside run-to-run variance. Kept behind `block_page_resources`, defaulted off.
- **Sharing one browser page across tests.** Lost 37 of 45 tests in one run out of
  three. Use a fresh page per test.
- **Regex over whole page text to strip login content.** It shreds real prose, since an
  article about authentication uses the same words. Removal is by DOM selector; regex
  only ever matches a whole line of interface chrome.
- **Broad attribute selectors** such as `[class*="cookie"]` or `[class*="modal"]`. Too
  greedy. `NOISE_SELECTOR` is deliberately narrow.
- **Bash heredocs for writing code containing escapes or regexes.** They mangle
  backslashes in this environment. Use the Write or Edit tools.

## Documentation

`README.md`, `docs/overview.md`, `docs/setup.md`, `docs/components.md`, and
`CHANGELOG.md` are kept current with the code and are updated in the same turn as a
change. `docs/setup.md` documents every `.env` variable and every `config.json` key.
`HANDOFF.md` carries the current state and next steps; refresh it when the picture
changes. `docs/roadmap.md` holds the target architecture and the definition of done;
update it when scope or priorities move, not on every change.

Known gaps are recorded in `docs/overview.md` and `HANDOFF.md` rather than left implicit.
The largest one: the live relevance gate has never been exercised against a real model,
because Ollama was down throughout its development.
