import Scraper, { delay, type BrowserSession } from "./scraper";
import { extractSearchResultsInPage, type SearchHit } from "./extract";
import { debugStep } from "../utils/debug";
import config from "../config.json";

// the dedicated HTML endpoint is the lighter of the two. The main host is kept
// as a fallback for when it answers with a challenge or nothing at all.
const SEARCH_HOSTS = [
    "https://html.duckduckgo.com/html/?q=",
    "https://duckduckgo.com/html/?q="
];

/** Extensions the text extractor cannot read. */
const UNREADABLE = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|tar|gz|csv|epub|mp[34]|avi|mov|webm|png|jpe?g|gif|webp|svg|ico)(\?|#|$)/i;

/**
 * DuckDuckGo wraps result links in a redirect whose real target sits in the
 * `uddg` query parameter. Parsing it out beats string surgery, which corrupts
 * targets that contain encoded separators of their own.
 */
export function unwrapResultURL(href: string): string | null {
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

export function hostOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
        return "";
    }
}

/**
 * Rejects results before they cost a page load.
 *
 * Filtering here is far cheaper than fetching a login wall or a PDF and
 * throwing it away after the fact.
 */
export function rejectionReason(url: string, host: string, perDomain: Map<string, number>): string | null {
    if (!host) return "unparseable url";
    if (UNREADABLE.test(url)) return "not a readable document";

    const skipped = config.skip_domains.find(domain => host === domain || host.endsWith(`.${domain}`));

    if (skipped) return `${skipped} serves a sign-in wall`;

    if ((perDomain.get(host) ?? 0) >= config.max_results_per_domain) return `already have ${config.max_results_per_domain} from ${host}`;

    return null;
}

async function harvest(session: BrowserSession, scraper: Scraper, host: string, query: string): Promise<{ hits: SearchHit[], challenged: boolean, noResults: boolean }> {
    const loaded = await scraper.openPage(`${host}${encodeURIComponent(query)}`, session.page);

    if (!loaded.ok) {
        console.error(`Could not search for "${query}": ${loaded.error}`);
        return { hits: [], challenged: false, noResults: false };
    }

    // ask for more than we need, since some get filtered out below
    return await session.page.evaluate(extractSearchResultsInPage, config.search_results_per_query * 4);
}

/**
 * Runs each query against DuckDuckGo on one page, pacing the requests so a
 * burst does not get the session rate limited, and returns the URLs worth
 * fetching.
 */
export default async function executeSeachQueries(session: BrowserSession, queries: string[]): Promise<string[]> {
    const scraper = new Scraper();
    const chosen: string[] = [];
    const seen = new Set<string>();
    const perDomain = new Map<string, number>();

    for (const [position, query] of queries.entries()) {
        if (chosen.length >= config.max_pages_per_turn) break;

        if (position > 0) await delay(config.search_request_delay_ms);

        debugStep("search query sent", { query });

        let harvested = await harvest(session, scraper, SEARCH_HOSTS[0]!, query);

        // a challenge or an empty page is usually the endpoint, not the query
        if (harvested.challenged || (harvested.hits.length === 0 && !harvested.noResults)) {
            debugStep("search retried on fallback host", { query, challenged: harvested.challenged });

            await delay(config.search_request_delay_ms);

            harvested = await harvest(session, scraper, SEARCH_HOSTS[1]!, query);
        }

        if (harvested.challenged) {
            console.error(`The search engine asked for a human check on "${query}"`);
            debugStep("search challenged", { query });
            continue;
        }

        if (harvested.noResults) {
            debugStep("search had no results", { query });
            continue;
        }

        let accepted = 0;

        for (const hit of harvested.hits) {
            if (chosen.length >= config.max_pages_per_turn) break;
            if (accepted >= config.search_results_per_query) break;

            const url = unwrapResultURL(hit.url);

            if (!url || seen.has(url)) continue;

            const host = hostOf(url);
            const reason = rejectionReason(url, host, perDomain);

            if (reason) {
                debugStep("result rejected", { url, reason });
                continue;
            }

            seen.add(url);
            perDomain.set(host, (perDomain.get(host) ?? 0) + 1);
            chosen.push(url);
            accepted++;
        }

        debugStep("search results read", { query, accepted, offered: harvested.hits.length, total: chosen.length });
    }

    debugStep("search finished", { urls: chosen });

    return chosen;
}
