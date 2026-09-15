import { describe, test, expect } from "bun:test";
import returnCreator from "../utils/returnCreator";

describe("returnCreator", () => {
    test("a success carries the payload and no error", () => {
        const result = returnCreator(null, { value: 42 });

        expect(result.ok).toBe(true);
        expect(result.error).toBeNull();
        expect(result.data).toEqual({ value: 42 });
    });

    test("a failure carries the message and no payload", () => {
        const result = returnCreator("it broke");

        expect(result.ok).toBe(false);
        expect(result.error).toBe("it broke");
        expect(result.data).toBeNull();
    });

    test("checking ok narrows data to a real value", () => {
        const result = returnCreator(null, "payload") as ReturnType<typeof returnCreator<string>>;

        // the point of the union: this is what stops a failed call being
        // dereferenced by accident, which caused two real bugs before
        if (result.ok) expect(result.data.toUpperCase()).toBe("PAYLOAD");
        else throw new Error("should have been ok");
    });

    test("falsy payloads still count as success", () => {
        for (const value of [0, "", false, null]) {
            const result = returnCreator(null, value);
            expect(result.ok).toBe(true);
            expect(result.data).toBe(value as never);
        }
    });
});
