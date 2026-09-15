export type PromptType = "system" | "query" | "force_query" | "relevance";

export type ReplaceObject = {
    term: string;
    replace: string;
}

/**
 * The project-wide result shape. `ok` is the discriminant: checking it narrows
 * `data` to a real value, so a failed call can no longer be dereferenced by
 * accident. Build these with `utils/returnCreator`.
 */
export type Success<T> = { ok: true, error: null, data: T };
export type Failure = { ok: false, error: string, data: null };
export type FunctionResponse<T = unknown> = Success<T> | Failure;

export type RawData = {
    url: string;
    data: string;
}

/** What the relevance gate decided about one page, and why. */
export type RelevanceVerdict = {
    relevant: boolean;
    reason: string;
}

export type SearchPlan = {
    needsSearch: boolean;
    queries: string[];
}

export type IndexingSummary = {
    successes: number;
    failures: number;
}

export type MessageRole = "user" | "assistant";

/**
 * One stored message, ready to be written to the messages collection.
 * `queries` is filled on user messages, `sources` on assistant replies.
 */
export type MessageRecord = {
    chatID: string;
    role: MessageRole;
    content: string;
    searchPerformed?: boolean;
    queries?: string[];
    sources?: string[];
}

/** A stored message reshaped for the llamaindex chat engine. */
export type ChatHistoryMessage = {
    role: MessageRole;
    content: string;
}

/** A row in the "continue a conversation" picker. */
export type ConversationSummary = {
    chatID: string;
    title: string;
    messageCount: number;
    lastMessageAt: Date;
}
