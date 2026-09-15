import { describe, test, expect } from "bun:test";
import { unwrapResultURL, hostOf, rejectionReason } from "../scraper/searchQueryScraper";
import config from "../config.json";

describe("unwrapping DuckDuckGo result links", () => {
    test("reads the real target out of the redirect", () => {
        expect(unwrapResultURL("//duckduckgo.com/l/?uddg=https%3A%2F%2Fnextjs.org%2Fblog&rut=abc"))
            .toBe("https://nextjs.org/blog");
    });

    test("keeps encoded separators inside the target", () => {
        // string surgery on the href corrupted this case
        expect(unwrapResultURL("//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com%2Fp%3Fx%3D1%26rut%3Dkeep&rut=drop"))
            .toBe("https://a.com/p?x=1&rut=keep");
    });

    test("passes a direct link through", () => {
        expect(unwrapResultURL("https://example.com/a")).toBe("https://example.com/a");
    });

    test.each([
        ["a duckduckgo internal link", "//duckduckgo.com/y.js?ad_provider=x"],
        ["a relative link", "/settings"],
        ["a javascript url", "javascript:alert(1)"],
        ["a data url", "data:text/html,<h1>hi</h1>"],
        ["a mailto link", "mailto:someone@example.com"],
        ["junk", "::::"],
        ["an empty string", ""]
    ])("rejects %s", (_label, href) => {
        expect(unwrapResultURL(href)).toBeNull();
    });
});

describe("hostOf", () => {
    test("strips the www prefix and lowercases", () => {
        expect(hostOf("https://WWW.Example.COM/path")).toBe("example.com");
    });

    test("an unparseable url yields an empty host", () => {
        expect(hostOf("not a url")).toBe("");
    });
});

describe("rejecting results before they cost a page load", () => {
    const fresh = () => new Map<string, number>();

    test("an ordinary result is accepted", () => {
        expect(rejectionReason("https://example.com/a", "example.com", fresh())).toBeNull();
    });

    test("a sign-in wall domain is rejected", () => {
        expect(rejectionReason("https://www.linkedin.com/in/someone", "linkedin.com", fresh()))
            .toContain("sign-in wall");
    });

    test("a subdomain of a walled domain is rejected", () => {
        expect(rejectionReason("https://de.linkedin.com/in/someone", "de.linkedin.com", fresh()))
            .toContain("sign-in wall");
    });

    test("a lookalike domain is NOT rejected", () => {
        // notlinkedin.com must not match linkedin.com
        expect(rejectionReason("https://notlinkedin.com/a", "notlinkedin.com", fresh())).toBeNull();
    });

    test.each(["paper.pdf", "sheet.xlsx", "archive.zip", "photo.JPEG", "clip.mp4", "data.csv"])(
        "an unreadable document is rejected: %s",
        filename => {
            expect(rejectionReason(`https://example.com/${filename}`, "example.com", fresh()))
                .toContain("not a readable document");
        }
    );

    test("an extension in a query string still counts", () => {
        expect(rejectionReason("https://example.com/get.pdf?id=1", "example.com", fresh()))
            .toContain("not a readable document");
    });

    test("a path that merely contains 'pdf' is fine", () => {
        expect(rejectionReason("https://example.com/pdf-guide", "example.com", fresh())).toBeNull();
    });

    test("one domain cannot flood the batch", () => {
        const seen = new Map<string, number>([["flood.example.com", config.max_results_per_domain]]);
        expect(rejectionReason("https://flood.example.com/x", "flood.example.com", seen))
            .toContain("already have");
    });

    test("a domain under the cap is still accepted", () => {
        const seen = new Map<string, number>([["ok.example.com", config.max_results_per_domain - 1]]);
        expect(rejectionReason("https://ok.example.com/x", "ok.example.com", seen)).toBeNull();
    });

    test("an unparseable host is rejected", () => {
        expect(rejectionReason("nonsense", "", fresh())).toContain("unparseable");
    });
});
