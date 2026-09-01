/**
 * Acode Antigravity Agent (A3)
 * main.js - plugin entry point
 *
 * Major update:
 *  - Multi-session chat (header: + / History / Settings)
 *  - Always Agent Mode (no separate toggle)
 *  - Send/Stop button
 *  - File attachment option
 *  - Welcome screen + ready-made prompts
 *  - Plan Allow/Deny + task checklist progress
 *  - Auto-open edited/created files
 *  - Line-by-line diff highlighting
 */

const PLUGIN_ID = "com.a3.antigravity";

acode.setPluginInit(
  PLUGIN_ID,
  async (baseUrl, $page, { firstInit } = {}) => {
    try {
      const sideBarApps = acode.require("sidebarApps");

      injectStyles(baseUrl);
      await loadScripts(baseUrl, [
        "src/storage.js",
        "src/settings.js",
        "src/apiEngine.js",
        "src/agentTools.js",
        "src/agentLoop.js",
        "src/sessionStore.js",
        "src/diffUtil.js",
        "src/markdownUtil.js",
      ]);

      acode.addIcon("a3-icon", baseUrl + "icon.png");

      sideBarApps.add(
        "a3-icon",
        "a3-agent-panel",
        "A3 Agent",
        (container) => initPanel(container, baseUrl),
        true,
        (container) => initPanel(container, baseUrl)
      );

      console.log(`[A3] Plugin loaded. firstInit: ${firstInit}`);
    } catch (err) {
      console.error("[A3] Init error:", err);
      acode.alert("A3 Agent - Init Error", String(err && err.stack ? err.stack : err));
    }
  }
);

acode.setPluginUnmount(PLUGIN_ID, () => {
  const sideBarApps = acode.require("sidebarApps");
  sideBarApps.remove("a3-agent-panel");
});

// ---------------------------------------------------------------------
// Script/style loader
// ---------------------------------------------------------------------

function loadScripts(baseUrl, relativePaths) {
  return relativePaths.reduce((prevPromise, relPath) => {
    return prevPromise.then(() => loadSingleScript(baseUrl + relPath));
  }, Promise.resolve());
}

function loadSingleScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-a3-src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.dataset.a3Src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

function injectStyles(baseUrl) {
  if (document.getElementById("a3-plugin-styles")) return;
  const link = document.createElement("link");
  link.id = "a3-plugin-styles";
  link.rel = "stylesheet";
  link.href = baseUrl + "style.css";
  document.head.appendChild(link);
}

// ---------------------------------------------------------------------
// Per-session state (module-level — survives panel remounts)
// ---------------------------------------------------------------------

let currentSessionId = null;
let chatHistory = []; // messages of the current session
let isSending = false;
let currentAbortController = null;
let currentTasks = []; // [{ text, status: "pending"|"in_progress"|"done" }]
let attachedFiles = []; // [{ path, content }]

const READY_PROMPTS = [
  "Show the project's file structure",
  "Briefly tell me what features this project has",
  "I want to add a new feature — how should I start?",
  "Review a file and suggest improvements",
];

async function initPanel(container, baseUrl) {
  currentSessionId = await window.A3.SessionStore.ensureActiveSession();
  chatHistory = await window.A3.SessionStore.getSessionMessages(currentSessionId);
  currentTasks = await window.A3.SessionStore.getSessionTasks(currentSessionId);
  attachedFiles = [];
  renderPanel(container, baseUrl);
}

// ---------------------------------------------------------------------
// Main panel render
// ---------------------------------------------------------------------

