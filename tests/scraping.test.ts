import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import Scraper, { preparePage, type ScraperBrowser, type ScraperPage } from "../scraper/scraper";
import { extractArticleInPage, extractSearchResultsInPage, judgePage, NOISE_SELECTOR, type ExtractedPage } from "../scraper/extract";
import config from "../config.json";
import { startLocalServer, type LocalServer } from "./fixtures";

let server: LocalServer;
let browser: ScraperBrowser;

const scraper = new Scraper(true); // headless: local pages have no bot checks to evade

beforeAll(async () => {
    server = startLocalServer();

    const opened = await scraper.openBrowser();

    if (!opened.ok) throw new Error("could not start a browser: " + opened.error);

    browser = opened.data.browser;

    // the page opened with the browser is left alone. Every test gets its own.
    await opened.data.page.close().catch(() => { /* already gone */ });
});

afterAll(async () => {
    await browser?.close().catch(() => { /* already gone */ });
    server?.stop();
});

/**
 * A fresh page per call.
 *
 * Sharing one page across the file meant a single slow navigation left the
 * page mid-flight, and every test after it failed on a page that was still
 * loading something else. A page costs far less than that cascade.
 */
async function withPage<T>(work: (page: ScraperPage) => Promise<T>): Promise<T> {
    const page = await browser.newPage();

    await preparePage(page);

    try {
        return await work(page);
    } finally {
        await page.close().catch(() => { /* already gone */ });
    }
}

const extractFrom = (page: ScraperPage): Promise<ExtractedPage> => page.evaluate(extractArticleInPage, {
    maxChars: config.max_page_characters,
    noise: NOISE_SELECTOR,
    minCandidate: 140
});

const open = (path: string) => withPage(page => scraper.openPage(server.url + path, page));

async function read(path: string): Promise<ExtractedPage> {
    return await withPage(async page => {
        const loaded = await scraper.openPage(server.url + path, page);

        if (!loaded.ok) throw new Error(`${path} failed to load: ${loaded.error}`);

        return await extractFrom(page);
    });
}

// ---------------------------------------------------------------------------

describe("navigation: responses that must never be read", () => {
    test("a 404 is rejected with its status", async () => {
        const loaded = await open("/missing");
        expect(loaded.ok).toBe(false);
        expect(loaded.error).toContain("404");
    });

    test("a 503 is rejected with its status", async () => {
        const loaded = await open("/boom");
        expect(loaded.ok).toBe(false);
        expect(loaded.error).toContain("503");
    });

    test("any 4xx is rejected, not just the familiar ones", async () => {
        const loaded = await open("/teapot");
        expect(loaded.ok).toBe(false);
        expect(loaded.error).toContain("418");
    });

    test("a PDF is rejected on content type", async () => {
        const loaded = await open("/paper.pdf");
        expect(loaded.ok).toBe(false);
        expect(loaded.error).toContain("application/pdf");
    });

    test("JSON is rejected on content type", async () => {
        const loaded = await open("/data.json");
        expect(loaded.ok).toBe(false);
        expect(loaded.error).toContain("application/json");
    });

    test("an invalid scheme never reaches the network", async () => {
        const loaded = await withPage(page => scraper.openPage("ftp://example.com/x", page));
        expect(loaded.ok).toBe(false);
        expect(loaded.error).toContain("Invalid");
    });

    test("a refused connection is reported in plain words", async () => {
        const loaded = await withPage(page => scraper.openPage("http://127.0.0.1:49999/nothing", page));
        expect(loaded.ok).toBe(false);
        expect(loaded.error).toContain("refused");
    });

    test("a domain that does not resolve is reported in plain words", async () => {
        const loaded = await withPage(page => scraper.openPage("https://this-domain-does-not-exist-9c3f.invalid/", page));
        expect(loaded.ok).toBe(false);
        expect(String(loaded.error).toLowerCase()).toMatch(/resolve|unreachable|refused/);
    }, 40000);

    test("a redirect is followed and the final URL reported", async () => {
        const loaded = await open("/redirect-to-wall");
        expect(loaded.ok).toBe(true);
        if (loaded.ok) expect(loaded.data.finalUrl).toContain("/wall-short");
    });
});

