import { Document, VectorStoreIndex } from "llamaindex";
import createStorageContext from "./chroma";
import { Logger } from "@mowgly11/node-logger-js";

const logger = new Logger("INDEXER");

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
    const normalizedURL = normalizeUrl(url)

    return new Document({
        text,
        id_: normalizedURL,
        metadata: {
            url: normalizedURL,
        }
    });
}

export async function createIndex(): Promise<VectorStoreIndex> {
    const { vectorStore } = await createStorageContext();

    return await VectorStoreIndex.fromVectorStore(vectorStore);
}

export async function indexData(index: VectorStoreIndex, document: Document): Promise<void> {
    const existingHash = await index.docStore.getDocumentHash(document.id_);

    if (existingHash === document.hash) return logger.info(`Skipping unchanged document: ${document.id_}`);

    if (existingHash) await index.deleteRefDoc(document.id_, true);

    await index.insert(document);
}