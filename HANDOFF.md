# Handoff

Written 2026-09-16. Read this before touching the scraping or search path.

## Goal

A local, search-augmented RAG assistant. You ask a question in the terminal. It
decides whether the answer needs the live web, searches DuckDuckGo if so,
scrapes the results, indexes them into Chroma, and answers with a local Ollama
model. Conversations persist in MongoDB and can be resumed.

Everything runs locally: Ollama for the models, a Chroma server for vectors,
MongoDB for chat history, and a real Chrome instance for scraping.

The work over the last few sessions has been about answer quality rather than
features: making sure what reaches the vector store is actually worth
retrieving, and that the system does not waste a slow model call on a question
it could have answered without one.

## Current progress

Committed through `b781776`. Roughly nineteen files are uncommitted, all of
them the content filtering and relevance gate work described below.

The full test suite passes: **213 pass, 17 skip, 0 fail**, about 80 seconds,
with Chroma and Ollama both down. The suite was cut down on 2026-09-18; see
"Trimming the suite" below. `tests/chroma.test.ts` was added afterwards and is
entirely skipped in that state: bring up `chroma run --path .chroma` and Ollama
to actually exercise the storage path.

```bash
bun test                 # the normal suite
bun run test:consistency # opt in, needs Ollama, takes minutes
```

### What exists now

**Search decision** (`prompt/triggers.ts`). Weighted signals decide `force`,
`skip`, or `ask` before the planner model is ever called. `skip` means a
plainly definitional question is answered without touching the web and without
paying for the planner, which is the slowest step in a turn at roughly eight
seconds.

**Scraping** (`scraper/`). One browser per turn, always closed. HTTP status and
content type are checked before anything reads the page. Client rendered pages
are waited for. Extraction runs inside the browser against the live DOM and
picks the container holding the most prose relative to its link text.

**Page triage** (`scraper/extract.ts`, `judgePage`). Four checks, cheapest
first: element removal, line-level boilerplate filtering, triage on length,
link density, status and phrasing, then the relevance gate.

**The relevance gate** (`prompt/relevance.ts`). `termOverlap` is free and
settles most pages. Below `relevance_overlap_threshold` the small model is
asked, seeing only the title and the first `relevance_sample_characters`. It
**fails open**: timeout, unreachable model, or unparseable answer all keep the
page.

**Conversations** (`database/mongodb/`). Chat IDs, a picker at startup, history
replay capped at `max_replayed_messages`.

**Debug mode**. `DEBUG_MODE=true` traces every step of a turn with timings.

## What worked

**Structure outranks wording.** The single most useful idea in the triage.
Wording is the only thing a page controls freely, so it is the weakest evidence
available. Counting paragraphs, headings and code blocks in the chosen
container separates a real troubleshooting article from the error it is about.
This is what lets a page titled "403 Forbidden: 9 Ways to Fix It" be indexed
while an actual 403 page is not.

**Position matters for phrase matching.** An error page or a wall leads with
its phrase. An article reaches it partway down. Checking only the first 500
characters stopped real articles being rejected for mentioning "access denied".

**Filtering search results before fetching them.** Rejecting a sign-in-wall
domain or a PDF at the results stage saves an entire page load. Verified live:
two LinkedIn results dropped without ever being requested.

**Deleting a URL's old chunks before re-indexing it.** The index's own document
store is in memory and empty on every run, so its hash check could never
recognise a page from a previous run. Measured before the fix: 63 chunks
stored, 43 distinct, 20 redundant.

**Failing open everywhere a model is involved.** A page dropped by a confused
judge is gone without the asker ever learning why.

**A local HTTP server as the web, for tests.** Deterministic, offline, and it
can serve deliberately hostile pages. This is why the suite is trustworthy.

**Running the app instead of only reading it.** Two real crashes were found
that way: a mongoose import that Bun does not support, and `ERR_USE_AFTER_CLOSE`
when input ended.

## What did not work

**Resource blocking.** Dropping images, fonts, stylesheets and media before
fetch was supposed to speed up scraping. Measured over a fixed six-page list:

| blocking on | 4641ms mean |
| --- | --- |
| blocking off | 4663ms mean |

Run-to-run variance spanned 3727ms to 5599ms, far wider than the difference.
Intercepting every request costs a round trip that cancels the bandwidth saved.
The code is kept behind `block_page_resources`, defaulted **off**. Do not turn
it on expecting speed. It is there for genuinely slow or metered connections.

**Sharing one browser page across tests.** Caused flakiness that lost 37 of 45
tests in one run out of three. A single navigation hitting Bun's default five
second timeout left the page mid-flight and poisoned every test after it. Fixed
with `--timeout 30000` and a fresh page per test. Do not reintroduce a shared
page to save time.

**Regex over the whole page text** for removing login content. Rejected during
design. It shreds real prose, because an article about authentication contains
the same words. Removal is done by DOM selector, and regex only ever matches a
whole line of interface chrome. There is a test that an article about session
cookies keeps its sentences.

**Broad attribute selectors** such as `[class*="cookie"]` or `[class*="modal"]`.
Too greedy. A recipe site has cookies and plenty of pages wrap an article in
something called a modal. The selectors in `NOISE_SELECTOR` are deliberately
narrow.

**`z.coerce.boolean()` for environment flags.** It reads the string `"false"`
as `true`, because every non-empty string is truthy. Use `z.stringbool()`.

