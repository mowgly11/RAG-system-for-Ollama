import fs from 'fs';
import path from 'path';
import type { FunctionResponse, PromptType, ReplaceObject } from '../types/types';
import ollama from "ollama";
import { z } from 'zod';
import returnCreator from '../utils/returnCreator';

const SearchPlanSchema = z.discriminatedUnion("needsSearch", [
    z.object({
        needsSearch: z.literal(false),
        queries: z.array(z.string()).max(0)
    }),

    z.object({
        needsSearch: z.literal(true),
        queries: z.array(z.string()).min(1).max(8)
    })
]);

export function getPrompt(type: PromptType, replace: ReplaceObject[] = []): FunctionResponse {
    try {
        let promptPath = path.join(__dirname, 'prompts', `${type}.txt`)
        let rawPrompt = fs.readFileSync(promptPath, 'utf-8');

        replace.forEach((rep =>
            rawPrompt = rawPrompt.replaceAll(rep.term, rep.replace)
        ));

        return returnCreator(null, rawPrompt);
    } catch (err) {
        return returnCreator("An error has occured while trying to read the prompt file: " + err);
    }
}

export async function toSearchQuery(message: string): Promise<FunctionResponse> {
    try {
        let { data } = getPrompt('query');

        const response = await ollama.chat({
            model: "llama3.2:1b",
            messages: [
                {
                    role: "system",
                    content: data
                },
                {
                    role: "user",
                    content: message
                }
            ],
            options: {
                temperature: 0
            },
            format: z.toJSONSchema(SearchPlanSchema)
        });

        const parsed = SearchPlanSchema.parse( // TODO: safe parse this later
            JSON.parse(response.message.content)
        )

        return returnCreator(null, parsed);
    } catch (err) {
        return returnCreator("An error has occured while trying to generate the search query: " + err);
    }
}