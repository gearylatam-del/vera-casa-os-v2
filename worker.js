export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Tabloyu ilk istekte bir kez oluştur (varsa hata vermez)
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
    } catch (e) {
      // tablo zaten varsa sorun değil
    }

    if (url.pathname === "/") {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "VERA CASA OS",
        version: "0.3.0",
        model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        supplier: "La Casa de Kadir",
        freeShippingThresholdBs: 500,
        memory: "d1",
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

    // Hafızayı temizleme endpoint'i (test için faydalı)
    if (url.pathname === "/api/memory/clear" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const sessionId = body.session_id || "default";
      try {
        await env.DB.prepare(
          `DELETE FROM messages WHERE session_id = ?`
        ).bind(sessionId).run();
        return Response.json({ ok: true, cleared: sessionId });
      } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
      }
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const message = (body.message || "").trim();
        const sessionId = (body.session_id || "default").trim();
        if (!message) {
          return Response.json({ error: "message_required" }, { status: 400 });
        }

        // Son 20 mesajı al (eskiden yeniye sıralı)
        const historyResult = await env.DB.prepare(
          `SELECT role, content FROM messages
           WHERE session_id = ?
           ORDER BY id DESC LIMIT 20`
        ).bind(sessionId).all();

        const history = (historyResult.results || []).reverse();

        // Yeni mesajı kaydet
        await env.DB.prepare(
          `INSERT INTO messages (session_id, role, content, created_at)
           VALUES (?, 'user', ?, ?)`
        ).bind(sessionId, message, Date.now()).run();

        // Model için mesaj listesi
        const messages = [
          { role: "system", content: SYSTEM_PROMPT },
          ...history,
          { role: "user", content: message },
        ];

        const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages,
          max_tokens: 800,
          temperature: 0.6,
        });

        const answer = extractText(result);

        // Cevabı kaydet
        await env.DB.prepare(
          `INSERT INTO messages (session_id, role, content, created_at)
           VALUES (?, 'assistant', ?, ?)`
        ).bind(sessionId, answer, Date.now()).run();

        return Response.json({ ok: true, answer, session_id: sessionId });
      } catch (err) {
        return Response.json({
          ok: false,
          error: err.message || String(err),
        }, { status: 500 });
      }
    }

    // Geçmiş mesajları görüntüle (test için)
    if (url.pathname === "/api/memory" && request.method === "GET") {
      const sessionId = url.searchParams.get("session_id") || "default";
      try {
        const result = await env.DB.prepare(
          `SELECT role, content, created_at FROM messages
           WHERE session_id = ?
           ORDER BY id ASC LIMIT 100`
        ).bind(sessionId).all();
        return Response.json({
          ok: true,
          session_id: sessionId,
          count: (result.results || []).length,
          messages: result.results || [],
        });
      } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

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
- "Merhaba Fatih. Hazırım." gibi sade başla.
- Uzun giriş cümlesi yazma. Direkt konuya gir.

İŞ BİLGİSİ:
- Dropshipping. Tedarikçi: La Casa de Kadir.
- Tedarikçi indirimi: %20 (liste × 0.80 = maliyet).
- Aday fiyat A: liste × 1.20
- Aday fiyat B: liste × 1.25
- Minimum hedef kâr: liste fiyatının %20'si.
- Kapıda ödeme (COD) aktif.
- 500 Bs üzeri siparişte müşteriye kargo ücretsiz.
- Kargo: Correos Bolivia.
- Dropshipping'de fiziksel envanter YOKTUR. Stok tedarikçide durur.

ONAY KURALLARI:
Para harcama, reklam değiştirme, ürün yayınlama, gerçek kargo oluşturma,
refund, tema değiştirme gibi kritik işlemleri Fatih onayı olmadan YAPMAZSIN.
Bu işlemlerde önce hazırla, sonra "Onayını bekliyorum" de.

DÜRÜSTLÜK:
- Bilmediğin şeyi uydurma. "Bilmiyorum" de.
- Yapmadığın işi "yaptım" diye anlatma.
- Kargo fiyatı, pazar fiyatı, stok durumu gibi bilgileri uydurma.

YASAKLAR:
- JSON gösterme.
- Ham reasoning/düşünce gösterme.
- İngilizce teknik terim kullanma.
- Uzun paragraflar yazma.`;

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
</style>
</head>
<body>
<h1>VERA</h1>
<div class="sub">Vera Casa Operating System</div>

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
  <div class="stat"><div class="num">HAFIZA</div><div class="lbl">d1 aktif</div></div>
</div>

<script>
async function send() {
  const box = document.getElementById('answer');
  const msg = document.getElementById('msg').value.trim();
  if (!msg) return;
  box.textContent = 'Vera düşünüyor...';
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, session_id: 'fatih' })
    });
    const data = await r.json();
    box.textContent = data.ok ? data.answer : ('Hata: ' + data.error);
    document.getElementById('msg').value = '';
  } catch (e) {
    box.textContent = 'Bağlantı hatası: ' + e.message;
  }
}

async function clearMemory() {
  if (!confirm('Hafıza silinsin mi?')) return;
  try {
    const r = await fetch('/api/memory/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'fatih' })
    });
    const data = await r.json();
    document.getElementById('answer').textContent = data.ok ? 'Hafıza silindi.' : 'Hata: ' + data.error;
  } catch (e) {
    document.getElementById('answer').textContent = 'Bağlantı hatası: ' + e.message;
  }
}
</script>
</body>
</html>`;
