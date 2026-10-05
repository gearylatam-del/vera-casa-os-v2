export const HTML = `<!DOCTYPE html>
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
.btn-shopify {
  background: #2d7a3e; color: #fff; font-size: 13px;
  padding: 8px 14px; text-decoration: none;
  border-radius: 8px; display: inline-block; margin-top: 6px;
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

<div class="card" id="shopify-card">
  <h2>🛍️ Shopify</h2>
  <p id="shopify-status">Kontrol ediliyor...</p>
  <div id="shopify-actions"></div>
</div>

<div class="stats">
  <div class="stat"><div class="num">29</div><div class="lbl">rol</div></div>
  <div class="stat"><div class="num">500 Bs</div><div class="lbl">ücretsiz kargo</div></div>
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
  } catch (e) {}
}

async function loadShopify() {
  try {
    const r = await fetch('/api/shopify/status');
    const data = await r.json();
    const status = document.getElementById('shopify-status');
    const actions = document.getElementById('shopify-actions');

    if (data.connected) {
      status.innerHTML = '✅ Bağlı — Mağaza: <b>' + escapeHtml(data.shop) + '</b>';
      actions.innerHTML =
        '<a class="btn-shopify" href="#" onclick="showProducts(); return false;">Ürünleri listele</a> ' +
        '<button class="btn-clear" onclick="disconnectShopify()">Bağlantıyı kes</button>';
    } else {
      status.innerHTML = '❌ Henüz bağlı değil.';
      actions.innerHTML = '<a class="btn-shopify" href="/api/shopify/install">Shopify\\'ı Bağla</a>';
    }
  } catch (e) {}
}

async function showProducts() {
  const box = document.getElementById('answer');
  box.textContent = 'Ürünler getiriliyor...';
  try {
    const r = await fetch('/api/shopify/products');
    const data = await r.json();
    if (!data.ok) {
      box.textContent = 'Hata: ' + data.error;
      return;
    }
    if (data.count === 0) {
      box.textContent = 'Mağazada henüz ürün yok.';
      return;
    }
    let txt = '📦 ' + data.count + ' ürün:\\n\\n';
    for (const p of data.products.slice(0, 10)) {
      txt += '• ' + p.title + ' — ' + (p.variants?.[0]?.price || '?') + ' BOB\\n';
    }
    box.textContent = txt;
  } catch (e) {
    box.textContent = 'Hata: ' + e.message;
  }
}

async function disconnectShopify() {
  if (!confirm('Shopify bağlantısı kesilsin mi?')) return;
  await fetch('/api/shopify/disconnect', { method: 'POST' });
  loadShopify();
}

async function decide(id, decision) {
  try {
    const r = await fetch('/api/approvals/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision })
    });
    const data = await r.json();
    if (data.ok) loadApprovals();
    else alert('Hata: ' + data.error);
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
  } catch (e) {}
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

if (window.location.search.includes('shopify=connected')) {
  document.getElementById('answer').textContent = 'Shopify bağlandı!';
  window.history.replaceState({}, '', '/');
}

loadApprovals();
loadShopify();
setInterval(loadApprovals, 30000);
setInterval(loadShopify, 60000);
</script>
</body>
</html>`;
