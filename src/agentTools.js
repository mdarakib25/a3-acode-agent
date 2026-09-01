/**
 * src/agentTools.js
 * Agent File System & Terminal Tools
 *
 * These rely on the following Acode globals/modules:
 *  - window.addedFolder — the list of project folders opened in the sidebar
 *  - acode.require('fs') — file read/write/create
 *  - acode.require('Url') — path joining
 *  - global Executor — shell command execution
 *  - global acode.newEditorFile / editorManager — opening files in the editor
 *
 * Note: this assumes the user already has a project folder open in Acode
 * via "Open Folder". If multiple folders are open, the first one
 * (addedFolder[0]) is treated as the project root.
 */

(function () {
  const IGNORED_DIRS = new Set([
    "node_modules", ".git", ".idea", ".vscode", "dist", "build", ".gradle", "vendor",
  ]);
  const MAX_FILES = 500;

  function getProjectRoot() {
    if (!window.addedFolder || window.addedFolder.length === 0) {
      throw new Error(
        "No project folder is open. Open one first from Acode's sidebar using 'Open Folder'."
      );
    }
    return window.addedFolder[0];
  }

  function getFs() {
    return acode.require("fs") || acode.require("fsOperation");
  }

  function getProjectShellPath() {
    if (!window.addedFolder || window.addedFolder.length === 0) return null;
    const url = window.addedFolder[0].url || "";

    if (url.startsWith("file://")) {
      return url.replace(/^file:\/\//, "");
    }

    if (url.startsWith("content://")) {
      try {
        const decoded = decodeURIComponent(url);
        const idx = decoded.lastIndexOf("primary:");
        if (idx === -1) return null;
        const relPath = decoded.slice(idx + "primary:".length);
        return "/storage/emulated/0/" + relPath;
      } catch (err) {
        return null;
      }
    }

    return null;
  }

  function normalizeRelativePath(relativePath) {
    let p = (relativePath || "").trim();
    p = p.replace(/^\/+/, "");

    try {
      const shellPath = getProjectShellPath();
      if (shellPath) {
        const shellRel = shellPath.replace(/^\/+/, "");
        if (p === shellRel || p.startsWith(shellRel + "/")) {
          p = p.slice(shellRel.length).replace(/^\/+/, "");
        }
      }
    } catch (err) {
      // ignore
    }

    return p;
  }

  function getUrlUtil() {
    return acode.require("Url") || acode.require("url");
  }

  async function listProjectFiles() {
    const root = getProjectRoot();
    const fs = getFs();
    const results = [];

    async function walk(dirUrl, relPrefix) {
      if (results.length >= MAX_FILES) return;
      const dirFs = await fs(dirUrl);
      const entries = await dirFs.lsDir();

      for (const entry of entries) {
        if (results.length >= MAX_FILES) return;
        const name = entry.name;
        if (IGNORED_DIRS.has(name)) continue;

        const relPath = relPrefix ? `${relPrefix}/${name}` : name;
        if (entry.isDirectory) {
          await walk(entry.url, relPath);
        } else {
          results.push(relPath);
        }
      }
    }

    await walk(root.url, "");
    return results;
  }

  const MAX_INDEX_ENTRIES = 200;
  let codebaseIndexCache = null;

  function invalidateCodebaseIndex() {
    codebaseIndexCache = null;
  }

  async function getCodebaseIndexSummary(options) {
    const forceRefresh = options && options.forceRefresh;
    if (!codebaseIndexCache || forceRefresh) {
      try {
        const files = await listProjectFiles();
        codebaseIndexCache = files;
      } catch (err) {
        return "(Could not index a project folder — probably none is open)";
      }
    }

    const files = codebaseIndexCache || [];
    if (files.length === 0) return "(No files found in the project)";

    const shown = files.slice(0, MAX_INDEX_ENTRIES);
    const truncatedNote =
      files.length > MAX_INDEX_ENTRIES
        ? `\n... (${files.length} files total, only the first ${MAX_INDEX_ENTRIES} are shown; call list_project_files if you need the rest)`
        : "";

    return shown.join("\n") + truncatedNote;
  }

  async function readFileContent(relativePath, startLine, endLine) {
    relativePath = normalizeRelativePath(relativePath);
    const root = getProjectRoot();
    const Url = getUrlUtil();
    const fs = getFs();
    const fileUrl = Url.join(root.url, relativePath);
    const fileFs = await fs(fileUrl);
    const exists = await fileFs.exists();
    if (!exists) {
      throw new Error(`File not found: ${relativePath}`);
    }
    const content = await fileFs.readFile("utf8");

    if (!startLine && !endLine) return content;

    const lines = content.split("\n");
    const s = Math.max(1, startLine || 1) - 1;
    const e = Math.min(lines.length, endLine || lines.length);
    const sliced = lines.slice(s, e).join("\n");
    return `[Lines ${s + 1}-${e} of ${lines.length} total]\n${sliced}`;
  }

  async function ensureDirectory(rootUrl, relativeDirPath) {
    const Url = getUrlUtil();
    const fs = getFs();
    if (!relativeDirPath) return rootUrl;

    const segments = relativeDirPath.split("/").filter(Boolean);
    let currentUrl = rootUrl;

    for (const segment of segments) {
      const nextUrl = Url.join(currentUrl, segment);
      const nextFs = await fs(nextUrl);
      const exists = await nextFs.exists();
      if (!exists) {
        const parentFs = await fs(currentUrl);
        await parentFs.createDirectory(segment);
      }
      currentUrl = nextUrl;
    }

    return currentUrl;
  }

  async function createNewFile(relativePath, content) {
    relativePath = normalizeRelativePath(relativePath);
    const root = getProjectRoot();
    const fs = getFs();

    const lastSlash = relativePath.lastIndexOf("/");
    const dirPart = lastSlash === -1 ? "" : relativePath.slice(0, lastSlash);
    const fileName = lastSlash === -1 ? relativePath : relativePath.slice(lastSlash + 1);

    const dirUrl = await ensureDirectory(root.url, dirPart);
    const dirFs = await fs(dirUrl);
    const createdUrl = await dirFs.createFile(fileName, content);
    invalidateCodebaseIndex();
    return createdUrl;
  }

  async function renamePath(relativePath, newName) {
    relativePath = normalizeRelativePath(relativePath);
    const root = getProjectRoot();
    const Url = getUrlUtil();
    const fs = getFs();
    const fileUrl = Url.join(root.url, relativePath);
    const fileFs = await fs(fileUrl);
    const exists = await fileFs.exists();
    if (!exists) throw new Error(`Not found: ${relativePath}`);

    const newUrl = await fileFs.renameTo(newName);
    invalidateCodebaseIndex();
    return newUrl;
  }

  async function movePath(relativePath, newRelativePath) {
    relativePath = normalizeRelativePath(relativePath);
    newRelativePath = normalizeRelativePath(newRelativePath);
    const root = getProjectRoot();
    const Url = getUrlUtil();
    const fs = getFs();

    const fileUrl = Url.join(root.url, relativePath);
    const fileFs = await fs(fileUrl);
    const exists = await fileFs.exists();
    if (!exists) throw new Error(`Not found: ${relativePath}`);

    const lastSlash = newRelativePath.lastIndexOf("/");
    const destDirPart = lastSlash === -1 ? "" : newRelativePath.slice(0, lastSlash);
    const destFileName = lastSlash === -1 ? newRelativePath : newRelativePath.slice(lastSlash + 1);
    const originalName = relativePath.split("/").pop();

    const destDirUrl = await ensureDirectory(root.url, destDirPart);
    const movedUrl = await fileFs.moveTo(destDirUrl);

    invalidateCodebaseIndex();

    if (destFileName && destFileName !== originalName) {
      const movedFs = await fs(movedUrl);
      return await movedFs.renameTo(destFileName);
    }
    return movedUrl;
  }

  async function previewPatch(relativePath, searchBlock, replaceBlock) {
    relativePath = normalizeRelativePath(relativePath);
    const root = getProjectRoot();
    const Url = getUrlUtil();
    const fs = getFs();
    const fileUrl = Url.join(root.url, relativePath);
    const fileFs = await fs(fileUrl);

    const exists = await fileFs.exists();
    if (!exists) {
      throw new Error(`File not found: ${relativePath}`);
    }

    const original = await fileFs.readFile("utf8");
    const occurrences = original.split(searchBlock).length - 1;

    if (occurrences === 0) {
      throw new Error(
        `The search_block text given for "${relativePath}" was not found. Check the file's current content again with read_file_content.`
      );
    }
    if (occurrences > 1) {
      throw new Error(
        `The search_block text for "${relativePath}" matched multiple times (${occurrences}). Make search_block more specific.`
      );
    }

    const updated = original.replace(searchBlock, replaceBlock);
    return { original, updated };
  }

  async function writeApprovedContent(relativePath, newContent) {
    relativePath = normalizeRelativePath(relativePath);
    const root = getProjectRoot();
    const Url = getUrlUtil();
    const fs = getFs();
    const fileUrl = Url.join(root.url, relativePath);
    const fileFs = await fs(fileUrl);
    await fileFs.writeFile(newContent);
  }

  async function patchFile(relativePath, searchBlock, replaceBlock) {
    relativePath = normalizeRelativePath(relativePath);
    const root = getProjectRoot();
    const Url = getUrlUtil();
    const fs = getFs();
    const fileUrl = Url.join(root.url, relativePath);
    const fileFs = await fs(fileUrl);

    const exists = await fileFs.exists();
    if (!exists) {
      throw new Error(`File not found: ${relativePath}`);
    }

    const original = await fileFs.readFile("utf8");
    const occurrences = original.split(searchBlock).length - 1;

    if (occurrences === 0) {
      throw new Error(
        `patch_file failed: the search_block text given for "${relativePath}" was not found. Check the file's current content again with read_file_content.`
      );
    }
    if (occurrences > 1) {
      throw new Error(
        `patch_file failed: the search_block text for "${relativePath}" matched multiple times (${occurrences}). Make search_block more specific (include surrounding lines) and try again, so the wrong spot doesn't get edited.`
      );
    }

    const updated = original.replace(searchBlock, replaceBlock);
    await fileFs.writeFile(updated);
    return true;
  }

  const TOOL_DEFINITIONS = [
    {
      name: "submit_plan",
      description:
        "Submit a plan at the start of a complex/multi-step task, Antigravity-IDE style — i.e. steps describing **which features/work will be done** (e.g. 'Add user login feature', 'Build a responsive design', 'Create an API endpoint'), **not a list of which files will be created** (no need to name files/counts, figure that out during implementation). Skip this for simple tasks and call another tool directly.",
      parameters: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: { type: "string" },
            description: "High-level feature/task steps (not a file list), in order",
          },
        },
        required: ["steps"],
      },
    },
    {
      name: "list_project_files",
      description: "Shows a list of relative paths for every file in the project.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "read_file_content",
      description:
        "Reads a file's content. Give start_line/end_line to see just part of a large file (saves tokens); without them the whole file is read.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'File path relative to the project root (e.g. "index.html" or "src/app.js") — never give an absolute path like "/storage/...", that\'s only for run_command.',
          },
          start_line: { type: "number", description: "Optional, 1-indexed starting line" },
          end_line: { type: "number", description: "Optional, 1-indexed ending line (inclusive)" },
        },
        required: ["path"],
      },
    },
    {
      name: "patch_file",
      description:
        "Replaces a specific part (search) of a file with replace. search must match the file exactly and uniquely (verify with read_file_content first). The user is shown a diff first — the file won't change unless they Accept. Always verify with read_file_content again after an edit is Accepted, to confirm it landed correctly.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'File path relative to the project root (e.g. "index.html") — do not give an absolute path (/storage/...).',
          },
          search: { type: "string", description: "The old code/text that must match the file exactly" },
          replace: { type: "string", description: "The new code/text" },
        },
        required: ["path", "search", "replace"],
      },
    },
    {
      name: "create_new_file",
      description:
        "Creates a new file (including intermediate folders if needed). The user is shown a preview first — the file won't be created unless they Accept.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'New file path relative to the project root (e.g. "src/app.js") — do not give an absolute path (/storage/...), or a wrongly nested folder will get created inside the project.',
          },
          content: { type: "string", description: "The new file's full content" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "rename_path",
      description: "Renames a file/folder (stays in the same directory). Requires user permission.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Current path, relative to the project root" },
          new_name: { type: "string", description: "Just the new name (not a path), e.g. 'app.new.js'" },
        },
        required: ["path", "new_name"],
      },
    },
    {
      name: "move_path",
      description: "Moves a file/folder to a new location (optionally with a new name too). Requires user permission.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Current path, relative to the project root" },
          new_path: { type: "string", description: "New path relative to the project root (including new folder/name)" },
        },
        required: ["path", "new_path"],
      },
    },
    {
      name: "view_edit_history",
      description: "Shows an audit list of which files had which changes (patch/create/rename/move) so far in this session.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "run_command",
      description:
        'Runs a shell command (e.g. npm install, git status, ls, running a test). Important: this does not run inside a shell, so operators like cd/&&/;/| won\'t work — if you need to work in a directory, give that directory\'s full (absolute) path directly as a command argument. If a path has spaces, you must wrap it in double quotes (e.g. "ls -la \\"/path/with space\\""), otherwise it wrongly splits into multiple arguments. The user is shown the full command first and must give permission — the command won\'t run unless they Accept. Don\'t use this for long-running/interactive processes (e.g. keeping a server up) — only for short, one-shot commands.',
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run" },
          alpine: {
            type: "boolean",
            description: "true (default) runs it in the Alpine Linux sandbox, false runs it directly in the Android environment",
          },
        },
        required: ["command"],
      },
    },
    {
      name: "update_task_status",
      description:
        "Updates the status of a specific step in the task list given in submit_plan (so the checklist can show ✓/⏳/⬜). Set 'in_progress' before starting a step, 'done' when it's finished.",
      parameters: {
        type: "object",
        properties: {
          index: { type: "number", description: "Index (0-based) of the step in submit_plan's steps array" },
          status: { type: "string", enum: ["pending", "in_progress", "done"], description: "The new status" },
        },
        required: ["index", "status"],
      },
    },
  ];

  const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

  async function runCommand(command, alpine) {
    if (typeof Executor === "undefined" || !Executor || typeof Executor.execute !== "function") {
      throw new Error("The Executor API isn't available. Check whether Acode's Terminal feature is installed/supported.");
    }
    const useAlpine = alpine === undefined ? true : alpine;

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            `The command didn't finish within ${COMMAND_TIMEOUT_MS / 60000} minutes, so waiting was stopped. ` +
              `Note: the command may still be running in the background (there's no reliable way to stop it) — ` +
              `this can be normal for copying/installing many files (e.g. vendor/node_modules), ` +
              `check again after a bit (e.g. with ls, to see whether the files actually got created).`
          )
        );
      }, COMMAND_TIMEOUT_MS);
    });

    try {
      return await Promise.race([Executor.execute(command, useAlpine), timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function savePlanFile(sessionTitle, steps) {
    const safeName =
      (sessionTitle || "plan")
        .replace(/[^a-zA-Z0-9\- _]/g, "")
        .trim()
        .slice(0, 40) || "plan";
    const fileName = `${Date.now()}_${safeName}.md`;
    const relPath = `.a3/plans/${fileName}`;

    const content =
      `# Plan: ${sessionTitle || ""}\n\n` +
      `Created: ${new Date().toLocaleString()}\n\n` +
      steps.map((s, i) => `${i + 1}. [ ] ${s}`).join("\n") +
      "\n";

    await createNewFile(relPath, content);
    return relPath;
  }

  async function openFileInEditor(relativePath) {
    relativePath = normalizeRelativePath(relativePath);
    const root = getProjectRoot();
    const Url = getUrlUtil();
    const fileUrl = Url.join(root.url, relativePath);
    const fileName = relativePath.split("/").pop();

    if (typeof acode === "undefined" || typeof acode.newEditorFile !== "function") {
      console.error("[A3] acode.newEditorFile is not available, file was not auto-opened.");
      return false;
    }

    try {
      const alreadyOpen =
        typeof editorManager !== "undefined" && editorManager && editorManager.files
          ? editorManager.files.find((f) => f.uri === fileUrl)
          : null;

      if (alreadyOpen) {
        if (typeof alreadyOpen.makeActive === "function") alreadyOpen.makeActive();
      } else {
        acode.newEditorFile(fileName, { uri: fileUrl, render: true });
      }
      return true;
    } catch (err) {
      console.error("[A3] Failed to open the file in the editor:", err);
      return false;
    }
  }

  window.A3 = window.A3 || {};
  window.A3.Tools = {
    listProjectFiles,
    readFileContent,
    patchFile,
    createNewFile,
    previewPatch,
    writeApprovedContent,
    getCodebaseIndexSummary,
    invalidateCodebaseIndex,
    runCommand,
    getProjectShellPath,
    savePlanFile,
    openFileInEditor,
    renamePath,
    movePath,
    TOOL_DEFINITIONS,
  };
})();
