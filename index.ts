import { Settings } from "llamaindex";
import getDataFromURL from "./scraper";
import { ollama, OllamaEmbedding } from "@llamaindex/ollama";
import input from "./readline";
import { toDocument, IndexData } from "./indexer";

Settings.llm = ollama({
    model: "llama3.2:3b"
});

Settings.embedModel = new OllamaEmbedding({
    model: "nomic-embed-text",
    config: {
        host: "http://127.0.01:11434"
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