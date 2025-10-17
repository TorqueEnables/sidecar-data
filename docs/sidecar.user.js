// ==UserScript==
// @name         Sidecar HUD (StakeLens)
// @namespace    https://torqueenables.github.io/sidecar-data
// @version      0.1.0
// @description  Decision-critical chips on broker pages (max 4). No login, no tracking.
// @match        https://kite.zerodha.com/*
// @match        https://web.dhan.co/*
// @match        https://trade.angelone.in/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://torqueenables.github.io/sidecar-data/docs/sidecar.user.js
// @updateURL    https://torqueenables.github.io/sidecar-data/docs/sidecar.user.js
// ==/UserScript==

(function() {
  'use strict';

  // ---------- Config ----------
  const DATA_BASE = 'https://torqueenables.github.io/sidecar-data/data/';
  const MODE_KEY = 'sidecar_mode';     // 'day' or 'swing'
  const OVERRIDE_KEY = 'sidecar_symbol_override'; // optional manual "NSE:BEL"
  const CACHE = new Map();

  // ---------- First-run mode chooser ----------
  if (!localStorage.getItem(MODE_KEY)) {
    const pickSwing = confirm('Sidecar HUD: Use Swing mode (weekly)?\nOK = Swing, Cancel = Day');
    localStorage.setItem(MODE_KEY, pickSwing ? 'swing' : 'day');
  }

  // ---------- Utilities ----------
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

  function byText(el, pattern) {
    return (el.innerText || '').match(pattern);
  }

  function symbolFromTitle() {
    // Very conservative: look for "(NSE) BEL" or "BEL (NSE)"
    const t = document.title || '';
    let m = t.match(/\b([A-Z0-9\.\-]+)\s*\((NSE|BSE)\)/);
    if (m) return {ex:m[2], sym:m[1]};
    m = t.match(/\((NSE|BSE)\)\s*([A-Z0-9\.\-]+)/);
    if (m) return {ex:m[1], sym:m[2]};
    return null;
  }

  function symbolFromURL() {
    // Heuristics (kept simple); we will improve later
    const u = location.href;
    // Kite often carries "exchange=" or "/stocks/" paths in some views
    let m = u.match(/[?&]exchange=(NSE|BSE)&?[^#&]*[?&]tradingsymbol=([A-Z0-9\.\-]+)/i);
    if (m) return {ex:m[1].toUpperCase(), sym:m[2].toUpperCase()};
    m = u.match(/\/(NSE|BSE)\/([A-Z0-9\.\-]+)/i);
    if (m) return {ex:m[1].toUpperCase(), sym:m[2].toUpperCase()};
    return null;
  }

  function getManualOverride() {
    const v = localStorage.getItem(OVERRIDE_KEY);
    if (!v) return null;
    const parts = v.split(':');
    if (parts.length === 2) return {ex:parts[0].toUpperCase(), sym:parts[1].toUpperCase()};
    return null;
  }

  async function chooseManualSymbol() {
    const v = prompt('Sidecar HUD: Enter symbol as NSE:SYMBOL or BSE:SYMBOL (e.g., NSE:BEL)');
    if (!v) return null;
    localStorage.setItem(OVERRIDE_KEY, v.trim());
    return getManualOverride();
  }

  function detectSymbol() {
    return getManualOverride() || symbolFromURL() || symbolFromTitle();
  }

  async function fetchJSON(ex, sym) {
    const key = `${ex}:${sym}`;
    if (CACHE.has(key)) return CACHE.get(key);
    const url = `${DATA_BASE}${encodeURIComponent(ex)}:${encodeURIComponent(sym)}.json`;
    try {
      const r = await fetch(url, {cache:'no-store'});
      if (!r.ok) throw new Error('HTTP '+r.status);
      const j = await r.json();
      CACHE.set(key, j);
      return j;
    } catch(e) {
      console.warn('Sidecar HUD: fetch failed', e);
      return null;
    }
  }

  function computeSlippageFromDOM() {
    // Minimal v0: try to read "Bid" and "Ask" from text if present
    const txt = document.body.innerText;
    const bid = parseFloat((txt.match(/Bid\s*([\d,]*\.?\d+)/i)||[])[1]?.replace(/,/g,''));
    const ask = parseFloat((txt.match(/Ask\s*([\d,]*\.?\d+)/i)||[])[1]?.replace(/,/g,''));
    if (bid && ask && ask > bid) {
      const pct = ((ask - bid) / ((ask + bid)/2)) * 100;
      if (pct >= 0.30) {
        return {key:'slippage', color:'amber', label:`Slippage ${pct.toFixed(2)}%`};
      }
    }
    return null;
  }

  function verdict(chips) {
    // Show top severity summaries
    const top = chips.slice(0,3).map(c=>c.label || c.detail).filter(Boolean);
    return top.join(' • ');
  }

  function colorToHex(c) {
    if (c==='red') return '#d33';
    if (c==='amber') return '#e6a700';
    if (c==='blue') return '#3a7bd5';
    if (c==='green') return '#2e8b57';
    return '#666';
  }

  function renderHUD(chips, vtext) {
    // Remove old if any
    const old = document.getElementById('sidecar-hud');
    if (old) old.remove();

    const bar = document.createElement('div');
    bar.id = 'sidecar-hud';
    bar.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      background: rgba(22,22,26,0.95); color: #fff; padding: 10px 12px;
      border-radius: 12px; font: 12px/1.25 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;
      box-shadow: 0 10px 28px rgba(0,0,0,.35); max-width: 460px;
    `;

    const verdictEl = document.createElement('div');
    verdictEl.textContent = vtext || 'Sidecar';
    verdictEl.style.cssText = 'font-weight:700;margin-bottom:6px;';
    bar.appendChild(verdictEl);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap;';
    chips.slice(0,4).forEach(c=>{
      const chip = document.createElement('span');
      chip.style.cssText = `
        background:${colorToHex(c.color)};
        color:#fff; padding:4px 8px; border-radius:999px; font-weight:600;
      `;
      chip.textContent = c.label || c.detail || '';
      row.appendChild(chip);
    });
    bar.appendChild(row);

    const foot = document.createElement('div');
    foot.style.cssText = 'opacity:.7;margin-top:6px;font-size:11px;';
    foot.innerHTML = 'Mode: <b>'+ (localStorage.getItem(MODE_KEY) || 'swing') + '</b> • <a href="#" style="color:#9cf" id="sidecar-mode-toggle">toggle</a> • <a href="#" style="color:#9cf" id="sidecar-symbol-set">symbol</a>';
    bar.appendChild(foot);

    document.body.appendChild(bar);

    document.getElementById('sidecar-mode-toggle').onclick = (e)=>{
      e.preventDefault();
      const cur = localStorage.getItem(MODE_KEY) || 'swing';
      const next = (cur==='swing'?'day':'swing');
      localStorage.setItem(MODE_KEY, next);
      location.reload();
    };
    document.getElementById('sidecar-symbol-set').onclick = async (e)=>{
      e.preventDefault();
      await chooseManualSymbol();
      location.reload();
    };
  }

  function mapChips(json) {
    const mode = localStorage.getItem(MODE_KEY) || 'swing';
    const keys = (json.mode_top && json.mode_top[mode]) || [];
    const arr = [];
    keys.forEach(k=>{
      const p = json.pool && json.pool[k];
      if (!p) return;
      arr.push({key:k, color:p.color || 'blue', label:p.detail || k});
    });
    return arr;
  }

  async function main() {
    // small delay to let broker DOM settle
    await sleep(1200);

    let symObj = detectSymbol();
    if (!symObj) {
      // Prompt user to set a manual override once
      symObj = await chooseManualSymbol();
      if (!symObj) return;
    }

    let j = await fetchJSON(symObj.ex, symObj.sym);
    if (!j) {
      // Give user a chance to set manual symbol if our detection is off
      symObj = await chooseManualSymbol();
      if (!symObj) return;
      j = await fetchJSON(symObj.ex, symObj.sym);
      if (!j) return;
    }

    // Map pre-ranked chips from JSON
    const chips = mapChips(j);

    // Compute slippage client-side and insert if present
    const slip = computeSlippageFromDOM();
    if (slip) {
      // insert at position 3 (index 2) to ensure it's visible
      chips.splice(Math.min(2, chips.length), 0, slip);
    }

    const v = verdict(chips);
    renderHUD(chips, v);
  }

  main();
})();
