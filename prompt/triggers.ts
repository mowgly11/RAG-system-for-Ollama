/**
 * Decides whether a question needs the web before the planner model is asked.
 *
 * The previous version was a flat word list: any hit forced a search. That
 * over-fired on ordinary questions, because a single word is weak evidence.
 * "live" appears in "how does live reload work", "results" in "explain the
 * results of a query", "top" in "what is a top-level domain".
 *
 * Signals are weighted instead, and phrases count for more than bare words.
 * Three outcomes come out of it:
 *
 *   force  strong evidence the answer moves. Search without asking.
 *   skip   a plainly definitional question with no currency signal at all.
 *          Nothing is searched and the planner model is never called, which
 *          is the single slowest step in a turn.
 *   ask    anything else. The planner model decides, as before.
 */

export type SearchDecision = "force" | "ask" | "skip";

export type Classification = {
    decision: SearchDecision;
    score: number;
    signals: string[];
}

type Signal = {
    label: string;
    weight: number;
    pattern: RegExp;
}

/** Builds a whole-word alternation. Bare `includes` matched inside other words. */
function words(...terms: string[]): RegExp {
    return new RegExp(`\\b(${terms.join("|")})\\b`, "i");
}

const SIGNALS: Signal[] = [
    // an explicit instruction to go and look. decisive on its own.
    {
        label: "explicit request",
        weight: 4,
        pattern: words("search for", "search the web", "look up", "look online", "check online", "find online", "google it", "on the internet")
    },

    // the answer is pinned to a moment in time
    {
        label: "time sensitive",
        weight: 3,
        pattern: words(
            "right now", "as of today", "as of now", "at the moment", "these days",
            "current", "currently", "latest", "newest", "most recent", "up to date",
            "today", "tonight", "tomorrow", "yesterday", "last night",
            "this week", "this month", "this year", "next week", "next month",
            "so far this", "still"
        )
    },

    // subjects whose facts are never stable
    {
        label: "volatile subject",
        weight: 3,
        pattern: words(
            "weather", "forecast", "temperature", "rainfall",
            "stock price", "share price", "exchange rate", "market cap",
            "score", "scores", "standings", "fixtures", "kickoff",
            "election", "news", "headlines", "outage", "downtime"
        )
    },

    // subjects that move, but slowly enough to need corroboration
    {
        label: "changing subject",
        weight: 2,
        pattern: words(
            "price", "prices", "cost of", "release date", "changelog",
            "version", "release", "roadmap", "deprecated", "end of life",
            "ranking", "rankings", "leaderboard", "availability", "in stock",
            "earnings", "dividend", "revenue", "valuation", "schedule", "trending"
        )
    },

    // an explicit recent or future year
    {
        label: "recent year",
        weight: 2,
        pattern: /\b20(2[5-9]|[3-9]\d)\b/
    },

    // hallmarks of something answerable from general knowledge
    {
        label: "definitional",
        weight: -1,
        pattern: words(
            "what is", "what are", "what does", "what do",
            "do you know", "can you explain",
            "explain", "describe", "define", "definition of", "meaning of",
            "how does", "how do", "how is", "how are", "why does", "why is", "why are",
            "difference between", "compare", "example of", "examples of",
            "pros and cons", "advantages of", "disadvantages of",
            "how to", "write", "summarize", "summarise", "translate", "rewrite"
        )
    }
];

const FORCE_THRESHOLD = 2;
const NEGATIVE_FLOOR = -2;

/**
 * A pasted link's slug is not the asker's wording.
 *
 * Without this, "https://example.com/what-is-the-current-price" scored on
 * "current" and "price" and forced a search, because hyphens are word
 * boundaries like any other.
 */
function withoutURLs(text: string): string {
    return text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ");
}

export function classifyQuestion(message: string): Classification {
    const text = withoutURLs(message).trim();

    const signals: string[] = [];

    let positive = 0;
    let negative = 0;

    for (const signal of SIGNALS) {
        if (!signal.pattern.test(text)) continue;

        signals.push(signal.label);

        if (signal.weight >= 0) positive += signal.weight;
        else negative += signal.weight;
    }

    // one definitional phrase is evidence, four is not four times the evidence
    negative = Math.max(negative, NEGATIVE_FLOOR);

    const score = positive + negative;

    if (score >= FORCE_THRESHOLD) return { decision: "force", score, signals };

    // skip only when nothing at all points at the web and the question names
    // itself as definitional. anything less certain goes to the planner.
    if (positive === 0 && negative < 0) return { decision: "skip", score, signals };

    return { decision: "ask", score, signals };
}
