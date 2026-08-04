"use strict";

(() => {
  const API_ORIGIN = "https://api.anthropic.com";
  const API_VERSION = "2023-06-01";
  const SESSION_KEY = "claudeApiKeySession";
  const REMEMBERED_KEY = "claudeApiKeyRemembered";
  const MODEL_KEY = "claudeApiModel";

  function init(options) {
    const elements = {
      newChatButton: document.getElementById("newChatButton"),
      settingsButton: document.getElementById("apiSettingsButton"),
      settingsDialog: document.getElementById("apiSettingsDialog"),
      settingsForm: document.getElementById("apiSettingsForm"),
      apiKeyInput: document.getElementById("anthropicApiKey"),
      rememberKey: document.getElementById("rememberAnthropicKey"),
      modelSelect: document.getElementById("anthropicModel"),
      settingsError: document.getElementById("apiSettingsError"),
      forgetKey: document.getElementById("forgetAnthropicKey"),
      messages: document.getElementById("apiChatMessages"),
      empty: document.getElementById("apiChatEmpty"),
      form: document.getElementById("apiChatForm"),
      input: document.getElementById("apiChatInput"),
      status: document.getElementById("apiChatStatus"),
      sendButton: document.getElementById("apiSendButton"),
      stopButton: document.getElementById("apiStopButton"),
    };

    let apiKey = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(REMEMBERED_KEY) || "";
    let currentModel = localStorage.getItem(MODEL_KEY) || "";
    let availableModels = [];
    let chatMessages = [];
    let requestController = null;
    let renderFrame = 0;

    function requestHeaders(key) {
      return {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": API_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      };
    }

    async function apiError(response) {
      try {
        const payload = await response.json();
        return payload?.error?.message || `Claude API 请求失败 (${response.status})`;
      } catch {
        return `Claude API 请求失败 (${response.status})`;
      }
    }

    function preferredModel(models) {
      const ids = models.map((model) => model.id);
      return (
        ids.find((id) => /^claude-sonnet-5(?:-|$)/i.test(id)) ||
        ids.find((id) => /^claude-sonnet/i.test(id)) ||
        ids.find((id) => /^claude-opus/i.test(id)) ||
        ids[0] ||
        ""
      );
    }

    async function fetchModels(key) {
      const response = await fetch(`${API_ORIGIN}/v1/models?limit=100`, {
        headers: requestHeaders(key),
      });
      if (!response.ok) throw new Error(await apiError(response));
      const payload = await response.json();
      const models = Array.isArray(payload.data)
        ? payload.data.filter((model) => model && typeof model.id === "string")
        : [];
      if (!models.length) throw new Error("Anthropic API 没有返回可用的 Claude 模型");
      return models;
    }

    function renderModelOptions(models, selected) {
      availableModels = models;
      const validSelection = models.some((model) => model.id === selected) ? selected : preferredModel(models);
      elements.modelSelect.innerHTML = models
        .map(
          (model) => `<option value="${options.escapeHtml(model.id)}">${options.escapeHtml(
            model.display_name || model.id,
          )}</option>`,
        )
        .join("");
      elements.modelSelect.disabled = false;
      elements.modelSelect.value = validSelection;
      currentModel = validSelection;
      localStorage.setItem(MODEL_KEY, currentModel);
      updateStatus();
    }

    function storeApiKey(value, remember) {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(REMEMBERED_KEY);
      if (remember) localStorage.setItem(REMEMBERED_KEY, value);
      else sessionStorage.setItem(SESSION_KEY, value);
      apiKey = value;
    }

    function clearApiKey() {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(REMEMBERED_KEY);
      apiKey = "";
      currentModel = "";
      availableModels = [];
      localStorage.removeItem(MODEL_KEY);
      elements.modelSelect.disabled = true;
      elements.modelSelect.innerHTML = '<option value="">连接后读取可用模型</option>';
      elements.apiKeyInput.value = "";
      elements.apiKeyInput.placeholder = "sk-ant-…";
      updateStatus();
    }

    function updateStatus(message = "") {
      if (message) {
        elements.status.textContent = message;
        return;
      }
      if (!apiKey) {
        elements.status.textContent = "尚未连接 Claude API";
        return;
      }
      const selected = availableModels.find((model) => model.id === currentModel);
      elements.status.textContent = selected?.display_name || currentModel || "Claude API 已连接";
    }

    async function ensureConnection() {
      if (!apiKey) return false;
      if (availableModels.length && currentModel) return true;
      updateStatus("正在读取 Claude 模型…");
      try {
        const models = await fetchModels(apiKey);
        renderModelOptions(models, currentModel);
        return true;
      } catch (error) {
        updateStatus("Claude API 需要重新连接");
        elements.settingsError.textContent = error.message;
        showSettings();
        return false;
      }
    }

    function showSettings() {
      elements.settingsError.textContent = "";
      elements.rememberKey.checked = Boolean(localStorage.getItem(REMEMBERED_KEY));
      elements.apiKeyInput.value = "";
      elements.apiKeyInput.placeholder = apiKey ? "已连接；留空可继续使用当前 Key" : "sk-ant-…";
      if (availableModels.length) renderModelOptions(availableModels, currentModel);
      elements.settingsDialog.showModal();
    }

    function renderMessage(message, index) {
      if (message.role === "user") {
        return `<article class="api-message user" data-api-message="${index}"><div class="api-message-bubble"><div class="api-message-label">你</div><div class="markdown">${options.renderMarkdown(
          message.content,
        )}</div></div></article>`;
      }
      const body = message.error
        ? `<div class="api-message-error">${options.escapeHtml(message.error)}</div>`
        : `<div class="markdown">${message.content ? options.renderMarkdown(message.content) : '<span class="api-thinking">Claude 正在思考…</span>'}</div>`;
      return `<article class="api-message assistant" data-api-message="${index}"><div class="assistant-avatar" aria-hidden="true">C</div><div class="api-message-bubble"><div class="api-message-label">Claude · API</div>${body}</div></article>`;
    }

    function renderChat() {
      if (!chatMessages.length) {
        elements.messages.innerHTML = '<div class="api-chat-empty" id="apiChatEmpty"><div class="welcome-orb" aria-hidden="true">C</div><h2>与 Claude 开始新聊天</h2><p>只有这个新聊天中的内容会发送给 Anthropic API。恢复档案不会被读取或上传。</p></div>';
        return;
      }
      elements.messages.innerHTML = chatMessages.map(renderMessage).join("");
      elements.messages.scrollIntoView({ block: "end" });
    }

    function scheduleRender() {
      if (renderFrame) return;
      renderFrame = window.requestAnimationFrame(() => {
        renderFrame = 0;
        renderChat();
      });
    }

    function parseEventBlock(block, onDelta, usage) {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") return;
      const event = JSON.parse(data);
      if (event.type === "error") throw new Error(event.error?.message || "Claude API 流式响应出错");
      if (event.type === "message_start") {
        usage.input_tokens = event.message?.usage?.input_tokens || 0;
      }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        onDelta(event.delta.text || "");
      }
      if (event.type === "message_delta") {
        usage.output_tokens = event.usage?.output_tokens || usage.output_tokens || 0;
      }
    }

    async function streamMessage(messages, onDelta, signal) {
      const response = await fetch(`${API_ORIGIN}/v1/messages`, {
        method: "POST",
        headers: requestHeaders(apiKey),
        body: JSON.stringify({
          model: currentModel,
          max_tokens: 4096,
          stream: true,
          messages,
        }),
        signal,
      });
      if (!response.ok) throw new Error(await apiError(response));
      if (!response.body) throw new Error("当前浏览器无法读取 Claude 的流式回复");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const usage = { input_tokens: 0, output_tokens: 0 };
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          parseEventBlock(block, onDelta, usage);
          boundary = buffer.indexOf("\n\n");
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) parseEventBlock(buffer, onDelta, usage);
      return usage;
    }

    async function sendMessage(text) {
      if (requestController) return;
      if (!(await ensureConnection())) return;
      const content = text.trim();
      if (!content) return;

      chatMessages.push({ role: "user", content });
      const assistant = { role: "assistant", content: "" };
      chatMessages.push(assistant);
      elements.input.value = "";
      elements.input.style.height = "auto";
      elements.input.disabled = true;
      elements.sendButton.disabled = true;
      elements.stopButton.classList.remove("hidden");
      requestController = new AbortController();
      renderChat();
      updateStatus("Claude 正在回复…");

      const payloadMessages = chatMessages
        .slice(0, -1)
        .filter((message) => !message.error && message.content.trim())
        .map((message) => ({ role: message.role, content: message.content }));

      try {
        const usage = await streamMessage(
          payloadMessages,
          (delta) => {
            assistant.content += delta;
            scheduleRender();
          },
          requestController.signal,
        );
        updateStatus(
          usage.input_tokens || usage.output_tokens
            ? `${currentModel} · ${usage.input_tokens} 输入 / ${usage.output_tokens} 输出 tokens`
            : currentModel,
        );
      } catch (error) {
        if (error.name === "AbortError") {
          if (!assistant.content) chatMessages.pop();
          updateStatus("已停止生成");
        } else {
          assistant.error = error.message;
          updateStatus("Claude API 请求失败");
        }
      } finally {
        requestController = null;
        elements.input.disabled = false;
        elements.sendButton.disabled = false;
        elements.stopButton.classList.add("hidden");
        renderChat();
        elements.input.focus();
      }
    }

    async function open() {
      options.enterMode();
      document.body.classList.remove("sidebar-open");
      renderChat();
      if (!apiKey) showSettings();
      else await ensureConnection();
      elements.input.focus();
    }

    elements.newChatButton.addEventListener("click", open);
    elements.settingsButton.addEventListener("click", showSettings);
    elements.settingsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const candidate = elements.apiKeyInput.value.trim() || apiKey;
      if (!candidate) {
        elements.settingsError.textContent = "请输入 Anthropic API Key";
        return;
      }
      elements.settingsError.textContent = "正在连接 Anthropic API…";
      try {
        const models = await fetchModels(candidate);
        storeApiKey(candidate, elements.rememberKey.checked);
        renderModelOptions(models, currentModel);
        elements.apiKeyInput.value = "";
        elements.settingsError.textContent = "";
        elements.settingsDialog.close();
        options.showToast("Claude API 已连接");
        elements.input.focus();
      } catch (error) {
        elements.settingsError.textContent = error.message;
      }
    });

    elements.modelSelect.addEventListener("change", () => {
      currentModel = elements.modelSelect.value;
      if (currentModel) localStorage.setItem(MODEL_KEY, currentModel);
      updateStatus();
    });

    elements.forgetKey.addEventListener("click", () => {
      clearApiKey();
      elements.settingsError.textContent = "这台设备上的 Claude API Key 已删除";
    });

    elements.form.addEventListener("submit", (event) => {
      event.preventDefault();
      sendMessage(elements.input.value);
    });

    elements.input.addEventListener("input", () => {
      elements.input.style.height = "auto";
      elements.input.style.height = `${Math.min(elements.input.scrollHeight, 180)}px`;
    });

    elements.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendMessage(elements.input.value);
      }
    });

    elements.stopButton.addEventListener("click", () => requestController?.abort());
    updateStatus();

    return Object.freeze({ open, showSettings });
  }

  window.ClaudeApiChat = Object.freeze({ init });
})();
