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

const execFileAsync = promisify(execFile);

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
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Cache-Control', 'no-store');
}

function json(res, status, value) {
  securityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function sse(res, event, value) {
  if (!res.destroyed && !res.writableEnded) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
  }
}

async function readBody(req, maximum = 16_384) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximum) throw new Error('请求内容过长');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new Error('请求格式无效');
  }
}

export function codexArgs(conversation) {
  const runtime = ['--sandbox', 'danger-full-access', '--ask-for-approval', 'never'];
  if (conversation.threadId) {
    return [...runtime, 'exec', 'resume', '--json', '--skip-git-repo-check', conversation.threadId, '-'];
  }
  return [...runtime, 'exec', '--json', '--skip-git-repo-check', '-C', '/workspace', '-'];
}

function detailUpsert(details, incoming) {
  const index = details.findIndex((item) => item.id === incoming.id);
  if (index === -1) details.push(incoming);
  else details[index] = incoming;
}

function terminate(control) {
  if (control.finished || control.cancelled) return;
  control.cancelled = true;
  if (!control.child || control.child.exitCode !== null) return;
  control.child.kill('SIGTERM');
  control.killTimer = setTimeout(() => {
    if (control.child?.exitCode === null) control.child.kill('SIGKILL');
  }, 5_000);
  control.killTimer.unref?.();
}

