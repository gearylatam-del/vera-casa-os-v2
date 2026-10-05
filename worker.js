import { HTML } from "./panel.js";
import { buildContext, shouldForceNoApproval } from "./logic.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    await ensureTables(env);

    if (path === "/" && request.method === "GET") return html(HTML);
    if (path === "/api/health" && request.method === "GET") return health(env);
    if (path === "/api/shopify/install" && request.method === "GET") return shopifyInstall(env);
    if (path === "/api/shopify/callback" && request.method === "GET") return shopifyCallback(request, env);
    if (path === "/api/shopify/products" && request.method === "GET") return shopifyProducts(env);
    if (path === "/api/shopify/status" && request.method === "GET") return shopifyStatus(env);
    if (path === "/api/shopify/disconnect" && request.method === "POST") return shopifyDisconnect(env);
    if (path === "/api/pricing/candidates" && request.method === "GET") return pricing(url);
    if (path === "/api/memory/clear" && request.method === "POST") return memoryClear(request, env);
    if (path === "/api/memory" && request.method === "GET") return memoryGet(url, env);
    if (path === "/api/approvals" && request.method === "GET") return approvalsList(url, env);
    if (path === "/api/approvals/decide" && request.method === "POST") return approvalsDecide(request, env);
    if (path === "/api/chat" && request.method === "POST") return chat(request, env);

    return new Response("Not found", { status: 404 });
  },
};

// ============ YARDIMCILAR ============

function html(content) {
  return new Response(content, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function ensureTables(env) {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`
    ).run();
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        decided_at INTEGER
      )`
    ).run();
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS shopify_auth (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`
    ).run();
  } catch (e) {}
}

// ============ HEALTH ============

async function health(env) {
  const tokenRow = await env.DB.prepare(
    `SELECT value FROM shopify_auth WHERE key = 'access_token'`
  ).first();
  return Response.json({
    ok: true,
    service: "VERA CASA OS",
    version: "0.6.0",
    model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    supplier: "La Casa de Kadir",
    freeShippingThresholdBs: 500,
    memory: "d1",
    approvals: true,
    smartPricing: true,
    shopify: {
      configured: !!(env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET),
      store: env.SHOPIFY_STORE || null,
      connected: !!tokenRow,
    },
  });
}

// ============ SHOPIFY ============

async function shopifyInstall(env) {
  if (!env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) {
    return new Response("Shopify yapılandırılmamış", { status: 500 });
  }
  const state = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO shopify_auth (key, value, created_at) VALUES ('state', ?, ?)`
  ).bind(state, Date.now()).run();

  const redirectUri = "https://vera-casa-os-v2.geary-latam.workers.dev/api/shopify/callback";
  const scopes = "read_products,write_products,read_orders,write_orders,read_customers,read_inventory,write_inventory,read_locations,read_price_rules,write_price_rules";

  const authUrl =
    `https://${env.SHOPIFY_STORE}/admin/oauth/authorize` +
    `?client_id=${env.SHOPIFY_CLIENT_ID}` +
    `&scope=${scopes}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  return Response.redirect(authUrl, 302);
}

async function shopifyCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const shop = url.searchParams.get("shop");

  if (!code || !shop) return new Response("Eksik parametre (code/shop)", { status: 400 });

  const savedState = await env.DB.prepare(
    `SELECT value FROM shopify_auth WHERE key = 'state'`
  ).first();

  if (!savedState || savedState.value !== state) {
    return new Response("Geçersiz state", { status: 400 });
  }

  const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET,
      code: code,
    }),
  });

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text();
    return new Response(`Token alınamadı: ${errText}`, { status: 500 });
  }

  const tokenData = await tokenResponse.json();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO shopify_auth (key, value, created_at) VALUES ('access_token', ?, ?)`
  ).bind(tokenData.access_token, Date.now()).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO shopify_auth (key, value, created_at) VALUES ('shop', ?, ?)`
  ).bind(shop, Date.now()).run();

  return Response.redirect(
    "https://vera-casa-os-v2.geary-latam.workers.dev/?shopify=connected",
    302
  );
}

async function shopifyProducts(env) {
  const tokenRow = await env.DB.prepare(
    `SELECT value FROM shopify_auth WHERE key = 'access_token'`
  ).first();
  const shopRow = await env.DB.prepare(
    `SELECT value FROM shopify_auth WHERE key = 'shop'`
  ).first();

  if (!tokenRow || !shopRow) {
    return Response.json({ ok: false, error: "shopify_not_connected" }, { status: 400 });
  }

  try {
    const r = await fetch(
      `https://${shopRow.value}/admin/api/2024-10/products.json?limit=20`,
      { headers: { "X-Shopify-Access-Token": tokenRow.value } }
    );
    const data = await r.json();
    return Response.json({ ok: true, count: (data.products || []).length, products: data.products || [] });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}

