# Angkor Travel

Cambodia tour booking site. Register, complete KYC, book licensed private tours, pay with Wing / ABA / card, and keep vouchers on this device.

Open `index.html` or run the integrated server:

```bash
node server.js
```

The integrated server serves the front end and provides the customer-service API routes under `/api/messages/*`. SQLite persistence is stored in `angkor-travel.sqlite`; configure the official Booking credentials in server environment variables before connecting a production provider.

Admin RBAC endpoints are available under `/api/admin/*`:

- `POST /api/admin/login` — returns a bearer token
- `GET /api/admin/me` — returns the current role and permissions
- `GET /api/admin/permission-matrix` — admin-only role matrix
- `GET /api/admin/users` — admin-only operator list

Demo roles are `admin`, `ops`, `support`, and `finance`. Set `ADMIN_DEMO_PASSWORD`, `ADMIN_OPS_PASSWORD`, `ADMIN_SUPPORT_PASSWORD`, and `ADMIN_FINANCE_PASSWORD` in production; the default `change-me` password is for local development only.


## 客服后端（server.js）

GitHub Pages 只能托管静态文件，不能运行 `server.js`（无常驻进程、无 SQLite 文件）。要让顾客与客服的消息长期保存，需要把后端部署到一台有 Node 22 的服务器：

1. 服务器上以 root 执行：`bash deploy.sh cs.你的域名.com`
   - 自动安装 Node 22（`node:sqlite` 需要）、创建 systemd 服务 `angkor-travel`、nginx 反代、Let's Encrypt 证书
   - 管理员密码自动生成并写入 `/etc/angkor-travel.env`
2. 前端切换到后端模式：把 `index.html`、`admin.html` 里的 `const SUPPORT_API = ''` 改成后端地址（如 `'https://cs.你的域名.com'`），重新混淆后推送
3. 未配置 `SUPPORT_API` 时，前端自动回落到公共中继（ntfy，演示用、无历史、消息明文）

接口（`server.js` 内置）：
- `POST /api/support/session` 建会话（按浏览器 cid 幂等）
- `POST /api/support/message` 发消息（客服回复需要 `Bearer` token）
- `GET /api/support/messages?conversationId=` 取会话全部历史
- `GET /api/support/conversations` 客服收件箱列表（需要 `messages.read` 权限）
- `POST /api/admin/login` 客服登录

## AI 客服机器人（大模型）

聊天页的机器人默认是站内关键词应答（不需要任何服务）。接真大模型时走一个代理，密钥只放代理端。

**方式 A：Cloudflare Worker（推荐，5 分钟，免费）**
1. 打开 dash.cloudflare.com → Workers & Pages → Create Worker，粘贴 `ai-proxy-worker.js` 全文，Deploy
2. 在 Settings → Variables and Secrets 添加 `AI_API_KEY`（必填）、`AI_BASE_URL`、`AI_MODEL`、`ALLOWED_ORIGIN`
3. 得到地址如 `https://angkor-ai.xxx.workers.dev`，把前端 `AI_PROXY` 改成 `'https://angkor-ai.xxx.workers.dev/ai'`，重新混淆推送

**方式 B：已有服务器（`server.js` 已内置接口）**
1. `systemctl edit angkor-travel` 或编辑 `/etc/angkor-travel.env`，加：
   ```
   AI_API_KEY=你的密钥
   AI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
   AI_MODEL=doubao-seed-1-6-flash-250828
   ```
2. 重启服务，接口为 `POST /api/ai/chat`，`{"messages":[...]}` → `{"reply":"..."}`
3. 前端 `AI_PROXY` 填 `https://你的域名/api/ai/chat`（必须 https，Pages 是 https，调 http 会被浏览器拦）

**调试**：浏览器控制台执行
```js
localStorage.setItem('atc_ai_proxy', 'https://…/ai');      // 临时用某个代理
localStorage.removeItem('atc_ai_proxy');                    // 回到关键词应答
```
AI 不通或报错时，聊天会自动回落到关键词应答并提示「AI 暂时不通」，不会让顾客对着空气。

**系统提示词**里已经注入了当前 7 条行程、7 家酒店的价格与规则（KYC、支付方式、接送、48 小时退改），改价格后无需另改提示词。