describe("navigation: waiting for content", () => {
    test("a server rendered page settles immediately", async () => {
        const loaded = await open("/article");
        expect(loaded.ok).toBe(true);
        if (loaded.ok) expect(loaded.data.settled).toBe(true);
    });

    test("a client rendered page is waited for", async () => {
        const loaded = await open("/spa");
        expect(loaded.ok).toBe(true);
        if (loaded.ok) expect(loaded.data.settled).toBe(true);
    });

    test("text that appears after DOMContentLoaded is extracted", async () => {
        const extracted = await read("/spa");
        expect(extracted.text).toContain("halves the remaining range");
    });

    test("a slow client render inside the settle window is still caught", async () => {
        const extracted = await read("/slow-render");
        expect(extracted.text).toContain("halves the remaining range");
    }, 30000);

    test("a shell that never fills reports that it did not settle", async () => {
        const loaded = await open("/empty-shell");
        expect(loaded.ok).toBe(true);
        if (loaded.ok) expect(loaded.data.settled).toBe(false);
    }, 20000);
});

describe("extraction: finding the main content", () => {
    test("picks the article container rather than the whole body", async () => {
        const extracted = await read("/article");
        expect(extracted.strategy).toBe("article");
    });

    test("keeps the prose", async () => {
        expect((await read("/article")).text).toContain("halves the remaining range");
    });

    test.each([
        ["navigation", "Pricing"],
        ["the footer", "All rights reserved"],
        ["the sidebar", "Related one"],
        ["scripts", "analytics"]
    ])("drops %s", async (_label, needle) => {
        expect((await read("/article")).text).not.toContain(needle);
    });

    test("keeps the page title", async () => {
        expect((await read("/article")).title).toBe("Binary Search Explained");
    });

    test("finds an article buried in wrapper divs", async () => {
        const extracted = await read("/nested");
        expect(extracted.text).toContain("halves the remaining range");
        expect(extracted.text).not.toContain("Pricing");
    });

    test("hidden text is not harvested", async () => {
        const extracted = await read("/hidden-spam");
        expect(extracted.text).toContain("halves the remaining range");
        expect(extracted.text).not.toContain("BUY CHEAP PILLS");
        expect(extracted.text).not.toContain("HIDDEN PROMOTIONAL");
    });

    test("output is capped at max_page_characters", async () => {
        const extracted = await read("/huge");
        expect(extracted.text.length).toBe(config.max_page_characters);
    }, 30000);

    test("unicode, emoji and right to left text survive", async () => {
        const extracted = await read("/unicode");
        expect(extracted.text).toContain("\u{1F680}");
        expect(extracted.text).toContain("مرحبا");
    });
});

describe("extraction feeding triage", () => {
    test("a real article is kept", async () => {
        expect(judgePage(await read("/article"), config.min_page_characters).usable).toBe(true);
    });

    test("an article about errors is kept", async () => {
        expect(judgePage(await read("/about-errors"), config.min_page_characters).usable).toBe(true);
    });

    test("a soft 404 served as 200 is rejected", async () => {
        const verdict = judgePage(await read("/soft404"), config.min_page_characters);
        expect(verdict.usable).toBe(false);
    });

    test("an error body under a friendly title is rejected", async () => {
        const verdict = judgePage(await read("/stealth-error"), config.min_page_characters);
        expect(verdict.usable).toBe(false);
    });

    test("a short sign-in wall is rejected", async () => {
        const verdict = judgePage(await read("/wall-short"), config.min_page_characters);
        expect(verdict.usable).toBe(false);
    });

    test("a link index is rejected", async () => {
        const verdict = judgePage(await read("/linkfarm"), config.min_page_characters);
        expect(verdict.usable).toBe(false);
        if (!verdict.usable) expect(verdict.reason).toContain("links");
    });

    test("an empty shell is rejected", async () => {
        const verdict = judgePage(await read("/empty-shell"), config.min_page_characters);
        expect(verdict.usable).toBe(false);
    }, 20000);
});

