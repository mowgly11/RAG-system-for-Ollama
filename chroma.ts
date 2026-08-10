import { ChromaVectorStore } from "@llamaindex/chroma";
import { storageContextFromDefaults } from "llamaindex";

const vectorStore = new ChromaVectorStore({collectionName: "rag_store"});

const storageContext = await storageContextFromDefaults({ vectorStore });

export default storageContext;