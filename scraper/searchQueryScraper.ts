import type { FunctionResponse } from "../types/types";
import returnCreator from "../utils/returnCreator";
import Scraper from "./scraper";
import { load } from "cheerio";

const BASE_URL = "https://duckduckgo.com/html/?q=";

export default async function executeSeachQueries(queries: string[]): Promise<FunctionResponse> {
    const scraper = new Scraper(false);

    const { error, data } = await scraper.openBrowser();

    if (error) return returnCreator(error);

    const { browser, page } = data;

    let relevantURLs = new Set();
    for (const query of queries) {
        const targetURL = `${BASE_URL}${encodeURIComponent(query)}`;

        const pageHTML = await scraper.getHTMLcontent(targetURL, page);

        if (pageHTML.error) {
            console.error("there was an error while trying to access " + targetURL);
            continue;
        }

        const $ = load(pageHTML.data);

        $('a.result__snippet').slice(0, 3).each((_, element) => {
            let url = $(element).attr('href');
            if(url) {
                url = decodeURIComponent(url)
                .replace("//duckduckgo.com/l/?uddg=", "")
                .replace(/\&rut=.*/, "");
                relevantURLs.add(url);
            }
        });
    }

    //console.log(relevantURLs);

    await browser.close();

    return returnCreator(null, relevantURLs);
}