# 紧急通知

已经有人反馈封号了：低调使用，被举报必封。

另外提醒：请勿拿作者原版的程序去倒卖，WebUI 也不行。

# QQ经典农场 挂机脚本（含 WebUI）

基于 Node.js 的 QQ/微信 经典农场小程序自动化挂机脚本。通过分析小程序 WebSocket 通信协议（Protocol Buffers），实现全自动农场管理。  
本脚本基于 AI 制作，必然有一定的 bug，遇到了建议自己克服一下，后续不一定会更新。

## WebUI 预览

<img width="1682" height="876" alt="image" src="https://github.com/user-attachments/assets/4e05a3bf-189a-4e42-a6ef-14c492b80089" />
<img width="1253" height="841" alt="image" src="https://github.com/user-attachments/assets/a9ebb510-b5cb-403b-a152-34f052b58471" />
<img width="1272" height="716" alt="image" src="https://github.com/user-attachments/assets/3e3c1627-ff7f-438a-9e79-dcdbedecbb66" />
<img width="1246" height="682" alt="image" src="https://github.com/user-attachments/assets/144325cf-a5e4-465d-8489-bbd7ff89030c" />


## 功能特性

### 自己农场

- **自动收获** — 检测成熟作物并自动收获
- **自动铲除** — 自动铲除枯死/收获后的作物残留
- **自动种植** — 收获/铲除后自动购买种子并种植（当前设定为种植白萝卜；不喜欢可自行修改）
- **自动施肥** — 种植后自动施放普通肥料加速生长
- **自动除草** — 检测并清除杂草
- **自动除虫** — 检测并消灭害虫
- **自动浇水** — 检测缺水作物并浇水
- **自动出售** — 每分钟自动出售仓库中的果实

### 好友农场

- **好友巡查** — 自动巡查好友农场
- **帮忙操作** — 帮好友浇水/除草/除虫
- **自动偷菜** — 偷取好友成熟作物

### 系统功能

- **自动领取任务** — 自动领取完成的任务奖励，支持分享翻倍/三倍奖励
- **自动同意好友** — 微信同玩好友申请自动同意（支持推送实时响应）
- **邀请码处理** — 启动时自动处理 share.txt 中的邀请链接（微信环境，share.txt 有示例，是小程序的 path）
- **状态栏显示** — 终端顶部固定显示平台/昵称/等级/经验/金币
- **经验进度** — 显示当前等级经验进度
- **心跳保活** — 自动维持 WebSocket 连接

### 开发工具

