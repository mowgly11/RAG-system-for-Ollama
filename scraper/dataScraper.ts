import type { FunctionResponse, RawData } from "../types/types";
import returnCreator from "../utils/returnCreator";
import Scraper from "./scraper";
import { load } from "cheerio";

export default async function getDataFromURLs(urls: string[]): Promise<FunctionResponse> { // TODO: make this support going through multiple URLs
    const scraper = new Scraper(false);

    const { error, data } = await scraper.openBrowser();

    if (error) return returnCreator(error);

    const { browser, page } = data;

    let dataStore: RawData[] = [];

    for (const url of urls) {
        const pageHTML = await scraper.getHTMLcontent(url, page);

        if (pageHTML.error) {
            console.log(pageHTML.error);
            continue;
        }
        
        const $ = load(pageHTML.data);

        $('script, style, noscript, iframe, svg, footer, nav, header, input, button, form, head, a').remove();

        const cleanData = $('body').text()
        .replace(/\s+/g, ' ')
        .trim()

        // the kind of data being extracted
        dataStore.push({
            url,
            data: cleanData
        });
    }
    
    await browser.close();
    return returnCreator(null, dataStore);
}