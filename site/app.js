"use strict";

const elements = {
  searchInput: document.getElementById("searchInput"),
  conversationList: document.getElementById("conversationList"),
  listHeading: document.getElementById("listHeading"),
  listCount: document.getElementById("listCount"),
  archiveStats: document.getElementById("archiveStats"),
  conversationTitle: document.getElementById("conversationTitle"),
  conversationMeta: document.getElementById("conversationMeta"),
  rawConversationButton: document.getElementById("rawConversationButton"),
  welcome: document.getElementById("welcome"),
  conversationView: document.getElementById("conversationView"),
  messages: document.getElementById("messages"),
  chatScroll: document.getElementById("chatScroll"),
  rawDialog: document.getElementById("rawDialog"),
  rawDialogTitle: document.getElementById("rawDialogTitle"),
  rawJsonContent: document.getElementById("rawJsonContent"),
  copyRawButton: document.getElementById("copyRawButton"),
  libraryButton: document.getElementById("libraryButton"),
  libraryDialog: document.getElementById("libraryDialog"),
  libraryContent: document.getElementById("libraryContent"),
  menuButton: document.getElementById("menuButton"),
  sidebarScrim: document.getElementById("sidebarScrim"),
  toast: document.getElementById("toast"),
  apiChatView: document.getElementById("apiChatView"),
  apiSettingsButton: document.getElementById("apiSettingsButton"),
};

const state = {
  activeConversationUuid: null,
  activeConversation: null,
  total: 0,
  searchTimer: null,
  searchController: null,
  rawJson: "",
  apiChatMode: false,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value, withTime = false) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function displayConversationTitle(item) {
  if (item.display_title !== "无正文会话") return item.display_title;
  return `无正文会话 · ${formatDate(item.created_at, true)}`;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "大小未知";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

function groupLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "较早";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startToday - startDate) / 86400000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return "过去 7 天";
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1} 月`;
  }
  return `${date.getFullYear()} 年`;
}

async function fetchJson(url, options = {}) {
  if (window.claudeArchiveDataSource) {
    return window.claudeArchiveDataSource.fetchJson(url, options);
  }
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `读取失败 (${response.status})`;
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }
  return response.json();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("show"), 1800);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    showToast("已复制");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    showToast("已复制");
  }
}

function renderInline(value) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
  );
  return html;
}

function renderMarkdownText(value) {
  const lines = String(value ?? "")
    .replaceAll("\r\n", "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .split("\n");
  const html = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listType || !listItems.length) return;
    html.push(`<${listType}>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };
  const flushText = () => {
    flushParagraph();
    flushList();
  };
  const splitTableRow = (line) =>
    line
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((cell) => cell.trim());
  const tableDivider = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const nextLine = lines[index + 1] || "";

    if (!line.trim()) {
      flushText();
      index += 1;
      continue;
    }

    if (line.includes("|") && tableDivider.test(nextLine)) {
      flushText();
      const headers = splitTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      html.push(`<div class="markdown-table-wrap"><table><thead><tr>${headers
        .map((cell) => `<th>${renderInline(cell)}</th>`)
        .join("")}</tr></thead><tbody>${rows
        .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`);
      continue;
    }

    const heading = line.match(/^\s*(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushText();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushText();
      html.push("<hr>");
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      flushText();
      const quoteLines = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      html.push(`<blockquote>${quoteLines.map(renderInline).join("<br>")}</blockquote>`);
      continue;
    }

    const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextType = unordered ? "ul" : "ol";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((unordered || ordered)[1]);
      index += 1;
      continue;
    }

    flushList();
    paragraph.push(line);
    index += 1;
  }

  flushText();
  return html.join("");
}

function renderMarkdown(value) {
  const source = String(value ?? "").replaceAll("\r\n", "\n");
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  const parts = [];
  let cursor = 0;
  let match;
  while ((match = fence.exec(source)) !== null) {
    if (match.index > cursor) {
      parts.push(renderMarkdownText(source.slice(cursor, match.index)));
    }
    const language = match[1].trim() || "代码";
    const code = match[2].replace(/\n$/, "");
    parts.push(
      `<div class="code-block"><div class="code-header"><span>${escapeHtml(
        language,
      )}</span><button class="copy-code" type="button">复制</button></div><pre><code>${escapeHtml(
        code,
      )}</code></pre></div>`,
    );
    cursor = fence.lastIndex;
  }
  if (cursor < source.length) {
    parts.push(renderMarkdownText(source.slice(cursor)));
  }
  return `<div class="markdown">${parts.join("")}</div>`;
}

