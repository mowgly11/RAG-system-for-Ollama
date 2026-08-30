import { connect } from "puppeteer-real-browser";
import returnCreator from "../utils/returnCreator";
import { Browser, type Page } from "puppeteer";
import { env } from "../env";
import config from '../config.json';

class Scraper {
    private headless: boolean;
    constructor(headless: boolean = true) {
        this.headless = headless;
    }

    async openBrowser() {
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

    async getHTMLcontent(url: string, browser: Browser) {
        if (!url.startsWith("https://") && !url.startsWith('http://')) return returnCreator("Invalid given URL");

        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded" });

        const data = await page.evaluate(() => {
            const content = document.querySelector("body").innerHTML;
            return content;
        });

        if (!data) return returnCreator("No data was extracted from the website");

        await page.close();

        return returnCreator(null, data);
    }
}

export default Scraper;