- **[PB 解码工具](#pb-解码工具)** — 内置 Protobuf 数据解码器，方便调试分析
- **[经验分析工具](#经验分析工具)** — 分析作物经验效率，计算最优种植策略

---

## 获取登录 Code

### 抓包获取（通用）

你需要从小程序中抓取 code。可以通过抓包工具（如 Fiddler、Charles、mitmproxy 等）获取 WebSocket 连接 URL 中的 `code` 参数。

### 扫码获取（可选，QQ 农场）

WebUI 已集成「扫码获取 code 并自动填写」（页面内点击“扫码获取”）。该能力依赖独立扫码服务 QRLib。

#### 运行 QRLib

在服务器上启动 QRLib（示例）：

```bash
node src/server.js
```

默认监听 `http://127.0.0.1:5656`。

#### WebUI 如何访问 QRLib

WebUI 不会直接访问 `http://localhost:5656`（浏览器里的 localhost 永远指向你本机，线上部署会失效），而是通过 Admin Server 做同源转发：

- `/api/qrlib/qr/create` -> `${QRLIB_BASE_URL}/api/qr/create`
- `/api/qrlib/qr/check` -> `${QRLIB_BASE_URL}/api/qr/check`

这两个接口需要先登录 WebUI（校验 `Authorization: Bearer <token>`），否则会返回 `401 UNAUTHORIZED`。

#### 配置 QRLIB_BASE_URL（可选）

默认值为 `http://127.0.0.1:5656`。如果 QRLib 不在同一台机器或端口不同，可在启动 Admin Server 时设置：

```bash
QRLIB_BASE_URL=http://127.0.0.1:5656 bash run.sh
```

如果你使用 Docker 部署并且 QRLib 也在 Docker 内：`127.0.0.1` 指向容器自身，不是宿主机。建议把 QRLib 加进同一个 compose，并用 service name 互联，或把 `QRLIB_BASE_URL` 指向宿主机可达地址。

---

## WebUI 可视化管理（可选）

WebUI 由 Admin Server + Admin Web 组成，支持：

- Web 页面启动/停止 bot（输入 code）
- 实时状态面板（WebSocket 推送）
- 日志检索
- 运行配置下发（平台/巡查间隔范围/SMTP 通知等）

### 本地开发（WebUI）

```bash
# 后端（Admin Server）
npm run admin:server

# 前端（Admin Web）
npm run admin:web
```

### 打包 release-web（生成可部署目录）

```bash
npm run release:web
```

产物目录：

```text
dist/release-web/
```

---

## 部署（基于 release-web）

### 方式 A：Linux 直接运行（run.sh）

1. 上传 `dist/release-web/` 整个目录到服务器（例如 `/www/wwwroot/qqfarm/`）
2. 进入目录启动：

```bash
cd /www/wwwroot/qqfarm
chmod +x run.sh
bash run.sh
```

默认监听 `0.0.0.0:8787`。更安全的做法是只监听本机（配合 Nginx 反代）：

```bash
HOST=127.0.0.1 PORT=8787 bash run.sh
```

### 方式 B：systemd 守护进程（推荐）

生产环境建议以守护进程方式运行，避免 SSH 断开后进程退出，并支持开机自启。

1. 创建 service 文件（示例路径：`/etc/systemd/system/qqfarm-web.service`）：

```ini
[Unit]
Description=QQFarm WebUI (release-web)
After=network.target

[Service]
Type=simple
WorkingDirectory=/www/wwwroot/qqfarm
Environment=HOST=127.0.0.1
Environment=PORT=8787
Environment=DATA_DIR=/www/wwwroot/qqfarm/data/admin
Environment=WEB_DIST_DIR=/www/wwwroot/qqfarm/apps/admin-web/dist
Environment=QRLIB_BASE_URL=http://127.0.0.1:5656
ExecStart=/usr/bin/node /www/wwwroot/qqfarm/apps/admin-server/dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

2. 启用并启动：

```bash
systemctl daemon-reload
systemctl enable qqfarm-web
systemctl start qqfarm-web
systemctl status qqfarm-web
```

3. 查看日志：

```bash
journalctl -u qqfarm-web -f
```

### 方式 C：Docker / Compose（推荐）

release-web 产物目录会自动生成：

- `dist/release-web/Dockerfile`
- `dist/release-web/.dockerignore`
- `dist/release-web/docker-compose.yml`

一键打包并构建镜像：

```bash
npm run release:web:docker
```

使用 docker compose 启动（推荐）：

```bash
npm run release:web
cd dist/release-web
docker compose up -d --build
```

默认会映射端口 `8787:8787`，并把数据目录持久化到 `./data`（容器内为 `/data/admin`）。

### 反向代理（Nginx / WebSocket）

建议不要直接暴露 Node 端口，改用 Nginx 反向代理到 `127.0.0.1:8787` 并开启 HTTPS。

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  listen 80;
  server_name box.fiime.cn;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name box.fiime.cn;

  ssl_certificate     /etc/letsencrypt/live/box.fiime.cn/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/box.fiime.cn/privkey.pem;

  client_max_body_size 2m;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
  }
}
```

### 首次初始化管理员账号

首次运行后打开浏览器访问：

```text
http://你的服务器IP:8787/
```

系统会提示“初始化管理员”，自行设置账号密码后进入控制台。

---

## 注意事项

1. **登录 Code 有效期有限**，过期后需要重新抓取
2. **请合理设置巡查间隔**，过于频繁可能触发服务器限流
3. **微信环境**才支持邀请码和好友申请功能
4. **QQ 环境**下 code 支持多次使用
5. **WX 环境**下 code 不支持多次使用，请抓包时将 code 拦截掉

## 免责声明

本项目仅供学习和研究用途。使用本脚本可能违反游戏服务条款，由此产生的一切后果由使用者自行承担。

![Star History Chart](https://api.star-history.com/svg?repos=linguo2625469/qq-farm-bot&type=Date&theme=light)

## License

MIT
