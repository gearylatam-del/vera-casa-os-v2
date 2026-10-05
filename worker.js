export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Tabloları ilk istekte oluştur
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
    } catch (e) {}

    if (url.pathname === "/") {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "VERA CASA OS",
        version: "0.4.0",
        model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        supplier: "La Casa de Kadir",
        freeShippingThresholdBs: 500,
        memory: "d1",
        approvals: true,
      });
    }

    if (url.pathname === "/api/pricing/candidates") {
      const listPrice = Number(url.searchParams.get("listPrice"));
      if (!Number.isFinite(listPrice) || listPrice <= 0) {
        return Response.json({ error: "valid_listPrice_required" }, { status: 400 });
      }
      const supplierCost = listPrice * 0.80;
      return Response.json({
        ok: true,
        supplier_list_price: listPrice,
        supplier_cost: supplierCost,
        candidate_A: listPrice * 1.20,
        candidate_B: listPrice * 1.25,
        min_profit_rule: listPrice * 0.20,
      });
    }

    if (url.pathname === "/api/memory/clear" && request.method === "POST") {
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

    if (url.pathname === "/api/memory" && request.method === "GET") {
      const sessionId = url.searchParams.get("session_id") || "fatih";
      try {
        const result = await env.DB.prepare(
          `SELECT role, content, created_at FROM messages
           WHERE session_id = ? ORDER BY id ASC LIMIT 100`
        ).bind(sessionId).all();
        return Response.json({ ok: true, session_id: sessionId, count: (result.results || []).length, messages: result.results || [] });
      } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
      }
    }

    // ============ ONAY SİSTEMİ ============

    // Bekleyen onayları listele
    if (url.pathname === "/api/approvals" && request.method === "GET") {
      const sessionId = url.searchParams.get("session_id") || "fatih";
      try {
        const result = await env.DB.prepare(
          `SELECT id, description, status, created_at FROM approvals
           WHERE session_id = ? AND status = 'pending'
           ORDER BY created_at DESC`
        ).bind(sessionId).all();
        return Response.json({ ok: true, approvals: result.results || [] });
      } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
      }
    }

    // Onay ver veya reddet
    if (url.pathname === "/api/approvals/decide" && request.method === "POST") {
      try {
        const body = await request.json();
        const { id, decision } = body;
        if (!id || !["approved", "rejected"].includes(decision)) {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }
        await env.DB.prepare(
          `UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?`
        ).bind(decision, Date.now(), id).run();

        // Karar verildikten sonra Vera'ya bilgi ver
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

    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const message = (body.message || "").trim();
        const sessionId = (body.session_id || "fatih").trim();
        if (!message) {
          return Response.json({ error: "message_required" }, { status: 400 });
        }

        const historyResult = await env.DB.prepare(
          `SELECT role, content FROM messages WHERE session_id = ?
           ORDER BY id DESC LIMIT 20`
        ).bind(sessionId).all();

        const history = (historyResult.results || []).reverse();

        await env.DB.prepare(
          `INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'user', ?, ?)`
        ).bind(sessionId, message, Date.now()).run();

        const messages = [
          { role: "system", content: SYSTEM_PROMPT },
          ...history,
          { role: "user", content: message },
        ];

        const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages,
          max_tokens: 900,
          temperature: 0.6,
        });

        const rawAnswer = extractText(result);

        // Cevaptaki [ONAY: ...] işaretlerini işle
        const { answer, created } = await processApprovals(env, sessionId, rawAnswer);

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

    return new Response("Not found", { status: 404 });
  },
};

async function processApprovals(env, sessionId, text) {
  const regex = /\[ONAY:\s*([^\]]+)\]/g;
  const matches = [...text.matchAll(regex)];
  const created = [];

  for (const m of matches) {
    const description = m[1].trim().slice(0, 200);
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(
        `INSERT INTO approvals (id, session_id, description, status, created_at)
         VALUES (?, ?, ?, 'pending', ?)`
      ).bind(id, sessionId, description, Date.now()).run();
      created.push({ id, description });
    } catch (e) {
      // aynı istek gelirse duplicate olabilir, sorun değil
    }
  }

  // Marker'ları cevaptan kaldır
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

