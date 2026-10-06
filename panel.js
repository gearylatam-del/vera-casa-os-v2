export const HTML = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vera Casa OS</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#eee;min-height:100vh;padding:20px;max-width:600px;margin:0 auto}
h1{text-align:center;font-size:28px;letter-spacing:4px;margin:20px 0 6px}
.sub{text-align:center;color:#888;font-size:13px;margin-bottom:30px}
.card{background:#151515;border:1px solid #262626;border-radius:16px;padding:18px;margin-bottom:16px}
.card h2{font-size:17px;margin-bottom:6px}
.card p{color:#888;font-size:13px;margin-bottom:12px}
textarea{width:100%;background:#0a0a0a;border:1px solid #262626;border-radius:12px;padding:12px;color:#eee;font-size:15px;font-family:inherit;resize:none;margin-top:12px}
textarea:focus{outline:none;border-color:#555}
button{background:#fff;color:#000;border:none;border-radius:12px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer;margin-top:10px}
button:active{opacity:.7}
.btn-clear{background:#2a2a2a;color:#aaa;font-size:12px;padding:6px 12px;margin-left:8px}
.btn-shopify{background:#2d7a3e;color:#fff;font-size:13px;padding:8px 14px;text-decoration:none;border-radius:8px;display:inline-block;margin-top:6px}
.btn-mic{background:#fff;color:#000;border-radius:50%;width:70px;height:70px;font-size:28px;display:flex;align-items:center;justify-content:center;margin:16px auto;cursor:pointer;transition:all .2s;border:none;padding:0}
.btn-mic.active{background:#e74c3c;color:#fff;animation:pulse 1.5s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(231,76,60,.7)}70%{box-shadow:0 0 0 20px rgba(231,76,60,0)}100%{box-shadow:0 0 0 0 rgba(231,76,60,0)}}
#voiceStatus{text-align:center;font-size:12px;color:#888;margin-top:8px;min-height:18px}
#answer{margin-top:16px;padding:14px;background:#0a0a0a;border:1px solid #262626;border-radius:12px;min-height:60px;white-space:pre-wrap;font-size:14px;line-height:1.5}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.stat{background:#151515;border:1px solid #262626;border-radius:14px;padding:14px}
.stat .num{font-size:22px;font-weight:700}
.stat .lbl{font-size:12px;color:#888;margin-top:4px}
.approval-item{background:#1a1200;border:1px solid #4a3a00;border-radius:12px;padding:14px;margin-bottom:10px}
.approval-item .desc{font-size:14px;margin-bottom:10px;line-height:1.4}
.approval-item .actions{display:flex;gap:8px}
.approval-item button{padding:8px 16px;font-size:13px;margin:0;flex:1}
.btn-approve{background:#2d7a3e;color:#fff}
.btn-reject{background:#7a2d2d;color:#fff}
.lang-toggle{display:flex;justify-content:center;gap:8px;margin-top:8px}
.lang-btn{background:#1f1f1f;color:#888;border:1px solid #333;padding:6px 14px;border-radius:20px;font-size:12px;cursor:pointer}
.lang-btn.active{background:#fff;color:#000;border-color:#fff}
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
  <p>Mikrofona bas, konuş. Vera cevap verecek.</p>
  <button id="micButton" class="btn-mic" title="Konuşmak için bas">🎤</button>
  <div id="voiceStatus">Konuşmak için mikrofona bas</div>
  <div class="lang-toggle">
    <button class="lang-btn active" id="langTR" onclick="setLang('tr-TR')">🇹🇷 Türkçe</button>
    <button class="lang-btn" id="langES" onclick="setLang('es-BO')">🇧🇴 Español</button>
  </div>
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
var SESSION='fatih';
var currentLang='tr-TR';
var recognition=null;
var isListening=false;
var isSpeaking=false;
var voiceEnabled=false;
var cachedVoice=null;

function send(){
  var box=document.getElementById('answer');
  var msg=document.getElementById('msg').value.trim();
  if(!msg)return;
  box.textContent='Vera düşünüyor...';
  fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,session_id:SESSION})})
    .then(function(r){return r.json()})
    .then(function(data){
      var answer=data.ok?data.answer:('Hata: '+data.error);
      box.textContent=answer;
      document.getElementById('msg').value='';
      loadApprovals();
      if(voiceEnabled&&data.ok)speak(answer);
    })
    .catch(function(e){box.textContent='Bağlantı hatası: '+e.message});
}

// ============ SES SEÇİMİ ============
function pickBestVoice(langCode){
  var voices=window.speechSynthesis.getVoices();
  if(!voices||voices.length===0)return null;
  var langPrefix=langCode.split('-')[0].toLowerCase();
  var candidates=voices.filter(function(v){
    return v.lang&&v.lang.toLowerCase().indexOf(langPrefix)===0;
  });
  if(candidates.length===0)return null;

  // Öncelik sırası: doğal/neural/google sesler önce
  var priorities=['natural','neural','google','premium','enhanced','online','microsoft'];
  for(var i=0;i<priorities.length;i++){
    var key=priorities[i];
    var found=candidates.filter(function(v){
      return v.name&&v.name.toLowerCase().indexOf(key)>-1;
    })[0];
    if(found)return found;
  }

  // Bulut tabanlı ses (localService=false) genelde daha doğal
  var cloud=candidates.filter(function(v){return v.localService===false})[0];
  if(cloud)return cloud;

  return candidates[0];
}

function refreshVoice(){
  cachedVoice=pickBestVoice(currentLang);
}

// ============ METİN ÖN İŞLEME ============
function preprocessText(text){
  var t=text;
  // [ONAY: ...] marker'larını sil
  t=t.replace(/\[ONAY:[^\]]+\]/g,'');
  // Markdown yıldızları, alt çizgiler
  t=t.replace(/\*\*/g,'').replace(/\*/g,'').replace(/__/g,'').replace(/_/g,' ');
  // Başlık işaretleri
  t=t.replace(/^#+\s*/gm,'');
  // Markdown link: [metin](url) → metin
  t=t.replace(/\[([^\]]+)\]\([^)]+\)/g,'$1');
  // Emoji ve semboller
  try{t=t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu,'');}catch(e){}
  // Kısaltmalar
  t=t.replace(/\bBs\b/g,'bolivyano');
  t=t.replace(/\bBOB\b/g,'bolivyano');
  t=t.replace(/\bCOD\b/g,'kapıda ödeme');
  t=t.replace(/\bURL\b/g,'link');
  t=t.replace(/\bAPI\b/g,'A P İ');
  // Sayı formatı: 372,50 → 372.50 (Türkçe sesler için)
  t=t.replace(/(\d),(\d)/g,'$1.$2');
  // Fazla boşluk ve satır
  t=t.replace(/\s+/g,' ').trim();
  return t;
}

// ============ CÜMLE BÖLME ============
function splitIntoSentences(text){
  if(!text)return [];
  var result=[];
  // Cümle sonu noktalaması + boşluk ile böl
  var regex=/[^.!?…]+[.!?…]+/g;
  var matches=text.match(regex);
  if(matches){
    matches.forEach(function(m){
      var t=m.trim();
      if(t)result.push(t);
    });
  }
  // Son parça (noktalama olmadan biten metin)
  var lastMatch=matches?matches[matches.length-1]:'';
  if(lastMatch){
    var lastIdx=text.lastIndexOf(lastMatch)+lastMatch.length;
    var remainder=text.substring(lastIdx).trim();
    if(remainder)result.push(remainder);
  }else if(text.trim()){
    result.push(text.trim());
  }
  return result.length>0?result:[text.trim()];
}

// ============ SESLİ OKUMA (TTS) ============
function speak(text){
  if(!('speechSynthesis'in window))return;
  window.speechSynthesis.cancel();

  var clean=preprocessText(text);
  if(!clean)return;

  var sentences=splitIntoSentences(clean);
  if(sentences.length===0)return;

  // Ses önbelleği boşsa yenile
  if(!cachedVoice)refreshVoice();

  isSpeaking=true;
  var lastIdx=sentences.length-1;

  sentences.forEach(function(sentence,idx){
    var u=new SpeechSynthesisUtterance(sentence);
    u.lang=currentLang;
    u.rate=0.97;      // İnsan konuşma hızına yakın
    u.pitch=1.0;      // Doğal ton
    u.volume=1.0;
    if(cachedVoice)u.voice=cachedVoice;

    if(idx===lastIdx){
      u.onend=function(){
        isSpeaking=false;
        if(voiceEnabled&&!isListening){
          setTimeout(startListening,200);
        }
      };
    }
    u.onerror=function(){isSpeaking=false};

    window.speechSynthesis.speak(u);
  });
}

// ============ SESLİ DİNLEME (STT) ============
function initRecognition(){
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){
    document.getElementById('voiceStatus').textContent='Bu tarayıcı ses tanımayı desteklemiyor. Chrome kullan.';
    return null;
  }
  var rec=new SR();
  rec.continuous=false;
  rec.interimResults=true;
  rec.lang=currentLang;
  rec.onresult=function(event){
    var interim='';
    var final='';
    for(var i=event.resultIndex;i<event.results.length;i++){
      var t=event.results[i][0].transcript;
      if(event.results[i].isFinal)final+=t;
      else interim+=t;
    }
    var statusEl=document.getElementById('voiceStatus');
    if(interim)statusEl.textContent='🎙️ '+interim;
    if(final){
      statusEl.textContent='👤 '+final;
      handleVoiceInput(final.trim());
    }
  };
  rec.onerror=function(event){
    if(event.error==='not-allowed'){
      document.getElementById('voiceStatus').textContent='Mikrofon izni verilmedi.';
      voiceEnabled=false;
      document.getElementById('micButton').classList.remove('active');
    }else if(event.error==='no-speech'){
      document.getElementById('voiceStatus').textContent='Ses duyulmadı, tekrar dene.';
    }
  };
  rec.onend=function(){
    isListening=false;
    document.getElementById('micButton').classList.remove('active');
  };
  return rec;
}

function handleVoiceInput(text){
  var box=document.getElementById('answer');
  box.textContent='Vera düşünüyor...';
  fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,session_id:SESSION})})
    .then(function(r){return r.json()})
    .then(function(data){
      var answer=data.ok?data.answer:('Hata: '+data.error);
      box.textContent=answer;
      loadApprovals();
      if(data.ok)speak(answer);
    })
    .catch(function(e){box.textContent='Bağlantı hatası: '+e.message});
}

function startListening(){
  if(!recognition||isListening||isSpeaking)return;
  try{
    recognition.lang=currentLang;
    recognition.start();
    isListening=true;
    document.getElementById('micButton').classList.add('active');
    document.getElementById('voiceStatus').textContent='🎙️ Dinliyorum...';
  }catch(e){}
}

function stopListening(){
  if(recognition&&isListening){
    try{recognition.stop()}catch(e){}
    isListening=false;
  }
  document.getElementById('micButton').classList.remove('active');
}

function setupMicButton(){
  var micBtn=document.getElementById('micButton');
  var statusEl=document.getElementById('voiceStatus');
  micBtn.addEventListener('click',function(){
    if(isSpeaking){
      window.speechSynthesis.cancel();
      isSpeaking=false;
      statusEl.textContent='Susturuldu.';
      return;
    }
    if(isListening){
      stopListening();
      statusEl.textContent='Dinleme durduruldu.';
      return;
    }
    voiceEnabled=!voiceEnabled;
    if(voiceEnabled){
      micBtn.classList.add('active');
      startListening();
    }else{
      micBtn.classList.remove('active');
      statusEl.textContent='Sesli mod kapalı.';
      window.speechSynthesis.cancel();
    }
  });
}

function setLang(lang){
  currentLang=lang;
  document.getElementById('langTR').classList.toggle('active',lang==='tr-TR');
  document.getElementById('langES').classList.toggle('active',lang==='es-BO');
  if(recognition)recognition.lang=lang;
  cachedVoice=null;
  refreshVoice();
  var voiceName=cachedVoice?cachedVoice.name:'(varsayılan)';
  document.getElementById('voiceStatus').textContent='Dil: '+(lang==='tr-TR'?'Türkçe':'Español')+' — Ses: '+voiceName;
}

function loadApprovals(){
  fetch('/api/approvals?session_id='+SESSION)
    .then(function(r){return r.json()})
    .then(function(data){
      var list=document.getElementById('approvals-list');
      var card=document.getElementById('approvals-card');
      var count=document.getElementById('approval-count');
      if(!data.ok||!data.approvals||data.approvals.length===0){
        card.style.display='none';
        count.textContent='0';
        return;
      }
      card.style.display='block';
      count.textContent=String(data.approvals.length);
      list.innerHTML='';
      data.approvals.forEach(function(a){
        var item=document.createElement('div');
        item.className='approval-item';
        item.innerHTML='<div class="desc">'+escapeHtml(a.description)+'</div>'+
          '<div class="actions">'+
          '<button class="btn-approve" onclick="decide(\\''+a.id+'\\',\\'approved\\')">✓ Onayla</button>'+
          '<button class="btn-reject" onclick="decide(\\''+a.id+'\\',\\'rejected\\')">✗ Reddet</button>'+
          '</div>';
        list.appendChild(item);
      });
    })
    .catch(function(){});
}

function decide(id,decision){
  fetch('/api/approvals/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,decision:decision})})
    .then(function(r){return r.json()})
    .then(function(data){if(data.ok)loadApprovals();else alert('Hata: '+data.error)})
    .catch(function(e){alert('Bağlantı hatası: '+e.message)});
}

function loadShopify(){
  fetch('/api/shopify/status')
    .then(function(r){return r.json()})
    .then(function(data){
      var status=document.getElementById('shopify-status');
      var actions=document.getElementById('shopify-actions');
      if(data.connected){
        status.innerHTML='✅ Bağlı — Mağaza: <b>'+escapeHtml(data.shop)+'</b>';
        actions.innerHTML='<a class="btn-shopify" href="#" onclick="showProducts();return false;">Ürünleri listele</a> '+
          '<button class="btn-clear" onclick="disconnectShopify()">Bağlantıyı kes</button>';
      }else{
        status.innerHTML='❌ Henüz bağlı değil.';
        actions.innerHTML='<a class="btn-shopify" href="/api/shopify/install">Shopify\\'ı Bağla</a>';
      }
    })
    .catch(function(){});
}

function showProducts(){
  var box=document.getElementById('answer');
  box.textContent='Ürünler getiriliyor...';
  fetch('/api/shopify/products')
    .then(function(r){return r.json()})
    .then(function(data){
      if(!data.ok){box.textContent='Hata: '+data.error;return}
      if(data.count===0){box.textContent='Mağazada henüz ürün yok.';return}
      var txt='📦 '+data.count+' ürün:\\n\\n';
      data.products.slice(0,10).forEach(function(p){
        txt+='• '+p.title+' — '+(p.variants&&p.variants[0]?p.variants[0].price:'?')+' BOB\\n';
      });
      box.textContent=txt;
    })
    .catch(function(e){box.textContent='Hata: '+e.message});
}

function disconnectShopify(){
  if(!confirm('Shopify bağlantısı kesilsin mi?'))return;
  fetch('/api/shopify/disconnect',{method:'POST'}).then(function(){loadShopify()});
}

function clearMemory(){
  if(!confirm('Hafıza ve onaylar silinsin mi?'))return;
  fetch('/api/memory/clear',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:SESSION})})
    .then(function(r){return r.json()})
    .then(function(data){
      document.getElementById('answer').textContent=data.ok?'Hafıza silindi.':'Hata: '+data.error;
      loadApprovals();
    })
    .catch(function(){});
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

if(window.location.search.indexOf('shopify=connected')>-1){
  document.getElementById('answer').textContent='Shopify bağlandı!';
  window.history.replaceState({},'','/');
}

window.addEventListener('DOMContentLoaded',function(){
  recognition=initRecognition();
  setupMicButton();
  loadApprovals();
  loadShopify();
  setInterval(loadApprovals,30000);
  setInterval(loadShopify,60000);

  // Ses listesini yükle
  if('speechSynthesis'in window){
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged=function(){
      window.speechSynthesis.getVoices();
      refreshVoice();
    };
    setTimeout(refreshVoice,500);
    setTimeout(refreshVoice,1500);
  }
});
</script>
</body>
</html>`;
