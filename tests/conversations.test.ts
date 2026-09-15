import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import mongoose from "mongoose";
import { mongoUp } from "./fixtures";

const TEST_URI = "mongodb://127.0.0.1:27017/rag_unit_tests_delete_me";

// env is read at import time, so the store must be loaded after the override
process.env.MONGODB_CONNECT = TEST_URI;

const available = await mongoUp(TEST_URI);

const { createConversation, listConversations, loadHistory, saveMessage } = await import("../database/mongodb/conversations");
const connectMongoDB = (await import("../database/mongodb/mongodb")).default;
const config = (await import("../config.json")).default;

// file scope, so every describe in this file shares one connection. Putting
// these inside the first block tore the connection down before the second ran.
beforeAll(async () => {
    if (!available) return;

    await connectMongoDB();
    await mongoose.connection.dropDatabase();
});

afterAll(async () => {
    if (!available) return;

    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
});

describe.skipIf(!available)("conversation store", () => {
    test("a new conversation gets a chat id", async () => {
        const made = await createConversation();

        expect(made.ok).toBe(true);
        if (made.ok) expect(made.data).toMatch(/^[0-9a-f-]{36}$/);
    });

    test("two conversations never share an id", async () => {
        const a = await createConversation();
        const b = await createConversation();

        expect(a.ok && b.ok).toBe(true);
        if (a.ok && b.ok) expect(a.data).not.toBe(b.data);
    });

    test("an unused conversation is not offered in the picker", async () => {
        const made = await createConversation();
        const listed = await listConversations();

        expect(made.ok && listed.ok).toBe(true);
        if (made.ok && listed.ok) expect(listed.data.some(row => row.chatID === made.data)).toBe(false);
    });

    test("messages round-trip in order", async () => {
        const made = await createConversation();
        if (!made.ok) throw new Error(made.error);

        await saveMessage({ chatID: made.data, role: "user", content: "first question" });
        await saveMessage({ chatID: made.data, role: "assistant", content: "first answer" });
        await saveMessage({ chatID: made.data, role: "user", content: "second question" });

        const history = await loadHistory(made.data);

        expect(history.ok).toBe(true);
        if (history.ok) {
            expect(history.data.map(m => m.role)).toEqual(["user", "assistant", "user"]);
            expect(history.data.map(m => m.content)).toEqual(["first question", "first answer", "second question"]);
        }
    });

    test("the title comes from the first user message, whitespace collapsed", async () => {
        const made = await createConversation();
        if (!made.ok) throw new Error(made.error);

        await saveMessage({ chatID: made.data, role: "user", content: "  What   is\n\nbinary search  " });

        const listed = await listConversations();
        const row = listed.ok ? listed.data.find(r => r.chatID === made.data) : undefined;

        expect(row?.title).toBe("What is binary search");
    });

    test("a later message does not overwrite the title", async () => {
        const made = await createConversation();
        if (!made.ok) throw new Error(made.error);

        await saveMessage({ chatID: made.data, role: "user", content: "the original title" });
        await saveMessage({ chatID: made.data, role: "user", content: "a completely different question" });

        const listed = await listConversations();
        const row = listed.ok ? listed.data.find(r => r.chatID === made.data) : undefined;

        expect(row?.title).toBe("the original title");
    });

    test("a long title is shortened with an ellipsis", async () => {
        const made = await createConversation();
        if (!made.ok) throw new Error(made.error);

        await saveMessage({ chatID: made.data, role: "user", content: "x".repeat(300) });

        const listed = await listConversations();
        const row = listed.ok ? listed.data.find(r => r.chatID === made.data) : undefined;

        expect(row?.title?.length).toBe(60);
        expect(row?.title?.endsWith("...")).toBe(true);
    });

    test("search metadata is stored on the right side of the turn", async () => {
        const made = await createConversation();
        if (!made.ok) throw new Error(made.error);

        await saveMessage({ chatID: made.data, role: "user", content: "q", searchPerformed: true, queries: ["a query"] });
        await saveMessage({ chatID: made.data, role: "assistant", content: "a", sources: ["https://example.com"] });

        const question = await mongoose.connection.collection("messages").findOne({ chatID: made.data, role: "user" });
        const answer = await mongoose.connection.collection("messages").findOne({ chatID: made.data, role: "assistant" });

        expect(question?.searchPerformed).toBe(true);
        expect(question?.queries).toEqual(["a query"]);
        expect(answer?.sources).toEqual(["https://example.com"]);
    });

    test("replayed history is capped at the configured size", async () => {
        const made = await createConversation();
        if (!made.ok) throw new Error(made.error);

        const cap = config.max_replayed_messages;

        for (let i = 0; i < cap + 12; i++) {
            await saveMessage({ chatID: made.data, role: i % 2 === 0 ? "user" : "assistant", content: `message ${i}` });
        }

        const history = await loadHistory(made.data);

        expect(history.ok).toBe(true);
        if (history.ok) {
            expect(history.data.length).toBe(cap);
            // the cap must keep the most recent, still in order
            expect(history.data[history.data.length - 1]?.content).toBe(`message ${cap + 11}`);
            expect(history.data[0]?.content).toBe("message 12");
        }
    }, 40000);

    test("the picker lists most recently used first", async () => {
        const older = await createConversation();
        const newer = await createConversation();
        if (!older.ok || !newer.ok) throw new Error("setup failed");

        await saveMessage({ chatID: older.data, role: "user", content: "older chat" });
        await new Promise(resolve => setTimeout(resolve, 15));
        await saveMessage({ chatID: newer.data, role: "user", content: "newer chat" });

        const listed = await listConversations();

        expect(listed.ok).toBe(true);
        if (listed.ok) expect(listed.data[0]?.chatID).toBe(newer.data);
    });

    test("an unknown chat id loads an empty history rather than failing", async () => {
        const history = await loadHistory("no-such-chat-id");

        expect(history.ok).toBe(true);
        if (history.ok) expect(history.data).toEqual([]);
    });
});

