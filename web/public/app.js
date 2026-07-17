'use strict';

const elements = {
  app: document.querySelector('#app'),
  sidebar: document.querySelector('#sidebar'),
  openSidebar: document.querySelector('#openSidebar'),
  closeSidebar: document.querySelector('#closeSidebar'),
  sidebarScrim: document.querySelector('#sidebarScrim'),
  newChatButton: document.querySelector('#newChatButton'),
  conversationList: document.querySelector('#conversationList'),
  conversationTitle: document.querySelector('#conversationTitle'),
  providerLabel: document.querySelector('#providerLabel'),
  modelLabel: document.querySelector('#modelLabel'),
  densityToggle: document.querySelector('#densityToggle'),
  sidebarIndicator: document.querySelector('#sidebarIndicator'),
  sidebarStatus: document.querySelector('#sidebarStatus'),
  refreshStatus: document.querySelector('#refreshStatus'),
  statusGrid: document.querySelector('#statusGrid'),
  cpuValue: document.querySelector('#cpuValue'),
  cpuMeta: document.querySelector('#cpuMeta'),
  memoryValue: document.querySelector('#memoryValue'),
  memoryMeta: document.querySelector('#memoryMeta'),
  diskValue: document.querySelector('#diskValue'),
  diskMeta: document.querySelector('#diskMeta'),
  batteryValue: document.querySelector('#batteryValue'),
  batteryMeta: document.querySelector('#batteryMeta'),
  servicesValue: document.querySelector('#servicesValue'),
  statusTime: document.querySelector('#statusTime'),
  chatRegion: document.querySelector('#chatRegion'),
  emptyState: document.querySelector('#emptyState'),
  quickActions: document.querySelector('#quickActions'),
  messageList: document.querySelector('#messageList'),
  composer: document.querySelector('#composer'),
  promptInput: document.querySelector('#promptInput'),
  sendButton: document.querySelector('#sendButton'),
  stopButton: document.querySelector('#stopButton'),
  runState: document.querySelector('#runState'),
  characterCount: document.querySelector('#characterCount'),
  toast: document.querySelector('#toast'),
};

const state = {
  conversations: [],
  conversation: null,
  model: null,
  running: false,
  liveText: '',
  liveDetails: [],
  toastTimer: null,
  statusTimer: null,
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const payload = await response.json();
      if (payload.error) message = payload.error;
    } catch {
      // Keep the HTTP fallback message.
    }
    throw new Error(message);
  }
  return response;
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  state.toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 3600);
}

function closeSidebar() {
  elements.app.classList.remove('sidebar-open');
}

function setCompactMode(compact, persist = true) {
  document.documentElement.classList.toggle('compact-ui', compact);
  elements.densityToggle.textContent = compact ? 'A+' : 'A-';
  elements.densityToggle.title = compact ? '恢复标准显示' : '紧凑显示';
  elements.densityToggle.setAttribute('aria-label', compact ? '恢复标准显示' : '切换紧凑显示');
  if (persist) localStorage.setItem('codex-ui-density', compact ? 'compact' : 'standard');
}

function initializeDensity() {
  const saved = localStorage.getItem('codex-ui-density');
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  setCompactMode(saved ? saved === 'compact' : standalone, false);
}

function formatRelative(iso) {
  if (!iso) return '';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(iso));
}

function summarizeConversation(conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    threadId: conversation.threadId,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages?.length || 0,
    preview: conversation.messages?.at(-1)?.text?.slice(0, 100) || '',
  };
}

function syncConversationSummary() {
  if (!state.conversation) return;
  const summary = summarizeConversation(state.conversation);
  const index = state.conversations.findIndex((item) => item.id === summary.id);
  if (index === -1) state.conversations.unshift(summary);
  else state.conversations[index] = summary;
  state.conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  renderConversationList();
  elements.conversationTitle.textContent = state.conversation.title;
}

function renderConversationList() {
  elements.conversationList.replaceChildren();
  for (const conversation of state.conversations) {
    const row = document.createElement('div');
    row.className = 'conversation-row';
    if (state.conversation?.id === conversation.id) row.classList.add('is-active');

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'conversation-select';
    const title = document.createElement('strong');
    title.textContent = conversation.title || '新会话';
    const meta = document.createElement('small');
    meta.textContent = `${conversation.messageCount || 0} 条消息 · ${formatRelative(conversation.updatedAt)}`;
    select.append(title, meta);
    select.addEventListener('click', () => loadConversation(conversation.id));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'conversation-delete';
    remove.textContent = '⌫';
    remove.title = '删除会话';
    remove.setAttribute('aria-label', `删除会话：${conversation.title}`);
    remove.addEventListener('click', () => deleteConversation(conversation.id, conversation.title));

    row.append(select, remove);
    elements.conversationList.append(row);
  }
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
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
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
    } else {
      const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = safeLink(parts[2]);
      if (href) {
        const link = document.createElement('a');
        link.textContent = parts[1];
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        parent.append(link);
      } else {
        parent.append(document.createTextNode(parts[1]));
      }
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

function codeBlock(value) {
  const pre = document.createElement('pre');
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'copy-code';
  copy.textContent = '复制';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value);
      copy.textContent = '已复制';
      setTimeout(() => { copy.textContent = '复制'; }, 1400);
    } catch {
      showToast('浏览器未允许写入剪贴板');
    }
  });
  const code = document.createElement('code');
  code.textContent = value;
  pre.append(copy, code);
  return pre;
}

