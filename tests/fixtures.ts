/**
 * Shared test fixtures.
 *
 * The local server stands in for the web, so the scraping tests are
 * deterministic and need no network. Several of its pages are deliberately
 * hostile: soft errors served as 200, login walls padded out to look like
 * articles, hidden spam, poisoned search markup.
 */

export const PROSE = "Binary search halves the remaining range on every step, which is why it runs in logarithmic time. ";

type Route = {
    status?: number;
    type?: string;
    body: string;
    headers?: Record<string, string>;
    delayMs?: number;
}

function article(title: string, inner: string): string {
    return `<html><head><title>${title}</title></head><body>
        <header><h1>SiteName</h1></header>
        <nav><a href="/a">Home</a><a href="/b">Docs</a><a href="/c">Pricing</a></nav>
        <aside class="sidebar"><a href="/x">Related one</a><a href="/y">Related two</a></aside>
        ${inner}
        <footer>Copyright 2026 SiteName. All rights reserved.</footer>
        <script>var analytics = 1;</script></body></html>`;
}

function ddg(rows: string): string {
    return `<html><body><div id="links" class="results">${rows}</div></body></html>`;
}

function ddgRow(href: string, title: string, snippet = "a snippet", extraClass = ""): string {
    return `<div class="result web-result ${extraClass}"><h2 class="result__title">` +
        `<a class="result__a" href="${href}">${title}</a></h2>` +
        `<a class="result__snippet">${snippet}</a></div>`;
}

