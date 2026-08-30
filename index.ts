import { Settings } from "llamaindex";
import { Ollama, OllamaEmbedding } from "@llamaindex/ollama";
import input, { loader, stopLoader } from "./utils/readline";
import { toDocument, createIndex, indexData, indexDataBulk } from "./database/indexer";
import { env } from "./env";
import { getPrompt, toSearchQuery } from "./prompt/prompt";
import executeSeachQueries from "./scraper/searchQueryScraper";
import config from "./config.json";
import Scraper from "./scraper/scraper";
import getDataFromURLs from "./scraper/dataScraper";
import type { RawData } from "./types/types";

Settings.embedModel = new OllamaEmbedding({
    model: env.EMBEDDING_MODEL,
    config: {
        host: env.OLLAMA_HOST
    }
});

const llm = new Ollama({
    model: env.LLM,
    options: {
        temperature: config.llm_temperature,
        num_ctx: config.context_window_size
    }
});

llm.metadata.contextWindow = config.context_window_size;

Settings.llm = llm;

async function main() {
    const index = await createIndex();
    let limit = 999;
    let count = 0;

    const chatEngine = index.asChatEngine({
        similarityTopK: 5,
        systemPrompt: getPrompt('system').data ?? ""
    });

    while (count < limit) { // to prevent infinite loops
        count++;

        const query = await input("What is your question: ") as string;

        let loaderID = loader();

        const { error, data } = await toSearchQuery(query);

        if (error) return console.error(error);

        if (data.needsSearch && data.queries.length > 0) {
            const pages = await executeSeachQueries(data.queries);
            const pagesData = await getDataFromURLs(pages.data);

            const indexingResults = await indexDataBulk(
                index,
                pagesData.data.map((page: RawData) =>
                    toDocument(page.data, page.url)
                )
            );
        }

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