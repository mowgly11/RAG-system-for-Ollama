import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import Scraper, { preparePage, type ScraperBrowser, type ScraperPage } from "../scraper/scraper";
import { extractArticleInPage, extractSearchResultsInPage, judgePage, NOISE_SELECTOR, type ExtractedPage } from "../scraper/extract";
import config from "../config.json";
import { startLocalServer, type LocalServer } from "./fixtures";

let server: LocalServer;
let browser: ScraperBrowser;
let page: ScraperPage;

const scraper = new Scraper(true); // headless: local pages have no bot checks to evade

beforeAll(async () => {
    server = startLocalServer();

    const opened = await scraper.openBrowser();

    if (!opened.ok) throw new Error("could not start a browser: " + opened.error);

    browser = opened.data.browser;
    page = opened.data.page;

    await preparePage(page);
});

afterAll(async () => {
    await browser?.close().catch(() => { /* already gone */ });
    server?.stop();
});

const extract = (): Promise<ExtractedPage> => page.evaluate(extractArticleInPage, {
    maxChars: config.max_page_characters,
    noise: NOISE_SELECTOR,
    minCandidate: 140
});

const open = (path: string) => scraper.openPage(server.url + path, page);

async function read(path: string): Promise<ExtractedPage> {
    const loaded = await open(path);
    if (!loaded.ok) throw new Error(`${path} failed to load: ${loaded.error}`);
    return await extract();
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
        const loaded = await scraper.openPage("ftp://example.com/x", page);
        expect(loaded.ok).toBe(false);
        expect(loaded.error).toContain("Invalid");
    });

    test("a refused connection is reported in plain words", async () => {
        const loaded = await scraper.openPage("http://127.0.0.1:49999/nothing", page);
        expect(loaded.ok).toBe(false);
        expect(loaded.error).toContain("refused");
    });

    test("a domain that does not resolve is reported in plain words", async () => {
        const loaded = await scraper.openPage("https://this-domain-does-not-exist-9c3f.invalid/", page);
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

describe("search result extraction", () => {
    const harvest = async (path: string) => {
        const loaded = await open(path);
        expect(loaded.ok).toBe(true);
        return await page.evaluate(extractSearchResultsInPage, 20);
    };

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
        const loaded = await open("/ddg-poisoned");
        expect(loaded.ok).toBe(true);
        const found = await page.evaluate(extractSearchResultsInPage, 2);
        expect(found.hits.length).toBeLessThanOrEqual(2);
    });
});
