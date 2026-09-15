/**
 * Spawned by tests/debug.test.ts with DEBUG_MODE set either way.
 *
 * It has to be a separate process because the flag is read once at import
 * time, so a single test run cannot observe both states.
 */
import { debugEnabled, debugStep, debugTurn, debugTurnEnd } from "../utils/debug";

console.log("enabled=" + debugEnabled);

debugTurn("probe turn");
debugStep("plain step");
debugStep("with detail", { chars: 12, ok: true });
debugStep("long string", { raw: "x".repeat(300) });
debugStep("long array", { urls: ["a", "b", "c", "d", "e", "f", "g"] });
debugStep("newlines are flattened", { text: "line one\nline two\n\nline three" });
debugTurnEnd();

console.log("done");
