"use strict";

(() => {
  const config = window.CLAUDE_ARCHIVE_CONFIG || {};
  if (config.mode !== "encrypted-hosting") return;

  const archiveBase = config.archiveBase || "/archive/";
  const cache = new Map();
  let archiveKey = null;
  let manifest = null;
  let lastConversation = null;

  function base64UrlBytes(value) {
    const normalized = String(value || "").trim().replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function importArchiveKey(value) {
    const bytes = base64UrlBytes(value);
    if (bytes.length !== 32) throw new Error("恢复密钥格式不正确");
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["decrypt"]);
  }

  function encryptedPath(relativePath) {
    return `${archiveBase}${relativePath.replace(/\.json$/i, ".cwa")}`;
  }

  async function readEncryptedJson(relativePath, options = {}) {
    if (cache.has(relativePath)) return cache.get(relativePath);
    const response = await fetch(encryptedPath(relativePath), { signal: options.signal });
    if (!response.ok) throw new Error(`云端档案读取失败 (${response.status})`);
    const payload = new Uint8Array(await response.arrayBuffer());
    if (payload.length < 32 || new TextDecoder().decode(payload.slice(0, 4)) !== "CWA1") {
      throw new Error("云端档案格式不正确");
    }
    let compressed;
    try {
      compressed = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: payload.slice(4, 16) },
        archiveKey,
        payload.slice(16),
      );
    } catch {
      throw new Error("恢复密钥不正确");
    }
    if (typeof DecompressionStream === "undefined") {
      throw new Error("这台 iPhone 的系统版本过旧，无法解压档案；请升级 iOS 后重试");
    }
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
    const value = JSON.parse(await new Response(stream).text());
    cache.set(relativePath, value);
    return value;
  }

  function conversationPayload(rawConversation) {
    const item = manifest.conversations.find((entry) => entry.uuid === rawConversation.uuid);
    if (!item) throw new Error("会话不在完整性清单中");
    const rawMessages = Array.isArray(rawConversation.chat_messages) ? rawConversation.chat_messages : [];
    const missingParents = new Set(item.missing_reply_parent_uuids || []);
    const messages = rawMessages.map((message, position) => ({
      uuid: message.uuid,
      conversation_uuid: rawConversation.uuid,
      position,
      parent_message_uuid: message.parent_message_uuid,
      sender: message.sender,
      text: message.text,
      created_at: message.created_at,
      updated_at: message.updated_at,
      content_blocks: Array.isArray(message.content) ? message.content : [],
      attachments: Array.isArray(message.attachments) ? message.attachments : [],
      files: Array.isArray(message.files) ? message.files : [],
      missing_parent: missingParents.has(message.parent_message_uuid),
      raw: message,
    }));
    return {
      conversation: item,
      messages,
      offset: 0,
      limit: messages.length,
      total: messages.length,
      has_before: false,
      has_after: false,
      missing_reply_count: missingParents.size,
    };
  }

  function makeSnippet(value, query) {
    const text = String(value || "").replaceAll("\n", " ");
    const lower = text.toLocaleLowerCase();
    const needle = query.toLocaleLowerCase();
    const index = lower.indexOf(needle);
    if (index < 0) return text.slice(0, 180);
    const start = Math.max(0, index - 70);
    const end = Math.min(text.length, index + query.length + 100);
    return `${start ? "… " : ""}${text.slice(start, index)}[[H]]${text.slice(
      index,
      index + query.length,
    )}[[/H]]${text.slice(index + query.length, end)}${end < text.length ? " …" : ""}`;
  }

  async function listConversations(query, options) {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return { items: manifest.conversations, total: manifest.conversations.length, offset: 0, limit: 300, query: "" };
    }
    const searchFiles = Array.isArray(manifest.search_files)
      ? manifest.search_files
      : [manifest.search_file];
    const searchShards = await Promise.all(
      searchFiles.filter(Boolean).map((file) => readEncryptedJson(file, options)),
    );
    const conversationMap = new Map(manifest.conversations.map((item) => [item.uuid, item]));
    const matches = [];
    for (const searchRows of searchShards) {
      for (const row of searchRows) {
        const haystack = `${row.title || ""}\n${row.body || ""}`;
        if (!haystack.toLocaleLowerCase().includes(normalized)) continue;
        const conversation = conversationMap.get(row.conversation_uuid);
        if (!conversation) continue;
        matches.push({
          ...conversation,
          matched_message_uuid: row.message_uuid,
          matched_sender: row.sender,
          match_snippet: makeSnippet(row.body || row.title || "", query),
        });
      }
    }
    return { items: matches.slice(0, 300), total: matches.length, offset: 0, limit: 300, query };
  }

  async function fetchJson(url, options = {}) {
    const parsed = new URL(url, location.origin);
    if (parsed.pathname === "/api/stats") {
      return {
        counts: manifest.counts,
        source_archive_sha256: manifest.source.source_archive_sha256,
        missing_assistant_replies: manifest.missing_assistant_replies || 0,
      };
    }
    if (parsed.pathname === "/api/conversations") {
      return listConversations(parsed.searchParams.get("q") || "", options);
    }
    if (parsed.pathname === "/api/library") {
      return readEncryptedJson(manifest.library_file, options);
    }
    const conversationMatch = parsed.pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (conversationMatch) {
      const uuid = decodeURIComponent(conversationMatch[1]);
      const item = manifest.conversations.find((entry) => entry.uuid === uuid);
      if (!item) throw new Error("找不到这个会话");
      const raw = await readEncryptedJson(item.file, options);
      lastConversation = raw;
      return conversationPayload(raw);
    }
    const rawConversationMatch = parsed.pathname.match(/^\/api\/raw\/conversation\/([^/]+)$/);
    if (rawConversationMatch) {
      const uuid = decodeURIComponent(rawConversationMatch[1]);
      const item = manifest.conversations.find((entry) => entry.uuid === uuid);
      if (!item) throw new Error("找不到这个会话");
      return readEncryptedJson(item.file, options);
    }
    const rawMessageMatch = parsed.pathname.match(/^\/api\/raw\/message\/([^/]+)$/);
    if (rawMessageMatch) {
      const uuid = decodeURIComponent(rawMessageMatch[1]);
      const message = lastConversation?.chat_messages?.find((entry) => entry.uuid === uuid);
      if (!message) throw new Error("请先打开消息所在的会话");
      return message;
    }
    throw new Error("不支持的云端档案请求");
  }

  async function ready() {
    const gate = document.getElementById("cloudGate");
    const form = document.getElementById("cloudGateForm");
    const input = document.getElementById("archiveKeyInput");
    const remember = document.getElementById("rememberArchiveKey");
    const error = document.getElementById("cloudGateError");
    const lockButton = document.getElementById("lockArchiveButton");
    document.title = "Claude 私人档案";
    document.getElementById("conversationTitle").textContent = "Claude 私人档案";
    document.querySelector(".brand-subtitle").textContent = "私人云端档案";
    document.querySelector(".welcome-note").textContent = "档案经过端到端加密；原始导出缺口会明确标出，不会伪造内容。";
    lockButton.classList.remove("hidden");
    lockButton.addEventListener("click", () => {
      localStorage.removeItem("claudeArchiveKey");
      location.reload();
    });

    const unlock = async (value, shouldRemember) => {
      archiveKey = await importArchiveKey(value);
      cache.clear();
      manifest = await readEncryptedJson("manifest.json");
      if (manifest.format !== "claude-web-archive-v1") throw new Error("档案版本不受支持");
      if (shouldRemember) localStorage.setItem("claudeArchiveKey", value.trim());
      else localStorage.removeItem("claudeArchiveKey");
    };

    // A private first-open link can carry the key in the URL fragment. URL
    // fragments are not sent to the hosting server. After a successful
    // unlock, immediately remove it from the address bar and remember it on
    // this device, so later visits require no manual key entry.
    const fragmentParams = new URLSearchParams(
      location.hash.startsWith("#") ? location.hash.slice(1) : "",
    );
    const linkedKey = fragmentParams.get("unlock");
    let linkedKeyError = "";
    if (linkedKey) {
      try {
        await unlock(linkedKey, true);
        history.replaceState(null, "", `${location.pathname}${location.search}`);
        return;
      } catch {
        linkedKeyError = "私人链接无效或不属于这份档案。";
        history.replaceState(null, "", `${location.pathname}${location.search}`);
        localStorage.removeItem("claudeArchiveKey");
      }
    }

    const remembered = localStorage.getItem("claudeArchiveKey");
    if (remembered) {
      try {
        await unlock(remembered, true);
        return;
      } catch {
        localStorage.removeItem("claudeArchiveKey");
      }
    }

    gate.classList.remove("hidden");
    if (linkedKeyError) error.textContent = linkedKeyError;
    return new Promise((resolve) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "正在解锁…";
        try {
          await unlock(input.value, remember.checked);
          input.value = "";
          gate.classList.add("hidden");
          resolve();
        } catch (unlockError) {
          error.textContent = unlockError.message;
          input.select();
        }
      });
    });
  }

  window.claudeArchiveDataSource = Object.freeze({ fetchJson, ready });
})();
