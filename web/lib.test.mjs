import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ConversationStore,
  conversationTitle,
  normalizeCodexItem,
  parseBatteryStatus,
  parseHostStatus,
} from './lib.mjs';

test('ConversationStore persists messages and thread metadata', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-web-store-'));
  const file = path.join(directory, 'conversations.json');
  const store = new ConversationStore(file);
  const conversation = store.create();
  store.addMessage(conversation.id, { role: 'user', text: '检查服务器当前状态', status: 'completed' });
  store.updateThread(conversation.id, 'thread-123');

  const reloaded = new ConversationStore(file);
  assert.equal(reloaded.get(conversation.id).title, '检查服务器当前状态');
  assert.equal(reloaded.get(conversation.id).threadId, 'thread-123');
  assert.equal(reloaded.list()[0].messageCount, 1);
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
Package id 0:  +47.0°C  (high = +100.0°C, crit = +100.0°C)`;
  const battery = 'status: Charging\ncapacity: 82\n';
  const result = parseHostStatus(raw, true, battery);

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

test('normalizeCodexItem preserves command progress details', () => {
  assert.deepEqual(normalizeCodexItem({
    id: 'item-1',
    type: 'command_execution',
    status: 'completed',
    command: '/workspace/hostctl status',
    aggregated_output: 'palworld: active',
    exit_code: 0,
  }), {
    id: 'item-1',
    type: 'command_execution',
    status: 'completed',
    title: '/workspace/hostctl status',
    output: 'palworld: active',
    exitCode: 0,
  });
});
