# 上传到 Ubuntu 后的部署流程

这份流程按当前机器整理：

- Ubuntu 示例：`ubuntu@192.168.x.x`（替换成你的实际用户名和地址）
- Sub2API 容器：`sub2api`
- Palworld 服务：`palworld`
- SakuraFrp 服务：`sakurafrp-palworld`
- 手机外网访问：Tailscale Serve

完成后保留两个互不依赖的入口：

```text
手机 -> Tailscale HTTPS -> codex-web :7682 -> Codex exec -> Sub2API
                                     |
                                     +-> 只读 hostctl

备用入口 -> codex-agent :7681 -> ttyd -> Codex TUI
```

`codex-web` 是竖屏聊天页面；`codex-agent` 是原来的网页终端。两者共享 Codex
和只读 SSH 配置；CC Switch 仍由终端容器管理，但不会挂载 Docker Socket、
Ubuntu 根目录或帕鲁存档。

## A. 已经装过旧版时

先把新文件夹上传到 `$HOME/pocket-codex`，确认其中已经包含：

```text
web/app.mjs
web/server.mjs
web/public/index.html
```

进入目录并准备新页面的数据目录：

```bash
cd "$HOME/pocket-codex"
mkdir -p data/codex-web
chmod 700 data/codex-web
```

保留原来的 `data/`、`secrets/` 和 `.env`。不要用上传包中的空目录覆盖它们，
因为里面有 CC Switch Provider、Codex 配置、SSH 密钥和网页密码。

检查并重新构建：

```bash
docker compose config >/dev/null && echo 'Compose 配置正常'
docker compose build codex-agent
docker compose up -d
docker compose ps
```

查看两个入口的日志：

```bash
docker compose logs --tail=100 codex-agent
docker compose logs --tail=100 codex-web
```

若 `codex-web` 显示 `healthy`，直接跳到“本地验收新页面”。

## B. 第一次安装时

### 1. 解压与依赖

```bash
cd "$HOME"
sudo apt update
sudo apt install -y unzip lm-sensors curl jq openssl openssh-server
unzip pocket-codex.zip
cd pocket-codex
```

确认基础服务：

```bash
docker compose version
docker ps --filter name=sub2api
systemctl is-active palworld sakurafrp-palworld
```

### 2. 写入 Sub2API Docker 网络

```bash
SUB2API_NETWORK=$(docker inspect sub2api \
  --format '{{range $name,$config := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' \
  | head -n 1)

printf 'SUB2API_NETWORK=%s\n' "$SUB2API_NETWORK" > .env
cat .env
```

等号后面必须有真实网络名，例如：

```text
SUB2API_NETWORK=deploy_sub2api-network
```

### 3. 创建持久化目录和网页密码

```bash
mkdir -p data/codex data/codex-web data/cc-switch data/ssh secrets workspace
chmod 700 data/codex data/codex-web data/cc-switch data/ssh secrets
chmod +x entrypoint.sh workspace/hostctl host/*.sh host/pal-watch host/codex-host-helper

openssl rand -base64 24 | tr -d '\n' > secrets/web_password.txt
chmod 600 secrets/web_password.txt
```

网页用户名是 `admin`。查看一次随机密码：

```bash
cat secrets/web_password.txt
```

### 4. 安装宿主机只读查询接口

```bash
ssh-keygen -t ed25519 -N '' -C codex-agent-hostctl \
  -f data/ssh/id_ed25519
chmod 600 data/ssh/id_ed25519
sudo ./host/install-host-helper.sh data/ssh/id_ed25519.pub
```

该密钥只能读取系统状态、帕鲁和 FRP 日志，不能获得普通 Shell。

### 5. 构建镜像

```bash
docker compose config >/dev/null && echo 'Compose 配置正常'
docker compose build codex-agent
```

两个服务使用同一个本地镜像，因此不会重复保存两份 Node、Codex 和 CC Switch。

### 6. 配置 CC Switch

```bash
docker compose run --rm --entrypoint cc-switch codex-agent --app codex
```

在 `Providers` 中新增 `Custom` Provider：

```text
Provider Name：sub2api-local
Website URL：留空
API Key：Sub2API 创建的用户 API Key
Base URL：http://sub2api:8080/v1
Model：Sub2API 后台实际可用的 Codex 模型名
```

列出并切换 Provider：

```bash
docker compose run --rm --entrypoint cc-switch codex-agent \
  --app codex provider list

docker compose run --rm --entrypoint cc-switch codex-agent \
  --app codex provider switch <ID>
```

