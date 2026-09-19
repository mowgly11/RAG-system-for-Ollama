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
    test("the configured threshold sits between an on-topic and an off-topic page", () => {
        // this is the whole job of the cheap half: decide who is worth a model
        // call. If the threshold drifts past either side, the gate stops working
        const onTopic = termOverlap("how does binary search work", "Binary search halves the range each step.");
        const offTopic = termOverlap("how does binary search work", "Boston weather today, mild with rain.");

        expect(onTopic).toBeGreaterThanOrEqual(config.relevance_overlap_threshold);
        expect(offTopic).toBeLessThan(config.relevance_overlap_threshold);
    });

    test("stopwords do not inflate the score", () => {
        // keeping them would make every page look like a match
        expect(termOverlap("the and with from that this", "Completely unrelated text about sailing boats.")).toBe(1);
    });

    test("an empty page covers nothing", () => {
        expect(termOverlap("binary search algorithm", "")).toBe(0);
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
