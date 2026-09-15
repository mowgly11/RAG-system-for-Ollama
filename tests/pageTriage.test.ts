import { describe, test, expect } from "bun:test";
import { judgePage, type ExtractedPage } from "../scraper/extract";

const MIN = 200;

function page(overrides: Partial<ExtractedPage> = {}): ExtractedPage {
    return {
        title: "An Ordinary Article",
        text: "word ".repeat(200),
        textLength: 1000,
        bodyLength: 1200,
        linkDensity: 0.1,
        strategy: "article",
        paragraphs: 1,
        headings: 0,
        codeBlocks: 0,
        ...overrides
    };
}

const reason = (over: Partial<ExtractedPage>) => {
    const verdict = judgePage(page(over), MIN);
    return verdict.usable ? null : verdict.reason;
};

describe("page triage: what gets kept", () => {
    test("an ordinary article is usable", () => {
        expect(judgePage(page(), MIN).usable).toBe(true);
    });

    test("an article about errors is kept", () => {
        // the title check must match titles that are about an error, not
        // titles that merely contain the word
        expect(reason({ title: "Error Handling in Rust: A Complete Guide" })).toBeNull();
    });

    test("a long article that quotes a wall phrase is kept", () => {
        expect(reason({ text: "word ".repeat(600) + " access denied " + "word ".repeat(600) })).toBeNull();
    });

    test("a page exactly at the minimum length is kept", () => {
        expect(reason({ text: "x".repeat(MIN) })).toBeNull();
    });

    test("a short article mentioning an error phrase partway down is kept", () => {
        // an error page leads with the phrase. an article reaches it later.
        const text = "word ".repeat(150) + " access denied " + "word ".repeat(100);
        expect(text.length).toBeLessThan(2000);
        expect(reason({ text })).toBeNull();
    });
});

describe("page triage: what gets thrown away", () => {
    test("too short", () => {
        expect(reason({ text: "tiny" })).toContain("too short");
    });

    test("one character under the minimum", () => {
        expect(reason({ text: "x".repeat(MIN - 1) })).toContain("too short");
    });

    test("a 404 title", () => {
        expect(reason({ title: "404 Not Found" })).toContain("error page");
    });

    test("a 'Page Not Found' title", () => {
        expect(reason({ title: "Page Not Found" })).toContain("error page");
    });

    test("an 'Error 500' title", () => {
        expect(reason({ title: "Error 500 - Something broke" })).toContain("error page");
    });

    test("a short error body served with a friendly title", () => {
        expect(reason({ title: "Welcome", text: "Sorry, this page cannot be found. ".repeat(10) })).toContain("error page");
    });

    test("a short sign-in wall", () => {
        expect(reason({ text: "Sign in to continue reading this. ".repeat(10) })).toContain("sign-in or bot check");
    });

    test("a bot check", () => {
        expect(reason({ text: "Checking your browser before accessing the site. ".repeat(8) })).toContain("sign-in or bot check");
    });

    test("a page that is mostly links", () => {
        expect(reason({ linkDensity: 0.8 })).toContain("mostly links");
    });

    test("link density right at the threshold", () => {
        expect(reason({ linkDensity: 0.46 })).toContain("mostly links");
        expect(reason({ linkDensity: 0.44 })).toBeNull();
    });
});

describe("page triage: structure outranks wording", () => {
    // wording is the one thing a page controls freely, so a page built like an
    // article beats a phrase match

    test("a troubleshooting article keeps its alarming title", () => {
        expect(reason({ title: "403 Forbidden: 9 Ways to Fix It", paragraphs: 6, headings: 3 })).toBeNull();
    });

    test("an article titled 'What Does Access Denied Mean' is kept", () => {
        expect(reason({ title: "What Does Access Denied Mean", paragraphs: 5, headings: 2 })).toBeNull();
    });

    test("a writer cannot repel the scraper by opening with an error phrase", () => {
        // the trick: lead with the words, hope to be skipped
        const text = "Access denied. Page not found. Service unavailable. " + "word ".repeat(120);
        expect(reason({ text, paragraphs: 5, headings: 2 })).toBeNull();
    });

    test("code plus a couple of paragraphs is enough structure", () => {
        expect(reason({ title: "Error 500 explained", paragraphs: 2, codeBlocks: 1, headings: 0 })).toBeNull();
    });

    test("one heading and one paragraph is NOT an article", () => {
        // a real error page dressed up with a heading must still be rejected
        expect(reason({ title: "Access Denied", paragraphs: 1, headings: 1 })).toContain("error page");
    });

    test("a wall with a heading is still a wall", () => {
        const text = "Sign in to continue reading this article. ".repeat(7);
        expect(reason({ text, paragraphs: 1, headings: 1 })).toContain("sign-in or bot check");
    });

    test("structure does not rescue a page that is mostly links", () => {
        expect(reason({ paragraphs: 9, headings: 4, linkDensity: 0.8 })).toContain("mostly links");
    });

    test("structure does not rescue a page with no text", () => {
        expect(reason({ text: "tiny", paragraphs: 9, headings: 4 })).toContain("too short");
    });
});

describe("page triage: known blind spot", () => {
    test("a long login wall gets through, by design", () => {
        // marker checks only apply to short pages, because a real article may
        // quote these phrases. A wall padded past the limit is not caught.
        const padded = "Sign in to continue reading this article. " + "word ".repeat(600);
        expect(judgePage(page({ text: padded }), MIN).usable).toBe(true);
    });
});

describe("page triage: malformed input", () => {
    test("an empty title does not throw", () => {
        expect(() => judgePage(page({ title: "" }), MIN)).not.toThrow();
    });

    test("regex metacharacters in the title are literal", () => {
        expect(() => judgePage(page({ title: "What (.*) [means] in $regex" }), MIN)).not.toThrow();
        expect(reason({ title: "What (.*) [means] in $regex" })).toBeNull();
    });

    test("unicode and emoji text is judged normally", () => {
        expect(reason({ title: "\u{1F600} A Guide", text: "\u{1F680} ".repeat(300) })).toBeNull();
    });

    test("whitespace-only text counts as too short", () => {
        expect(reason({ text: "   \n\n\t   " })).toContain("too short");
    });
});
