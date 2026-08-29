import fs from 'fs';
import path from 'path';
import type { FunctionResponse, PromptType, ReplaceObject } from '../types/types';
import ollama, { type ChatRequest, type Message } from "ollama";
import { z } from 'zod';
import returnCreator from '../utils/returnCreator';
import { env } from '../env';
import config from "../config.json";

const QUERIES_HARD_LIMIT = 7;

const SEARCH_TRIGGERS = [
    "current",
    "latest",
    "today",
    "now",
    "recent",
    "recently",
    "weather",
    "forecast",
    "price",
    "stock price",
    "score",
    "standings",
    "schedule",
    "availability",
    "version",
    "release",
    "ranking",
    "list",
    "top",
    "popular",
    "trending",
    "news",
    "updates",
    "changes",
    "diff",
    "variance",
    "comparison",
    "benchmark",
    "evaluation",
    "analysis",
    "results",
    "scores",
    "standings",
    "schedule",
    "live",
    "results",
    "stock prices",
    "market trends",
    "earnings",
    "dividends",
    "forecast",
    "current weather",
    "weather updates",
    "weather conditions",
    "latest news",
    "top stories",
    "breaking news",
    "news updates",
    "game results",
    "match history",
    "player stats",
    "team rankings"
];


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
        let result;
        let promptType: PromptType = 'query';

        if (definitelyNeedsSearch(message)) promptType = 'force_query';

        let { error, data } = getPrompt(promptType);
        if (error) return returnCreator(error);

        const response = await queryModel(
            env.QUERY_MODEL,
            [
                {
                    role: "system",
                    content: data
                },
                {
                    role: "user",
                    content: message
                }
            ],
            {
                temperature: config.query_model_temperature
            },
            true
        )

        result = {
            needsSearch: promptType === "force_query" ? true : response.data.parsed.needsSearch,
            queries: response.data.parsed.queries.slice(0, QUERIES_HARD_LIMIT)
        }

        return returnCreator(null, result);
    } catch (err) {
        return returnCreator("An error has occured while trying to generate the search query: " + err);
    }
}

async function queryModel(model: string, messages: Message[], options: ChatRequest["options"], json: boolean = true) {
    try {
        let promptDetails: ChatRequest & { stream?: false } = {
            model,
            messages,
            options
        }

        if (json) promptDetails.format = z.toJSONSchema(SearchPlanSchema);

        const response = await ollama.chat(promptDetails);

        let parsed = json ? SearchPlanSchema.parse( // TODO: safe parse this later
            JSON.parse(response.message.content)
        ) : response.message.content;

        return returnCreator(null, { json, parsed });
    } catch (err) {
        return returnCreator("An error has occured while trying to generate the search query: " + err);
    }
}

function definitelyNeedsSearch(input: string): boolean {
    const text = input.trim().toLowerCase();

    return SEARCH_TRIGGERS.some(trigger => text.includes(trigger));
}