function renderMarkdown(text) {
  const root = document.createElement('div');
  root.className = 'message-text';
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith('```')) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      root.append(codeBlock(code.join('\n')));
      continue;
    }
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    if (heading) {
      const element = document.createElement(heading[1].length === 2 ? 'h2' : 'h3');
      appendInline(element, heading[2]);
      root.append(element);
      index += 1;
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
    while (index < lines.length
      && lines[index].trim()
      && !lines[index].startsWith('```')
      && !/^(#{2,3})\s+/.test(lines[index])
      && !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement('p');
    paragraphLines.forEach((paragraphLine, lineIndex) => {
      if (lineIndex) paragraph.append(document.createElement('br'));
      appendInline(paragraph, paragraphLine);
    });
    root.append(paragraph);
  }
  return root;
}

function detailElement(detail) {
  const wrapper = document.createElement('details');
  wrapper.className = 'detail-item';
  const summary = document.createElement('summary');
  const title = document.createElement('span');
  title.className = 'detail-title';
  title.textContent = detail.title || detail.type || '执行详情';
  const status = document.createElement('span');
  status.className = 'detail-status';
  const running = detail.status === 'in_progress';
  if (running) status.classList.add('is-running');
  status.textContent = running ? '运行中' : (detail.exitCode === 0 ? '完成' : '详情');
  summary.append(title, status);

  const output = document.createElement('pre');
  output.className = 'detail-output';
  output.textContent = detail.output || (detail.items ? JSON.stringify(detail.items, null, 2) : '无输出');
  wrapper.append(summary, output);
  return wrapper;
}

function messageElement(message, live = false) {
  const article = document.createElement('article');
  article.className = `message is-${message.role}`;
  if (message.status && message.status !== 'completed') article.classList.add(`is-${message.status}`);

  if (message.role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = 'C';
    avatar.setAttribute('aria-hidden', 'true');
    article.append(avatar);
  }

  const body = document.createElement('div');
  body.className = 'message-body';
  if (live && !message.text) {
    const working = document.createElement('div');
    working.className = 'working-line';
    working.textContent = message.details?.length ? '正在执行检查' : '正在分析';
    body.append(working);
  } else {
    body.append(renderMarkdown(message.text));
  }

  if (message.details?.length) {
    const details = document.createElement('div');
    details.className = 'details-list';
    for (const item of message.details) details.append(detailElement(item));
    body.append(details);
  }

  if (message.usage?.input_tokens || message.usage?.output_tokens) {
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = `${message.usage.input_tokens || 0} in · ${message.usage.output_tokens || 0} out`;
    body.append(meta);
  }
  article.append(body);
  return article;
}

function renderMessages(forceBottom = false) {
  const nearBottom = elements.chatRegion.scrollHeight - elements.chatRegion.scrollTop - elements.chatRegion.clientHeight < 100;
  elements.messageList.replaceChildren();
  const messages = state.conversation?.messages || [];
  elements.emptyState.hidden = messages.length > 0 || state.running;
  for (const message of messages) elements.messageList.append(messageElement(message));
  if (state.running) {
    elements.messageList.append(messageElement({
      role: 'assistant',
      text: state.liveText,
      details: state.liveDetails,
      status: 'running',
    }, true));
  }
  if (forceBottom || nearBottom) {
    requestAnimationFrame(() => {
      elements.chatRegion.scrollTop = elements.chatRegion.scrollHeight;
    });
  }
}

function setRunning(running, label = '') {
  state.running = running;
  elements.composer.classList.toggle('is-running', running);
  elements.promptInput.disabled = running;
  elements.sendButton.disabled = running || !elements.promptInput.value.trim();
  elements.runState.textContent = label || (running ? 'Codex 正在处理' : '就绪');
}

function serviceUp(value) {
  return value === 'active';
}

function batteryState(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'charging') return '充电中';
  if (normalized === 'full') return '已充满';
  if (normalized === 'discharging') return '使用电池';
  if (normalized === 'not charging') return '未充电';
  return '状态未知';
}

