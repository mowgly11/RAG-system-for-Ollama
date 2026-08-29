import { z } from "zod";

const envSchema = z.object({
    LLM: z.string().default("llama3.2:3b"),
    EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
    QUERY_MODEL: z.string().default("llama3.2:1b"),
    OLLAMA_HOST: z.url().default("http://127.0.0.1:11434"),
    VECTOR_STORE_COLLECTION_NAME: z.string().default('rag_store'),
    TOR_PROXY_URL: z.string().default("socks5://127.0.0.1:9050")
});

const env = envSchema.parse(process.env);

export { env };