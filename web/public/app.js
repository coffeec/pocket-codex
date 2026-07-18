'use strict';

const elements = {
  app: document.querySelector('#app'),
  sidebar: document.querySelector('#sidebar'),
  openSidebar: document.querySelector('#openSidebar'),
  closeSidebar: document.querySelector('#closeSidebar'),
  sidebarScrim: document.querySelector('#sidebarScrim'),
  newChatButton: document.querySelector('#newChatButton'),
  conversationList: document.querySelector('#conversationList'),
  archiveSection: document.querySelector('#archiveSection'),
  archiveToggle: document.querySelector('#archiveToggle'),
  archiveCount: document.querySelector('#archiveCount'),
  archivedList: document.querySelector('#archivedList'),
  providerLabel: document.querySelector('#providerLabel'),
  sidebarIndicator: document.querySelector('#sidebarIndicator'),
  sidebarStatus: document.querySelector('#sidebarStatus'),
  logoutButton: document.querySelector('#logoutButton'),
  conversationTitle: document.querySelector('#conversationTitle'),
  modelLabel: document.querySelector('#modelLabel'),
  contextMeter: document.querySelector('#contextMeter'),
  contextRing: document.querySelector('#contextRing'),
  renameConversation: document.querySelector('#renameConversation'),
  archiveConversation: document.querySelector('#archiveConversation'),
  statusStrip: document.querySelector('#statusStrip'),
  temperatureValue: document.querySelector('#temperatureValue'),
  memoryValue: document.querySelector('#memoryValue'),
  diskValue: document.querySelector('#diskValue'),
  batteryValue: document.querySelector('#batteryValue'),
  diskChip: document.querySelector('#diskChip'),
  palDot: document.querySelector('#palDot'),
  frpDot: document.querySelector('#frpDot'),
  apiDot: document.querySelector('#apiDot'),
  palValue: document.querySelector('#palValue'),
  frpValue: document.querySelector('#frpValue'),
  apiValue: document.querySelector('#apiValue'),
  statusMore: document.querySelector('#statusMore'),
  chatRegion: document.querySelector('#chatRegion'),
  emptyState: document.querySelector('#emptyState'),
  quickActions: document.querySelector('#quickActions'),
  messageList: document.querySelector('#messageList'),
  attachmentTray: document.querySelector('#attachmentTray'),
  modelSelect: document.querySelector('#modelSelect'),
  effortSelect: document.querySelector('#effortSelect'),
  capabilityNote: document.querySelector('#capabilityNote'),
  composer: document.querySelector('#composer'),
  promptInput: document.querySelector('#promptInput'),
  attachButton: document.querySelector('#attachButton'),
  cameraButton: document.querySelector('#cameraButton'),
  fileInput: document.querySelector('#fileInput'),
  cameraInput: document.querySelector('#cameraInput'),
  sendButton: document.querySelector('#sendButton'),
  stopButton: document.querySelector('#stopButton'),
  runState: document.querySelector('#runState'),
  characterCount: document.querySelector('#characterCount'),
  toast: document.querySelector('#toast'),
  loginScreen: document.querySelector('#loginScreen'),
  loginForm: document.querySelector('#loginForm'),
  loginUsername: document.querySelector('#loginUsername'),
  loginPassword: document.querySelector('#loginPassword'),
  loginError: document.querySelector('#loginError'),
  statusDialog: document.querySelector('#statusDialog'),
  statusDetails: document.querySelector('#statusDetails'),
  statusCheckedAt: document.querySelector('#statusCheckedAt'),
  refreshStatus: document.querySelector('#refreshStatus'),
  renameDialog: document.querySelector('#renameDialog'),
  renameForm: document.querySelector('#renameForm'),
  renameInput: document.querySelector('#renameInput'),
  archiveDialog: document.querySelector('#archiveDialog'),
  archiveForm: document.querySelector('#archiveForm'),
  archiveConversationId: document.querySelector('#archiveConversationId'),
  archiveConversationTitle: document.querySelector('#archiveConversationTitle'),
  deleteDialog: document.querySelector('#deleteDialog'),
  deleteForm: document.querySelector('#deleteForm'),
  deleteConversationId: document.querySelector('#deleteConversationId'),
};

const state = {
  conversations: [],
  archivedConversations: [],
  conversation: null,
  attachments: [],
  models: [],
  modelCatalog: null,
  provider: null,
  defaultModel: 'gpt-5.6-sol',
  draftModel: 'gpt-5.6-sol',
  draftEffort: 'high',
  capabilities: {},
  status: null,
  statusTimer: null,
  statusLoading: false,
  running: false,
  sendInFlight: false,
  liveMessage: null,
  renderFrame: null,
  toastTimer: null,
};

function svgIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/pocket-api${path}`, { ...options, headers });
  if (response.status === 401) showLogin('会话已过期，请重新登录');
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try { message = (await response.json()).error || message; } catch { /* use status */ }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

function showLogin(message = '') {
  window.clearTimeout(state.statusTimer);
  state.statusTimer = null;
  elements.loginError.textContent = message;
  elements.loginScreen.hidden = false;
  elements.app.classList.add('is-locked');
  window.setTimeout(() => elements.loginPassword.focus(), 0);
}

function hideLogin() {
  elements.loginScreen.hidden = true;
  elements.app.classList.remove('is-locked');
  elements.loginError.textContent = '';
  elements.loginPassword.value = '';
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = String(message || '');
  elements.toast.classList.add('is-visible');
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove('is-visible'), 2600);
}

function closeSidebar() {
  elements.app.classList.remove('sidebar-open');
}

function formatRelative(iso) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(timestamp));
}

function conversationSummary(conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    model: conversation.model,
    reasoningEffort: conversation.reasoningEffort,
    archived: conversation.archived === true,
    legacyMode: conversation.legacyMode,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages?.length ?? conversation.messageCount ?? 0,
    preview: conversation.messages?.at(-1)?.text?.slice(0, 100) ?? conversation.preview ?? '',
  };
}

function syncConversationSummary() {
  if (!state.conversation) return;
  const summary = conversationSummary(state.conversation);
  const target = summary.archived ? state.archivedConversations : state.conversations;
  const other = summary.archived ? state.conversations : state.archivedConversations;
  const index = target.findIndex((item) => item.id === summary.id);
  if (index === -1) target.unshift(summary);
  else target[index] = summary;
  const otherIndex = other.findIndex((item) => item.id === summary.id);
  if (otherIndex !== -1) other.splice(otherIndex, 1);
  target.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  renderConversationLists();
}

function actionButton(iconName, label, handler, danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `conversation-action${danger ? ' is-danger' : ''}`;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(svgIcon(iconName));
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    handler();
  });
  return button;
}

function conversationItem(conversation, archived = false) {
  const item = document.createElement('div');
  item.className = 'conversation-item';
  if (state.conversation?.id === conversation.id) item.classList.add('is-active');
  const select = document.createElement('button');
  select.type = 'button';
  select.className = 'conversation-select';
  const title = document.createElement('strong');
  title.textContent = conversation.title || '新会话';
  const meta = document.createElement('span');
  meta.textContent = `${conversation.messageCount || 0} 条 · ${formatRelative(conversation.updatedAt)}`;
  select.append(title, meta);
  select.addEventListener('click', () => loadConversation(conversation.id));

  const actions = document.createElement('div');
  actions.className = 'conversation-actions';
  actions.append(actionButton('pencil', '重命名', () => openRenameDialog(conversation)));
  if (archived) {
    actions.append(actionButton('restore', '恢复', () => setArchived(conversation.id, false)));
    actions.append(actionButton('trash', '永久删除', () => openDeleteDialog(conversation.id), true));
  } else {
    actions.append(actionButton('archive', '归档', () => openArchiveDialog(conversation)));
  }
  item.append(select, actions);
  return item;
}

function renderConversationLists() {
  elements.conversationList.replaceChildren();
  for (const conversation of state.conversations) elements.conversationList.append(conversationItem(conversation));
  if (!state.conversations.length) {
    const empty = document.createElement('p');
    empty.className = 'sidebar-empty';
    empty.textContent = '还没有会话';
    elements.conversationList.append(empty);
  }
  elements.archiveCount.textContent = String(state.archivedConversations.length);
  elements.archiveSection.hidden = state.archivedConversations.length === 0;
  elements.archivedList.replaceChildren();
  for (const conversation of state.archivedConversations) elements.archivedList.append(conversationItem(conversation, true));
}

function renderModelOptions() {
  const selected = state.conversation?.model || state.draftModel || state.defaultModel;
  const models = [...new Set([selected, ...state.models].filter(Boolean))];
  elements.modelSelect.replaceChildren();
  for (const model of models) {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    elements.modelSelect.append(option);
  }
  elements.modelSelect.value = selected;
  elements.effortSelect.value = state.conversation?.reasoningEffort || state.draftEffort || 'high';
  const locked = state.running || state.conversation?.archived === true;
  elements.modelSelect.disabled = locked;
  elements.effortSelect.disabled = locked;
  elements.modelSelect.title = state.modelCatalog?.available === false
    ? state.modelCatalog.error || 'Sub2API 模型列表暂不可用'
    : '从 Sub2API 获取的模型';
}

function latestContextUsage() {
  const messages = state.conversation?.messages || [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const usage = messages[index]?.usage;
    if (!usage || messages[index]?.role !== 'assistant') continue;
    const total = Number(usage.total_tokens);
    if (Number.isFinite(total) && total >= 0) return Math.round(total);
    const input = Number(usage.input_tokens);
    const output = Number(usage.output_tokens);
    if (Number.isFinite(input) || Number.isFinite(output)) {
      return Math.round((Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0));
    }
  }
  return 0;
}

function contextWindowForModel(model) {
  const value = state.modelCatalog?.contextWindows?.[model];
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function formatTokenCount(value) {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Number(value) || 0));
}

function renderContextUsage() {
  const model = state.conversation?.model || state.draftModel || state.defaultModel;
  const used = latestContextUsage();
  const limit = contextWindowForModel(model);
  const percent = limit ? Math.min(100, Math.max(0, used / limit * 100)) : null;
  const description = limit
    ? `上下文约 ${formatTokenCount(used)} / ${formatTokenCount(limit)} Token（${percent.toFixed(percent < 10 ? 1 : 0)}%）`
    : used > 0
      ? `上下文约 ${formatTokenCount(used)} Token，模型上限未知`
      : '尚无上下文用量，模型上限未知';
  elements.contextMeter.classList.toggle('is-unknown', percent === null);
  elements.contextMeter.classList.toggle('has-usage', used > 0);
  elements.contextMeter.style.setProperty('--context-progress', `${percent === null ? 0 : percent * 3.6}deg`);
  elements.contextMeter.title = description;
  elements.contextMeter.setAttribute('aria-label', description);
  elements.contextRing.setAttribute('aria-label', description);
  elements.contextMeter.dataset.description = description;
}

function syncHeader() {
  const conversation = state.conversation;
  elements.conversationTitle.textContent = conversation?.title || '新会话';
  const model = conversation?.model || state.draftModel || state.defaultModel;
  const effort = conversation?.reasoningEffort || state.draftEffort || 'high';
  elements.modelLabel.textContent = `${model} · ${effort}`;
  elements.renameConversation.disabled = !conversation || state.running;
  elements.archiveConversation.disabled = !conversation || state.running || conversation.archived === true;
  renderModelOptions();
  renderContextUsage();
}

function renderCapabilities() {
  if (state.capabilities.imageInput === false) {
    elements.capabilityNote.textContent = '图片使用本地 OCR，仅识别文字，不理解颜色、布局或图形';
    elements.capabilityNote.className = 'capability-note is-warning';
  } else if (state.capabilities.imageInput === true) {
    elements.capabilityNote.textContent = '支持图片输入';
    elements.capabilityNote.className = 'capability-note';
  } else {
    elements.capabilityNote.textContent = '图片能力尚未验证';
    elements.capabilityNote.className = 'capability-note is-warning';
  }
}

function renderAttachments() {
  elements.attachmentTray.replaceChildren();
  for (const item of state.attachments) {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    const name = document.createElement('span');
    name.textContent = item.name;
    const size = document.createElement('small');
    size.textContent = item.size < 1024 * 1024 ? `${Math.ceil(item.size / 1024)} KB` : `${(item.size / 1024 / 1024).toFixed(1)} MB`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.title = '移除附件';
    remove.setAttribute('aria-label', `移除 ${item.name}`);
    remove.append(svgIcon('x'));
    remove.addEventListener('click', () => removeAttachment(item.id));
    chip.append(name, size, remove);
    elements.attachmentTray.append(chip);
  }
  elements.attachmentTray.hidden = state.attachments.length === 0;
}

function safeLink(url) {
  try {
    const parsed = new URL(url, window.location.href);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function appendInline(parent, text) {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\n]+\))/g;
  let cursor = 0;
  for (const match of String(text).matchAll(pattern)) {
    if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith('`')) {
      const code = document.createElement('code');
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else if (token.startsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else if (token.startsWith('*')) {
      const emphasis = document.createElement('em');
      emphasis.textContent = token.slice(1, -1);
      parent.append(emphasis);
    } else {
      const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = safeLink(parts?.[2]);
      if (href) {
        const link = document.createElement('a');
        link.textContent = parts[1];
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        parent.append(link);
      } else {
        parent.append(document.createTextNode(parts?.[1] || token));
      }
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

function codeBlock(value, language = '') {
  const wrapper = document.createElement('div');
  wrapper.className = 'code-block';
  const head = document.createElement('div');
  head.className = 'code-head';
  const label = document.createElement('span');
  label.textContent = language || 'text';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.append(svgIcon('copy'), document.createTextNode('复制'));
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value);
      copy.replaceChildren(svgIcon('check'), document.createTextNode('已复制'));
      window.setTimeout(() => copy.replaceChildren(svgIcon('copy'), document.createTextNode('复制')), 1400);
    } catch {
      showToast('浏览器未允许写入剪贴板');
    }
  });
  head.append(label, copy);
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = value;
  if (language) code.dataset.language = language;
  pre.append(code);
  wrapper.append(head, pre);
  return wrapper;
}

function splitTableRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function tableBlock(lines, index) {
  if (!lines[index].includes('|') || index + 1 >= lines.length) return null;
  const headers = splitTableRow(lines[index]);
  const divider = splitTableRow(lines[index + 1]);
  if (headers.length < 2 || divider.length !== headers.length || !divider.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const value of headers) {
    const th = document.createElement('th');
    appendInline(th, value);
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  let cursor = index + 2;
  while (cursor < lines.length && lines[cursor].includes('|') && lines[cursor].trim()) {
    const cells = splitTableRow(lines[cursor]);
    if (cells.length !== headers.length) break;
    const row = document.createElement('tr');
    for (const value of cells) {
      const td = document.createElement('td');
      appendInline(td, value);
      row.append(td);
    }
    tbody.append(row);
    cursor += 1;
  }
  table.append(thead, tbody);
  const scroll = document.createElement('div');
  scroll.className = 'table-scroll';
  scroll.append(table);
  return { element: scroll, next: cursor };
}

function renderMarkdown(text) {
  const root = document.createElement('div');
  root.className = 'message-text';
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (line.startsWith('```')) {
      const language = line.slice(3).trim().slice(0, 24);
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) { code.push(lines[index]); index += 1; }
      if (index < lines.length) index += 1;
      root.append(codeBlock(code.join('\n'), language));
      continue;
    }
    const table = tableBlock(lines, index);
    if (table) { root.append(table.element); index = table.next; continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = Math.min(3, heading[1].length + 1);
      const element = document.createElement(`h${level}`);
      appendInline(element, heading[2]);
      root.append(element);
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = document.createElement('blockquote');
      const values = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        values.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      appendInline(quote, values.join('\n'));
      root.append(quote);
      continue;
    }
    const listMatch = /^\s*(?:([-*])|(\d+)\.)\s+(.+)$/.exec(line);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      while (index < lines.length) {
        const current = /^\s*(?:([-*])|(\d+)\.)\s+(.+)$/.exec(lines[index]);
        if (!current || Boolean(current[2]) !== ordered) break;
        const item = document.createElement('li');
        appendInline(item, current[3]);
        list.append(item);
        index += 1;
      }
      root.append(list);
      continue;
    }
    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !lines[index].startsWith('```')
      && !/^(#{1,3})\s+/.test(lines[index]) && !/^>\s?/.test(lines[index])
      && !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[index]) && !tableBlock(lines, index)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement('p');
    paragraphLines.forEach((value, lineIndex) => {
      if (lineIndex) paragraph.append(document.createElement('br'));
      appendInline(paragraph, value);
    });
    root.append(paragraph);
  }
  return root;
}

