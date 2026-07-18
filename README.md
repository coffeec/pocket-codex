# PocketCodex

PocketCodex 是运行在私有 Ubuntu 主机上的手机优先 GPT 聊天和服务器管理工具。应用只发布到 `127.0.0.1:7682`，外部访问继续由 Tailscale Serve 提供 HTTPS。

## 架构

```text
手机 -> Tailscale HTTPS -> PocketCodex
PocketCodex -> /v1/responses -> 内部 Sub2API
PocketCodex -> 固定工具枚举 -> 受限 hostctl -> Ubuntu / Palworld / FRP
```

运行产品只有一个固定深色 GPT 页面。服务器状态显示在聊天顶部，详细诊断通过 Responses API 的严格 Function Calling 执行。项目管理、文件树、Git、Diff、终端、Agent、CloudCLI 前端和 ttyd 均不在当前运行架构中。

## GPT 与模型

- GPT 直接调用 `http://sub2api:8080/v1/responses`，不经过 Codex CLI。
- Provider 必须是 `sub2api_local`，否则消息请求失败关闭，不会回退官方端点。
- 默认模型是 `gpt-5.6-sol`，默认推理强度是 `high`。
- 模型列表从 Sub2API `/v1/models` 动态获取。获取失败时页面明确显示列表暂不可用，只保留当前配置模型。
- 模型和推理强度按会话持久化，支持以后切换 GPT 5.7 等新模型，无需重建前端。
- 支持真实 SSE 增量输出、停止生成、Markdown、表格、引用、代码块与复制。

## 服务器工具

只读工具：

```text
system_status  top_processes  disk_usage  battery
palworld_status  palworld_logs  frp_status  sub2api_status
players  backup_usage
```

修改工具：

```text
palworld_backup  broadcast  restart_palworld  restart_frp  restart_pocket
```

Sub2API 已实测支持 Responses API Function Calling 和严格 JSON Schema。工具名、参数键、枚举值、日志行数和时间范围都由服务端再次验证。不存在关键词路由、自由 Shell、sudo、Docker Socket、任意路径或目录删除接口。

修改工具只创建两分钟有效的一次性确认令牌。令牌绑定 Cookie 会话、会话 ID、动作和参数，只在当前 SSE 页面中出现，不写入会话、审计或模型上下文。用户必须在页面二次确认；其他会话、过期令牌和重放请求均被拒绝。

顶部状态不经过模型，不消耗 Token。页面隐藏时停止轮询；Docker 构建缓存每五分钟最多读取一次且绝不自动清理。SSD 可用空间低于 25GB 显示黄色，低于 15GB 显示红色。

## 附件与 OCR

当前显示并接受图片、文本、代码、JSON 和 YAML。单文件上限 20MB，每个会话待发送附件合计上限 50MB。PDF、Word 和压缩包尚未通过当前链路验证，因此不显示为支持。

附件先存入 `data/codex-web/uploads`。发送时复制到独立 `runs/<uuid>` 目录并设为只读，任务结束后删除运行副本。桌面支持粘贴图片，手机支持相册、拍照和文件选择。

`gpt-5.6-sol` 经当前 Sub2API 实测不支持原生图片输入。能力结果记录在 `data/codex-web/capabilities.json`。当前页面明确使用 Tesseract OCR 降级，并说明 OCR 只提取文字，不理解颜色、布局或图形；不会伪装为视觉理解。

## 会话与认证

- GPT 会话支持历史、重命名、归档、恢复和永久删除确认。
- 旧 Agent 和服务器会话迁移为只读归档，保留原消息、线程 ID 和 `legacyMode`，不删除 Codex 原始线程。
- 登录使用 HttpOnly、SameSite=Strict Cookie；最长 12 小时，空闲 1 小时过期。
- 登录连续失败 5 次后按来源限制 15 分钟；普通请求、消息和上传分别限速。
- 写请求检查同源；审计只记录动作、结果、用户、来源和资源 ID，不记录 Prompt、文件内容、密码、Token 或 API Key。
- Service Worker 只缓存静态壳，不缓存 API、会话或 SSE。

## 容器与宿主机边界

当前 Compose 只定义 `codex-web`：1.5 CPU、768MB 内存、128 PID、256MB `/tmp`。容器根文件系统只读，删除全部 capabilities，启用 `no-new-privileges`，不挂载 Docker Socket、宿主机根目录、整个 `/home`、`/etc`、项目工作区或 Palworld 存档。

宿主机 SSH 强制命令只接受固定动作。一个小型 setuid 助手仅用于硬编码的 Docker 缓存查询、备份用量、Palworld 备份和三个明确重启动作。它没有用户提供的命令、路径或服务名参数。

## 持久化与历史回滚

```text
data/codex       CC Switch 管理的 Sub2API 配置和凭据，只读挂载
data/codex-web   GPT 会话、附件索引、能力结果和审计
data/ssh         hostctl 专用 SSH 私钥和已固定的 known_hosts，只读挂载
data/cloudcli    已归档的 CloudCLI 会话和数据库，不挂载、不删除
data/skills      已归档的持久化 Skill，不挂载、不删除
secrets          Pocket 登录密码
```

`cloudcli/` 保留固定上游归档、补丁和 AGPL-3.0-or-later 说明，只用于历史构建与回滚，不进入 PocketCodex MIT 镜像，也不在当前 Compose 中运行。见 `cloudcli/README.md`。

仓库只保留 `palworld-admin` 和 `ubuntu-health` 两个受限运维 Skill 模板。代码开发、Docker 开发、项目部署和 GitHub 工作流 Skill 已从当前产品移除。

## 本地验证

Pocket 服务只使用 Node.js 内置模块，不需要 `npm install`：

```bash
node --check web/lib.mjs
node --check web/storage.mjs
node --check web/responses.mjs
node --check web/tools.mjs
node --check web/app.mjs
node --check web/server.mjs
node --check web/public/app.js
node --test web/*.test.mjs
git diff --check
docker compose config --quiet
```

部署、候选验证、停止旧 Agent 容器和回滚步骤见 `AFTER-UPLOAD.md`。
