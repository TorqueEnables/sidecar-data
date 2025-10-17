// ==UserScript==
// @name         Sidecar HUD (StakeLens)
// @namespace    https://torqueenables.github.io/sidecar-data
// @version      0.3.0
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
      const soon = /in\
