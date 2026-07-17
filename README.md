# PocketCodex

> 把常驻在 Ubuntu 上的 Codex 装进口袋。

PocketCodex 是运行在 Ubuntu Server 上的轻量 Codex 管理助手，包含手机聊天页面、
服务器状态面板和 ttyd 备用终端。
实际上传部署步骤见 [AFTER-UPLOAD.md](./AFTER-UPLOAD.md)。

## 结构

```text
Tailscale HTTPS
       |
       +-> codex-web :7682 -> codex exec --json -> Sub2API
       |                      |
       |                      +-> /workspace/hostctl
       |
       +-> codex-agent :7681 -> ttyd -> Codex TUI

hostctl -> 强制命令 SSH -> Ubuntu 只读状态与日志
```

### `codex-web`

- 面向手机竖屏的聊天界面。
- 显示 CPU 温度/负载、内存、系统盘、电池和服务状态。
- 支持会话新建、续接、删除和持久化。
- 显示并折叠 Codex 命令执行、分析摘要和工具调用。
- 使用 SSE 传递任务进度；Codex CLI 完成回答后显示最终文本。
- 状态栏查询不调用模型，不消耗额度。
- 允许在 Docker 容器内使用 `curl` 查询互联网；GitHub 优先使用公开 API 和 Raw 地址。
- 提供 Manifest、主屏幕图标和 Service Worker，可安装为 Android 主屏幕应用。

### `codex-agent`

- 保留原来的 ttyd 网页终端作为故障回退入口。
- 可以直接运行 Codex TUI 和 CC Switch CLI。
- 默认只监听宿主机 `127.0.0.1:7681`。

## 文件

```text
compose.yaml                  两个容器和安全限制
Dockerfile                    Node、Codex、CC Switch、ttyd 镜像
entrypoint.sh                 ttyd 启动入口
web/app.mjs                   可测试的 HTTP/SSE 服务
web/server.mjs                codex-web 启动入口
web/lib.mjs                   会话存储和状态解析
web/public/                   手机聊天页面
web/*.test.mjs                Node 内置测试
workspace/hostctl             容器内只读 SSH 客户端
host/codex-host-helper        宿主机强制命令脚本
host/install-host-helper.sh   受限账号安装器
host/pal-watch                PushPlus 定时监控
```

## 固定版本

- Node.js 22
- Codex CLI `0.144.5`
- CC Switch CLI `v5.9.1`
- ttyd `1.7.7`

版本固定在 `compose.yaml`，避免重新构建时自动换成未经测试的新版本。

## 本地开发

不需要 npm 安装。运行全部测试：

```bash
node --test web/*.test.mjs
```

检查语法：

```bash
node --check web/lib.mjs
node --check web/app.mjs
node --check web/server.mjs
node --check web/public/app.js
```

用模拟数据启动页面，需要准备一个只含测试密码的文件：

```bash
WEB_PASSWORD_FILE=/tmp/codex-web-password \
WEB_PUBLIC_DIR="$PWD/web/public" \
CODEX_WEB_DATA=/tmp/codex-web-data \
CODEX_WEB_MOCK=1 \
WEB_HOST=127.0.0.1 \
WEB_PORT=7682 \
node web/server.mjs
```

## 数据

```text
data/codex          Codex 配置、凭据和线程数据
data/codex-web      Web 会话索引和消息记录
data/cc-switch      CC Switch 配置
data/ssh            hostctl 专用密钥与 known_hosts
secrets             Basic Auth 密码
```

`codex-agent` 与 `codex-web` 共享 `data/codex` 和 `data/ssh`；聊天页面独占
`data/codex-web`。不要在两个入口同时操作同一个线程。

## 安全设计

1. 两个网页端口都只绑定 `127.0.0.1`。
2. 外部访问交给 Tailscale Serve 提供 HTTPS 和设备身份边界。
3. 两个网页入口均使用同一份 Basic Auth 密码。
4. `codex-web` 检查同源、限制请求频率和消息长度。
5. 模型文本使用 DOM `textContent` 构建，不注入原始 HTML。
6. Prompt 通过子进程标准输入传递，不拼接 Shell 命令。
7. 容器移除 Linux capabilities，并启用 `no-new-privileges`。
8. 不挂载 Docker Socket、Ubuntu 根目录、`/etc` 或帕鲁存档。
9. 宿主机访问只经过强制命令 SSH，命令白名单写死在脚本中。
10. `codex-web` 的 `/workspace` 使用只读挂载；联网命令只在非 root 容器内运行。

## 宿主机只读动作

```text
status
cpu
memory
disk
battery
pal-status
pal-logs
frp-status
frp-logs
```

没有重启、更新、关机、删除或任意 Shell 动作。

## 常用维护

```bash
cd "$HOME/pocket-codex"

docker compose ps
docker compose logs -f --tail=100 codex-web
docker compose restart codex-web
docker stats --no-stream codex-agent codex-web
du -sh data/codex-web
```

更新代码后重新构建：

```bash
docker compose build codex-agent
docker compose up -d
```

切换手机入口：

```bash
sudo tailscale serve --bg 7682  # 手机聊天页面
sudo tailscale serve --bg 7681  # ttyd 备用终端
```
