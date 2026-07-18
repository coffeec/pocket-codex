import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { createCodexWebApp, codexArgs } from './app.mjs';

const auth = `Basic ${Buffer.from('admin:test-password').toString('base64')}`;

test('mobile layout keeps the composer in the viewport and gives selectors a full row', () => {
  const css = fs.readFileSync(new URL('./public/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.app-shell\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/s);
  assert.match(css, /grid-template-rows:\s*58px auto auto minmax\(0, 1fr\) max-content;/);
  assert.match(css, /\.composer-wrap\s*\{\s*grid-row:\s*5;/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.mode-toolbar\s*\{[^}]*flex-wrap:\s*wrap;/);
  assert.match(css, /#modelControl,\s*#effortControl\s*\{[^}]*flex:\s*1 1 calc\(50% - 3px\);/s);
});

test('message submission locks synchronously before conversation setup', () => {
  const source = fs.readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  const sendStart = source.indexOf('async function sendMessage(text)');
  const sendEnd = source.indexOf('\nasync function stopRun', sendStart);
  assert.ok(sendStart >= 0 && sendEnd > sendStart);
  const sendBlock = source.slice(sendStart, sendEnd);
  assert.match(sendBlock, /state\.running \|\| state\.sendInFlight/);
  assert.match(sendBlock, /state\.sendInFlight = true;[\s\S]*await ensureConversation\(\)/);
  assert.match(sendBlock, /finally \{[\s\S]*state\.sendInFlight = false;/);
});

function pocketUrl(url) {
  const parsed = new URL(url);
  if (parsed.pathname === '/api' || parsed.pathname.startsWith('/api/')) {
    parsed.pathname = `/pocket-api${parsed.pathname.slice(4)}`;
  }
  return parsed.toString();
}

function request(url, options = {}) {
  return fetch(pocketUrl(url), {
    ...options,
    headers: { Authorization: auth, Origin: new URL(url).origin, ...options.headers },
  });
}

function websocketUpgrade(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let response = '';
    socket.setTimeout(3_000, () => socket.destroy(new Error('WebSocket upgrade timed out')));
    socket.on('error', reject);
    socket.on('connect', () => {
      const lines = [
        `GET ${pathname} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGVzdC13ZWJzb2NrZXQ=',
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        '',
        '',
      ];
      socket.write(lines.join('\r\n'));
    });
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
      if (response.includes('\r\n\r\n')) resolve({ response, socket });
    });
  });
}

test('codexArgs uses mode-specific sandboxes and an explicit thread ID', () => {
  assert.deepEqual(codexArgs({ threadId: 'thread-abc', mode: 'server' }), [
    '--sandbox', 'read-only', '--ask-for-approval', 'never',
    'exec', 'resume', '--json', '--skip-git-repo-check', 'thread-abc', '-',
  ]);
  assert.deepEqual(codexArgs({ threadId: null, mode: 'agent' }, { cwd: '/projects/ssd/demo' }), [
    '--sandbox', 'workspace-write', '--ask-for-approval', 'never',
    'exec', '--json', '--skip-git-repo-check', '-C', '/projects/ssd/demo', '-',
  ]);
});

test('mock API creates, sends and resumes a persisted conversation', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-web-api-'));
  const publicDir = path.join(directory, 'public');
  fs.mkdirSync(publicDir);
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>test</title>');
  const { server } = createCodexWebApp({
    dataDir: path.join(directory, 'data'),
    publicDir,
    password: 'test-password',
    username: 'admin',
    mockMode: true,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const unauthenticated = await fetch(pocketUrl(`${base}/api/bootstrap`));
  assert.equal(unauthenticated.status, 401);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failedLogin = await fetch(pocketUrl(`${base}/api/login`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base, 'X-Forwarded-For': '100.64.0.9' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    assert.equal(failedLogin.status, 401);
  }
  const limitedLogin = await fetch(pocketUrl(`${base}/api/login`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, 'X-Forwarded-For': '100.64.0.9' },
    body: JSON.stringify({ username: 'admin', password: 'wrong' }),
  });
  assert.equal(limitedLogin.status, 429);

  const createdResponse = await request(`${base}/api/conversations`, { method: 'POST' });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  const unsupportedUpload = await request(`${base}/api/conversations/${created.id}/attachments?name=unverified.pdf`, {
    method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.4'),
  });
  assert.equal(unsupportedUpload.status, 400);
  const oversizedUpload = await request(`${base}/api/conversations/${created.id}/attachments?name=oversized.txt`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: Buffer.alloc(20 * 1024 * 1024 + 1),
  });
  assert.equal(oversizedUpload.status, 400);
  assert.equal((await request(`${base}/api/bootstrap`)).status, 200);

  const firstResponse = await request(`${base}/api/conversations/${created.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '检查服务器状态' }),
  });
  assert.equal(firstResponse.status, 200);
  const firstStream = await firstResponse.text();
  assert.match(firstStream, /event: accepted/);
  assert.match(firstStream, /event: delta/);
  assert.match(firstStream, /event: done/);

  const conversationResponse = await request(`${base}/api/conversations/${created.id}`);
  const conversation = await conversationResponse.json();
  assert.equal(conversation.threadId, null);
  assert.equal(conversation.messages.length, 2);
  assert.equal(conversation.messages[1].status, 'completed');

  const secondResponse = await request(`${base}/api/conversations/${created.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '再检查一次日志' }),
  });
  await secondResponse.text();

  const resumedResponse = await request(`${base}/api/conversations/${created.id}`);
  const resumed = await resumedResponse.json();
  assert.equal(resumed.threadId, null);
  assert.equal(resumed.messages.length, 4);

  const cancellableResponse = await request(`${base}/api/conversations/${created.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '执行一个需要停止的检查' }),
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const cancelResponse = await request(`${base}/api/conversations/${created.id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(cancelResponse.status, 202);
  assert.match(await cancellableResponse.text(), /event: failure/);

  const cancelledResponse = await request(`${base}/api/conversations/${created.id}`);
  const cancelled = await cancelledResponse.json();
  assert.equal(cancelled.messages.at(-1).status, 'cancelled');
});

test('cookie sessions expire at the configured maximum age', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-session-'));
  const publicDir = path.join(directory, 'public');
  fs.mkdirSync(publicDir);
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>test</title>');
  const { server } = createCodexWebApp({
    dataDir: path.join(directory, 'data'), publicDir,
    password: 'test-password', username: 'admin', mockMode: true,
    sessionMaximum: 30, sessionIdle: 1_000,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(pocketUrl(`${base}/api/login`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ username: 'admin', password: 'test-password' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const accepted = await fetch(pocketUrl(`${base}/api/bootstrap`), { headers: { Cookie: cookie, Origin: base } });
  assert.equal(accepted.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 45));
  const expired = await fetch(pocketUrl(`${base}/api/bootstrap`), { headers: { Cookie: cookie, Origin: base } });
  assert.equal(expired.status, 401);
});

test('Agent proxy requires Pocket session and strips credentials', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-proxy-'));
  const publicDir = path.join(directory, 'public');
  fs.mkdirSync(publicDir);
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>test</title>');

  const received = [];
  const upgrades = [];
  const upstreamSockets = new Set();
  const upstream = http.createServer((req, res) => {
    received.push({ url: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'cloudcli=blocked' });
    res.end(JSON.stringify({ path: req.url }));
  });
  upstream.on('upgrade', (req, socket) => {
    upstreamSockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => upstreamSockets.delete(socket));
    upgrades.push({ url: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    setTimeout(() => {
      if (!socket.destroyed) socket.write(Buffer.from([0x81, 0x02, 0x4f, 0x4b]));
    }, 10);
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    for (const socket of upstreamSockets) socket.destroy();
    return new Promise((resolve) => upstream.close(resolve));
  });

  const { server } = createCodexWebApp({
    dataDir: path.join(directory, 'data'), publicDir,
    password: 'test-password', username: 'admin', mockMode: true,
    agentHost: '127.0.0.1', agentPort: upstream.address().port,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${base}/agent/`)).status, 401);
  const login = await fetch(`${base}/pocket-api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ username: 'admin', password: 'test-password' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(`${base}/agent/hello?value=1`, {
    headers: { Cookie: cookie, Authorization: 'Bearer must-not-forward', Origin: base },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), { path: '/hello?value=1' });
  assert.deepEqual(received, [{ url: '/hello?value=1', cookie: undefined, authorization: undefined }]);

  const deniedUpgrade = await websocketUpgrade(server.address().port, '/ws');
  assert.match(deniedUpgrade.response, /^HTTP\/1\.1 401/);
  deniedUpgrade.socket.destroy();
  const acceptedUpgrade = await websocketUpgrade(server.address().port, '/ws', {
    Cookie: cookie,
    Authorization: 'Bearer must-not-forward',
  });
  assert.match(acceptedUpgrade.response, /^HTTP\/1\.1 101/);
  acceptedUpgrade.socket.destroy();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.deepEqual(upgrades, [{ url: '/ws', cookie: undefined, authorization: undefined }]);
});

test('GPT mode forwards true Sub2API response deltas', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-gpt-'));
  const publicDir = path.join(directory, 'public');
  const codexDir = path.join(directory, 'codex');
  fs.mkdirSync(publicDir);
  fs.mkdirSync(codexDir);
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>test</title>');
  fs.writeFileSync(path.join(codexDir, 'config.toml'), 'model_provider = "sub2api_local"\nmodel = "gpt-test"\n');
  fs.writeFileSync(path.join(codexDir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'test-key' }));
  const upstreamRequests = [];
  const upstream = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-key');
    let body = '';
    for await (const chunk of req) body += chunk;
    upstreamRequests.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"type":"response.output_text.delta","delta":"流式"}\n\n');
    res.write('data: {"type":"response.output_text.delta","delta":"成功"}\n\n');
    res.end('data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":2}}}\n\n');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const { server } = createCodexWebApp({
    dataDir: path.join(directory, 'data'), publicDir,
    password: 'test-password', username: 'admin',
    configPath: path.join(codexDir, 'config.toml'), authPath: path.join(codexDir, 'auth.json'),
    sub2apiBaseUrl: `http://127.0.0.1:${upstream.address().port}`,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const created = await (await request(`${base}/api/conversations`, { method: 'POST', body: '{}' })).json();
  const response = await request(`${base}/api/conversations/${created.id}/messages`, {
    method: 'POST', body: JSON.stringify({ text: '测试' }),
  });
  const stream = await response.text();
  assert.match(stream, /event: delta/);
  assert.match(stream, /流式/);
  assert.match(stream, /成功/);
  const conversation = await (await request(`${base}/api/conversations/${created.id}`)).json();
  assert.equal(conversation.messages.at(-1).text, '流式成功');
  assert.equal(upstreamRequests[0].reasoning.effort, 'high');
});