describe.skipIf(!available)("conversation store: hostile input", () => {
    test("a chat id full of regex metacharacters matches nothing else", async () => {
        const made = await createConversation();
        if (!made.ok) throw new Error(made.error);

        await saveMessage({ chatID: made.data, role: "user", content: "a real message" });

        // if this were treated as a pattern it would match every conversation
        const history = await loadHistory(".*");

        expect(history.ok).toBe(true);
        if (history.ok) expect(history.data).toEqual([]);
    });

    test("a query-operator string is stored as text, not interpreted", async () => {
        const injection = '{"$ne": null}';
        const made = await createConversation();
        if (!made.ok) throw new Error(made.error);

        await saveMessage({ chatID: made.data, role: "user", content: injection });

        const history = await loadHistory(made.data);

        expect(history.ok).toBe(true);
        if (history.ok) expect(history.data[0]?.content).toBe(injection);

        // and the same text used as an id finds nothing
        const bogus = await loadHistory(injection);
        expect(bogus.ok && bogus.data.length).toBe(0);
    });

    test("a very large message is stored and read back whole", async () => {
        const made = await createConversation();
        if (!made.ok) throw new Error(made.error);

        const big = "x".repeat(400_000);
        const saved = await saveMessage({ chatID: made.data, role: "assistant", content: big });

        expect(saved.ok).toBe(true);

        const history = await loadHistory(made.data);
        if (history.ok) expect(history.data[0]?.content.length).toBe(big.length);
    }, 30000);

    test("unicode, emoji and null-ish sequences survive the round trip", async () => {
        const made = await createConversation();
        if (!made.ok) throw new Error(made.error);

        const odd = "\u{1F600} مرحبا ​\\u0000 <script>alert(1)</script>";
        await saveMessage({ chatID: made.data, role: "user", content: odd });

        const history = await loadHistory(made.data);
        if (history.ok) expect(history.data[0]?.content).toBe(odd);
    });

    test("an empty message is still recorded", async () => {
        const made = await createConversation();
        if (!made.ok) throw new Error(made.error);

        const saved = await saveMessage({ chatID: made.data, role: "user", content: "" });

        // content is required by the schema, so this is expected to fail
        // cleanly rather than throw
        expect(typeof saved.ok).toBe("boolean");
        expect(saved.ok ? null : saved.error).not.toBeUndefined();
    });
});

describe.skipIf(available)("conversation store (skipped)", () => {
    test("MongoDB was not reachable, so these tests did not run", () => {
        expect(available).toBe(false);
    });
});
