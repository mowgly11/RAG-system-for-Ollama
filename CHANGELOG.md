# Changelog

All notable changes to this project will be documented in this file.

## [Latest] - 2026-08-10

### Added
- **Prompt Management System**: New `getPrompt()` function in `prompt/prompt.ts` for managing and loading prompt templates
  - Supports multiple prompt types (system, query) via `PromptType` enum
  - Implements dynamic prompt replacement via `ReplaceObject` interface
  - Includes error handling and logging for missing or malformed prompt files
- **Enhanced Ollama API Integration**: 
  - Configured `OllamaEmbedding` for semantic search with embeddings
  - Configured `Ollama` LLM instance with temperature settings (0.7) for controlled generation
  - Integrated system prompt into chat engine via `chatEngine.asChatEngine()` with similarity top-k (5)

### Changed
- Updated llamaindex Settings to use Ollama-based embedding and LLM models
- Integrated prompt management into the main chat loop (`index.ts`)
- Chat engine now uses system prompts loaded from template files

### Technical Details
- **Commit Hash**: `676fa81b62089bc4c13f0259524464bd9987087b`
- **Author**: John (mowgly11)
- **Files Modified**:
  - `prompt/prompt.ts` - New prompt management module
  - `index.ts` - Ollama integration and chat engine setup
  - `types/types.ts` - New type definitions (PromptType, ReplaceObject)
  - `prompt/prompts/system.txt` - System prompt template file

---

## Previous Commits

### Update README.md
- Improved documentation and project overview
- Hash: `1c45d74b2986dd8ff82da595ff7eb7d5fa3c8079`

### Add CLI loader spinner and integrate into main
- Added loading spinner feedback for user experience
- Integrated into main chat loop
- Hash: `715c380b5088677243d9ec4ca7ee3cdd2e6edfdf`

### Initialize vector store, add chat loop, add uuid
- Set up vector store for embeddings
- Implemented interactive chat loop
- Added UUID support for tracking
- Hash: `9cd313b238ee07206acdec26e0c6fa31b0b57fd8`

### Add interactive query loop; fix chroma import
- Added interactive prompt for user queries
- Fixed Chroma vector store imports
- Hash: `3be667fc37bfaa37a62d13cbedf4d67cb4454b6b`

### Initialize Chroma storage and index workflow
- Set up Chroma vector database
- Implemented indexing workflow
- Hash: `1ab793e22dc65eb137ce4b8f16855fd48d5a9b4e`

### Added .chroma to gitignore
- Excluded Chroma storage directory from version control
- Hash: `cca8bce13d93be4b692e5fccf1b5493938f849cb`

### Restructure project layout and use env vars
- Reorganized project directory structure
- Implemented environment variable configuration
- Hash: `a5cc7183b7992679791bb6c3e39c75b7ff554783`

### Add docs, env validation, and README updates
- Added comprehensive documentation in docs/ folder
- Implemented environment variable validation
- Updated README with setup instructions
- Hash: `161e0613c405a1afa2d944a7fac14b8de891f6f9`

### Initial commit
- Bootstrap project structure
- Hash: `a64cf6eb64e6183d5549a842a0fa3e0d7ad34d00`
