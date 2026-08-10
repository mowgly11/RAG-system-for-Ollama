import { ChromaVectorStore } from "@llamaindex/chroma";
import { storageContextFromDefaults } from "llamaindex";
import { env } from "../env";

export default async function createStorageContext() {
    const vectorStore = new ChromaVectorStore({collectionName: env.VECTOR_STORE_COLLECTION_NAME});
    const collection = await vectorStore.getCollection();
    const dataCount = await collection.count();

    const storageContext = await storageContextFromDefaults({ vectorStore });

    return {vectorStore, storageContext, dataCount};
}