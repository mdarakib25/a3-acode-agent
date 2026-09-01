/**
 * src/sessionStore.js
 * Multi-session chat + Edit History — IndexedDB based
 *
 * Uses IndexedDB (no size-limit concerns like localStorage for a lot of
 * history) for the bulk data (chat messages, edit history), and only a
 * lightweight "which one is active" pointer in localStorage.
 */

(function () {
  const DB_NAME = "a3_db";
  const DB_VERSION = 1;
  const SESSIONS_STORE = "sessions";
  const EDIT_HISTORY_STORE = "edit_history";
  const ACTIVE_SESSION_KEY = "a3_active_session_id";

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          db.createObjectStore(SESSIONS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(EDIT_HISTORY_STORE)) {
          const store = db.createObjectStore(EDIT_HISTORY_STORE, { keyPath: "id", autoIncrement: true });
          store.createIndex("sessionId", "sessionId", { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  function promisifyRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function makeSessionId() {
    return "s_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  }

  // ---------------------------------------------------------------------
  // Session (chat) store
  // ---------------------------------------------------------------------

  async function listSessions() {
    const db = await openDB();
    const tx = db.transaction(SESSIONS_STORE, "readonly");
    const all = await promisifyRequest(tx.objectStore(SESSIONS_STORE).getAll());
    return all
      .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function getActiveSessionId() {
    return localStorage.getItem(ACTIVE_SESSION_KEY);
  }

  function setActiveSessionPointer(id) {
    localStorage.setItem(ACTIVE_SESSION_KEY, id);
  }

  async function getSessionMessages(sessionId) {
    const db = await openDB();
    const tx = db.transaction(SESSIONS_STORE, "readonly");
    const session = await promisifyRequest(tx.objectStore(SESSIONS_STORE).get(sessionId));
    return session ? session.messages : [];
  }

  /**
   * Returns the task checklist (⬜/⏳/✅) attached to a session — this used
   * to be only in-memory (UI), and would be lost when the panel remounted.
   * Now it's saved along with the session.
   * @param {string} sessionId
   * @returns {Promise<Array<{text: string, status: string}>>}
   */
  async function getSessionTasks(sessionId) {
    const db = await openDB();
    const tx = db.transaction(SESSIONS_STORE, "readonly");
    const session = await promisifyRequest(tx.objectStore(SESSIONS_STORE).get(sessionId));
    return session && session.tasks ? session.tasks : [];
  }

  async function saveSessionTasks(sessionId, tasks) {
    const db = await openDB();
    const tx = db.transaction(SESSIONS_STORE, "readwrite");
    const store = tx.objectStore(SESSIONS_STORE);
    let session = await promisifyRequest(store.get(sessionId));
    if (!session) {
      session = { id: sessionId, title: "New Chat", messages: [], tasks: [], updatedAt: Date.now() };
    }
    session.tasks = tasks;
    store.put(session);
  }

  async function createSession() {
    const db = await openDB();
    const id = makeSessionId();
    const tx = db.transaction(SESSIONS_STORE, "readwrite");
    tx.objectStore(SESSIONS_STORE).put({ id, title: "New Chat", messages: [], tasks: [], updatedAt: Date.now() });
    await promisifyRequest(tx.objectStore(SESSIONS_STORE).get(id)); // wait until the tx completes
    setActiveSessionPointer(id);
    return id;
  }

  async function saveSessionMessages(sessionId, messages) {
    const db = await openDB();
    const tx = db.transaction(SESSIONS_STORE, "readwrite");
    const store = tx.objectStore(SESSIONS_STORE);
    let session = await promisifyRequest(store.get(sessionId));
    if (!session) {
      session = { id: sessionId, title: "New Chat", messages: [], tasks: [], updatedAt: Date.now() };
    }
    session.messages = messages;
    session.updatedAt = Date.now();

    if (session.title === "New Chat") {
      const firstUserMsg = messages.find((m) => m.role === "user");
      if (firstUserMsg && firstUserMsg.content) {
        session.title = firstUserMsg.content.slice(0, 40) + (firstUserMsg.content.length > 40 ? "…" : "");
      }
    }
    store.put(session);
  }

  function setActiveSession(sessionId) {
    setActiveSessionPointer(sessionId);
    return true;
  }

  async function deleteSession(sessionId) {
    const db = await openDB();
    const tx = db.transaction(SESSIONS_STORE, "readwrite");
    tx.objectStore(SESSIONS_STORE).delete(sessionId);

    if (getActiveSessionId() === sessionId) {
      const remaining = await listSessions();
      if (remaining.length) setActiveSessionPointer(remaining[0].id);
      else localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  }

  async function ensureActiveSession() {
    const activeId = getActiveSessionId();
    if (activeId) {
      const db = await openDB();
      const tx = db.transaction(SESSIONS_STORE, "readonly");
      const session = await promisifyRequest(tx.objectStore(SESSIONS_STORE).get(activeId));
      if (session) return activeId;
    }
    return createSession();
  }

  // ---------------------------------------------------------------------
  // Edit History (audit trail) store
  // ---------------------------------------------------------------------

  /**
   * Logs a file operation (patch/create/rename/move).
   * @param {{sessionId: string, path: string, action: string, summary: string}} entry
   */
  async function addEditHistoryEntry(entry) {
    const db = await openDB();
    const tx = db.transaction(EDIT_HISTORY_STORE, "readwrite");
    tx.objectStore(EDIT_HISTORY_STORE).add({
      sessionId: entry.sessionId || null,
      path: entry.path,
      action: entry.action,
      summary: entry.summary || "",
      timestamp: Date.now(),
    });
  }

  /**
   * Returns all edit-history entries for a session, newest first.
   * Returns entries for all sessions if sessionId isn't given.
   * @param {string} [sessionId]
   */
  async function listEditHistory(sessionId) {
    const db = await openDB();
    const tx = db.transaction(EDIT_HISTORY_STORE, "readonly");
    const store = tx.objectStore(EDIT_HISTORY_STORE);
    let all;
    if (sessionId) {
      all = await promisifyRequest(store.index("sessionId").getAll(sessionId));
    } else {
      all = await promisifyRequest(store.getAll());
    }
    return all.sort((a, b) => b.timestamp - a.timestamp);
  }

  window.A3 = window.A3 || {};
  window.A3.SessionStore = {
    listSessions,
    getActiveSessionId,
    getSessionMessages,
    saveSessionMessages,
    getSessionTasks,
    saveSessionTasks,
    createSession,
    setActiveSession,
    deleteSession,
    ensureActiveSession,
  };
  window.A3.EditHistoryStore = {
    addEntry: addEditHistoryEntry,
    listEntries: listEditHistory,
  };
})();
