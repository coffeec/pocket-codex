import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix = 'item') {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function conversationTitle(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '新会话';
  return clean.length > 26 ? `${clean.slice(0, 26)}...` : clean;
}

export class ConversationStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version: 1, conversations: [] };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed?.version === 1 && Array.isArray(parsed.conversations)) {
        this.data = parsed;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  list() {
    return [...this.data.conversations]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ messages, ...conversation }) => ({
        ...conversation,
        messageCount: messages.length,
        preview: messages.at(-1)?.text?.slice(0, 100) || '',
      }));
  }

  get(id) {
    return this.data.conversations.find((item) => item.id === id) || null;
  }

  create() {
    const timestamp = nowIso();
    const conversation = {
      id: makeId('chat'),
      title: '新会话',
      threadId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };
    this.data.conversations.push(conversation);
    this.save();
    return conversation;
  }

  addMessage(id, message) {
    const conversation = this.get(id);
    if (!conversation) return null;
    const item = {
      id: makeId('msg'),
      createdAt: nowIso(),
      details: [],
      ...message,
    };
    conversation.messages.push(item);
    if (message.role === 'user' && conversation.title === '新会话') {
      conversation.title = conversationTitle(message.text);
    }
    conversation.updatedAt = item.createdAt;
    this.save();
    return item;
  }

  updateThread(id, threadId) {
    const conversation = this.get(id);
    if (!conversation) return;
    conversation.threadId = threadId;
    conversation.updatedAt = nowIso();
    this.save();
  }

  remove(id) {
    const index = this.data.conversations.findIndex((item) => item.id === id);
    if (index === -1) return false;
    this.data.conversations.splice(index, 1);
    this.save();
    return true;
  }
}

export function normalizeCodexItem(item) {
  if (!item || typeof item !== 'object') return null;
  const base = { id: item.id || makeId('detail'), type: item.type, status: item.status || 'completed' };
  switch (item.type) {
    case 'command_execution':
      return {
        ...base,
        title: item.command || '执行命令',
        output: item.aggregated_output || '',
        exitCode: item.exit_code,
      };
    case 'reasoning':
      return { ...base, title: '分析过程摘要', output: item.text || '' };
    case 'todo_list':
      return { ...base, title: '执行计划', items: item.items || [] };
    case 'mcp_tool_call':
      return {
        ...base,
        title: `${item.server || 'MCP'} / ${item.tool || 'tool'}`,
        output: item.error?.message || '',
      };
    case 'web_search':
      return { ...base, title: '网页搜索', output: item.query || '' };
    case 'file_change':
      return { ...base, title: '文件变更', items: item.changes || [] };
    case 'error':
      return { ...base, title: '提示', output: item.message || '' };
    default:
      return null;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseBatteryStatus(raw) {
  const values = {};
  for (const line of String(raw || '').split('\n')) {
    const match = /^([a-z_]+):\s*(.+)$/i.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values.capacity
    ? { capacity: Number(values.capacity), state: values.status || 'unknown' }
    : null;
}

export function parseHostStatus(raw, sub2apiUp = false, batteryRaw = '') {
  const text = String(raw || '');
  const memoryLine = text.split('\n').find((line) => /^Mem:\s/.test(line.trim()));
  const memoryParts = memoryLine?.trim().split(/\s+/) || [];
  const diskLine = text.split('\n').find((line) => /^\/dev\//.test(line.trim()));
  const diskParts = diskLine?.trim().split(/\s+/) || [];
  const tempMatch = text.match(/Package id 0:\s*\+?([\d.]+)\s*°?C/i);
  const loadMatch = text.match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/i);
  const service = (name) => new RegExp(`${escapeRegExp(name)}:\\s*(\\w+)`, 'i').exec(text)?.[1] || 'unknown';

  return {
    temperature: tempMatch ? Number(tempMatch[1]) : null,
    load: loadMatch ? loadMatch.slice(1, 4).map(Number) : [],
    memory: memoryParts.length >= 7
      ? { total: memoryParts[1], used: memoryParts[2], available: memoryParts[6] }
      : null,
    disk: diskParts.length >= 6
      ? { size: diskParts[1], used: diskParts[2], available: diskParts[3], percent: diskParts[4] }
      : null,
    services: {
      palworld: service('palworld'),
      frp: service('sakurafrp-palworld'),
      sub2api: sub2apiUp ? 'active' : 'inactive',
    },
    battery: parseBatteryStatus(batteryRaw),
    checkedAt: nowIso(),
  };
}

export function isSafeOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
