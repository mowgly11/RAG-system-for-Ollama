import type { RawData } from "../types/types";
import Scraper, { preparePage, type BrowserSession, type ScraperPage } from "./scraper";
import { extractArticleInPage, judgePage, NOISE_SELECTOR, type ExtractedPage } from "./extract";
import { shouldKeep } from "../prompt/relevance";
import { debugStep } from "../utils/debug";
import config from "../config.json";

const MIN_CANDIDATE_CHARACTERS = 140;

/**
 * Reads one URL and returns its main text, or null with the reason logged.
 *
 * Extraction happens inside the page rather than by shipping the whole body
 * HTML out to a parser. That sees the DOM the site's JavaScript produced, and
 * moves only the extracted text across the wire instead of megabytes of markup.
 */
async function scrapeOne(page: ScraperPage, scraper: Scraper, url: string, question?: string): Promise<RawData | null> {
    const loaded = await scraper.openPage(url, page);

    if (!loaded.ok) {
        debugStep("page skipped", { url, reason: loaded.error });
        console.error(`Skipping ${url}: ${loaded.error}`);
        return null;
    }

    let extracted: ExtractedPage;

    try {
        extracted = await page.evaluate(extractArticleInPage, {
            maxChars: config.max_page_characters,
            noise: NOISE_SELECTOR,
            minCandidate: MIN_CANDIDATE_CHARACTERS
        });
    } catch (err) {
        debugStep("page skipped", { url, reason: "extraction failed" });
        console.error(`Skipping ${url}: the page could not be read (${err})`);
        return null;
    }

    const verdict = judgePage(extracted, config.min_page_characters);

    if (!verdict.usable) {
        debugStep("page skipped", { url, reason: verdict.reason, settled: loaded.data.settled });
        console.error(`Skipping ${url}: ${verdict.reason}`);
        return null;
    }

    // the last gate, and the only expensive one. It runs on what survived
    // everything free, and it keeps the page whenever it cannot decide.
    const relevance = await shouldKeep(question, extracted.title, extracted.text);

    if (!relevance.keep) {
        debugStep("page skipped", { url, reason: `not relevant: ${relevance.reason}` });
        console.error(`Skipping ${url}: not relevant to the question (${relevance.reason})`);
        return null;
    }

    debugStep("page scraped", {
        url,
        chars: extracted.text.length,
        of: extracted.bodyLength,
        via: extracted.strategy,
        paras: extracted.paragraphs,
        heads: extracted.headings,
        status: loaded.data.status
    });

    // the title is worth keeping: it names the page for the embedder
    const body = extracted.title ? `${extracted.title}\n\n${extracted.text}` : extracted.text;

    return { url, data: body.slice(0, config.max_page_characters) };
}

/**
 * Fetches the given URLs a few at a time, each on its own page so one slow
 * site cannot hold up the rest.
 */
export default async function getDataFromURLs(session: BrowserSession, urls: string[], question?: string): Promise<RawData[]> {
    const scraper = new Scraper();
    const queue = [...urls];
    const dataStore: RawData[] = [];
    const reasons: Record<string, number> = {};

    const workerCount = Math.max(1, Math.min(config.scraper_concurrency, queue.length));

    const workers = Array.from({ length: workerCount }, async () => {
        const page = await session.browser.newPage();

        await preparePage(page);

        try {
            while (queue.length > 0) {
                const url = queue.shift();

                if (!url) break;

                try {
                    const scraped = await scrapeOne(page, scraper, url, question);

                    if (scraped) dataStore.push(scraped);
                    else reasons.skipped = (reasons.skipped ?? 0) + 1;
                } catch (err) {
                    reasons.failed = (reasons.failed ?? 0) + 1;
                    console.error(`Skipping ${url}: ${err}`);
                }
            }
        } finally {
            await page.close().catch(() => { /* already gone */ });
        }
    });

    await Promise.all(workers);

    debugStep("scraping finished", {
        requested: urls.length,
        kept: dataStore.length,
        skipped: reasons.skipped ?? 0,
        failed: reasons.failed ?? 0,
        workers: workerCount
    });

    return dataStore;
}
