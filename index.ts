import { Settings } from "llamaindex";
import getDataFromURL from "./scraper/scraper";
import { ollama, OllamaEmbedding } from "@llamaindex/ollama";
import input from "./utils/readline";
import { toDocument, IndexData } from "./database/indexer";
import { env } from "./env";

Settings.llm = ollama({
    model: env.LLM
});

Settings.embedModel = new OllamaEmbedding({
    model: env.EMBEDDING_MODEL,
    config: {
        host: env.OLLAMA_HOST
    }
});

const query = await input("What is your question: ");

const {error, data} = await getDataFromURL('https://www.bbc.com/news/live/cj9gzgjw98xt');

if(error) {
    console.log("Scraper failed with error: " + error);
    process.exit(1);
}

const doc = await toDocument(data!, "https://www.bbc.com/news/live/cj9gzgjw98xt");

const index = await IndexData([doc]);

const quesryEngine = index.asChatEngine();

const response = await quesryEngine.chat({
    message: String(query)
});

console.log(response.toString());

process.exit(0);