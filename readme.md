# A3 — Antigravity Agent for Acode

An autonomous AI coding agent plugin for the [Acode](https://acode.app) mobile editor — inspired by Google's Antigravity IDE and Windsurf's agentic workflow. Chat with an AI that can read, edit, and create files in your project, run terminal commands, and plan multi-step tasks — all with your explicit approval before anything changes.

## ✨ Features

- **Multi-provider support** — Gemini, Claude, OpenAI, OpenRouter, AgentRouter (built-in), plus unlimited custom OpenAI-compatible endpoints (Ollama, DeepSeek, local models, etc.)
- **Agentic file editing** — the agent can list, read, edit, create, rename, and move files in your project
- **Review & Accept safety gate** — every file edit and every terminal command shows a preview and requires your explicit Accept before anything happens
- **Line-by-line diff view** — see exactly what changed, with red/green highlighting
- **Terminal tool** — the agent can run shell commands (via Acode's built-in terminal), always with your approval
- **Task planning** — for complex requests, the agent proposes a step-by-step plan (which you can Allow or Deny) and tracks progress with a live checklist
- **Multi-session chat** — keep separate conversations per project or topic, with search
- **File attachments** — attach any project file as context for your question
- **Markdown rendering** — code blocks, lists, and formatting render properly in the chat
- **Persistent history** — your chats and edit history are saved locally (IndexedDB)
- **Auto-open edited files** — files the agent touches open automatically in the editor

## 🚀 Getting Started

1. Install the plugin from the Acode plugin marketplace (or via a local/remote zip)
2. Open the A3 icon in the sidebar
3. Tap ⚙️ **Settings** and add an API key for at least one provider (Gemini has a free tier and is a good place to start)
4. Open a project folder in Acode ("Open Folder")
5. Start chatting — try one of the ready-made prompts, or ask it to look at your project

## 🔑 API Keys — Please Read

- You need your **own** API key from whichever provider(s) you use (Gemini, Claude, OpenAI, OpenRouter, or AgentRouter). Usage costs (if any) are billed to your own account by that provider — this plugin does not charge anything itself.
- API keys are stored **locally on your device** (in the browser storage Acode uses), scoped to the Acode app. This is **not encrypted at rest** — treat it like any other locally-saved credential. Don't use this plugin on a shared/untrusted device with a key you can't afford to have exposed.

## 🛠️ How the safety model works

Unlike some coding agents that write files immediately, A3 shows you a **preview first**:
- File edits/creations show a before/after diff — you Accept or Reject
- Terminal commands show the exact command — you Run or Cancel
- Multi-step plans show the full plan — you Allow or Deny before any step begins

Nothing touches your files or runs on your device without your explicit tap.

## ⚠️ Known limitations

- No terminal/preview console-reading (Acode doesn't expose a documented API for this yet) — for visual/console bugs, copy-paste the error directly into the chat and ask the agent to diagnose it
- Path-to-shell translation for the terminal tool is best-effort on some storage setups (SAF `content://` URIs); if commands can't find your project folder, ask the agent to run `pwd` to diagnose
- The agent has no memory of a task's progress after Acode is fully restarted mid-way through a plan (chat history persists, but you may need to say "continue" once you reopen)

## 📄 License

MIT — see [LICENSE](LICENSE)

## 🙋 Support / Feedback

Open an issue on GitHub, or reach out:
- GitHub: [@mdarakib25](https://github.com/mdarakib25)
- Email: Mdarakib25@gmail.com
- Telegram: [@MuhammadAbdurRakib](https://t.me/MuhammadAbdurRakib)
- Website: [oursocial.top/u/mdarakib](https://oursocial.top/u/mdarakib)
- Facebook: [mdarakib25](https://www.facebook.com/mdarakib25)

---

See [CHANGELOG.md](changelogs.md) for version history.
