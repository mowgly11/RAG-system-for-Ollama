import { connect } from "puppeteer-real-browser";
import returnCreator from "../utils/returnCreator";
import { debugStep } from "../utils/debug";
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

export type PageLoad = {
    status: number;
    contentType: string;
    finalUrl: string;
    settled: boolean;
}

/** Heavy resources that never contribute text. Skipping them is most of the speed win. */
const BLOCKED_RESOURCES = new Set(["image", "media", "font", "stylesheet"]);

const HTML_TYPES = ["text/html", "application/xhtml", "text/plain"];

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

    /**
     * Navigates and reports what came back.
     *
     * The response status used to be discarded entirely, so a 404 or a 503 was
     * scraped and indexed as if it were an article. It is checked here, along
     * with the content type, before anything tries to read the page.
     */
    async openPage(url: string, page: ScraperPage): Promise<FunctionResponse<PageLoad>> {
        if (!url.startsWith("https://") && !url.startsWith("http://")) return returnCreator("Invalid given URL");

        let status: number;
        let contentType: string;
        let finalUrl: string;

        try {
            const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.page_timeout_ms });

            if (!response) return returnCreator("The page produced no response");

            status = response.status();
            contentType = String(response.headers()["content-type"] ?? "").toLowerCase();
            finalUrl = response.url();
        } catch (err) {
            return returnCreator("Could not load the page: " + describeNavigationError(err));
        }

        if (status >= 400) return returnCreator(`The site returned HTTP ${status}`);

        // a PDF or an image cannot be read by the text extractor
        if (contentType && !HTML_TYPES.some(type => contentType.includes(type))) {
            return returnCreator(`Unsupported content type (${contentType.split(";")[0]})`);
        }

        const settled = await waitForContent(page, config.min_page_characters, config.content_settle_ms);

        return returnCreator(null, { status, contentType, finalUrl, settled });
    }
}

/**
 * Turns Chrome's network error strings into something a reader can act on.
 */
function describeNavigationError(err: unknown): string {
    const message = String(err);

    if (message.includes("ERR_NAME_NOT_RESOLVED")) return "the domain does not resolve";
    if (message.includes("ERR_CONNECTION_REFUSED")) return "the server refused the connection";
    if (message.includes("ERR_CONNECTION_TIMED_OUT") || message.includes("ERR_TIMED_OUT")) return "the server did not respond";
    if (message.includes("ERR_CERT") || message.includes("ERR_SSL")) return "the certificate could not be verified";
    if (message.includes("ERR_TOO_MANY_REDIRECTS")) return "the site redirected in a loop";
    if (message.includes("ERR_ABORTED")) return "the navigation was aborted";
    if (message.includes("ERR_EMPTY_RESPONSE")) return "the server closed the connection without replying";
    if (message.includes("ERR_UNSAFE_PORT")) return "the port is blocked by the browser";
    if (message.includes("ERR_ADDRESS_UNREACHABLE")) return "the address is unreachable";
    if (message.includes("ERR_INTERNET_DISCONNECTED")) return "there is no network connection";
    if (message.toLowerCase().includes("timeout")) return `navigation timed out after ${config.page_timeout_ms}ms`;

    return message;
}

/**
 * Waits until the page actually has text in it.
 *
 * Server rendered pages satisfy this immediately. A client rendered page has
 * an empty body at DOMContentLoaded and fills in later, which is why those
 * used to be discarded as "too little text". Returns whether the wait was
 * satisfied, since extraction is still worth trying either way.
 */
async function waitForContent(page: ScraperPage, minChars: number, timeoutMs: number): Promise<boolean> {
    try {
        await page.waitForFunction(
            (min: number) => (document.body?.innerText ?? "").trim().length >= min,
            { timeout: timeoutMs, polling: 250 },
            minChars
        );

        return true;
    } catch {
        return false;
    }
}

/**
 * Drops images, fonts, stylesheets and media before they are fetched.
 *
 * None of them carry text, and they dominate load time on a news or weather
 * site. Interception is best effort: if the driver already installed its own
 * handler, scraping continues unblocked rather than failing.
 */
export async function preparePage(page: ScraperPage): Promise<void> {
    page.setDefaultTimeout(config.page_timeout_ms);

    if (!config.block_page_resources) return;

    try {
        await page.setRequestInterception(true);

        page.on("request", request => {
            const handled = (request as { isInterceptResolutionHandled?: () => boolean }).isInterceptResolutionHandled;

            if (handled && handled.call(request)) return;

            if (BLOCKED_RESOURCES.has(request.resourceType())) request.abort().catch(() => { /* raced */ });
            else request.continue().catch(() => { /* raced */ });
        });
    } catch (err) {
        debugStep("resource blocking unavailable", { reason: String(err) });
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
        await preparePage(opened.data.page);

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