ÜSLUP KURALLARI:
- Kısa konuş. En fazla 3-4 cümle veya 3 madde.
- Sade Türkçe kullan. Süsleme yapma.
- Şu kelimeleri KULLANMA: emisyon, yörünge, telemetry, mekanizma, entegre, optimum, minimize, maksimize, sinerji, ekosistem, matris, dinamiği, parametre.
- "Merhaba Fatih." gibi sade başla.

İŞ BİLGİSİ:
- Dropshipping. Tedarikçi: La Casa de Kadir.
- Tedarikçi indirimi: %20 (liste × 0.80 = maliyet).
- Aday fiyat A: liste × 1.20
- Aday fiyat B: liste × 1.25
- Minimum hedef kâr: liste fiyatının %20'si.
- Kapıda ödeme (COD) aktif.
- 500 Bs üzeri siparişte müşteriye kargo ücretsiz.
- Kargo: Correos Bolivia.
- Dropshipping'de fiziksel envanter YOKTUR.

ONAY SİSTEMİ (ÇOK ÖNEMLİ):
Kritik bir işlem yapmak istediğinde (para harcama, reklam başlatma, ürün yayınlama,
gerçek kargo oluşturma, refund, tema değiştirme, ücretli abonelik başlatma),
sakın "yaptım" deme. Bunun yerine cevabının SONUNA ayrı bir satır olarak şunu ekle:

[ONAY: kısa açıklama]