export const ROUTES: Record<string, Route> = {
    // ---------- well behaved ----------
    "/article": { body: article("Binary Search Explained", `<article class="post-content"><p>${PROSE.repeat(12)}</p></article>`) },

    "/nested": {
        body: article("Deeply Nested Article",
            `<div><div><div><div class="wrapper"><div><div class="entry-content"><p>${PROSE.repeat(12)}</p></div></div></div></div></div></div>`)
    },

    "/spa": {
        body: `<html><head><title>Client Rendered</title></head><body><div id="root"></div><script>
            setTimeout(function () {
                var a = document.createElement('article');
                a.textContent = ${JSON.stringify(PROSE.repeat(12))};
                document.getElementById('root').appendChild(a);
            }, 600);
        </script></body></html>`
    },

    "/slow-render": {
        body: `<html><head><title>Slow Client Render</title></head><body><div id="root"></div><script>
            setTimeout(function () {
                var a = document.createElement('article');
                a.textContent = ${JSON.stringify(PROSE.repeat(12))};
                document.getElementById('root').appendChild(a);
            }, 2400);
        </script></body></html>`
    },

    // ---------- transport level failures ----------
    "/missing": { status: 404, body: `<html><head><title>404 Not Found</title></head><body><h1>404</h1></body></html>` },
    "/boom": { status: 503, body: `<html><body>Service Unavailable</body></html>` },
    "/teapot": { status: 418, body: `<html><body>I am a teapot</body></html>` },
    "/paper.pdf": { type: "application/pdf", body: "%PDF-1.4 not really a pdf" },
    "/data.json": { type: "application/json", body: `{"not":"html"}` },

    // ---------- traps: an error or a wall dressed up as content ----------
    "/soft404": {
        body: `<html><head><title>Page Not Found</title></head><body><main><p>${"Sorry, the page you requested cannot be found. ".repeat(8)}</p></main></body></html>`
    },

    // a 200 whose title looks fine but whose body is an error
    "/stealth-error": {
        body: `<html><head><title>Welcome</title></head><body><main><p>${"Something went wrong on our end. ".repeat(10)}</p></main></body></html>`
    },

    // short wall: must be rejected
    "/wall-short": {
        body: `<html><head><title>Sign in</title></head><body><main><p>${"Sign in to continue reading this article. ".repeat(8)}</p></main></body></html>`
    },

    // long wall: documented blind spot, marker checks only apply to short pages
    "/wall-long": {
        body: `<html><head><title>Members Only</title></head><body><main><p>Sign in to continue reading this article. ${PROSE.repeat(30)}</p></main></body></html>`
    },

    // an article that merely discusses errors must survive
    "/about-errors": {
        body: article("Error Handling in Rust: A Complete Guide",
            `<article><p>${PROSE.repeat(6)} An access denied message usually means the process lacks permission. ${PROSE.repeat(6)}</p></article>`)
    },

    // a real troubleshooting article. Its title IS an error string, which used
    // to be enough to reject it at any length.
    "/troubleshooting": {
        body: article("403 Forbidden: 9 Ways to Fix It",
            `<article class="post-content">
                <h1>403 Forbidden: 9 Ways to Fix It</h1>
                <p>${PROSE.repeat(2)}</p>
                <h2>Check file permissions</h2>
                <p>${PROSE.repeat(2)}</p>
                <pre><code>chmod 644 index.html</code></pre>
                <h2>Check the owner</h2>
                <p>${PROSE.repeat(2)}</p>
                <p>${PROSE.repeat(2)}</p>
            </article>`)
    },

    // same idea, phrased as a question, and the phrase leads the body too
    "/what-is-access-denied": {
        body: article("What Does Access Denied Mean",
            `<article class="entry-content">
                <h1>What Does Access Denied Mean</h1>
                <p>Access denied is the message a server returns when it understood you and refused anyway. ${PROSE.repeat(2)}</p>
                <h2>Common causes</h2>
                <p>${PROSE.repeat(2)}</p>
                <p>${PROSE.repeat(2)}</p>
                <p>${PROSE.repeat(2)}</p>
            </article>`)
    },

    // the trick: a writer opens with an error phrase hoping to repel scrapers,
    // but the page underneath is a real article
    "/decoy-opening": {
        body: article("A Short Guide to Sorting",
            `<article class="post-content">
                <p>Access denied. Page not found. Service unavailable.</p>
                <h2>Sorting in practice</h2>
                <p>${PROSE.repeat(1)}</p>
                <p>${PROSE.repeat(1)}</p>
                <p>${PROSE.repeat(1)}</p>
                <p>${PROSE.repeat(1)}</p>
            </article>`)
    },

    // the other direction: a genuine error page that has been given one
    // heading to look structured. One heading is not an article.
    "/dressed-up-error": {
        body: `<html><head><title>Access Denied</title></head><body><main>
            <h1>Access denied</h1>
            <p>${"You do not have permission to view this page. ".repeat(6)}</p>
        </main></body></html>`
    },

    // a login wall wearing a heading, still only one block of text
    "/dressed-up-wall": {
        body: `<html><head><title>Members</title></head><body><main>
            <h1>Sign in to continue</h1>
            <p>${"Sign in to continue reading this article. ".repeat(7)}</p>
        </main></body></html>`
    },

    "/linkfarm": {
        body: `<html><head><title>Tag Index</title></head><body><main>` +
            Array.from({ length: 70 }, (_, i) => `<a href="/p${i}">Some fairly long link title number ${i}</a> `).join("") +
            `</main></body></html>`
    },

    "/empty-shell": { body: `<html><head><title>Nothing Here</title></head><body><div id="root"></div></body></html>` },

    // hidden text must not reach the index
    "/hidden-spam": {
        body: `<html><head><title>Hidden Spam</title></head><body>
            <article><p>${PROSE.repeat(12)}</p>
            <div style="display:none">BUY CHEAP PILLS NOW ${"spam ".repeat(200)}</div>
            <div aria-hidden="true">HIDDEN PROMOTIONAL TEXT ${"promo ".repeat(200)}</div>
            </article></body></html>`
    },

    // far longer than max_page_characters
    "/huge": { body: article("Huge Page", `<article><p>${PROSE.repeat(1200)}</p></article>`) },

    // unicode, right to left text, zero width joiners, emoji
    "/unicode": {
        body: article("Unicode \u{1F600} Page",
            `<article><p>\u{1F680}\u{1F30D} ​‍ Ceci n'est pas une pipe. مرحبا بالعالم. ${PROSE.repeat(10)}</p></article>`)
    },

    // a redirect that lands on a wall
    "/redirect-to-wall": { status: 302, body: "", headers: { location: "/wall-short" } },

    // never responds in time
    "/hang": { body: article("Too Slow", `<article><p>${PROSE.repeat(12)}</p></article>`), delayMs: 30000 },

    // ---------- traps: poisoned search result markup ----------
    "/ddg-poisoned": {
        body: ddg(
            ddgRow("//duckduckgo.com/l/?uddg=https%3A%2F%2Fads.example.com%2Fbuy", "Sponsored Thing", "ad", "results_links_sponsored") +
            ddgRow("javascript:alert(1)", "Script Link") +
            ddgRow("data:text/html,<h1>hi</h1>", "Data URL") +
            ddgRow("//duckduckgo.com/y.js?ad_provider=x", "DDG Internal") +
            ddgRow("/settings", "Relative Link") +
            ddgRow("//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fsomeone", "A LinkedIn Profile") +
            ddgRow("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpaper.pdf", "A PDF") +
            ddgRow("//duckduckgo.com/l/?uddg=https%3A%2F%2Fflood.example.com%2Fone", "Flood One") +
            ddgRow("//duckduckgo.com/l/?uddg=https%3A%2F%2Fflood.example.com%2Ftwo", "Flood Two") +
            ddgRow("//duckduckgo.com/l/?uddg=https%3A%2F%2Fflood.example.com%2Fthree", "Flood Three") +
            ddgRow("//duckduckgo.com/l/?uddg=https%3A%2F%2Fgood.example.com%2Fone&rut=abc", "Good One", "the good snippet") +
            ddgRow("//duckduckgo.com/l/?uddg=https%3A%2F%2Fother.example.com%2Ftwo", "Good Two")
        )
    },

    "/ddg-empty": { body: `<html><body><div class="no-results">No results found for that query.</div></body></html>` },
    "/ddg-challenge": { body: `<html><body><p>Our systems have detected unusual traffic from your computer network.</p></body></html>` }
};