function renderPanel(container, baseUrl) {
  container.classList.add("a3-panel-container");

  const activeProvider = window.A3 && window.A3.Storage ? window.A3.Storage.getActiveProviderConfig() : null;

  container.innerHTML = `
    <div class="a3-panel">
      <div class="a3-panel-header">
        <span class="a3-panel-title">A3</span>
        <button class="a3-header-btn a3-model-btn" title="Switch model" ${activeProvider ? "" : "disabled"}>🤖</button>
        <button class="a3-header-btn a3-server-check-btn" title="Check server">🌐</button>
        <button class="a3-header-btn a3-new-chat-btn" title="New Chat">+</button>
        <button class="a3-header-btn a3-history-btn" title="History">🕘</button>
        <button class="a3-header-btn a3-settings-btn" title="Settings">⚙️</button>
      </div>
      <div class="a3-panel-body scroll"></div>
      <div class="a3-attach-row"></div>
      <div class="a3-panel-footer">
        <button class="a3-attach-btn" title="Attach file" ${activeProvider ? "" : "disabled"}>📎</button>
        <textarea class="a3-input" placeholder="Ask the agent something..." ${activeProvider ? "" : "disabled"}></textarea>
        <button class="a3-send-btn" ${activeProvider ? "" : "disabled"}>Send</button>
      </div>
    </div>
  `;

  const body = container.querySelector(".a3-panel-body");
  const input = container.querySelector(".a3-input");
  const sendBtn = container.querySelector(".a3-send-btn");
  const attachBtn = container.querySelector(".a3-attach-btn");
  const attachRow = container.querySelector(".a3-attach-row");

  renderBodyContent(body, activeProvider);
  renderAttachRow(attachRow);
  input.value = loadDraft(currentSessionId);

  input.addEventListener("input", () => {
    saveDraft(currentSessionId, input.value);
  });

  container.querySelector(".a3-new-chat-btn").addEventListener("click", async () => {
    const id = await window.A3.SessionStore.createSession();
    currentSessionId = id;
    chatHistory = [];
    currentTasks = [];
    attachedFiles = [];
    renderPanel(container, baseUrl);
  });

  container.querySelector(".a3-history-btn").addEventListener("click", () => {
    renderHistoryView(container, baseUrl);
  });

  container.querySelector(".a3-settings-btn").addEventListener("click", () => {
    try {
      window.A3.renderSettingsView(container, {
        onSave: () => renderPanel(container, baseUrl),
        onCancel: () => renderPanel(container, baseUrl),
      });
    } catch (err) {
      console.error("[A3] Failed to open Settings:", err);
      acode.alert("A3 Agent - Settings Error", String(err && err.stack ? err.stack : err));
    }
  });

  attachBtn.addEventListener("click", () => openFilePicker(container, baseUrl));

  container.querySelector(".a3-model-btn").addEventListener("click", () => openModelSwitcher(container, baseUrl));
  container.querySelector(".a3-server-check-btn").addEventListener("click", () => openServerCheck(container));

  if (!activeProvider) return;

  async function handleSend() {
    if (isSending) return; // clicking while already sending does nothing, the button becomes Stop instead
    const text = input.value.trim();
    if (!text) return;

    let finalText = text;
    if (attachedFiles.length) {
      const attachmentsText = attachedFiles
        .map((f) => `[Attached file: ${f.path}]\n\`\`\`\n${f.content}\n\`\`\``)
        .join("\n\n");
      finalText = attachmentsText + "\n\n" + text;
    }

    chatHistory.push({ role: "user", content: finalText });
    await window.A3.SessionStore.saveSessionMessages(currentSessionId, chatHistory);
    clearDraft(currentSessionId);

    input.value = "";
    attachedFiles = [];
    renderAttachRow(attachRow);

    setSendingState(true, sendBtn, input);
    renderBodyContent(body, activeProvider, true);

    currentAbortController = new AbortController();

    try {
      const finalMessage = await window.A3.runAgentLoop(
        chatHistory,
        {
          sessionTitle: text,
          sessionId: currentSessionId,
          onStep: (step) => {
            chatHistory.push({ role: "assistant", content: `⚙️ ${step.detail}` });
            renderBodyContent(body, activeProvider, true);
          },
          onPlanApproval: async (steps) => {
            const approved = await requestPlanApproval(body, steps);
            if (approved) {
              const stepsText = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
              chatHistory.push({ role: "assistant", content: `📋 Plan (Allowed):\n${stepsText}` });
              await window.A3.SessionStore.saveSessionTasks(currentSessionId, currentTasks);
            } else {
              chatHistory.push({ role: "assistant", content: "📋 Plan Denied." });
            }
            renderBodyContent(body, activeProvider, true);
            return approved;
          },
          onTaskUpdate: (index, status) => {
            if (currentTasks[index]) {
              currentTasks[index].status = status;
              const icon = status === "done" ? "✅" : status === "in_progress" ? "⏳" : "⬜";
              chatHistory.push({ role: "assistant", content: `${icon} Step ${index + 1}: ${currentTasks[index].text}` });
              window.A3.SessionStore.saveSessionTasks(currentSessionId, currentTasks);
              renderBodyContent(body, activeProvider, true);
            }
          },
          onDiffApproval: (diff) => requestDiffApproval(body, diff),
          onCommandApproval: (command) => requestCommandApproval(body, command),
          onFileOpApproval: (description) => requestFileOpApproval(body, description),
        },
        currentAbortController.signal
      );
      chatHistory.push({ role: "assistant", content: finalMessage });
    } catch (err) {
      console.error("[A3] runAgentLoop error:", err);
      if (err && err.name === "AbortError") {
        chatHistory.push({ role: "assistant", content: "⏹️ Stopped." });
      } else {
        chatHistory.push({ role: "assistant", content: `⚠️ Error: ${err.message || err}` });
      }
    } finally {
      currentAbortController = null;
      setSendingState(false, sendBtn, input);
      await window.A3.SessionStore.saveSessionMessages(currentSessionId, chatHistory);
      renderBodyContent(body, activeProvider, false);
      input.focus();
    }
  }

  function handleStop() {
    if (currentAbortController) {
      currentAbortController.abort();
    }
  }

  sendBtn.addEventListener("click", () => {
    if (isSending) handleStop();
    else handleSend();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isSending) handleSend();
    }
  });

  // For the ready-made prompt buttons on the welcome screen (event delegation,
  // because body gets replaced via innerHTML every time)
  body.addEventListener("click", (e) => {
    const btn = e.target.closest(".a3-ready-prompt-btn");
    if (btn) {
      input.value = btn.dataset.prompt;
      input.focus();
    }
  });
}