function renderSearchSnippet(value) {
  return escapeHtml(value || "")
    .replaceAll("[[H]]", "<mark>")
    .replaceAll("[[/H]]", "</mark>");
}

function renderJsonPreview(value) {
  return `<pre class="json-preview">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function collectShortStrings(value, result = []) {
  if (result.length >= 4) return result;
  if (typeof value === "string" && value.trim()) {
    result.push(value.trim());
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectShortStrings(item, result));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectShortStrings(item, result));
  }
  return result;
}

function renderCitations(citations) {
  if (!Array.isArray(citations) || citations.length === 0) return "";
  return `<div class="citation-list">${citations
    .map((citation, index) => {
      const strings = collectShortStrings(citation).slice(0, 3);
      const label = strings.length ? strings.join(" · ") : `引用 ${index + 1}`;
      return `<div class="citation-item">${escapeHtml(label)}</div>`;
    })
    .join("")}</div>`;
}

function flagBadges(block) {
  const badges = [];
  if (block.truncated) badges.push('<span class="badge error">已截断</span>');
  if (block.cut_off) badges.push('<span class="badge error">中断</span>');
  if (block.thinking_hidden) badges.push('<span class="badge">原界面隐藏</span>');
  if (block.hidden || block.hidden_in_chat) badges.push('<span class="badge">隐藏内容</span>');
  if (block.is_error) badges.push('<span class="badge error">错误</span>');
  if (block.is_mcp_app) badges.push('<span class="badge">MCP</span>');
  return badges.join(" ");
}

function renderToolResultContent(content) {
  if (typeof content === "string") {
    return `<pre class="tool-output">${escapeHtml(content)}</pre>`;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return `<pre class="tool-output">${escapeHtml(item)}</pre>`;
        }
        if (item && typeof item.text === "string") {
          return `<pre class="tool-output">${escapeHtml(item.text)}</pre>`;
        }
        return renderJsonPreview(item);
      })
      .join("");
  }
  return renderJsonPreview(content);
}

function renderContentBlock(block, index) {
  const type = block?.type || "unknown";
  const badges = flagBadges(block || {});
  if (type === "text") {
    const body = renderMarkdown(block.text || "");
    const citations = renderCitations(block.citations);
    if (block.hidden || block.hidden_in_chat) {
      return `<details class="content-block unknown-block"><summary>隐藏文本 ${badges}</summary><div class="block-body">${body}${citations}</div></details>`;
    }
    return `<div class="content-block">${body}${citations}</div>`;
  }

  if (type === "thinking") {
    const summaries = Array.isArray(block.summaries)
      ? block.summaries
          .map((item) => (typeof item === "string" ? item : item?.summary))
          .filter(Boolean)
          .join("\n")
      : "";
    const thinking = block.thinking || "这段思考内容未包含在导出数据中。";
    return `<details class="content-block thinking-block"><summary>思考过程 ${badges}</summary><div class="block-body">${
      summaries ? `<div class="thinking-summary">${renderMarkdown(summaries)}</div>` : ""
    }${renderMarkdown(thinking)}</div></details>`;
  }

  if (type === "tool_use") {
    const name = block.name || block.tool_identifier || `工具调用 ${index + 1}`;
    const message = block.message || block.display_content?.text || "";
    return `<details class="content-block tool-block"><summary>调用工具：${escapeHtml(
      name,
    )} ${badges}</summary><div class="block-body">${
      message ? `<div class="tool-message">${escapeHtml(message)}</div>` : ""
    }${renderJsonPreview(block.input ?? {})}</div></details>`;
  }

  if (type === "tool_result") {
    const name = block.name || "工具结果";
    return `<details class="content-block tool-block"><summary>${escapeHtml(
      name,
    )} · 工具结果 ${badges}</summary><div class="block-body">${renderToolResultContent(
      block.content,
    )}</div></details>`;
  }

  if (type === "flag") {
    return `<div class="content-block notice-block">系统标记：${escapeHtml(
      block.flag || "flag",
    )}</div>`;
  }

  return `<details class="content-block unknown-block"><summary>${escapeHtml(
    type,
  )} ${badges}</summary><div class="block-body">${renderJsonPreview(block)}</div></details>`;
}

function renderAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return "";
  return `<div class="attachment-list">${attachments
    .map((attachment) => {
      const name = attachment.file_name || "未命名附件";
      const meta = [attachment.file_type, formatBytes(attachment.file_size)].filter(Boolean).join(" · ");
      const extracted = attachment.extracted_content || "导出包没有提供可读取的文本。";
      return `<details class="attachment-card"><summary><span>▧</span><span>${escapeHtml(
        name,
      )}</span><span class="file-meta">${escapeHtml(
        meta,
      )} · 仅提取文本</span></summary><div class="block-body"><pre class="attachment-text">${escapeHtml(
        extracted,
      )}</pre></div></details>`;
    })
    .join("")}</div>`;
}

function renderFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return "";
  return `<div class="file-list">${files
    .map(
      (file) => `<div class="file-card"><span class="file-icon">▤</span><span>${escapeHtml(
        file.file_name || "文件引用",
      )}</span><span class="file-warning">原文件未包含在导出包中</span></div>`,
    )
    .join("")}</div>`;
}

function renderMessage(message) {
  const sender = message.sender === "human" ? "human" : "assistant";
  const label = sender === "human" ? "你" : "Claude";
  let content;
  if (Array.isArray(message.content_blocks) && message.content_blocks.length) {
    content = message.content_blocks.map(renderContentBlock).join("");
  } else {
    content = renderMarkdown(message.text || "");
  }
  const avatar = sender === "assistant" ? '<div class="assistant-avatar" aria-hidden="true">C</div>' : "";
  return `<article class="message ${sender}" id="message-${escapeHtml(
    message.uuid,
  )}"><div class="message-shell">${avatar}<div class="message-card"><div class="message-meta"><span class="sender-name">${label}</span><span>${escapeHtml(
    formatDate(message.created_at, true),
  )}</span><button class="raw-message-button" type="button" data-raw-message="${escapeHtml(
    message.uuid,
  )}">原始 JSON</button></div><div class="message-content">${content}${renderAttachments(
    message.attachments,
  )}${renderFiles(message.files)}</div></div></div></article>`;
}

function renderMissingReply(message) {
  return `<article class="message assistant missing-reply"><div class="message-shell"><div class="assistant-avatar" aria-hidden="true">C</div><div class="message-card"><div class="message-meta"><span class="sender-name">Claude</span><span>原始导出缺口</span></div><details><summary>此处有一条 Claude 答复未包含在导出文件中</summary><p>下一条消息引用了答复 ID <code>${escapeHtml(
    message.parent_message_uuid,
  )}</code>，但这个 ID 的正文没有出现在你下载的任何原始 JSON 中。阅读器不会伪造其内容。</p></details></div></div></article>`;
}

function renderMessageSequence(messages) {
  return messages
    .map((message) => `${message.missing_parent ? renderMissingReply(message) : ""}${renderMessage(message)}`)
    .join("");
}

async function loadStats() {
  try {
    const data = await fetchJson("/api/stats");
    const storageLabel = window.claudeArchiveDataSource ? "已加密云端" : "仅本地";
    const missingLabel = data.missing_assistant_replies
      ? ` · 当前档案仍缺少 ${data.missing_assistant_replies.toLocaleString("zh-CN")} 条答复`
      : "";
    elements.archiveStats.textContent = `${data.counts.conversations} 个会话 · ${data.counts.messages.toLocaleString(
      "zh-CN",
    )} 条消息${missingLabel} · ${storageLabel}`;
  } catch (error) {
    elements.archiveStats.textContent = `档案读取失败：${error.message}`;
  }
}

function conversationButton(item, searchMode) {
  const active = item.uuid === state.activeConversationUuid ? " active" : "";
  const snippet = searchMode && item.match_snippet
    ? `<div class="search-snippet">${renderSearchSnippet(item.match_snippet)}</div>`
    : "";
  const derived = item.title_is_derived ? '<span class="derived-dot" title="由消息生成的显示标题"></span>' : "";
  return `<button class="conversation-item${active}" type="button" data-conversation="${escapeHtml(
    item.uuid,
  )}" data-focus-message="${escapeHtml(item.matched_message_uuid || "")}"><div class="conversation-title">${escapeHtml(
    displayConversationTitle(item),
  )}</div><div class="conversation-subline">${derived}<span>${escapeHtml(
    formatDate(item.updated_at),
  )}</span><span>${item.message_count} 条</span></div>${snippet}</button>`;
}

function renderConversationList(data) {
  const searchMode = Boolean(data.query);
  elements.listHeading.textContent = searchMode ? `搜索“${data.query}”` : "最近对话";
  elements.listCount.textContent = searchMode ? `${data.total} 条匹配` : `${data.total}`;
  if (!data.items.length) {
    elements.conversationList.innerHTML = '<div class="sidebar-empty">没有找到匹配内容。<br>可尝试更短或不同的关键词。</div>';
    return;
  }
  if (searchMode) {
    elements.conversationList.innerHTML = data.items
      .map((item) => conversationButton(item, true))
      .join("");
    return;
  }
  let currentGroup = "";
  const html = [];
  data.items.forEach((item) => {
    const group = groupLabel(item.updated_at);
    if (group !== currentGroup) {
      currentGroup = group;
      html.push(`<div class="conversation-group">${escapeHtml(group)}</div>`);
    }
    html.push(conversationButton(item, false));
  });
  elements.conversationList.innerHTML = html.join("");
}

async function loadConversations(query = "") {
  if (state.searchController) state.searchController.abort();
  state.searchController = new AbortController();
  elements.conversationList.innerHTML = '<div class="sidebar-loading">正在搜索本地档案…</div>';
  try {
    const data = await fetchJson(
      `/api/conversations?limit=300&q=${encodeURIComponent(query)}`,
      { signal: state.searchController.signal },
    );
    renderConversationList(data);
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.conversationList.innerHTML = `<div class="sidebar-empty">${escapeHtml(error.message)}</div>`;
  }
}

function setConversationLoading() {
  elements.welcome.classList.add("hidden");
  elements.conversationView.classList.remove("hidden");
  elements.messages.innerHTML = '<div class="loading-card">正在读取完整消息内容…</div>';
}

function enterApiChatMode() {
  state.apiChatMode = true;
  state.activeConversationUuid = null;
  state.activeConversation = null;
  elements.welcome.classList.add("hidden");
  elements.conversationView.classList.add("hidden");
  elements.apiChatView.classList.remove("hidden");
  elements.conversationTitle.textContent = "新聊天";
  elements.conversationMeta.textContent = "Claude API · 只发送这个新聊天的内容 · 不读取恢复档案";
  elements.rawConversationButton.classList.add("hidden");
  elements.rawConversationButton.disabled = true;
  elements.apiSettingsButton.classList.remove("hidden");
  document.querySelectorAll(".conversation-item").forEach((item) => item.classList.remove("active"));
}

function leaveApiChatMode() {
  if (!state.apiChatMode) return;
  state.apiChatMode = false;
  elements.apiChatView.classList.add("hidden");
  elements.rawConversationButton.classList.remove("hidden");
  elements.apiSettingsButton.classList.add("hidden");
}

async function loadConversation(uuid, options = {}) {
  const { focus = "", updateHistory = true } = options;
  leaveApiChatMode();
  state.activeConversationUuid = uuid;
  document.querySelectorAll(".conversation-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.conversation === uuid);
  });
  document.body.classList.remove("sidebar-open");
  setConversationLoading();
  const params = new URLSearchParams();
  if (focus) params.set("focus", focus);
  try {
    const data = await fetchJson(`/api/conversations/${encodeURIComponent(uuid)}?${params}`);
    state.activeConversation = data.conversation;
    state.total = data.total;
    elements.conversationTitle.textContent = displayConversationTitle(data.conversation);
    elements.conversationMeta.textContent = `${formatDate(
      data.conversation.created_at,
      true,
    )} · 已载入全部 ${data.total} 条档案消息${
      data.missing_reply_count ? ` · 当前档案仍缺少 ${data.missing_reply_count} 条 Claude 答复` : ""
    }${data.conversation.title_is_derived ? " · 显示标题由消息生成" : ""}`;
    elements.rawConversationButton.disabled = false;
    elements.rawConversationButton.dataset.uuid = uuid;
    elements.messages.innerHTML = data.messages.length
      ? renderMessageSequence(data.messages)
      : '<div class="loading-card">这个会话在导出数据中没有消息。</div>';
    if (updateHistory) {
      history.pushState({ conversation: uuid }, "", `#${encodeURIComponent(uuid)}`);
    }
    if (focus) {
      window.requestAnimationFrame(() => {
        const target = document.getElementById(`message-${focus}`);
        if (target) {
          target.scrollIntoView({ block: "center" });
          target.classList.add("flash");
          window.setTimeout(() => target.classList.remove("flash"), 1900);
        }
      });
    } else {
      elements.chatScroll.scrollTop = 0;
    }
  } catch (error) {
    elements.messages.innerHTML = `<div class="error-card">读取失败：${escapeHtml(error.message)}</div>`;
  }
}

