"use strict";

(() => {
  const DEFAULT_API_BASE_URL = "https://api.anthropic.com/v1";
  const API_VERSION = "2023-06-01";
  const SESSION_KEY = "claudeApiKeySession";
  const REMEMBERED_KEY = "claudeApiKeyRemembered";
  const MODEL_KEY = "claudeApiModel";
  const BASE_URL_KEY = "claudeApiBaseUrl";
  const AUTH_MODE_KEY = "claudeApiAuthMode";
  const MEMORY_KEY = "claudeApiPortableMemory";
  const MAX_MEMORY_BYTES = 200 * 1024;
  const HISTORY_KEY = "claudeApiChatHistoryV1";
  const MAX_MESSAGES_PER_CHAT = 3000;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_IMAGE_COUNT = 10;
  const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
  const DIRECT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

  function init(options) {
    const elements = {
      newChatButton: document.getElementById("newChatButton"),
      settingsButton: document.getElementById("apiSettingsButton"),
      settingsDialog: document.getElementById("apiSettingsDialog"),
      settingsForm: document.getElementById("apiSettingsForm"),
      apiKeyInput: document.getElementById("anthropicApiKey"),
      apiBaseUrlInput: document.getElementById("anthropicApiBaseUrl"),
      rememberKey: document.getElementById("rememberAnthropicKey"),
      modelSelect: document.getElementById("anthropicModel"),
      composerModelSelect: document.getElementById("apiComposerModel"),
      refreshModels: document.getElementById("refreshAnthropicModels"),
      settingsError: document.getElementById("apiSettingsError"),
      forgetKey: document.getElementById("forgetAnthropicKey"),
      memoryFile: document.getElementById("apiMemoryFile"),
      memoryStatus: document.getElementById("apiMemoryStatus"),
      clearMemory: document.getElementById("clearApiMemory"),
      chatList: document.getElementById("apiChatList"),
      messages: document.getElementById("apiChatMessages"),
      empty: document.getElementById("apiChatEmpty"),
      form: document.getElementById("apiChatForm"),
      input: document.getElementById("apiChatInput"),
      imageInput: document.getElementById("apiImageInput"),
      imagePreviews: document.getElementById("apiImagePreviews"),
      attachImageButton: document.getElementById("apiAttachImageButton"),
      status: document.getElementById("apiChatStatus"),
      sendButton: document.getElementById("apiSendButton"),
      stopButton: document.getElementById("apiStopButton"),
    };

    let apiKey = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(REMEMBERED_KEY) || "";
    let apiBaseUrl = localStorage.getItem(BASE_URL_KEY) || DEFAULT_API_BASE_URL;
    let currentModel = localStorage.getItem(MODEL_KEY) || "";
    let availableModels = [];
    // Anthropic accepts x-api-key, while many trusted relay services expose the
    // Anthropic Messages endpoints but expect the OpenAI-style Bearer header.
    let apiAuthMode = localStorage.getItem(AUTH_MODE_KEY) || "anthropic";
    let portableMemory = localStorage.getItem(MEMORY_KEY) || "";
    let chatMessages = [];
    let chatId = "";
    let chatHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    let pendingImages = [];
    let requestController = null;
    let renderFrame = 0;

    function requestHeaders(key, authMode = apiAuthMode) {
      return {
        "content-type": "application/json",
        ...(authMode === "bearer" ? { authorization: `Bearer ${key}` } : { "x-api-key": key }),
        "anthropic-version": API_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      };
    }

    function updateMemoryStatus() {
      elements.memoryStatus.textContent = portableMemory
        ? `已导入个人记忆（${Math.ceil(new Blob([portableMemory]).size / 1024)} KB）；只会随独立 API 聊天发送，不读取恢复档案。`
        : "未导入个人记忆；不会读取左侧恢复档案。";
    }

    function memorySystemPrompt() {
      return portableMemory
        ? `以下是用户主动导入的长期协作记忆。把它作为背景，不要声称你能访问用户设备、旧聊天或任何目录；如与用户当前说法冲突，以当前说法为准。\n\n${portableMemory}`
        : "";
    }

    function saveChat() {
      if (!chatId) return;
      if (chatMessages.length > MAX_MESSAGES_PER_CHAT) chatMessages = chatMessages.slice(-MAX_MESSAGES_PER_CHAT);
      const firstUserMessage = chatMessages.find((item) => item.role === "user" && item.content)?.content || "新聊天";
      const record = { id: chatId, title: firstUserMessage.slice(0, 60), updatedAt: Date.now(), messages: chatMessages.map(({ role, content, model, error }) => ({ role, content, model, error })) };
      chatHistory = [record, ...chatHistory.filter((item) => item.id !== chatId)].slice(0, 50);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(chatHistory)); } catch { updateStatus("聊天记录空间不足"); }
      renderHistory();
    }
    function renderHistory() { elements.chatList.innerHTML = chatHistory.map((item) => `<button class="conversation-item ${item.id === chatId ? "active" : ""}" type="button" data-api-chat="${options.escapeHtml(item.id)}"><strong>${options.escapeHtml(item.title)}</strong><small>${new Date(item.updatedAt).toLocaleDateString()}</small></button>`).join("") || '<div class="sidebar-empty">还没有新对话。</div>'; }

    function normalizeApiBaseUrl(value) {
      const supplied = String(value || "").trim() || DEFAULT_API_BASE_URL;
      let parsed;
      try {
        parsed = new URL(supplied);
      } catch {
        throw new Error("API 接口地址不是有效 URL");
      }
      if (parsed.protocol !== "https:") {
        throw new Error("API 接口地址必须使用 HTTPS");
      }
      if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error("API 接口地址不能包含账号、查询参数或 # 片段");
      }
      let pathname = parsed.pathname.replace(/\/+$/, "");
      if (!pathname) pathname = "/v1";
      return `${parsed.origin}${pathname}`;
    }

    function apiUrl(path, baseUrl = apiBaseUrl) {
      return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
    }

    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("无法读取图片文件"));
        reader.onload = () => resolve(String(reader.result || ""));
        reader.readAsDataURL(file);
      });
    }

    function dataUrlParts(dataUrl) {
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
      if (!match) throw new Error("图片编码失败");
      return { mediaType: match[1].toLowerCase(), data: match[2] };
    }

    function convertToJpeg(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
          try {
            const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
            let scale = longestEdge > 4096 ? 4096 / longestEdge : 1;
            const canvas = document.createElement("canvas");
            const compress = () => {
              canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
              canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
              canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
              canvas.toBlob(
                (blob) => {
                  if (!blob) {
                    URL.revokeObjectURL(url);
                    reject(new Error("无法转换这张图片，请改用 JPG、PNG、GIF 或 WebP"));
                    return;
                  }
                  if (blob.size <= MAX_IMAGE_BYTES || scale <= 0.16) {
                    URL.revokeObjectURL(url);
                    resolve(blob);
                    return;
                  }
                  scale *= 0.72;
                  compress();
                },
                "image/jpeg",
                0.86,
              );
            };
            compress();
          } catch {
            URL.revokeObjectURL(url);
            reject(new Error("无法转换这张图片，请改用 JPG、PNG、GIF 或 WebP"));
          }
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("无法读取这张图片；HEIC/HEIF 请在手机上先转换为 JPG"));
        };
        image.src = url;
      });
    }

    async function prepareImage(file) {
      if (!file || !String(file.type || "").startsWith("image/")) {
        throw new Error("只能添加图片文件");
      }
      let imageFile = file;
      if (!DIRECT_IMAGE_TYPES.has(file.type.toLowerCase()) || file.size > MAX_IMAGE_BYTES) {
        imageFile = await convertToJpeg(file);
      }
      if (imageFile.size > MAX_IMAGE_BYTES) {
        throw new Error("图片转换后仍超过 5 MiB；请先压缩或裁剪后再上传");
      }
      const dataUrl = await fileToDataUrl(imageFile);
      const { mediaType, data } = dataUrlParts(dataUrl);
      if (!DIRECT_IMAGE_TYPES.has(mediaType)) throw new Error("图片格式不受 Claude API 支持");
      return {
        id: crypto.randomUUID(),
        name: file.name || "图片",
        mediaType,
        data,
        dataUrl,
        byteSize: imageFile.size,
      };
    }

    function renderPendingImages() {
      if (!pendingImages.length) {
        elements.imagePreviews.classList.add("hidden");
        elements.imagePreviews.innerHTML = "";
        return;
      }
      elements.imagePreviews.classList.remove("hidden");
      elements.imagePreviews.innerHTML = pendingImages
        .map(
          (image) => `<figure class="api-image-preview"><img src="${options.escapeHtml(image.dataUrl)}" alt="${options.escapeHtml(
            image.name,
          )}"><figcaption>${options.escapeHtml(image.name)}</figcaption><button type="button" data-remove-image="${options.escapeHtml(
            image.id,
          )}" aria-label="移除图片 ${options.escapeHtml(image.name)}">×</button></figure>`,
        )
        .join("");
    }

    function renderMessageImages(images) {
      if (!Array.isArray(images) || !images.length) return "";
      return `<div class="api-message-images">${images
        .map(
          (image) => `<img src="${options.escapeHtml(image.dataUrl)}" alt="${options.escapeHtml(
            image.name || "已发送图片",
          )}" loading="lazy">`,
        )
        .join("")}</div>`;
    }

    function messageHasContent(message) {
      return Boolean(message?.content?.trim?.() || message?.images?.length);
    }

    function messageForApi(message) {
      if (message.role === "assistant") return { role: "assistant", content: message.content };
      const blocks = (message.images || []).map((image) => ({
        type: "image",
        source: { type: "base64", media_type: image.mediaType, data: image.data },
      }));
      if (message.content.trim()) blocks.push({ type: "text", text: message.content });
      return { role: "user", content: blocks };
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

    async function fetchModels(key, baseUrl = apiBaseUrl) {
      const modes = [...new Set([apiAuthMode, "anthropic", "bearer"])];
      let lastError;
      for (const authMode of modes) {
        const response = await fetch(`${apiUrl("models?limit=100", baseUrl)}`, {
          headers: requestHeaders(key, authMode),
        });
        if (!response.ok) {
          lastError = new Error(await apiError(response));
          // A relay often rejects the unsupported header with 401/403. Try the
          // other standard style before reporting the connection as failed.
          if (response.status === 401 || response.status === 403) continue;
          throw lastError;
        }
        const payload = await response.json();
        const models = Array.isArray(payload.data)
          ? payload.data.filter((model) => model && typeof model.id === "string")
          : [];
        if (!models.length) throw new Error("API 没有返回可用的 Claude 模型");
        apiAuthMode = authMode;
        localStorage.setItem(AUTH_MODE_KEY, apiAuthMode);
        return models;
      }
      throw new Error(`${lastError?.message || "API 鉴权失败"}；请确认中转站 Key 是否有效，或该中转站是否提供 Anthropic Messages API。`);
    }

    function renderModelOptions(models, selected) {
      availableModels = models;
      const validSelection = models.some((model) => model.id === selected) ? selected : preferredModel(models);
      const optionsHtml = models
        .map(
          (model) => `<option value="${options.escapeHtml(model.id)}">${options.escapeHtml(
            model.display_name || model.id,
          )}</option>`,
        )
        .join("");
      elements.modelSelect.innerHTML = optionsHtml;
      elements.composerModelSelect.innerHTML = optionsHtml;
      elements.modelSelect.disabled = false;
      elements.composerModelSelect.disabled = false;
      elements.modelSelect.value = validSelection;
      elements.composerModelSelect.value = validSelection;
      currentModel = validSelection;
      localStorage.setItem(MODEL_KEY, currentModel);
      updateStatus();
    }

    function storeApiSettings(value, baseUrl, remember) {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(REMEMBERED_KEY);
      if (remember) localStorage.setItem(REMEMBERED_KEY, value);
      else sessionStorage.setItem(SESSION_KEY, value);
      apiKey = value;
      apiBaseUrl = baseUrl;
      localStorage.setItem(BASE_URL_KEY, apiBaseUrl);
    }

    function clearApiKey() {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(REMEMBERED_KEY);
      apiKey = "";
      currentModel = "";
      availableModels = [];
      localStorage.removeItem(MODEL_KEY);
      localStorage.removeItem(AUTH_MODE_KEY);
      apiAuthMode = "anthropic";
      elements.modelSelect.disabled = true;
      elements.modelSelect.innerHTML = '<option value="">连接后读取可用模型</option>';
      elements.composerModelSelect.disabled = true;
      elements.composerModelSelect.innerHTML = '<option value="">连接 API 后选择模型</option>';
      elements.apiKeyInput.value = "";
      elements.apiKeyInput.placeholder = "sk-ant-…";
      elements.apiBaseUrlInput.value = apiBaseUrl;
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
        const models = await fetchModels(apiKey, apiBaseUrl);
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
      elements.apiBaseUrlInput.value = apiBaseUrl;
      elements.apiKeyInput.placeholder = apiKey ? "已连接；留空可继续使用当前 Key" : "sk-ant-…";
      if (availableModels.length) renderModelOptions(availableModels, currentModel);
      elements.settingsDialog.showModal();
    }

    function renderMessage(message, index) {
      if (message.role === "user") {
        const text = message.content ? options.renderMarkdown(message.content) : "";
        return `<article class="api-message user" data-api-message="${index}"><div class="api-message-bubble"><div class="api-message-label">你</div>${renderMessageImages(
          message.images,
        )}${text}</div></article>`;
      }
      const body = message.error
        ? `<div class="api-message-error">${options.escapeHtml(message.error)}</div>`
        : `<div class="markdown">${message.content ? options.renderMarkdown(message.content) : '<span class="api-thinking">Claude 正在思考…</span>'}</div>`;
      const model = availableModels.find((item) => item.id === message.model);
      const modelLabel = model?.display_name || message.model || "API";
      return `<article class="api-message assistant" data-api-message="${index}"><div class="assistant-avatar" aria-hidden="true">C</div><div class="api-message-bubble"><div class="api-message-label">Claude · ${options.escapeHtml(modelLabel)}</div>${body}</div></article>`;
    }

    function renderChat() {
      if (!chatMessages.length) {
        elements.messages.innerHTML = '<div class="api-chat-empty" id="apiChatEmpty"><div class="welcome-orb" aria-hidden="true">C</div><h2>与 Claude 开始新聊天</h2><p>只有这个新聊天中的内容会发送给 Anthropic API。恢复档案不会被读取或上传。</p></div>';
        return;
      }
      elements.messages.innerHTML = chatMessages.map(renderMessage).join("");
      elements.messages.scrollIntoView({ block: "end" });
      saveChat();
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

    async function streamMessage(messages, onDelta, signal, model, baseUrl) {
      const response = await fetch(apiUrl("messages", baseUrl), {
        method: "POST",
        headers: requestHeaders(apiKey),
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          stream: true,
          ...(memorySystemPrompt() ? { system: memorySystemPrompt() } : {}),
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
      if (!content && !pendingImages.length) return;

      const images = pendingImages;
      pendingImages = [];
      renderPendingImages();
      chatMessages.push({ role: "user", content, images });
      const requestModel = currentModel;
      const requestBaseUrl = apiBaseUrl;
      const assistant = { role: "assistant", content: "", model: requestModel };
      chatMessages.push(assistant);
      elements.input.value = "";
      elements.input.style.height = "auto";
      elements.input.disabled = true;
      elements.attachImageButton.disabled = true;
      elements.sendButton.disabled = true;
      elements.composerModelSelect.disabled = true;
      elements.stopButton.classList.remove("hidden");
      requestController = new AbortController();
      renderChat();
      updateStatus("Claude 正在回复…");

      const payloadMessages = chatMessages
        .slice(0, -1)
        .filter((message) => !message.error && messageHasContent(message))
        .map(messageForApi);

      try {
        const usage = await streamMessage(
          payloadMessages,
          (delta) => {
            assistant.content += delta;
            scheduleRender();
          },
          requestController.signal,
          requestModel,
          requestBaseUrl,
        );
        updateStatus(
          usage.input_tokens || usage.output_tokens
            ? `${requestModel} · ${usage.input_tokens} 输入 / ${usage.output_tokens} 输出 tokens`
            : requestModel,
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
        elements.attachImageButton.disabled = false;
        elements.sendButton.disabled = false;
        elements.composerModelSelect.disabled = !availableModels.length;
        elements.stopButton.classList.add("hidden");
        renderChat();
        elements.input.focus();
      }
    }

    async function open() {
      options.enterMode();
      if (!chatId) {
        const latest = chatHistory[0];
        chatId = latest?.id || crypto.randomUUID();
        chatMessages = latest?.messages || [];
      }
      document.body.classList.remove("sidebar-open");
      renderChat();
      if (!apiKey) showSettings();
      else await ensureConnection();
      elements.input.focus();
    }

    elements.newChatButton.addEventListener("click", async () => { chatId = crypto.randomUUID(); chatMessages = []; saveChat(); await open(); });
    elements.chatList.addEventListener("click", (event) => { const button = event.target.closest("[data-api-chat]"); if (!button) return; const record = chatHistory.find((item) => item.id === button.dataset.apiChat); if (!record) return; chatId = record.id; chatMessages = record.messages || []; options.enterMode(); renderChat(); });
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
        const candidateBaseUrl = normalizeApiBaseUrl(elements.apiBaseUrlInput.value);
        const models = await fetchModels(candidate, candidateBaseUrl);
        storeApiSettings(candidate, candidateBaseUrl, elements.rememberKey.checked);
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
      elements.composerModelSelect.value = currentModel;
      if (currentModel) localStorage.setItem(MODEL_KEY, currentModel);
      updateStatus();
    });

    elements.composerModelSelect.addEventListener("change", () => {
      currentModel = elements.composerModelSelect.value;
      elements.modelSelect.value = currentModel;
      if (currentModel) localStorage.setItem(MODEL_KEY, currentModel);
      updateStatus();
    });

    elements.refreshModels.addEventListener("click", async () => {
      if (!apiKey) {
        elements.settingsError.textContent = "请先输入并连接 Anthropic API Key";
        return;
      }
      elements.settingsError.textContent = "正在刷新 Claude 模型列表…";
      elements.refreshModels.disabled = true;
      try {
        const candidateBaseUrl = normalizeApiBaseUrl(elements.apiBaseUrlInput.value);
        renderModelOptions(await fetchModels(apiKey, candidateBaseUrl), currentModel);
        apiBaseUrl = candidateBaseUrl;
        localStorage.setItem(BASE_URL_KEY, apiBaseUrl);
        elements.settingsError.textContent = "模型列表已更新";
      } catch (error) {
        elements.settingsError.textContent = error.message;
      } finally {
        elements.refreshModels.disabled = false;
      }
    });

    elements.forgetKey.addEventListener("click", () => {
      clearApiKey();
      elements.settingsError.textContent = "这台设备上的 Claude API Key 已删除";
    });

    elements.memoryFile.addEventListener("change", async () => {
      const file = elements.memoryFile.files?.[0];
      elements.memoryFile.value = "";
      if (!file) return;
      if (file.size > MAX_MEMORY_BYTES) {
        elements.settingsError.textContent = "记忆文件不能超过 200 KB";
        return;
      }
      try {
        portableMemory = (await file.text()).trim();
        if (!portableMemory) throw new Error("记忆文件为空");
        localStorage.setItem(MEMORY_KEY, portableMemory);
        updateMemoryStatus();
        elements.settingsError.textContent = "个人记忆已在此浏览器导入";
      } catch (error) { elements.settingsError.textContent = error.message; }
    });

    elements.clearMemory.addEventListener("click", () => {
      portableMemory = "";
      localStorage.removeItem(MEMORY_KEY);
      updateMemoryStatus();
      elements.settingsError.textContent = "已移除个人记忆";
    });

    updateMemoryStatus();

    elements.form.addEventListener("submit", (event) => {
      event.preventDefault();
      sendMessage(elements.input.value);
    });

    elements.attachImageButton.addEventListener("click", () => elements.imageInput.click());

    elements.imageInput.addEventListener("change", async () => {
      const files = Array.from(elements.imageInput.files || []);
      elements.imageInput.value = "";
      if (!files.length) return;
      const capacity = MAX_IMAGE_COUNT - pendingImages.length;
      if (capacity <= 0) {
        options.showToast(`一次最多发送 ${MAX_IMAGE_COUNT} 张图片`);
        return;
      }
      for (const file of files.slice(0, capacity)) {
        try {
          const image = await prepareImage(file);
          const totalBytes = pendingImages.reduce((sum, item) => sum + item.byteSize, 0) + image.byteSize;
          if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
            options.showToast("本次消息图片总大小不能超过 20 MiB");
            break;
          }
          pendingImages.push(image);
        } catch (error) {
          options.showToast(error.message);
        }
      }
      if (files.length > capacity) options.showToast(`仅添加前 ${capacity} 张图片`);
      renderPendingImages();
    });

    elements.imagePreviews.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-image]");
      if (!button) return;
      pendingImages = pendingImages.filter((image) => image.id !== button.dataset.removeImage);
      renderPendingImages();
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

    return Object.freeze({ open, showSettings, refreshHistory: renderHistory, createNewChat: () => { chatId = crypto.randomUUID(); chatMessages = []; saveChat(); renderChat(); } });
  }

  window.ClaudeApiChat = Object.freeze({ init });
})();
