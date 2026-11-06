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
