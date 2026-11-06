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