/**
 * A results page mixing everything the filters and the triage are meant to
 * catch with two pages that should actually survive the whole way through.
 */
function localResults(origin: string): string {
    const link = (target: string) => `//duckduckgo.com/l/?uddg=${encodeURIComponent(target)}&rut=noise`;

    return ddg(
        ddgRow(link("https://ads.example.com/buy"), "Sponsored", "ad", "results_links_sponsored") +
        ddgRow("javascript:alert(1)", "Script Link") +
        ddgRow("/settings", "Relative Link") +
        ddgRow(link("https://www.linkedin.com/in/someone"), "A LinkedIn Profile") +
        ddgRow(link("https://example.com/report.pdf"), "A PDF") +
        ddgRow(link(`${origin}/article`), "The Good Article", "real prose lives here") +
        ddgRow(link(`${origin}/missing`), "A Dead Link") +
        ddgRow(link(`${origin}/soft404`), "A Soft 404") +
        ddgRow(link(`${origin}/wall-short`), "A Sign-in Wall") +
        ddgRow(link(`${origin}/linkfarm`), "A Tag Index") +
        ddgRow(link(`${origin}/nested`), "Another Good Article", "buried in wrappers")
    );
}

export type LocalServer = {
    url: string;
    stop: () => void;
}

export function startLocalServer(): LocalServer {
    const server = Bun.serve({
        port: 0,
        idleTimeout: 60,
        async fetch(request) {
            const requested = new URL(request.url);
            const path = requested.pathname;

            // built per request, because the result links have to point back at
            // this server and the port is only known once it is listening
            if (path === "/ddg-local") {
                return new Response(localResults(requested.origin), {
                    headers: { "content-type": "text/html; charset=utf-8" }
                });
            }

            const route = ROUTES[path];

            if (!route) return new Response("not found", { status: 404 });

            if (route.delayMs) await new Promise(resolve => setTimeout(resolve, route.delayMs));

            return new Response(route.body, {
                status: route.status ?? 200,
                headers: { "content-type": route.type ?? "text/html; charset=utf-8", ...(route.headers ?? {}) }
            });
        }
    });

    return {
        url: `http://127.0.0.1:${server.port}`,
        stop: () => server.stop(true)
    };
}

// ---------------------------------------------------------------------------
// service probes, so tests that need a server skip instead of failing
// ---------------------------------------------------------------------------

async function reachable(url: string): Promise<boolean> {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
        return response.status > 0;
    } catch {
        return false;
    }
}

export async function mongoUp(uri: string): Promise<boolean> {
    try {
        const mongoose = (await import("mongoose")).default;
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
        await mongoose.connection.close();
        return true;
    } catch {
        return false;
    }
}

export const chromaUp = () => reachable("http://localhost:8000/api/v2/heartbeat");
export const ollamaUp = () => reachable("http://127.0.0.1:11434/api/tags");