const actionLabels = {
  palworld_backup: '备份 Palworld 存档',
  broadcast: '向 Palworld 广播',
  restart_palworld: '重启 Palworld',
  restart_frp: '重启 FRP',
  restart_pocket: '重启 PocketCodex',
};

function detailStatus(detail) {
  if (detail.status === 'pending') return '等待确认';
  if (detail.status === 'completed') return '已完成';
  if (detail.status === 'failed') return '失败';
  if (detail.status === 'cancelled') return '已取消';
  if (detail.status === 'in_progress') return '运行中';
  return '详情';
}

function detailElement(detail) {
  const wrapper = document.createElement('details');
  wrapper.className = `tool-block is-${detail.status || 'completed'}`;
  if (detail.type === 'confirmation' && detail.status === 'pending') wrapper.open = true;
  const summary = document.createElement('summary');
  const title = document.createElement('span');
  title.textContent = detail.type === 'confirmation'
    ? actionLabels[detail.action] || detail.title || '服务器操作'
    : detail.title || detail.type || '工具输出';
  const status = document.createElement('small');
  status.textContent = detailStatus(detail);
  summary.append(title, status);
  wrapper.append(summary);

  const body = document.createElement('div');
  body.className = 'tool-body';
  if (detail.output) {
    const output = document.createElement('pre');
    output.textContent = detail.output;
    body.append(output);
  } else if (detail.type === 'confirmation') {
    const description = document.createElement('p');
    description.textContent = detail.confirmationToken
      ? '操作尚未执行。确认令牌将在两分钟后失效。'
      : '确认令牌未保存在历史记录中，请重新发起此操作。';
    body.append(description);
  }
  if (detail.type === 'confirmation' && detail.args && Object.keys(detail.args).length) {
    const args = document.createElement('pre');
    args.textContent = JSON.stringify(detail.args, null, 2);
    body.append(args);
  }
  if (detail.type === 'confirmation' && detail.status === 'pending' && detail.confirmationToken) {
    const actions = document.createElement('div');
    actions.className = 'tool-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary-button';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'danger-button';
    confirm.textContent = '确认执行';
    const disabled = state.running;
    cancel.disabled = disabled;
    confirm.disabled = disabled;
    cancel.addEventListener('click', () => decideConfirmation(detail, 'cancel'));
    confirm.addEventListener('click', () => decideConfirmation(detail, 'execute'));
    actions.append(cancel, confirm);
    body.append(actions);
  }
  wrapper.append(body);
  return wrapper;
}

function messageElement(message, live = false) {
  const article = document.createElement('article');
  article.className = `message is-${message.role}`;
  if (message.status && message.status !== 'completed') article.classList.add(`is-${message.status}`);
  const body = document.createElement('div');
  body.className = 'message-body';
  if (live && !message.text) {
    const working = document.createElement('div');
    working.className = 'working-line';
    working.textContent = message.details?.length ? '正在读取服务器工具' : '正在生成';
    body.append(working);
  } else {
    body.append(renderMarkdown(message.text));
  }
  if (message.attachments?.length) {
    const attachments = document.createElement('div');
    attachments.className = 'message-attachments';
    for (const item of message.attachments) {
      const chip = document.createElement('span');
      chip.append(svgIcon('paperclip'), document.createTextNode(item.name));
      attachments.append(chip);
    }
    body.append(attachments);
  }
  if (message.details?.length) {
    const details = document.createElement('div');
    details.className = 'tool-list';
    for (const item of message.details) details.append(detailElement(item));
    body.append(details);
  }
  if (!live && message.createdAt) {
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = formatRelative(message.createdAt);
    body.append(meta);
  }
  article.append(body);
  return article;
}

function renderMessages(forceBottom = false) {
  elements.messageList.replaceChildren();
  const messages = state.conversation?.messages || [];
  for (const message of messages) elements.messageList.append(messageElement(message));
  if (state.liveMessage) elements.messageList.append(messageElement(state.liveMessage, true));
  const hasMessages = messages.length > 0 || Boolean(state.liveMessage);
  elements.emptyState.hidden = hasMessages;
  elements.messageList.hidden = !hasMessages;
  if (forceBottom) window.requestAnimationFrame(() => { elements.chatRegion.scrollTop = elements.chatRegion.scrollHeight; });
}

function scheduleLiveRender() {
  if (state.renderFrame) return;
  state.renderFrame = window.requestAnimationFrame(() => {
    state.renderFrame = null;
    renderMessages(true);
  });
}

function setRunning(running, label = '') {
  state.running = running;
  elements.composer.classList.toggle('is-running', running);
  elements.sendButton.disabled = running || state.sendInFlight;
  elements.stopButton.disabled = !running;
  elements.attachButton.disabled = running;
  elements.cameraButton.disabled = running;
  elements.promptInput.disabled = running;
  elements.runState.textContent = running ? label || '正在生成' : '就绪';
  syncHeader();
}

function serviceUp(value) {
  return ['active', 'running', 'up', 'healthy', true].includes(value);
}

function setDot(element, up) {
  element.classList.toggle('is-up', up);
  element.classList.toggle('is-down', !up);
}

function capacityNumber(value) {
  const match = /^([\d.]+)\s*([KMGTP])?(i)?B?$/i.exec(String(value || '').trim());
  if (!match) return null;
  const powers = { K: 1, M: 2, G: 3, T: 4, P: 5 };
  const power = powers[(match[2] || 'G').toUpperCase()] || 3;
  return Number(match[1]) * 1024 ** power;
}

