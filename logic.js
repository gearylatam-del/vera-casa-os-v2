export function analyzeMessage(message) {
  const lower = (message || "").toLowerCase();
  const priceMatch = message.match(/(\d+(?:[.,]\d+)?)\s*(bs|bob)\b/i);
  const price = priceMatch ? Number(priceMatch[1].replace(",", ".")) : null;
  const shippingKeywords = /kargo|teslimat|toplam|gönderim|shipping|ne\s*kadar|kaç\s*para/i;
  const isShippingQuestion = shippingKeywords.test(message);
  const infoQuestionKeywords = /ne\s*kadar|kaç\s*para|kaç\s*bs|toplam\s*ne|hesapla|nasıl|nedir|ne\s*olur/i;
  const isInfoQuestion = infoQuestionKeywords.test(message) || (price !== null && isShippingQuestion);
  const approvalTriggers = /yayınla|satın\s*al|reklam\s*başlat|bütçe\s*değiştir|refund|iade\s*et|iptal\s*et|abonelik\s*başlat|tema\s*değiştir|kargo\s*oluştur|gönderi\s*oluştur/i;
  const isCriticalAction = approvalTriggers.test(message);
  return { price, isShippingQuestion, isInfoQuestion, isCriticalAction, lower };
}

export function calculateShipping(price) {
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  if (price >= 500) {
    return {
      product: price,
      shipping: 0,
      shippingLabel: "ÜCRETSİZ",
      total: price,
      note: "500 Bs ve üzeri sipariş olduğu için kargo müşteriye ücretsizdir. Kargo gideri (yaklaşık 22,50 Bs) Vera Casa tarafından karşılanır.",
      companyCost: 22.50,
    };
  }
  return {
    product: price,
    shipping: 22.50,
    shippingLabel: "22,50 Bs",
    total: price + 22.50,
    note: "Kargo ücreti 22,50 Bs başlangıçtır (2 kg'a kadar, kapıda ödeme dahil). Kesin tutar paket ağırlığına ve teslimat adresine göre değişebilir; kargo görevlisi kapıda kesin tutarı bildirecektir.",
    companyCost: 0,
  };
}

export function buildContext(message) {
  const { price, isShippingQuestion } = analyzeMessage(message);
  let context = "";
  if (price !== null && isShippingQuestion) {
    const calc = calculateShipping(price);
    if (calc) {
      context += "\n\n=== ÖNCEDEN HESAPLANMIŞ KESİN VERİ ===\n";
      context += "Ürün fiyatı: " + calc.product + " Bs\n";
      context += "Kargo: " + calc.shippingLabel + "\n";
      context += "Toplam: " + calc.total + " Bs\n";
      context += "Açıklama: " + calc.note + "\n";
      context += "\n>>> Bu bir BİLGİ SORUSUDUR. Aşağıdaki veriyi AYNEN kullan, kendin hesaplama yapma. Onay marker'ı [ONAY: ...] EKLEME. Sadece doğal dille aktar.";
    }
  }
  return context;
}

export function shouldForceNoApproval(message) {
  const { isInfoQuestion, isCriticalAction } = analyzeMessage(message);
  return isInfoQuestion && !isCriticalAction;
}

export function ensureShippingWarning(answer, userMessage) {
  const { isShippingQuestion, price } = analyzeMessage(userMessage);
  if (!isShippingQuestion || price === null) return answer;
  const hasWarning = /değişebilir|başlangıç|kesin tutar|kapıda kesin/i.test(answer);
  if (hasWarning) return answer;
  const warning = price >= 500
    ? "\n\nNot: 500 Bs ve üzeri sipariş olduğu için kargo müşteriye ücretsizdir. Kargo gideri Vera Casa tarafından karşılanır."
    : "\n\nNot: Kargo ücreti 22,50 Bs başlangıçtır (2 kg'a kadar, kapıda ödeme dahil). Kesin tutar paket ağırlığına ve teslimat adresine göre değişebilir; kargo görevlisi kapıda kesin tutarı bildirecektir.";
  return answer + warning;
}

// ============================================================
// FİYATLANDIRMA — v1 (DÜZELTİLMİŞ)
//
// Önceki sürümde /api/pricing/candidates sadece dört çarpma yapıyordu
// ve kargo giderini hiç hesaba katmıyordu. Bu bölüm onu düzeltir.
//
// KURAL (Fatih'in 7 Ekim 2026 kararı):
//   - Tedarikçi indirimi %20 → supplier_cost = liste × 0.80
//   - Müşteriye indirim YOK
//   - 500 Bs ve üzeri siparişte kargo müşteriye bedava,
//     ama 22,50 Bs'lik gideri Vera Casa öder → kârdan düşülür
// ============================================================

