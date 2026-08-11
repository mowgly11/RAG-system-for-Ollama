import { ChromaVectorStore } from "@llamaindex/chroma";
import { storageContextFromDefaults } from "llamaindex";
import { env } from "../env";

export default async function createStorageContext() {
    const vectorStore = new ChromaVectorStore({collectionName: env.VECTOR_STORE_COLLECTION_NAME});

    const storageContext = await storageContextFromDefaults({ vectorStore });

    return {vectorStore, storageContext};
}