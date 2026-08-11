import { Settings } from "llamaindex";
import getDataFromURL from "./scraper/scraper";
import { Ollama, OllamaEmbedding } from "@llamaindex/ollama";
import input, { loader, stopLoader } from "./utils/readline";
import { toDocument, createIndex, indexData } from "./database/indexer";
import { env } from "./env";
import getPrompt from "./prompt/prompt";

Settings.embedModel = new OllamaEmbedding({
    model: env.EMBEDDING_MODEL,
    config: {
        host: env.OLLAMA_HOST
    }
});

Settings.llm = new Ollama({
    model: env.LLM,
    options: {
        temperature: env.TEMPERATURE
    }
});

async function main() {
    const index = await createIndex();
    let limit = 999;
    let count = 0;

    const chatEngine = index.asChatEngine({
        similarityTopK: 5,
        systemPrompt: getPrompt('system') ?? ""
    });

    while(count < limit) { // to prevent infinite loops
        count++;

        const query = await input("What is your question: ");
        
        let loaderID = loader();
        
        // here needs to be a process that determines what sources to get data from
        /**
         * first we should modify the system prompt in order to force the LLM to use tools such as search
         * i need a structured way of doing that so we can have more tools moving on without modifying the code too much
         * the prompt given by the user is turned to keywords optimized for searching
         * a scraper should go ahead and scrape result links from https://duckduckgo.com/html/?q=query
         * data is retreived and the pages are scraped
         * then all data is saved to chroma and the LLM is prompted to continue the request
         */
        const response = await chatEngine.chat({
            message: String(query)
        });

        stopLoader(loaderID);

        console.log(response.message.content);
        
    }
}

await main();

process.exit(0);