import { connect } from "puppeteer-real-browser";
import returnCreator from "../utils/returnCreator";
import { env } from "../env";
import config from '../config.json';
import type { FunctionResponse } from "../types/types";

// derived from what connect() actually hands back. puppeteer-real-browser
// bundles its own puppeteer, whose Browser is not the same type as the one in
// the top level puppeteer package.
type ConnectResult = Awaited<ReturnType<typeof connect>>;

export type ScraperBrowser = ConnectResult["browser"];
export type ScraperPage = Awaited<ReturnType<ScraperBrowser["newPage"]>>;

export type BrowserSession = {
    browser: ScraperBrowser;
    page: ScraperPage;
}

class Scraper {
    private headless: boolean;

    constructor(headless: boolean = config.headless_browser) {
        this.headless = headless;
    }

    async openBrowser(): Promise<FunctionResponse<BrowserSession>> {
        try {
            let customArgs = [
                "--no-sandbox"
            ];

            if (config.tor_proxy_enabled) customArgs.push(`--proxy-server=${env.TOR_PROXY_URL}`)
            const { browser, page } = await connect({
                headless: this.headless,
                args: customArgs,
                customConfig: {},
                turnstile: true,
                connectOption: {
                    defaultViewport: {
                        height: 1024,
                        width: 1280
                    }
                },
            });

            return returnCreator(null, { browser, page });
        } catch (err) {
            return returnCreator("An error has occured while trying to open the browser: " + err);
        }
    }

    async getHTMLcontent(url: string, page: ScraperPage): Promise<FunctionResponse<string>> {
        if (!url.startsWith("https://") && !url.startsWith('http://')) return returnCreator("Invalid given URL");

        try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.page_timeout_ms });
        } catch (err) {
            return returnCreator("An error occured while trying to navigate to a url: " + err);
        }

        try {
            const data = await page.evaluate(() => document.querySelector("body")?.innerHTML);

            if (!data) return returnCreator("No data was extracted from the website");

            return returnCreator(null, data);
        } catch (err) {
            return returnCreator("An error occured while reading the page body: " + err);
        }
    }
}

/**
 * Runs `work` against a freshly opened browser and always closes it, including
 * when `work` throws. Without the finally, a failure part way through a batch
 * leaves an orphaned Chrome process behind for the rest of the session.
 */
export async function withBrowser<T>(work: (session: BrowserSession) => Promise<T>): Promise<FunctionResponse<T>> {
    const scraper = new Scraper();

    const opened = await scraper.openBrowser();

    if (!opened.ok) return returnCreator(opened.error);

    try {
        const result = await work(opened.data);

        return returnCreator(null, result);
    } catch (err) {
        return returnCreator("An error has occured while scraping: " + err);
    } finally {
        await opened.data.browser.close().catch(() => { /* already gone */ });
    }
}

export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export default Scraper;
