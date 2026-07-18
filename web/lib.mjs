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
        let migrated = false;
        for (const conversation of this.data.conversations) {
          if (!['low', 'medium', 'high', 'xhigh'].includes(conversation.reasoningEffort)) {
            conversation.reasoningEffort = 'high';
            migrated = true;
          }
          if (conversation.mode && conversation.mode !== 'gpt') {
            conversation.legacyMode = conversation.mode;
            conversation.mode = 'gpt';
            conversation.archived = true;
            migrated = true;
          } else if (conversation.mode !== 'gpt') {
            conversation.mode = 'gpt';
            migrated = true;
          }
          if (typeof conversation.archived !== 'boolean') {
            conversation.archived = false;
            migrated = true;
          }
        }
        if (migrated) this.save();
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

  list(options = {}) {
    const includeArchived = options.includeArchived === true;
    return [...this.data.conversations]
      .filter((conversation) => includeArchived || !conversation.archived)
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

  create(options = {}) {
    const timestamp = nowIso();
    const conversation = {
      id: makeId('chat'),
      title: '新会话',
      mode: 'gpt',
      model: this.normalizeModel(options.model),
      reasoningEffort: ['low', 'medium', 'high', 'xhigh'].includes(options.reasoningEffort) ? options.reasoningEffort : 'high',
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };
    this.data.conversations.push(conversation);
    this.save();
    return conversation;
  }

  normalizeModel(value) {
    const model = String(value || '').trim();
    return /^[A-Za-z0-9._:-]{1,100}$/.test(model) ? model : null;
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

  updateSettings(id, settings = {}) {
    const conversation = this.get(id);
    if (!conversation) return null;
    if (Object.hasOwn(settings, 'model')) conversation.model = this.normalizeModel(settings.model);
    if (Object.hasOwn(settings, 'reasoningEffort') && ['low', 'medium', 'high', 'xhigh'].includes(settings.reasoningEffort)) {
      conversation.reasoningEffort = settings.reasoningEffort;
    }
    if (Object.hasOwn(settings, 'title')) {
      const title = String(settings.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (title) conversation.title = title;
    }
    if (Object.hasOwn(settings, 'archived')) conversation.archived = settings.archived === true;
    conversation.updatedAt = nowIso();
    this.save();
    return conversation;
  }

  remove(id) {
    const index = this.data.conversations.findIndex((item) => item.id === id);
    if (index === -1) return false;
    this.data.conversations.splice(index, 1);
    this.save();
    return true;
  }

  archive(id, archived = true) {
    return this.updateSettings(id, { archived });
  }

  updateDetail(id, detailId, patch = {}) {
    const conversation = this.get(id);
    if (!conversation) return null;
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      const detail = conversation.messages[index].details?.find((item) => item.id === detailId);
      if (!detail) continue;
      Object.assign(detail, patch);
      conversation.updatedAt = nowIso();
      this.save();
      return detail;
    }
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
