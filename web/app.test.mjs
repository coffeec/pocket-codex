import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createCodexWebApp } from './app.mjs';

const basicAuth = `Basic ${Buffer.from('admin:test-password').toString('base64')}`;

test('production UI is GPT-only, fixed dark and mobile-safe', () => {
  const html = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('./public/app.css', import.meta.url), 'utf8');
  const source = fs.readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, />\s*(?:Agent|服务器模式|TTYD|项目)\s*</i);
  assert.doesNotMatch(source, /\/agent\/|projectSelect|modeSwitch|densityToggle/);
  assert.match(html, /id="statusStrip"/);
  assert.match(html, /id="modelSelect"/);
  assert.match(html, /id="effortSelect"/);
  assert.match(html, /capture="environment"/);
  assert.match(css, /color-scheme:\s*dark/);
  assert.match(css, /--content-width:\s*820px/);
  assert.match(css, /grid-template-rows:\s*56px 42px minmax\(0, 1fr\) max-content/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*height:\s*100dvh/);
  assert.match(css, /\.message\.is-user \.message-body[\s\S]*max-width:\s*78%/);
});

test('message submission locks before conversation setup and preserves ephemeral confirmation tokens', () => {
  const source = fs.readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  const sendStart = source.indexOf('async function sendMessage(text)');
  const sendEnd = source.indexOf('\nasync function stopRun', sendStart);
  assert.ok(sendStart >= 0 && sendEnd > sendStart);
  const sendBlock = source.slice(sendStart, sendEnd);
  assert.match(sendBlock, /state\.running \|\| state\.sendInFlight/);
  assert.match(sendBlock, /state\.sendInFlight = true;[\s\S]*await ensureConversation\(\)/);
  assert.match(sendBlock, /finally \{[\s\S]*state\.sendInFlight = false;/);
  assert.match(source, /createConversation\(\{ fromSend: true \}\)/);
  assert.match(source, /state\.sendInFlight && options\.fromSend !== true/);
  assert.match(source, /ephemeral\.has\(detail\.id\)[\s\S]*detail\.confirmationToken/);
  assert.match(source, /document\.hidden[\s\S]*scheduleStatusPoll/);
});

function pocketUrl(url) {
  const parsed = new URL(url);
  if (parsed.pathname === '/api' || parsed.pathname.startsWith('/api/')) {
    parsed.pathname = `/pocket-api${parsed.pathname.slice(4)}`;
  }
  return parsed.toString();
}

function basicRequest(url, options = {}) {
  return fetch(pocketUrl(url), {
    ...options,
    headers: { Authorization: basicAuth, Origin: new URL(url).origin, ...options.headers },
  });
}

async function login(base) {
  const response = await fetch(`${base}/pocket-api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ username: 'admin', password: 'test-password' }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

function sessionRequest(base, cookie, pathname, options = {}) {
  return fetch(`${base}${pathname}`, {
    ...options,
    headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', ...options.headers },
  });
}

async function startApp(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-app-'));
  const publicDir = path.join(directory, 'public');
  fs.mkdirSync(publicDir);
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>test</title>');
  const app = createCodexWebApp({
    dataDir: path.join(directory, 'data'), publicDir,
    password: 'test-password', username: 'admin', mockMode: true,
    ...options,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.server.close(resolve)));
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}`, directory };
}

test('mock API enforces login limits and persists GPT conversations', async (t) => {
  const { base } = await startApp(t);
  const session = await (await fetch(`${base}/pocket-api/session`)).json();
  assert.equal(session.authenticated, false);
  assert.equal((await fetch(`${base}/pocket-api/bootstrap`)).status, 401);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${base}/pocket-api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base, 'X-Forwarded-For': '100.64.0.9' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    assert.equal(response.status, 401);
  }
  const limited = await fetch(`${base}/pocket-api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, 'X-Forwarded-For': '100.64.0.9' },
    body: JSON.stringify({ username: 'admin', password: 'wrong' }),
  });
  assert.equal(limited.status, 429);

  const created = await (await basicRequest(`${base}/api/conversations`, { method: 'POST', body: '{}' })).json();
  assert.equal(created.mode, 'gpt');
  assert.equal(created.reasoningEffort, 'high');

  const first = await basicRequest(`${base}/api/conversations/${created.id}/messages`, {
    method: 'POST', body: JSON.stringify({ text: '检查服务器状态' }),
  });
  const stream = await first.text();
  assert.match(stream, /event: accepted/);
  assert.match(stream, /event: delta/);
  assert.match(stream, /event: done/);

  const conversation = await (await basicRequest(`${base}/api/conversations/${created.id}`)).json();
  assert.equal(conversation.messages.length, 2);
  assert.equal(conversation.messages[1].status, 'completed');

  const renamed = await basicRequest(`${base}/api/conversations/${created.id}`, {
    method: 'PATCH', body: JSON.stringify({ title: '服务器巡检', archived: true }),
  });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).archived, true);
  assert.equal((await basicRequest(`${base}/api/conversations`)).status, 200);
  const visible = await (await basicRequest(`${base}/api/conversations`)).json();
  assert.equal(visible.length, 0);
  const archived = await (await basicRequest(`${base}/api/conversations?archived=1`)).json();
  assert.equal(archived[0].title, '服务器巡检');

  assert.equal((await basicRequest(`${base}/api/conversations/${created.id}`, { method: 'DELETE' })).status, 409);
  assert.equal((await basicRequest(`${base}/api/conversations/${created.id}?confirm=true`, { method: 'DELETE' })).status, 200);
});

test('uploads reject unverified types and enforce the per-file limit', async (t) => {
  const { base } = await startApp(t, { uploadLimits: { maximumFile: 16, maximumConversation: 24 } });
  const created = await (await basicRequest(`${base}/api/conversations`, { method: 'POST', body: '{}' })).json();
  const unsupported = await basicRequest(`${base}/api/conversations/${created.id}/attachments?name=unverified.pdf`, {
    method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.4'),
  });
  assert.equal(unsupported.status, 400);
  const oversized = await basicRequest(`${base}/api/conversations/${created.id}/attachments?name=oversized.txt`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: Buffer.alloc(17),
  });
  assert.equal(oversized.status, 400);
});

test('cookie sessions expire at the configured maximum age', async (t) => {
  const { base } = await startApp(t, { sessionMaximum: 30, sessionIdle: 1_000 });
  const cookie = await login(base);
  assert.equal((await sessionRequest(base, cookie, '/pocket-api/bootstrap')).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal((await sessionRequest(base, cookie, '/pocket-api/bootstrap')).status, 401);
});

test('GPT forwards true Sub2API deltas with configured model and effort', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-provider-'));
  const codexDir = path.join(directory, 'codex');
  fs.mkdirSync(codexDir);
  fs.writeFileSync(path.join(codexDir, 'config.toml'), 'model_provider = "sub2api_local"\nmodel = "gpt-test"\n');
  fs.writeFileSync(path.join(codexDir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'test-key' }));
  const requests = [];
  const upstream = http.createServer(async (req, res) => {
    if (req.url === '/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'gpt-test' }, { id: 'gpt-next' }] }));
    }
    assert.equal(req.headers.authorization, 'Bearer test-key');
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"type":"response.output_text.delta","delta":"流式"}\n\n');
    res.write('data: {"type":"response.output_text.delta","delta":"成功"}\n\n');
    res.end('data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":2}}}\n\n');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const { base } = await startApp(t, {
    mockMode: false,
    configPath: path.join(codexDir, 'config.toml'), authPath: path.join(codexDir, 'auth.json'),
    sub2apiBaseUrl: `http://127.0.0.1:${upstream.address().port}`,
  });
  const bootstrap = await (await basicRequest(`${base}/api/bootstrap`)).json();
  assert.deepEqual(bootstrap.models, ['gpt-test', 'gpt-next']);
  assert.equal(bootstrap.modelCatalog.source, 'sub2api');
  const created = await (await basicRequest(`${base}/api/conversations`, {
    method: 'POST', body: JSON.stringify({ model: 'gpt-next', reasoningEffort: 'xhigh' }),
  })).json();
  const response = await basicRequest(`${base}/api/conversations/${created.id}/messages`, {
    method: 'POST', body: JSON.stringify({ text: '测试' }),
  });
  const stream = await response.text();
  assert.match(stream, /流式/);
  assert.match(stream, /成功/);
  assert.equal(requests[0].model, 'gpt-next');
  assert.equal(requests[0].reasoning.effort, 'xhigh');
  assert.ok(requests[0].tools.some((item) => item.name === 'system_status' && item.strict === true));
});