function renderStatus(status) {
  elements.statusGrid.classList.remove('is-loading');
  if (!status) {
    elements.cpuValue.textContent = '--';
    elements.cpuMeta.textContent = '读取失败';
    elements.memoryValue.textContent = '--';
    elements.memoryMeta.textContent = '读取失败';
    elements.diskValue.textContent = '--';
    elements.diskMeta.textContent = '读取失败';
    elements.batteryValue.textContent = '--';
    elements.batteryMeta.textContent = '读取失败';
    elements.statusTime.textContent = '状态不可用';
    for (const service of elements.servicesValue.querySelectorAll('span')) {
      service.className = 'is-down';
      service.title = '状态未知';
    }
    elements.sidebarIndicator.className = 'service-indicator is-down';
    elements.sidebarStatus.textContent = '状态不可用';
    return;
  }
  elements.cpuValue.textContent = status.temperature == null ? '--' : `${status.temperature.toFixed(0)}°C`;
  elements.cpuMeta.textContent = status.load?.length ? `负载 ${status.load[0].toFixed(2)}` : '无负载数据';
  elements.memoryValue.textContent = status.memory ? `${status.memory.used} / ${status.memory.total}` : '--';
  elements.memoryMeta.textContent = status.memory ? `可用 ${status.memory.available}` : '无内存数据';
  elements.diskValue.textContent = status.disk ? `${status.disk.used} / ${status.disk.size}` : '--';
  elements.diskMeta.textContent = status.disk ? `剩余 ${status.disk.available}` : '无硬盘数据';
  elements.batteryValue.textContent = status.battery ? `${status.battery.capacity}%` : '--';
  elements.batteryMeta.textContent = status.battery ? batteryState(status.battery.state) : '无电池数据';

  const services = [
    ['Pal', status.services?.palworld],
    ['FRP', status.services?.frp],
    ['API', status.services?.sub2api],
  ];
  elements.servicesValue.replaceChildren();
  for (const [name, value] of services) {
    const item = document.createElement('span');
    item.className = serviceUp(value) ? 'is-up' : 'is-down';
    item.title = `${name}: ${value || 'unknown'}`;
    const indicator = document.createElement('i');
    indicator.setAttribute('aria-hidden', 'true');
    item.append(indicator, document.createTextNode(name));
    elements.servicesValue.append(item);
  }
  const allUp = services.every(([, value]) => serviceUp(value));
  elements.sidebarIndicator.className = `service-indicator ${allUp ? 'is-up' : 'is-down'}`;
  elements.sidebarStatus.textContent = allUp ? '服务正常' : '存在离线服务';
  elements.statusTime.textContent = `更新于 ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(status.checkedAt))}`;
}

async function refreshStatus() {
  elements.refreshStatus.disabled = true;
  try {
    const response = await api('/api/status');
    renderStatus(await response.json());
  } catch (error) {
    renderStatus(null);
    showToast(error.message);
  } finally {
    elements.refreshStatus.disabled = false;
  }
}

async function createConversation() {
  if (state.running) return showToast('请先停止当前任务');
  if (state.conversation && state.conversation.messages.length === 0) {
    closeSidebar();
    elements.promptInput.focus();
    return;
  }
  try {
    const response = await api('/api/conversations', { method: 'POST', body: '{}' });
    state.conversation = await response.json();
    syncConversationSummary();
    renderMessages(true);
    closeSidebar();
    elements.promptInput.focus();
  } catch (error) {
    showToast(error.message);
  }
}

