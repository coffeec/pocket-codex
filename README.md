# PocketCodex

PocketCodex 是运行在私有 Ubuntu 主机上的手机优先 AI 工作台。外部入口由 Tailscale Serve 提供 HTTPS，应用只监听 `127.0.0.1:7682`。

## 三种模式

```text
GPT      -> codex-web -> Sub2API /v1/responses（原始 SSE 流）
Agent    -> codex-web -> cloudcli-agent -> Codex CLI -> 已登记项目
服务器   -> codex-web -> Codex CLI -> /workspace/hostctl（只读白名单）
```

- GPT：PocketCodex 原生界面，支持模型/推理强度选择、历史会话、Markdown、代码复制和真实增量输出，不经过 Codex CLI。
- Agent：定制 CloudCLI 界面，在登记项目中读取、编辑、测试、查看 Diff 和执行 Git 操作。Codex 使用 `workspace-write`，全局同时只运行一个任务。
- 服务器：PocketCodex 原生状态面板，保留 CPU、内存、磁盘、电池、Palworld、FRP 和 Sub2API 状态，只能调用现有受限 `hostctl`。

浏览器业务 API 使用 `/pocket-api/*`。`/agent/*`、CloudCLI 的 `/api/*`、`/ws` 和 `/shell` 均由 `codex-web` 在 Pocket Cookie 会话认证后代理。CloudCLI 不发布宿主机端口，也没有独立登录入口。

## 模型与 Provider

GPT 默认使用 `gpt-5.6-sol`。Agent 从 CC Switch 管理的 `data/codex/config.toml` 动态读取模型，默认推理强度为 `high`；以后增加 GPT 5.7 等模型时，只需先在 Sub2API 和 CC Switch 配置中启用，新模型会进入 Agent 模型列表。

`cloudcli-agent` 启动时强制检查：

```toml
model_provider = "sub2api_local"
base_url = "http://sub2api:8080/v1"
```

配置不符合时 Agent 服务会失败关闭，但 GPT 和服务器模式仍可使用。API Key 只从挂载的 Codex 配置读取，不进入源码、浏览器或日志。

## 附件

当前支持图片、文本、代码、JSON 和 YAML。单文件上限 20MB，每个会话待发送附件总计 50MB。PDF、Word 和压缩包尚未通过当前 Sub2API 验证，因此暂不显示或接受，避免伪装支持。

附件先存入 `data/codex-web/uploads`，发送时复制到独立 `runs/<uuid>` 目录并设为只读，任务结束后删除运行副本。桌面可在输入框粘贴图片，手机文件选择器可使用相册、拍照或文件。

图片不会被假装支持。部署后运行 `node /app/web/probe-image.mjs`，结果写入 `data/codex-web/capabilities.json`。结果不是 `supported` 时，GPT 模式会明确拒绝图片输入；Agent 仍可读取附件文件。

## 项目边界

宿主机只向 Agent 挂载两个工作区根：

```text
/home/coffee/pocket-workspaces -> /workspaces/ssd
/mnt/d/pocket-workspaces      -> /workspaces/disk
```

CloudCLI 创建的项目登记在自身持久化数据库中。每次 Codex 或终端启动前都会再次验证项目仍处于登记状态，自动会话扫描也不能导入未登记目录。未挂载 `/`、`/etc`、整个 `/home`、Docker Socket、SSH 目录或 Palworld 存档。

## 安全

- 登录使用 HttpOnly、SameSite Cookie；最大 12 小时，空闲 1 小时过期。
- 保留 Basic Auth API 兼容入口，登录失败同样受 15 分钟限速。
- 所有写请求检查同源，普通请求和消息/上传分别限速。
- Pocket 与 Agent 写操作审计写入 `data/codex-web/audit.jsonl`，不记录 Prompt、文件内容、密码、Token 或 API Key。
- 代理 Agent 前删除 Cookie、Authorization、Proxy-Authorization 和 X-API-Key；同时删除 CloudCLI 的 Set-Cookie。
- CloudCLI 自更新、插件、浏览器自动化、独立登录和 Provider 登录入口已禁用。
- CloudCLI 锁文件包含非主版本安全更新；部署镜像审计为 0 critical、0 high。剩余 moderate 来自已禁用的浏览器自动化链和需要主版本升级的语法高亮链。
- 容器移除全部 capabilities，启用 `no-new-privileges`，各自限制 2 CPU、2GB 内存、256 PID。
- Web 和 ttyd 端口只绑定 `127.0.0.1`，CloudCLI 没有 `ports`，不增加公网端口。

## 开源边界

PocketCodex 主项目使用 MIT 许可证。`cloudcli/` 是单独构建的 CloudCLI AGPL-3.0-or-later 衍生层：Dockerfile 固定上游 commit，再依次应用仓库中的补丁。CloudCLI 源码不会复制进 PocketCodex 运行镜像或 MIT 代码；修改补丁保留在 `cloudcli/patches/`，上游和构建说明见 `cloudcli/README.md`。

## 持久化数据

```text
data/codex       Codex 配置、凭据和线程
data/codex-web   Pocket 会话、附件索引、能力结果和审计
data/cloudcli    Agent 项目登记、会话和 CloudCLI 数据库
data/cc-switch   CC Switch 配置
data/ssh         只读 hostctl 专用 SSH 配置（只挂载给旧终端和 Pocket 服务）
data/skills      持久化 Skills，只读挂载给 Codex
secrets          Pocket Web 登录密码
```

仓库中的 `skills/` 是五个初始模板：`palworld-admin`、`ubuntu-health`、`docker-admin`、`project-deploy` 和 `github-workflow`。部署时只补充复制到 `data/skills`，不覆盖宿主机以后修改的 Skill。Skill 不能绕过 `hostctl` 或项目白名单。

## 本地验证

Pocket 服务只使用 Node.js 内置模块，不需要 `npm install`：

```bash
node --check web/lib.mjs
node --check web/storage.mjs
node --check web/app.mjs
node --check web/server.mjs
node --check web/public/app.js
node --test web/*.test.mjs
```

CloudCLI 构建会在固定上游源码上执行三个补丁、`npm ci` 和生产构建。部署前至少运行：

```bash
docker compose config --quiet
docker compose build codex-agent cloudcli-agent
```

## 部署摘要

先备份并保留现有 `data/`、`secrets/` 和 `.env`，再更新源码：

```bash
cd "$HOME/pocket-codex"
mkdir -p data/skills data/codex-web data/cloudcli \
  /home/coffee/pocket-workspaces /mnt/d/pocket-workspaces
cp -an skills/. data/skills/
docker compose config --quiet
docker compose build codex-agent cloudcli-agent
docker compose up -d
docker compose ps
docker compose exec -T codex-web node /app/web/probe-image.mjs
```

升级后验证：

```bash
curl -fsS http://127.0.0.1:7682/health
curl -I http://127.0.0.1:7682/agent/
docker compose logs --tail=100 codex-web cloudcli-agent
docker stats --no-stream codex-agent codex-web cloudcli-agent
tailscale serve status
```

详细备份、候选构建、验收和回滚步骤见 `AFTER-UPLOAD.md`。
