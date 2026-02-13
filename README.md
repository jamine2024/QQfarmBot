# 紧急通知：已经有人反馈封号了 低调使用，被举报必封

## WebUI 可视化管理

<img width="1918" height="888" alt="image" src="https://github.com/user-attachments/assets/a3d115aa-5bd4-4f12-b43e-411e781204f4" />
<img width="1919" height="897" alt="image" src="https://github.com/user-attachments/assets/f0acb66a-0b7f-47b4-9cb9-48ee3015752d" />
<img width="1889" height="779" alt="QQ20260212-121430" src="https://github.com/user-attachments/assets/2350e643-65e3-4c39-9e14-971a5ef3c01d" />
<img width="500" height="266" alt="QQ20260212-122439" src="https://github.com/user-attachments/assets/c4072776-d8cc-4340-a49c-c6cd7daea75e" />
<img width="972" height="585" alt="image" src="https://github.com/user-attachments/assets/bec2ec04-0409-4405-9536-a1d6afb97ec9" />


## 一些提醒：请勿拿作者原版的程序去倒卖，WebUI也不行

# QQ经典农场 挂机脚本

基于 Node.js 的 QQ/微信 经典农场小程序自动化挂机脚本。通过分析小程序 WebSocket 通信协议（Protocol Buffers），实现全自动农场管理。
本脚本基于ai制作，必然有一定的bug，遇到了建议自己克服一下，后续不一定会更新了

## 功能特性

### 自己农场

- **自动收获** — 检测成熟作物并自动收获
- **自动铲除** — 自动铲除枯死/收获后的作物残留
- **自动种植** — 收获/铲除后自动购买种子并种植（当前设定为种植白萝卜，因为经过数据计算(脚本可以自动种植-收获)，白萝卜的收益是最高的（经验收益）不喜欢的自己修改一下即可
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
- **邀请码处理** — 启动时自动处理 share.txt 中的邀请链接（微信环境，share.txt有示例，是小程序的path）
- **状态栏显示** — 终端顶部固定显示平台/昵称/等级/经验/金币
- **经验进度** — 显示当前等级经验进度
- **心跳保活** — 自动维持 WebSocket 连接

### 开发工具

- **[PB 解码工具](#pb-解码工具)** — 内置 Protobuf 数据解码器，方便调试分析
- **[经验分析工具](#经验分析工具)** — 分析作物经验效率，计算最优种植策略

---

## 使用

### 获取登录 Code

你需要从小程序中抓取 code。可以通过抓包工具（如 Fiddler、Charles、mitmproxy 等）获取 WebSocket 连接 URL 中的 `code` 参数。

### 扫码获取登录 Code（可选，QQ 农场）

本项目已集成「扫码获取 code 并自动填写」能力（WebUI 内点击“扫码获取”即可）。该能力依赖独立的扫码服务 QRLib。

#### 运行 QRLib

在服务器上启动 QRLib（示例）：

```bash
node src/server.js
```

默认监听 `http://127.0.0.1:5656`。

#### WebUI 如何访问 QRLib

WebUI 不会直接访问 `http://localhost:5656`（浏览器里的 localhost 永远指向你本机，线上部署会失效），而是通过 Admin Server 进行同源转发：

- `/api/qrlib/qr/create` -> `${QRLIB_BASE_URL}/api/qr/create`
- `/api/qrlib/qr/check` -> `${QRLIB_BASE_URL}/api/qr/check`

这两个接口需要先登录 WebUI（会校验 `Authorization: Bearer <token>`），否则会返回 `401 UNAUTHORIZED`。

#### 配置 QRLIB_BASE_URL（可选）

默认值为 `http://127.0.0.1:5656`。如果 QRLib 不在同一台机器或端口不同，可在启动 Admin Server 时设置：

```bash
QRLIB_BASE_URL=http://127.0.0.1:5656 bash run.sh
```

## WebUI 可视化管理（可选）

本项目提供一个 Web 管理控制台（Admin Server + Admin Web），支持：

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

### 一键打包（生成可部署目录）

```bash
npm run release:web
```

打包产物在：

```
dist/release-web/
```

### Linux 部署（推荐用 release-web）

1. 把 `dist/release-web/` 整个目录上传到服务器（例如 `/www/wwwroot/qqfarm/`）

2. 进入目录启动：

```bash
cd /www/wwwroot/qqfarm
chmod +x run.sh
bash run.sh
```

默认监听 `0.0.0.0:8787`，你也可以改为仅本机监听（配合反代更安全）：

```bash
HOST=127.0.0.1 PORT=8787 bash run.sh
```

3. 首次运行初始化管理员账号

打开浏览器访问：

```
http://你的服务器IP:8787/
```

系统会提示“初始化管理员”，自行设置账号密码后进入控制台。

### 反向代理（Nginx / WebSocket）

建议不要直接暴露 Node 端口，改用 Nginx 反向代理到 `127.0.0.1:8787`，并开启 HTTPS。

下面示例会把：

- Web 静态页面 `/`
- API `/api/`
- WebSocket `/ws`

全部代理到后端（后端会自动托管前端静态文件，并提供 API 与 WS）。

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

  # 证书路径按你的实际情况填写（宝塔/Let’s Encrypt 都行）
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

如果你使用宝塔面板：

- 先把 Node 服务用 `HOST=127.0.0.1` 启动起来
- 在站点里开启 HTTPS
- 反向代理到 `http://127.0.0.1:8787`，并打开 WebSocket 支持

## 注意事项

1. **登录 Code 有效期有限**，过期后需要重新抓取
2. **请合理设置巡查间隔**，过于频繁可能触发服务器限流
3. **微信环境**才支持邀请码和好友申请功能
4. **QQ环境**下code支持多次使用
5. **WX环境**下code不支持多次使用，请抓包时将code拦截掉

## 免责声明

本项目仅供学习和研究用途。使用本脚本可能违反游戏服务条款，由此产生的一切后果由使用者自行承担。

![Star History Chart](https://api.star-history.com/svg?repos=linguo2625469/qq-farm-bot&type=Date&theme=light)

## License

MIT