async function loadConversation(id) {
  if (state.running) return showToast('当前任务运行中，暂时不能切换会话');
  try {
    const response = await api(`/api/conversations/${encodeURIComponent(id)}`);
    state.conversation = await response.json();
    syncConversationSummary();
    renderMessages(true);
    closeSidebar();
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteConversation(id, title) {
  if (!window.confirm(`删除“${title || '新会话'}”？此操作不能撤销。`)) return;
  try {
    await api(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.conversations = state.conversations.filter((item) => item.id !== id);
    if (state.conversation?.id === id) {
      state.conversation = null;
      if (state.conversations[0]) await loadConversation(state.conversations[0].id);
      else await createConversation();
    } else {
      renderConversationList();
    }
  } catch (error) {
    showToast(error.message);
  }
}

function upsertLiveDetail(detail) {
  const index = state.liveDetails.findIndex((item) => item.id === detail.id);
  if (index === -1) state.liveDetails.push(detail);
  else state.liveDetails[index] = detail;
}

function parseEventBlock(block) {
  let event = 'message';
  const data = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try {
    return { event, value: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}

async function consumeEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminalEvent = false;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const parsed = parseEventBlock(block);
      if (!parsed) continue;
      const { event, value: payload } = parsed;
      if (event === 'accepted') {
        state.conversation = payload.conversation;
        syncConversationSummary();
      } else if (event === 'thread' && state.conversation) {
        state.conversation.threadId = payload.threadId;
      } else if (event === 'detail') {
        upsertLiveDetail(payload);
        elements.runState.textContent = payload.status === 'in_progress' ? '正在执行检查' : '检查已完成';
      } else if (event === 'answer') {
        state.liveText = payload.text || '';
        elements.runState.textContent = '正在整理回答';
      } else if (event === 'done') {
        terminalEvent = true;
        if (payload.message) state.conversation.messages.push(payload.message);
      } else if (event === 'failure') {
        terminalEvent = true;
        if (payload.item) state.conversation.messages.push(payload.item);
        showToast(payload.message || '任务执行失败');
      }
      renderMessages(true);
    }
    if (done) break;
  }
  if (!terminalEvent) throw new Error('连接提前中断，任务可能已停止');
}

async function ensureConversation() {
  if (state.conversation) return state.conversation;
  const response = await api('/api/conversations', { method: 'POST', body: '{}' });
  state.conversation = await response.json();
  syncConversationSummary();
  return state.conversation;
}

async function sendMessage(text) {
  const prompt = String(text || '').trim();
  if (!prompt || state.running) return;
  try {
    await ensureConversation();
    state.liveText = '';
    state.liveDetails = [];
    state.conversation.messages.push({
      id: `local-${Date.now()}`,
      role: 'user',
      text: prompt,
      status: 'completed',
      createdAt: new Date().toISOString(),
      details: [],
    });
    elements.promptInput.value = '';
    resizeComposer();
    setRunning(true);
    renderMessages(true);

    const response = await api(`/api/conversations/${encodeURIComponent(state.conversation.id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text: prompt }),
    });
    await consumeEvents(response);
  } catch (error) {
    showToast(error.message);
  } finally {
    state.liveText = '';
    state.liveDetails = [];
    setRunning(false);
    if (state.conversation) {
      try {
        const response = await api(`/api/conversations/${encodeURIComponent(state.conversation.id)}`);
        state.conversation = await response.json();
      } catch {
        // Keep the locally rendered result when a refresh is unavailable.
      }
    }
    syncConversationSummary();
    renderMessages(true);
    elements.promptInput.focus();
  }
}

async function stopRun() {
  if (!state.running || !state.conversation) return;
  elements.runState.textContent = '正在停止';
  try {
    await api(`/api/conversations/${encodeURIComponent(state.conversation.id)}/cancel`, {
      method: 'POST',
      body: '{}',
    });
  } catch (error) {
    showToast(error.message);
  }
}

function resizeComposer() {
  const input = elements.promptInput;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 154)}px`;
  elements.characterCount.textContent = `${input.value.length} / 8000`;
  elements.sendButton.disabled = state.running || !input.value.trim();
}

async function bootstrap() {
  try {
    const response = await api('/api/bootstrap');
    const payload = await response.json();
    state.conversations = payload.conversations || [];
    state.model = payload.model;
    elements.modelLabel.textContent = payload.model?.model || '模型未知';
    elements.providerLabel.textContent = payload.model?.provider || 'Provider 未知';
    renderStatus(payload.status);
    renderConversationList();

    if (state.conversations[0]) await loadConversation(state.conversations[0].id);
    else await createConversation();

    clearInterval(state.statusTimer);
    state.statusTimer = setInterval(refreshStatus, 60_000);
  } catch (error) {
    renderStatus(null);
    showToast(error.message);
  }
}

elements.openSidebar.addEventListener('click', () => elements.app.classList.add('sidebar-open'));
elements.closeSidebar.addEventListener('click', closeSidebar);
elements.sidebarScrim.addEventListener('click', closeSidebar);
elements.newChatButton.addEventListener('click', createConversation);
elements.densityToggle.addEventListener('click', () => {
  setCompactMode(!document.documentElement.classList.contains('compact-ui'));
});
elements.refreshStatus.addEventListener('click', refreshStatus);
elements.stopButton.addEventListener('click', stopRun);
elements.composer.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(elements.promptInput.value);
});
elements.promptInput.addEventListener('input', resizeComposer);
elements.promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendMessage(elements.promptInput.value);
  }
});
elements.quickActions.addEventListener('click', (event) => {
  const button = event.target.closest('[data-prompt]');
  if (button) sendMessage(button.dataset.prompt);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshStatus();
});

initializeDensity();
resizeComposer();
bootstrap();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Service Worker registration failed:', error);
    });
  });
}
