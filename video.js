// video.js — Vera Video Asistanı (yol haritası 1)
// Görsel analiz (Llama 3.2 Vision) + video senaryo/storyboard üretimi.
// Yeni dosya; mevcut koda dokunmaz.
// AI çağrıları Worker içinde çalışır; saf yardımcılar (parse/prompt)
// Node ile test edilebilir (bkz. VERA-CASA-OS/test).

export const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
export const SCRIPT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// ============ GENEL YARDIMCILAR ============

function str(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  return String(v).trim();
}

function arr(v) {
  if (Array.isArray(v)) return v.map(function (x) { return str(x); }).filter(Boolean);
  if (typeof v === "string" && v.trim()) {
    return v.split(/[;,\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  return [];
}

// Model çıktısını farklı yanıt şekillerinden güvenle çıkarır.
export function extractText(result) {
  if (typeof result === "string") return result.trim();
  if (!result) return "";
  const c1 = result?.choices?.[0]?.message?.content;
  if (typeof c1 === "string" && c1.trim()) return c1.trim();
  const c2 = result?.response;
  if (typeof c2 === "string" && c2.trim()) return c2.trim();
  const c3 = result?.result;
  if (typeof c3 === "string" && c3.trim()) return c3.trim();
  const c4 = result?.output_text;
  if (typeof c4 === "string" && c4.trim()) return c4.trim();
  return "";
}

// Model "şöyle bir metin + JSON" döndürse bile içindeki JSON'u bulur.
export function extractJson(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  try { return JSON.parse(s); } catch (_) {}
  const noFence = s.replace(/```[a-zA-Z]*/g, "").replace(/`/g, "").trim();
  try { return JSON.parse(noFence); } catch (_) {}
  const start = noFence.indexOf("{");
  const end = noFence.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(noFence.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

// ============ 1) GÖRSEL ANALİZ ============

export function buildVisionPrompt() {
  return [
    "Sen bir ürün kataloğu analiz asistanısın. Fotoğraftaki ürünü incele.",
    "SADECE şu JSON'u döndür; açıklama, önsöz, kod bloğu veya başka metin YAZMA:",
    '{ "urun_adi": "", "kategori": "", "renk": "", "malzeme": "", "boyutlar": "", "ozellikler": ["", ""], "hedef_kitle": "" }',
    "Kurallar:",
    "- Türkçe yaz.",
    "- ozellikler: 4 ile 6 arası kısa madde, her madde tek cümle, satışa yardımcı somut özellik.",
    "- Fotoğrafta net görünmeyen alanlara 'bilinmiyor' yaz.",
  ].join("\n");
}

export function parseProductInfo(raw) {
  const base = {
    urun_adi: "bilinmiyor",
    kategori: "bilinmiyor",
    renk: "bilinmiyor",
    malzeme: "bilinmiyor",
    boyutlar: "bilinmiyor",
    ozellikler: [],
    hedef_kitle: "bilinmiyor",
  };
  const j = extractJson(raw);
  if (!j || typeof j !== "object") {
    base.urun_adi = str(raw).slice(0, 120) || "bilinmiyor";
    base.raw = raw;
    return base;
  }
  return {
    urun_adi: str(j.urun_adi || j.name || j.product_name) || "bilinmiyor",
    kategori: str(j.kategori || j.category) || "bilinmiyor",
    renk: str(j.renk || j.color) || "bilinmiyor",
    malzeme: str(j.malzeme || j.material) || "bilinmiyor",
    boyutlar: str(j.boyutlar || j.dimensions || j.size) || "bilinmiyor",
    ozellikler: arr(j.ozellikler || j.features),
    hedef_kitle: str(j.hedef_kitle || j.target_audience) || "bilinmiyor",
    raw: raw,
  };
}

// Meta lisans onayı: model ilk kez kullanımda "agree" ister.
async function runVision(env, input) {
  try {
    return await env.AI.run(VISION_MODEL, input);
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/license|agree|terms|acceptable|policy/i.test(msg)) {
      try { await env.AI.run(VISION_MODEL, { prompt: "agree" }); } catch (_) {}
      return await env.AI.run(VISION_MODEL, input);
    }
    throw e;
  }
}

export async function analyzeProductImage(env, imageDataUrl) {
  const messages = [{ role: "user", content: buildVisionPrompt() }];
  const result = await runVision(env, {
    messages,
    image: imageDataUrl,
    max_tokens: 700,
  });
  const raw = extractText(result);
  return { raw: raw, product: parseProductInfo(raw) };
}

// ============ 2) VİDEO SENARYO ============

export function buildScriptPrompt(product, listPriceBs, recommendedPriceBs) {
  const oz = (product.ozellikler && product.ozellikler.length)
    ? product.ozellikler.join("; ")
    : "belirtilmedi";

  const schema = {
    script_es: "İspanyolca (Bolivya) seslendirme metni, tam metin",
    script_tr: "Türkçe çevirisi",
    storyboard: [
      { zaman: "0-3 sn", sahne: "HOOK", ekran_yazisi: "tek kelime", seslendirme: "..." },
    ],
    hashtags: ["#örnek", "#örnek"],
  };

  return [
    "Sen Vera Casa Bolivia'nın video yazarısın. Bir TikTok/Reels satış videosu için senaryo ve storyboard üreteceksin.",
    "",
    "ÜRÜN BİLGİSİ:",
    "Ad: " + str(product.urun_adi),
    "Kategori: " + str(product.kategori),
    "Renk: " + str(product.renk),
    "Malzeme: " + str(product.malzeme),
    "Boyut: " + str(product.boyutlar),
    "Özellikler: " + oz,
    "Hedef kitle: " + str(product.hedef_kitle),
    "Liste fiyatı: " + listPriceBs + " Bs",
    "Önerilen satış fiyatı (videoda bu fiyatı kullan): " + recommendedPriceBs + " Bs",
    "",
    "MARKA: Vera Casa. Pazar: Bolivya. Ödeme: kapıda ödeme (COD).",
    "Kargo: Correos Bolivia, 500 Bs üzeri ücretsiz.",
    "",
    "VİDEO FORMATI — 'Merak Uyandırıcı Demo' (30-40 sn, dikey 9:16):",
    "0-3 sn   : HOOK — şaşırtıcı açılış, tek güçlü cümle.",
    "3-25 sn  : ÖZELLİK — 4-6 sahne, her sahnede ekranda TEK kelime + kısa ses.",
    "25-32 sn : İKNA — fiyat vurgusu ve fayda.",
    "32-40 sn : CTA — 'WhatsApp'tan sipariş ver' + marka.",
    "",
    "Seslendirme: Bolivya İspanyolcası, kadın sesi, sıcak ve enerjik, 'usted' formu.",
    "Fiyatı Bs cinsinden, yuvarlanmış göster.",
    "",
    "SADECE şu JSON'u döndür, başka hiçbir şey yazma:",
    JSON.stringify(schema, null, 2),
  ].join("\n");
}

export function parseScriptResponse(raw) {
  const j = extractJson(raw);
  if (!j || typeof j !== "object") {
    return { script_es: str(raw), script_tr: "", storyboard: [], hashtags: [] };
  }
  return {
    script_es: str(j.script_es || j.script) || str(raw),
    script_tr: str(j.script_tr || j.translation),
    storyboard: Array.isArray(j.storyboard) ? j.storyboard : [],
    hashtags: arr(j.hashtags),
  };
}

export async function generateVideoScript(env, product, listPriceBs, recommendedPriceBs) {
  const messages = [
    { role: "system", content: "Sen profesyonel bir satış video senaristisin. Sadece JSON döndürürsün." },
    { role: "user", content: buildScriptPrompt(product, listPriceBs, recommendedPriceBs) },
  ];
  const result = await env.AI.run(SCRIPT_MODEL, {
    messages,
    max_tokens: 1400,
    temperature: 0.7,
  });
  const raw = extractText(result);
  return { raw: raw, script: parseScriptResponse(raw) };
}
