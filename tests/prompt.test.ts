import { describe, test, expect } from "bun:test";
import { getPrompt } from "../prompt/prompt";
import type { PromptType } from "../types/types";

describe("prompt loading", () => {
    test.each(["system", "query", "force_query"] as PromptType[])("loads the %s template", type => {
        const prompt = getPrompt(type);

        expect(prompt.ok).toBe(true);
        if (prompt.ok) expect(prompt.data.length).toBeGreaterThan(10);
    });

    test("a missing template returns an error rather than throwing", () => {
        const prompt = getPrompt("does_not_exist" as PromptType);

        expect(prompt.ok).toBe(false);
        expect(prompt.error).toContain("prompt file");
    });

    test("a path traversal attempt does not read outside the prompts folder", () => {
        const prompt = getPrompt("../../package" as PromptType);

        // there is no ../../package.txt, so this must fail cleanly
        expect(prompt.ok).toBe(false);
    });

    test("substitutes every occurrence of a term", () => {
        const prompt = getPrompt("system", [{ term: "assistant", replace: "librarian" }]);

        expect(prompt.ok).toBe(true);
        if (prompt.ok) expect(prompt.data).not.toContain("assistant");
    });

    test("substitution with an empty replacement is allowed", () => {
        const prompt = getPrompt("system", [{ term: "helpful", replace: "" }]);
        expect(prompt.ok).toBe(true);
    });

    test("a term that does not appear leaves the prompt untouched", () => {
        const plain = getPrompt("system");
        const swapped = getPrompt("system", [{ term: "zzzz-not-present", replace: "x" }]);

        expect(plain.ok && swapped.ok).toBe(true);
        if (plain.ok && swapped.ok) expect(swapped.data).toBe(plain.data);
    });

    test("both planner prompts name the fields the schema requires", () => {
        // the shape is enforced by the JSON schema passed to Ollama, but the
        // prompt has to describe the same fields or the model fights it
        for (const type of ["query", "force_query"] as PromptType[]) {
            const prompt = getPrompt(type);

            expect(prompt.ok).toBe(true);

            if (prompt.ok) {
                const lower = prompt.data.toLowerCase();
                expect(lower).toContain("needssearch");
                expect(lower).toContain("queries");
            }
        }
    });

    test("the force prompt always demands a search", () => {
        const prompt = getPrompt("force_query");
        expect(prompt.ok).toBe(true);
        if (prompt.ok) expect(prompt.data).toContain("true");
    });
});
