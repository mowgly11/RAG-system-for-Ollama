import fs from 'fs';
import path from 'path';
import type { PromptType, ReplaceObject } from '../types/types';
import { Logger } from "@mowgly11/node-logger-js";

const logger = new Logger('PROMPT INJECTION', 'datetime');

export default function getPrompt(type: PromptType, replace: ReplaceObject[] = []): string | null {
    try {
        let promptPath = path.join(__dirname, 'prompt', 'prompts', `${type}.txt`)
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