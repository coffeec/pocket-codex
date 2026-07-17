import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeId, nowIso } from './lib.mjs';

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return fallback;
  }
}

export function safeName(value, fallback = 'file') {
  const cleaned = String(value || '')
    .normalize('NFKC')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

export function safeSlug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .toLowerCase()
    .slice(0, 64);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export class ProjectStore {
  constructor(filePath, roots) {
    this.filePath = filePath;
    this.roots = Object.fromEntries(Object.entries(roots).map(([key, value]) => [key, path.resolve(value)]));
    this.data = readJson(filePath, { version: 1, projects: [] });
    if (!Array.isArray(this.data.projects)) this.data = { version: 1, projects: [] };
  }

  list() {
    return this.data.projects.map(({ containerPath, ...project }) => project);
  }

  get(id) {
    return this.data.projects.find((project) => project.id === id) || null;
  }

  resolve(id) {
    const project = this.get(id);
    if (!project) return null;
    const root = this.roots[project.storage];
    if (!root) return null;
    const candidate = path.resolve(root, project.slug);
    if (!isWithin(root, candidate)) return null;
    let realRoot;
    let realCandidate;
    try {
      realRoot = fs.realpathSync(root);
      realCandidate = fs.realpathSync(candidate);
    } catch {
      return null;
    }
    return isWithin(realRoot, realCandidate) ? { ...project, containerPath: realCandidate } : null;
  }

  create({ name, storage }) {
    if (!this.roots[storage]) throw new Error('存储位置无效');
    const displayName = String(name || '').trim().slice(0, 80);
    const slug = safeSlug(displayName);
    if (!displayName || !slug) throw new Error('项目名称无效');
    if (this.data.projects.some((project) => project.storage === storage && project.slug === slug)) {
      throw new Error('该存储位置已存在同名项目');
    }
    const root = this.roots[storage];
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const candidate = path.resolve(root, slug);
    if (!isWithin(root, candidate)) throw new Error('项目路径越界');
    fs.mkdirSync(candidate, { recursive: false, mode: 0o700 });
    const timestamp = nowIso();
    const project = { id: makeId('project'), name: displayName, slug, storage, createdAt: timestamp, updatedAt: timestamp };
    this.data.projects.push(project);
    atomicJson(this.filePath, this.data);
    return { ...project };
  }
}

export class AttachmentStore {
  constructor(dataDir, limits = {}) {
    this.root = path.join(dataDir, 'uploads');
    this.indexPath = path.join(dataDir, 'attachments.json');
    this.maximumFile = limits.maximumFile || 20 * 1024 * 1024;
    this.maximumConversation = limits.maximumConversation || 50 * 1024 * 1024;
    this.allowedExtensions = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.md', '.csv', '.log',
      '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.html', '.xml',
      '.json', '.yaml', '.yml', '.toml', '.ini', '.sh', '.ps1', '.py', '.go',
      '.rs', '.java', '.c', '.h', '.cpp', '.hpp',
    ]);
    this.data = readJson(this.indexPath, { version: 1, attachments: [] });
    if (!Array.isArray(this.data.attachments)) this.data = { version: 1, attachments: [] };
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }

  list(conversationId) {
    return this.data.attachments
      .filter((item) => item.conversationId === conversationId && item.status === 'staged')
      .map(({ diskPath, ...item }) => item);
  }

  get(id, conversationId) {
    return this.data.attachments.find((item) => item.id === id && item.conversationId === conversationId) || null;
  }

  async save(req, conversationId, requestedName, mimeType) {
    const name = safeName(requestedName, 'attachment');
    const extension = path.extname(name).toLowerCase();
    if (!this.allowedExtensions.has(extension)) throw new Error('不支持此文件类型');
    const used = this.data.attachments
      .filter((item) => item.conversationId === conversationId && item.status === 'staged')
      .reduce((sum, item) => sum + item.size, 0);
    if (used >= this.maximumConversation) throw new Error('当前会话附件已达到 50MB 上限');
    const id = makeId('attachment');
    const directory = path.join(this.root, conversationId, id);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const diskPath = path.join(directory, name);
    const handle = await fs.promises.open(diskPath, 'wx', 0o600);
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > this.maximumFile || used + size > this.maximumConversation) throw new Error('附件超过上传限制');
        await handle.writeFile(chunk);
      }
    } catch (error) {
      await handle.close();
      fs.rmSync(directory, { recursive: true, force: true });
      throw error;
    }
    await handle.close();
    if (!size) {
      fs.rmSync(directory, { recursive: true, force: true });
      throw new Error('附件为空');
    }
    const item = {
      id, conversationId, name, size,
      mimeType: String(mimeType || 'application/octet-stream').split(';')[0].slice(0, 100),
      extension, status: 'staged', createdAt: nowIso(), diskPath,
    };
    this.data.attachments.push(item);
    atomicJson(this.indexPath, this.data);
    const { diskPath: omitted, ...publicItem } = item;
    return publicItem;
  }

  remove(id, conversationId) {
    const item = this.get(id, conversationId);
    if (!item || item.status !== 'staged') return false;
    fs.rmSync(path.dirname(item.diskPath), { recursive: true, force: true });
    this.data.attachments = this.data.attachments.filter((candidate) => candidate !== item);
    atomicJson(this.indexPath, this.data);
    return true;
  }

  prepare(ids, conversationId, runRoot) {
    const unique = [...new Set(ids || [])];
    const items = unique.map((id) => this.get(id, conversationId));
    if (items.some((item) => !item || item.status !== 'staged')) throw new Error('附件不存在或已经使用');
    if (!items.length) return [];
    const attachmentDir = path.join(runRoot, 'attachments');
    fs.mkdirSync(attachmentDir, { recursive: true, mode: 0o700 });
    const prepared = items.map((item, index) => {
      const name = `${String(index + 1).padStart(2, '0')}-${item.name}`;
      const runPath = path.join(attachmentDir, name);
      fs.copyFileSync(item.diskPath, runPath, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(runPath, 0o444);
      return { ...item, runPath };
    });
    fs.chmodSync(attachmentDir, 0o555);
    return prepared;
  }

  consume(items) {
    if (!items.length) return;
    for (const prepared of items) {
      const item = this.get(prepared.id, prepared.conversationId);
      if (!item) continue;
      item.status = 'consumed';
      item.consumedAt = nowIso();
      fs.rmSync(path.dirname(item.diskPath), { recursive: true, force: true });
    }
    atomicJson(this.indexPath, this.data);
  }

  cleanup(maxAgeMs = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    const expired = this.data.attachments.filter((item) => new Date(item.createdAt).getTime() < cutoff);
    for (const item of expired) fs.rmSync(path.dirname(item.diskPath), { recursive: true, force: true });
    if (expired.length) {
      const ids = new Set(expired.map((item) => item.id));
      this.data.attachments = this.data.attachments.filter((item) => !ids.has(item.id));
      atomicJson(this.indexPath, this.data);
    }
  }
}

export class AuditLog {
  constructor(filePath, maximumBytes = 5 * 1024 * 1024) {
    this.filePath = filePath;
    this.maximumBytes = maximumBytes;
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  }

  write(entry) {
    try {
      if (fs.statSync(this.filePath, { throwIfNoEntry: false })?.size > this.maximumBytes) {
        fs.renameSync(this.filePath, `${this.filePath}.1`);
      }
      const record = {
        time: nowIso(),
        action: String(entry.action || 'unknown').slice(0, 80),
        outcome: String(entry.outcome || 'unknown').slice(0, 40),
        actor: String(entry.actor || 'web').slice(0, 80),
        source: String(entry.source || 'unknown').slice(0, 80),
        resource: String(entry.resource || '').slice(0, 160),
      };
      fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    } catch {
      // Audit failures must not leak request data or crash the service.
    }
  }
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