async function showRaw(type, uuid, title) {
  elements.rawDialogTitle.textContent = title;
  elements.rawJsonContent.textContent = "正在读取…";
  state.rawJson = "";
  elements.rawDialog.showModal();
  try {
    const data = await fetchJson(`/api/raw/${type}/${encodeURIComponent(uuid)}`);
    state.rawJson = JSON.stringify(data, null, 2);
    elements.rawJsonContent.textContent = state.rawJson;
  } catch (error) {
    elements.rawJsonContent.textContent = `读取失败：${error.message}`;
  }
}

function renderLibrary(data) {
  const projects = Array.isArray(data.projects) ? data.projects : [];
  const memories = Array.isArray(data.memories) ? data.memories : [];
  const projectHtml = projects.length
    ? projects
        .map(
          (project) => `<div class="library-card"><h4>${escapeHtml(
            project.name || "未命名项目",
          )}</h4><p>${escapeHtml(project.description || "没有项目描述")}</p><p>${
            Array.isArray(project.docs) ? project.docs.length : 0
          } 个项目文档 · 更新于 ${escapeHtml(formatDate(project.updated_at))}</p>${
            project.prompt_template
              ? `<details class="unknown-block"><summary>项目提示词</summary><div class="block-body">${renderMarkdown(
                  project.prompt_template,
                )}</div></details>`
              : ""
          }</div>`,
        )
        .join("")
    : '<div class="library-card"><p>没有项目记录。</p></div>';

  const memoryHtml = memories.length
    ? memories
        .map((memory) => {
          const projectMemories = memory.project_memories && typeof memory.project_memories === "object"
            ? Object.entries(memory.project_memories)
                .map(
                  ([uuid, value]) => `<div class="library-card"><h4>项目 Memory · ${escapeHtml(
                    uuid,
                  )}</h4><div class="memory-text">${escapeHtml(
                    typeof value === "string" ? value : JSON.stringify(value, null, 2),
                  )}</div></div>`,
                )
                .join("")
            : "";
          return `<div class="library-card"><h4>全局对话 Memory</h4><div class="memory-text">${escapeHtml(
            memory.conversations_memory || "没有全局 Memory 内容。",
          )}</div></div>${projectMemories}`;
        })
        .join("")
    : '<div class="library-card"><p>没有 Memory 记录。</p></div>';

  return `<section class="library-section"><h3>项目（${projects.length}）</h3>${projectHtml}</section><section class="library-section"><h3>Memory</h3>${memoryHtml}</section>`;
}