检查最终配置，不显示 API Key：

```bash
grep -E '^(model|model_provider)|base_url|wire_api' data/codex/config.toml
```

应包含：

```text
base_url = "http://sub2api:8080/v1"
wire_api = "responses"
```

CC Switch 只写配置，`CC_SWITCH_PROXY` 保持为 `0`。

### 7. 启动

```bash
docker compose up -d
docker compose ps
docker compose logs --tail=100 codex-web
```

测试中转和只读接口：

```bash
docker compose exec codex-web codex exec \
  --skip-git-repo-check -C /workspace '只回复：Sub2API 连接成功'

docker compose exec codex-web /workspace/hostctl status
```

## 本地验收新页面

先不要改 Tailscale。Windows PowerShell 建立临时隧道：

```powershell
ssh -L 17682:127.0.0.1:7682 ubuntu@192.168.x.x
```

保持窗口开启，浏览器访问：

```text
http://127.0.0.1:17682
```

输入用户名 `admin` 和 `secrets/web_password.txt` 中的密码，然后依次检查：

1. 顶部能显示温度、内存、系统盘、电池和三个服务状态。
2. 发送“检查服务器状态”能收到回答。
3. 刷新页面后历史会话仍然存在。
4. 左侧会话列表可以新建、切换和删除会话。

这个测试不影响正在使用的 `7681` 网页终端。

## 切换手机入口

本地验收通过后，在 Ubuntu 执行：

```bash
sudo tailscale serve --bg 7682
tailscale serve status
```

手机保持登录同一个 Tailscale 网络，继续打开原来的 Tailscale HTTPS 地址即可。
浏览器可能再次询问 Basic Auth，用户名仍是 `admin`。

Android Chrome 可以从菜单选择“添加到主屏幕”或“安装应用”。应用仍然实时连接
Ubuntu，不会把聊天记录、API 响应或网页密码缓存到手机离线存储中。

需要临时切回旧 ttyd 时：

```bash
sudo tailscale serve --bg 7681
tailscale serve status
```

再次切回聊天页面：

```bash
sudo tailscale serve --bg 7682
```

## 开机自启检查

```bash
sudo systemctl enable --now docker tailscaled
docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' codex-agent codex-web
docker compose ps
```

两个容器都应显示 `unless-stopped`。重启 Ubuntu 后验证：

```bash
sudo reboot
```

重新连接后：

```bash
cd "$HOME/pocket-codex"
docker compose ps
tailscale serve status
systemctl is-active palworld sakurafrp-palworld tailscaled
```

## 日常命令

```bash
cd "$HOME/pocket-codex"

docker compose ps
docker compose logs -f --tail=100 codex-web
docker compose restart codex-web
docker stats --no-stream sub2api codex-agent codex-web
du -sh data/codex-web
```

旧终端仍可使用：

```bash
docker compose exec codex-agent codex resume --last
```

不要在聊天页面和 ttyd 中同时操作同一个 Codex 会话。

## 资源占用

- `codex-web` 待机通常约 `30-70MB` 内存。
- 执行 Codex 时通常上升到数百 MB，容器上限为 `2GB`。
- Web 页面代码不到 `1MB`，会话历史以 JSON 保存，初期通常只有几 MB。
- 两个容器共用同一个镜像，增加的硬盘占用主要是少量容器层和会话数据。
- 状态栏每 60 秒读取一次本机数据，不调用模型，不消耗 Sub2API 额度。

实际数据以这两条命令为准：

```bash
docker stats --no-stream codex-agent codex-web
docker system df
```

## 安全边界

- `7681` 和 `7682` 都只绑定 Ubuntu 的 `127.0.0.1`。
- 手机入口使用 Tailscale HTTPS，不用公网 HTTP，也不需要域名备案。
- Web 服务有 Basic Auth、同源检查、请求限流和 8000 字符消息上限。
- 模型回复用安全 DOM 渲染，不会当作 HTML 执行。
- Codex 可以在非 root Docker 容器内联网查询，但 `/workspace` 以只读方式挂载。
- 当前网络访问 GitHub 时应优先使用 `api.github.com` 和 `raw.githubusercontent.com`。
- 容器没有 Docker Socket、Ubuntu 根目录、`sudo` 或任意宿主机 Shell。
- `hostctl` 只允许预先写死的只读查询。
- Sub2API 专用 Key 应设置额度，不要发到聊天或截图中。
