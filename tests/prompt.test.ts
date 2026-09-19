import { describe, test, expect } from "bun:test";
import { getPrompt } from "../prompt/prompt";
import type { PromptType } from "../types/types";

describe("prompt loading", () => {
    test("a missing template returns an error rather than throwing", () => {
        // index.ts checks ok and carries on, so a throw here would end the run
        const prompt = getPrompt("does_not_exist" as PromptType);

        expect(prompt.ok).toBe(false);
        expect(prompt.error).toContain("prompt file");
    });

    test("a path traversal attempt does not read outside the prompts folder", () => {
        const prompt = getPrompt("../../package" as PromptType);

        expect(prompt.ok).toBe(false);
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
});
