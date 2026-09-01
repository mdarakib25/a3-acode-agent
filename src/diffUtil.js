/**
 * src/diffUtil.js
 * Line-by-line diff (LCS-based), so a small change in a large file doesn't
 * require scrolling through the whole file — only the changed part plus a
 * few lines of surrounding context is shown, highlighted red (removed) and
 * green (added).
 */

(function () {
  const CONTEXT_LINES = 2; // how many lines to show before/after a change

  /**
   * Compares two texts (before/after) and returns an array of diff lines.
   * Each entry: { type: "context"|"add"|"remove", text: string }
   * Large unchanged sections are collapsed with "... N lines unchanged ...".
   * @param {string} oldText
   * @param {string} newText
   * @returns {Array<{type: string, text: string}>}
   */
  function computeLineDiff(oldText, newText) {
    const oldLines = (oldText || "").split("\n");
    const newLines = (newText || "").split("\n");

    const ops = lcsDiff(oldLines, newLines); // [{type, text}] in full, no windowing yet
    return collapseContext(ops);
  }

  /**
   * Classic LCS (Longest Common Subsequence) based line diff.
   */
  function lcsDiff(a, b) {
    const n = a.length;
    const m = b.length;
    // dp[i][j] = LCS length of a's first i lines and b's first j lines
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    const ops = [];
    let i = 0,
      j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        ops.push({ type: "context", text: a[i] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ type: "remove", text: a[i] });
        i++;
      } else {
        ops.push({ type: "add", text: b[j] });
        j++;
      }
    }
    while (i < n) {
      ops.push({ type: "remove", text: a[i] });
      i++;
    }
    while (j < m) {
      ops.push({ type: "add", text: b[j] });
      j++;
    }
    return ops;
  }

  /**
   * Keeps CONTEXT_LINES around each change and collapses the rest of a
   * large unchanged run with a short marker — so a large file doesn't need
   * to be scrolled through entirely.
   */
  function collapseContext(ops) {
    const result = [];
    let i = 0;
    while (i < ops.length) {
      if (ops[i].type !== "context") {
        result.push(ops[i]);
        i++;
        continue;
      }
      // find how many consecutive context lines there are
      let j = i;
      while (j < ops.length && ops[j].type === "context") j++;
      const runLength = j - i;

      if (runLength <= CONTEXT_LINES * 2) {
        // short run, show it all, no need to collapse
        for (let k = i; k < j; k++) result.push(ops[k]);
      } else {
        // keep CONTEXT_LINES at the start and end, collapse the middle
        for (let k = i; k < i + CONTEXT_LINES; k++) result.push(ops[k]);
        result.push({ type: "collapsed", text: `⋯ ${runLength - CONTEXT_LINES * 2} lines unchanged ⋯` });
        for (let k = j - CONTEXT_LINES; k < j; k++) result.push(ops[k]);
      }
      i = j;
    }
    return result;
  }

  window.A3 = window.A3 || {};
  window.A3.DiffUtil = { computeLineDiff };
})();
