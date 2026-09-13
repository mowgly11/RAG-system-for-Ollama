import { Settings } from "llamaindex";
import { Ollama, OllamaEmbedding } from "@llamaindex/ollama";
import input, { loader, stopLoader, closeInput } from "./utils/readline";
import { toDocument, createIndex, indexDataBulk, type IndexBundle } from "./database/chroma/indexer";
import { env } from "./env";
import { getPrompt, toSearchQuery } from "./prompt/prompt";
import executeSeachQueries from "./scraper/searchQueryScraper";
import config from "./config.json";
import getDataFromURLs from "./scraper/dataScraper";
import { withBrowser } from "./scraper/scraper";
import type { ChatHistoryMessage, ConversationSummary } from "./types/types";
import connectMongoDB from "./database/mongodb/mongodb";
import { createConversation, listConversations, loadHistory, saveMessage } from "./database/mongodb/conversations";

const CONVERSATION_LIST_LIMIT = 10;
const TITLE_COLUMN_WIDTH = 44;
const TURN_LIMIT = 999;
const EXIT_WORDS = ["exit", "quit"];

Settings.embedModel = new OllamaEmbedding({
    model: env.EMBEDDING_MODEL,
    config: {
        host: env.OLLAMA_HOST
    }
});

const llm = new Ollama({
    model: env.LLM,
    // without this the answering model ignores OLLAMA_HOST and talks to the
    // library default, so a remote server only half worked
    config: {
        host: env.OLLAMA_HOST
    },
    options: {
        temperature: config.llm_temperature,
        num_ctx: config.context_window_size
    }
});

llm.metadata.contextWindow = config.context_window_size;

Settings.llm = llm;

/**
 * The chat engine can answer with plain text or with a list of content parts.
 * Only the text is worth storing.
 */
function toText(content: unknown): string {
    if (typeof content === "string") return content;

    if (Array.isArray(content)) {
        return content
            .filter((part): part is { type: "text", text: string } =>
                typeof part === "object"
                && part !== null
                && (part as { type?: string }).type === "text"
            )
            .map(part => part.text)
            .join("\n");
    }

    return String(content);
}

/**
 * Pads a title to the picker's column, or shortens it with an ellipsis.
 * Stored titles can be longer than the column, so they are never cut silently.
 */
function fitTitle(title: string): string {
    if (title.length <= TITLE_COLUMN_WIDTH) return title.padEnd(TITLE_COLUMN_WIDTH, " ");

    return title.slice(0, TITLE_COLUMN_WIDTH - 3) + "...";
}

/**
 * Offers the stored conversations, then returns the chat ID to work in.
 * Falls back to a fresh conversation when there is nothing to continue.
 */
async function pickConversation(): Promise<string | null> {
    const listed = await listConversations(CONVERSATION_LIST_LIMIT);

    if (!listed.ok) console.error(listed.error);

    const conversations: ConversationSummary[] = listed.ok ? listed.data : [];

    if (conversations.length > 0) {
        console.log("\nPrevious conversations:\n");

        conversations.forEach((conversation, position) => {
            const label = String(position + 1).padStart(2, " ");
            const title = fitTitle(conversation.title);
            const count = `${conversation.messageCount} messages`.padStart(11, " ");
            const when = conversation.lastMessageAt.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

            console.log(`  ${label}. ${title} ${count}  ${when}`);
        });

        const choice = (await input("\nEnter a number to continue that conversation, or press Enter to start a new one: ")).trim();

        if (choice !== "") {
            const picked = conversations[Number(choice) - 1];

            if (picked) {
                console.log(`\nContinuing "${picked.title}"\n`);
                return picked.chatID;
            }

            console.log("\nThat is not one of the listed conversations. Starting a new one instead.");
        }
    }

    const created = await createConversation();

    if (!created.ok) {
        console.error(created.error);
        return null;
    }

    console.log("\nStarted a new conversation.\n");

    return created.data;
}

/**
 * Searches, scrapes and indexes for one question, using a single browser that
 * is always closed afterwards. Returns the URLs that were indexed.
 */
async function gatherSources(bundle: IndexBundle, queries: string[]): Promise<string[]> {
    console.log(`Searching the web (${queries.length} queries)...`);

    const gathered = await withBrowser(async (session) => {
        const urls = await executeSeachQueries(session, queries);

        if (urls.length === 0) return [];

        console.log(`Reading ${urls.length} pages...`);

        return await getDataFromURLs(session, urls);
    });

    if (!gathered.ok) {
        console.error(gathered.error);
        return [];
    }

    if (gathered.data.length === 0) {
        console.log("No usable pages were found.");
        return [];
    }

    const indexed = await indexDataBulk(
        bundle,
        gathered.data.map(page => toDocument(page.data, page.url))
    );

    if (!indexed.ok) console.error(indexed.error);
    else if (indexed.data.failures > 0) console.error(`${indexed.data.failures} pages could not be indexed`);

    return gathered.data.map(page => page.url);
}

async function main() {
    await connectMongoDB();

    const opened = await createIndex();

    if (!opened.ok) return console.error(opened.error);

    const bundle = opened.data;

    const systemPrompt = getPrompt('system');

    if (!systemPrompt.ok) console.error(systemPrompt.error);

    const chatID = await pickConversation();

    if (!chatID) return;

    const loaded = await loadHistory(chatID);

    if (!loaded.ok) console.error(loaded.error);

    const history: ChatHistoryMessage[] = loaded.ok ? loaded.data : [];

    let turn = 0;

    while (turn < TURN_LIMIT) { // to prevent infinite loops
        turn++;

        const query = (await input("What is your question: ")).trim();

        if (query === "" || EXIT_WORDS.includes(query.toLowerCase())) break;

        const plan = await toSearchQuery(query);

        if (!plan.ok) {
            console.error(plan.error);
            continue;
        }

        const searchPerformed = plan.data.needsSearch && plan.data.queries.length > 0;

        // the spinner only runs around the model call, because search and
        // indexing print progress of their own and the two used to collide
        const sources = searchPerformed ? await gatherSources(bundle, plan.data.queries) : [];

        // written before the model answers, so the question survives a failed reply
        await saveMessage({
            chatID,
            role: "user",
            content: query,
            searchPerformed,
            queries: searchPerformed ? plan.data.queries : []
        });

        // rebuilt each turn so retrieval can widen when fresh pages were just
        // indexed, otherwise they compete with everything indexed before
        const chatEngine = bundle.index.asChatEngine({
            similarityTopK: searchPerformed ? config.similarity_topk_after_search : config.similarity_topk,
            systemPrompt: systemPrompt.ok ? systemPrompt.data : "",
            chatHistory: [...history]
        });

        const loaderID = loader();

        let answer: string;

        try {
            const response = await chatEngine.chat({ message: query });
            answer = toText(response.message.content);
        } catch (err) {
            stopLoader(loaderID);
            console.error("The model failed to answer: " + err);
            continue;
        }

        stopLoader(loaderID);

        console.log(answer);

        history.push({ role: "user", content: query });
        history.push({ role: "assistant", content: answer });

        if (history.length > config.max_replayed_messages) {
            history.splice(0, history.length - config.max_replayed_messages);
        }

        await saveMessage({
            chatID,
            role: "assistant",
            content: answer,
            sources
        });
    }

    console.log(`\nConversation saved. Its chat ID is ${chatID}`);
}

await main();

closeInput();

process.exit(0);
