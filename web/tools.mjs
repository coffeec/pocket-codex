const emptyParameters = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

function tool(name, description, parameters = emptyParameters) {
  return { type: 'function', name, description, strict: true, parameters };
}

export const TOOL_DEFINITIONS = [
  tool('system_status', '读取 CPU 温度、负载、内存、SSD、电池及关键服务状态。'),
  tool('top_processes', '读取资源占用最高的进程。', {
    type: 'object',
    properties: { limit: { type: 'integer', enum: [5, 10, 15] } },
    required: ['limit'],
    additionalProperties: false,
  }),
  tool('disk_usage', '读取磁盘用量或 Docker 构建缓存大小。', {
    type: 'object',
    properties: { scope: { type: 'string', enum: ['all', 'ssd', 'docker'] } },
    required: ['scope'],
    additionalProperties: false,
  }),
  tool('battery', '读取电池电量和充电状态。'),
  tool('palworld_status', '读取 Palworld systemd 状态。'),
  tool('palworld_logs', '读取经过限制和脱敏的 Palworld 最近日志。', {
    type: 'object',
    properties: {
      lines: { type: 'integer', enum: [20, 50, 100] },
      minutes: { type: 'integer', enum: [15, 60, 360, 1440] },
    },
    required: ['lines', 'minutes'],
    additionalProperties: false,
  }),
  tool('frp_status', '读取 SakuraFrp 隧道状态。'),
  tool('sub2api_status', '读取 Sub2API 健康状态，不读取后台数据或凭据。'),
  tool('players', '读取当前在线玩家。若 Palworld 管理接口未启用则明确返回不可用。'),
  tool('backup_usage', '读取 Palworld 备份数量和总占用。'),
  tool('palworld_backup', '创建一次 Palworld 存档备份。此操作必须由用户二次确认。'),
  tool('broadcast', '向 Palworld 玩家广播短消息。此操作必须由用户二次确认。', {
    type: 'object',
    properties: { message: { type: 'string', minLength: 1, maxLength: 200 } },
    required: ['message'],
    additionalProperties: false,
  }),
  tool('restart_palworld', '重启 Palworld 服务。此操作必须由用户二次确认。'),
  tool('restart_frp', '重启 SakuraFrp 服务。此操作必须由用户二次确认。'),
  tool('restart_pocket', '重启 PocketCodex Web 容器。此操作必须由用户二次确认。'),
];

export const MODEL_TOOLS = [
  ...TOOL_DEFINITIONS,
  { type: 'web_search' },
];

export const MUTATING_TOOLS = new Set([
  'palworld_backup',
  'broadcast',
  'restart_palworld',
  'restart_frp',
  'restart_pocket',
]);

const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((item) => item.name));

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function validateToolArguments(name, value) {
  if (!TOOL_NAMES.has(name)) throw new Error('未知服务器工具');
  const args = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (['system_status', 'battery', 'palworld_status', 'frp_status', 'sub2api_status', 'players', 'backup_usage',
    'palworld_backup', 'restart_palworld', 'restart_frp', 'restart_pocket'].includes(name)) {
    if (!exactKeys(args, [])) throw new Error('工具参数无效');
    return {};
  }
  if (name === 'top_processes') {
    if (!exactKeys(args, ['limit']) || ![5, 10, 15].includes(args.limit)) throw new Error('进程数量无效');
    return { limit: args.limit };
  }
  if (name === 'disk_usage') {
    if (!exactKeys(args, ['scope']) || !['all', 'ssd', 'docker'].includes(args.scope)) throw new Error('磁盘范围无效');
    return { scope: args.scope };
  }
  if (name === 'palworld_logs') {
    if (!exactKeys(args, ['lines', 'minutes']) || ![20, 50, 100].includes(args.lines)
      || ![15, 60, 360, 1440].includes(args.minutes)) throw new Error('日志范围无效');
    return { lines: args.lines, minutes: args.minutes };
  }
  if (name === 'broadcast') {
    const message = String(args.message || '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!exactKeys(args, ['message']) || !message || message.length > 200) throw new Error('广播内容无效');
    return { message };
  }
  throw new Error('工具参数无效');
}

export function redactToolOutput(value, secret = '') {
  let output = String(value || '')
    .replace(/(authorization:\s*(?:bearer|basic)\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(["']?[\w.-]*(?:token|password|secret|api[_-]?key)[\w.-]*["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi, '$1[REDACTED]');
  if (secret) output = output.replaceAll(secret, '[REDACTED]');
  return output.split('\n').slice(0, 120).map((line) => line.slice(0, 500)).join('\n').slice(0, 48 * 1024);
}

export async function executeReadTool(name, args, context) {
  if (MUTATING_TOOLS.has(name)) throw new Error('修改工具需要二次确认');
  switch (name) {
    case 'system_status':
      return context.statusSnapshot();
    case 'top_processes': {
      const output = await context.hostctl('top');
      return { limit: args.limit, output: output.split('\n').slice(0, args.limit + 1).join('\n') };
    }
    case 'disk_usage': {
      if (args.scope === 'docker') return { scope: args.scope, output: await context.hostctl('docker-cache') };
      const disk = await context.hostctl('disk');
      const docker = args.scope === 'all' ? await context.hostctl('docker-cache') : null;
      return { scope: args.scope, disk, docker };
    }
    case 'battery':
      return { output: await context.hostctl('battery') };
    case 'palworld_status':
      return { output: await context.hostctl('pal-status') };
    case 'palworld_logs':
      return { lines: args.lines, minutes: args.minutes, output: await context.hostctl('pal-logs', [args.lines, args.minutes]) };
    case 'frp_status':
      return { output: await context.hostctl('frp-status') };
    case 'sub2api_status':
      return context.sub2apiStatus();
    case 'players':
      return JSON.parse(await context.hostctl('players'));
    case 'backup_usage':
      return JSON.parse(await context.hostctl('backup-usage'));
    default:
      throw new Error('未知只读工具');
  }
}

export async function executeMutatingTool(name, args, context) {
  if (!MUTATING_TOOLS.has(name)) throw new Error('不是修改工具');
  if (name === 'palworld_backup') return { output: await context.hostctl('pal-backup', [], 120_000) };
  if (name === 'broadcast') {
    const encoded = Buffer.from(args.message, 'utf8').toString('base64');
    return { output: await context.hostctl('broadcast', [encoded]) };
  }
  if (name === 'restart_palworld') return { output: await context.hostctl('restart-palworld') };
  if (name === 'restart_frp') return { output: await context.hostctl('restart-frp') };
  if (name === 'restart_pocket') return { output: await context.hostctl('restart-pocket') };
  throw new Error('未知修改工具');
}
