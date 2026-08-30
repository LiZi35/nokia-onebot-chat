# nokia-onebot-chat

由 opencode + Deepseek 编写

面向 OneBot v11（NapCat）的聊天网页应用，重点支持 Nokia 108 4G 等**完全不支持 JavaScript** 的老功能机浏览器。

核心原则：服务端渲染（SSR）+ 标准 HTML `<form>` 提交 + Post/Redirect/Get 重定向，JavaScript 仅作可选增强，不承担任何核心功能。

## 技术栈

- Node.js + TypeScript（严格模式）
- Koa + @koa/router + koa-bodyparser + koa-session + koa-helmet
- Nunjucks（服务端模板，默认 HTML 转义）
- ws（WebSocket 客户端）
- zod（配置与输入校验）
- better-sqlite3（SQLite 持久化：登录态 + 聊天记录）
- Vitest / ESLint / Prettier

## 安装与启动

```bash
# 使用 pnpm
pnpm install

# 开发模式（tsx watch）
pnpm dev

# 生产构建并启动
pnpm build
pnpm start
```

默认监听 `http://localhost:3000`，健康检查接口为 `GET /healthz`。

## 环境变量

完整列表见 `.env.example`。最小启动配置：

```env
ONEBOT_WS_URL=ws://127.0.0.1:3001
PORT=3000
SESSION_KEYS=请改为随机密钥
AUTH_USERNAME=admin
AUTH_PASSWORD=请改为自己的密码
```

- `ONEBOT_WS_URL`：OneBot v11 WebSocket 服务地址，默认 `ws://127.0.0.1:3001`。
- `DB_PATH`：SQLite 数据库文件路径，默认 `./data/chat.db`。
- `SESSION_KEYS`：Cookie 签名密钥，逗号分隔多个密钥；生产环境必须改为随机值。
- `COOKIE_SECURE`：强制给 Cookie 加 `Secure` 标志；默认 `false`（自动按连接是否为 HTTPS 判断）。
- `TRUST_PROXY`：位于 nginx 等反向代理之后时设为 `true`，信任 `X-Forwarded-*` 头；默认 `false`。
- `AUTH_USERNAME` / `AUTH_PASSWORD`：登录账号与密码；两者同时设置即启用登录鉴权，留空则禁用。

## nginx 反向代理

应用本身不依赖客户端 WebSocket（OneBot 连接由服务端向外发起），因此 nginx 只需做普通 HTTP 反代。所有重定向与页面链接均为相对路径，不硬编码域名。

```nginx
server {
    listen 443 ssl;
    server_name chat.example.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
    }
}
```

启动环境变量需配置：

```env
TRUST_PROXY=true      # 信任 nginx 传入的 X-Forwarded-* 头
# COOKIE_SECURE 可不设（默认自动判断），也可显式设为 true
```

> 注意：`TRUST_PROXY=true` 后应用会信任 `X-Forwarded-*` 头，请确保仅 nginx 能访问该端口（例如应用只监听 `127.0.0.1`），避免客户端伪造这些头。

## SQLite 持久化

- 使用 `better-sqlite3`（同步 API，WAL 模式）保存两类数据：
  - `sessions` 表：登录态、CSRF 令牌与会话数据（koa-session 自定义 store），登录状态在服务重启后依然有效。
  - `messages` 表：聊天记录，每个会话保留最近 `MESSAGES_PER_SESSION` 条，服务重启后仍可查看。
- 内存仍是缓存：会话数上限 `MAX_SESSIONS`、单会话消息数上限 `MESSAGES_PER_SESSION`；数据库按会话截断历史，避免无限增长。

## 登录鉴权

- 应用启动时通过 `dotenv` 自动读取 `.env` 文件。
- 设置了 `AUTH_USERNAME` 与 `AUTH_PASSWORD` 后，除 `/login` 和 `/healthz` 外的所有页面都需要登录。
- 登录采用 **POST 表单 + Cookie Session**（见 `NOKIA108-COMPATIBILITY.md`：Basic Auth 在该设备上无法携带密码，故不使用）。
- 登录表单同样带 CSRF 校验；密码使用 `timingSafeEqual` 恒时比较。
- `GET /logout` 退出登录。

## NapCat / OneBot WebSocket 配置

