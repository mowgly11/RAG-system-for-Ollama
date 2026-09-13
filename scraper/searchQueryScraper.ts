import Scraper, { delay, type BrowserSession } from "./scraper";
import config from "../config.json";
import { load } from "cheerio";

const BASE_URL = "https://duckduckgo.com/html/?q=";

/**
 * DuckDuckGo wraps result links in a redirect whose real target sits in the
 * `uddg` query parameter. Parsing it out beats string surgery, which corrupts
 * targets that contain encoded separators of their own.
 */
function unwrapResultURL(href: string): string | null {
    const absolute = href.startsWith("//") ? `https:${href}` : href;

    try {
        const parsed = new URL(absolute, "https://duckduckgo.com");
        const target = parsed.searchParams.get("uddg");

        const resolved = target ?? parsed.toString();

        if (!resolved.startsWith("http://") && !resolved.startsWith("https://")) return null;
        if (resolved.includes("duckduckgo.com")) return null;

        return resolved;
    } catch {
        return null;
    }
}

/**
 * Runs each query against DuckDuckGo on a single page, pacing the requests so
 * a burst of queries does not get the session rate limited.
 */
export default async function executeSeachQueries(session: BrowserSession, queries: string[]): Promise<string[]> {
    const scraper = new Scraper();
    const relevantURLs = new Set<string>();

    for (const [position, query] of queries.entries()) {
        if (relevantURLs.size >= config.max_pages_per_turn) break;

        if (position > 0) await delay(config.search_request_delay_ms);

        const targetURL = `${BASE_URL}${encodeURIComponent(query)}`;

        const pageHTML = await scraper.getHTMLcontent(targetURL, session.page);

        if (!pageHTML.ok) {
            console.error(`Could not search for "${query}": ${pageHTML.error}`);
            continue;
        }

        const $ = load(pageHTML.data);

        // result__a is the result link itself; the snippet anchor is a fallback
        // for markup changes on DuckDuckGo's side
        const anchors = $('a.result__a').length ? $('a.result__a') : $('a.result__snippet');

        anchors.slice(0, config.search_results_per_query).each((_, element) => {
            const href = $(element).attr('href');

            if (!href) return;

            const url = unwrapResultURL(href);

            if (url) relevantURLs.add(url);
        });
    }

    return [...relevantURLs].slice(0, config.max_pages_per_turn);
}
