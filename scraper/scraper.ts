import { connect } from "puppeteer-real-browser";
import returnCreator from "../utils/returnCreator";
import { type Page } from "puppeteer";

class Scraper {
    private headless: boolean;
    constructor(headless: boolean = true) {
        this.headless = headless;
    }

    async openBrowser() {
        try {
            const { browser, page } = await connect({
                headless: this.headless,
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

            return returnCreator(null, { browser, page });
        } catch (err) {
            return returnCreator("An error has occured while trying to open the browser: " + err);
        }
    }

    async getHTMLcontent(url: string, page: Page) {
        if (!url.startsWith("https://") && !url.startsWith('http://')) return returnCreator("Invalid given URL");

        await page.goto(url, { waitUntil: "networkidle2" });

        const data = await page.evaluate(() => {
            const content = document.querySelector("body").innerHTML;
            return content;
        });

        if (!data) return returnCreator("No data was extracted from the website");

        return returnCreator(null, data);
    }
}

export default Scraper;