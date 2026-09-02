import { ChromaVectorStore } from "@llamaindex/chroma";
import { storageContextFromDefaults } from "llamaindex";
import { env } from "../../env";
import returnCreator from "../../utils/returnCreator";
import { type FunctionResponse } from "../../types/types";

export default async function createStorageContext(): Promise<FunctionResponse> {
    try {
        const vectorStore = new ChromaVectorStore({ collectionName: env.VECTOR_STORE_COLLECTION_NAME });

        const storageContext = await storageContextFromDefaults({ vectorStore });

        return returnCreator(null, { vectorStore, storageContext });
    } catch (err) {
        return returnCreator("An error occured while trying to create the storage context: " + err);
    }
}