function setSendingState(sending, sendBtn, input) {
  isSending = sending;
  sendBtn.textContent = sending ? "⏹ Stop" : "Send";
  sendBtn.classList.toggle("a3-stop-btn", sending);
  input.disabled = sending;
}

// ---------------------------------------------------------------------
// Chat body render (welcome / messages / task checklist)
// ---------------------------------------------------------------------

function renderBodyContent(body, activeProvider, loading) {
  if (!activeProvider) {
    body.innerHTML = `
      <p class="a3-empty-state">
        No AI provider has been set up yet.<br/>
        Tap ⚙️ Settings to get started.
      </p>`;
    return;
  }

  const taskHtml = renderTaskChecklistHtml();

  if (chatHistory.length === 0) {
    const label = activeProvider.type === "builtin" ? activeProvider.provider : activeProvider.name || "Custom";
    const promptsHtml = READY_PROMPTS.map(
      (p) => `<button class="a3-ready-prompt-btn" data-prompt="${escapeHtml(p)}">${escapeHtml(p)}</button>`
    ).join("");

    body.innerHTML = `
      <div class="a3-welcome">
        <div class="a3-welcome-title">👋 Welcome to A3 Agent</div>
        <p class="a3-welcome-sub">Active provider: <strong>${escapeHtml(label)}</strong> (${escapeHtml(activeProvider.modelId)})</p>
        <p class="a3-welcome-sub">Type below, or pick a ready-made prompt:</p>
        <div class="a3-ready-prompts">${promptsHtml}</div>
      </div>`;
    return;
  }

  const bubblesHtml = chatHistory
    .map((m) => {
      const isUser = m.role === "user";
      const content = isUser
        ? escapeHtml(m.content)
        : window.A3.MarkdownUtil
        ? window.A3.MarkdownUtil.renderMarkdown(m.content)
        : escapeHtml(m.content);
      return `
        <div class="a3-msg a3-msg-${isUser ? "user" : "assistant"}">
          <div class="a3-msg-bubble">${content}</div>
        </div>`;
    })
    .join("");

  body.innerHTML =
    taskHtml +
    bubblesHtml +
    (loading
      ? `<div class="a3-msg a3-msg-assistant"><div class="a3-msg-bubble a3-msg-loading">Typing...</div></div>`
      : "");

  body.scrollTop = body.scrollHeight;
}

