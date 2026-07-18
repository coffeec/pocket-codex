# Ubuntu 部署与回滚

本文用于把已有三容器 PocketCodex 原地迁移到 GPT-only 版本。先构建和验证新 `codex-web`，再停止旧 `cloudcli-agent` 和 `codex-agent`。不要删除旧容器数据、CloudCLI 回滚镜像或 Docker 构建缓存。

## 1. 升级前检查

```bash
cd "$HOME/pocket-codex"
date -Is
git status --short 2>/dev/null || true
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
systemctl is-active palworld sakurafrp-palworld tailscaled
tailscale serve status
df -h / /mnt/d
```

确认 `codex-web` 和当前回滚容器健康，Palworld、FRP、Sub2API 与 Tailscale 正常。部署过程中不重启这四项服务。

## 2. 完整备份

创建仅 `coffee` 可读的备份，不在输出中打印密码、Token、Key、`auth.json` 或 `.env` 内容：

```bash
stamp=$(date +%Y%m%d-%H%M%S)
backup="$HOME/pocket-codex-backups/gpt-only-$stamp"
install -d -m 700 "$HOME/pocket-codex-backups" "$backup"
cp -a compose.yaml .env secrets "$backup/" 2>/dev/null || true
mkdir -p "$backup/data"
for name in codex codex-web cloudcli skills cc-switch ssh; do
  [ ! -e "data/$name" ] || cp -a "data/$name" "$backup/data/"
done
cp -a skills "$backup/repository-skills"
find "$backup" -type f -print0 | sort -z | xargs -0 sha256sum > "$backup/SHA256SUMS"
du -sh "$backup"
printf '%s\n' "$backup"
```

已有迁移备份也应保留。不要用空目录覆盖现有 `data/codex-web`、`data/cloudcli` 或 `data/skills`。

## 3. 配置与 hostctl

只检查非敏感配置键：

```bash
grep -E '^(model|model_provider)|base_url|wire_api' data/codex/config.toml
```

必须使用 `sub2api_local` 和 Docker 内网 Sub2API。不要读取或输出 `data/codex/auth.json`。

确认专用 SSH `known_hosts` 已存在，再安装受限宿主机助手：

```bash
test -s data/ssh/id_ed25519.pub
test -s data/ssh/known_hosts
sudo host/install-host-helper.sh data/ssh/id_ed25519.pub
sudo -u codexbot env SSH_ORIGINAL_COMMAND=status /usr/local/sbin/codex-host-helper >/tmp/pocket-host-status.txt
sudo -u codexbot env SSH_ORIGINAL_COMMAND=backup-usage /usr/local/sbin/codex-host-helper
rm -f /tmp/pocket-host-status.txt
```

安装脚本先把旧 helper 和授权文件备份到 `/var/backups/pocketcodex-host-helper/<时间>`。宿主机没有 `cc` 时，它使用自动删除的编译容器，不在 Ubuntu 安装编译工具。测试只执行只读动作，不要在部署验收中触发重启、广播或备份。

## 4. 候选镜像

先保留旧 Pocket 镜像，再构建候选，不使用 `docker system prune -a`：

```bash
old_image=$(docker inspect codex-web --format '{{.Image}}')
rollback_tag="pocket-codex:rollback-before-gpt-only-$stamp"
docker tag "$old_image" "$rollback_tag"
docker compose config --quiet
docker compose build codex-web
docker image inspect pocket-codex:local "$rollback_tag" --format '{{.RepoTags}} {{.Id}} {{.Size}}'
```

构建失败时当前健康容器不会被替换。保存错误输出并修复源码后重新构建。

## 5. 只替换 Pocket

```bash
docker compose up -d --no-deps codex-web
docker inspect codex-web --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}} restarts={{.RestartCount}}'
curl -fsS http://127.0.0.1:7682/health
docker logs --tail=100 codex-web
```

不要使用 `--remove-orphans`。此时旧 `cloudcli-agent` 和 `codex-agent` 继续作为回退运行，但 Pocket 已不应访问它们。

## 6. 生产验收

从 Tailscale HTTPS 页面验证：

1. 未登录 bootstrap 返回 401，公开 session 检查只返回布尔认证状态。
2. Cookie 登录、失败限速、退出和会话过期正常。
3. 默认 `gpt-5.6-sol / high`，模型来自 Sub2API，切换后按会话保存。
4. SSE 增量、停止生成、历史、重命名、归档和删除确认正常。
5. 状态条和详情面板显示温度、内存、SSD、电池、Palworld、FRP、Sub2API 与 Docker 缓存。
6. 只读工具返回真实结果；修改工具只显示二次确认，未确认时宿主机没有动作。
7. 同一 Cookie 可确认一次，其他 Cookie、过期和重放令牌被拒绝。
8. 图片通过真实上传接口触发 OCR，并明确显示不理解颜色、布局和图形。
9. 360px、390px 和桌面无横向溢出、遮挡、重复用户气泡或输入框错位。
10. 控制台无 404、插件、GitHub 版本检查、CloudCLI 或外部资源请求。
11. PWA 缓存版本更新后刷新仍能加载新页面和现有会话。

只读接口检查：

```bash
docker exec codex-web /usr/local/bin/hostctl status >/tmp/pocket-status.txt
docker exec codex-web /usr/local/bin/hostctl backup-usage
rm -f /tmp/pocket-status.txt
docker stats --no-stream codex-web sub2api sub2api-postgres sub2api-redis
docker system df
du -sh data/codex data/codex-web data/cloudcli data/skills 2>/dev/null
```

## 7. 停止旧 Agent 容器

只有第 6 节全部通过后执行：

```bash
docker stop cloudcli-agent
curl -fsS http://127.0.0.1:7682/health
docker stop codex-agent
curl -fsS http://127.0.0.1:7682/health
```

只停止，不删除容器、镜像、`data/cloudcli`、`data/codex`、`data/skills` 或工作区目录。再次确认：

```bash
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
systemctl is-active palworld sakurafrp-palworld tailscaled
docker ps --filter name=sub2api --format '{{.Names}} {{.Status}}'
tailscale serve status
```

## 8. 回滚

如果新 Pocket 不健康，先保留日志，再把旧镜像重新标记为运行标签：

```bash
docker logs codex-web > "$backup/failed-codex-web.log" 2>&1 || true
docker tag "$rollback_tag" pocket-codex:local
docker compose up -d --no-deps --force-recreate codex-web
curl -fsS http://127.0.0.1:7682/health
```

如需恢复完整旧 Agent 界面，切回迁移前提交和备份的 `compose.yaml` 后再启动旧容器：

```bash
cp -a "$backup/compose.yaml" ./compose.yaml
docker start cloudcli-agent codex-agent
docker compose up -d --no-deps codex-web
```

默认不要恢复或覆盖 `data/`。只有确认数据格式损坏并停止相关容器后，才从备份恢复明确的子目录。
