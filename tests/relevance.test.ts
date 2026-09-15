import { describe, test, expect } from "bun:test";
import { termOverlap } from "../prompt/relevance";
import config from "../config.json";

const PROBE = new URL("./relevanceProbe.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

async function runProbe(ollamaHost: string): Promise<string> {
    const proc = Bun.spawn(["bun", "run", PROBE], {
        env: { ...process.env as Record<string, string>, OLLAMA_HOST: ollamaHost },
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe"
    });

    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();

    await proc.exited;

    return out + err;
}

describe("term overlap", () => {
    test("a page about the question scores high", () => {
        const overlap = termOverlap(
            "how does binary search work",
            "Binary search halves the remaining range on every step, which is why it runs in logarithmic time."
        );

        expect(overlap).toBeGreaterThan(0.5);
    });

    test("a page about something else scores low", () => {
        const overlap = termOverlap(
            "how does binary search work",
            "The weather in Boston today is mild with light rain expected after midday."
        );

        expect(overlap).toBeLessThan(0.4);
    });

    test("stopwords do not inflate the score", () => {
        // "the", "and", "with" appear everywhere and say nothing about topic
        const overlap = termOverlap(
            "the and with from that this",
            "Completely unrelated text about sailing boats and harbours."
        );

        expect(overlap).toBe(1);
    });

    test("an empty question counts as fully covered", () => {
        expect(termOverlap("", "any text at all")).toBe(1);
    });

    test("an empty page covers nothing", () => {
        expect(termOverlap("binary search algorithm", "")).toBe(0);
    });

    test("matching is case insensitive", () => {
        expect(termOverlap("BINARY SEARCH", "binary search")).toBe(1);
    });

    test("short words are ignored", () => {
        // two letter tokens are noise, not topic
        expect(termOverlap("go to it", "completely unrelated")).toBe(1);
    });

    test("punctuation does not break tokenisation", () => {
        expect(termOverlap("binary-search, algorithm!", "binary search algorithm")).toBe(1);
    });

    test("the score is a fraction of the question's vocabulary", () => {
        // two of four salient terms present
        const overlap = termOverlap("binary search sailing harbour", "binary search explained");

        expect(overlap).toBeCloseTo(0.5, 5);
    });

    test("the configured threshold sits between the two cases", () => {
        const onTopic = termOverlap("how does binary search work", "Binary search halves the range each step.");
        const offTopic = termOverlap("how does binary search work", "Boston weather today, mild with rain.");

        expect(onTopic).toBeGreaterThanOrEqual(config.relevance_overlap_threshold);
        expect(offTopic).toBeLessThan(config.relevance_overlap_threshold);
    });
});

describe("the relevance gate fails open", () => {
    // one probe run, three assertions. Each run waits out the gate's timeout,
    // so spawning it per assertion would double the file's runtime for nothing
    let output = "";

    test("probe an unreachable model", async () => {
        output = await runProbe("http://127.0.0.1:49999");
        expect(output.length).toBeGreaterThan(0);
    }, 60000);

    test("the page is kept", () => {
        // a dropped page is gone without the asker ever learning why, so the
        // gate must never delete sources when it cannot decide
        expect(output).toContain("keep=true");
    });

    test("the reason says the check was unavailable", () => {
        expect(output).toContain("relevance check unavailable");
    });

    test("the turn is not left hanging", () => {
        expect(output).toContain("elapsedUnder30s=true");
    });
});

describe("the relevance gate without a question", () => {
    test("no question means no check", async () => {
        const { shouldKeep } = await import("../prompt/relevance");
        const verdict = await shouldKeep(undefined, "Any Title", "any text");

        expect(verdict.keep).toBe(true);
        expect(verdict.reason).toBe("not checked");
    });
});
