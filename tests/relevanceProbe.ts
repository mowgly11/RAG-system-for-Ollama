/**
 * Spawned by tests/relevance.test.ts with OLLAMA_HOST pointed somewhere dead.
 *
 * A separate process because the Ollama client is built once at import time
 * from the environment, so a single run cannot see two different hosts.
 */
import { shouldKeep } from "../prompt/relevance";

// terms chosen to share nothing with the page, so the cheap overlap check
// cannot settle it and the model path is forced
const QUESTION = "zzqq kkrr mmtt vvxx";
const PAGE = "Binary search halves the remaining range on every step. ".repeat(12);

const started = Date.now();
const verdict = await shouldKeep(QUESTION, "Binary Search", PAGE);

console.log(`keep=${verdict.keep}`);
console.log(`reason=${verdict.reason}`);
console.log(`elapsedUnder30s=${Date.now() - started < 30000}`);
