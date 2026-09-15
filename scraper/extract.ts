/**
 * Content extraction and page triage.
 *
 * The functions named *InPage run inside the browser, where the DOM is the one
 * the site's own JavaScript produced. Puppeteer serialises them, so they must
 * be fully self contained: no imports, no module scope, everything they need
 * arrives as an argument.
 */

export type ExtractedPage = {
    title: string;
    text: string;
    textLength: number;
    bodyLength: number;
    linkDensity: number;
    strategy: string;
}

export type SearchHit = {
    url: string;
    title: string;
    snippet: string;
}

export type SearchHarvest = {
    hits: SearchHit[];
    noResults: boolean;
    challenged: boolean;
}

/** Elements that never carry the text we want. */
export const NOISE_SELECTOR = [
    "script", "style", "noscript", "iframe", "svg", "canvas", "template",
    "nav", "header", "footer", "aside", "form", "button", "input", "select",
    "textarea", "video", "audio", "figure figcaption",
    "[aria-hidden='true']", "[hidden]", "[role='navigation']", "[role='banner']",
    "[role='contentinfo']", "[role='search']", "[role='alert']"
].join(", ");

/**
 * Readability-style main content pick, run against the live DOM.
 *
 * Taking all of body.innerText drags in menus, cookie banners and related
 * article lists. Scoring candidate containers by how much text they hold
 * against how much of it is link text finds the actual article instead.
 */
export function extractArticleInPage(options: { maxChars: number, noise: string, minCandidate: number }): ExtractedPage {
    const { maxChars, noise, minCandidate } = options;

    const normalize = (raw: string): string =>
        raw
            .replace(/\r/g, "")
            .replace(/[ \t ]+/g, " ")
            .replace(/ *\n */g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

    const textOf = (el: Element): string => {
        const value = (el as HTMLElement).innerText ?? el.textContent ?? "";
        return normalize(value);
    };

    const linkTextLength = (el: Element): number => {
        let total = 0;
        el.querySelectorAll("a").forEach(anchor => { total += textOf(anchor).length; });
        return total;
    };

    for (const node of Array.from(document.querySelectorAll(noise))) node.remove();

    type Candidate = { text: string, score: number, density: number, tag: string };

    const candidates: Candidate[] = [];
    const scope = document.querySelectorAll("article, main, [role='main'], section, div");

    for (const element of Array.from(scope)) {
        const text = textOf(element);

        if (text.length < minCandidate) continue;

        const density = text.length > 0 ? Math.min(1, linkTextLength(element) / text.length) : 1;

        // a list of links is a menu or an index, not an article
        if (density > 0.5) continue;

        const paragraphs = element.querySelectorAll("p").length;

        let score = text.length * (1 - density) + paragraphs * 25;

        const tag = element.tagName.toLowerCase();

        if (tag === "article") score *= 1.6;
        else if (tag === "main") score *= 1.4;

        // className is not a string on SVG elements, so read the attribute
        const signature = `${element.getAttribute("class") ?? ""} ${element.getAttribute("id") ?? ""}`.toLowerCase();

        if (/(nav|menu|sidebar|footer|header|comment|promo|advert|banner|related|share|social|cookie|newsletter|subscribe|breadcrumb)/.test(signature)) score *= 0.25;
        if (/(article|content|post|entry|main|story|body|markdown|prose)/.test(signature)) score *= 1.35;

        candidates.push({ text, score, density, tag });
    }

    candidates.sort((a, b) => b.score - a.score);

    // read after the candidates, not before. A page that is still rendering
    // grows while the walk happens, and an early snapshot made the body look
    // smaller than a container inside it.
    const bodyText = document.body ? textOf(document.body) : "";

    // the density the body fallback has to report. Leaving it at zero hid the
    // fact that a page was nothing but links.
    const bodyDensity = document.body
        ? Math.min(1, linkTextLength(document.body) / Math.max(1, bodyText.length))
        : 1;

    const best = candidates[0];

    let text = bodyText;
    let strategy = "body";
    let density = bodyDensity;

    // only prefer the candidate when it actually holds the bulk of the page,
    // otherwise a sidebar that scored well would throw the article away
    if (best && best.text.length >= Math.min(minCandidate, bodyText.length * 0.25)) {
        text = best.text;
        strategy = best.tag;
        density = best.density;
    }

    return {
        title: (document.title ?? "").trim(),
        text: text.slice(0, maxChars),
        textLength: text.length,
        bodyLength: bodyText.length,
        linkDensity: density,
        strategy
    };
}

/** Pulls result rows out of the DuckDuckGo HTML endpoint, in the page. */
export function extractSearchResultsInPage(limit: number): SearchHarvest {
    const clean = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/g, " ").trim();

    const pageText = clean(document.body?.innerText).toLowerCase();

    const challenged = /unusual traffic|are you a robot|verify you are human|anomaly|captcha/.test(pageText);
    const noResults = /no results found|no results for|did not match any/.test(pageText);

    const hits: SearchHit[] = [];
    const rows = document.querySelectorAll(".result, .web-result, .results_links");

    for (const row of Array.from(rows)) {
        if (hits.length >= limit) break;

        // ads carry the same row classes, so drop them explicitly
        const rowClass = (row.getAttribute("class") ?? "").toLowerCase();
        if (rowClass.includes("result--ad") || rowClass.includes("results_links_sponsored")) continue;

        const anchor = row.querySelector("a.result__a") as HTMLAnchorElement | null;

        if (!anchor) continue;

        const href = anchor.getAttribute("href");

        if (!href) continue;

        hits.push({
            url: href,
            title: clean(anchor.textContent),
            snippet: clean(row.querySelector(".result__snippet")?.textContent)
        });
    }

    // markup fallback: any result anchor at all
    if (hits.length === 0) {
        const anchors = document.querySelectorAll("a.result__a, a[href*='uddg=']");

        for (const anchor of Array.from(anchors)) {
            if (hits.length >= limit) break;

            const href = anchor.getAttribute("href");

            if (!href) continue;

            hits.push({ url: href, title: clean(anchor.textContent), snippet: "" });
        }
    }

    return { hits, noResults, challenged };
}

