import { ChromaVectorStore } from "@llamaindex/chroma";
import { env } from "../../env";
import returnCreator from "../../utils/returnCreator";
import { type FunctionResponse } from "../../types/types";

export default async function createVectorStore(): Promise<FunctionResponse<ChromaVectorStore>> {
    try {
        const vectorStore = new ChromaVectorStore({ collectionName: env.VECTOR_STORE_COLLECTION_NAME });

        // touching the collection here turns a bad connection into a clear
        // error now, instead of a confusing failure on the first question
        await vectorStore.getCollection();

        return returnCreator(null, vectorStore);
    } catch (err) {
        return returnCreator("An error occured while trying to reach the Chroma collection: " + err);
    }
}
