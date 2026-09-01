/**
 * src/apiEngine.js
 * Universal API Engine + Native Function-Calling (Phase 2 + Phase 6)
 *
 * This module uses a "unified" internal message format, which agentLoop.js
 * uses, and each provider's own API format is converted right here.
 *
 * Unified message turn shapes:
 *   { role: "system", content: string }
 *   { role: "user", content: string }
 *   { role: "assistant", content: string|null, toolCalls: [{id, name, args}]|null }
 *   { role: "tool_result", toolCallId: string, name: string, content: string }
 *
 * sendMessage(messages, tools?) returns:
 *   { text: string, toolCalls: [{id, name, args}], raw: object }
 * where an empty toolCalls array means the LLM didn't call any tool and gave
 * a plain answer (agentLoop.js treats that as the "final answer").
 *
 * Each provider's function-calling format is different:
 *  - OpenAI-compatible: messages[].tool_calls / role:"tool" + tool_call_id
 *  - Claude: {type:"tool_use"} / {type:"tool_result"} content blocks
 *  - Gemini: {functionCall} / {functionResponse} in parts, no id (matched by name)
 */

(function () {
  async function sendMessage(messages, tools, signal) {
    const active = window.A3.Storage.getActiveProviderConfig();
    if (!active) {
      throw new Error("No provider is configured. Go to Settings and set up a provider.");
    }

    if (active.type === "custom") {
      return callOpenAICompatible(active.baseUrl, active.apiKey, active.modelId, messages, active.headers, tools, signal);
    }

    switch (active.provider) {
      case "openai":
        return callOpenAICompatible("https://api.openai.com/v1", active.apiKey, active.modelId, messages, {}, tools, signal);
      case "openrouter":
        // OpenRouter is fully OpenAI-compatible, so the same adapter is used
        return callOpenAICompatible("https://openrouter.ai/api/v1", active.apiKey, active.modelId, messages, {}, tools, signal);
      case "agentrouter":
        // AgentRouter (agentrouter.org) — a non-profit OpenAI-compatible AI gateway
        return callOpenAICompatible("https://agentrouter.org/v1", active.apiKey, active.modelId, messages, {}, tools, signal);
      case "claude":
        return callClaude(active.apiKey, active.modelId, messages, tools, signal);
      case "gemini":
        return callGemini(active.apiKey, active.modelId, messages, tools, signal);
      default:
        throw new Error("Unknown provider: " + active.provider);
    }
  }

  // ---------------------------------------------------------------------
  // OpenAI-compatible (OpenAI itself + custom/local providers)
  // ---------------------------------------------------------------------

  function toOpenAIMessages(messages) {
    return messages.map((m) => {
      if (m.role === "system") return { role: "system", content: m.content };
      if (m.role === "user") return { role: "user", content: m.content };
      if (m.role === "tool_result") {
        return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      }
      // assistant
      const out = { role: "assistant", content: m.content || null };
      if (m.toolCalls && m.toolCalls.length) {
        out.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) },
        }));
      }
      return out;
    });
  }

  function toOpenAITools(tools) {
    if (!tools || !tools.length) return undefined;
    return tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  async function callOpenAICompatible(baseUrl, apiKey, modelId, messages, extraHeaders, tools, signal) {
    const headers = Object.assign({ "Content-Type": "application/json" }, extraHeaders || {});
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const endpoint = baseUrl.replace(/\/+$/, "").endsWith("/chat/completions")
      ? baseUrl
      : baseUrl.replace(/\/+$/, "") + "/chat/completions";

    const body = {
      model: modelId,
      messages: toOpenAIMessages(messages),
      temperature: 0.7,
      max_tokens: 8000,
    };
    const toolsPayload = toOpenAITools(tools);
    if (toolsPayload) body.tools = toolsPayload;

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    const data = await parseJsonSafely(response);
    if (!response.ok) {
      throw new Error(formatApiError("OpenAI-compatible", response.status, data));
    }

    const message = data?.choices?.[0]?.message || {};
    const toolCalls = (message.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function?.name,
      args: safeJsonParse(tc.function?.arguments),
    }));

    return { text: message.content || "", toolCalls, raw: data };
  }

  // ---------------------------------------------------------------------
  // Anthropic Claude Messages API
  // ---------------------------------------------------------------------

  function toClaudeMessages(messages) {
    const out = [];
    for (const m of messages) {
      if (m.role === "system") continue; // goes separately into the top-level system field
      if (m.role === "user") {
        out.push({ role: "user", content: m.content });
      } else if (m.role === "tool_result") {
        out.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
        });
      } else {
        // assistant
        const blocks = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        if (m.toolCalls && m.toolCalls.length) {
          m.toolCalls.forEach((tc) => {
            blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args || {} });
          });
        }
        out.push({ role: "assistant", content: blocks.length ? blocks : "" });
      }
    }
    return out;
  }

  function toClaudeTools(tools) {
    if (!tools || !tools.length) return undefined;
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  async function callClaude(apiKey, modelId, messages, tools, signal) {
    const systemMsg = messages.find((m) => m.role === "system");

    const body = {
      model: modelId,
      max_tokens: 8000,
      temperature: 0.7,
      system: systemMsg ? systemMsg.content : undefined,
      messages: toClaudeMessages(messages),
    };
    const toolsPayload = toClaudeTools(tools);
    if (toolsPayload) body.tools = toolsPayload;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal,
    });

    const data = await parseJsonSafely(response);
    if (!response.ok) {
      throw new Error(formatApiError("Claude", response.status, data));
    }

    const blocks = data?.content || [];
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const toolCalls = blocks
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, args: b.input || {} }));

    return { text, toolCalls, raw: data };
  }

  // ---------------------------------------------------------------------
  // Google Gemini generateContent API
  // ---------------------------------------------------------------------

  function toGeminiContents(messages) {
    const systemMsg = messages.find((m) => m.role === "system");
    const rest = messages.filter((m) => m.role !== "system");
    const contents = [];
    let firstUserSeen = false;

    for (const m of rest) {
      if (m.role === "user") {
        let text = m.content;
        if (!firstUserSeen && systemMsg) {
          text = `${systemMsg.content}\n\n${text}`;
        }
        firstUserSeen = true;
        contents.push({ role: "user", parts: [{ text }] });
      } else if (m.role === "tool_result") {
        // In Gemini, tool results go under the "function" role, matched by name (no id)
        contents.push({
          role: "function",
          parts: [{ functionResponse: { name: m.name, response: { content: m.content } } }],
        });
      } else {
        // assistant -> "model"
        const parts = [];
        if (m.content) parts.push({ text: m.content });
        if (m.toolCalls && m.toolCalls.length) {
          m.toolCalls.forEach((tc) => {
            const part = { functionCall: { name: tc.name, args: tc.args || {} } };
            // Gemini's thinking-capable models send a thoughtSignature with
            // each functionCall, which must be echoed back exactly on the next
            // turn or you get "Function call is missing a thought_signature".
            // So if we captured it (see callGemini), we add it back here.
            if (tc.thoughtSignature) part.thoughtSignature = tc.thoughtSignature;
            parts.push(part);
          });
        }
        contents.push({ role: "model", parts: parts.length ? parts : [{ text: "" }] });
      }
    }
    return contents;
  }

  function toGeminiTools(tools) {
    if (!tools || !tools.length) return undefined;
    return [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];
  }

  async function callGemini(apiKey, modelId, messages, tools, signal) {
    const body = {
      contents: toGeminiContents(messages),
      generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
    };
    const toolsPayload = toGeminiTools(tools);
    if (toolsPayload) body.tools = toolsPayload;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    const data = await parseJsonSafely(response);
    if (!response.ok) {
      throw new Error(formatApiError("Gemini", response.status, data));
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("\n");
    // Gemini doesn't give an id, so we make one up locally (the tool_result
    // gets matched by name later, so this id is only for our own tracking)
    const toolCalls = parts
      .filter((p) => p.functionCall)
      .map((p, idx) => ({
        id: `gemini_call_${Date.now()}_${idx}`,
        name: p.functionCall.name,
        args: p.functionCall.args || {},
        // captured to be sent back on the next turn (see toGeminiContents)
        thoughtSignature: p.thoughtSignature || p.thought_signature || undefined,
      }));

    return { text, toolCalls, raw: data };
  }

  // ---------------------------------------------------------------------
  // Common helpers
  // ---------------------------------------------------------------------

  async function parseJsonSafely(response) {
    try {
      return await response.json();
    } catch (e) {
      return null;
    }
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text || "{}");
    } catch (e) {
      return {};
    }
  }

  function formatApiError(providerLabel, status, data) {
    const detail =
      data?.error?.message || data?.message || (data ? JSON.stringify(data) : "No details available");
    return `${providerLabel} API error (status ${status}): ${detail}`;
  }

  window.A3 = window.A3 || {};
  window.A3.sendMessage = sendMessage;
})();
