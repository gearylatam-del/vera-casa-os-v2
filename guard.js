// guard.js — Vera Casa OS güvenlik katmanı
// Amaç: panel ve API'leri yetkisiz erişime kapatmak.
// Yeni dosya — mevcut kodun hiçbir yerini değiştirmez.

// Token istemeyen yollar.
//
// /api/health  → izleme için açık kalmalı (hassas veri döndürmez).
// /api/shopify/callback → Shopify, kullanıcının tarayıcısını buraya
//   yönlendirir; tarayıcı bizim token başlığımızı taşıyamaz.
//   Bu yolun koruması token değil, iki ayrı kilittir:
//     1) tek kullanımlık `state` (CSRF koruması)
//     2) mağaza adı beyaz listesi (SHOPIFY_STORE ile birebir eşleşme)
//   Bu iki kilit olmadan gizli anahtar sızabilir — bkz. KOD-ANALIZI.md §2.
const PUBLIC_PATHS = new Set(["/api/health", "/api/shopify/callback"]);

export function isPublic(path) {
  return PUBLIC_PATHS.has(path);
}

// Token şu üç yerden biriyle gelebilir:
//   1. X-Vera-Token başlığı  (panel bunu kullanır)
//   2. Authorization: Bearer <token>
//   3. ?token= sorgu parametresi  (Shopify yönlendirmesi gibi tarayıcı
//      adres çubuğundan geçen bağlantılar için)
export function extractToken(request, url) {
  const header = request.headers.get("X-Vera-Token");
  if (header && header.trim()) return header.trim();

  const auth = request.headers.get("Authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();

  const q = url.searchParams.get("token");
  if (q && q.trim()) return q.trim();

  return "";
}

// Sabit süreli karşılaştırma.
// Normal "===" karşılaştırması ilk farklı harfte durur; bu da doğru
// token'ı harf harf tahmin etmeyi kolaylaştırır. Burada her zaman
// tüm karakterler karşılaştırılır.
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Ana kapı kontrolü.
export function checkAuth(request, env, url) {
  const expected = env.VERA_TOKEN;

  // Token tanımlanmadıysa sistemi AÇMA. Sessizce korumasız bırakmak
  // en tehlikeli davranış olurdu.
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "server_token_not_configured",
      message:
        "VERA_TOKEN tanımlı değil. Cloudflare'de gizli değer olarak ekle: " +
        "npx wrangler secret put VERA_TOKEN",
    };
  }

  const provided = extractToken(request, url);
  if (!provided) {
    return {
      ok: false,
      status: 401,
      error: "token_required",
      message: "Erişim şifresi gerekli.",
    };
  }

  if (!safeEqual(provided, expected)) {
    return {
      ok: false,
      status: 401,
      error: "invalid_token",
      message: "Erişim şifresi yanlış.",
    };
  }

  return { ok: true };
}

// Basit hız sınırı.
//
// DİKKAT — dürüst not: bu sayaç Worker'ın belleğinde tutulur. Cloudflare
// her veri merkezinde ayrı bir kopya çalıştırır ve bu kopyalar
// yeniden başlayabilir. Yani bu "en iyi çaba" sınırıdır, kesin garanti
// değildir. Amacı kazara oluşan döngüleri ve tek kaynaklı suistimali
// yavaşlatmaktır; kararlı bir saldırganı tamamen durdurmaz.
// Kesin sınır gerekirse sayaç D1 tablosuna taşınmalıdır.
const buckets = new Map();

export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const previous = buckets.get(key) || [];
  const fresh = previous.filter(function (t) {
    return now - t < windowMs;
  });

  if (fresh.length >= limit) {
    const oldest = fresh[0];
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    buckets.set(key, fresh);
    return { ok: false, retryAfter: retryAfter, remaining: 0 };
  }

  fresh.push(now);
  buckets.set(key, fresh);

  // Bellek şişmesini önle: çok sayıda farklı anahtar birikirse temizle.
  if (buckets.size > 500) {
    for (const [k, arr] of buckets) {
      const alive = arr.filter(function (t) {
        return now - t < windowMs;
      });
      if (alive.length === 0) buckets.delete(k);
      else buckets.set(k, alive);
    }
  }

  return { ok: true, remaining: limit - fresh.length };
}

// İstemci kimliği: Cloudflare'in verdiği gerçek IP'yi kullan.
export function clientKey(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown"
  );
}

// Yetkisiz istekler için tek tip Türkçe yanıt.
export function authErrorResponse(auth) {
  return Response.json(
    {
      ok: false,
      error: auth.error,
      message: auth.message || null,
    },
    { status: auth.status }
  );
}

export function rateLimitResponse(info) {
  return Response.json(
    {
      ok: false,
      error: "rate_limited",
      message: "Çok fazla istek. " + info.retryAfter + " saniye sonra tekrar dene.",
      retry_after: info.retryAfter,
    },
    {
      status: 429,
      headers: { "Retry-After": String(info.retryAfter) },
    }
  );
}