async function openLibrary() {
  elements.libraryContent.textContent = "正在读取项目与 Memory…";
  elements.libraryDialog.showModal();
  try {
    const data = await fetchJson("/api/library");
    elements.libraryContent.innerHTML = renderLibrary(data);
  } catch (error) {
    elements.libraryContent.innerHTML = `<div class="error-card">${escapeHtml(error.message)}</div>`;
  }
}

elements.searchInput.addEventListener("input", () => {
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(() => loadConversations(elements.searchInput.value.trim()), 260);
});

elements.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.searchInput.value) {
    elements.searchInput.value = "";
    loadConversations("");
  }
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.searchInput.focus();
  }
});

elements.conversationList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-conversation]");
  if (!button) return;
  loadConversation(button.dataset.conversation, {
    focus: button.dataset.focusMessage || "",
  });
});

elements.conversationView.addEventListener("click", (event) => {
  const rawButton = event.target.closest("[data-raw-message]");
  if (rawButton) {
    showRaw("message", rawButton.dataset.rawMessage, "消息原始 JSON");
    return;
  }
  const copyButton = event.target.closest(".copy-code");
  if (copyButton) {
    const code = copyButton.closest(".code-block")?.querySelector("code")?.textContent || "";
    copyText(code);
  }
});

elements.rawConversationButton.addEventListener("click", () => {
  const uuid = elements.rawConversationButton.dataset.uuid;
  if (uuid) showRaw("conversation", uuid, "会话原始 JSON");
});

elements.copyRawButton.addEventListener("click", () => {
  if (state.rawJson) copyText(state.rawJson);
});

elements.libraryButton.addEventListener("click", openLibrary);
elements.menuButton.addEventListener("click", () => document.body.classList.add("sidebar-open"));
elements.sidebarScrim.addEventListener("click", () => document.body.classList.remove("sidebar-open"));

const apiChat = window.ClaudeApiChat?.init({
  enterMode: enterApiChatMode,
  escapeHtml,
  renderMarkdown,
  showToast,
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close());
});

// Dialogs remain open when their backdrop is clicked.

window.addEventListener("popstate", () => {
  const uuid = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (uuid && uuid !== state.activeConversationUuid) {
    loadConversation(uuid, { updateHistory: false });
  }
});

async function initialize() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // Local reading still works if PWA installation is unavailable.
    });
  }
  if (window.claudeArchiveDataSource) {
    await window.claudeArchiveDataSource.ready();
  }
  await Promise.all([loadStats(), loadConversations("")]);
  const uuid = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (uuid) {
    loadConversation(uuid, { updateHistory: false });
  }
}

initialize();
