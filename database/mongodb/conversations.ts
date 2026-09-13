import { v4 as uuidv4 } from "uuid";
import messageModel from "./schemas/messageSchema";
import conversationModel from "./schemas/conversationSchema";
import returnCreator from "../../utils/returnCreator";
import { debugStep } from "../../utils/debug";
import config from "../../config.json";
import type { ChatHistoryMessage, ConversationSummary, FunctionResponse, MessageRecord } from "../../types/types";

const TITLE_MAX_LENGTH = 60;
const DEFAULT_LIST_LIMIT = 10;

function toTitle(content: string): string {
    const clean = content.replace(/\s+/g, " ").trim();

    if (clean.length <= TITLE_MAX_LENGTH) return clean;

    return clean.slice(0, TITLE_MAX_LENGTH - 3) + "...";
}

/**
 * Registers a new chat ID in the conversations collection and returns it.
 * The conversation starts with no title. The first user message fills it in.
 */
export async function createConversation(): Promise<FunctionResponse<string>> {
    try {
        const chatID = uuidv4();

        await conversationModel.create({ chatID, lastMessageAt: new Date() });

        return returnCreator(null, chatID);
    } catch (err) {
        return returnCreator("An error has occured while trying to create a conversation: " + err);
    }
}

/**
 * Most recently used conversations first. Conversations that were opened but
 * never used are skipped so the picker only offers chats that hold something.
 */
export async function listConversations(limit: number = DEFAULT_LIST_LIMIT): Promise<FunctionResponse<ConversationSummary[]>> {
    try {
        const conversations = await conversationModel
            .find({ messageCount: { $gt: 0 } })
            .sort({ lastMessageAt: -1 })
            .limit(limit)
            .lean();

        const summaries: ConversationSummary[] = conversations.map(conversation => ({
            chatID: conversation.chatID,
            title: conversation.title ?? "Untitled conversation",
            messageCount: conversation.messageCount ?? 0,
            lastMessageAt: conversation.lastMessageAt ?? new Date()
        }));

        return returnCreator(null, summaries);
    } catch (err) {
        return returnCreator("An error has occured while trying to list conversations: " + err);
    }
}

/**
 * The tail of a chat, in order, shaped for the llamaindex chat engine.
 *
 * Only the most recent messages are replayed. Feeding back an unbounded
 * history would eventually overflow the model's context window.
 */
export async function loadHistory(chatID: string): Promise<FunctionResponse<ChatHistoryMessage[]>> {
    try {
        const messages = await messageModel
            .find({ chatID })
            .sort({ createdAt: -1 })
            .limit(config.max_replayed_messages)
            .lean();

        const history: ChatHistoryMessage[] = messages
            .reverse()
            .map(message => ({
                role: message.role === "assistant" ? "assistant" : "user",
                content: message.content
            }));

        debugStep("history loaded", { chatID, messages: history.length, cap: config.max_replayed_messages });

        return returnCreator(null, history);
    } catch (err) {
        return returnCreator("An error has occured while trying to load the conversation history: " + err);
    }
}

/**
 * Writes one message and keeps the conversation's counters in step with it.
 */
export async function saveMessage(record: MessageRecord): Promise<FunctionResponse<true>> {
    try {
        await messageModel.create({
            chatID: record.chatID,
            role: record.role,
            content: record.content,
            searchPerformed: record.searchPerformed ?? false,
            queries: record.queries ?? [],
            sources: record.sources ?? []
        });

        await conversationModel.updateOne(
            { chatID: record.chatID },
            { $inc: { messageCount: 1 }, $set: { lastMessageAt: new Date() } }
        );

        // the first thing the user asked becomes the label shown in the picker
        if (record.role === "user") {
            await conversationModel.updateOne(
                { chatID: record.chatID, title: null },
                { $set: { title: toTitle(record.content) } }
            );
        }

        debugStep("message saved", { role: record.role, chars: record.content.length, sources: (record.sources ?? []).length });

        return returnCreator(null, true as const);
    } catch (err) {
        return returnCreator("An error has occured while trying to save a message: " + err);
    }
}
