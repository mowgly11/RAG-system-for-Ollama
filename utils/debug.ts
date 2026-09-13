import { env } from "../env";

/**
 * Step logging for the whole question-to-answer workflow, switched on with
 * DEBUG_MODE. Every function here returns immediately when it is off, so the
 * normal path pays nothing for it.
 */
export const debugEnabled: boolean = env.DEBUG_MODE;

const PREFIX = "[debug]";
const MAX_STRING = 70;
const MAX_ITEMS = 4;

let turnStartedAt = 0;
let lastStepAt = 0;

function render(value: unknown): string {
    if (typeof value === "string") {
        const clean = value.replace(/\s+/g, " ").trim();

        return JSON.stringify(clean.length > MAX_STRING ? clean.slice(0, MAX_STRING - 3) + "..." : clean);
    }

    if (Array.isArray(value)) {
        const items = value.slice(0, MAX_ITEMS).map(render);

        if (value.length > MAX_ITEMS) items.push(`...+${value.length - MAX_ITEMS}`);

        return "[" + items.join(", ") + "]";
    }

    return String(value);
}

/** Starts a new timed section and resets the step clock. */
export function debugTurn(label: string): void {
    if (!debugEnabled) return;

    turnStartedAt = Date.now();
    lastStepAt = turnStartedAt;

    console.log(`\n${PREFIX} ===== ${label} =====`);
}

/** One workflow step, timed from the previous step. */
export function debugStep(step: string, detail: Record<string, unknown> = {}): void {
    if (!debugEnabled) return;

    const now = Date.now();

    // a step logged before any debugTurn would otherwise report the whole
    // unix epoch as its duration
    if (lastStepAt === 0) {
        turnStartedAt = now;
        lastStepAt = now;
    }

    const sinceLast = now - lastStepAt;

    lastStepAt = now;

    const pairs = Object.entries(detail)
        .map(([key, value]) => `${key}=${render(value)}`)
        .join(" ");

    console.log(`${PREFIX} ${`+${sinceLast}ms`.padStart(9)}  ${step.padEnd(24)} ${pairs}`.trimEnd());
}

/** Closes a section with its total wall time. */
export function debugTurnEnd(): void {
    if (!debugEnabled) return;

    const seconds = ((Date.now() - turnStartedAt) / 1000).toFixed(2);

    console.log(`${PREFIX} ${"total".padStart(9)}  ${seconds}s`);
}
