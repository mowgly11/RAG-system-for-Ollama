import { Document, VectorStoreIndex } from "llamaindex";
import createStorageContext from "./chroma";
import { v4 as uuid } from "uuid";

export async function toDocument(text: string, url: string): Promise<Document> {
    return new Document({ text, id_: url });
}

export async function createIndex(): Promise<VectorStoreIndex> {
    const { vectorStore, storageContext, dataCount } = await createStorageContext();

    let index: VectorStoreIndex;

    if (dataCount > 0) {
        console.log("Vector index exists, loading...");
        index = await VectorStoreIndex.fromVectorStore(vectorStore);
    } else {
        console.log("Vector store empty, initializing...");
        const doc = await toDocument("Ignore this text", uuid());

        index = await VectorStoreIndex.fromDocuments([doc], { storageContext });
    }

    return index;
}

export async function indexData(index: VectorStoreIndex, document: Document): Promise<void> {
    await index.insert(document);
}