describe("extraction: structure is measured, not guessed", () => {
    test("a real article reports its paragraphs, headings and code", async () => {
        const extracted = await read("/troubleshooting");

        expect(extracted.paragraphs).toBeGreaterThanOrEqual(4);
        expect(extracted.headings).toBeGreaterThanOrEqual(2);
        expect(extracted.codeBlocks).toBeGreaterThanOrEqual(1);
    });

    test("an error page reports almost none", async () => {
        const extracted = await read("/dressed-up-error");

        expect(extracted.paragraphs).toBeLessThanOrEqual(1);
        expect(extracted.headings).toBeLessThanOrEqual(1);
        expect(extracted.codeBlocks).toBe(0);
    });

    test("counts come from the chosen container, not the whole document", async () => {
        // the fixture's nav and footer sit outside the article
        const extracted = await read("/troubleshooting");

        expect(extracted.strategy).toBe("article");
        expect(extracted.text).not.toContain("All rights reserved");
    });
});

describe("triage: a title that sounds like an error", () => {
    const verdict = async (path: string) => judgePage(await read(path), config.min_page_characters);

    test("a troubleshooting article survives its own title", async () => {
        // "403 Forbidden: 9 Ways to Fix It" is exactly what someone searching
        // for that error should get back
        expect((await verdict("/troubleshooting")).usable).toBe(true);
    });

    test("an article explaining 'access denied' survives", async () => {
        expect((await verdict("/what-is-access-denied")).usable).toBe(true);
    });

    test("opening with error phrases does not repel the scraper", async () => {
        expect((await verdict("/decoy-opening")).usable).toBe(true);
    });

    test("a genuine error page with one heading is still rejected", async () => {
        const result = await verdict("/dressed-up-error");

        expect(result.usable).toBe(false);
        if (!result.usable) expect(result.reason).toContain("error page");
    });

    test("a login wall with one heading is still rejected", async () => {
        const result = await verdict("/dressed-up-wall");

        expect(result.usable).toBe(false);
        if (!result.usable) expect(result.reason).toContain("sign-in or bot check");
    });
});

describe("search result extraction", () => {
    const harvest = async (path: string) => withPage(async page => {
        const loaded = await scraper.openPage(server.url + path, page);
        expect(loaded.ok).toBe(true);
        return await page.evaluate(extractSearchResultsInPage, 20);
    });

    test("reads organic rows with title and snippet", async () => {
        const found = await harvest("/ddg-poisoned");
        const good = found.hits.find(hit => hit.title === "Good One");

        expect(good).toBeDefined();
        expect(good?.snippet).toBe("the good snippet");
    });

    test("skips sponsored rows", async () => {
        const found = await harvest("/ddg-poisoned");
        expect(found.hits.some(hit => hit.url.includes("ads.example.com"))).toBe(false);
    });

    test("reports a page with no results", async () => {
        const found = await harvest("/ddg-empty");
        expect(found.noResults).toBe(true);
        expect(found.hits.length).toBe(0);
    });

    test("reports a bot challenge", async () => {
        const found = await harvest("/ddg-challenge");
        expect(found.challenged).toBe(true);
    });

    test("respects the requested limit", async () => {
        const found = await withPage(async page => {
            const loaded = await scraper.openPage(server.url + "/ddg-poisoned", page);
            expect(loaded.ok).toBe(true);
            return await page.evaluate(extractSearchResultsInPage, 2);
        });

        expect(found.hits.length).toBeLessThanOrEqual(2);
    });
});
