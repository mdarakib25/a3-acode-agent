# Changelog

## 1.0.0

Initial public release.

### Core
- Multi-provider AI chat: Gemini, Claude, OpenAI, OpenRouter, AgentRouter (built-in), plus unlimited custom OpenAI-compatible endpoints (Ollama, DeepSeek, local models, etc.)
- Native function-calling for every provider (no fragile text-parsing protocol)
- Multi-session chat history (searchable), stored locally via IndexedDB
- Quick model switcher and a server/URL status-check tool in the header
- Markdown rendering for agent responses (code blocks, lists, bold)
- Welcome screen with ready-made starter prompts
- Input drafts are autosaved per session
- Send/Stop toggle to cancel an in-flight request

### Agentic capabilities
- File tools: list, read (with optional line range), patch (search/replace), create, rename, and move
- Terminal tool: run shell commands via Acode's built-in Executor, with a mandatory Run/Cancel approval card
- Task planning: for complex requests the agent proposes a step-by-step plan (Allow/Deny required), saved as a `.md` file, with a live checklist (⬜/⏳/✅) tracking progress
- Every file edit and terminal command requires explicit user approval before anything happens (Review & Accept safety model)
- Line-by-line diff view (red/green highlighting) instead of showing whole-file before/after
- Edited/created files automatically open in the editor
- Per-session edit history / audit trail
- Codebase index caching so the agent doesn't need to re-list files on every request

### Known limitations
- No API for reading the in-app preview's console/output — for visual or console bugs, copy-paste the error into chat
- Shell-path resolution for the terminal tool is best-effort on some storage configurations (Android SAF `content://` URIs)
- API keys are stored locally (not encrypted at rest) — see the README for details
- The task checklist doesn't currently persist a fully "resumed" understanding across an app restart mid-task; chat history is kept, but you may need to say "continue" once
