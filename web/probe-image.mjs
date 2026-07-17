import fs from 'node:fs';
import path from 'node:path';

const configPath = process.env.CODEX_CONFIG_PATH || '/home/node/.codex/config.toml';
const authPath = process.env.CODEX_AUTH_PATH || '/home/node/.codex/auth.json';
const dataDir = process.env.CODEX_WEB_DATA || '/home/node/.codex-web';
const baseUrl = String(process.env.SUB2API_BASE_URL || 'http://sub2api:8080/v1').replace(/\/$/, '');
const config = fs.readFileSync(configPath, 'utf8');
const model = process.env.PROBE_MODEL || /^model\s*=\s*"([^"]+)"/m.exec(config)?.[1];
const apiKey = JSON.parse(fs.readFileSync(authPath, 'utf8')).OPENAI_API_KEY;
const outputPath = path.join(dataDir, 'capabilities.json');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7JcAAAAASUVORK5CYII=';

let imageInput = null;
let result = 'inconclusive';
let baselineStatus = null;
let imageStatus = null;

async function request(content) {
  return fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: [{ role: 'user', content }] }),
    signal: AbortSignal.timeout(60_000),
  });
}

try {
  const baseline = await request([{ type: 'input_text', text: 'Reply only TEXT_OK.' }]);
  baselineStatus = baseline.status;
  await baseline.body?.cancel();
  if (!baseline.ok) {
    result = 'baseline_failed';
  } else {
    const image = await request([
      { type: 'input_text', text: 'Reply only IMAGE_OK if this image input was accepted.' },
      { type: 'input_image', image_url: `data:image/png;base64,${png}` },
    ]);
    imageStatus = image.status;
    if (image.ok) {
      imageInput = true;
      result = 'supported';
    } else if (![401, 403, 408, 429].includes(image.status)) {
      imageInput = false;
      result = 'unsupported';
    } else {
      result = 'image_probe_inconclusive';
    }
    await image.body?.cancel();
  }
} catch {
  result = 'connection_error';
}

fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${JSON.stringify({ imageInput, result, baselineStatus, imageStatus, model, checkedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ imageInput, result, baselineStatus, imageStatus, model }));
process.exitCode = imageInput === null ? 2 : 0;
