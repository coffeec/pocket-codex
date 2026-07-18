import fs from 'node:fs';
import { createCodexWebApp } from './app.mjs';

const port = Number(process.env.WEB_PORT || 7682);
const host = process.env.WEB_HOST || '0.0.0.0';
const passwordFile = process.env.WEB_PASSWORD_FILE || '/run/secrets/web_password';
const password = fs.readFileSync(passwordFile, 'utf8').trim();

const { server } = createCodexWebApp({
  publicDir: process.env.WEB_PUBLIC_DIR,
  dataDir: process.env.CODEX_WEB_DATA,
  password,
  username: process.env.WEB_USER || 'admin',
  mockMode: process.env.CODEX_WEB_MOCK === '1',
  sub2apiBaseUrl: process.env.SUB2API_BASE_URL,
  sub2apiHealthUrl: process.env.SUB2API_HEALTH_URL,
  hostctlPath: process.env.HOSTCTL_PATH,
});

server.listen(port, host, () => {
  const suffix = process.env.CODEX_WEB_MOCK === '1' ? ' (mock)' : '';
  console.log(`codex-web listening on http://${host}:${port}${suffix}`);
});
