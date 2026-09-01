/**
 * src/settings.js
 * Provider configurator settings view.
 *
 * The settings form renders directly inside our own sidebar panel
 * container as a "view", using only plain DOM APIs.
 *
 * Usage: window.A3.renderSettingsView(container, { onSave, onCancel })
 *  - container: HTMLElement, the form goes here (the whole innerHTML gets replaced)
 *  - onSave: called when save succeeds
 *  - onCancel: called when "Back" is pressed
 */

(function () {
  const BUILTIN_PROVIDERS = [
    { key: "gemini", label: "Gemini" },
    { key: "claude", label: "Claude" },
    { key: "openai", label: "OpenAI GPT-4o" },
    { key: "openrouter", label: "OpenRouter" },
    { key: "agentrouter", label: "AgentRouter" },
  ];

  function renderSettingsView(container, options) {
    const onSave = options && options.onSave;
    const onCancel = options && options.onCancel;
    const config = window.A3.Storage.getConfig();
    container.innerHTML = "";
    container.classList.add("a3-panel-container");

    const header = el("div", { className: "a3-panel-header" });
    const title = el("span", { className: "a3-panel-title", textContent: "A3 Agent Settings" });
    const backBtn = el("button", { className: "a3-settings-btn" });
    backBtn.title = "Back";
    backBtn.innerHTML = '<span class="icon back"></span>';
    header.append(backBtn, title);

    const body = el("div", { className: "a3-panel-body scroll" });
    const form = buildForm(config);
    body.append(form.container);

    const footer = el("div", { className: "a3-panel-footer" });
    const saveBtn = el("button", { className: "a3-send-btn", textContent: "Save" });
    footer.append(saveBtn);

    container.append(header, body, footer);

    backBtn.addEventListener("click", () => {
      if (typeof onCancel === "function") onCancel();
    });

    saveBtn.addEventListener("click", () => {
      try {
        const updatedConfig = form.collect();
        window.A3.Storage.saveConfig(updatedConfig);
        window.toast && window.toast("Settings saved ✓", 2000);
        if (typeof onSave === "function") onSave();
      } catch (err) {
        acode.alert("Failed to save", String(err.message || err));
      }
    });
  }

  /**
   * A simple DOM element builder — sets className, textContent, and other properties.
   */
  function el(tagName, props) {
    const node = document.createElement(tagName);
    if (props) {
      if (props.className) node.className = props.className;
      if (props.textContent) node.textContent = props.textContent;
    }
    return node;
  }

  /**
   * Builds the form's DOM and returns a collect() function that builds a
   * new config object from the form's current state.
   */
  function buildForm(config) {
    const container = el("div", { className: "a3-settings-form" });

    // 1. Provider type selector
    const typeLabel = el("label", { textContent: "Choose a provider" });
    const typeSelect = el("select", { className: "a3-select" });

    BUILTIN_PROVIDERS.forEach((p) => {
      const opt = el("option", { textContent: p.label });
      opt.value = "builtin:" + p.key;
      typeSelect.append(opt);
    });
    const customOpt = null; // the actual saved custom providers get added dynamically as options below

    container.append(typeLabel, typeSelect);

    // 2. Built-in provider fields (a separate block for each, shown as needed)
    const builtinBlocks = {};
    BUILTIN_PROVIDERS.forEach((p) => {
      const data = config.builtin[p.key];
      const block = el("div", { className: "a3-provider-block" });

      const apiKeyInput = el("input", { className: "a3-input-field" });
      apiKeyInput.type = "password";
      apiKeyInput.placeholder = p.label + " API Key";
      apiKeyInput.value = data.apiKey || "";

      const modelInput = el("input", { className: "a3-input-field" });
      modelInput.type = "text";
      modelInput.placeholder = "Model ID";
      modelInput.value = data.modelId || "";

      block.append(
        el("label", { textContent: "API Key" }),
        apiKeyInput,
        el("label", { textContent: "Model ID" }),
        modelInput
      );

      container.append(block);
      builtinBlocks[p.key] = { block, apiKeyInput, modelInput };
    });

    // 3. Custom provider fields — a separate block + a Delete button for each
    // saved custom provider, plus a button to add a new one.
    const customBlocksById = {}; // id -> { block, nameInput, baseUrlInput, apiKeyInput, modelInput, headersTextarea }
    const customSectionContainer = el("div", { className: "a3-custom-section" });

    function addCustomOption(id, label) {
      const opt = el("option", { textContent: label || "Custom Provider" });
      opt.value = "custom:" + id;
      typeSelect.append(opt);
      return opt;
    }

    function buildCustomBlock(providerData) {
      const id = providerData.id;
      const block = el("div", { className: "a3-provider-block" });

      const nameInput = el("input", { className: "a3-input-field" });
      nameInput.type = "text";
      nameInput.placeholder = "Provider Name (e.g. Ollama)";
      nameInput.value = providerData.name || "";

      const baseUrlInput = el("input", { className: "a3-input-field" });
      baseUrlInput.type = "text";
      baseUrlInput.placeholder = "Base URL (e.g. http://localhost:11434/v1)";
      baseUrlInput.value = providerData.baseUrl || "";

      const apiKeyInput = el("input", { className: "a3-input-field" });
      apiKeyInput.type = "password";
      apiKeyInput.placeholder = "API Key (optional, leave blank for local)";
      apiKeyInput.value = providerData.apiKey || "";

      const modelInput = el("input", { className: "a3-input-field" });
      modelInput.type = "text";
      modelInput.placeholder = "Model ID (e.g. llama3:8b)";
      modelInput.value = providerData.modelId || "";

      const headersTextarea = el("textarea", { className: "a3-textarea-field" });
      headersTextarea.placeholder = '{"HTTP-Referer": "https://acode-app"}';
      headersTextarea.value = providerData.headersJson || "{}";
      headersTextarea.rows = 4;

      const deleteBtn = el("button", { className: "a3-delete-provider-btn", textContent: "🗑 Delete this provider" });

      // (kept for reference; not currently used to live-update the dropdown label)
      const optionEl = customBlocksById[id] ? customBlocksById[id].optionEl : null;

      block.append(
        el("label", { textContent: "Provider Name" }),
        nameInput,
        el("label", { textContent: "Base URL" }),
        baseUrlInput,
        el("label", { textContent: "API Key" }),
        apiKeyInput,
        el("label", { textContent: "Model ID" }),
        modelInput,
        el("label", { textContent: "Custom Headers (JSON)" }),
        headersTextarea,
        deleteBtn
      );

      customSectionContainer.append(block);

      const entry = { id, block, nameInput, baseUrlInput, apiKeyInput, modelInput, headersTextarea, optionEl };
      customBlocksById[id] = entry;

      deleteBtn.addEventListener("click", () => {
        // removing this provider from the form — it only actually deletes once Save is pressed
        block.remove();
        if (entry.optionEl) entry.optionEl.remove();
        delete customBlocksById[id];
        if (typeSelect.value === "custom:" + id) {
          typeSelect.value = "builtin:gemini";
        }
        refreshVisibility();
      });

      return entry;
    }

    (config.customProviders || []).forEach((cp) => {
      const label = cp.name ? cp.name : "Custom Provider";
      const opt = addCustomOption(cp.id, label);
      buildCustomBlock(cp).optionEl = opt;
      customBlocksById[cp.id].optionEl = opt;
    });

    const addCustomBtn = el("button", { className: "a3-add-provider-btn", textContent: "+ Add new custom provider" });
    addCustomBtn.addEventListener("click", () => {
      const newId = window.A3.Storage.makeProviderId();
      const opt = addCustomOption(newId, "New Provider");
      const entry = buildCustomBlock({ id: newId });
      entry.optionEl = opt;
      typeSelect.value = "custom:" + newId;
      refreshVisibility();
    });

    container.append(customSectionContainer, addCustomBtn);

    // 4. Toggle which block is shown based on the type select
    function refreshVisibility() {
      const selected = typeSelect.value;
      BUILTIN_PROVIDERS.forEach((p) => {
        builtinBlocks[p.key].block.style.display =
          selected === "builtin:" + p.key ? "block" : "none";
      });
      Object.keys(customBlocksById).forEach((id) => {
        customBlocksById[id].block.style.display = selected === "custom:" + id ? "block" : "none";
      });
    }
    typeSelect.addEventListener("change", refreshVisibility);

    // All builtin + custom options are now in the select, so
    // activeProviderKey is set here — previously it was set as soon as the
    // builtin options were added (before the custom ones), so an active
    // custom provider wouldn't match and would silently reset to gemini.
    typeSelect.value = config.activeProviderKey || "builtin:gemini";
    refreshVisibility();

    // 5. collect() — builds a new config object from the form's current state
    function collect() {
      // validate the Custom Headers JSON for every custom provider
      Object.values(customBlocksById).forEach((entry) => {
        try {
          JSON.parse(entry.headersTextarea.value || "{}");
        } catch (e) {
          throw new Error(
            `Enter valid JSON in the Custom Headers field for "${entry.nameInput.value || "a custom provider"}".`
          );
        }
      });

      const newConfig = window.A3.Storage.getDefaultConfig();
      newConfig.activeProviderKey = typeSelect.value;

      BUILTIN_PROVIDERS.forEach((p) => {
        const b = builtinBlocks[p.key];
        newConfig.builtin[p.key] = {
          apiKey: b.apiKeyInput.value.trim(),
          modelId: b.modelInput.value.trim(),
        };
      });

      newConfig.customProviders = Object.values(customBlocksById).map((entry) => ({
        id: entry.id,
        name: entry.nameInput.value.trim(),
        baseUrl: entry.baseUrlInput.value.trim(),
        apiKey: entry.apiKeyInput.value.trim(),
        modelId: entry.modelInput.value.trim(),
        headersJson: entry.headersTextarea.value.trim() || "{}",
      }));

      // verify the required fields are filled in for the selected provider
      if (newConfig.activeProviderKey.startsWith("builtin:")) {
        const key = newConfig.activeProviderKey.split(":")[1];
        if (!newConfig.builtin[key].apiKey) {
          throw new Error("Enter an API Key for this provider.");
        }
      } else if (newConfig.activeProviderKey.startsWith("custom:")) {
        const id = newConfig.activeProviderKey.slice("custom:".length);
        const c = newConfig.customProviders.find((p) => p.id === id);
        if (!c || !c.baseUrl || !c.modelId) {
          throw new Error("Base URL and Model ID are required for a custom provider.");
        }
      }

      return newConfig;
    }

    return { container, collect };
  }

  window.A3 = window.A3 || {};
  window.A3.renderSettingsView = renderSettingsView;
})();
