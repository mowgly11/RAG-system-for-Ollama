import { describe, test, expect } from "bun:test";
import { toDocument } from "../database/chroma/indexer";

describe("document identity and URL normalization", () => {
    test("the normalized URL is both the id and the metadata", () => {
        const doc = toDocument("some text", "https://example.com/page");

        expect(doc.id_).toBe("https://example.com/page");
        expect(doc.metadata.url).toBe("https://example.com/page");
    });

    test("the fragment is dropped", () => {
        expect(toDocument("t", "https://example.com/page#section-3").id_).toBe("https://example.com/page");
    });

    test("campaign parameters are dropped", () => {
        expect(toDocument("t", "https://example.com/p?utm_source=x&utm_medium=y&utm_campaign=z&id=7").id_)
            .toBe("https://example.com/p?id=7");
    });

    test("a trailing slash is dropped", () => {
        expect(toDocument("t", "https://example.com/page/").id_).toBe("https://example.com/page");
    });

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
    });

    test("meaningful query parameters are kept", () => {
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
        expect(toDocument("t", "not a url at all").id_).toBe("not a url at all");
    });

    test("an empty URL does not throw", () => {
        expect(() => toDocument("t", "")).not.toThrow();
    });

    test("the text is carried onto the document", () => {
        expect(toDocument("the body text", "https://example.com/a").getText()).toBe("the body text");
    });

    test("unicode in the path survives normalization", () => {
        expect(() => toDocument("t", "https://example.com/café")).not.toThrow();
    });

    test("two documents with the same URL but different text differ by hash", () => {
        const a = toDocument("first version", "https://example.com/a");
        const b = toDocument("second version", "https://example.com/a");

        expect(a.id_).toBe(b.id_);
        expect(a.hash).not.toBe(b.hash);
    });
});