Örnek: Kullanıcı "şu ürünü yayınla" derse, sen şöyle cevap ver:
"Ürün hazır. Yayınlamak için onayını bekliyorum.
[ONAY: X ürününü Shopify'da yayınla]"

Sistem bu [ONAY: ...] işaretini okuyup panelde bir onay kartı oluşturacak.
Fatih Onayla derse "Onaylandı, yapıyorum" de. Reddet derse "Anlaşıldı, iptal ettim" de.

ÖNEMLİ: [ONAY: ...] işareti dışında JSON veya özel format KULLANMA.
Normal Türkçe konuş. Sadece onay gerektiren işlemlerde [ONAY: ...] ekle.

DÜRÜSTLÜK:
- Bilmediğin şeyi uydurma. "Bilmiyorum" de.
- Yapmadığın işi "yaptım" diye anlatma.
- Kargo fiyatı, pazar fiyatı, stok durumu gibi bilgileri uydurma.`;

const HTML = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vera Casa OS</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, system-ui, sans-serif;
  background: #0a0a0a; color: #eee;
  min-height: 100vh; padding: 20px;
  max-width: 600px; margin: 0 auto;
}
h1 { text-align: center; font-size: 28px; letter-spacing: 4px; margin: 20px 0 6px; }
.sub { text-align: center; color: #888; font-size: 13px; margin-bottom: 30px; }
.card {
  background: #151515; border: 1px solid #262626;
  border-radius: 16px; padding: 18px; margin-bottom: 16px;
}
.card h2 { font-size: 17px; margin-bottom: 6px; }
.card p { color: #888; font-size: 13px; margin-bottom: 12px; }
textarea {
  width: 100%; background: #0a0a0a; border: 1px solid #262626;
  border-radius: 12px; padding: 12px; color: #eee;
  font-size: 15px; font-family: inherit; resize: none;
}
textarea:focus { outline: none; border-color: #555; }
button {
  background: #fff; color: #000; border: none;
  border-radius: 12px; padding: 12px 20px;
  font-size: 15px; font-weight: 600;
  cursor: pointer; margin-top: 10px;
}
button:active { opacity: 0.7; }
.btn-clear {
  background: #2a2a2a; color: #aaa; font-size: 12px;
  padding: 6px 12px; margin-left: 8px;
}
#answer {
  margin-top: 16px; padding: 14px;
  background: #0a0a0a; border: 1px solid #262626;
  border-radius: 12px; min-height: 60px;
  white-space: pre-wrap; font-size: 14px; line-height: 1.5;
}
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.stat {
  background: #151515; border: 1px solid #262626;
  border-radius: 14px; padding: 14px;
}
.stat .num { font-size: 22px; font-weight: 700; }
.stat .lbl { font-size: 12px; color: #888; margin-top: 4px; }
.approval-item {
  background: #1a1200; border: 1px solid #4a3a00;
  border-radius: 12px; padding: 14px; margin-bottom: 10px;
}
.approval-item .desc {
  font-size: 14px; margin-bottom: 10px; line-height: 1.4;
}
.approval-item .actions { display: flex; gap: 8px; }
.approval-item button {
  padding: 8px 16px; font-size: 13px; margin: 0; flex: 1;
}
.btn-approve { background: #2d7a3e; color: #fff; }
.btn-reject { background: #7a2d2d; color: #fff; }
.empty-approvals {
  color: #666; font-size: 13px; text-align: center;
  padding: 12px; font-style: italic;
}
</style>
</head>
<body>
<h1>VERA</h1>
<div class="sub">Vera Casa Operating System</div>

<div class="card" id="approvals-card" style="display:none">
  <h2>⏳ Onay bekleyen işlemler</h2>
  <div id="approvals-list"></div>
</div>

<div class="card">
  <h2>Vera'ya sor <button class="btn-clear" onclick="clearMemory()">Hafızayı sil</button></h2>
  <p>İşletmeni yönet, kararları hazırla, kritik işlemleri onaya bırak.</p>
  <textarea id="msg" rows="3" placeholder="Örn: Bugün ne yapmamız gerekiyor?"></textarea>
  <button onclick="send()">Gönder</button>
  <div id="answer">Hazırım Fatih.</div>
</div>

<div class="stats">
  <div class="stat"><div class="num">29</div><div class="lbl">rol</div></div>
  <div class="stat"><div class="num">500 Bs</div><div class="lbl">ücretsiz kargo eşiği</div></div>
  <div class="stat"><div class="num">20%</div><div class="lbl">tedarikçi indirimi</div></div>
  <div class="stat"><div class="num" id="approval-count">0</div><div class="lbl">bekleyen onay</div></div>
</div>

<script>
const SESSION = 'fatih';

async function send() {
  const box = document.getElementById('answer');
  const msg = document.getElementById('msg').value.trim();
  if (!msg) return;
  box.textContent = 'Vera düşünüyor...';
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, session_id: SESSION })
    });
    const data = await r.json();
    box.textContent = data.ok ? data.answer : ('Hata: ' + data.error);
    document.getElementById('msg').value = '';
    loadApprovals();
  } catch (e) {
    box.textContent = 'Bağlantı hatası: ' + e.message;
  }
}

async function loadApprovals() {
  try {
    const r = await fetch('/api/approvals?session_id=' + SESSION);
    const data = await r.json();
    const list = document.getElementById('approvals-list');
    const card = document.getElementById('approvals-card');
    const count = document.getElementById('approval-count');

    if (!data.ok || !data.approvals || data.approvals.length === 0) {
      card.style.display = 'none';
      count.textContent = '0';
      return;
    }

    card.style.display = 'block';
    count.textContent = String(data.approvals.length);
    list.innerHTML = '';

    for (const a of data.approvals) {
      const item = document.createElement('div');
      item.className = 'approval-item';
      item.innerHTML = '<div class="desc">' + escapeHtml(a.description) + '</div>' +
        '<div class="actions">' +
        '<button class="btn-approve" onclick="decide(\\'' + a.id + '\\', \\'approved\\')">✓ Onayla</button>' +
        '<button class="btn-reject" onclick="decide(\\'' + a.id + '\\', \\'rejected\\')">✗ Reddet</button>' +
        '</div>';
      list.appendChild(item);
    }
  } catch (e) {
    console.error(e);
  }
}

async function decide(id, decision) {
  try {
    const r = await fetch('/api/approvals/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision })
    });
    const data = await r.json();
    if (data.ok) {
      loadApprovals();
    } else {
      alert('Hata: ' + data.error);
    }
  } catch (e) {
    alert('Bağlantı hatası: ' + e.message);
  }
}

async function clearMemory() {
  if (!confirm('Hafıza ve onaylar silinsin mi?')) return;
  try {
    const r = await fetch('/api/memory/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: SESSION })
    });
    const data = await r.json();
    document.getElementById('answer').textContent = data.ok ? 'Hafıza silindi.' : 'Hata: ' + data.error;
    loadApprovals();
  } catch (e) {
    document.getElementById('answer').textContent = 'Bağlantı hatası: ' + e.message;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Sayfa açılınca ve her 30 saniyede onayları yenile
loadApprovals();
setInterval(loadApprovals, 30000);
</script>
</body>
</html>`;
