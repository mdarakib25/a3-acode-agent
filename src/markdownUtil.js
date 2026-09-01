/**
 * src/markdownUtil.js
 * A lightweight markdown-to-HTML renderer — the agent's replies were showing
 * code blocks/lists/bold as plain escaped text. Reliably adding an external
 * library (e.g. marked.js) without a bundler is difficult, so a small, safe
 * (XSS-proof — everything is HTML-escaped first, then our own tags are
 * added) renderer was written instead. Supports:
 *  - ```code block``` (with or without a language name)
 *  - `inline code`
 *  - **bold**
 *  - - bullet lists / 1. numbered lists
 *  - paragraphs/line breaks
 */

(function () {
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  /**
   * @param {string} text — raw markdown (unescaped)
   * @returns {string} safe HTML
   */
  function renderMarkdown(text) {
    if (!text) return "";

    // Step 1: pull out code blocks first (swap in placeholders), so
    // markdown-like characters inside them (e.g. **, `) don't get processed
    const codeBlocks = [];
    let working = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({ lang: lang || "", code: code.replace(/\n$/, "") });
      return `\u0000CODEBLOCK${idx}\u0000`;
    });

    // Step 2: HTML-escape the rest (for safety — this is the only place raw
    // user/model text gets escaped; every tag added after this is our own)
    working = escapeHtml(working);

    // Step 3: inline code
    working = working.replace(/`([^`\n]+)`/g, '<code class="a3-inline-code">$1</code>');

    // Step 4: bold
    working = working.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");

    // Step 5: turn list lines into <li> (simple, no nesting support)
    const lines = working.split("\n");
    const htmlLines = [];
    let inList = false;
    for (const line of lines) {
      const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
      const numberedMatch = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bulletMatch || numberedMatch) {
        if (!inList) {
          htmlLines.push("<ul class=\"a3-md-list\">");
          inList = true;
        }
        htmlLines.push(`<li>${bulletMatch ? bulletMatch[1] : numberedMatch[1]}</li>`);
      } else {
        if (inList) {
          htmlLines.push("</ul>");
          inList = false;
        }
        htmlLines.push(line);
      }
    }
    if (inList) htmlLines.push("</ul>");
    working = htmlLines.join("\n");

    // Step 6: remaining line breaks become <br> (but not around <ul>/<li>)
    working = working
      .split("\n")
      .map((line) => (line.startsWith("<ul") || line.startsWith("</ul") || line.startsWith("<li") ? line : line))
      .join("<br>")
      .replace(/(<\/?ul[^>]*>|<li>[\s\S]*?<\/li>)<br>/g, "$1")
      .replace(/<br>(<\/?ul)/g, "$1");

    // Step 7: swap the code block placeholders back in as real <pre><code>
    working = working.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (match, idx) => {
      const block = codeBlocks[Number(idx)];
      const escapedCode = escapeHtml(block.code);
      const langLabel = block.lang ? `<div class="a3-code-lang">${escapeHtml(block.lang)}</div>` : "";
      return `<div class="a3-code-block-wrap">${langLabel}<pre class="a3-code-block"><code>${escapedCode}</code></pre></div>`;
    });

    return working;
  }

  window.A3 = window.A3 || {};
  window.A3.MarkdownUtil = { renderMarkdown };
})();
