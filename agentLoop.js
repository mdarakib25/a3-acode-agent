/**
 * src/agentLoop.js
 * Agent Orchestration Loop
 */

(function () {
  const MAX_ITERATIONS = 10;

  const SYSTEM_PROMPT = `You are A3 (Antigravity Agent), a coding agent that works inside the Acode mobile editor.

Use the tools given to you to complete the user's request. Rules:
- Only for complex/multi-step work (e.g. setting up a new project, changes across multiple files) call the submit_plan tool exactly once at the start to give a plan. For simple work (a quick question, a small file edit, or just asking for information) skip the plan and act directly — you don't need to plan on every message.
- **How to write a plan (Antigravity IDE style):** each step should describe a **feature/task** (e.g. "Add user authentication") — **not a list of files that will be created**.
- **Critical distinction about paths:** the path for read_file_content/patch_file/create_new_file/rename_path/move_path must always be **relative** to the project root — never give an absolute path like "/storage/emulated/0/..." to these tools. Absolute paths are only for run_command.
- Once a plan is given, you cannot move to the next step until the user Allows it (this is handled automatically).
- **Remember the conversation history (resume behavior):** if the conversation already contains messages like "📋 Plan (Allowed)" or "✅/⏳/⬜ Step...", understand that a task was already in progress. If the user says "continue", **do not submit a new plan** — continue from whichever steps are still ⬜/⏳ in the previous plan.
- **Always check whether a file is genuinely new before creating it:** before calling create_new_file (especially when resuming with "continue", or if you're unsure from the project index), verify with list_project_files or read_file_content whether the file already exists. If it does, use patch_file instead of create_new_file (which overwrites the whole file) — otherwise you'll wrongly duplicate/overwrite it.
- After a plan is approved, use update_task_status to mark a step 'in_progress' when you start it, and 'done' when it's finished.
- Before calling patch_file, check the file's current content with read_file_content so the search text matches exactly.
- **Always self-verify after an edit:** after patching/creating a file, if you're not fully sure the change landed correctly, read the file again with read_file_content — especially when making multiple edits to the same file.
- **TRACE IMPORTS (before assuming something is "missing"):** if you can't find a function, variable, or module, don't immediately assume it doesn't exist — first look at that file's import/require statements and read the relevant files with read_file_content to confirm whether it's genuinely missing or defined elsewhere.
- **When writing UI/design code:** if you're writing HTML/CSS/JS or any visual UI code, aim for a modern, clean, polished design (good spacing, typography, color harmony, responsive layout) unless the user specifies otherwise.
- Make as few tool calls as possible at a time; don't re-read the same file repeatedly without need.
- Once the work is done (no more tool calls needed), give the user a short summary directly in plain text.
- Only use run_command for short, single-shot, **one program at a time** commands. In this environment commands do not run inside a shell — so using "cd", "&&", ";", "|" will give a "not found" error. If you need to work in a specific directory, pass that directory's full (absolute) path directly as a command argument.
- **Paths with spaces:** if a path contains a space, you must wrap it in double quotes, otherwise it will be split into two separate arguments and the command will fail.
- **If you get an "Operation not permitted" error:** Android's shared storage doesn't support symlink/chmod. Install/build in the home directory instead, then bring it into the project folder with "cp -r".
- **Be patient with copy/install commands:** copying a large folder can take a few minutes; if a timeout (5 minutes) occurs, let the user know it may still be running in the background.
- Don't use run_command to keep a server running or for interactive commands.
- If you hit a missing tool/package, don't stop — try installing it yourself first, then continue with the main task.
- You have no way to view the browser/preview. You can check whether a local server is responding via curl for the HTTP status, but for visual/console issues ask the user to copy-paste it to you.`;

  const STATUS_PHRASES = {
    listing: ["Looking at the project's file list...", "Checking what files exist...", "Reviewing the folder structure..."],
    reading: ["Reading", "Taking a look", "Checking the content"],
    patching: ["Preparing the proposed edit", "Preparing the change", "Building the edit preview"],
    creating: ["Preparing the new file preview", "Preparing the new file"],
    renaming: ["Asking permission to rename"],
    moving: ["Asking permission to move"],
    command_ask: ["Asking permission to run the command", "Wanting to run this command"],
    command_run: ["Running the command", "Executing"],
  };

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  async function runAgentLoop(conversationHistory, callbacks, signal) {
    const onStep = (callbacks && callbacks.onStep) || function () {};
    const onPlanApproval = (callbacks && callbacks.onPlanApproval) || (async () => true);
    const onTaskUpdate = (callbacks && callbacks.onTaskUpdate) || function () {};
    const onDiffApproval = (callbacks && callbacks.onDiffApproval) || (async () => true);
    const onCommandApproval = (callbacks && callbacks.onCommandApproval) || (async () => true);
    const onFileOpApproval = (callbacks && callbacks.onFileOpApproval) || (async () => true);
    const sessionTitle = (callbacks && callbacks.sessionTitle) || "";
    const sessionId = (callbacks && callbacks.sessionId) || null;

    let systemContent = SYSTEM_PROMPT;

    try {
      const projectPath = window.A3.Tools.getProjectShellPath ? window.A3.Tools.getProjectShellPath() : null;
      if (projectPath) {
        const needsQuote = projectPath.includes(" ");
        systemContent += `\n\nProject root absolute path: ${projectPath}${
          needsQuote ? `\n⚠️ It has spaces — use it quoted: "${projectPath}"` : ""
        }`;
      } else {
        systemContent += `\n\nCouldn't determine the project root's absolute path. Run "pwd" if you need to find it yourself.`;
      }
    } catch (err) {
      console.error("[A3] Failed to fetch project path:", err);
    }

    try {
      const indexSummary = await window.A3.Tools.getCodebaseIndexSummary();
      systemContent += `\n\nProject file index (cached):\n${indexSummary}`;
    } catch (err) {
      console.error("[A3] Failed to fetch codebase index:", err);
    }

    const messages = [{ role: "system", content: systemContent }, ...conversationHistory];
    const tools = window.A3.Tools.TOOL_DEFINITIONS;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (signal && signal.aborted) return "⏹️ Stopped by the user.";

      let result;
      try {
        result = await window.A3.sendMessage(messages, tools, signal);
      } catch (err) {
        if (err && (err.name === "AbortError" || (signal && signal.aborted))) {
          return "⏹️ Stopped by the user.";
        }
        throw err;
      }

      if (!result.toolCalls || result.toolCalls.length === 0) {
        return result.text || "(No response received)";
      }

      messages.push({ role: "assistant", content: result.text || null, toolCalls: result.toolCalls });

      for (const toolCall of result.toolCalls) {
        if (signal && signal.aborted) return "⏹️ Stopped by the user.";
        let resultText;
        try {
          resultText = await executeTool(toolCall, {
            onStep,
            onPlanApproval,
            onTaskUpdate,
            onDiffApproval,
            onCommandApproval,
            onFileOpApproval,
            sessionTitle,
            sessionId,
          });
        } catch (err) {
          resultText = `Tool error: ${err.message || err}`;
          onStep({ type: "error", detail: resultText });
        }
        messages.push({ role: "tool_result", toolCallId: toolCall.id, name: toolCall.name, content: resultText });
      }
    }

    return `⚠️ Reached the maximum number of steps (${MAX_ITERATIONS}) but the agent hasn't finished yet. Please try again with a more specific request.`;
  }

  async function logHistory(cb, path, action, summary) {
    try {
      if (window.A3.EditHistoryStore) {
        await window.A3.EditHistoryStore.addEntry({ sessionId: cb.sessionId, path, action, summary });
      }
    } catch (err) {
      console.error("[A3] Failed to log edit history:", err);
    }
  }

  async function executeTool(toolCall, cb) {
    const Tools = window.A3.Tools;
    const args = toolCall.args || {};

    switch (toolCall.name) {
      case "submit_plan": {
        const steps = Array.isArray(args.steps) ? args.steps : [];
        const approved = await cb.onPlanApproval(steps);
        if (!approved) {
          return "The user did not Allow this plan. Don't start the work — ask the user what they'd like changed.";
        }
        try {
          await Tools.savePlanFile(cb.sessionTitle, steps);
        } catch (err) {
          console.error("[A3] Failed to save plan file:", err);
        }
        return "The user Allowed the plan. Start from the first step now, and report progress with update_task_status for each step.";
      }

      case "update_task_status": {
        cb.onTaskUpdate(args.index, args.status);
        return "Task status updated.";
      }

      case "list_project_files": {
        cb.onStep({ type: "tool", detail: pick(STATUS_PHRASES.listing) });
        const files = await Tools.listProjectFiles();
        return files.length ? files.join("\n") : "(No files found in the project)";
      }

      case "read_file_content": {
        cb.onStep({ type: "tool", detail: `${pick(STATUS_PHRASES.reading)}: ${args.path}` });
        return await Tools.readFileContent(args.path, args.start_line, args.end_line);
      }

      case "patch_file": {
        cb.onStep({ type: "tool", detail: `${pick(STATUS_PHRASES.patching)}: ${args.path}` });
        const preview = await Tools.previewPatch(args.path, args.search, args.replace);

        const approved = await cb.onDiffApproval({
          path: args.path,
          before: preview.original,
          after: preview.updated,
          isNew: false,
        });

        if (!approved) {
          return `The user rejected this edit to "${args.path}". Think of a different approach.`;
        }

        await Tools.writeApprovedContent(args.path, preview.updated);
        Tools.openFileInEditor(args.path).catch(() => {});
        await logHistory(cb, args.path, "patch", "File edited");
        return `"${args.path}" was successfully patched (user Accepted). It would be good to verify it once with read_file_content.`;
      }

      case "create_new_file": {
        cb.onStep({ type: "tool", detail: `${pick(STATUS_PHRASES.creating)}: ${args.path}` });

        const approved = await cb.onDiffApproval({
          path: args.path,
          before: "",
          after: args.content || "",
          isNew: true,
        });

        if (!approved) {
          return `The user rejected creating the file "${args.path}".`;
        }

        await Tools.createNewFile(args.path, args.content || "");
        Tools.openFileInEditor(args.path).catch(() => {});
        await logHistory(cb, args.path, "create", "New file created");
        return `"${args.path}" was successfully created (user Accepted).`;
      }

      case "rename_path": {
        cb.onStep({ type: "tool", detail: `${pick(STATUS_PHRASES.renaming)}: ${args.path} → ${args.new_name}` });
        const approved = await cb.onFileOpApproval(`Rename "${args.path}" to "${args.new_name}"`);
        if (!approved) {
          return `The user did not allow renaming "${args.path}".`;
        }
        await Tools.renamePath(args.path, args.new_name);
        await logHistory(cb, args.path, "rename", `→ ${args.new_name}`);
        return `"${args.path}" was successfully renamed to "${args.new_name}".`;
      }

      case "move_path": {
        cb.onStep({ type: "tool", detail: `${pick(STATUS_PHRASES.moving)}: ${args.path} → ${args.new_path}` });
        const approved = await cb.onFileOpApproval(`Move "${args.path}" to "${args.new_path}"`);
        if (!approved) {
          return `The user did not allow moving "${args.path}".`;
        }
        await Tools.movePath(args.path, args.new_path);
        await logHistory(cb, args.path, "move", `→ ${args.new_path}`);
        return `"${args.path}" was successfully moved to "${args.new_path}".`;
      }

      case "view_edit_history": {
        cb.onStep({ type: "tool", detail: "Looking at edit history..." });
        if (!window.A3.EditHistoryStore) return "(Edit history feature not available)";
        const entries = await window.A3.EditHistoryStore.listEntries(cb.sessionId);
        if (!entries.length) return "(No file changes have happened in this session yet)";
        return entries
          .map((e) => `[${new Date(e.timestamp).toLocaleString()}] ${e.action}: ${e.path} ${e.summary}`)
          .join("\n");
      }

      case "run_command": {
        const fullCommand = args.command;
        cb.onStep({ type: "tool", detail: `${pick(STATUS_PHRASES.command_ask)}: ${fullCommand}` });

        const approved = await cb.onCommandApproval(fullCommand);
        if (!approved) {
          return `The user did not allow running this command: "${fullCommand}". Think of a different approach.`;
        }

        cb.onStep({ type: "tool", detail: `${pick(STATUS_PHRASES.command_run)}: ${fullCommand}` });
        try {
          const output = await Tools.runCommand(fullCommand, args.alpine);
          return output && output.trim() ? output : "(Command succeeded, no output)";
        } catch (err) {
          return `Command failed: ${err.message || err}`;
        }
      }

      default:
        throw new Error(`Unknown tool: ${toolCall.name}`);
    }
  }

  window.A3 = window.A3 || {};
  window.A3.runAgentLoop = runAgentLoop;
})();
