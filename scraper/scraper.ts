import {connect} from "puppeteer-real-browser";
import {load} from "cheerio";
import {type DataFromURL} from "../types/types";

const { browser, page } = await connect({
    headless: false,
    args: [
        "--no-sandbox"
    ],
    customConfig: {},
    turnstile: true,
    connectOption: {
        defaultViewport: {
            height: 1024,
            width: 1280
        }
    },
});

export default async function getDataFromURL(url: string): Promise<DataFromURL> {
    if (!url.startsWith("https://") && !url.startsWith('http://')) return {
        error: "Invalid URL parameter",
        data: null
    }

    await page.goto(url, { waitUntil: "networkidle0" });

    const data = await page.evaluate(() => {
        const content = document.querySelector("body").innerHTML;
        return content;
    });

    if(!data) return {
        error: "No data extracted from the website",
        data: null,
    }

    let dataStore: string[] = [];
    const $ = load(data);

    $("p").each((_, el) => {
        dataStore.push($(el).text())
    });

    browser.close();

    return {
        error: null,
        data: dataStore.join('\n')
    };
}