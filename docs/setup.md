# Setup and Running

Prerequisites
- Bun (recommended) installed. See https://bun.sh
- A local Ollama server if you want to run the embeddings/LLM locally (optional if you adapt to another provider)

Install dependencies

```bash
bun install
```

Run the example

```bash
bun run index.ts
```

Notes about configuration
- The project contains an `env.ts` file where environment variables can be validated. At the time of writing `env.ts` appears incomplete; open the file and add any required variables (for example `LLM` or host values) before relying on it.
- `index.ts` configures `Settings.llm` and `Settings.embedModel` using `ollama` and `OllamaEmbedding`. Adjust the `host` in `index.ts` or provide appropriate environment values for your setup.

Running Ollama locally
- If using Ollama locally, ensure the Ollama daemon is running and reachable at the host/port used in `index.ts`.

Troubleshooting
- If the scraper fails to extract content, check that the target site allows headless browsers and that the `puppeteer-real-browser` connection is successful.
- Some source files in the repository contain small typos in host strings and variable names (for example `127.0.01` instead of `127.0.0.1`). Fix those locally if you run into network errors.
