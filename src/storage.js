/**
 * src/storage.js
 * A simple storage layer for saving and reading provider configuration.
 *
 * Note (important): this version uses localStorage, which lives in the
 * Acode app's private WebView storage (not directly accessible from other
 * apps) — but it is not "true encryption". Full encryption (Android
 * Keystore based) may be added in a future phase.
 *
 * `customProviders` is an array — multiple custom providers (Ollama,
 * OpenRouter, DeepSeek, etc.) can be saved at once and any one activated.
 * An older single-slot config is migrated automatically, no data is lost.
 */

(function () {
  const STORAGE_KEY = "a3_agent_config_v1";

  const DEFAULT_MODELS = {
    gemini: "gemini-2.0-flash",
    claude: "claude-sonnet-4-20250514",
    openai: "gpt-4o",
    openrouter: "openrouter/auto",
    agentrouter: "gpt-4o",
  };

  function getDefaultConfig() {
    return {
      activeProviderKey: null, // e.g. "builtin:gemini" or "custom:<id>"
      builtin: {
        gemini: { apiKey: "", modelId: DEFAULT_MODELS.gemini },
        claude: { apiKey: "", modelId: DEFAULT_MODELS.claude },
        openai: { apiKey: "", modelId: DEFAULT_MODELS.openai },
        openrouter: { apiKey: "", modelId: DEFAULT_MODELS.openrouter },
        agentrouter: { apiKey: "", modelId: DEFAULT_MODELS.agentrouter },
      },
      customProviders: [], // [{id, name, baseUrl, apiKey, modelId, headersJson}, ...]
    };
  }

  function makeProviderId() {
    return "cp_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  }

  function getConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return getDefaultConfig();
      const parsed = JSON.parse(raw);

      let customProviders = Array.isArray(parsed.customProviders) ? parsed.customProviders : null;

      // --- Migration: convert an old single-slot customProvider into the array ---
      if (!customProviders && parsed.customProvider) {
        const old = parsed.customProvider;
        if (old.name || old.baseUrl || old.apiKey || old.modelId) {
          customProviders = [
            {
              id: "main", // the old activeProviderKey was "custom:main", so keep the id matching
              name: old.name || "",
              baseUrl: old.baseUrl || "",
              apiKey: old.apiKey || "",
              modelId: old.modelId || "",
              headersJson: old.headersJson || "{}",
            },
          ];
        }
      }
      if (!customProviders) customProviders = [];

      // merged with the defaults so an older saved config doesn't break when
      // new fields are added later
      return Object.assign({}, getDefaultConfig(), parsed, {
        builtin: Object.assign({}, getDefaultConfig().builtin, parsed.builtin || {}),
        customProviders,
      });
    } catch (err) {
      console.error("[A3] Failed to read config, using defaults:", err);
      return getDefaultConfig();
    }
  }

  function saveConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  /**
   * Returns the full, usable config for the currently active provider.
   * Returns null if no provider is set.
   */
  function getActiveProviderConfig() {
    const config = getConfig();
    if (!config.activeProviderKey) return null;

    if (config.activeProviderKey.startsWith("builtin:")) {
      const providerName = config.activeProviderKey.split(":")[1];
      const providerData = config.builtin[providerName];
      if (!providerData || !providerData.apiKey) return null;
      return {
        type: "builtin",
        provider: providerName,
        apiKey: providerData.apiKey,
        modelId: providerData.modelId,
      };
    }

    if (config.activeProviderKey.startsWith("custom:")) {
      const id = config.activeProviderKey.slice("custom:".length);
      const c = (config.customProviders || []).find((p) => p.id === id);
      if (!c || !c.baseUrl || !c.modelId) return null;

      let headers = {};
      try {
        headers = JSON.parse(c.headersJson || "{}");
      } catch (e) {
        console.error("[A3] Failed to parse custom headers JSON:", e);
      }
      return {
        type: "custom",
        id: c.id,
        name: c.name,
        baseUrl: c.baseUrl,
        apiKey: c.apiKey,
        modelId: c.modelId,
        headers,
      };
    }

    return null;
  }

  window.A3 = window.A3 || {};
  window.A3.Storage = {
    getConfig,
    saveConfig,
    getDefaultConfig,
    getActiveProviderConfig,
    makeProviderId,
  };
})();
