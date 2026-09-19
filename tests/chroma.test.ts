/**
 * The half of the pipeline the offline suite never touches: a real Chroma
 * server and a real embedding model.
 *
 * The live block needs both services up and skips when either is down. When
 * Chroma is down the last test runs instead, so the file asserts something
 * either way.
 *
 * The collection is named per run and deleted afterwards, so a test run can
 * never touch the collection the app is using. That rests on `env.ts` being
 * imported here first, which is why the setup checks the name it actually got
 * and refuses to run if some other test file loaded `env.ts` before it.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Settings } from "llamaindex";
import { OllamaEmbedding } from "@llamaindex/ollama";
import { ChromaClient } from "chromadb";
import type { IndexBundle } from "../database/chroma/indexer";
import { chromaUp, ollamaUp, PROSE } from "./fixtures";

const chromaReady = await chromaUp();
const ready = chromaReady && await ollamaUp();

const COLLECTION = `rag_test_${Date.now()}`;

// set before the import below, because env.ts parses process.env once at
// import time and createVectorStore reads the collection name from it
process.env.VECTOR_STORE_COLLECTION_NAME = COLLECTION;

const { createIndex, indexData, indexDataBulk, toDocument } = await import("../database/chroma/indexer");
const { env } = await import("../env");

const BINARY_SEARCH = `Binary Search\n\n${PROSE.repeat(10)}`;
const SORTING = "Sorting Algorithms\n\n" +
    "Merge sort splits the list in half, sorts each half, then merges the two sorted halves back together. ".repeat(10);

let bundle: IndexBundle;

/** Every chunk currently stored for one URL, with its text. */
async function storedFor(url: string): Promise<{ count: number, text: string }> {
    const collection = await bundle.vectorStore.getCollection();

    // only `where`, matching dropExistingChunks. An explicit `include` would
    // need the IncludeEnum from the chromadb that @llamaindex/chroma bundles,
    // which is a different copy from the one in package.json
    const stored = await collection.get({ where: { url } });

    return {
        count: stored.ids.length,
        text: stored.documents.filter((text): text is string => typeof text === "string").join(" ")
    };
}

describe.skipIf(!ready)("chroma and the embedding model, live", () => {
    beforeAll(async () => {
        // bun shares one module registry across test files, so if any file
        // imported env.ts before this one the override above arrived too late.
        // Refuse rather than write test data into the collection the app uses
        if (env.VECTOR_STORE_COLLECTION_NAME !== COLLECTION) {
            throw new Error(
                `refusing to run against "${env.VECTOR_STORE_COLLECTION_NAME}": ` +
                "env.ts was already loaded by another test file. Run this file on its own."
            );
        }

        Settings.embedModel = new OllamaEmbedding({
            model: env.EMBEDDING_MODEL,
            config: { host: env.OLLAMA_HOST }
        });

        const opened = await createIndex();

        if (!opened.ok) throw new Error("could not open the index: " + opened.error);

        bundle = opened.data;
    });

    afterAll(async () => {
        // the collection is this run's alone, so removing it leaves nothing behind
        await new ChromaClient().deleteCollection({ name: COLLECTION }).catch(() => { /* never created */ });
    });

    test("a page with too little text never reaches the collection", async () => {
        const url = "https://example.com/stub";

        await indexData(bundle, toDocument("Too short to be worth embedding.", url));

        expect((await storedFor(url)).count).toBe(0);
    }, 60000);

    test("re-indexing a URL in a later run replaces it instead of adding a copy", async () => {
        const url = "https://example.com/changing";

        await indexData(bundle, toDocument(`Version one. ${PROSE.repeat(6)}`, url));

        const before = await storedFor(url);

        expect(before.count).toBeGreaterThan(0);

        // a second bundle has its own empty document store, which is exactly
        // what a second run of the app has. Only the delete-by-URL can save it
        const reopened = await createIndex();

        if (!reopened.ok) throw new Error(reopened.error);

        await indexData(reopened.data, toDocument(`Version two. ${PROSE.repeat(6)}`, url));

        const after = await storedFor(url);

        // the two versions are the same length, so a stacked copy shows up as
        // a doubled count and a replaced one does not
        expect(after.count).toBe(before.count);
        expect(after.text).toContain("Version two");
        expect(after.text).not.toContain("Version one");
    }, 120000);

    test("a question retrieves the page that answers it", async () => {
        await indexDataBulk(bundle, [
            toDocument(BINARY_SEARCH, "https://example.com/retrieval-search"),
            toDocument(SORTING, "https://example.com/retrieval-sorting")
        ]);

        const hits = await bundle.index
            .asRetriever({ similarityTopK: 1 })
            .retrieve({ query: "how does merge sort combine the two halves" });

        expect(hits.length).toBe(1);
        expect(hits[0]?.node.metadata.url).toBe("https://example.com/retrieval-sorting");
    }, 120000);
});

describe.skipIf(chromaReady)("chroma unreachable", () => {
    test("opening the index reports the failure instead of throwing", async () => {
        // index.ts checks ok and exits with the message. A throw here would
        // end the run in a stack trace instead
        const opened = await createIndex();

        expect(opened.ok).toBe(false);
        expect(opened.error).toContain("Chroma");
        expect(opened.data).toBeNull();
    }, 60000);
});
