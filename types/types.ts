export type DataFromURL = {
    error: string | null;
    data: string | null
}

export type PromptType = "system" | "query";

export type ReplaceObject = {
    term: string;
    replace: string;
}

export type FunctionResponse = {
    error: string | null,
    data: any
}