// ---------------------------------------------------------------------------
// Node side triage
// ---------------------------------------------------------------------------

/** A page that served a wall rather than content. */
const BLOCKED_MARKERS = [
    "by clicking continue to join or sign in",
    "sign in to continue",
    "sign in to see",
    "log in to continue",
    "create an account to continue",
    "please enable javascript",
    "enable javascript and cookies to continue",
    "javascript is required",
    "verify you are human",
    "checking your browser before accessing",
    "are you a robot",
    "unusual traffic from your computer",
    "one more step",
    "ddos protection by",
    "request blocked"
];

/** A page that rendered an error instead of the thing we asked for. */
const ERROR_MARKERS = [
    "page not found",
    "page cannot be found",
    "file not found",
    "404 not found",
    "403 forbidden",
    "500 internal server error",
    "502 bad gateway",
    "503 service unavailable",
    "service unavailable",
    "access denied",
    "this site can't be reached",
    "this page isn't working",
    "temporarily unavailable",
    "something went wrong",
    "an error has occurred",
    "no longer available",
    "has been removed"
];

/**
 * Titles that are *about* an error, rather than titles that merely contain the
 * word. Matching bare "error" rejected articles like "Error Handling in Rust".
 */
const ERROR_TITLE = new RegExp([
    "^\\s*[45]\\d{2}\\b",                      // "404 ...", "503 ..."
    "^\\s*not found\\b",
    "\\b(page|file|content|document) not found\\b",
    "\\b(error|http)\\s*[45]\\d{2}\\b",        // "Error 404", "HTTP 500"
    "\\b[45]\\d{2}\\s*(error|page)\\b",        // "404 Error"
    "\\baccess denied\\b",
    "\\bservice unavailable\\b",
    "\\bsite can.?t be reached\\b",
    "\\bpage (isn.?t|is not) working\\b"
].join("|"), "i");

/** Short pages carrying these phrases are walls. Long ones may just quote them. */
const SHORT_PAGE_LIMIT = 2000;

/**
 * How far in to look for those phrases.
 *
 * An error page or a wall announces itself at the top: that sentence is the
 * whole page. An article that merely mentions "access denied" reaches it
 * partway down. Searching the entire text rejected a real 1300 character
 * article about error handling, so position is part of the evidence.
 */
const LEADING_WINDOW = 500;

/** Below this there is not enough page for position to mean anything. */
const VERY_SHORT = 600;

export type PageVerdict =
    | { usable: true }
    | { usable: false, reason: string };

/**
 * Decides whether an extracted page is worth indexing.
 *
 * Length alone is not enough. A custom 404 can be long, and a login wall can
 * read like prose, so the title and the leading text are checked too.
 */
export function judgePage(page: ExtractedPage, minCharacters: number): PageVerdict {
    const text = page.text.trim();

    if (text.length < minCharacters) return { usable: false, reason: `too short (${text.length} chars)` };

    const haystack = text.toLowerCase();
    const title = page.title.toLowerCase();

    // a short page whose opening line is the phrase, or a page so small that
    // the phrase is most of it
    const announces = (marker: string): boolean =>
        text.length < SHORT_PAGE_LIMIT
        && (haystack.lastIndexOf(marker, LEADING_WINDOW) !== -1 || (text.length < VERY_SHORT && haystack.includes(marker)));

    const blocked = BLOCKED_MARKERS.find(announces);

    if (blocked) return { usable: false, reason: "sign-in or bot check" };

    const errored = ERROR_MARKERS.find(marker => announces(marker) || title.includes(marker));

    if (errored) return { usable: false, reason: `error page (${errored})` };

    // a title of "404" or "Page Not Found" is decisive whatever the length
    if (ERROR_TITLE.test(page.title)) return { usable: false, reason: `error page title (${page.title})` };

    // mostly links means we picked up an index or a tag listing
    if (page.linkDensity > 0.45) return { usable: false, reason: "mostly links" };

    return { usable: true };
}
