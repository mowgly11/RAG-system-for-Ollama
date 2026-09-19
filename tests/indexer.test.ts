import { describe, test, expect } from "bun:test";
import { toDocument } from "../database/chroma/indexer";

describe("document identity and URL normalization", () => {
    test("the same page reached four ways yields one id", () => {
        const ids = new Set([
            "https://example.com/page",
            "https://example.com/page/",
            "https://example.com/page#top",
            "https://example.com/page?utm_source=twitter"
        ].map(url => toDocument("t", url).id_));

        // one id means one document, which is what keeps re-scrapes from
        // stacking duplicate copies in the vector store
        expect(ids.size).toBe(1);
        expect([...ids][0]).toBe("https://example.com/page");
    });

    test("meaningful query parameters are kept", () => {
        // only utm_* is noise. Dropping q= would merge distinct pages into one
        expect(toDocument("t", "https://example.com/search?q=rust&page=2").id_)
            .toContain("q=rust");
    });

    test("different pages keep different ids", () => {
        expect(toDocument("t", "https://example.com/a").id_)
            .not.toBe(toDocument("t", "https://example.com/b").id_);
    });

    test("a malformed URL falls back to its raw form instead of throwing", () => {
        // this used to throw and take the whole turn down with it
        expect(() => toDocument("t", "not a url at all")).not.toThrow();
        expect(() => toDocument("t", "")).not.toThrow();
    });
});
