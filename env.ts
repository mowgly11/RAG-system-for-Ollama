import {z} from "zod";

const envSchema = z.object({
    LLM: z.string().default("llama3.2:3b"),
    EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
    OLLAMA_HOST: z.url().default("http://127.0.01:11434")
});

const _env = envSchema.safeParse(process.env);

if(!_env.success) throw new Error("Failed to validate env: " + z.treeifyError(_env.error));

export const env = _env.data;