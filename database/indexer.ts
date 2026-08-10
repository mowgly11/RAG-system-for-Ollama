import { Document, VectorStoreIndex } from "llamaindex";
import storageContext from "./chroma";
import createStorageContext from "./chroma";

export async function toDocument(text: string, url: string): Promise<Document> {
    return new Document({ text, id_: url });
}

export async function createIndex(): Promise<VectorStoreIndex> {
    const { storageContext, dataCount } = await createStorageContext();

    let index: VectorStoreIndex;

    if (dataCount > 0) {
        console.log("Vector index exists, loading...");
        index = await VectorStoreIndex.init({ storageContext });
    } else {
        console.log("Vector store empty, initializing...");
        const doc = new Document({ text: "Initial master context config" });

        index = await VectorStoreIndex.fromDocuments([doc]);
    }

    return index;
}

export async function indexData(index: VectorStoreIndex, document: Document): Promise<void> {
    await index.insert(document);
}