async function shopifyStatus(env) {
  const tokenRow = await env.DB.prepare(
    `SELECT value, created_at FROM shopify_auth WHERE key = 'access_token'`
  ).first();
  const shopRow = await env.DB.prepare(
    `SELECT value FROM shopify_auth WHERE key = 'shop'`
  ).first();

  return Response.json({
    ok: true,
    connected: !!tokenRow,
    shop: shopRow?.value || null,
    connected_at: tokenRow?.created_at || null,
  });
}

async function shopifyDisconnect(env) {
  await env.DB.prepare(`DELETE FROM shopify_auth WHERE key IN ('access_token', 'shop')`).run();
  return Response.json({ ok: true });
}

// ============ FİYAT ============

function pricing(url) {
  const listPrice = Number(url.searchParams.get("listPrice"));
  if (!Number.isFinite(listPrice) || listPrice <= 0) {
    return Response.json({ error: "valid_listPrice_required" }, { status: 400 });
  }
  return Response.json({
    ok: true,
    supplier_list_price: listPrice,
    supplier_cost: listPrice * 0.80,
    candidate_A: listPrice * 1.20,
    candidate_B: listPrice * 1.25,
    min_profit_rule: listPrice * 0.20,
  });
}

// ============ HAFIZA ============

async function memoryClear(request, env) {
  const body = await request.json().catch(() => ({}));
  const sessionId = body.session_id || "fatih";
  try {
    await env.DB.prepare(`DELETE FROM messages WHERE session_id = ?`).bind(sessionId).run();
    await env.DB.prepare(`DELETE FROM approvals WHERE session_id = ?`).bind(sessionId).run();
    return Response.json({ ok: true, cleared: sessionId });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}

async function memoryGet(url, env) {
  const sessionId = url.searchParams.get("session_id") || "fatih";
  try {
    const result = await env.DB.prepare(
      `SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT 100`
    ).bind(sessionId).all();
    return Response.json({ ok: true, session_id: sessionId, count: (result.results || []).length, messages: result.results || [] });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}

// ============ ONAYLAR ============

async function approvalsList(url, env) {
  const sessionId = url.searchParams.get("session_id") || "fatih";
  try {
    const result = await env.DB.prepare(
      `SELECT id, description, status, created_at FROM approvals WHERE session_id = ? AND status = 'pending' ORDER BY created_at DESC`
    ).bind(sessionId).all();
    return Response.json({ ok: true, approvals: result.results || [] });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}

async function approvalsDecide(request, env) {
  try {
    const body = await request.json();
    const { id, decision } = body;
    if (!id || !["approved", "rejected"].includes(decision)) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    await env.DB.prepare(
      `UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?`
    ).bind(decision, Date.now(), id).run();

    const approvalRow = await env.DB.prepare(
      `SELECT description FROM approvals WHERE id = ?`
    ).bind(id).first();

    if (approvalRow) {
      const verdict = decision === "approved" ? "ONAYLANDI" : "REDDEDİLDİ";
      const infoMsg = `[Sistem]: Fatih "${approvalRow.description}" işlemini ${verdict}.`;
      await env.DB.prepare(
        `INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'user', ?, ?)`
      ).bind("fatih", infoMsg, Date.now()).run();
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}

// ============ SOHBET ============

async function chat(request, env) {
  try {
    const body = await request.json();
    const message = (body.message || "").trim();
    const sessionId = (body.session_id || "fatih").trim();
    if (!message) return Response.json({ error: "message_required" }, { status: 400 });

    const historyResult = await env.DB.prepare(
      `SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 20`
    ).bind(sessionId).all();
    const history = (historyResult.results || []).reverse();

    await env.DB.prepare(
      `INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'user', ?, ?)`
    ).bind(sessionId, message, Date.now()).run();

    const shopifyToken = await env.DB.prepare(
      `SELECT value FROM shopify_auth WHERE key = 'access_token'`
    ).first();
    const shopifyContext = shopifyToken
      ? "\n\nDURUM: Shopify bağlı."
      : "\n\nDURUM: Shopify henüz bağlı değil.";

    // Akıllı ön hesaplama
    const smartContext = buildContext(message);

    const messages = [
      { role: "system", content: SYSTEM_PROMPT + shopifyContext + smartContext },
      ...history,
      { role: "user", content: message },
    ];

    const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages,
      max_tokens: 900,
      temperature: 0.5,
    });

    const rawAnswer = extractText(result);
    const { answer, created } = await processApprovals(env, sessionId, rawAnswer, message);

    await env.DB.prepare(
      `INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)`
    ).bind(sessionId, answer, Date.now()).run();

    return Response.json({
      ok: true,
      answer,
      session_id: sessionId,
      approvals_created: created,
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: err.message || String(err),
    }, { status: 500 });
  }
}

async function processApprovals(env, sessionId, text, userMessage) {
  const regex = /\[ONAY:\s*([^\]]+)\]/g;

  // Kod tarafı güvence: bilgi sorusuysa onay marker'larını yoksay
  if (shouldForceNoApproval(userMessage)) {
    const cleaned = text.replace(regex, "").replace(/\n{3,}/g, "\n\n").trim();
    return { answer: cleaned || text, created: [] };
  }

  const matches = [...text.matchAll(regex)];
  const created = [];

  for (const m of matches) {
    const description = m[1].trim().slice(0, 200);
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(
        `INSERT INTO approvals (id, session_id, description, status, created_at) VALUES (?, ?, ?, 'pending', ?)`
      ).bind(id, sessionId, description, Date.now()).run();
      created.push({ id, description });
    } catch (e) {}
  }

  const cleaned = text.replace(regex, "").replace(/\n{3,}/g, "\n\n").trim();
  return { answer: cleaned || text, created };
}

function extractText(result) {
  if (typeof result === "string") return result;
  if (!result) return "Cevap üretilemedi.";

  const c1 = result?.choices?.[0]?.message?.content;
  if (typeof c1 === "string" && c1.trim()) return c1.trim();

  const c2 = result?.choices?.[0]?.message?.reasoning_content;
  if (typeof c2 === "string" && c2.trim()) return c2.trim();

  const c3 = result?.response;
  if (typeof c3 === "string" && c3.trim()) return c3.trim();

  const c4 = result?.output_text;
  if (typeof c4 === "string" && c4.trim()) return c4.trim();

  return "Fatih, yanıtı şu anda tamamlayamadım. Tekrar deneyelim.";
}

const SYSTEM_PROMPT = `Sen Vera'sın — Vera Casa Bolivia'nın merkezi AI yöneticisi.
Fatih ile Türkçe konuşursun. Müşteriler Bolivya İspanyolcası konuşur.

KİMLİK:
- JARVIS tarzı: sakin, zeki, kendinden emin, proaktif.
- Fatih'e "sen" diye hitap edersin.
- Kendinden üçüncü şahıs olarak bahsetmezsin.

ÜSLUP:
- Kısa konuş. En fazla 3-4 cümle.
- Sade Türkçe. Süsleme yapma.
- Şu kelimeleri KULLANMA: emisyon, yörünge, telemetry, mekanizma, entegre, optimum, sinerji, ekosistem, matris, parametre.

İŞ BİLGİSİ:
- Dropshipping. Tedarikçi: La Casa de Kadir.
- Tedarikçi indirimi: %20 (liste × 0.80 = maliyet).
- Aday fiyat A: liste × 1.20
- Aday fiyat B: liste × 1.25
- Minimum hedef kâr: liste fiyatının %20'si.
- Kapıda ödeme (COD) aktif.
- 500 Bs ve üzeri siparişte müşteriye kargo ÜCRETSİZ.
- 500 Bs altı siparişte kargo 22,50 Bs (COD dahil).
- Kargo: Correos Bolivia.
- Shopify mağazası: veracasabolivia.myshopify.com

ONAY SİSTEMİ:
Onay SADECE şu işlemler için istenir:
- Para harcama
- Reklam başlatma / bütçe değiştirme
- Ürün yayınlama (Shopify canlı)
- Gerçek kargo oluşturma
- Refund / iade
- Tema değiştirme
- Ücretli abonelik başlatma

BİLGİ SORULARI İÇİN ONAY İSTEME. Bilgi soruları:
- Fiyat/kargo hesaplama
- Ürün listeleme
- Genel sohbet
- Durum sorusu

Kritik işlem istendiğinde cevabın SONUNA ayrı satır olarak:
[ONAY: kısa açıklama]

Örnek:
Kullanıcı: "Bu ürünü yayınla"
Cevap: "Ürün hazır. Onayını bekliyorum.
[ONAY: X ürününü Shopify'da yayınla]"

DÜRÜSTLÜK:
- Bilmediğin şeyi uydurma.
- Yapmadığın işi "yaptım" diye anlatma.
- Kargo/pazar/stok bilgilerini uydurma.

YASAKLAR:
- JSON gösterme.
- Ham reasoning gösterme.
- İngilizce teknik terim kullanma.`;