function renderTaskChecklistHtml() {
  if (!currentTasks.length) return "";
  const icon = { pending: "⬜", in_progress: "⏳", done: "✅" };
  const items = currentTasks
    .map((t) => `<li>${icon[t.status] || "⬜"} ${escapeHtml(t.text)}</li>`)
    .join("");
  return `<div class="a3-task-card"><div class="a3-task-title">📋 Task Progress</div><ul class="a3-task-list">${items}</ul></div>`;
}

// ---------------------------------------------------------------------
// Plan Allow/Deny card
// ---------------------------------------------------------------------

function requestPlanApproval(body, steps) {
  return new Promise((resolve) => {
    currentTasks = steps.map((s) => ({ text: s, status: "pending" }));

    const card = document.createElement("div");
    card.className = "a3-diff-card a3-plan-card";
    const stepsHtml = steps.map((s, i) => `<li>${i + 1}. ${escapeHtml(s)}</li>`).join("");
    card.innerHTML = `
      <div class="a3-diff-title">📋 Proposed Plan</div>
      <ol class="a3-plan-steps">${stepsHtml}</ol>
      <div class="a3-diff-actions">
        <button class="a3-diff-reject">Deny</button>
        <button class="a3-diff-accept">Allow</button>
      </div>
    `;
    body.appendChild(card);
    body.scrollTop = body.scrollHeight;

    card.querySelector(".a3-diff-accept").addEventListener("click", () => {
      card.remove();
      resolve(true);
    });
    card.querySelector(".a3-diff-reject").addEventListener("click", () => {
      card.remove();
      currentTasks = [];
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------
// Diff View Artifact (with line-by-line highlighting)
// ---------------------------------------------------------------------

function requestDiffApproval(body, diff) {
  return new Promise((resolve) => {
    const card = document.createElement("div");
    card.className = "a3-diff-card";

    const title = diff.isNew ? `New file will be created: ${escapeHtml(diff.path)}` : `File will be edited: ${escapeHtml(diff.path)}`;

    let bodyHtml;
    if (diff.isNew) {
      bodyHtml = `<pre class="a3-diff-block a3-diff-add">${escapeHtml(diff.after)}</pre>`;
    } else {
      const lineDiff = window.A3.DiffUtil.computeLineDiff(diff.before, diff.after);
      bodyHtml =
        '<pre class="a3-diff-block a3-diff-lines">' +
        lineDiff
          .map((op) => {
            if (op.type === "add") return `<div class="a3-diffline a3-diffline-add">+ ${escapeHtml(op.text)}</div>`;
            if (op.type === "remove") return `<div class="a3-diffline a3-diffline-remove">- ${escapeHtml(op.text)}</div>`;
            if (op.type === "collapsed") return `<div class="a3-diffline a3-diffline-collapsed">${escapeHtml(op.text)}</div>`;
            return `<div class="a3-diffline">  ${escapeHtml(op.text)}</div>`;
          })
          .join("") +
        "</pre>";
    }

    card.innerHTML = `
      <div class="a3-diff-title">${title}</div>
      ${bodyHtml}
      <div class="a3-diff-actions">
        <button class="a3-diff-reject">Reject</button>
        <button class="a3-diff-accept">Accept</button>
      </div>
    `;

    body.appendChild(card);
    body.scrollTop = body.scrollHeight;

    card.querySelector(".a3-diff-accept").addEventListener("click", () => {
      card.remove();
      resolve(true);
    });
    card.querySelector(".a3-diff-reject").addEventListener("click", () => {
      card.remove();
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------
// Command Approval card
// ---------------------------------------------------------------------

function requestCommandApproval(body, command) {
  return new Promise((resolve) => {
    const card = document.createElement("div");
    card.className = "a3-diff-card a3-command-card";

    card.innerHTML = `
      <div class="a3-diff-title">⚠️ Asking permission to run a command</div>
      <pre class="a3-diff-block a3-command-block">${escapeHtml(command)}</pre>
      <div class="a3-diff-actions">
        <button class="a3-diff-reject">Cancel</button>
        <button class="a3-diff-accept">Run</button>
      </div>
    `;

    body.appendChild(card);
    body.scrollTop = body.scrollHeight;

    card.querySelector(".a3-diff-accept").addEventListener("click", () => {
      card.remove();
      resolve(true);
    });
    card.querySelector(".a3-diff-reject").addEventListener("click", () => {
      card.remove();
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------
// File operation (rename/move) approval card
// ---------------------------------------------------------------------

function requestFileOpApproval(body, description) {
  return new Promise((resolve) => {
    const card = document.createElement("div");
    card.className = "a3-diff-card a3-command-card";

    card.innerHTML = `
      <div class="a3-diff-title">📁 ${escapeHtml(description)}</div>
      <div class="a3-diff-actions">
        <button class="a3-diff-reject">Reject</button>
        <button class="a3-diff-accept">Accept</button>
      </div>
    `;

    body.appendChild(card);
    body.scrollTop = body.scrollHeight;

    card.querySelector(".a3-diff-accept").addEventListener("click", () => {
      card.remove();
      resolve(true);
    });
    card.querySelector(".a3-diff-reject").addEventListener("click", () => {
      card.remove();
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------
// History view (list of all sessions, Open/Delete)
// ---------------------------------------------------------------------

async function renderHistoryView(container, baseUrl) {
  const sessions = await window.A3.SessionStore.listSessions();

  container.innerHTML = "";
  container.classList.add("a3-panel-container");

  const header = document.createElement("div");
  header.className = "a3-panel-header";
  const backBtn = document.createElement("button");
  backBtn.className = "a3-header-btn";
  backBtn.textContent = "←";
  const title = document.createElement("span");
  title.className = "a3-panel-title";
  title.textContent = "Chat History";
  header.append(backBtn, title);

  const searchWrap = document.createElement("div");
  searchWrap.className = "a3-history-search-wrap";
  const searchInput = document.createElement("input");
  searchInput.className = "a3-history-search-input";
  searchInput.type = "text";
  searchInput.placeholder = "🔍 Search chats...";
  searchWrap.appendChild(searchInput);

  const body = document.createElement("div");
  body.className = "a3-panel-body scroll";

  function renderRows(filterText) {
    body.innerHTML = "";
    const filtered = filterText
      ? sessions.filter((s) => (s.title || "").toLowerCase().includes(filterText.toLowerCase()))
      : sessions;

    if (!filtered.length) {
      body.innerHTML = `<p class="a3-empty-state">${
        filterText ? "No matches found." : "No chat history yet."
      }</p>`;
      return;
    }

    filtered.forEach((s) => {
      const row = document.createElement("div");
      row.className = "a3-history-row";
      const titleSpan = document.createElement("span");
      titleSpan.className = "a3-history-row-title";
      titleSpan.textContent = s.title || "New Chat";

      const openBtn = document.createElement("button");
      openBtn.className = "a3-history-open-btn";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", async () => {
        window.A3.SessionStore.setActiveSession(s.id);
        currentSessionId = s.id;
        chatHistory = await window.A3.SessionStore.getSessionMessages(s.id);
        currentTasks = await window.A3.SessionStore.getSessionTasks(s.id);
        renderPanel(container, baseUrl);
      });

      const delBtn = document.createElement("button");
      delBtn.className = "a3-history-delete-btn";
      delBtn.textContent = "🗑";
      delBtn.addEventListener("click", async () => {
        await window.A3.SessionStore.deleteSession(s.id);
        renderHistoryView(container, baseUrl); // refresh the list
      });

      row.append(titleSpan, openBtn, delBtn);
      body.appendChild(row);
    });
  }

  searchInput.addEventListener("input", () => renderRows(searchInput.value.trim()));
  renderRows("");

  container.append(header, searchWrap, body);
  backBtn.addEventListener("click", () => renderPanel(container, baseUrl));
}

// ---------------------------------------------------------------------
// Quick Model Switch — change the active provider without going into Settings
// ---------------------------------------------------------------------

function openModelSwitcher(container, baseUrl) {
  const config = window.A3.Storage.getConfig();
  const options = [];

  const BUILTIN_LABELS = { gemini: "Gemini", claude: "Claude", openai: "OpenAI GPT-4o", openrouter: "OpenRouter", agentrouter: "AgentRouter" };
  Object.keys(BUILTIN_LABELS).forEach((key) => {
    const data = config.builtin[key];
    if (data && data.apiKey) {
      options.push({ key: "builtin:" + key, label: BUILTIN_LABELS[key] + " (" + data.modelId + ")" });
    }
  });
  (config.customProviders || []).forEach((cp) => {
    if (cp.baseUrl && cp.modelId) {
      options.push({ key: "custom:" + cp.id, label: (cp.name || "Custom") + " (" + cp.modelId + ")" });
    }
  });

  if (!options.length) {
    window.toast && window.toast("No provider is configured — set one up in Settings first", 3000);
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "a3-file-picker-overlay";
  overlay.innerHTML = `
    <div class="a3-file-picker">
      <div class="a3-file-picker-title">Choose the active provider</div>
      <div class="a3-file-picker-list">
        ${options
          .map(
            (o) =>
              `<div class="a3-file-picker-item ${o.key === config.activeProviderKey ? "a3-file-picker-item-active" : ""}" data-key="${escapeHtml(o.key)}">${
                o.key === config.activeProviderKey ? "✓ " : ""
              }${escapeHtml(o.label)}</div>`
          )
          .join("")}
      </div>
      <button class="a3-file-picker-close">Cancel</button>
    </div>
  `;
  container.appendChild(overlay);

  overlay.querySelector(".a3-file-picker-close").addEventListener("click", () => overlay.remove());
  overlay.querySelectorAll(".a3-file-picker-item").forEach((item) => {
    item.addEventListener("click", () => {
      config.activeProviderKey = item.dataset.key;
      window.A3.Storage.saveConfig(config);
      overlay.remove();
      renderPanel(container, baseUrl);
      window.toast && window.toast("Provider switched", 1500);
    });
  });
}

// ---------------------------------------------------------------------
// Server/Preview Quick Check — see whether a URL responds, via curl
// (runs without an agent-approval card since the user is directly requesting it themself)
// ---------------------------------------------------------------------

function openServerCheck(container) {
  const overlay = document.createElement("div");
  overlay.className = "a3-file-picker-overlay";
  overlay.innerHTML = `
    <div class="a3-file-picker">
      <div class="a3-file-picker-title">🌐 Check a server/URL</div>
      <input type="text" class="a3-input-field a3-server-check-input" placeholder="e.g. http://localhost:8000" />
      <div class="a3-server-check-result"></div>
      <div class="a3-diff-actions">
        <button class="a3-file-picker-close">Close</button>
        <button class="a3-server-check-run a3-diff-accept">Check</button>
      </div>
    </div>
  `;
  container.appendChild(overlay);

  const input = overlay.querySelector(".a3-server-check-input");
  const resultDiv = overlay.querySelector(".a3-server-check-result");
  input.focus();

  overlay.querySelector(".a3-file-picker-close").addEventListener("click", () => overlay.remove());
  overlay.querySelector(".a3-server-check-run").addEventListener("click", async () => {
    const url = input.value.trim();
    if (!url) return;
    resultDiv.textContent = "Checking...";
    try {
      const output = await window.A3.Tools.runCommand(
        `curl -s -o /dev/null -w "HTTP %{http_code}" --max-time 8 "${url}"`,
        true
      );
      resultDiv.textContent = output || "(No response received)";
    } catch (err) {
      resultDiv.textContent = "Error: " + (err.message || err);
    }
  });
}

// ---------------------------------------------------------------------
// File attachment
// ---------------------------------------------------------------------

async function openFilePicker(container, baseUrl) {
  try {
    const files = await window.A3.Tools.listProjectFiles();
    if (!files.length) {
      window.toast && window.toast("No files found in the project", 2000);
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "a3-file-picker-overlay";
    overlay.innerHTML = `
      <div class="a3-file-picker">
        <div class="a3-file-picker-title">Choose a file</div>
        <div class="a3-file-picker-list">
          ${files.map((f) => `<div class="a3-file-picker-item" data-path="${escapeHtml(f)}">${escapeHtml(f)}</div>`).join("")}
        </div>
        <button class="a3-file-picker-close">Cancel</button>
      </div>
    `;
    container.appendChild(overlay);

    overlay.querySelector(".a3-file-picker-close").addEventListener("click", () => overlay.remove());
    overlay.querySelectorAll(".a3-file-picker-item").forEach((item) => {
      item.addEventListener("click", async () => {
        const path = item.dataset.path;
        try {
          const content = await window.A3.Tools.readFileContent(path);
          if (!attachedFiles.find((f) => f.path === path)) {
            attachedFiles.push({ path, content });
          }
          renderAttachRow(container.querySelector(".a3-attach-row"));
        } catch (err) {
          acode.alert("Failed to read the file", String(err.message || err));
        }
        overlay.remove();
      });
    });
  } catch (err) {
    acode.alert("A3 Agent", String(err.message || err));
  }
}

function renderAttachRow(attachRow) {
  if (!attachRow) return;
  if (!attachedFiles.length) {
    attachRow.innerHTML = "";
    attachRow.style.display = "none";
    return;
  }
  attachRow.style.display = "flex";
  attachRow.innerHTML = attachedFiles
    .map(
      (f, i) =>
        `<span class="a3-attach-chip">📄 ${escapeHtml(f.path)} <button class="a3-attach-chip-remove" data-idx="${i}">✕</button></span>`
    )
    .join("");
  attachRow.querySelectorAll(".a3-attach-chip-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      attachedFiles.splice(Number(btn.dataset.idx), 1);
      renderAttachRow(attachRow);
    });
  });
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

// ---------------------------------------------------------------------
// Input draft autosave (per session, in localStorage — this is small,
// transient data so IndexedDB isn't needed, a lightweight localStorage-key
// pattern similar to Rutex's syncInputState())
// ---------------------------------------------------------------------

function draftKey(sessionId) {
  return `a3_draft_${sessionId}`;
}

function saveDraft(sessionId, text) {
  if (!sessionId) return;
  if (text) localStorage.setItem(draftKey(sessionId), text);
  else localStorage.removeItem(draftKey(sessionId));
}

function loadDraft(sessionId) {
  if (!sessionId) return "";
  return localStorage.getItem(draftKey(sessionId)) || "";
}

function clearDraft(sessionId) {
  if (!sessionId) return;
  localStorage.removeItem(draftKey(sessionId));
}
