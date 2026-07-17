# Ubuntu 部署与回滚

本文适用于已有 PocketCodex 的原地升级。目标是保留认证、会话、CC Switch 配置和 Skills，先完成候选验证，再替换运行服务。

## 服务拓扑

```text
Tailscale HTTPS -> 127.0.0.1:7682 -> codex-web
  /pocket-api/* -> Pocket GPT / 服务器 API
  /agent/*      -> cloudcli-agent UI
  /api/*        -> cloudcli-agent API
  /ws, /shell   -> cloudcli-agent WebSocket

127.0.0.1:7681 -> codex-agent ttyd 备用入口
```

`cloudcli-agent` 不发布宿主机端口。它与 Pocket 共用 CC Switch 管理的 Codex 配置，但不挂载 Docker Socket、宿主机根目录、整个 `/home`、SSH 目录或 Palworld 数据。

## 1. 升级前检查与备份

```bash
cd "$HOME/pocket-codex"
date
git status --short 2>/dev/null || true
docker compose ps
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
tailscale serve status
df -h / /home/coffee /mnt/d
```

使用仅当前用户可读的时间戳目录备份配置和持久化数据。不要在命令输出中打印密码、Token 或 Key：

```bash
stamp=$(date +%Y%m%d-%H%M%S)
backup="$HOME/pocket-codex-backups/$stamp"
mkdir -p "$backup"
chmod 700 "$HOME/pocket-codex-backups" "$backup"
cp -a compose.yaml .env "$backup/" 2>/dev/null || true
cp -a data secrets "$backup/"
printf '%s\n' "$backup"
```

确认备份包含非空的 `data/codex`、`data/codex-web` 和 `secrets`，但不要查看文件内容：

```bash
du -sh "$backup"/*
find "$backup/data" -maxdepth 2 -type f -printf '%P\n' | sort
```

## 2. 准备持久化目录

```bash
mkdir -p data/codex data/codex-web data/cloudcli data/cc-switch data/ssh data/skills \
  /home/coffee/pocket-workspaces /mnt/d/pocket-workspaces
cp -an skills/. data/skills/
chmod 700 data/codex data/codex-web data/cloudcli data/cc-switch data/ssh data/skills \
  /home/coffee/pocket-workspaces /mnt/d/pocket-workspaces
```

`cp -an` 只补入缺失的 Skill，不覆盖宿主机已有修改。若目录以前由 Docker 以 root 创建，先只修正明确的数据目录所有者，不递归触碰项目内容或其他宿主目录。

## 3. 检查 CC Switch 配置

CloudCLI 只接受 `sub2api_local` 和 Docker 内网 Sub2API 地址：

```bash
grep -E '^(model|model_provider)|base_url|wire_api' data/codex/config.toml
```

结果必须包含：

```toml
model_provider = "sub2api_local"
base_url = "http://sub2api:8080/v1"
```

不要输出 `data/codex/auth.json`。若需要切换 Provider，使用现有 CC Switch 流程完成后再继续。

## 4. 候选配置与镜像

先验证 Compose 和构建镜像，不启动或替换生产容器：

```bash
docker compose config --quiet
docker compose build codex-agent cloudcli-agent
docker image inspect pocket-codex:local pocket-cloudcli:local \
  --format '{{.RepoTags}} {{.Size}}'
```

构建 CloudCLI 时会拉取固定 commit `27eaf0146a46aa8a55178f3d394360ff7465420f`，依次应用 `cloudcli/patches/`，然后执行生产构建。任何补丁检查或构建失败都应在此停止，不影响当前运行容器。

## 5. 启动与健康检查

```bash
docker compose up -d
docker compose ps
docker compose logs --tail=100 codex-web cloudcli-agent
curl -fsS http://127.0.0.1:7682/health
```

`codex-web` 应为 healthy。`cloudcli-agent` 故障不会阻止 GPT 和服务器模式启动；此时 `/agent/` 返回 502，便于单独排查。

运行图片能力探测：

```bash
docker compose exec -T codex-web node /app/web/probe-image.mjs
```

只有探测结果为 `supported` 时，GPT 才允许图片请求。其他结果会在界面明确拒绝，不会伪装支持。

## 6. 本地验收

在 Windows 建立临时 SSH 隧道，不修改 Tailscale：

```powershell
ssh -L 17682:127.0.0.1:7682 coffee@192.168.5.4
```

浏览器打开 `http://127.0.0.1:17682`，使用原 PocketCodex 登录凭据验收：

1. GPT 默认模型是 `gpt-5.6-sol`，可切换模型并接收真实增量输出。
2. 刷新后 GPT 和服务器会话仍在，Markdown 与代码复制正常。
3. 图片粘贴、手机相册/拍照和允许的文件类型受 20MB 单文件限制。
4. Agent 无第二次登录，模型来自当前 `config.toml`，默认推理强度为 `high`。
5. Agent 只能创建 SSD 或 D 盘项目，不能打开未登记路径。
6. 同时启动第二个 Agent 任务会得到 `AGENT_BUSY`。
7. Server 状态与 Palworld、FRP、Sub2API 状态正常。

还应验证容器内实际调用路径：

```bash
docker compose exec -T cloudcli-agent sh -lc \
  "grep -E '^(model|model_provider)|base_url' /home/node/.codex/config.toml"
docker compose exec -T codex-web /workspace/hostctl status
```

## 7. 资源与旁路服务检查

```bash
docker stats --no-stream codex-agent codex-web cloudcli-agent sub2api sub2api-postgres sub2api-redis
docker system df
du -sh data/codex-web data/cloudcli data/codex data/skills
docker ps --filter name=sub2api --format '{{.Names}} {{.Status}}'
systemctl is-active palworld sakurafrp-palworld tailscaled
tailscale serve status
```

`cloudcli-agent` 上限为 2 CPU、2GB 内存和 256 PID；`/tmp` 为 512MB tmpfs。没有新增公网端口，Palworld、FRP 和 Sub2API 的容器、端口与状态不应改变。

## 8. 回滚

若验收失败，先保存新容器日志，再恢复备份的 Compose 和原镜像/源码版本。不要删除新生成的会话或覆盖旧数据：

```bash
docker compose logs --no-color codex-web cloudcli-agent > "$backup/failed-upgrade.log" 2>&1
cp -a "$backup/compose.yaml" ./compose.yaml
cp -a "$backup/.env" ./.env 2>/dev/null || true
```

随后使用升级前记录的源码和镜像重新 `docker compose up -d`。`data/` 与 `secrets/` 默认保持原位；只有确认数据格式回滚不兼容时，才在停服状态下从备份恢复明确的子目录。

## 日常命令

```bash
cd "$HOME/pocket-codex"
docker compose ps
docker compose logs -f --tail=100 codex-web cloudcli-agent
docker stats --no-stream codex-agent codex-web cloudcli-agent
du -sh data/codex-web data/cloudcli
tailscale serve status
```

Pocket 登录会话最大 12 小时、空闲 1 小时。CloudCLI 使用 platform mode，不签发独立 7 天 JWT。Agent HTTP 和 WebSocket 都必须先通过 Pocket Cookie 会话认证。
