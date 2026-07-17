import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ConversationStore,
  isSafeOrigin,
  normalizeCodexItem,
  parseHostStatus,
} from './lib.mjs';
import { AttachmentStore, AuditLog, ProjectStore, sha256 } from './storage.mjs';

const execFileAsync = promisify(execFile);
const MODES = new Set(['gpt', 'agent', 'server']);
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.log', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.css', '.html', '.xml', '.json', '.yaml', '.yml', '.toml', '.ini', '.sh',
  '.ps1', '.py', '.go', '.rs', '.java', '.c', '.h', '.cpp', '.hpp',
]);

function secureEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Cache-Control', 'no-store');
}

function json(res, status, value) {
  securityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function sse(res, event, value) {
  if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
}

async function readBody(req, maximum = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximum) throw new Error('请求内容过长');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new Error('请求格式无效'); }
}

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function sourceAddress(req) {
  const remoteAddress = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress);
  const forwarded = local ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return (forwarded || remoteAddress || 'unknown').slice(0, 80);
}

function cookieHeader(req, token, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `pc_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function safeMessage(error, secret = '') {
  let message = String(error?.message || '执行失败').slice(0, 800);
  if (secret) message = message.replaceAll(secret, '[REDACTED]');
  return message;
}

function detailUpsert(details, incoming) {
  const index = details.findIndex((item) => item.id === incoming.id);
  if (index === -1) details.push(incoming);
  else details[index] = incoming;
}

export function codexArgs(conversation, options = {}) {
  const sandbox = options.sandbox || (conversation.mode === 'agent' ? 'workspace-write' : 'read-only');
  const runtime = ['--sandbox', sandbox, '--ask-for-approval', 'never'];
  if (conversation.threadId) {
    return [...runtime, 'exec', 'resume', '--json', '--skip-git-repo-check', conversation.threadId, '-'];
  }
  return [...runtime, 'exec', '--json', '--skip-git-repo-check', '-C', options.cwd || '/workspace', '-'];
}

function terminate(control) {
  if (control.finished || control.cancelled) return;
  control.cancelled = true;
  control.abort?.abort(new Error('已停止'));
  if (!control.child || control.child.exitCode !== null) return;
  control.child.kill('SIGTERM');
  control.killTimer = setTimeout(() => {
    if (control.child?.exitCode === null) control.child.kill('SIGKILL');
  }, 5_000);
  control.killTimer.unref?.();
}

function providerConfig(configPath, authPath, fallbackModel, fallbackProvider) {
  let config = '';
  try { config = fs.readFileSync(configPath, 'utf8'); } catch { /* handled below */ }
  let apiKey = '';
  try { apiKey = JSON.parse(fs.readFileSync(authPath, 'utf8')).OPENAI_API_KEY || ''; } catch { /* handled below */ }
  return {
    model: /^model\s*=\s*"([^"]+)"/m.exec(config)?.[1] || fallbackModel,
    provider: /^model_provider\s*=\s*"([^"]+)"/m.exec(config)?.[1] || fallbackProvider,
    apiKey,
  };
}

function responseText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  return (payload?.output || []).flatMap((item) => item.content || [])
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text || '')
    .join('');
}

export function createCodexWebApp(options = {}) {
  const publicDir = path.resolve(options.publicDir || '/app/web/public');
  const dataDir = path.resolve(options.dataDir || '/home/node/.codex-web');
  const runBase = path.resolve(options.runBase || path.join(dataDir, 'runs'));
  const password = String(options.password || '');
  const username = options.username || 'admin';
  const mockMode = options.mockMode === true;
  const configPath = options.configPath || '/home/node/.codex/config.toml';
  const authPath = options.authPath || '/home/node/.codex/auth.json';
  const hostctlPath = options.hostctlPath || '/workspace/hostctl';
  const sub2apiBaseUrl = String(options.sub2apiBaseUrl || 'http://sub2api:8080/v1').replace(/\/$/, '');
  const sub2apiHealthUrl = options.sub2apiHealthUrl || 'http://sub2api:8080/health';
  const codexCommand = options.codexCommand || 'codex';
  const ocrCommand = options.ocrCommand || 'tesseract';
  const store = new ConversationStore(path.join(dataDir, 'conversations.json'));
  const projects = new ProjectStore(path.join(dataDir, 'projects.json'), {
    ssd: options.ssdRoot || '/projects/ssd',
    disk: options.diskRoot || '/projects/disk',
  });
  const attachments = new AttachmentStore(dataDir, options.uploadLimits);
  const audit = new AuditLog(path.join(dataDir, 'audit.jsonl'));
  const capabilitiesPath = path.join(dataDir, 'capabilities.json');
  const activeRuns = new Map();
  const rateBuckets = new Map();
  const loginFailures = new Map();
  const sessions = new Map();
  const sessionMaximum = options.sessionMaximum || 12 * 60 * 60 * 1000;
  const sessionIdle = options.sessionIdle || 60 * 60 * 1000;
  const sessionCookieSeconds = Math.floor(sessionMaximum / 1000);
  const agentHost = options.agentHost || 'cloudcli-agent';
  const agentPort = Number(options.agentPort || 3001);

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(runBase, { recursive: true, mode: 0o700 });
  attachments.cleanup();
  if (!password) throw new Error('Web password cannot be empty');

  function rateAllowed(req, scope = 'general', limit = 120, windowMs = 60_000) {
    const key = `${sourceAddress(req)}:${scope}`;
    const now = Date.now();
    const recent = (rateBuckets.get(key) || []).filter((time) => now - time < windowMs);
    recent.push(now);
    rateBuckets.set(key, recent);
    return recent.length <= limit;
  }

  function issueSession(req, res) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    sessions.set(sha256(token), { createdAt: now, lastSeen: now, source: sourceAddress(req) });
    res.setHeader('Set-Cookie', cookieHeader(req, token, sessionCookieSeconds));
    return token;
  }

  function basicCredentials(req) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Basic ')) return null;
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const split = decoded.indexOf(':');
      return split > -1 ? [decoded.slice(0, split), decoded.slice(split + 1)] : null;
    } catch { return null; }
  }

  function authenticated(req, res) {
    const token = parseCookies(req).pc_session;
    if (token) {
      const session = sessions.get(sha256(token));
      const now = Date.now();
      if (session && session.source === sourceAddress(req) && now - session.createdAt <= sessionMaximum && now - session.lastSeen <= sessionIdle) {
        session.lastSeen = now;
        return true;
      }
      if (session) sessions.delete(sha256(token));
      res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
    }
    const basic = basicCredentials(req);
    if (basic) {
      const source = sourceAddress(req);
      const now = Date.now();
      const record = loginFailures.get(source) || { attempts: [], blockedUntil: 0 };
      record.attempts = record.attempts.filter((time) => now - time < 15 * 60 * 1000);
      if (record.blockedUntil > now) {
        req.authRateLimited = true;
        audit.write({ action: 'basic_auth', outcome: 'rate_limited', source });
        return false;
      }
      if (secureEqual(basic[0], username) && secureEqual(basic[1], password)) {
        loginFailures.delete(source);
        issueSession(req, res);
        return true;
      }
      record.attempts.push(now);
      if (record.attempts.length >= 5) record.blockedUntil = now + 15 * 60 * 1000;
      loginFailures.set(source, record);
      audit.write({ action: 'basic_auth', outcome: 'failure', source });
    }
    return false;
  }

  function cookieSessionAuthenticated(req) {
    const token = parseCookies(req).pc_session;
    if (!token) return false;
    const key = sha256(token);
    const session = sessions.get(key);
    const now = Date.now();
    if (session && session.source === sourceAddress(req) && now - session.createdAt <= sessionMaximum && now - session.lastSeen <= sessionIdle) {
      session.lastSeen = now;
      return true;
    }
    if (session) sessions.delete(key);
    return false;
  }

  function agentHeaders(req) {
    const headers = { ...req.headers, host: `${agentHost}:${agentPort}` };
    delete headers.cookie;
    delete headers.authorization;
    delete headers['proxy-authorization'];
    delete headers['x-api-key'];
    headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'http';
    return headers;
  }

  function agentPath(url) {
    if (url.pathname === '/agent') return `/${url.search}`;
    if (url.pathname.startsWith('/agent/')) return `${url.pathname.slice('/agent'.length)}${url.search}`;
    return `${url.pathname}${url.search}`;
  }

  function proxyAgentHttp(req, res, url) {
    const upstream = http.request({
      hostname: agentHost,
      port: agentPort,
      method: req.method,
      path: agentPath(url),
      headers: agentHeaders(req),
    }, (upstreamResponse) => {
      const headers = { ...upstreamResponse.headers };
      delete headers['set-cookie'];
      headers['x-frame-options'] = 'DENY';
      headers['x-content-type-options'] = 'nosniff';
      headers['referrer-policy'] = 'no-referrer';
      headers['permissions-policy'] = 'camera=(), microphone=(), geolocation=()';
      headers['content-security-policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
      res.writeHead(upstreamResponse.statusCode || 502, headers);
      upstreamResponse.pipe(res);
    });
    upstream.on('error', (error) => {
      if (!res.headersSent) json(res, 502, { error: 'Agent service unavailable' });
      else res.destroy(error);
    });
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      audit.write({ action: 'agent.proxy', outcome: 'accepted', actor: username, source: sourceAddress(req), resource: url.pathname.slice(0, 240) });
    }
    req.pipe(upstream);
  }

  function rejectUpgrade(socket, status = 401, message = 'Unauthorized') {
    if (socket.destroyed || !socket.writable) return;
    socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  function proxyAgentUpgrade(req, socket, head) {
    const upstream = http.request({
      hostname: agentHost,
      port: agentPort,
      method: 'GET',
      path: req.url,
      headers: agentHeaders(req),
    });
    const destroy = (target) => {
      if (!target.destroyed) target.destroy();
    };
    socket.on('error', () => destroy(upstream));
    upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      const lines = [`HTTP/1.1 ${response.statusCode || 101} ${response.statusMessage || 'Switching Protocols'}`];
      for (const [name, value] of Object.entries(response.headers)) {
        if (name.toLowerCase() === 'set-cookie' || value === undefined) continue;
        if (Array.isArray(value)) value.forEach((item) => lines.push(`${name}: ${item}`));
        else lines.push(`${name}: ${value}`);
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      socket.on('error', () => destroy(upstreamSocket));
      upstreamSocket.on('error', () => destroy(socket));
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
      socket.on('close', () => destroy(upstreamSocket));
      upstreamSocket.on('close', () => destroy(socket));
    });
    upstream.on('response', (response) => {
      response.resume();
      rejectUpgrade(socket, response.statusCode || 502, 'Upgrade Failed');
    });
    upstream.on('error', () => rejectUpgrade(socket, 502, 'Bad Gateway'));
    upstream.end();
  }

  async function handleLogin(req, res) {
    if (!isSafeOrigin(req)) return json(res, 403, { error: '拒绝跨站请求' });
    const source = sourceAddress(req);
    const now = Date.now();
    const record = loginFailures.get(source) || { attempts: [], blockedUntil: 0 };
    record.attempts = record.attempts.filter((time) => now - time < 15 * 60 * 1000);
    if (record.blockedUntil > now) {
      audit.write({ action: 'login', outcome: 'rate_limited', source });
      return json(res, 429, { error: '登录失败次数过多，请稍后重试' });
    }
    let body;
    try { body = await readBody(req, 4096); }
    catch (error) { return json(res, 400, { error: error.message }); }
    if (secureEqual(body.username || '', username) && secureEqual(body.password || '', password)) {
      loginFailures.delete(source);
      issueSession(req, res);
      audit.write({ action: 'login', outcome: 'success', actor: username, source });
      return json(res, 200, { authenticated: true, expiresIn: sessionCookieSeconds });
    }
    record.attempts.push(now);
    if (record.attempts.length >= 5) record.blockedUntil = now + 15 * 60 * 1000;
    loginFailures.set(source, record);
    audit.write({ action: 'login', outcome: 'failure', source });
    return json(res, 401, { error: '用户名或密码错误' });
  }

  function modelInfo() {
    const config = providerConfig(configPath, authPath, 'gpt-5.6-sol', 'sub2api_local');
    return { model: config.model, provider: config.provider };
  }

  function capabilities() {
    try {
      const value = JSON.parse(fs.readFileSync(capabilitiesPath, 'utf8'));
      const imageInput = value.imageInput === true ? true : value.imageInput === false ? false : null;
      return { imageInput, imageFallback: imageInput === false ? 'ocr' : null, checkedAt: value.checkedAt || null };
    } catch { return { imageInput: mockMode ? true : null, imageFallback: null, checkedAt: null }; }
  }

  async function listModels() {
    const config = providerConfig(configPath, authPath, 'gpt-5.6-sol', 'sub2api_local');
    if (mockMode) return [config.model, 'gpt-5.5-codex'].filter(Boolean);
    if (!config.apiKey) return [config.model].filter(Boolean);
    try {
      const response = await fetch(`${sub2apiBaseUrl}/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error('models unavailable');
      const payload = await response.json();
      const values = (payload.data || []).map((item) => String(item.id || '')).filter(Boolean).slice(0, 100);
      if (config.model && !values.includes(config.model)) values.unshift(config.model);
      return values;
    } catch { return [config.model].filter(Boolean); }
  }

  async function command(file, args, timeout = 10_000, cwd) {
    return execFileAsync(file, args, { timeout, cwd, maxBuffer: 512 * 1024, encoding: 'utf8' });
  }

  async function statusSnapshot() {
    if (mockMode) {
      return {
        temperature: 58, load: [0.72, 0.84, 0.91],
        memory: { total: '15Gi', used: '3.6Gi', available: '11Gi' },
        disk: { size: '106G', used: '18G', available: '83G', percent: '18%' },
        battery: { capacity: 82, state: 'Charging' },
        services: { palworld: 'active', frp: 'active', sub2api: 'active' },
        checkedAt: new Date().toISOString(),
      };
    }
    const [hostResult, batteryResult, sub2apiUp] = await Promise.all([
      command(hostctlPath, ['status']).then(({ stdout }) => stdout),
      command(hostctlPath, ['battery']).then(({ stdout }) => stdout).catch(() => ''),
      fetch(sub2apiHealthUrl, { signal: AbortSignal.timeout(5_000) }).then((response) => response.ok).catch(() => false),
    ]);
    return parseHostStatus(hostResult, sub2apiUp, batteryResult);
  }

  async function mockRun(conversation, prompt, res, control) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (control.cancelled) throw new Error('已停止');
    const text = conversation.mode === 'gpt'
      ? `这是 GPT 模式的真实增量流模拟：${prompt}`
      : conversation.mode === 'agent'
        ? 'Agent 已检查登记项目并完成模拟任务。'
        : '服务器状态正常，hostctl 只读边界有效。';
    for (const part of text.match(/.{1,8}/gu) || []) {
      if (control.cancelled) throw new Error('已停止');
      sse(res, 'delta', { text: part });
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { text, details: [], usage: { input_tokens: 20, output_tokens: 20 } };
  }

  function gptInput(conversation, prompt, prepared) {
    const history = conversation.messages.slice(-30).filter((message) => ['user', 'assistant'].includes(message.role));
    const prior = history.slice(0, -1).map((message) => ({ role: message.role, content: message.text }));
    const content = [{ type: 'input_text', text: prompt }];
    for (const item of prepared) {
      const data = fs.readFileSync(item.runPath);
      if (item.mimeType.startsWith('image/')) {
        if (capabilities().imageInput === true) {
          content.push({ type: 'input_image', image_url: `data:${item.mimeType};base64,${data.toString('base64')}` });
        } else if (item.ocrText) {
          content.push({ type: 'input_text', text: `\n\n图片 ${item.name} 的本地 OCR 文本（不包含颜色、布局或图形信息）：\n${item.ocrText}` });
        } else {
          throw new Error('当前 Sub2API 不支持图片输入，且本地 OCR 未提取到文字；无法进行视觉理解');
        }
      } else if (TEXT_EXTENSIONS.has(item.extension) && data.length <= 1024 * 1024) {
        content.push({ type: 'input_text', text: `\n\n附件 ${item.name}:\n\u0060\u0060\u0060\n${data.toString('utf8')}\n\u0060\u0060\u0060` });
      } else {
        content.push({ type: 'input_file', filename: item.name, file_data: `data:${item.mimeType};base64,${data.toString('base64')}` });
      }
    }
    return [...prior, { role: 'user', content }];
  }

  async function applyImageFallback(prepared, res, control) {
    const details = [];
    if (capabilities().imageInput === true) return details;
    for (const item of prepared.filter((entry) => entry.mimeType.startsWith('image/'))) {
      if (control.cancelled) throw new Error('已停止');
      let text = '';
      try {
        const result = await command(ocrCommand, [item.runPath, 'stdout', '-l', 'chi_sim+eng'], 30_000);
        text = result.stdout.trim().slice(0, 100_000);
      } catch {
        text = '';
      }
      item.ocrText = text;
      const detail = {
        id: `ocr_${item.id}`,
        type: 'attachment_ocr',
        status: text ? 'completed' : 'failed',
        title: `OCR: ${item.name}`,
        output: text
          ? 'Sub2API 图片输入不兼容；已提取图片文字。未识别颜色、布局或图形。'
          : 'Sub2API 图片输入不兼容，OCR 也未提取到文字；无法进行视觉理解。',
      };
      details.push(detail);
      sse(res, 'detail', detail);
    }
    return details;
  }

  async function gptRun(conversation, prompt, prepared, res, control) {
    const config = providerConfig(configPath, authPath, 'gpt-5.6-sol', 'sub2api_local');
    if (!config.apiKey) throw new Error('Sub2API 凭据不可用');
    const response = await fetch(`${sub2apiBaseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: conversation.model || config.model,
        reasoning: { effort: conversation.reasoningEffort || 'high' },
        input: gptInput(conversation, prompt, prepared),
        stream: true,
      }),
      signal: control.abort.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Sub2API 请求失败 (${response.status}): ${body.slice(0, 300)}`);
    }
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/event-stream')) {
      const payload = await response.json();
      const text = responseText(payload);
      if (!text) throw new Error('Sub2API 未返回文本');
      sse(res, 'delta', { text });
      return { text, details: [], usage: payload.usage || null };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let usage = null;
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (!data || data === '[DONE]') continue;
        let event;
        try { event = JSON.parse(data); } catch { continue; }
        if (event.type === 'response.output_text.delta' && event.delta) {
          text += event.delta;
          sse(res, 'delta', { text: event.delta });
        } else if (event.type === 'response.completed') {
          usage = event.response?.usage || null;
          if (!text) text = responseText(event.response);
        } else if (event.type === 'response.failed' || event.type === 'error') {
          throw new Error(event.error?.message || event.response?.error?.message || 'Sub2API 流式响应失败');
        }
      }
      if (done) break;
    }
    if (!text) throw new Error('Sub2API 流式响应未返回文本');
    return { text, details: [], usage };
  }

  function agentPrompt(conversation, prompt, prepared, cwd) {
    const files = prepared.map((item) => {
      const ocr = item.ocrText ? `\n  OCR 文本（不含视觉布局信息）：${item.ocrText}` : '';
      return `- ${item.runPath} (${item.name}, 只读附件)${ocr}`;
    }).join('\n');
    if (conversation.mode === 'server') {
      return `你处于 PocketCodex 服务器模式。只能通过 /workspace/hostctl 使用其现有只读白名单；不得尝试绕过、提权或读取凭据。\n\n用户请求：\n${prompt}${files ? `\n\n只读附件：\n${files}` : ''}`;
    }
    return `你处于 PocketCodex Agent 模式。唯一登记项目目录是 ${cwd}。只能在该项目内读取和修改；附件目录只读，不得修改。完成后说明测试结果和变更。\n\n用户请求：\n${prompt}${files ? `\n\n只读附件：\n${files}` : ''}`;
  }

  function codexRun(conversation, prompt, prepared, cwd, res, control) {
    return new Promise((resolve, reject) => {
      const sandbox = conversation.mode === 'agent' ? 'workspace-write' : 'read-only';
      const child = spawn(codexCommand, codexArgs(conversation, { cwd, sandbox }), {
        cwd,
        env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      control.child = child;
      child.stdin.end(agentPrompt(conversation, prompt, prepared, cwd));
      const details = [];
      let finalText = '';
      let usage = null;
      let completed = false;
      let failureMessage = '';
      let stderr = '';
      const lines = readline.createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        let event;
        try { event = JSON.parse(line); } catch { return; }
        if (event.type === 'thread.started' && event.thread_id) {
          store.updateThread(conversation.id, event.thread_id);
          sse(res, 'thread', { threadId: event.thread_id });
          return;
        }
        if (['item.started', 'item.updated', 'item.completed'].includes(event.type)) {
          if (event.item?.type === 'agent_message' && event.type === 'item.completed') {
            finalText = event.item.text || '';
            sse(res, 'answer', { text: finalText });
            return;
          }
          const detail = normalizeCodexItem(event.item);
          if (detail) {
            detail.status = event.type === 'item.started' ? 'in_progress' : detail.status;
            detailUpsert(details, detail);
            sse(res, 'detail', detail);
          }
          return;
        }
        if (event.type === 'turn.completed') {
          completed = true;
          usage = event.usage || null;
        } else if (event.type === 'turn.failed' || event.type === 'error') {
          failureMessage = event.error?.message || event.message || 'Codex 执行失败';
        }
      });
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-12_000); });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        lines.close();
        if (control.cancelled) return reject(new Error('已停止'));
        if (code === 0 && completed && finalText) return resolve({ text: finalText, details, usage });
        const message = failureMessage || (signal ? `Codex 已被信号 ${signal} 终止` : stderr.trim().split('\n').slice(-3).join('\n') || `Codex 退出，代码 ${code}`);
        reject(new Error(message));
      });
    });
  }

  async function gitDiff(cwd) {
    try {
      const { stdout } = await command('git', ['-C', cwd, 'diff', '--no-ext-diff', '--unified=3', '--'], 15_000, cwd);
      if (!stdout) return null;
      return { id: `diff_${Date.now()}`, type: 'file_change', status: 'completed', title: '工作区 Diff', output: stdout.slice(0, 256 * 1024) };
    } catch { return null; }
  }

  async function handleMessage(req, res, conversation) {
    if (activeRuns.size > 0) return json(res, 409, { error: '已有任务正在运行，请等待或停止后再试' });
    if (!isSafeOrigin(req)) return json(res, 403, { error: '拒绝跨站请求' });
    if (!rateAllowed(req, 'message', 20)) return json(res, 429, { error: '消息发送过于频繁' });
    let body;
    try { body = await readBody(req); } catch (error) { return json(res, 400, { error: error.message }); }
    const prompt = String(body.text || '').trim();
    if (!prompt || prompt.length > 16_000) return json(res, 400, { error: '消息不能为空且不能超过 16000 字符' });
    const mode = MODES.has(conversation.mode) ? conversation.mode : 'gpt';
    conversation.mode = mode;
    let cwd = '/workspace';
    if (mode === 'agent') {
      const project = projects.resolve(conversation.projectId);
      if (!project) return json(res, 400, { error: '请先选择已登记的项目' });
      cwd = project.containerPath;
    }
    const runRoot = path.join(runBase, crypto.randomUUID());
    fs.mkdirSync(runRoot, { recursive: true, mode: 0o700 });
    let prepared = [];
    try { prepared = attachments.prepare(Array.isArray(body.attachmentIds) ? body.attachmentIds : [], conversation.id, runRoot); }
    catch (error) { fs.rmSync(runRoot, { recursive: true, force: true }); return json(res, 400, { error: error.message }); }
    const userMessage = store.addMessage(conversation.id, {
      role: 'user', text: prompt, status: 'completed',
      attachments: prepared.map(({ diskPath, runPath, ...item }) => item),
    });
    securityHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const control = { child: null, abort: new AbortController(), cancelled: false, finished: false, killTimer: null };
    activeRuns.set(conversation.id, control);
    sse(res, 'accepted', { message: userMessage, conversation: store.get(conversation.id) });
    audit.write({ action: 'run', outcome: 'started', actor: username, source: sourceAddress(req), resource: `${mode}:${conversation.id}` });
    const disconnect = () => { if (!control.finished) terminate(control); };
    req.once('aborted', disconnect);
    res.once('close', disconnect);
    const keepalive = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(': keepalive\n\n'); }, 15_000);
    keepalive.unref?.();
    try {
      let result;
      const fallbackDetails = await applyImageFallback(prepared, res, control);
      if (mockMode) result = await mockRun(conversation, prompt, res, control);
      else if (mode === 'gpt') result = await gptRun(conversation, prompt, prepared, res, control);
      else result = await codexRun(conversation, prompt, prepared, cwd, res, control);
      result.details.unshift(...fallbackDetails);
      if (mode === 'agent') {
        const diff = await gitDiff(cwd);
        if (diff) { result.details.push(diff); sse(res, 'detail', diff); }
      }
      const assistantMessage = store.addMessage(conversation.id, {
        role: 'assistant', text: result.text, details: result.details, usage: result.usage, status: 'completed',
      });
      attachments.consume(prepared);
      audit.write({ action: 'run', outcome: 'completed', actor: username, source: sourceAddress(req), resource: `${mode}:${conversation.id}` });
      sse(res, 'done', { message: assistantMessage, usage: result.usage });
    } catch (error) {
      const secret = providerConfig(configPath, authPath, '', '').apiKey;
      const message = safeMessage(error, secret);
      const assistantMessage = store.addMessage(conversation.id, { role: 'assistant', text: message, status: control.cancelled ? 'cancelled' : 'failed' });
      audit.write({ action: 'run', outcome: control.cancelled ? 'cancelled' : 'failed', actor: username, source: sourceAddress(req), resource: `${mode}:${conversation.id}` });
      sse(res, 'failure', { message, item: assistantMessage });
    } finally {
      control.finished = true;
      clearInterval(keepalive);
      clearTimeout(control.killTimer);
      activeRuns.delete(conversation.id);
      try { fs.chmodSync(path.join(runRoot, 'attachments'), 0o700); } catch { /* no attachments */ }
      fs.rmSync(runRoot, { recursive: true, force: true });
      if (!res.writableEnded) res.end();
    }
  }

  const mime = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json; charset=utf-8',
  };

  function staticFile(res, pathname) {
    const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
    const resolved = path.resolve(publicDir, requested);
    if ((!resolved.startsWith(`${publicDir}${path.sep}`) && resolved !== path.join(publicDir, 'index.html')) || !Object.hasOwn(mime, path.extname(resolved))) {
      return json(res, 404, { error: 'Not found' });
    }
    try {
      const body = fs.readFileSync(resolved);
      securityHeaders(res);
      res.writeHead(200, { 'Content-Type': mime[path.extname(resolved)] });
      res.end(body);
    } catch { json(res, 404, { error: 'Not found' }); }
  }

  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') return json(res, 200, { status: 'ok' });
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pocketApi = url.pathname === '/pocket-api' || url.pathname.startsWith('/pocket-api/');
    const agentRequest = url.pathname === '/agent' || url.pathname.startsWith('/agent/') || url.pathname === '/api' || url.pathname.startsWith('/api/');
    if (pocketApi) url.pathname = `/api${url.pathname.slice('/pocket-api'.length)}`;
    if (req.method === 'GET' && !pocketApi && !agentRequest) return staticFile(res, url.pathname);
    if (req.method === 'POST' && url.pathname === '/api/login') return handleLogin(req, res);
    if (!authenticated(req, res)) return json(res, req.authRateLimited ? 429 : 401, { error: req.authRateLimited ? '登录失败次数过多，请稍后重试' : '会话已过期，请重新登录' });
    if (!rateAllowed(req)) return json(res, 429, { error: '请求过于频繁' });
    if (['POST', 'PATCH', 'DELETE'].includes(req.method) && !isSafeOrigin(req)) return json(res, 403, { error: '拒绝跨站请求' });
    if (agentRequest) return proxyAgentHttp(req, res, url);
    const segments = url.pathname.split('/').filter(Boolean);

    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const token = parseCookies(req).pc_session;
      if (token) sessions.delete(sha256(token));
      res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
      audit.write({ action: 'logout', outcome: 'success', actor: username, source: sourceAddress(req) });
      return json(res, 200, { authenticated: false });
    }
    if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
      let status = null;
      try { status = await statusSnapshot(); } catch { status = null; }
      return json(res, 200, {
        conversations: store.list(), model: modelInfo(), models: await listModels(),
        projects: projects.list(), capabilities: capabilities(), status, active: [...activeRuns.keys()],
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      try { return json(res, 200, await statusSnapshot()); }
      catch (error) { return json(res, 503, { error: safeMessage(error) }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/projects') return json(res, 200, projects.list());
    if (req.method === 'POST' && url.pathname === '/api/projects') {
      if (!isSafeOrigin(req)) return json(res, 403, { error: '拒绝跨站请求' });
      try {
        const project = projects.create(await readBody(req, 4096));
        audit.write({ action: 'project.create', outcome: 'success', actor: username, source: sourceAddress(req), resource: project.id });
        return json(res, 201, project);
      } catch (error) { return json(res, 400, { error: safeMessage(error) }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/conversations') {
      if (!isSafeOrigin(req)) return json(res, 403, { error: '拒绝跨站请求' });
      let body = {};
      try { body = await readBody(req, 4096); } catch { /* defaults */ }
      const conversation = store.create({ mode: body.mode, model: body.model, projectId: body.projectId });
      audit.write({ action: 'conversation.create', outcome: 'success', actor: username, source: sourceAddress(req), resource: conversation.id });
      return json(res, 201, conversation);
    }
    if (segments[0] === 'api' && segments[1] === 'conversations' && segments[2]) {
      const conversation = store.get(segments[2]);
      if (!conversation) return json(res, 404, { error: '会话不存在' });
      if (req.method === 'GET' && segments.length === 3) {
        return json(res, 200, { ...conversation, stagedAttachments: attachments.list(conversation.id) });
      }
      if (req.method === 'PATCH' && segments.length === 3) {
        if (activeRuns.has(conversation.id)) return json(res, 409, { error: '任务运行中，不能切换模式' });
        let body;
        try { body = await readBody(req, 4096); } catch (error) { return json(res, 400, { error: error.message }); }
        if (body.mode && !MODES.has(body.mode)) return json(res, 400, { error: '模式无效' });
        if (body.projectId && !projects.get(body.projectId)) return json(res, 400, { error: '项目未登记' });
        const changedContext = (body.mode && body.mode !== conversation.mode) || (Object.hasOwn(body, 'projectId') && body.projectId !== conversation.projectId);
        const updated = store.updateSettings(conversation.id, { ...body, resetThread: changedContext });
        audit.write({ action: 'conversation.settings', outcome: 'success', actor: username, source: sourceAddress(req), resource: conversation.id });
        return json(res, 200, updated);
      }
      if (req.method === 'DELETE' && segments.length === 3) {
        if (!isSafeOrigin(req)) return json(res, 403, { error: '拒绝跨站请求' });
        if (activeRuns.has(conversation.id)) return json(res, 409, { error: '任务运行中，不能删除' });
        for (const item of attachments.list(conversation.id)) attachments.remove(item.id, conversation.id);
        store.remove(conversation.id);
        audit.write({ action: 'conversation.delete', outcome: 'success', actor: username, source: sourceAddress(req), resource: conversation.id });
        return json(res, 200, { deleted: true });
      }
      if (req.method === 'POST' && segments.length === 4 && segments[3] === 'attachments') {
        if (!isSafeOrigin(req)) return json(res, 403, { error: '拒绝跨站请求' });
        if (!rateAllowed(req, 'upload', 30, 15 * 60 * 1000)) return json(res, 429, { error: '上传过于频繁' });
        try {
          const item = await attachments.save(req, conversation.id, url.searchParams.get('name'), req.headers['content-type']);
          audit.write({ action: 'attachment.upload', outcome: 'success', actor: username, source: sourceAddress(req), resource: `${conversation.id}:${item.id}:${item.size}` });
          return json(res, 201, item);
        } catch (error) {
          audit.write({ action: 'attachment.upload', outcome: 'failure', actor: username, source: sourceAddress(req), resource: conversation.id });
          return json(res, 400, { error: safeMessage(error) });
        }
      }
      if (req.method === 'DELETE' && segments.length === 5 && segments[3] === 'attachments') {
        const removed = attachments.remove(segments[4], conversation.id);
        return removed ? json(res, 200, { deleted: true }) : json(res, 404, { error: '附件不存在' });
      }
      if (req.method === 'POST' && segments.length === 4 && segments[3] === 'messages') return handleMessage(req, res, conversation);
      if (req.method === 'POST' && segments.length === 4 && segments[3] === 'cancel') {
        if (!isSafeOrigin(req)) return json(res, 403, { error: '拒绝跨站请求' });
        const control = activeRuns.get(conversation.id);
        if (!control) return json(res, 409, { error: '没有正在运行的任务' });
        terminate(control);
        audit.write({ action: 'run.cancel', outcome: 'accepted', actor: username, source: sourceAddress(req), resource: conversation.id });
        return json(res, 202, { cancelled: true });
      }
    }
    return json(res, 404, { error: 'Not found' });
  });

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
    catch { return rejectUpgrade(socket, 400, 'Bad Request'); }
    if (!['/ws', '/shell'].includes(url.pathname)) return rejectUpgrade(socket, 404, 'Not Found');
    if (!isSafeOrigin(req)) return rejectUpgrade(socket, 403, 'Forbidden');
    if (!cookieSessionAuthenticated(req)) return rejectUpgrade(socket);
    if (!rateAllowed(req, 'agent-websocket', 30, 60_000)) return rejectUpgrade(socket, 429, 'Too Many Requests');
    proxyAgentUpgrade(req, socket, head);
  });

  return { server, store, projects, attachments, activeRuns, statusSnapshot };
}
