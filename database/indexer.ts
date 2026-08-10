import { Document, VectorStoreIndex } from "llamaindex";
import storageContext from "./chroma";

export async function toDocument(text: string, url: string): Promise<Document> {
    return new Document({ text, id_: url });
}

export async function IndexData(documents: Document[]): Promise<VectorStoreIndex> {
    const index = await VectorStoreIndex.fromDocuments(documents, { storageContext });

    return index;
}