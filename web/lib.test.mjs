import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConversationStore, conversationTitle, parseBatteryStatus, parseHostStatus } from './lib.mjs';

test('ConversationStore persists GPT settings, titles and details', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-store-'));
  const file = path.join(directory, 'conversations.json');
  const store = new ConversationStore(file);
  const conversation = store.create({ model: 'gpt-5.6-sol' });
  store.addMessage(conversation.id, { role: 'user', text: '检查服务器当前状态', status: 'completed' });
  store.addMessage(conversation.id, {
    role: 'assistant', text: '等待确认', status: 'completed',
    details: [{ id: 'confirm-1', type: 'confirmation', status: 'pending' }],
  });
  store.updateSettings(conversation.id, { reasoningEffort: 'xhigh', title: '服务器巡检' });
  store.updateDetail(conversation.id, 'confirm-1', { status: 'completed', output: 'ok' });

  const reloaded = new ConversationStore(file);
  assert.equal(reloaded.get(conversation.id).title, '服务器巡检');
  assert.equal(reloaded.get(conversation.id).reasoningEffort, 'xhigh');
  assert.equal(reloaded.get(conversation.id).messages[1].details[0].status, 'completed');
  assert.equal(reloaded.list()[0].messageCount, 2);
});

test('legacy Agent and server conversations are archived without deleting content', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-migrate-'));
  const file = path.join(directory, 'conversations.json');
  const original = {
    version: 1,
    conversations: [{
      id: 'legacy-agent', title: '旧 Agent', mode: 'agent', threadId: 'thread-123',
      createdAt: '2026-07-17T00:00:00.000Z', updatedAt: '2026-07-17T00:00:00.000Z',
      messages: [{ id: 'message-1', role: 'user', text: '保留我', createdAt: '2026-07-17T00:00:00.000Z' }],
    }],
  };
  fs.writeFileSync(file, JSON.stringify(original));
  const store = new ConversationStore(file);
  assert.equal(store.list().length, 0);
  const migrated = store.get('legacy-agent');
  assert.equal(migrated.mode, 'gpt');
  assert.equal(migrated.legacyMode, 'agent');
  assert.equal(migrated.archived, true);
  assert.equal(migrated.threadId, 'thread-123');
  assert.equal(migrated.messages[0].text, '保留我');
  store.archive(migrated.id, false);
  assert.equal(store.list().length, 1);
});

test('conversation model IDs are bounded and normalized', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-model-'));
  const store = new ConversationStore(path.join(directory, 'conversations.json'));
  assert.equal(store.create({ model: 'gpt-5.6-sol' }).model, 'gpt-5.6-sol');
  assert.equal(store.create({ model: 'bad model / path' }).model, null);
});

test('conversationTitle normalizes whitespace and truncates long text', () => {
  assert.equal(conversationTitle('  查看\n 帕鲁状态  '), '查看 帕鲁状态');
  assert.equal(conversationTitle('a'.repeat(30)), `${'a'.repeat(26)}...`);
});

test('parseHostStatus extracts temperature, load, memory, disk, services and battery', () => {
  const raw = ` 04:20:00 up 2 days, load average: 0.62, 0.80, 1.10
palworld: active
sakurafrp-palworld: active
Mem:            15Gi       3.6Gi       1.0Gi       120Mi        10Gi        11Gi
/dev/nvme0n1p2  106G   18G   83G  18% /
Package id 0:  +47.0 C  (high = +100.0 C, crit = +100.0 C)`;
  const result = parseHostStatus(raw, true, 'status: Charging\ncapacity: 82\n');
  assert.equal(result.temperature, 47);
  assert.deepEqual(result.load, [0.62, 0.8, 1.1]);
  assert.deepEqual(result.memory, { total: '15Gi', used: '3.6Gi', available: '11Gi' });
  assert.deepEqual(result.disk, { size: '106G', used: '18G', available: '83G', percent: '18%' });
  assert.deepEqual(result.battery, { capacity: 82, state: 'Charging' });
  assert.deepEqual(result.services, { palworld: 'active', frp: 'active', sub2api: 'active' });
});

test('parseBatteryStatus handles a missing battery', () => {
  assert.equal(parseBatteryStatus('battery not found'), null);
});
