import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeMutatingTool,
  executeReadTool,
  MUTATING_TOOLS,
  redactToolOutput,
  TOOL_DEFINITIONS,
  validateToolArguments,
} from './tools.mjs';

test('server tools expose only strict predefined schemas', () => {
  assert.equal(TOOL_DEFINITIONS.length, 15);
  assert.ok(TOOL_DEFINITIONS.every((item) => item.type === 'function' && item.strict === true));
  assert.deepEqual([...MUTATING_TOOLS], [
    'palworld_backup', 'broadcast', 'restart_palworld', 'restart_frp', 'restart_pocket',
  ]);
});

test('tool validation rejects extra keys, invalid enums and control characters', () => {
  assert.deepEqual(validateToolArguments('top_processes', { limit: 5 }), { limit: 5 });
  assert.deepEqual(validateToolArguments('disk_usage', { scope: 'docker' }), { scope: 'docker' });
  assert.throws(() => validateToolArguments('top_processes', { limit: 20 }), /无效/);
  assert.throws(() => validateToolArguments('system_status', { shell: 'id' }), /无效/);
  assert.throws(() => validateToolArguments('unknown', {}), /未知/);
  assert.equal(validateToolArguments('broadcast', { message: '  hello\nworld  ' }).message, 'hello world');
});

test('tool output redaction bounds lines and removes credentials', () => {
  const output = redactToolOutput('Authorization: Bearer abc\napi_token=secret\npassword: hunter2\n{"api_key":"json-secret"}', 'abc');
  assert.doesNotMatch(output, /abc|secret|hunter2|json-secret/);
  assert.match(output, /\[REDACTED\]/);
});

test('read and mutation tools map only to fixed hostctl actions', async () => {
  const calls = [];
  const context = {
    hostctl: async (action, args = []) => { calls.push([action, args]); return action === 'players' ? '{"available":false}' : 'ok'; },
    statusSnapshot: async () => ({ ok: true }),
    sub2apiStatus: async () => ({ available: true }),
  };
  assert.deepEqual(await executeReadTool('players', {}, context), { available: false });
  assert.deepEqual(await executeMutatingTool('restart_frp', {}, context), { output: 'ok' });
  assert.deepEqual(calls, [['players', []], ['restart-frp', []]]);
  await assert.rejects(() => executeMutatingTool('system_status', {}, context), /不是修改工具/);
});