export function createCodexWebApp(options = {}) {
  const publicDir = path.resolve(options.publicDir || '/app/web/public');
  const dataDir = path.resolve(options.dataDir || '/home/node/.codex-web');
  const password = String(options.password || '');
  const username = options.username || 'admin';
  const mockMode = options.mockMode === true;
  const configPath = options.configPath || '/home/node/.codex/config.toml';
  const hostctlPath = options.hostctlPath || '/workspace/hostctl';
  const sub2apiHealthUrl = options.sub2apiHealthUrl || 'http://sub2api:8080/health';
  const codexCommand = options.codexCommand || 'codex';
  const store = new ConversationStore(path.join(dataDir, 'conversations.json'));
  const activeRuns = new Map();
  const rateBuckets = new Map();

  if (!password) throw new Error('Web password cannot be empty');

  function authorized(req) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Basic ')) return false;
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const split = decoded.indexOf(':');
      return split > -1
        && secureEqual(decoded.slice(0, split), username)
        && secureEqual(decoded.slice(split + 1), password);
    } catch {
      return false;
    }
  }

  function rateAllowed(req, scope = 'general', limit = 90) {
    const key = `${req.socket.remoteAddress || 'unknown'}:${scope}`;
    const now = Date.now();
    const recent = (rateBuckets.get(key) || []).filter((time) => now - time < 60_000);
    recent.push(now);
    rateBuckets.set(key, recent);
    return recent.length <= limit;
  }

  function modelInfo() {
    try {
      const config = fs.readFileSync(configPath, 'utf8');
      return {
        model: /^model\s*=\s*"([^"]+)"/m.exec(config)?.[1] || 'unknown',
        provider: /^model_provider\s*=\s*"([^"]+)"/m.exec(config)?.[1] || 'unknown',
      };
    } catch {
      return mockMode
        ? { model: 'gpt-5.6-sol', provider: 'sub2api_local' }
        : { model: 'unknown', provider: 'unknown' };
    }
  }

  async function command(file, args, timeout = 10_000) {
    return execFileAsync(file, args, { timeout, maxBuffer: 512 * 1024, encoding: 'utf8' });
  }

  async function statusSnapshot() {
    if (mockMode) {
      return {
        temperature: 58,
        load: [0.72, 0.84, 0.91],
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
      fetch(sub2apiHealthUrl, { signal: AbortSignal.timeout(5_000) })
        .then((response) => response.ok)
        .catch(() => false),
    ]);
    return parseHostStatus(hostResult, sub2apiUp, batteryResult);
  }

  async function mockRun(conversation, prompt, res, control) {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    if (!conversation.threadId) {
      store.updateThread(conversation.id, `mock-thread-${conversation.id}`);
      sse(res, 'thread', { threadId: store.get(conversation.id).threadId });
    }
    const detail = {
      id: 'mock_status',
      type: 'command_execution',
      status: 'completed',
      title: '/workspace/hostctl status',
      output: 'Palworld: active\nSakuraFrp: active\n可用内存: 11GiB',
      exitCode: 0,
    };
    await wait(250);
    if (control.cancelled) throw new Error('已停止');
    sse(res, 'detail', detail);
    await wait(350);
    if (control.cancelled) throw new Error('已停止');
    const text = prompt.includes('长回答')
      ? '检查结果：\n\n- **CPU 温度**：封装约 67°C，各核心 60-67°C，当前没有明显过热迹象。\n- **CPU 频率**：8 线程平均 2050 MHz，需要结合持续采样判断是否降频。\n- **内存**：总计 15 GiB，可用 11 GiB；`free` 较低主要是缓存占用，并非内存不足。\n- **系统盘 `/`**：总计 106 GiB，剩余 83 GiB，空间充足。\n\n需要继续观察风扇转速和长时间负载下的温度变化。'
      : prompt.includes('日志')
        ? '最近的服务日志没有出现崩溃或内存不足。当前可用内存约 11 GiB，Palworld 与 SakuraFrp 都在运行。'
        : '服务器当前运行正常。CPU 温度处于安全范围，内存和系统盘余量充足，Palworld、SakuraFrp 与 Sub2API 均在线。';
    sse(res, 'answer', { text });
    return { text, details: [detail], usage: { input_tokens: 1840, output_tokens: 126 } };
  }

  function realRun(conversation, prompt, res, control) {
    return new Promise((resolve, reject) => {
      const child = spawn(codexCommand, codexArgs(conversation), {
        cwd: '/workspace',
        env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      control.child = child;
      child.stdin.end(prompt);

      const details = [];
      let finalText = '';
      let usage = null;
      let completed = false;
      let failureMessage = '';
      let stderr = '';
      const lines = readline.createInterface({ input: child.stdout });

      lines.on('line', (line) => {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
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

      child.stderr.on('data', (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-12_000);
      });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        lines.close();
        if (control.cancelled) return reject(new Error('已停止'));
        if (code === 0 && completed && finalText) return resolve({ text: finalText, details, usage });
        const message = failureMessage || (signal
          ? `Codex 已被信号 ${signal} 终止`
          : stderr.trim().split('\n').slice(-3).join('\n') || `Codex 退出，代码 ${code}`);
        reject(new Error(message));
      });
    });
  }

  async function handleMessage(req, res, conversation) {
    if (activeRuns.size > 0) return json(res, 409, { error: '已有任务正在运行，请等待或停止后再试' });
    if (!isSafeOrigin(req)) return json(res, 403, { error: '拒绝跨站请求' });
    if (!rateAllowed(req, 'message', 20)) return json(res, 429, { error: '消息发送过于频繁' });

    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    const prompt = String(body.text || '').trim();
    if (!prompt || prompt.length > 8_000) {
      return json(res, 400, { error: '消息不能为空且不能超过 8000 字符' });
    }

    const userMessage = store.addMessage(conversation.id, {
      role: 'user',
      text: prompt,
      status: 'completed',
    });
    securityHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const control = { child: null, cancelled: false, finished: false, killTimer: null };
    activeRuns.set(conversation.id, control);
    sse(res, 'accepted', { message: userMessage, conversation: store.get(conversation.id) });

    const disconnect = () => {
      if (!control.finished) terminate(control);
    };
    req.once('aborted', disconnect);
    res.once('close', disconnect);
    const keepalive = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(': keepalive\n\n');
    }, 15_000);
    keepalive.unref?.();

    try {
      const result = mockMode
        ? await mockRun(conversation, prompt, res, control)
        : await realRun(conversation, prompt, res, control);
      const assistantMessage = store.addMessage(conversation.id, {
        role: 'assistant',
        text: result.text,
        details: result.details,
        usage: result.usage,
        status: 'completed',
      });
      sse(res, 'done', { message: assistantMessage, usage: result.usage });
    } catch (error) {
      const message = error.message || '执行失败';
      const assistantMessage = store.addMessage(conversation.id, {
        role: 'assistant',
        text: message,
        status: control.cancelled ? 'cancelled' : 'failed',
      });
      sse(res, 'failure', { message, item: assistantMessage });
    } finally {
      control.finished = true;
      clearInterval(keepalive);
      clearTimeout(control.killTimer);
      activeRuns.delete(conversation.id);
      if (!res.writableEnded) res.end();
    }
  }

  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
  };

  function staticFile(res, pathname) {
    const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
    const resolved = path.resolve(publicDir, requested);
    if (!resolved.startsWith(`${publicDir}${path.sep}`) && resolved !== path.join(publicDir, 'index.html')) {
      return json(res, 404, { error: 'Not found' });
    }
    try {
      const body = fs.readFileSync(resolved);
      securityHeaders(res);
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(200, { 'Content-Type': mime[path.extname(resolved)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      json(res, 404, { error: 'Not found' });
    }
  }

  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') return json(res, 200, { status: 'ok' });
    if (!authorized(req)) {
      securityHeaders(res);
      res.setHeader('WWW-Authenticate', 'Basic realm="PocketCodex"');
      res.writeHead(401);
      return res.end('Authentication required');
    }
    if (!rateAllowed(req)) return json(res, 429, { error: '请求过于频繁' });

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const segments = url.pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
      let status = null;
      try { status = await statusSnapshot(); } catch { status = null; }
      return json(res, 200, {
        conversations: store.list(),
        model: modelInfo(),
        status,
        active: [...activeRuns.keys()],
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      try { return json(res, 200, await statusSnapshot()); }
      catch (error) { return json(res, 503, { error: error.message || '状态查询失败' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/conversations') {
      if (!isSafeOrigin(req)) return json(res, 403, { error: '拒绝跨站请求' });
      return json(res, 201, store.create());
    }
    if (segments[0] === 'api' && segments[1] === 'conversations' && segments[2]) {
      const conversation = store.get(segments[2]);
      if (!conversation) return json(res, 404, { error: '会话不存在' });
      if (req.method === 'GET' && segments.length === 3) return json(res, 200, conversation);
      if (req.method === 'DELETE' && segments.length === 3) {
        if (!isSafeOrigin(req)) return json(res, 403, { error: '拒绝跨站请求' });
        if (activeRuns.has(conversation.id)) return json(res, 409, { error: '任务运行中，不能删除' });
        store.remove(conversation.id);
        return json(res, 200, { deleted: true });
      }
      if (req.method === 'POST' && segments.length === 4 && segments[3] === 'messages') {
        return handleMessage(req, res, conversation);
      }
      if (req.method === 'POST' && segments.length === 4 && segments[3] === 'cancel') {
        if (!isSafeOrigin(req)) return json(res, 403, { error: '拒绝跨站请求' });
        const control = activeRuns.get(conversation.id);
        if (!control) return json(res, 409, { error: '没有正在运行的任务' });
        terminate(control);
        return json(res, 202, { cancelled: true });
      }
    }
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return staticFile(res, url.pathname);
    return json(res, 404, { error: 'Not found' });
  });

  return { server, store, activeRuns, statusSnapshot };
}