test('mutating function calls require a same-session one-time confirmation', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-tools-'));
  const codexDir = path.join(directory, 'codex');
  fs.mkdirSync(codexDir);
  fs.writeFileSync(path.join(codexDir, 'config.toml'), 'model_provider = "sub2api_local"\nmodel = "gpt-test"\n');
  fs.writeFileSync(path.join(codexDir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'test-key' }));
  let responseRound = 0;
  const upstream = http.createServer(async (req, res) => {
    if (req.url === '/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'gpt-test' }] }));
    }
    for await (const chunk of req) void chunk;
    responseRound += 1;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (responseRound === 1) {
      return res.end('data: {"type":"response.completed","response":{"output":[{"type":"function_call","call_id":"call-1","name":"restart_palworld","arguments":"{}"}]}}\n\n');
    }
    res.write('data: {"type":"response.output_text.delta","delta":"等待你的确认。"}\n\n');
    return res.end('data: {"type":"response.completed","response":{"output":[]}}\n\n');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const actions = [];
  const { base } = await startApp(t, {
    mockMode: false,
    configPath: path.join(codexDir, 'config.toml'), authPath: path.join(codexDir, 'auth.json'),
    sub2apiBaseUrl: `http://127.0.0.1:${upstream.address().port}`,
    hostctlRunner: async (action) => { actions.push(action); return `${action}: ok`; },
  });
  const cookie = await login(base);
  const created = await (await sessionRequest(base, cookie, '/pocket-api/conversations', {
    method: 'POST', body: '{}',
  })).json();
  const response = await sessionRequest(base, cookie, `/pocket-api/conversations/${created.id}/messages`, {
    method: 'POST', body: JSON.stringify({ text: '重启帕鲁' }),
  });
  const stream = await response.text();
  const detailLine = stream.split('\n').find((line) => line.startsWith('data: ') && line.includes('confirmationToken'));
  assert.ok(detailLine);
  const detail = JSON.parse(detailLine.slice(6));
  assert.equal(actions.includes('restart-palworld'), false);

  const otherCookie = await login(base);
  const denied = await sessionRequest(base, otherCookie, '/pocket-api/confirmations/execute', {
    method: 'POST', body: JSON.stringify({ token: detail.confirmationToken, conversationId: created.id }),
  });
  assert.equal(denied.status, 409);
  assert.equal(actions.includes('restart-palworld'), false);

  const executed = await sessionRequest(base, cookie, '/pocket-api/confirmations/execute', {
    method: 'POST', body: JSON.stringify({ token: detail.confirmationToken, conversationId: created.id }),
  });
  assert.equal(executed.status, 200);
  assert.equal(actions.filter((action) => action === 'restart-palworld').length, 1);
  const replay = await sessionRequest(base, cookie, '/pocket-api/confirmations/execute', {
    method: 'POST', body: JSON.stringify({ token: detail.confirmationToken, conversationId: created.id }),
  });
  assert.equal(replay.status, 409);
  const conversation = await (await sessionRequest(base, cookie, `/pocket-api/conversations/${created.id}`)).json();
  assert.equal(conversation.messages.at(-1).details[0].status, 'completed');
});

