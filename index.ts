import { Settings } from "llamaindex";
import getDataFromURL from "./scraper/scraper";
import { ollama, OllamaEmbedding } from "@llamaindex/ollama";
import input, { loader, stopLoader } from "./utils/readline";
import { toDocument, createIndex, indexData } from "./database/indexer";
import { env } from "./env";

Settings.embedModel = new OllamaEmbedding({
    model: env.EMBEDDING_MODEL,
    config: {
        host: env.OLLAMA_HOST
    }
});

Settings.llm = ollama({
    model: env.LLM
});

async function main() {
    const index = await createIndex();
    let limit = 999;
    let i = 0;

    const quesryEngine = index.asChatEngine();

    while(i < limit) { // to prevent infinite loops
        i++;

        const query = await input("What is your question: ");

        let loaderID = loader();

        const response = await quesryEngine.chat({
            message: String(query)
        });

        stopLoader(loaderID);

        console.log(response.message);
        
        // here needs to be a process that determines what sources to get data from
    }
    
    // const {error, data} = await getDataFromURL('https://www.bbc.com/news/live/cj9gzgjw98xt');
    
    // if(error) {
    //     console.log("Scraper failed with error: " + error);
    //     process.exit(1);
    // }
    
    // const doc = await toDocument(data!, "https://www.bbc.com/news/live/cj9gzgjw98xt");
    
    // await indexData(index, doc);
    
    // 
    
    // const response = await quesryEngine.chat({
    //     message: String(query)
    // });
    
    // console.log(response.toString());
    
}

await main();

process.exit(0);