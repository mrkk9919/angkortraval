const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 8000);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || ROOT;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
const db = new DatabaseSync(path.join(DATA_DIR, 'angkor-travel.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS admin_users (username TEXT PRIMARY KEY, display_name TEXT NOT NULL, role TEXT NOT NULL, password TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS conversations (conversation_id TEXT PRIMARY KEY, conversation_key TEXT UNIQUE NOT NULL, order_id TEXT, hotel_id TEXT, created_at TEXT NOT NULL, customer_name TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS messages (message_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, hotel_id TEXT, sender TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, is_redacted INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS message_confirmations (message_id TEXT PRIMARY KEY, confirmed_at TEXT NOT NULL);
`);
function ensureColumn(table, name, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}
ensureColumn('conversations', 'customer_name', 'TEXT');
ensureColumn('conversations', 'updated_at', 'TEXT');

const seedUser = db.prepare('INSERT OR IGNORE INTO admin_users (username, display_name, role, password) VALUES (?, ?, ?, ?)');
seedUser.run('admin', '系统管理员', 'admin', process.env.ADMIN_DEMO_PASSWORD || 'change-me');
seedUser.run('ops', '运营人员', 'operations', process.env.ADMIN_OPS_PASSWORD || 'change-me');
seedUser.run('support', '客服人员', 'support', process.env.ADMIN_SUPPORT_PASSWORD || 'change-me');
seedUser.run('finance', '财务人员', 'finance', process.env.ADMIN_FINANCE_PASSWORD || 'change-me');
const adminTokens = new Map();
const ROLE_PERMISSIONS = {
  admin: ['dashboard.read', 'products.read', 'products.write', 'orders.read', 'orders.write', 'messages.read', 'messages.write', 'kyc.read', 'kyc.write', 'finance.read', 'settings.write', 'users.write'],
  operations: ['dashboard.read', 'products.read', 'products.write', 'orders.read', 'orders.write', 'messages.read', 'messages.write', 'reviews.write'],
  support: ['dashboard.read', 'orders.read', 'messages.read', 'messages.write', 'kyc.read'],
  finance: ['dashboard.read', 'orders.read', 'finance.read', 'finance.write'],
  viewer: ['dashboard.read', 'products.read', 'orders.read', 'messages.read', 'finance.read']
};

function id(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '86400'
};

function json(res, status, value) {
  res.writeHead(status, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, CORS));
  res.end(JSON.stringify(value));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 1024 * 1024) reject(new Error('payload too large')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new Error('invalid json')); } });
    req.on('error', reject);
  });
}

function conversationKey(orderId, hotelId) { return `${orderId || 'guest'}:${hotelId || 'angkor-travel'}`; }

function bearer(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function currentAdmin(req) { return adminTokens.get(bearer(req)); }

function safeUser(row) { return { username: row.username, displayName: row.display_name, role: row.role }; }

function requirePermission(req, permission) {
  const user = currentAdmin(req);
  if (!user) return { status: 401, error: 'admin authentication required' };
  if (!(ROLE_PERMISSIONS[user.role] || []).includes(permission)) return { status: 403, error: 'permission denied', permission };
  return { user };
}

async function api(req, res, url) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, provider: process.env.BOOKING_API_BASE_URL ? 'booking-configured' : 'local-adapter' });

    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      const data = await body(req);
      const user = db.prepare('SELECT username, display_name, role, password FROM admin_users WHERE username = ?').get(String(data.username || ''));
      if (!user || user.password !== String(data.password || '')) return json(res, 401, { error: 'invalid credentials' });
      const token = id('adm');
      adminTokens.set(token, safeUser(user));
      return json(res, 200, { token, user: adminTokens.get(token), permissions: ROLE_PERMISSIONS[user.role] });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/me') {
      const auth = requirePermission(req, 'dashboard.read');
      if (auth.error) return json(res, auth.status, auth);
      return json(res, 200, { user: auth.user, permissions: ROLE_PERMISSIONS[auth.user.role] || [] });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/permission-matrix') {
      const auth = requirePermission(req, 'settings.write');
      if (auth.error) return json(res, auth.status, auth);
      return json(res, 200, { roles: ROLE_PERMISSIONS });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/users') {
      const auth = requirePermission(req, 'users.write');
      if (auth.error) return json(res, auth.status, auth);
      return json(res, 200, { users: db.prepare('SELECT username, display_name AS displayName, role FROM admin_users ORDER BY username').all() });
    }

    if (req.method === 'POST' && url.pathname === '/api/messages/conversations') {
      const data = await body(req);
      const key = conversationKey(data.orderId, data.hotelId);
      let conversation = db.prepare('SELECT conversation_id AS conversationId, order_id AS orderId, hotel_id AS hotelId, created_at AS createdAt FROM conversations WHERE conversation_key = ?').get(key);
      if (!conversation) {
        conversation = { conversationId: id('conv'), orderId: data.orderId || null, hotelId: data.hotelId || null, createdAt: new Date().toISOString() };
        db.prepare('INSERT INTO conversations (conversation_id, conversation_key, order_id, hotel_id, created_at) VALUES (?, ?, ?, ?, ?)').run(conversation.conversationId, key, conversation.orderId, conversation.hotelId, conversation.createdAt);
      }
      return json(res, 200, conversation);
    }

    if (req.method === 'POST' && url.pathname === '/api/messages/send') {
      const data = await body(req);
      if (!data.conversationId || !String(data.content || '').trim()) return json(res, 400, { error: 'conversationId and content are required' });
      const conversation = db.prepare('SELECT conversation_id FROM conversations WHERE conversation_id = ?').get(data.conversationId);
      if (!conversation) return json(res, 404, { error: 'conversation not found' });
      const message = { messageId: id('msg'), conversationId: data.conversationId, hotelId: data.hotelId || null, sender: data.sender || 'customer', content: String(data.content).trim(), createdAt: new Date().toISOString(), isRedacted: false };
      db.prepare('INSERT INTO messages (message_id, conversation_id, hotel_id, sender, content, created_at, is_redacted) VALUES (?, ?, ?, ?, ?, ?, 0)').run(message.messageId, message.conversationId, message.hotelId, message.sender, message.content, message.createdAt);
      return json(res, 201, { message });
    }

    if (req.method === 'GET' && url.pathname === '/api/messages/latest') {
      const conversationId = url.searchParams.get('conversationId');
      const list = db.prepare(`SELECT m.message_id AS messageId, m.conversation_id AS conversationId, m.hotel_id AS hotelId, m.sender, m.content, m.created_at AS createdAt, m.is_redacted AS isRedacted FROM messages m LEFT JOIN message_confirmations c ON c.message_id = m.message_id WHERE m.conversation_id = ? AND c.message_id IS NULL ORDER BY m.created_at DESC LIMIT 100`).all(conversationId);
      return json(res, 200, { messages: list, limit: 100 });
    }

    if (req.method === 'POST' && url.pathname === '/api/messages/latest/confirm') {
      const data = await body(req);
      const conversation = db.prepare('SELECT conversation_id FROM conversations WHERE conversation_id = ?').get(data.conversationId);
      if (!conversation) return json(res, 404, { error: 'conversation not found' });
      const confirm = db.prepare('INSERT OR IGNORE INTO message_confirmations (message_id, confirmed_at) VALUES (?, ?)');
      (data.messageIds || []).forEach(messageId => confirm.run(messageId, new Date().toISOString()));
      return json(res, 200, { confirmed: data.messageIds || [] });
    }

    /* ---------- 客服会话（持久化） ---------- */
    if (req.method === 'POST' && url.pathname === '/api/support/session') {
      const data = await body(req);
      const clientId = String(data.clientId || '').trim();
      const name = String(data.name || '').trim() || 'Guest';
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(clientId)) return json(res, 400, { error: 'clientId required' });
      let conv = db.prepare('SELECT conversation_id AS conversationId, customer_name AS name, created_at AS createdAt FROM conversations WHERE conversation_id = ?').get(clientId);
      if (!conv) {
        const now = new Date().toISOString();
        db.prepare('INSERT INTO conversations (conversation_id, conversation_key, order_id, hotel_id, created_at, customer_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(clientId, 'web:' + clientId, null, 'angkor-travel', now, name, now);
        conv = { conversationId: clientId, name, createdAt: now };
      } else {
        db.prepare('UPDATE conversations SET customer_name = ?, updated_at = ? WHERE conversation_id = ?').run(name, new Date().toISOString(), clientId);
      }
      return json(res, 200, { conversationId: conv.conversationId, name });
    }

    if (req.method === 'POST' && url.pathname === '/api/support/message') {
      const data = await body(req);
      const conversationId = String(data.conversationId || '').trim();
      const content = String(data.content || '').trim();
      const sender = data.sender === 'agent' ? 'agent' : 'customer';
      if (!conversationId || !content) return json(res, 400, { error: 'conversationId and content are required' });
      const conv = db.prepare('SELECT conversation_id FROM conversations WHERE conversation_id = ?').get(conversationId);
      if (!conv) return json(res, 404, { error: 'conversation not found' });
      if (sender === 'agent') {
        const auth = requirePermission(req, 'messages.write');
        if (auth.error) return json(res, auth.status, auth);
      }
      const now = new Date().toISOString();
      const message = { messageId: id('msg'), conversationId, sender, content, createdAt: now };
      db.prepare('INSERT INTO messages (message_id, conversation_id, hotel_id, sender, content, created_at, is_redacted) VALUES (?, ?, ?, ?, ?, ?, 0)').run(message.messageId, conversationId, 'angkor-travel', sender, content, now);
      db.prepare('UPDATE conversations SET updated_at = ? WHERE conversation_id = ?').run(now, conversationId);
      if (sender === 'agent') db.prepare('INSERT OR IGNORE INTO message_confirmations (message_id, confirmed_at) VALUES (?, ?)').run(message.messageId, now);
      return json(res, 201, { message });
    }

    if (req.method === 'GET' && url.pathname === '/api/support/messages') {
      const conversationId = url.searchParams.get('conversationId') || '';
      if (!conversationId) return json(res, 400, { error: 'conversationId required' });
      const rows = db.prepare(`SELECT message_id AS messageId, sender, content, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 500`).all(conversationId);
      return json(res, 200, { messages: rows });
    }

    if (req.method === 'GET' && url.pathname === '/api/support/conversations') {
      const auth = requirePermission(req, 'messages.read');
      if (auth.error) return json(res, auth.status, auth);
      const rows = db.prepare(`
        SELECT c.conversation_id AS conversationId, c.customer_name AS name, c.created_at AS createdAt, c.updated_at AS updatedAt,
               (SELECT content FROM messages m WHERE m.conversation_id = c.conversation_id ORDER BY m.created_at DESC LIMIT 1) AS lastMessage,
               (SELECT count(*) FROM messages m WHERE m.conversation_id = c.conversation_id) AS messageCount,
               (SELECT max(created_at) FROM messages m WHERE m.conversation_id = c.conversation_id) AS lastAt
        FROM conversations c
        WHERE c.conversation_key LIKE 'web:%'
        ORDER BY COALESCE(c.updated_at, c.created_at) DESC
        LIMIT 200`).all();
      return json(res, 200, { conversations: rows });
    }

    /* AI 客服：转发到 OpenAI 兼容接口（豆包/火山方舟、OpenAI、Groq 等）
       环境变量：AI_API_KEY（必填）、AI_BASE_URL、AI_MODEL */
    if (req.method === 'POST' && url.pathname === '/api/ai/chat') {
      const key = process.env.AI_API_KEY;
      if (!key) return json(res, 503, { error: 'ai_not_configured' });
      const payload = await body(req);
      const messages = Array.isArray(payload.messages) ? payload.messages.slice(-12) : [];
      if (!messages.length) return json(res, 400, { error: 'messages_required' });
      const isOpenAI = /^sk-/.test(key);
      const base = (process.env.AI_BASE_URL || (isOpenAI ? 'https://api.openai.com/v1' : 'https://ark.cn-beijing.volces.com/api/v3')).replace(/\/+$/, '');
      const model = payload.model || process.env.AI_MODEL || (isOpenAI ? 'gpt-4o-mini' : 'doubao-seed-1-6-flash-250828');
      const upstream = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: model, messages: messages, temperature: 0.4, max_tokens: 400 })
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) return json(res, 502, { error: (data.error && data.error.message) || 'upstream_error' });
      const reply = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
      return json(res, 200, { reply: reply || '' });
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 400, { error: e.message || 'request failed' });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return json(res, 404, { error: 'not found' });
  const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8'
  };
  const ext = path.extname(file).toLowerCase();
  const cache = /\.(jpg|jpeg|png|webp|svg|ico)$/.test(ext) ? 'public, max-age=604800' : 'no-cache';
  res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': cache });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`Angkor Travel server running at http://localhost:${PORT}`));
