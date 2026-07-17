import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCodexWebApp, codexArgs } from './app.mjs';

const auth = `Basic ${Buffer.from('admin:test-password').toString('base64')}`;

function request(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { Authorization: auth, Origin: new URL(url).origin, ...options.headers },
  });
}

test('codexArgs uses an explicit thread ID when resuming', () => {
  assert.deepEqual(codexArgs({ threadId: 'thread-abc' }), [
    '--sandbox', 'danger-full-access', '--ask-for-approval', 'never',
    'exec', 'resume', '--json', '--skip-git-repo-check', 'thread-abc', '-',
  ]);
  assert.deepEqual(codexArgs({ threadId: null }), [
    '--sandbox', 'danger-full-access', '--ask-for-approval', 'never',
    'exec', '--json', '--skip-git-repo-check', '-C', '/workspace', '-',
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

  const unauthenticated = await fetch(`${base}/api/bootstrap`);
  assert.equal(unauthenticated.status, 401);

  const createdResponse = await request(`${base}/api/conversations`, { method: 'POST' });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  const firstResponse = await request(`${base}/api/conversations/${created.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '检查服务器状态' }),
  });
  assert.equal(firstResponse.status, 200);
  const firstStream = await firstResponse.text();
  assert.match(firstStream, /event: accepted/);
  assert.match(firstStream, /event: detail/);
  assert.match(firstStream, /event: answer/);
  assert.match(firstStream, /event: done/);

  const conversationResponse = await request(`${base}/api/conversations/${created.id}`);
  const conversation = await conversationResponse.json();
  assert.equal(conversation.threadId, `mock-thread-${created.id}`);
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
  assert.equal(resumed.threadId, conversation.threadId);
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
