/**
 * Angkor Travel · AI 客服代理（Cloudflare Worker）
 *
 * 作用：把网站的 /ai 请求转发到 OpenAI 兼容的大模型接口，API Key 只存在 Worker 的
 * 环境变量里，不会出现在 GitHub Pages 的前端代码中。
 *
 * 部署步骤：
 *   1. 打开 https://dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. 粘贴本文件全部内容，Save & Deploy
 *   3. Settings → Variables and Secrets 添加：
 *        AI_API_KEY   （必填，你的模型密钥）
 *        AI_BASE_URL  （可选，默认豆包/火山方舟 https://ark.cn-beijing.volces.com/api/v3）
 *        AI_MODEL     （可选，默认 doubao-seed-1-6-flash-250828）
 *        ALLOWED_ORIGIN（可选，默认 https://mrkk9919.github.io）
 *   4. 记下 Worker 地址，例如 https://angkor-ai.<你的子域>.workers.dev
 *   5. 告诉维护者这个地址，填进 index.html 的 AI_PROXY（或在浏览器控制台
 *      localStorage.setItem('atc_ai_proxy','https://…/ai') 先试）
 *
 * 请求：POST /ai  {"messages":[{"role":"user","content":"..."}]}
 * 返回：{"reply":"..."}
 */

export default {
  async fetch(request, env) {
    const allow = env.ALLOWED_ORIGIN || 'https://mrkk9919.github.io';
    const cors = {
      'access-control-allow-origin': allow,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method === 'GET') {
      return json({ ok: true, hasKey: !!env.AI_API_KEY }, 200, cors);
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, cors);
    }
    if (!env.AI_API_KEY) {
      return json({ error: 'ai_not_configured' }, 503, cors);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ error: 'invalid_json' }, 400, cors);
    }

    const messages = Array.isArray(payload.messages) ? payload.messages.slice(-12) : [];
    if (!messages.length) return json({ error: 'messages_required' }, 400, cors);

    const base = String(env.AI_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
    const model = payload.model || env.AI_MODEL || 'doubao-seed-1-6-flash-250828';

    const upstream = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + env.AI_API_KEY
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        max_tokens: 400
      })
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return json({ error: (data.error && data.error.message) || 'upstream_error' }, 502, cors);
    }
    const reply = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    return json({ reply: reply || '' }, 200, cors);
  }
};

function json(value, status, headers) {
  return new Response(JSON.stringify(value), {
    status,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers)
  });
}
