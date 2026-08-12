import fs from 'fs';
import path from 'path';
import type { PromptType, ReplaceObject } from '../types/types';
import { Logger } from "@mowgly11/node-logger-js";
import ollama from "ollama";
import { z } from 'zod';

const SearchQueriesSchema = z.object({
    queries: z
        .array(z.string())
        .min(1)
        .max(10)
});

const logger = new Logger('PROMPT INJECTION', 'datetime');

export function getPrompt(type: PromptType, replace: ReplaceObject[] = []): string | null {
    try {
        let promptPath = path.join(__dirname, 'prompts', `${type}.txt`)
        let rawPrompt = fs.readFileSync(promptPath, 'utf-8');

        replace.forEach((rep =>
            rawPrompt = rawPrompt.replaceAll(rep.term, rep.replace)
        ));

        return rawPrompt;
    } catch (err) {
        logger.error("An error has occured while trying to read the prompt file: " + err);
        return null;
    }
}

export async function toSearchQuery(message: string): Promise<Record<string, string[]> | null> {
    try {
        let prompt = getPrompt('query');

        if (prompt == null || prompt === "") prompt = loadDefaultPrompt();

        const response = await ollama.chat({
            model: "llama3.2:1b",
            messages: [
                {
                    role: "system",
                    content: prompt
                },
                {
                    role: "user",
                    content: message
                }
            ],
            options: {
                temperature: 0
            },
            format: z.toJSONSchema(SearchQueriesSchema)
        });

        const parsed = SearchQueriesSchema.parse( // TODO: safe parse this later
            JSON.parse(response.message.content)
        )

        return parsed;
    } catch (err) {
        logger.error("An error has occured while trying to generate the search query: " + err);
        return null;
    }
}

function loadDefaultPrompt() {
    return "Convert the user's request into 1-3 concise web search queries.";
}