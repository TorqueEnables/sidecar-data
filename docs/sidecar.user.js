// ==UserScript==
// @name         Sidecar HUD (StakeLens)
// @namespace    https://torqueenables.github.io/sidecar-data
// @version      0.2.0
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
  const MODE_KEY = 'sidecar_mode';                 // 'day' or 'swing'
  const PREF_COMPACT = 'sidecar_compact';          // '1' = smaller UI
  const CACHE = new Map();

  // Defaults (no popups)
  if (!localStorage.getItem(MODE_KEY)) localStorage.setItem(MODE_KEY, 'swing');

  // ---------- Broker gating (avoid dashboard noise) ----------
  function isKiteQuoteView() {
    // Only render on quote pages like /quote/NSE/BEL
    return location.hostname === 'kite.zerodha.com' && /^\/quote\/(NSE|BSE)\/[A-Z0-9.\-]+/i.test(location.pathname);
  }
  function isDhanQuoteView() {
    return location.hostname === 'web.dhan.co' && /\/(equities|stocks)\/(NSE|BSE)\/[A-Z0-9.\-]+/i.test(location.pathname);
  }
  function isAngelQuoteView() {
    return location.hostname === 'trade.angelone.in' && /\/stocks\/(NSE|BSE)\/[A-Z0-9.\-]+/i.test(location.pathname);
  }
  function isQuoteView() {
    return isKiteQuoteView() || isDhanQuoteView() || isAngelQuoteView();
  }

  // ---------- Symbol detection (no prompts) ----------
  function detectSymbol() {
    const p = location.pathname;
    let m = p.match(/\/quote\/(NSE|BSE)\/([A-Z0-9.\-]+)/i); // Kite
    if (m) return { ex: m[1].toUpperCase(), sym: m[2].toUpperCase() };
    m = p.match(/\/(equities|stocks)\/(NSE|BSE)\/([A-Z0-9.\-]+)/i); // Dhan
    if (m) return { ex: m[2].toUpperCase(), sym: m[3].toUpperCase() };
    m = p.match(/\/stocks\/(NSE|BSE)\/([A-Z0-9.\-]+)/i); // Angel
    if (m) return { ex: m[1].toUpperCase(), sym: m[2].toUpperCase() };
    return null;
  }

  // ---------- Fetch JSON ----------
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

  // ---------- On-page slippage (Day mode mostly) ----------
  function computeSlippageFromDOM() {
    // Conservative v0: parse visible "Bid" / "Ask" values if present
    const txt = document.body.innerText || '';
    const bid = parseFloat((txt.match(/Bid\s*([\d,]*\.?\d+)/i) || [])[1]?.replace(/,/g, ''));
    const ask = parseFloat((txt.match(/Ask\s*([\d,]*\.?\d+)/i) || [])[1]?.replace(/,/g, ''));
    if (bid && ask && ask > bid) {
      const pct = ((ask - bid) / ((ask + bid) / 2)) * 100;
      if (pct >= 0.30) return { key: 'slippage', color: 'amber', label: `Slippage ${pct.toFixed(2)}%` };
    }
    return null;
  }

  // ---------- Verdict (human phrasing) ----------
  function buildVerdict(chips) {
    const hasRed = chips.some(c => c.color === 'red');
    const hasAmber = chips.some(c => c.color === 'amber');
    const head = hasRed ? 'Caution' : hasAmber ? 'Heads-up' : 'All clear';

    const phrases = [];
    for (const c of chips.slice(0, 4)) {
      const t = (c.label || '').toLowerCase();
      if (/no derivatives today/.test(t)) phrases.push('No F&O today');
      else if (/asm|gsm|esm|t2t/.test(t)) phrases.push(c.label.replace(/:/, ' –'));
      else if (/earnings|board|record/.test(t)) phrases.push(c.label.replace(/ in /i, ' in '));
      else if (/slippage/.test(t)) phrases.push(c.label);
      else if (/insider/.test(t)) phrases.push(c.label);
      else phrases.push(c.label);
    }
    return `${head}: ${phrases.slice(0, 3).join(' • ')}`;
  }

  // ---------- Map server chips ----------
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

  // ---------- UI: card + docking near Buy/Sell ----------
  function colorHex(c) {
    if (c === 'red') return '#d33';
    if (c === 'amber') return '#e6a700';
    if (c === 'blue') return '#3a7bd5';
    if (c === 'green') return '#2e8b57';
    return '#666';
  }

  function createCard() {
    const card = document.createElement('div');
    card.id = 'sidecar-hud';
    const compact = localStorage.getItem(PREF_COMPACT) === '1';
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

    // Actions
    card.querySelector('#sc-toggle').onclick = (e) => {
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
    const card = document.getElementById('sidecar-hud') || createCard();
    const verdictEl = card.querySelector('#sc-verdict');
    verdictEl.textContent = verdictText || 'Sidecar';

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

  // Try to dock near Buy/Sell; fallback bottom-right
  function findOrderAnchor() {
    // Look for a visible button with text Buy or Sell on the page
    const btns = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
    const cand = btns.find(b => {
      const t = (b.innerText || '').trim().toLowerCase();
      if (!t) return false;
      const r = /^(buy|sell)$/i.test(t) || /\b(buy|sell)\b/i.test(t);
      const rect = b.getBoundingClientRect();
      const visible = rect.width > 40 && rect.height > 20 && rect.top >= 0 && rect.bottom <= (window.innerHeight + 200);
      return r && visible;
    });
    return cand || null;
  }

  function dockCardNear(el) {
    const card = document.getElementById('sidecar-hud') || createCard();
    const rect = el.getBoundingClientRect();
    const x = Math.min(rect.right + 12, window.innerWidth - card.offsetWidth - 16);
    const y = Math.max(16, rect.top + window.scrollY - 10);
    card.style.left = `${x}px`;
    card.style.top  = `${y}px`;
    card.style.right = 'auto';
    card.style.bottom = 'auto';
  }

  function dockFallbackBottomRight() {
    const card = document.getElementById('sidecar-hud') || createCard();
    card.style.right = '16px';
    card.style.bottom = '16px';
    card.style.left = 'auto';
    card.style.top = 'auto';
  }

  // ---------- Main ----------
  async function main() {
    if (!isQuoteView()) return; // no HUD on dashboard/login/etc.

    // Wait a bit so broker DOM settles
    await new Promise(r => setTimeout(r, 800));

    const sym = detectSymbol();
    if (!sym) return;

    let j = await fetchJSON(sym.ex, sym.sym);
    if (!j) return;

    // Server-picked top chips
    const chips = mapChips(j);

    // Add client-only slippage (mostly Day mode)
    const slip = computeSlippageFromDOM();
    if (slip) chips.splice(Math.min(2, chips.length), 0, slip);

    const vtext = buildVerdict(chips);
    renderChips(chips, vtext);

    // Dock near Buy/Sell if possible; watch DOM for changes
    const anchor = findOrderAnchor();
    if (anchor) dockCardNear(anchor); else dockFallbackBottomRight();

    // Re-dock on resize/scroll (throttle)
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => {
      const a = findOrderAnchor();
      if (a) dockCardNear(a); else dockFallbackBottomRight();
    }, 120);});
    window.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => {
      const a = findOrderAnchor();
      if (a) dockCardNear(a); else dockFallbackBottomRight();
    }, 120);});

    // React to route changes (Kite SPA navigation)
    const obs = new MutationObserver(() => {
      if (!isQuoteView()) {
        const c = document.getElementById('sidecar-hud'); if (c) c.remove();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  main();
})();
