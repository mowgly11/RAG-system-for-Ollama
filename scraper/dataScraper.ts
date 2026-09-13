import type { RawData } from "../types/types";
import Scraper, { type BrowserSession } from "./scraper";
import { debugStep } from "../utils/debug";
import config from "../config.json";
import { load } from "cheerio";

// text that means the page served a wall instead of an article
const BLOCKED_MARKERS = [
    "by clicking continue to join or sign in",
    "sign in to continue",
    "please enable javascript",
    "enable javascript and cookies to continue",
    "verify you are human",
    "checking your browser before accessing",
    "access denied",
    "are you a robot"
];

const BLOCKED_MAX_LENGTH = 2000;

/**
 * A short page carrying a sign-in or bot-check phrase is a wall, not content.
 * Long pages are left alone, since an article may quote these phrases in
 * passing.
 */
function looksBlocked(text: string): boolean {
    if (text.length > BLOCKED_MAX_LENGTH) return false;

    const haystack = text.toLowerCase();

    return BLOCKED_MARKERS.some(marker => haystack.includes(marker));
}

function extractText(html: string): string {
    const $ = load(html);

    $('script, style, noscript, iframe, svg, footer, nav, header, input, button, form, head').remove();

    // anchors are unwrapped rather than removed: the words inside a link are
    // part of the sentence, and deleting the element deletes them too
    $('a').each((_, element) => {
        $(element).replaceWith($(element).text());
    });

    return $('body').text()
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, config.max_page_characters);
}

async function scrapeOne(session: BrowserSession, scraper: Scraper, url: string): Promise<RawData | null> {
    const page = await session.browser.newPage();

    try {
        const pageHTML = await scraper.getHTMLcontent(url, page);

        if (!pageHTML.ok) {
            debugStep("page skipped", { url, reason: "navigation failed" });
            console.error(`Skipping ${url}: ${pageHTML.error}`);
            return null;
        }

        const cleanData = extractText(pageHTML.data);

        if (cleanData.length < config.min_page_characters) {
            debugStep("page skipped", { url, reason: "too short", chars: cleanData.length });
            console.error(`Skipping ${url}: too little text to be useful`);
            return null;
        }

        if (looksBlocked(cleanData)) {
            debugStep("page skipped", { url, reason: "sign-in or bot check" });
            console.error(`Skipping ${url}: the page served a sign-in or bot check`);
            return null;
        }

        debugStep("page scraped", { url, chars: cleanData.length });

        return { url, data: cleanData };
    } finally {
        await page.close().catch(() => { /* already gone */ });
    }
}

/**
 * Fetches the given URLs a few at a time. Sequential fetching made a single
 * question wait on every page in turn, which at the default navigation timeout
 * could run for minutes.
 */
export default async function getDataFromURLs(session: BrowserSession, urls: string[]): Promise<RawData[]> {
    const scraper = new Scraper();
    const queue = [...urls];
    const dataStore: RawData[] = [];

    const workerCount = Math.max(1, Math.min(config.scraper_concurrency, queue.length));

    const workers = Array.from({ length: workerCount }, async () => {
        while (queue.length > 0) {
            const url = queue.shift();

            if (!url) break;

            try {
                const scraped = await scrapeOne(session, scraper, url);

                if (scraped) dataStore.push(scraped);
            } catch (err) {
                console.error(`Skipping ${url}: ${err}`);
            }
        }
    });

    await Promise.all(workers);

    debugStep("scraping finished", { requested: urls.length, kept: dataStore.length, workers: workerCount });

    return dataStore;
}
