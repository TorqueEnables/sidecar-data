// ==UserScript==
// @name         Sidecar HUD (StakeLens)
// @namespace    https://torqueenables.github.io/sidecar-data
// @version      0.4.0
// @description  Insight-first, 4-chip HUD on broker pages with restriction badges.
// @match        https://kite.zerodha.com/*
// @match        https://web.dhan.co/*
// @match        https://trade.angelone.in/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://torqueenables.github.io/sidecar-data/docs/sidecar.user.js
// @updateURL    https://torqueenables.github.io/sidecar-data/docs/sidecar.user.js
// ==/UserScript==

(function () {
  'use strict';

  const DATA_BASE = 'https://torqueenables.github.io/sidecar-data/data/';
  const MODE_KEY = 'sidecar_mode';
  const PREF_COMPACT = 'sidecar_compact';
  if (!localStorage.getItem(MODE_KEY)) localStorage.setItem(MODE_KEY, 'swing');

  const CACHE=new Map(); let lastKey='';

  // --- Route parsing (quote + chart) ---
  const HOST = location.hostname;
  const PATTERNS = [
    /\/quote\/(NSE|BSE)\/([A-Z0-9.\-]+)/i,
    /\/markets\/chart\/web\/ciq\/(NSE|BSE)\/([A-Z0-9.\-]+)\//i,
    /\/(equities|stocks)\/(NSE|BSE)\/([A-Z0-9.\-]+)/i,
    /\/stocks\/(NSE|BSE)\/([A-Z0-9.\-]+)/i,
    /[?&]exchange=(NSE|BSE)[^#&]*[?&]tradingsymbol=([A-Z0-9.\-]+)/i
  ];
  function parseSymbolFromPath(){
    const p = location.pathname + location.search;
    for(const re of PATTERNS){
      const m=p.match(re); if(!m) continue;
      if(re===PATTERNS[2]) return {ex:m[2].toUpperCase(), sym:m[3].toUpperCase()};
      return {ex:(m[1]||m[2]).toUpperCase(), sym:(m[2]||m[3]).toUpperCase()};
    }
    return null;
  }
  function isSymbolView(){
    if(HOST==='kite.zerodha.com') return /\/quote\/|\/markets\/chart\/web\/ciq\//.test(location.pathname);
    if(HOST==='web.dhan.co') return /\/(equities|stocks)\//.test(location.pathname);
    if(HOST==='trade.angelone.in') return /\/stocks\//.test(location.pathname);
    return false;
  }

  // --- Fetch ---
  async function fetchJSON(ex,sym){
    const key=`${ex}:${sym}`;
    if(CACHE.has(key)) return CACHE.get(key);
    try{
      const r=await fetch(`${DATA_BASE}${encodeURIComponent(ex)}:${encodeURIComponent(sym)}.json`,{cache:'no-store'});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const j=await r.json(); CACHE.set(key,j); return j;
    }catch(e){ console.warn('Sidecar HUD: fetch failed',e); return null; }
  }

  // --- Applicability normalization for new chips ---
  function normChip(key, p){
    if(!p) return null;
    const d=(p.detail||'').trim(); const dl=d.toLowerCase();
    const obj = (color)=>({key, color, label:d});

    if(key==='earnings'){
      if(!/earnings|board|record/.test(dl)) return null;
      if(/in\s*\d+\s*d|today|tomorrow/.test(dl)) return obj(p.color||'amber');
      return null;
    }
    if(key==='egs'){ // "EGS High 3.2%"
      const m=dl.match(/(low|medium|high)\s+(\d+(\.\d+)?)%/);
      if(!m) return null;
      return {key, color:(m[1]==='high'?'amber':'blue'), label:`Earnings gap ${m[1]} ${m[2]}%`.replace(/^e/, 'E')};
    }
    if(key==='accum'){ // "Accumulation 3/5d • 1.8×"
      const m=dl.match(/(\d)\/5d.*?(\d+(\.\d+)?)×/);
      if(!m) return null;
      const ratio=parseFloat(m[2]); if(ratio<1.5) return null;
      return obj(p.color||'amber');
    }
    if(key==='rod'){ // "Delivery Rising 1.6×"
      const m=dl.match(/(\d+(\.\d+)?)×/); if(!m) return null;
      const ratio=parseFloat(m[1]); if(ratio<1.5) return null;
      return obj(p.color||'blue');
    }
    if(key==='insider_net'){ // "+₹3–4cr (30d)"
      if(/^\+?₹?0/.test(dl)) return null;
      return {key, color:p.color||'green', label:`Insider net ${d}`};
    }
    if(key==='pledge_delta'){ // "+0.6 pp (30d)"
      const mm=dl.match(/([+\-]?\d+(\.\d+)?)\s*pp/);
      if(!mm || Math.abs(parseFloat(mm[1]))<0.5) return null;
      return obj(p.color||'amber');
    }
    if(key==='bulk_heat'){ // "3 deals (30d)"
      const cm=dl.match(/(\d+)\s+deals/); if(!cm) return null;
      const n=parseInt(cm[1],10); if(n<2) return null;
      return obj(p.color||'blue');
    }
    if(key==='post_mortem'){ // "+6.1% today • prior 2.0×"
      if(!/[+\-]\d+(\.\d+)?%/.test(dl)) return null;
      return obj(p.color||'amber');
    }
    // Unknown -> drop
    return null;
  }

  function mapApplicableChips(json){
    const mode = localStorage.getItem(MODE_KEY)||'swing';
    const keys = (json.mode_top && json.mode_top[mode]) || [];
    const out=[]; keys.forEach(k=>{
      const c = normChip(k, json.pool && json.pool[k]);
      if(c) out.push(c);
    });
    return out;
  }

  // --- Badges (restrictions) ---
  function extractBadges(json){
    const b = (json.pool && json.pool.badges) || {};
    const pills=[];
    if(b.t2t) pills.push('T2T');
    if(b.asm && String(b.asm).toLowerCase()!=='none') pills.push(`ASM${b.asm===true?'':b.asm}`);
    if(b.fo_ban) pills.push('F&O ban');
    return pills;
  }

  // --- Slippage (execution friction) ---
  function computeSlippageFromDOM(){
    const txt=document.body.innerText||'';
    const bid=parseFloat((txt.match(/Bid\s*([\d,]*\.?\d+)/i)||[])[1]?.replace(/,/g,'')); 
    const ask=parseFloat((txt.match(/Ask\s*([\d,]*\.?\d+)/i)||[])[1]?.replace(/,/g,''));
    if(bid && ask && ask>bid){
      const pct=((ask-bid)/((ask+bid)/2))*100;
      if(pct>=0.30) return {key:'slippage', color:'amber', label:`Slippage ${pct.toFixed(2)}%`};
    }
    return null;
  }

  // --- Verdict sentence ---
  function verdict(chips, badges){
    if(!chips.length){
      const mode=localStorage.getItem(MODE_KEY)||'swing';
      const base = mode==='day'
        ? 'All clear: No near-term events in the next 3 sessions.'
        : 'All clear: No near-term events in the next 5 sessions.';
      return badges.length ? `${base} • ${badges.join(' · ')}` : base;
    }
    const hasRed=chips.some(c=>c.color==='red');
    const hasAmber=chips.some(c=>c.color==='amber');
    const head=hasRed?'Caution':hasAmber?'Heads-up':'All clear';

    const ph=[];
    for(const c of chips.slice(0,4)){
      const t=(c.label||'');
      if(/earnings in/.test(t)) ph.push(t);
      else if(/Earnings gap/.test(t)) ph.push(t);
      else if(/Accumulation/.test(t)) ph.push(t);
      else if(/Delivery/.test(t)) ph.push(t);
      else if(/Insider net/.test(t)) ph.push(t);
      else if(/pp/.test(t)) ph.push(`Pledge ${t}`);
      else if(/deals/.test(t)) ph.push(`Bulk/Block ${t}`);
      else if(/post-mortem|post-move|today/.test(t)) ph.push(`Post-move: ${t}`);
      else if(/Slippage/.test(t)) ph.push(`Expect ${t.toLowerCase()}`);
      else ph.push(t);
    }
    const line = `${head}: ${ph.join(' • ')}`;
    return badges.length ? `${line} • ${badges.join(' · ')}` : line;
  }

  // --- UI (glass, badges, docking) ---
  function colorHex(c){ if(c==='red')return'#e5484d'; if(c==='amber')return'#f59e0b'; if(c==='blue')return'#3b82f6'; if(c==='green')return'#22c55e'; return'#9ca3af'; }

  function ensureCard(){
    let card=document.getElementById('sidecar-hud'); if(card) return card;
    const compact = localStorage.getItem(PREF_COMPACT)==='1';
    card=document.createElement('div'); card.id='sidecar-hud';
    card.style.cssText=`
      position:fixed; z-index:2147483647;
      backdrop-filter: blur(14px) saturate(130%); -webkit-backdrop-filter: blur(14px) saturate(130%);
      background: rgba(20,22,28,.55); border:1px solid rgba(255,255,255,.18);
      color:#fff; padding:${compact?'8px 10px':'12px 14px'}; border-radius:16px;
      box-shadow:0 12px 32px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.06);
      font:${compact?'11px':'12px'}/1.35 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;
      max-width:${compact?'430px':'560px'};
    `;
    card.innerHTML=`
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div id="sc-verdict" style="font-weight:800"></div>
      </div>
      <div id="sc-badges" style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 8px"></div>
      <div id="sc-row" style="display:flex;gap:8px;flex-wrap:wrap"></div>
      <div style="opacity:.8;margin-top:8px;font-size:11px;display:flex;gap:12px;align-items:center">
        <span>Mode: <b id="sc-mode">${localStorage.getItem(MODE_KEY)||'swing'}</b></span>
        <span style="cursor:pointer;color:#a5d8ff" id="sc-toggle">toggle</span>
        <span style="cursor:pointer;color:#a5d8ff" id="sc-compact">${compact?'expand':'compact'}</span>
      </div>`;
    document.body.appendChild(card);
    card.querySelector('#sc-toggle').onclick=()=>{const cur=localStorage.getItem(MODE_KEY)||'swing';const next=cur==='swing'?'day':'swing';localStorage.setItem(MODE_KEY,next);location.reload();};
    card.querySelector('#sc-compact').onclick=()=>{const cur=localStorage.getItem(PREF_COMPACT)==='1';localStorage.setItem(PREF_COMPACT,cur?'0':'1');location.reload();};
    return card;
  }

  function render(chips, badges, vtext){
    const card=ensureCard();
    card.querySelector('#sc-verdict').textContent=vtext||'Sidecar';
    const badgeWrap=card.querySelector('#sc-badges'); badgeWrap.innerHTML='';
    badges.forEach(b=>{
      const pill=document.createElement('span');
      pill.style.cssText='background:#0e1524;border:1px solid rgba(255,255,255,.18);padding:2px 8px;border-radius:999px;font-weight:700;color:#bfe0ff';
      pill.textContent=b; badgeWrap.appendChild(pill);
    });
    const row=card.querySelector('#sc-row'); row.innerHTML='';
    chips.slice(0,4).forEach(c=>{
      const chip=document.createElement('span');
      chip.style.cssText=`
        background:${colorHex(c.color)}; color:#0b0f14; padding:6px 10px;
        border-radius:999px; font-weight:800; box-shadow:0 1px 0 rgba(255,255,255,.35) inset;
      `;
      chip.textContent=c.label||''; row.appendChild(chip);
    });
  }

  function findAnchor(){
    const btns=Array.from(document.querySelectorAll('button, a, div[role="button"]'));
    return btns.find(b=>{
      const t=(b.innerText||'').trim().toLowerCase(); if(!t) return false;
      const match=/\b(buy|sell|trade)\b/.test(t);
      const r=b.getBoundingClientRect();
      const visible=r.width>40&&r.height>20&&r.bottom>0&&r.top<(window.innerHeight+200);
      return match&&visible;
    })||null;
  }
  function dockNear(el){
    const card=ensureCard(); const rect=el.getBoundingClientRect();
    const x=Math.min(rect.right+12, window.innerWidth-card.offsetWidth-16);
    const y=Math.max(16, rect.top+window.scrollY-10);
    card.style.left=`${x}px`; card.style.top=`${y}px`; card.style.right='auto'; card.style.bottom='auto';
  }
  function dockBR(){
    const card=ensureCard(); card.style.right='16px'; card.style.bottom='16px'; card.style.left='auto'; card.style.top='auto';
  }

  // --- Render loop for current route ---
  async function renderForRoute(){
    if(!isSymbolView()){
      const c=document.getElementById('sidecar-hud'); if(c) c.remove(); lastKey=''; return;
    }
    await new Promise(r=>setTimeout(r,600));
    const s=parseSymbolFromPath(); if(!s) return;

    const key=`${s.ex}:${s.sym}`;
    if(key===lastKey){
      const a=findAnchor(); if(a) dockNear(a); else dockBR();
      return;
    }
    lastKey=key;

    const j=await fetchJSON(s.ex, s.sym); if(!j){ dockBR(); return; }

    let chips=mapApplicableChips(j);
    const slip=computeSlippageFromDOM(); if(slip) chips.splice(Math.min(2,chips.length),0,slip);
    chips=chips.slice(0,4);

    const badges=extractBadges(j);
    const vtext=verdict(chips, badges);
    render(chips, badges, vtext);

    const a=findAnchor(); if(a) dockNear(a); else dockBR();
  }

  // Watch SPA route changes
  let hrefLast=location.href;
  setInterval(()=>{ if(location.href!==hrefLast){ hrefLast=location.href; renderForRoute(); } }, 700);
  renderForRoute();
})();
