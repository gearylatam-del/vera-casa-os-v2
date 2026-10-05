// Vera Casa OS — Akıllı hesaplama ve niyet tespiti

export function analyzeMessage(message) {
  const lower = (message || "").toLowerCase();

  // Fiyat tespiti: "350 Bs", "350 bs", "350 bob", "350,50 Bs" gibi
  const priceMatch = message.match(/(\d+(?:[.,]\d+)?)\s*(bs|bob)\b/i);
  const price = priceMatch ? Number(priceMatch[1].replace(",", ".")) : null;

  // Kargo/toplam sorusu mu?
  const shippingKeywords = /kargo|teslimat|toplam|gönderim|shipping|ne\s*kadar|kaç\s*para/i;
  const isShippingQuestion = shippingKeywords.test(message);

  // Saf bilgi sorusu mu? (onay istenmemesi gereken durumlar)
  const infoQuestionKeywords = /ne\s*kadar|kaç\s*para|kaç\s*bs|toplam\s*ne|hesapla|nasıl|nedir|ne\s*olur/i;
  const isInfoQuestion = infoQuestionKeywords.test(message) || (price !== null && isShippingQuestion);

  // Kritik işlem tetikleyicileri (kod seviyesinde güvence)
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
      context += `\n\n=== ÖNCEDEN HESAPLANMIŞ KESİN VERİ ===\n`;
      context += `Ürün fiyatı: ${calc.product} Bs\n`;
      context += `Kargo: ${calc.shippingLabel}\n`;
      context += `Toplam: ${calc.total} Bs\n`;
      context += `Açıklama: ${calc.note}\n`;
      context += `\n>>> Bu bir BİLGİ SORUSUDUR. Aşağıdaki veriyi AYNEN kullan, kendin hesaplama yapma. Onay marker'ı [ONAY: ...] EKLEME. Sadece doğal dille aktar.`;
    }
  }

  return context;
}

export function shouldForceNoApproval(message) {
  const { isInfoQuestion, isCriticalAction } = analyzeMessage(message);
  // Bilgi sorusu ve kritik işlem DEĞİLSE, onay zorlama
  return isInfoQuestion && !isCriticalAction;
}
