import { describe, test, expect } from "bun:test";

const PROBE = new URL("./debugProbe.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

async function runProbe(debugMode: string | undefined): Promise<string> {
    const env: Record<string, string> = { ...process.env as Record<string, string> };

    if (debugMode === undefined) delete env.DEBUG_MODE;
    else env.DEBUG_MODE = debugMode;

    const proc = Bun.spawn(["bun", "run", PROBE], {
        env,
        cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
        stdout: "pipe",
        stderr: "pipe"
    });

    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();

    await proc.exited;

    return out + err;
}

describe("debug mode flag", () => {
    test("unset means off, and nothing is logged", async () => {
        const output = await runProbe(undefined);

        expect(output).toContain("enabled=false");
        expect(output).toContain("done");
        expect(output).not.toContain("[debug]");
    }, 30000);

    test("'false' means off, not true", async () => {
        // the trap: every non-empty string is truthy, so a naive boolean
        // coercion would turn "false" into true
        const output = await runProbe("false");

        expect(output).toContain("enabled=false");
        expect(output).not.toContain("[debug]");
    }, 30000);

    test("'0' and 'no' also mean off", async () => {
        for (const value of ["0", "no"]) {
            const output = await runProbe(value);
            expect(output).toContain("enabled=false");
        }
    }, 40000);

    test("'true', '1' and 'yes' mean on", async () => {
        for (const value of ["true", "1", "yes"]) {
            const output = await runProbe(value);
            expect(output).toContain("enabled=true");
            expect(output).toContain("[debug]");
        }
    }, 60000);

    test("an unparseable value is rejected at startup", async () => {
        const output = await runProbe("maybe");

        // better to refuse than to quietly pick a side
        expect(output).not.toContain("enabled=");
    }, 30000);
});

describe("debug output shape", () => {
    let output = "";

    test("collects a sample", async () => {
        output = await runProbe("true");
        expect(output).toContain("[debug]");
    }, 30000);

    test("opens a titled section", () => {
        expect(output).toContain("===== probe turn =====");
    });

    test("every step line carries a duration", () => {
        const stepLines = output.split("\n").filter(line => line.includes("[debug]") && !line.includes("====") && !line.includes("total"));

        expect(stepLines.length).toBeGreaterThan(0);
        for (const line of stepLines) expect(line).toMatch(/\+\d+ms/);
    });

    test("detail is rendered as key=value", () => {
        expect(output).toContain("chars=12");
        expect(output).toContain("ok=true");
    });

    test("a long string is truncated", () => {
        const line = output.split("\n").find(l => l.includes("long string")) ?? "";

        expect(line).toContain("...");
        expect(line.length).toBeLessThan(200);
    });

    test("a long array is summarised rather than printed whole", () => {
        const line = output.split("\n").find(l => l.includes("long array")) ?? "";

        expect(line).toContain("+3");
        expect(line).not.toContain('"g"');
    });

    test("newlines in a value cannot break the line format", () => {
        const line = output.split("\n").find(l => l.includes("newlines are flattened")) ?? "";

        expect(line).toContain("line one line two line three");
    });

    test("the section closes with a total", () => {
        expect(output).toMatch(/total\s+\d+\.\d+s/);
    });
});
