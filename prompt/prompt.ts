import fs from 'fs';
import path from 'path';
import type { FunctionResponse, PromptType, ReplaceObject, SearchPlan } from '../types/types';
import { Ollama, type ChatRequest, type Message } from "ollama";
import { z } from 'zod';
import returnCreator from '../utils/returnCreator';
import { debugStep } from '../utils/debug';
import { classifyQuestion } from './triggers';
import { env } from '../env';
import config from "../config.json";

const MAX_QUERIES = 8;

// the planner talks to the configured Ollama server, not the library default
const client = new Ollama({ host: env.OLLAMA_HOST });

const SearchPlanSchema = z.discriminatedUnion("needsSearch", [
    z.object({
        needsSearch: z.literal(false),
        queries: z.array(z.string()).max(0)
    }),

    z.object({
        needsSearch: z.literal(true),
        queries: z.array(z.string()).min(1).max(MAX_QUERIES)
    })
]);

export function getPrompt(type: PromptType, replace: ReplaceObject[] = []): FunctionResponse<string> {
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

export async function toSearchQuery(message: string): Promise<FunctionResponse<SearchPlan>> {
    try {
        const classification = classifyQuestion(message);

        debugStep("search decision", {
            decision: classification.decision,
            score: classification.score,
            signals: classification.signals
        });

        // a plainly definitional question does not need the planner at all,
        // and the planner is the slowest step in a turn
        if (classification.decision === "skip" && config.skip_planner_for_static) {
            return returnCreator(null, { needsSearch: false, queries: [] });
        }

        const forced = classification.decision === "force";
        const promptType: PromptType = forced ? 'force_query' : 'query';

        debugStep("planner prompt chosen", { prompt: promptType, forced });

        const prompt = getPrompt(promptType);

        if (!prompt.ok) return returnCreator(prompt.error);

        const response = await queryModel(
            env.QUERY_MODEL,
            [
                {
                    role: "system",
                    content: prompt.data
                },
                {
                    role: "user",
                    content: message
                }
            ],
            {
                temperature: config.query_model_temperature
            }
        )

        // checked before use: previously a failure here surfaced as a null
        // dereference, which hid the real cause behind a type error
        if (!response.ok) return returnCreator(response.error);

        const plan = response.data;

        debugStep("planner plan parsed", { needsSearch: plan.needsSearch, queries: plan.queries });

        const needsSearch = forced ? true : plan.needsSearch;
        let queries = plan.queries.slice(0, MAX_QUERIES);

        // a forced search with no queries would silently not search, so fall
        // back to the question itself
        if (needsSearch && queries.length === 0) {
            debugStep("forced search fallback", { reason: "model returned no queries" });
            queries = [message.trim()];
        }

        return returnCreator(null, { needsSearch, queries });
    } catch (err) {
        return returnCreator("An error has occured while trying to generate the search query: " + err);
    }
}

async function queryModel(model: string, messages: Message[], options: ChatRequest["options"]): Promise<FunctionResponse<SearchPlan>> {
    let raw: string;

    try {
        const promptDetails: ChatRequest & { stream?: false } = {
            model,
            messages,
            options,
            format: z.toJSONSchema(SearchPlanSchema)
        }

        debugStep("planner model called", { model });

        const response = await client.chat(promptDetails);

        raw = response.message.content;

        debugStep("planner model replied", { raw });
    } catch (err) {
        return returnCreator("The query model could not be reached: " + err);
    }

    let candidate: unknown;

    try {
        candidate = JSON.parse(raw);
    } catch {
        return returnCreator("The query model did not return JSON: " + raw.slice(0, 200));
    }

    const parsed = SearchPlanSchema.safeParse(candidate);

    if (!parsed.success) {
        return returnCreator("The query model returned an unexpected search plan: " + parsed.error.issues.map(issue => issue.message).join("; "));
    }

    return returnCreator(null, { needsSearch: parsed.data.needsSearch, queries: parsed.data.queries });
}
