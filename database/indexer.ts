import { Document, VectorStoreIndex } from "llamaindex";
import createStorageContext from "./chroma";
import returnCreator from "../utils/returnCreator";
import type { FunctionResponse } from "../types/types";

function normalizeUrl(url: string): string {
    const parsed = new URL(url);

    parsed.hash = "";

    parsed.searchParams.delete("utm_source");
    parsed.searchParams.delete("utm_medium");
    parsed.searchParams.delete("utm_campaign");

    parsed.pathname = parsed.pathname.replace(/\/$/, "");

    return parsed.toString();
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

export async function createIndex(): Promise<VectorStoreIndex> {
    const { error, data } = await createStorageContext();
    if (error) console.error(error)

    return await VectorStoreIndex.fromVectorStore(data.vectorStore);
}

export async function indexData(index: VectorStoreIndex, document: Document): Promise<void> {
    const existingHash = await index.docStore.getDocumentHash(document.id_);

    if (existingHash === document.hash) return console.log(`Skipping unchanged document: ${document.id_}`);

    if (existingHash) await index.deleteRefDoc(document.id_, true);

    await index.insert(document);
}

export async function indexDataBulk(index: VectorStoreIndex, documents: Document[]): Promise<FunctionResponse> {
    try {
        const results = await Promise.allSettled(documents.map(doc => indexData(index, doc))); // TODO: index all documents in bulk

        const successes = results.filter(r => r.status === 'fulfilled');
        const failures = results.filter(r => r.status === 'rejected');

        return returnCreator(null, { successes: successes.length, failures: failures.length })
    } catch (err) {
        return returnCreator("An error has occured while trying to index documents in bulk: " + err);
    }
}