在 NapCat 的 OneBot11 网络配置中启用一个 **WebSocket 服务**，地址与本应用 `ONEBOT_WS_URL` 一致即可。

> 注意：本仓库联调环境里，NapCat 运行在 Docker 容器中，其 OneBot11 WebSocket 服务被配置为绑定容器内 `127.0.0.1:3001`，宿主机 `ws://localhost:3001` 默认无法直达。联调时通过一个容器内 TCP 转发桥接（`172.17.0.2:3001 -> 127.0.0.1:3001`）打通。若希望长期稳定使用，建议在 NapCat 配置中把 OneBot11 WebSocket 服务的 host 改为 `0.0.0.0`。

## 无 JavaScript 设计说明

- 所有页面均为服务端渲染的静态 HTML，包含内嵌 `<style>`，无 `<script>`。
- 导航使用普通 `<a>` 链接，消息发送使用 `<form method="post">`。
- 发送成功后通过 302 重定向回到会话页（Post/Redirect/Get），刷新不会重复提交。
- 表单校验、目标校验、CSRF 校验、消息长度限制全部在服务端完成。

## Nokia 108 兼容性取舍

依据 `NOKIA108-COMPATIBILITY.md` 实测报告：

- 使用 HTML 4.01 Transitional 文档类型，单栏自然文档流。
- 不使用 float / 定位 / Flexbox / Grid / 媒体查询 / `meta viewport` 依赖。
- 只使用基础颜色、边框、间距、文字样式与表格布局。
- 图片、图标字体、外部 CDN 资源均不作为必要依赖。
- 不使用 Basic Auth，改用 POST 登录表单 + Cookie Session（会话同时承载 CSRF 令牌、登录态与闪现提示）。
- 针对该设备会重复发送 `Content-Type` 请求头的现象，`normalizeContentType` 中间件在 body 解析前将其归一化。
- 服务端返回 `text/html; charset=UTF-8`。

## 分层结构

```
src/
  config.ts              # zod 环境变量校验
  logger.ts              # 分级日志（不记录敏感内容）
  onebot/                # OneBot v11 协议封装（可注入 socket 以便测试）
    client.ts            # 连接、断线重连、echo 匹配、超时、事件分发
    ws-socket.ts         # ws 库适配
    message-format.ts    # 消息段提取纯文本、发送者名称解析
    types.ts / errors.ts / socket.ts
  domain/
    message-store.ts     # 内存会话/消息存储（LRU 淘汰、容量上限、持久化接口）
    chat-service.ts      # 业务服务：目录、会话、发送
  db/
    database.ts          # better-sqlite3 打开与建表
    session-store.ts     # 登录态/会话的 SQLite 存储
    message-repository.ts# 聊天记录的 SQLite 存储
  web/
    app.ts               # Koa 组装（session、helmet、CSRF、路由）
    routes.ts            # 页面与接口路由
    middleware.ts        # content-type 归一化、CSRF、错误处理
    views.ts             # Nunjucks 模板与视图格式化
    csrf.ts / session.ts / validation.ts / format.ts
  index.ts               # 入口
```

## 测试与代码质量

```bash
pnpm typecheck     # TypeScript 严格类型检查
pnpm lint          # ESLint（TypeScript 规则）
pnpm format        # Prettier 格式化
pnpm format:check  # 格式检查
pnpm test          # Vitest 单元/集成测试
pnpm build         # 编译到 dist/
```

测试覆盖：配置校验、消息格式转换、消息存储（去重/容量/淘汰）、OneBot 客户端（echo 匹配/超时/重连/断连）、业务服务（发送/校验/事件入库）、路由（SSR/CSRF/PRG/XSS 转义）。

## 已知限制

- 历史消息：OneBot v11 标准接口无法可靠拉取历史消息，应用仅展示「本次运行期间收到/发出并已持久化的消息」，并在页面明确说明，不会伪造服务端历史。
- 群聊场景：联调环境的账号暂无群聊数据，群聊路径已实现并有单元测试，但未经真实群消息验证。
- 聊天记录持久化受 `MESSAGES_PER_SESSION` 截断，超出部分会被删除（不是无限保存）。
- 本应用面向纯文本消息，图片等富媒体消息在会话中显示为 `[非文本消息]`。
