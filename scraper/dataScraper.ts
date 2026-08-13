import type { FunctionResponse } from "../types/types";
import returnCreator from "../utils/returnCreator";
import Scraper from "./scraper";
import { load } from "cheerio";

export default async function getDataFromURL(url: string): Promise<FunctionResponse> {
    const scraper = new Scraper(false);

    const { error, data } = await scraper.openBrowser();

    if (error) return returnCreator(error);

    const { browser, page } = data;

    const pageHTML = await scraper.getHTMLcontent(url, page);

    if(pageHTML.error) return returnCreator(pageHTML.error);

    let dataStore: string[] = [];

    const $ = load(pageHTML.data);
    // the kind of data being extracted
    $("p").each((_, el) => {
        dataStore.push($(el).text())
    });

    browser.close();

    return returnCreator(null, dataStore);
}