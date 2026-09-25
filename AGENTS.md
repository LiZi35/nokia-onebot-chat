# AGENTS.md

面向 OneBot v11（NapCat）的聊天网页，必须兼容 Nokia 108 等不支持 JS 的老功能机。
硬约束：SSR + 标准 `<form>` 提交 + Post/Redirect/Get；页面内不能有 `<script>`，不要用 flex/grid/float/定位/媒体查询/外部 CDN。

## 命令

- 包管理器用 pnpm（以 `pnpm-lock.yaml` 为准）；`pnpm` 不在 PATH 时用 `corepack pnpm <cmd>`。
- `pnpm dev`（tsx watch）。`pnpm build` 之后才能 `pnpm start`——`start` 跑的是 `dist/`，改完 `src/` 不重新 build 就是旧行为。
- `pnpm test`（vitest run）；单文件 `pnpm vitest run test/config.test.ts`；单用例再加 `-t "名称"`。
- 交付前依次执行 `pnpm typecheck && pnpm lint && pnpm test`。仓库没有 CI、没有 git hook，不会自动触发。
- `pnpm-workspace.yaml` 只是 pnpm 设置（允许 better-sqlite3/esbuild 构建脚本），不是 monorepo。
- Prettier 不格式化 `README.md`、`NOKIA108-COMPATIBILITY.md`、`TASK.md`（见 `.prettierignore`）。

## 容易踩的坑

- ESM + NodeNext：所有相对 import 必须带 `.js` 后缀（如 `./config.js`），测试里也一样（`../src/config.js`），漏了会运行时报错。
- `pnpm typecheck` 只检查 `src/**`（tsconfig include）；`test/` 由 Vitest 直接转译、不做类型检查，测试里的类型错误不会被发现。
- 所有 Nunjucks 模板内联在 `src/web/views.ts` 的字符串常量里，靠 `StringLoader` 按名字注册。新增页面必须同时把模板加进同文件的 `sources`，仓库里没有模板目录。autoescape 已开启。
- 建表在 `src/db/database.ts` 用 `CREATE TABLE IF NOT EXISTS`，没有迁移框架。改表结构要自己写迁移，否则已存在的 `data/chat.db` 不会更新。
- `.env` 只在 `src/index.ts` 中经 `import 'dotenv/config'` 加载。测试不要依赖 `.env`：用 `loadConfig({...})`，数据库用 `openDatabase(':memory:')`。
- 配置非法时启动直接打印错误并 `process.exit(1)`；布尔环境变量只认 `true` / `1` / `yes`。
- 鉴权仅在 `AUTH_USERNAME`、`AUTH_PASSWORD` 都非空时启用；只有 `/login`、`/healthz` 免登录；所有 POST（含 `/login`）都要求 session 里的 `_csrf`，缺失返回 403；POST 成功一律 302 回跳（PRG）。
- 群聊中 `@数字` 会转成 OneBot `at` 消息段，私聊保持字面文本；纯文本发送依赖 `auto_escape`。非文本消息渲染为 `[图片]` 等占位符。
- 不要删 `normalizeContentType` 中间件：Nokia 108 会重复发送 `Content-Type`，它负责在 body 解析前归一化。
- README 引用的 `NOKIA108-COMPATIBILITY.md`、`TASK.md` 被 `.gitignore` 排除且当前工作区不存在，不要去找或提交。
- OneBot 连接由服务端主动向外发起（浏览器侧不需要 WS）。NapCat 跑在 Docker 里时 `ws://localhost:3001` 通常不通，需要容器内 TCP 转发或把 OneBot11 WS host 改成 `0.0.0.0`。

## 结构要点

- 入口 `src/index.ts`：加载配置 → 打开 SQLite → 组装 OneBot 客户端 / MessageStore / ChatService → `createApp`。
- 依赖方向：`web/`（Koa 路由与视图）→ `domain/`（ChatService、MessageStore）→ `onebot/`（协议与连接）、`db/`（SQLite）。
- `src/onebot/client.ts` 的 socket 通过 `SocketFactory` 注入；测试用 FakeSocket / FakeClient 替换，全部用例离线运行，不依赖 OneBot、网络或磁盘数据库。
- 路由测试用 supertest agent 保持 session，并从渲染 HTML 中正则抓取 `_csrf`；发消息断言 302 并跟随重定向来验证 PRG。