**Bash heredocs for writing code with escape sequences.** Repeatedly mangled
`\\n` and backslashes in this environment. Use the Write or Edit tools for any
file containing escapes or regexes.

## Known gaps

- **The live relevance gate has never run against a real model.** Ollama was
  down throughout. The free half, the fail-open path, and every cheap layer are
  tested and passing. The model half is type-checked, wired and verified to
  skip, but unexercised.
- **The Chroma tests have never been run against a live server.** They exist
  now in `tests/chroma.test.ts`: the short-page skip, the delete-by-URL the
  dedupe fix rests on, and a retrieval round trip. Chroma was down while they
  were written, so only the "Chroma unreachable" case has ever executed.
  Running them is cheap and is the next thing to do after the consistency run.
- **Two chromadb versions are installed at once.** `package.json` pins
  `chromadb` 3.5.0, but `@llamaindex/chroma` bundles its own 1.10.3 and that is
  the copy `getCollection()` returns. Their types are not interchangeable: an
  `IncludeEnum` from one is rejected where the other is expected, the same trap
  `puppeteer-real-browser` sets. `@llamaindex/chroma` is also marked deprecated
  by its own authors. Worth resolving before building the API on top of it.
- **Nothing in the test suite contacts MongoDB.** The conversation store and
  `index.ts` are untested and are exercised only by running the app.
- A wall that gives itself enough paragraphs and headings to pass for an
  article still gets past triage. That is what the relevance gate is for, and
  it is the case that most needs live verification.
- Retrieval is never scoped to the current turn. Fresh pages compete with
  everything indexed before, which widening `similarity_topk_after_search` only
  partly offsets.
- Conversations are global. No user or account concept.
- Questions must be typed interactively. Piping a script of questions does not
  work, because readline drops lines arriving while no prompt is pending.
  Reaching end of input exits cleanly rather than crashing.

## Next steps

1. **Start Ollama and run `bun run test:consistency`.** This is the most
   valuable next action. It reports how often the judge agrees with itself,
   across repeated runs, reworded questions, page length, a sign-in wall, and a
   page containing instructions aimed at the judge. It prints what the model
   actually did, so read the numbers, not just the pass or fail.
2. **Act on those numbers.** If agreement is poor, lower
   `relevance_overlap_threshold` so the model is consulted less often, or set
   `relevance_check_enabled` to false. Do not leave a flaky judge deciding what
   gets indexed.
3. **Run `bun test tests/chroma.test.ts` with Chroma and Ollama up.** Six tests
   that have never executed, including the one that pins the dedupe fix. They
   use their own `rag_test_<timestamp>` collection and delete it afterwards.
4. **Run the app end to end with all three services up**, in debug mode, on a
   question that triggers a search. Confirm the relevance gate fires, the
   timings are acceptable, and the answer improves.
5. Consider scoping retrieval to the current turn's URLs with a metadata
   filter, rather than only widening the retrieval count.
6. The existing Chroma collection still holds duplicate chunks from before the
   dedupe fix. They clear as each page is next scraped. Clearing the collection
   would give a clean baseline, but that is the user's data and their call.

## Trimming the suite

Done 2026-09-18, after the observation that a green suite with Ollama, Chroma
and MongoDB all down proved almost nothing. 281 tests became 223.

Deleted outright:

- `tests/conversations.test.ts`, 17 tests. The MongoDB store.
- `tests/debug.test.ts` and `tests/debugProbe.ts`, 13 tests. They spawned
  subprocesses to assert the shape of log lines.
- `tests/returnCreator.test.ts`, 4 tests. A six-line function whose real
  guarantee, narrowing on `ok`, is enforced by the compiler.
- The MongoDB block in `tests/workflow.test.ts`, 2 tests, with its imports and
  its `beforeAll` and `afterAll` setup.
- `mongoUp` and `chromaUp` from `tests/fixtures.ts`, both orphaned.

Trimmed: `indexer.test.ts` 12 to 4, `prompt.test.ts` 7 to 3, `relevance.test.ts`
15 to 7. In each case a handful of cases covered the behaviour and the rest
restated it.

Kept whole: `pageTriage`, `searchFilters`, `triggers`, `scraping`, `workflow`.
These are the silent-failure surface. `relevanceConsistency.test.ts` was deleted
and then restored: it skips on a normal run, so it was never part of the noise,
and it is the only instrument for the largest known gap.

The rule going forward: **test the logic that fails silently.** If a test cannot
fail for a reason that would reach a user, it is not worth its maintenance.

Runtime barely moved, 81s to 80s. Nearly all of it is real Chrome navigation in
`scraping.test.ts` and `workflow.test.ts`. Trimming unit tests was about
maintenance and honesty, not speed.

## Conventions worth keeping

- Every fallible function returns `FunctionResponse<T>` from
  `utils/returnCreator.ts`. Check `ok` to narrow `data`. This exists because
  `data: any` allowed two real null-dereference bugs.
- Tunables live in `config.json`, secrets and hosts in `.env` via `env.ts`.
- Prompts live in `prompt/prompts/*.txt` so they can be edited without code
  changes.
- **No em dashes anywhere**, per the user's global instruction.
- Update `README.md`, `docs/`, and `CHANGELOG.md` in the same turn as the code.
  The user's global instruction makes this a hard rule.
- Tests that need a service skip themselves and say so, rather than failing.
