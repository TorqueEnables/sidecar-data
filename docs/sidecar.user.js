// ==UserScript==
// @name         Sidecar HUD (StakeLens)
// @namespace    https://torqueenables.github.io/sidecar-data
// @version      0.2.1
// @description  Decision-critical chips on broker pages (max 4). No login, no tracking.
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

  // ---------- Config ----------
  const DATA_BASE = 'https://torqueenables.github.io/sidecar-data/data/';
  const MODE_KEY = 'sidecar_mode';           // 'day' or 'swing'
  const PREF_COMPACT = 'sidecar_compact';    // '1' compact UI
  if (!localStorage.getItem(MODE_KEY)) localStorage.setItem(MODE_KEY, 'swing');

  const CACHE = new Map();
  let lastKey = '';

  // ---------- Route helpers ----------
  const HOST = location.hostname;

  const PATTERNS = [
    // Kite quote page: /quote/NSE/BEL
    /\/quote\/(NSE|BSE)\/([A-Z0-9.\-]+)/i,
    // Kite chart page (your URL): /markets/chart/web/ciq/NSE/BEL/98049
    /\/markets\/chart\/web\/ciq\/(NSE|BSE)\/([A-Z0-9.\-]+)\//i,
    // Dhan: /equities/NSE/BEL or /stocks/NSE/BEL
    /\/(equities|stocks)\/(NSE|BSE)\/([A-Z0-9.\-]+)/i,
    // Angel: /stocks/NSE/BEL
    /\/stocks\/(NSE|BSE)\/([A-Z0-9.\-]+)/i,
    // Fallback query params some brokers use
    /[?&]exchange=(NSE|BSE)[^#&]*[?&]tradingsymbol=([A-Z0-9.\-]+)/i
  ];

  function parseSymbolFromPath() {
    const p = location.pathname + location.search;
    for (const re of PATTERNS) {
      const m = p.match(re);
      if (!m) continue;
      if (re === PATTERNS[2]) return { ex: m[2].toUpperCase(), sym: m[3].toUpperCase() }; // Dhan
      return { ex: (m[1] || m[2]).toUpperCase(), sym: (m[2] || m[3]).toUpperCase() };
    }
    return null;
  }

  function isSymbolView() {
    if (HOST === 'kite.zerodha.com') {
      return !!location.pathname.match(/\/quote\/|\/markets\/chart\/web\/ciq\//);
    }
    if (HOST === 'web.dhan.co') {
      return !!location.pathname.match(/\/(equities|stocks)\//);
    }
    if (HOST === 'trade.angelone.in') {
      return !!location.pathname.match(/\/stocks\//);
    }
    return false;
  }

  // ---------- Data ----------
  async function fetchJSON(ex, sym) {
    const key = `${ex}:${sym}`;
    if (CACHE.has(key)) return CACHE.get(key);
    const url = `${DATA_BASE}${encodeURIComponent(ex)}:${encodeURIComponent(sym)}.json`;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      CACHE.set(key, j);
      return j;
    } catch (e) {
      console.warn('Sidecar HUD: fetch failed', e);
      return null;
    }
  }

  function computeSlippageFromDOM() {
    const txt = document.body.innerText || '';
    const bid = parseFloat((txt.match(/Bid\s*([\d,]*\.?\d+)/i) || [])[1]?.replace(/,/g, ''));
    const ask = parseFloat((txt.match(/Ask\s*([\d,]*\.?\d+)/i) || [])[1]?.replace(/,/g, ''));
    if (bid && ask && ask > bid) {
      const pct = ((ask - bid) / ((ask + bid) / 2)) * 100;
      if (pct >= 0.30) return { key: 'slippage', color: 'amber', label: `Slippage ${pct.toFixed(2)}%` };
    }
    return null;
  }

  function mapChips(json) {
    const mode = localStorage.getItem(MODE_KEY) || 'swing';
    const keys = (json.mode_top && json.mode_top[mode]) || [];
    const out = [];
    keys.forEach(k => {
      const p = json.pool && json.pool[k];
      if (!p) return;
      out.push({ key: k, color: p.color || 'blue', label: p.detail || k });
    });
    return out;
  }

  // ---------- Verdict ----------
  function humanVerdict(chips) {
    const hasRed = chips.some(c => c.color === 'red');
    const hasAmber = chips.some(c => c.color === 'amber');
    const head = hasRed ? 'Caution' : hasAmber ? 'Heads-up' : 'All clear';
    const phrases = [];
    for (const c of chips.slice(0, 4)) {
      const t = (c.label || '').toLowerCase();
      if (/no derivatives today/.test(t)) phrases.push('No F&O today');
      else if (/asm|gsm|esm|t2t/.test(t)) phrases.push(c.label.replace(/:/, ' –'));
      else if (/earnings|board|record/.test(t)) phrases.push(c.label);
      else if (/slippage/.test(t)) phrases.push(c.label);
      else if (/insider/.test(t)) phrases.push(c.label);
      else phrases.push(c.label);
    }
    return `${head}: ${phrases.slice(0, 3).join(' • ')}`;
  }

  // ---------- UI ----------
  function colorHex(c) {
    if (c === 'red') return '#d33';
    if (c === 'amber') return '#e6a700';
    if (c === 'blue') return '#3a7bd5';
    if (c === 'green') return '#2e8b57';
    return '#666';
  }

  function ensureCard() {
    let card = document.getElementById('sidecar-hud');
    if (card) return card;
    const compact = localStorage.getItem(PREF_COMPACT) === '1';
    card = document.createElement('div');
    card.id = 'sidecar-hud';
    card.style.cssText = `
      position: fixed; z-index: 2147483647;
      background: rgba(23,24,28,0.96); color: #fff;
      padding: ${compact ? '8px 10px' : '10px 12px'};
      border-radius: 14px; box-shadow: 0 10px 28px rgba(0,0,0,.35);
      font: ${compact ? '11px' : '12px'}/1.25 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;
      max-width: ${compact ? '420px' : '480px'};
    `;
    card.innerHTML = `
      <div id="sc-verdict" style="font-weight:700;margin-bottom:6px"></div>
      <div id="sc-row" style="display:flex;gap:6px;flex-wrap:wrap"></div>
      <div style="opacity:.75;margin-top:6px;font-size:11px;display:flex;gap:10px;align-items:center">
        <span>Mode: <b id="sc-mode">${localStorage.getItem(MODE_KEY)||'swing'}</b></span>
        <span style="cursor:pointer;color:#9cf" id="sc-toggle">toggle</span>
        <span style="cursor:pointer;color:#9cf" id="sc-compact">${compact?'expand':'compact'}</span>
      </div>`;
    document.body.appendChild(card);
    card.querySelector('#sc-toggle').onclick = () => {
      const cur = localStorage.getItem(MODE_KEY) || 'swing';
      const next = cur === 'swing' ? 'day' : 'swing';
      localStorage.setItem(MODE_KEY, next);
      location.reload();
    };
    card.querySelector('#sc-compact').onclick = () => {
      const cur = localStorage.getItem(PREF_COMPACT) === '1';
      localStorage.setItem(PREF_COMPACT, cur ? '0' : '1');
      location.reload();
    };
    return card;
  }

  function renderChips(chips, verdictText) {
    const card = ensureCard();
    card.querySelector('#sc-verdict').textContent = verdictText || 'Sidecar';
    const row = card.querySelector('#sc-row');
    row.innerHTML = '';
    chips.slice(0, 4).forEach(c => {
      const chip = document.createElement('span');
      chip.style.cssText = `
        background:${colorHex(c.color)};color:#fff;
        padding:4px 8px;border-radius:999px;font-weight:600
      `;
      chip.textContent = c.label || '';
      row.appendChild(chip);
    });
  }

  // Docking near visible Buy/Sell/Trade; otherwise bottom-right
  function findAnchor() {
    const btns = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
    const cand = btns.find(b => {
      const t = (b.innerText || '').trim().toLowerCase();
      if (!t) return false;
      const match = /^(buy|sell|trade)$/.test(t) || /\b(buy|sell|trade)\b/.test(t);
      const r = b.getBoundingClientRect();
      const visible = r.width > 40 && r.height > 20 && r.bottom > 0 && r.top < (window.innerHeight + 200);
      return match && visible;
    });
    return cand || null;
  }

  function dockNear(el) {
    const card = ensureCard();
    const rect = el.getBoundingClientRect();
    const x = Math.min(rect.right + 12, window.innerWidth - card.offsetWidth - 16);
    const y = Math.max(16, rect.top + window.scrollY - 10);
    card.style.left = `${x}px`;
    card.style.top  = `${y}px`;
    card.style.right = 'auto';
    card.style.bottom = 'auto';
  }

  function dockBottomRight() {
    const card = ensureCard();
    card.style.right = '16px';
    card.style.bottom = '16px';
    card.style.left = 'auto';
    card.style.top = 'auto';
  }

  // ---------- Render for current route ----------
  async function renderForRoute() {
    if (!isSymbolView()) {
      const c = document.getElementById('sidecar-hud'); if (c) c.remove();
      lastKey = '';
      return;
    }
    // Give SPA time to paint
    await new Promise(r => setTimeout(r, 600));

    const s = parseSymbolFromPath();
    if (!s) return;

    const key = `${s.ex}:${s.sym}`;
    if (key === lastKey) {
      // Just re-dock if needed
      const a = findAnchor(); if (a) dockNear(a); else dockBottomRight();
      return;
    }
    lastKey = key;

    const j = await fetchJSON(s.ex, s.sym);
    if (!j) { dockBottomRight(); return; }

    const chips = mapChips(j);
    const slip = computeSlippageFromDOM();
    if (slip) chips.splice(Math.min(2, chips.length), 0, slip);

    renderChips(chips, humanVerdict(chips));
    const a = findAnchor(); if (a) dockNear(a); else dockBottomRight();
  }

  // ---------- Watch URL changes (SPA) ----------
  let hrefLast = location.href;
  setInterval(() => {
    if (location.href !== hrefLast) {
      hrefLast = location.href;
      renderForRoute();
    }
  }, 700);

  // Initial render
  renderForRoute();
})();
