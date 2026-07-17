import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { AttachmentStore, ProjectStore, safeName, safeSlug } from './storage.mjs';

test('ProjectStore creates projects only below configured roots', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-projects-'));
  const ssd = path.join(directory, 'ssd');
  const disk = path.join(directory, 'disk');
  fs.mkdirSync(ssd);
  fs.mkdirSync(disk);
  const projects = new ProjectStore(path.join(directory, 'projects.json'), { ssd, disk });
  const created = projects.create({ name: 'Demo Project', storage: 'ssd' });
  assert.equal(created.slug, 'demo-project');
  assert.equal(projects.resolve(created.id).containerPath, fs.realpathSync(path.join(ssd, 'demo-project')));
  assert.throws(() => projects.create({ name: '../../outside', storage: 'other' }), /存储位置无效/);
});

test('AttachmentStore enforces limits, prepares read-only copies and consumes staging files', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-attachments-'));
  const store = new AttachmentStore(directory, { maximumFile: 16, maximumConversation: 24 });
  const item = await store.save(Readable.from(Buffer.from('hello')), 'chat-1', 'notes.txt', 'text/plain');
  const runRoot = path.join(directory, 'run');
  const prepared = store.prepare([item.id], 'chat-1', runRoot);
  assert.equal(fs.readFileSync(prepared[0].runPath, 'utf8'), 'hello');
  assert.equal(fs.statSync(prepared[0].runPath).mode & 0o222, 0);
  store.consume(prepared);
  assert.equal(store.list('chat-1').length, 0);
  await assert.rejects(
    store.save(Readable.from(Buffer.alloc(17)), 'chat-1', 'large.txt', 'text/plain'),
    /上传限制/,
  );
  await assert.rejects(
    store.save(Readable.from(Buffer.from('%PDF')), 'chat-1', 'unverified.pdf', 'application/pdf'),
    /不支持此文件类型/,
  );
});

test('file and project names are normalized without path separators', () => {
  assert.equal(safeName('../a:b.txt'), '_a_b.txt');
  assert.equal(safeSlug(' My Project '), 'my-project');
});