export const SUPPLIER_DISCOUNT_RATE = 0.20;
export const FREE_SHIPPING_THRESHOLD_BS = 500;
export const COD_SHIPPING_COST_BS = 22.50;

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Kâr tabanı (floor) fiyatı.
//
// Taban fiyat, "net kâr ≥ liste fiyatının %20'si" kuralını SAĞLAMAK
// zorundadır. Kargo gideri bu kuralı doğrudan etkiler:
//
//   Liste fiyatı 500 Bs ALTINDA → kargoyu müşteri öder, Vera Casa'nın
//     gideri 0. Gerekli fiyat = 0,80L + 0,20L = L.
//     Tutarlı: L < 500 olduğu için kargo gerçekten müşteride. ✓
//
//   Liste fiyatı 500 Bs ve ÜZERİNDE → kargo müşteriye bedava,
//     22,50 Bs Vera Casa'da. Gerekli fiyat = 0,80L + 0,20L + 22,50
//     = L + 22,50.
//     Tutarlı: L ≥ 500 olduğu için fiyat ≥ 522,50 → kargo bedava. ✓
//
// Bu düzeltme olmadan yüksek fiyatlı ürünlerde "taban" seviyesi kâr
// kuralını sessizce ihlal ediyordu. Örnek: liste 600 Bs →
// taban 600 Bs → net kâr 97,50 Bs, oysa kural 120 Bs istiyor.
export function profitFloorPrice(listPrice) {
  if (!Number.isFinite(listPrice) || listPrice <= 0) return null;
  const base = round2(listPrice * 0.80 + listPrice * 0.20);
  if (listPrice >= FREE_SHIPPING_THRESHOLD_BS) {
    return round2(base + COD_SHIPPING_COST_BS);
  }
  return base;
}

export function calculatePricing(listPrice, marketMinBs) {
  if (!Number.isFinite(listPrice) || listPrice <= 0) return null;

  const supplierCost = round2(listPrice * 0.80);
  const minProfitRule = round2(listPrice * 0.20);
  const marketFloor =
    Number.isFinite(marketMinBs) && marketMinBs > 0 ? marketMinBs : 0;

  // Taban fiyat kâr kuralından gelir; pazar tabanı daha yüksekse
  // pazar tabanı geçerlidir.
  const minPrice = round2(Math.max(profitFloorPrice(listPrice), marketFloor));

  const defs = [
    { key: "minimum", label: "Minimum (taban)", markup: 1.00, price: minPrice },
    { key: "onerilen", label: "Önerilen", markup: 1.20, price: round2(listPrice * 1.20) },
    { key: "premium", label: "Premium", markup: 1.25, price: round2(listPrice * 1.25) },
  ];

  const candidates = defs.map(function (d) {
    const freeShipping = d.price >= FREE_SHIPPING_THRESHOLD_BS;
    const companyShipping = freeShipping ? COD_SHIPPING_COST_BS : 0;
    const grossProfit = round2(d.price - supplierCost);
    const netProfit = round2(grossProfit - companyShipping);

    return {
      key: d.key,
      label: d.label,
      markup: d.markup,
      price: d.price,
      free_shipping_for_customer: freeShipping,
      company_shipping_cost: companyShipping,
      gross_profit: grossProfit,
      net_profit: netProfit,
      margin_on_cost_pct: round2((netProfit / supplierCost) * 100),
      margin_on_price_pct: round2((netProfit / d.price) * 100),
      meets_min_profit_rule: netProfit >= minProfitRule,
    };
  });

  const recommended = candidates[1];

  const notes = [];
  notes.push(
    "Müşteriye indirim uygulanmaz. %20 indirim tedarikçiden Vera Casa'ya verilir."
  );
  notes.push(
    "Kâr rakamları kargo gideri düşülmüş NET kârdır (500 Bs üzeri siparişte 22,50 Bs Vera Casa öder)."
  );
  notes.push(
    "Taban fiyat, %20 net kâr kuralını kargo gideri dahil sağlayacak şekilde hesaplanır."
  );
  notes.push(
    "Bu hesap henüz pazar araştırması içermez — sadece formül. Rakip fiyat analizi eklendiğinde güncellenecek."
  );

  return {
    ok: true,
    pricing_mode: "formula_v1",
    market_research: false,
    supplier_list_price: round2(listPrice),
    supplier_cost: supplierCost,
    min_profit_rule_bs: minProfitRule,
    profit_floor_price_bs: minPrice,
    free_shipping_threshold_bs: FREE_SHIPPING_THRESHOLD_BS,
    cod_shipping_cost_bs: COD_SHIPPING_COST_BS,
    market_floor_bs: marketFloor || null,
    candidates: candidates,
    recommendation: recommended,
    // Geriye dönük uyumluluk: eski alan adları korunuyor.
    candidate_A: round2(listPrice * 1.20),
    candidate_B: round2(listPrice * 1.25),
    min_profit_rule: minProfitRule,
    notes: notes,
  };
}
