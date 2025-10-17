// ==UserScript==
// @name         Sidecar HUD (StakeLens)
// @namespace    https://torqueenables.github.io/sidecar-data
// @version      0.3.1
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
  const MODE_KEY = 'sidecar_mode';              // 'day' or 'swing'
  const PREF_COMPACT = 'sidecar_compact';       // '1' = compact UI
  if (!localStorage.getItem(MODE_KEY)) localStorage.setItem(MODE_KEY, 'swing');

  const CACHE = new Map();
  let lastKey = '';

  // ---------- Symbol view detection (quote + chart routes) ----------
  const HOST = location.hostname;
  const PATTERNS = [
    /\/quote\/(NSE|BSE)\/([A-Z0-9.\-]+)/i,                        // Kite quote
    /\/markets\/chart\/web\/ciq\/(NSE|BSE)\/([A-Z0-9.\-]+)\//i,    // Kite chart
    /\/(equities|stocks)\/(NSE|BSE)\/([A-Z0-9.\-]+)/i,             // Dhan
    /\/stocks\/(NSE|BSE)\/([A-Z0-9.\-]+)/i,                        // Angel
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
    if (HOST === 'kite.zerodha.com') return /\/quote\/|\/markets\/chart\/web\/ciq\//.test(location.pathname);
    if (HOST === 'web.dhan.co')      return /\/(equities|stocks)\//.test(location.pathname);
    if (HOST === 'trade.angelone.in')return /\/stocks\//.test(location.pathname);
    return false;
  }

  // ---------- Data fetch ----------
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

  // ---------- Applicability filter (hide “None/Not applicable”) ----------
  function normalizeChip(key, p) {
    if (!p) return null;
    const d = (p.detail || '').trim();
    const dl = d.toLowerCase();

    // Generic "none" / "not active" filter
    const isNone = /(^|\s)(none|not\s+active|n\/a|no\s+event|no\s+change)(\s|$)/i.test(d);

    // Key-specific checks
    if (key === 't2t_asm') {
      // Show only if any surveillance/T2T is actually active
      if (isNone || /asm:\s*none/i.test(d) || /gsm:\s*none/i.test(d)) return null;
      return { key, color: p.color || 'amber', label: d.replace(/:/, ' –') };
    }
    if (key === 'fo_ban_today') {
      // Only show when ban ACTIVE
      const active = /ban/i.test(dl) || /no derivatives today/i.test(dl);
      if (!active || /not in ban|no ban/i.test(dl)) return null;
      return { key, color: 'red', label: 'In F&O ban today' };
    }
    if (key === 'events_short' || key === 'events_week') {
      // Keep when an event is within the mode horizon (“in 1–5d”, “today”, “tomorrow”)
      const soon = /in\s*\d+\s*d|today|tomorrow|t\-\d/i.test(dl);
      if (!soon) return null;
      // Humanize a bit
      return { key, color: p.color || 'amber', label: d.replace(/(\d+)d/i,'$1 days') };
    }
    if (key === 'delivery_anom') {
      const m = dl.match(/(\d+(\.\d+)?)\s*$/); // last number like 1.8
      if (!m) return null;
      const ratio = parseFloat(m[1]);
      if (!isFinite(ratio) || ratio < 1.5) return null;
      return { key, color: 'blue', label: `Delivery 5v20 ${ratio.toFixed(2)}×` };
    }
    if (key === 'pledge_delta') {
      // e.g., "+0.6 pp (30d)"; hide if magnitude small
      const mm = dl.match(/([+\-]?\d+(\.\d+)?)\s*pp/);
      if (!mm || Math.abs(parseFloat(mm[1])) < 0.5) return null;
      return { key, color: p.color || 'amber', label: d.replace('pp','pp') };
    }
    if (key === 'insider_net') {
      // e.g., "+₹3–4cr (30d)"; hide if bucket is 0 or missing
      if (/^\+?₹?0/.test(dl) || isNone) return null;
      return { key, color: p.color || 'green', label: `Insider net ${d}` };
    }
    if (key === 'priceband_t2t' || key === 'bulk_heat' || key === 'circuit') {
      // Low priority info; let ranking decide later (they’ll usually land in More)
      if (isNone) return null;
      return { key, color: p.color || 'blue', label: d };
    }

    // Fallback: if we can’t understand it, drop it
    return null;
  }

  function mapApplicableChips(json) {
    const mode = localStorage.getItem(MODE_KEY) || 'swing';
    const keys = (json.mode_top && json.mode_top[mode]) || [];
    const out = [];
    keys.forEach(k => {
      const chip = normalizeChip(k, json.pool && json.pool[k]);
      if (chip) out.push(chip);
    });
    return out;
  }

  // ---------- Client-only slippage (execution friction) ----------
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

  // ---------- Verdict sentence (friendly) ----------
  function verdictSentence(chips) {
    if (!chips.length) {
      const mode = localStorage.getItem(MODE_KEY) || 'swing';
      return mode === 'day'
        ? 'All clear: No bans or surveillance. No near-term events in the next 3 sessions.'
        : 'All clear: No bans or surveillance. No near-term events in the next 5 sessions.';
    }
    const parts = [];
    const hasRed = chips.some(c => c.color === 'red');
    const hasAmber = chips.some(c => c.color === 'amber');
    const head = hasRed ? 'Caution' : hasAmber ? 'Heads-up' : 'All clear';

    for (const c of chips.slice(0, 4)) {
      const t = (c.label || '').toLowerCase();
      if (/f&o ban|no f&o|ban today/.test(t)) parts.push('In F&O ban today');
      else if (/asm|gsm|esm|t2t/.test(t))     parts.push(c.label.replace(/:/,' –'));
      else if (/earnings|board|record/.test(t)) parts.push(c.label);
      else if (/slippage/.test(t))            parts.push(`Expect ${c.label.toLowerCase()}`);
      else if (/insider net/.test(t))         parts.push(c.label);
      else if (/delivery/.test(t))            parts.push(c.label);
      else parts.push(c.label);
    }
    return `${head}: ${parts.join(' • ')}`;
  }

  // ---------- UI (glass card + docking) ----------
  function colorHex(c) {
    if (c === 'red') return '#e5484d';
    if (c === 'amber') return '#f59e0b';
    if (c === 'blue') return '#3b82f6';
    if (c === 'green') return '#22c55e';
    return '#9ca3af';
  }

  function ensureCard() {
    let card = document.getElementById('sidecar-hud');
    if (card) return card;
    const compact = localStorage.getItem(PREF_COMPACT) === '1';
    card = document.createElement('div');
    card.id = 'sidecar-hud';
    card.style.cssText = `
      position: fixed; z-index: 2147483647;
      backdrop-filter: blur(10px) saturate(120%);
      -webkit-backdrop-filter: blur(10px) saturate(120%);
      background: rgba(20,22,28,0.55);
      border: 1px solid rgba(255,255,255,0.18);
      color: #fff;
      padding: ${compact ? '8px 10px' : '12px 14px'};
      border-radius: 16px;
      box-shadow: 0 12px 32px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.06);
      font: ${compact ? '11px' : '12px'}/1.35 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;
      max-width: ${compact ? '430px' : '520px'};
    `;
    card.innerHTML = `
      <div id="sc-verdict" style="font-weight:700;margin-bottom:8px"></div>
      <div id="sc-row" style="display:flex;gap:8px;flex-wrap:wrap"></div>
      <div style="opacity:.8;margin-top:8px;font-size:11px;display:flex;gap:12px;align-items:center">
        <span>Mode: <b id="sc-mode">${localStorage.getItem(MODE_KEY)||'swing'}</b></span>
        <span style="cursor:pointer;color:#a5d8ff" id="sc-toggle">toggle</span>
        <span style="cursor:pointer;color:#a5d8ff" id="sc-compact">${compact?'expand':'compact'}</span>
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
        background: ${colorHex(c.color)}; color: #0b0f14;
        padding: 5px 9px; border-radius: 999px; font-weight: 700;
        box-shadow: 0 1px 0 rgba(255,255,255,.35) inset;
      `;
      chip.textContent = c.label || '';
      row.appendChild(chip);
    });
  }

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
    await new Promise(r => setTimeout(r, 600)); // let SPA paint

    const s = parseSymbolFromPath();
    if (!s) return;

    const key = `${s.ex}:${s.sym}`;
    if (key === lastKey) {
      const a = findAnchor(); if (a) dockNear(a); else dockBottomRight();
      return;
    }
    lastKey = key;

    const j = await fetchJSON(s.ex, s.sym);
    if (!j) { dockBottomRight(); return; }

    // Map + filter to applicable chips only
    let chips = mapApplicableChips(j);

    // Client-only slippage
    const slip = computeSlippageFromDOM();
    if (slip) chips.splice(Math.min(2, chips.length), 0, slip);

    // Keep at most 4 (priority already from server)
    chips = chips.slice(0, 4);

    renderChips(chips, verdictSentence(chips));
    const a = findAnchor(); if (a) dockNear(a); else dockBottomRight();
  }

  // Watch URL changes (SPA navigation)
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
