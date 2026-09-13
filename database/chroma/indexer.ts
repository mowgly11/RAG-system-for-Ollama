import { Document, VectorStoreIndex } from "llamaindex";
import type { ChromaVectorStore } from "@llamaindex/chroma";
import createVectorStore from "./chroma";
import returnCreator from "../../utils/returnCreator";
import { debugStep } from "../../utils/debug";
import config from "../../config.json";
import type { FunctionResponse, IndexingSummary } from "../../types/types";

export type IndexBundle = {
    index: VectorStoreIndex;
    vectorStore: ChromaVectorStore;
}

function normalizeUrl(url: string): string {
    try {
        const parsed = new URL(url);

        parsed.hash = "";

        parsed.searchParams.delete("utm_source");
        parsed.searchParams.delete("utm_medium");
        parsed.searchParams.delete("utm_campaign");

        parsed.pathname = parsed.pathname.replace(/\/$/, "");

        return parsed.toString();
    } catch {
        // a malformed URL should not take down the whole turn
        return url;
    }
}

export function toDocument(text: string, url: string): Document {
    const normalizedURL = normalizeUrl(url);

    return new Document({
        text,
        id_: normalizedURL,
        metadata: {
            url: normalizedURL,
        }
    });
}

export async function createIndex(): Promise<FunctionResponse<IndexBundle>> {
    const store = await createVectorStore();

    if (!store.ok) return returnCreator(store.error);

    try {
        const index = await VectorStoreIndex.fromVectorStore(store.data);

        console.log("Connected to chroma instance");

        return returnCreator(null, { index, vectorStore: store.data });
    } catch (err) {
        return returnCreator("An error occured while trying to open the vector index: " + err);
    }
}

/**
 * Removes every chunk previously stored for a URL.
 *
 * The index's own document store is in memory and starts empty on each run, so
 * its hash check cannot recognise a page indexed by an earlier run. Without
 * this, re-scraping a page appends a second copy of it to the collection.
 */
async function dropExistingChunks(vectorStore: ChromaVectorStore, url: string): Promise<void> {
    try {
        const collection = await vectorStore.getCollection();

        await collection.delete({ where: { url } });

        debugStep("previous chunks cleared", { url });
    } catch (err) {
        // a failed cleanup is worth knowing about but must not block indexing
        console.error(`Could not clear previous chunks for ${url}: ${err}`);
    }
}

export async function indexData(bundle: IndexBundle, document: Document): Promise<void> {
    const text = document.getText().trim();

    if (text.length < config.min_page_characters) {
        debugStep("document skipped", { url: document.id_, reason: "too short" });
        console.log(`Skipping page with too little text: ${document.id_}`);
        return;
    }

    const existingHash = await bundle.index.docStore.getDocumentHash(document.id_);

    // only meaningful within a single run, but it saves re-embedding a page
    // that two search queries both turned up
    if (existingHash === document.hash) {
        debugStep("document skipped", { url: document.id_, reason: "already indexed this run" });
        console.log(`Skipping unchanged document: ${document.id_}`);
        return;
    }

    await dropExistingChunks(bundle.vectorStore, document.id_);

    debugStep("embedding document", { url: document.id_, chars: text.length });

    await bundle.index.insert(document);

    debugStep("document indexed", { url: document.id_ });
}

export async function indexDataBulk(bundle: IndexBundle, documents: Document[]): Promise<FunctionResponse<IndexingSummary>> {
    try {
        // sequential on purpose: each document clears its own previous chunks
        // first, and concurrent deletes against the same collection can race
        let successes = 0;
        let failures = 0;

        for (const document of documents) {
            try {
                await indexData(bundle, document);
                successes++;
            } catch (err) {
                console.error(`Failed to index ${document.id_}: ${err}`);
                failures++;
            }
        }

        return returnCreator(null, { successes, failures });
    } catch (err) {
        return returnCreator("An error has occured while trying to index documents in bulk: " + err);
    }
}