test('read-only function calls execute through the strict hostctl map', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-read-tool-'));
  const codexDir = path.join(directory, 'codex');
  fs.mkdirSync(codexDir);
  fs.writeFileSync(path.join(codexDir, 'config.toml'), 'model_provider = "sub2api_local"\nmodel = "gpt-test"\n');
  fs.writeFileSync(path.join(codexDir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'test-key' }));
  let round = 0;
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.push(JSON.parse(body));
    round += 1;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (round === 1) {
      return res.end('data: {"type":"response.completed","response":{"output":[{"type":"function_call","call_id":"call-top","name":"top_processes","arguments":"{\\"limit\\":5}"}]}}\n\n');
    }
    res.write('data: {"type":"response.output_text.delta","delta":"CPU 占用正常。"}\n\n');
    return res.end('data: {"type":"response.completed","response":{"output":[]}}\n\n');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const actions = [];
  const { base } = await startApp(t, {
    mockMode: false,
    configPath: path.join(codexDir, 'config.toml'), authPath: path.join(codexDir, 'auth.json'),
    sub2apiBaseUrl: `http://127.0.0.1:${upstream.address().port}`,
    hostctlRunner: async (action) => { actions.push(action); return 'PID CMD CPU\n1 node 1.0\n2 pal 0.5\n'; },
  });
  const created = await (await basicRequest(`${base}/api/conversations`, { method: 'POST', body: '{}' })).json();
  const response = await basicRequest(`${base}/api/conversations/${created.id}/messages`, {
    method: 'POST', body: JSON.stringify({ text: '检查进程' }),
  });
  const stream = await response.text();
  assert.match(stream, /server_tool/);
  assert.match(stream, /CPU 占用正常/);
  assert.deepEqual(actions, ['top']);
  assert.equal(received[1].input.at(-1).type, 'function_call_output');
});