function capacityPercent(used, total, fallback = '') {
  const usedBytes = capacityNumber(used);
  const totalBytes = capacityNumber(total);
  if (Number.isFinite(usedBytes) && Number.isFinite(totalBytes) && totalBytes > 0) {
    return Math.round(usedBytes / totalBytes * 100);
  }
  const parsed = Number.parseFloat(String(fallback || '').replace('%', ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function formatCapacity(value) {
  const match = /^([\d.]+)\s*([KMGTP])?(i)?B?$/i.exec(String(value || '').trim());
  if (!match) return String(value || '不可用');
  const unit = `${(match[2] || 'G').toUpperCase()}${match[3] ? 'i' : ''}B`;
  return `${match[1]} ${unit}`;
}

function serviceLabel(value) {
  if (serviceUp(value)) return '正常';
  if (value == null || value === '' || value === 'unknown') return '未知';
  return '异常';
}

function serviceTone(value) {
  if (serviceUp(value)) return 'ok';
  return value == null || value === '' || value === 'unknown' ? 'warning' : 'critical';
}

function batteryState(value) {
  const labels = {
    charging: '充电中', discharging: '使用电池', full: '已充满',
    'not charging': '未充电', unknown: '状态未知',
  };
  return labels[String(value || 'unknown').toLowerCase()] || String(value || '状态未知');
}

function statusRow(label, value, tone = '', hint = '') {
  const row = document.createElement('div');
  row.className = `status-detail-row${tone ? ` is-${tone}` : ''}`;
  const name = document.createElement('span');
  name.textContent = label;
  const content = document.createElement('strong');
  content.textContent = value || '--';
  row.append(name, content);
  if (hint) {
    const help = document.createElement('small');
    help.textContent = hint;
    row.append(help);
  }
  return row;
}

function renderStatus(status) {
  state.status = status || null;
  elements.statusStrip.classList.toggle('is-loading', !status);
  if (!status) {
    elements.temperatureValue.textContent = '--';
    elements.memoryValue.textContent = '--';
    elements.diskValue.textContent = '--';
    elements.batteryValue.textContent = '--';
    elements.palValue.textContent = '--';
    elements.frpValue.textContent = '--';
    elements.apiValue.textContent = '--';
    elements.sidebarStatus.textContent = '状态不可用';
    setDot(elements.sidebarIndicator, false);
    return;
  }
  elements.temperatureValue.textContent = Number.isFinite(status.temperature) ? `${status.temperature.toFixed(0)}°C` : '--';
  const memoryPercent = status.memory ? capacityPercent(status.memory.used, status.memory.total) : null;
  const diskPercent = status.disk ? capacityPercent(status.disk.used, status.disk.size, status.disk.percent) : null;
  elements.memoryValue.textContent = memoryPercent == null ? '--' : `${memoryPercent}%`;
  elements.diskValue.textContent = diskPercent == null ? '--' : `${diskPercent}%`;
  elements.batteryValue.textContent = status.battery ? `${status.battery.capacity}%` : '--';
  const warning = status.diskWarning?.level;
  elements.diskChip.classList.toggle('is-warning', warning === 'warning');
  elements.diskChip.classList.toggle('is-critical', warning === 'critical');
  const palUp = serviceUp(status.services?.palworld);
  const frpUp = serviceUp(status.services?.frp);
  const apiUp = serviceUp(status.services?.sub2api);
  elements.palValue.textContent = serviceLabel(status.services?.palworld);
  elements.frpValue.textContent = serviceLabel(status.services?.frp);
  elements.apiValue.textContent = serviceLabel(status.services?.sub2api);
  setDot(elements.palDot, palUp);
  setDot(elements.frpDot, frpUp);
  setDot(elements.apiDot, apiUp);
  setDot(elements.sidebarIndicator, palUp && frpUp && apiUp);
  elements.sidebarStatus.textContent = palUp && frpUp && apiUp ? '关键服务正常' : '有服务需要检查';

  elements.statusDetails.replaceChildren(
    statusRow('CPU 温度', Number.isFinite(status.temperature) ? `${status.temperature.toFixed(1)} °C` : '不可用'),
    statusRow('系统负载', status.load?.length ? status.load.join(' / ') : '不可用', '', '依次为过去 1、5、15 分钟等待 CPU 或 I/O 的平均任务数，越接近可用 CPU 线程数代表越繁忙。'),
    statusRow('内存', status.memory ? `已用 ${formatCapacity(status.memory.used)} / ${formatCapacity(status.memory.total)}（${memoryPercent ?? '--'}%），剩余 ${formatCapacity(status.memory.available)}` : '不可用'),
    statusRow('SSD', status.disk ? `已用 ${formatCapacity(status.disk.used)} / ${formatCapacity(status.disk.size)}（${diskPercent ?? '--'}%），剩余 ${formatCapacity(status.disk.available)}` : '不可用', warning),
    statusRow('电池', status.battery ? `${status.battery.capacity}% · ${batteryState(status.battery.state)}` : '不可用'),
    statusRow('Palworld', serviceLabel(status.services?.palworld), serviceTone(status.services?.palworld)),
    statusRow('FRP', serviceLabel(status.services?.frp), serviceTone(status.services?.frp)),
    statusRow('Sub2API', status.sub2api?.latencyMs != null ? `${serviceLabel(status.services?.sub2api)} · ${status.sub2api.latencyMs} ms` : serviceLabel(status.services?.sub2api), serviceTone(status.services?.sub2api)),
  );
  if (status.dockerCache?.length) {
    const cache = document.createElement('div');
    cache.className = 'docker-cache';
    const label = document.createElement('span');
    label.textContent = 'Docker 构建缓存';
    const output = document.createElement('pre');
    output.textContent = status.dockerCache.join('\n');
    cache.append(label, output);
    elements.statusDetails.append(cache);
  }
  elements.statusCheckedAt.textContent = status.checkedAt ? `更新于 ${formatRelative(status.checkedAt)}` : '刚刚更新';
}

async function refreshStatus(interactive = true) {
  if (state.statusLoading || document.hidden) return;
  state.statusLoading = true;
  elements.refreshStatus.disabled = true;
  try {
    renderStatus(await api('/status'));
    if (interactive) showToast('状态已刷新');
  } catch (error) {
    if (interactive) showToast(error.message);
  } finally {
    state.statusLoading = false;
    elements.refreshStatus.disabled = false;
  }
}

function scheduleStatusPoll(delay = 30_000) {
  window.clearTimeout(state.statusTimer);
  state.statusTimer = null;
  if (document.hidden || elements.loginScreen.hidden === false) return;
  state.statusTimer = window.setTimeout(async () => {
    await refreshStatus(false);
    scheduleStatusPoll();
  }, delay);
}

async function createConversation(options = {}) {
  if (state.running || (state.sendInFlight && options.fromSend !== true)) return showToast('请先等待当前生成结束');
  try {
    const conversation = await api('/conversations', {
      method: 'POST',
      body: JSON.stringify({ model: state.draftModel, reasoningEffort: state.draftEffort }),
    });
    state.conversation = { ...conversation, messages: [], stagedAttachments: [] };
    state.attachments = [];
    syncConversationSummary();
    renderAttachments();
    renderMessages();
    syncHeader();
    closeSidebar();
    elements.promptInput.focus();
  } catch (error) {
    showToast(error.message);
  }
}

async function loadConversation(id) {
  if (state.running || state.sendInFlight) return showToast('请先等待当前生成结束');
  try {
    state.liveMessage = null;
    state.conversation = await api(`/conversations/${encodeURIComponent(id)}`);
    state.attachments = state.conversation.stagedAttachments || [];
    state.draftModel = state.conversation.model || state.defaultModel;
    state.draftEffort = state.conversation.reasoningEffort || 'high';
    renderConversationLists();
    renderAttachments();
    renderMessages(true);
    syncHeader();
    closeSidebar();
  } catch (error) {
    showToast(error.message);
  }
}

async function updateConversationSettings(settings) {
  if (!state.conversation) return;
  try {
    state.conversation = await api(`/conversations/${encodeURIComponent(state.conversation.id)}`, {
      method: 'PATCH', body: JSON.stringify(settings),
    });
    syncConversationSummary();
    syncHeader();
  } catch (error) {
    showToast(error.message);
    syncHeader();
  }
}

async function setArchived(id, archived) {
  if (state.running) return showToast('生成进行中，不能归档');
  try {
    const updated = await api(`/conversations/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ archived }),
    });
    if (state.conversation?.id === id) state.conversation = { ...state.conversation, ...updated };
    const source = archived ? state.conversations : state.archivedConversations;
    const index = source.findIndex((item) => item.id === id);
    if (index !== -1) source.splice(index, 1);
    const target = archived ? state.archivedConversations : state.conversations;
    target.unshift(conversationSummary(updated));
    if (archived && state.conversation?.id === id) {
      state.conversation = null;
      state.attachments = [];
      if (state.conversations[0]) await loadConversation(state.conversations[0].id);
      else { renderMessages(); renderAttachments(); syncHeader(); }
    } else {
      renderConversationLists();
      syncHeader();
    }
    showToast(archived ? '会话已归档' : '会话已恢复');
  } catch (error) {
    showToast(error.message);
  }
}

function openRenameDialog(conversation = state.conversation) {
  if (!conversation) return;
  elements.renameInput.dataset.conversationId = conversation.id;
  elements.renameInput.value = conversation.title || '';
  elements.renameDialog.showModal();
  window.setTimeout(() => elements.renameInput.select(), 0);
}

function openArchiveDialog(conversation = state.conversation) {
  if (!conversation || state.running) return;
  elements.archiveConversationId.value = conversation.id;
  elements.archiveConversationTitle.textContent = conversation.title || '新会话';
  elements.archiveDialog.showModal();
}

function openDeleteDialog(id) {
  elements.deleteConversationId.value = id;
  elements.deleteDialog.showModal();
}

async function uploadFiles(files) {
  if (!files.length || state.running) return;
  try {
    await ensureConversation();
    for (const file of files) {
      const response = await fetch(`/pocket-api/conversations/${encodeURIComponent(state.conversation.id)}/attachments?name=${encodeURIComponent(file.name)}`, {
        method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
      });
      if (!response.ok) {
        let message = `上传失败 (${response.status})`;
        try { message = (await response.json()).error || message; } catch { /* use status */ }
        throw new Error(`${file.name}: ${message}`);
      }
      state.attachments.push(await response.json());
      renderAttachments();
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.fileInput.value = '';
    elements.cameraInput.value = '';
  }
}

async function removeAttachment(id) {
  if (!state.conversation) return;
  try {
    await api(`/conversations/${encodeURIComponent(state.conversation.id)}/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.attachments = state.attachments.filter((item) => item.id !== id);
    renderAttachments();
  } catch (error) {
    showToast(error.message);
  }
}

async function login(event) {
  event.preventDefault();
  const submit = elements.loginForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  elements.loginError.textContent = '';
  try {
    const response = await fetch('/pocket-api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: elements.loginUsername.value, password: elements.loginPassword.value }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '登录失败');
    hideLogin();
    await bootstrap();
  } catch (error) {
    elements.loginError.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

function upsertLiveDetail(detail) {
  if (!state.liveMessage) state.liveMessage = { role: 'assistant', text: '', details: [], status: 'in_progress' };
  const index = state.liveMessage.details.findIndex((item) => item.id === detail.id);
  if (index === -1) state.liveMessage.details.push(detail);
  else state.liveMessage.details[index] = { ...state.liveMessage.details[index], ...detail };
}

function parseEventBlock(block) {
  if (!block || block.startsWith(':')) return null;
  let event = 'message';
  const data = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (!data.length) return null;
  try { return { event, payload: JSON.parse(data.join('\n')) }; }
  catch { return null; }
}

async function consumeEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminal = false;
  let completed = false;

  const handle = ({ event, payload }) => {
    if (event === 'accepted') {
      state.conversation = { ...payload.conversation, stagedAttachments: state.attachments };
      state.liveMessage = { role: 'assistant', text: '', details: [], status: 'in_progress' };
      syncConversationSummary();
      renderMessages(true);
    } else if (event === 'delta') {
      if (!state.liveMessage) state.liveMessage = { role: 'assistant', text: '', details: [], status: 'in_progress' };
      state.liveMessage.text += payload.text || '';
      scheduleLiveRender();
    } else if (event === 'detail') {
      upsertLiveDetail(payload);
      scheduleLiveRender();
    } else if (event === 'done') {
      const ephemeral = new Map((state.liveMessage?.details || [])
        .filter((item) => item.confirmationToken)
        .map((item) => [item.id, item.confirmationToken]));
      for (const detail of payload.message.details || []) {
        if (ephemeral.has(detail.id)) detail.confirmationToken = ephemeral.get(detail.id);
      }
      state.conversation.messages.push(payload.message);
      state.liveMessage = null;
      state.attachments = [];
      terminal = true;
      completed = true;
      syncConversationSummary();
      renderAttachments();
      renderMessages(true);
    } else if (event === 'failure') {
      if (payload.item) state.conversation.messages.push(payload.item);
      state.liveMessage = null;
      terminal = true;
      syncConversationSummary();
      renderMessages(true);
      throw new Error(payload.message || '生成失败');
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const parsed = parseEventBlock(block);
      if (parsed) handle(parsed);
    }
    if (done) break;
  }
  const trailing = parseEventBlock(buffer);
  if (trailing) handle(trailing);
  if (!terminal) throw new Error('连接提前中断，请检查会话记录');
  return completed;
}

async function ensureConversation() {
  if (!state.conversation) await createConversation({ fromSend: true });
  if (!state.conversation) throw new Error('无法创建会话');
  if (state.conversation.archived) throw new Error('归档会话不能继续发送，请先恢复');
}

async function sendMessage(text) {
  if (state.running || state.sendInFlight) return;
  const prompt = String(text || '').trim();
  if (!prompt) return;
  state.sendInFlight = true;
  elements.sendButton.disabled = true;
  let accepted = false;
  try {
    await ensureConversation();
    const temporary = {
      id: `local-${Date.now()}`, role: 'user', text: prompt, status: 'completed', createdAt: new Date().toISOString(),
      attachments: state.attachments.map((item) => ({ name: item.name, size: item.size, mimeType: item.mimeType })),
    };
    state.conversation.messages.push(temporary);
    elements.promptInput.value = '';
    resizeComposer();
    renderMessages(true);
    setRunning(true, '正在生成');
    const response = await fetch(`/pocket-api/conversations/${encodeURIComponent(state.conversation.id)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: prompt, attachmentIds: state.attachments.map((item) => item.id) }),
    });
    if (!response.ok) {
      let message = `发送失败 (${response.status})`;
      try { message = (await response.json()).error || message; } catch { /* use status */ }
      throw new Error(message);
    }
    accepted = true;
    await consumeEvents(response);
  } catch (error) {
    state.liveMessage = null;
    if (!accepted && state.conversation) state.conversation.messages = state.conversation.messages.filter((item) => !String(item.id).startsWith('local-'));
    renderMessages(true);
    showToast(error.message);
  } finally {
    state.sendInFlight = false;
    setRunning(false);
    elements.promptInput.focus();
  }
}

async function stopRun() {
  if (!state.running || !state.conversation) return;
  elements.stopButton.disabled = true;
  elements.runState.textContent = '正在停止';
  try {
    await api(`/conversations/${encodeURIComponent(state.conversation.id)}/cancel`, { method: 'POST', body: '{}' });
  } catch (error) {
    showToast(error.message);
  }
}

async function decideConfirmation(detail, decision) {
  if (!state.conversation || !detail.confirmationToken || state.running) return;
  const token = detail.confirmationToken;
  detail.confirmationToken = null;
  detail.status = decision === 'cancel' ? 'cancelled' : 'in_progress';
  renderMessages(true);
  try {
    const result = await api('/confirmations/execute', {
      method: 'POST',
      body: JSON.stringify({ token, conversationId: state.conversation.id, decision }),
    });
    detail.status = result.status;
    detail.output = result.output || '';
    await loadConversation(state.conversation.id);
    showToast(decision === 'cancel' ? '操作已取消' : '操作已执行');
  } catch (error) {
    detail.status = 'failed';
    detail.output = error.message;
    renderMessages(true);
    showToast(error.message);
  }
}

function resizeComposer() {
  elements.promptInput.style.height = 'auto';
  elements.promptInput.style.height = `${Math.min(elements.promptInput.scrollHeight, 180)}px`;
  elements.characterCount.textContent = `${elements.promptInput.value.length} / 16000`;
}

async function bootstrap() {
  try {
    const payload = await api('/bootstrap');
    hideLogin();
    state.conversations = payload.conversations || [];
    state.archivedConversations = payload.archivedConversations || [];
    state.provider = payload.model || {};
    state.defaultModel = payload.model?.model || 'gpt-5.6-sol';
    state.draftModel = state.defaultModel;
    state.models = payload.models || [state.defaultModel];
    state.modelCatalog = payload.modelCatalog || null;
    state.capabilities = payload.capabilities || {};
    const providerOk = payload.model?.provider === 'sub2api_local' && payload.model?.configured !== false;
    elements.providerLabel.textContent = '咖啡自研AI助手';
    elements.providerLabel.title = providerOk
      ? state.modelCatalog?.available === false ? 'Sub2API 模型列表暂不可用' : '通过 Sub2API 提供模型'
      : 'Provider 配置错误';
    renderCapabilities();
    renderConversationLists();
    renderStatus(payload.status);
    if (state.conversations[0]) await loadConversation(state.conversations[0].id);
    else { renderMessages(); renderAttachments(); syncHeader(); }
    scheduleStatusPoll();
  } catch (error) {
    if (!elements.loginScreen.hidden) return;
    showToast(error.message);
  }
}

async function initialize() {
  try {
    const response = await fetch('/pocket-api/session');
    const payload = await response.json();
    if (response.ok && payload.authenticated === true) await bootstrap();
    else showLogin();
  } catch {
    showLogin('无法连接 PocketCodex');
  }
}

elements.openSidebar.addEventListener('click', () => elements.app.classList.add('sidebar-open'));
elements.closeSidebar.addEventListener('click', closeSidebar);
elements.sidebarScrim.addEventListener('click', closeSidebar);
elements.newChatButton.addEventListener('click', () => createConversation());
elements.archiveToggle.addEventListener('click', () => {
  const expanded = elements.archiveToggle.getAttribute('aria-expanded') === 'true';
  elements.archiveToggle.setAttribute('aria-expanded', String(!expanded));
  elements.archivedList.hidden = expanded;
});
elements.renameConversation.addEventListener('click', () => openRenameDialog());
elements.archiveConversation.addEventListener('click', () => openArchiveDialog());
elements.contextMeter.addEventListener('click', () => showToast(elements.contextMeter.dataset.description || '上下文用量未知'));
elements.modelSelect.addEventListener('change', () => {
  state.draftModel = elements.modelSelect.value;
  if (state.conversation) updateConversationSettings({ model: state.draftModel });
  else syncHeader();
});
elements.effortSelect.addEventListener('change', () => {
  state.draftEffort = elements.effortSelect.value;
  if (state.conversation) updateConversationSettings({ reasoningEffort: state.draftEffort });
  else syncHeader();
});
elements.loginForm.addEventListener('submit', login);
elements.logoutButton.addEventListener('click', async () => {
  try { await api('/logout', { method: 'POST', body: '{}' }); } catch { /* session may already be gone */ }
  state.conversation = null;
  showLogin();
});
elements.attachButton.addEventListener('click', () => elements.fileInput.click());
elements.cameraButton.addEventListener('click', () => elements.cameraInput.click());
elements.fileInput.addEventListener('change', () => uploadFiles([...elements.fileInput.files]));
elements.cameraInput.addEventListener('change', () => uploadFiles([...elements.cameraInput.files]));
elements.composer.addEventListener('submit', (event) => { event.preventDefault(); sendMessage(elements.promptInput.value); });
elements.stopButton.addEventListener('click', stopRun);
elements.promptInput.addEventListener('input', resizeComposer);
elements.promptInput.addEventListener('keydown', (event) => {
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  if (event.key === 'Enter' && !event.shiftKey && (!mobile || event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendMessage(elements.promptInput.value);
  }
});
elements.promptInput.addEventListener('paste', (event) => {
  const files = [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (files.length) { event.preventDefault(); uploadFiles(files); }
});
elements.quickActions.addEventListener('click', (event) => {
  const button = event.target.closest('[data-prompt]');
  if (button) sendMessage(button.dataset.prompt);
});
elements.statusMore.addEventListener('click', () => elements.statusDialog.showModal());
document.querySelectorAll('[data-status-detail]').forEach((button) => button.addEventListener('click', () => elements.statusDialog.showModal()));
elements.refreshStatus.addEventListener('click', () => refreshStatus(true));
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
elements.renameForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = elements.renameInput.dataset.conversationId;
  const title = elements.renameInput.value.trim();
  if (!id || !title) return;
  try {
    const updated = await api(`/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) });
    if (state.conversation?.id === id) state.conversation = { ...state.conversation, ...updated };
    const summary = [...state.conversations, ...state.archivedConversations].find((item) => item.id === id);
    if (summary) Object.assign(summary, conversationSummary(updated));
    elements.renameDialog.close();
    renderConversationLists();
    syncHeader();
  } catch (error) { showToast(error.message); }
});
elements.archiveForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = elements.archiveConversationId.value;
  if (!id) return;
  elements.archiveDialog.close();
  await setArchived(id, true);
});
elements.deleteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = elements.deleteConversationId.value;
  try {
    await api(`/conversations/${encodeURIComponent(id)}?confirm=true`, { method: 'DELETE' });
    state.archivedConversations = state.archivedConversations.filter((item) => item.id !== id);
    state.conversations = state.conversations.filter((item) => item.id !== id);
    if (state.conversation?.id === id) state.conversation = null;
    elements.deleteDialog.close();
    renderConversationLists();
    renderMessages();
    syncHeader();
    showToast('会话已永久删除');
  } catch (error) { showToast(error.message); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    window.clearTimeout(state.statusTimer);
    state.statusTimer = null;
  } else {
    refreshStatus(false).finally(() => scheduleStatusPoll());
  }
});

resizeComposer();
renderAttachments();
renderMessages();
setRunning(false);
initialize();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
