// Progress note 工作畫面的顯示層：把資料模型 M 畫進 shadow root。不碰網路，也不碰病歷表單。
const PNW_VIEW = (() => {
  'use strict';
  const H = 3600e3, DAY = 24 * H;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const md = (t) => { const d = new Date(t); return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`; };
  const hm = (t) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n));
  const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const WEEK = '日一二三四五六';
  const fin = Number.isFinite;

  const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<symbol id="i-insert" viewBox="0 0 16 16"><path d="M13 3v4.5a2 2 0 0 1-2 2H4M6.5 6.5 3.5 9.5l3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-rows" viewBox="0 0 16 16"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></symbol>
<symbol id="i-list" viewBox="0 0 16 16"><path d="M2.5 3.5h4v9h-4zM9 4.5h4.5M9 8h4.5M9 11.5h4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-reload" viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 3v2.6h-2.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-chev" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-close" viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5M2.5 3v10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>
</svg>`;
  const SHELL = `${SPRITE}
<button class="reopen" type="button" id="btnReopen" hidden>工作畫面</button>
<div class="dock" id="dock">
  <div class="bar">
    <b id="barBed"></b><span class="dim" id="barWho"></span>
    <label class="dim" for="baseSel">上一篇</label><select id="baseSel" title="「自上一篇以來」要從哪一篇 note 算起"></select>
    <div class="seg" role="group" aria-label="時間軸範圍"><button type="button" data-range="24">24h</button><button type="button" data-range="72" aria-pressed="true">3 天</button><button type="button" data-range="168">7 天</button><button type="button" data-range="custom" title="自己指定時間軸要看幾天">自訂</button></div>
    <label class="range-n" id="rangeBox" hidden><input type="number" id="rangeDays" min="1" max="60" step="1" value="14" aria-label="時間軸天數"> 天</label>
    <button class="bar-btn" type="button" id="btnCompact" aria-pressed="false" title="精簡：時間軸只留體溫、抗生素、培養">${icon('rows')}<span class="t">精簡</span></button>
    <button class="bar-btn primary" type="button" id="btnFill" title="一鍵帶入：把 V/S、上一篇之後的新 Lab、影像、培養與病原檢驗、管路放進這篇 note 對應的地方。只填空的地方、只加不刪；V/S 那一段如果全是舊數值會換成新的。不會存檔。">${icon('insert')}帶入</button>
    <span class="status" id="status" role="status" aria-live="polite"></span>
    <button class="bar-btn" type="button" id="btnList" aria-pressed="false" title="清單：顯示或隱藏 HIS 左邊的 note 清單">${icon('list')}<span class="t">清單</span></button>
    <button class="bar-btn" type="button" id="btnReload" title="重抓：重新抓這位病人的資料">${icon('reload')}<span class="t">重抓</span></button>
    <button class="bar-btn" type="button" id="btnHide" title="收起：收起工作畫面，回到 HIS 原本的版面">${icon('close')}<span class="t">收起</span></button>
  </div>
  <section class="tl" aria-label="生命徵象、I/O、抗生素與培養的共同時間軸">
    <div class="tl-legend" id="tlLegend"></div>
    <div class="tl-plot" id="tlPlot"><svg id="tlSvg" role="img" aria-label="時間軸圖"></svg><div class="tl-read" id="tlRead" hidden></div></div>
  </section>
  <div class="ref"><div class="col col1" id="col1"></div><div class="col col2" id="col2"></div><div class="col col3" id="col3"></div></div>
</div>`;

  const ATC = { J: '抗感染', C: '心血管', A: '腸胃與代謝', B: '血液與輸液', N: '神經與止痛', R: '呼吸', H: '荷爾蒙', L: '抗腫瘤與免疫', M: '肌肉骨骼', S: '眼耳', D: '皮膚', G: '泌尿生殖', P: '抗寄生蟲', V: '其他' };
  const shortSpec = (s) => {
    const u = String(s || '').toUpperCase();
    if (/BLOOD/.test(u)) return 'B/C';
    if (/URINE/.test(u)) return 'U/C';
    if (/SPUTUM|BRONCH|BAL|TRACHEAL|ENDOTRACH/.test(u)) return 'Sputum';
    if (/PLEURAL/.test(u)) return 'Pleural';
    if (/STOOL/.test(u)) return 'Stool';
    if (/ASCIT/.test(u)) return 'Ascites';
    if (/CSF/.test(u)) return 'CSF';
    if (/TIP|CVC|CVP|CATHETER/.test(u)) return 'Tip';
    if (/PUS|WOUND|ABSCESS/.test(u)) return 'Wound';
    if (/DRAIN/.test(u)) return 'Drain';
    if (/SWAB/.test(u)) return 'Swab';
    return String(s || '?').split(/\s+/).slice(0, 2).join(' ').slice(0, 14);
  };
  const orgBase = (s) => String(s || '').replace(/\s+(\d\+|[<>]?=?\s*[\d,]+(\s*CFU\/mL)?)\s*$/i, '').replace(/\s+/g, ' ').trim();
  const orgAbbr = (s) => orgBase(s).replace(/^([A-Z])[a-z]+\s+(?=[a-z])(?!species\b|spp\b|sp\.|complex\b|group\b)/, '$1. ');
  const imgKind = (t) => (/chest|cxr/i.test(t) && !/CT/.test(t) ? 'CXR' : /\bCT\b/i.test(t) ? 'CT' : /MR/i.test(t) ? 'MRI' : /echo|sono|ultra/i.test(t) ? 'Sono' : /KUB|abdomen/i.test(t) ? 'KUB' : 'Image');
  const CX_ITEM = /Culture|ID\+DS|ID C\.|Campy|Anaerobic|Gram|AF Stain|AFS|Fung|Identification|KOH|screening/i;

  function create(root, M, hooks) {
    const $ = (s) => root.querySelector(s);
    const $$ = (s) => [...root.querySelectorAll(s)];
    const ui = { range: 72, compact: window.innerHeight < 820, abn: false, quiet: false, inDetail: false, dayHi: null, labEdit: false, pin: null, labDays: 10, labPage: 0, abxOld: false };
    // 個人設定記在這台電腦的瀏覽器（所有病人共用）：哪些區塊收合、Lab 不顯示哪些項目
    const pget = (k, d) => { try { const v = localStorage.getItem('pnw.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
    const pset = (k, v) => { try { localStorage.setItem('pnw.' + k, JSON.stringify(v)); } catch (e) { /* 只是記不住 */ } };
    const fold = Object.assign({ since: true, nursing: true, handoff: true }, pget('fold', {}));
    const labHide = new Set(pget('labHide', ['eGFR']));
    const secOpen = (key, title, head, cls) => `<section class="sec ${cls || ''} ${fold[key] ? 'folded' : ''}" data-sec="${key}"><div class="sec-h"><button class="fold" type="button" data-fold="${key}" aria-expanded="${!fold[key]}" title="展開或收合「${esc(title)}」" aria-label="展開或收合「${esc(title)}」">${icon('chev')}</button><h2>${esc(title)}</h2>${head || ''}</div><div class="sec-b">`;
    const secClose = '</div></section>';
    const INS = [];
    function insBtn(text, label, withText) {
      INS.push({ text, label });
      return `<button class="${withText ? 'ib ib-text' : 'ib'}" type="button" data-ins="${INS.length - 1}" title="插入 note：${esc(label)}" aria-label="插入 note：${esc(label)}">${icon('insert')}${withText ? esc(withText) : ''}</button>`;
    }
    const now = () => M.now;
    const base = () => (fin(M.base) ? M.base : M.now - DAY);
    const dayNo = (start, at) => Math.round((dayStart(at == null ? now() : at) - dayStart(start)) / DAY) + 1;
    const stateNote = (key, label) => (M.err[key] ? `<p class="note err">${esc(label)}抓取失敗：${esc(M.err[key])}</p>` : M.loading.has(key) ? `<p class="note">${esc(label)}載入中…</p>` : '');
    let sayTimer = 0;
    function say(msg, kind) {
      const el = $('#status');
      el.textContent = msg; el.title = msg; el.className = 'status' + (kind ? ' ' + kind : '');
      clearTimeout(sayTimer);
      if (kind) sayTimer = setTimeout(() => { el.className = 'status'; }, 4000);
    }

    /* ---------- 整理：培養清單、藥敏、Lab 表 ---------- */
    function cultureList() {
      const list = [];
      const byNo = new Map();
      (M.micro || []).forEach((e, i) => {
        const it = { id: 'm' + i, t: e.t, spec: e.spec, short: shortSpec(e.spec), status: e.orgs.length ? 'grown' : 'ng', e, pend: [] };
        list.push(it); if (e.no) byNo.set(e.no, it);
      });
      (M.pending || []).forEach((p, i) => {
        const cx = p.items.filter((x) => CX_ITEM.test(x.name));
        if (!cx.length) return;
        const hit = byNo.get(p.no);
        if (hit) { hit.pend = cx.map((x) => x.name); if (hit.status !== 'grown') hit.status = 'pending'; return; }
        list.push({ id: 'p' + i, t: p.t, spec: p.spec, short: shortSpec(p.spec), status: 'pending', e: null, pend: cx.map((x) => x.name) });
      });
      return list.filter((c) => fin(c.t)).sort((a, b) => b.t - a.t);
    }
    function isolates() {
      const by = new Map();
      for (const e of M.micro || []) for (const s of e.sens) {
        const org = orgAbbr(s.org);
        const key = org + '|' + s.list.map((x) => x.code + x.sir).join(',');
        if (!by.has(key)) by.set(key, { org, list: s.list, from: [] });
        by.get(key).from.push({ t: e.t, short: shortSpec(e.spec) });
      }
      return [...by.values()].sort((a, b) => Math.max(...b.from.map((f) => f.t)) - Math.max(...a.from.map((f) => f.t)));
    }
    const drugKey = (s) => String(s || '').toLowerCase().replace(/[^a-z/ ]/g, ' ').trim().split(/[\s/]+/)[0];
    function sirFor(abx, iso) {
      const g = drugKey(abx.generic || abx.name), n = drugKey(abx.name);
      return iso.list.find((x) => { const k = drugKey(x.drug); return k && (k === g || k === n); }) || null;
    }
    function labModel(fit) {
      const s = M.labs && M.labs.summary;
      if (!s || !s.blood) return null;
      const yr = new Date(now()).getFullYear();
      const msOfKey = (k) => { const m = String(k).match(/^(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/); if (!m) return NaN; let t = +new Date(yr, +m[1] - 1, +m[2], +(m[3] || 0), +(m[4] || 0)); if (t > now() + 2 * DAY) t = +new Date(yr - 1, +m[1] - 1, +m[2], +(m[3] || 0), +(m[4] || 0)); return t; };
      const sets = [{ name: null, set: s.blood }, ...Object.entries(s.special || {}).map(([name, set]) => ({ name, set }))];
      const dayOf = (k) => String(k).split(' ')[0];
      const allDays = new Map();
      for (const { set } of sets) for (const k of set.dates) { const t = msOfKey(k); if (fin(t)) allDays.set(dayOf(k), dayStart(t)); }
      // 範圍內（近 ui.labDays 天）的抽血日；欄位放不下時只顯示其中 fit 個，用翻頁看更早的
      const inRange = [...allDays].map(([d, ms]) => ({ d, ms })).filter((c) => c.ms >= dayStart(now() - (ui.labDays - 1) * DAY)).sort((a, b) => a.ms - b.ms);
      const total = inRange.length;
      const maxPage = Math.max(0, total - fit);
      ui.labPage = Math.min(ui.labPage, maxPage);
      const cols = inRange.slice(Math.max(0, total - fit - ui.labPage), total - ui.labPage);
      cols.forEach((c) => { c.times = []; });
      const colIdx = new Map(cols.map((c, i) => [c.d, i]));
      const rowOf = (set, it, label) => {
        const cells = cols.map(() => null);
        set.dates.forEach((k, i) => {
          const ci = colIdx.get(dayOf(k)); const v = it.vals[i];
          if (ci == null || !v) return;
          const tm = (String(k).split(' ')[1] || '');
          if (tm && !cols[ci].times.includes(tm)) cols[ci].times.push(tm);
          const cur = cells[ci];
          cells[ci] = { v, lv: it.level[i], tm, more: cur ? cur.more + 1 : 0, all: (cur ? cur.all : []).concat(`${tm || dayOf(k)} ${v}`) };
        });
        if (!cells.some(Boolean)) return null;
        const all = set.dates.map((k, i) => ({ t: msOfKey(k), v: it.vals[i], lv: it.level[i] })).filter((p) => p.v && fin(p.t));
        return { k: label || it.name, unit: it.unit, ref: it.ref, cells, all };
      };
      const groups = [];
      const blood = new Map(s.blood.items.map((it) => [it.name, it]));
      const used = new Set();
      const defs = [];
      for (const [title, keys] of s.groups) {
        if (title === 'Electrolytes') { const r = defs.find((d) => d[0] === 'Renal & e-'); if (r) { r[1].push(...keys); continue; } }
        defs.push([title === 'Renal' ? 'Renal & e-' : title, keys.slice()]);
      }
      const attach = s.attach || {};
      for (const [title, keys] of defs) {
        const order = [];
        for (const k of keys) { if (!order.includes(k)) order.push(k); if (attach[k] && !order.includes(attach[k])) order.push(attach[k]); }
        const rows = order.map((k) => { const it = blood.get(k); if (!it) return null; used.add(k); return rowOf(s.blood, it); }).filter(Boolean);
        if (rows.length) groups.push({ name: title, rows });
      }
      const rest = s.blood.items.filter((it) => !used.has(it.name) && !CX_ITEM.test(it.name)).map((it) => rowOf(s.blood, it)).filter(Boolean);
      if (rest.length) groups.push({ name: 'Others', rows: rest });
      for (const { name, set } of sets.slice(1)) {
        const rows = set.items.map((it) => rowOf(set, it)).filter(Boolean);
        if (rows.length) groups.push({ name, rows });
      }
      const newIdx = cols.map((c, i) => i).filter((i) => cols[i].ms + DAY > base() && cols[i].ms >= dayStart(base()));
      return { cols, groups, newIdx, total, maxPage };
    }

    /* ---------- 時間軸 ---------- */
    // 時間軸上的抗生素列：跟目前看的時間範圍有重疊的才列，最多 6 條
    const lanes = () => (M.abx || []).filter((a) => (a.end == null ? now() : a.end + DAY) > now() - Math.max(ui.range, 168) * H).slice(0, 6);
    // 最接近某個時間、而且有這個欄位的那一筆（一小時內）；點時間軸選取時間點時用
    const nearField = (k, at) => { let b; for (const v of M.vitals || []) if (v[k] != null && Math.abs(v.t - at) <= H && (!b || Math.abs(v.t - at) < Math.abs(b.t - at))) b = v; return b; };
    let geo = null;
    let curVs = null;   // 目前「插入 V/S」會給的文字（最後一筆，或在時間軸上選的時間點）
    const tubeLine = (l) => `${l.name.replace(/[（(].*$/, '').trim() || l.name}${fin(l.since) ? ` since ${md(l.since)} (D${dayNo(l.since)})` : ''}`;
    function drawTimeline() {
      const L = lanes();
      const ROWS = [{ id: 't', h: 44 }, { id: 'hr', h: 26 }, { id: 'bp', h: 28 }, { id: 'sp', h: 22 }, { id: 'io', h: 38 }, { id: 'wt', h: 22 }, { id: 'abx', h: Math.max(1, L.length) * 17 + 6 }, { id: 'cx', h: 24 }];
      const AXIS_H = 20;
      const rows = ROWS.filter((r) => !ui.compact || ['t', 'abx', 'cx'].includes(r.id));
      const W = $('#tlPlot').clientWidth;
      if (!W) return;
      const NOW = now(), LAST = base();
      const t0 = NOW - ui.range * H, t1 = NOW + ui.range * H * 0.012;
      const x = (t) => ((t - t0) / (t1 - t0)) * W;
      const Y = {}; let y = 0;
      rows.forEach((r) => { Y[r.id] = { y, h: r.h }; y += r.h; });
      const bodyH = y, total = y + AXIS_H;
      const all = M.vitals || [];
      const vit = all.filter((v) => v.t >= t0 - 8 * H && v.t <= t1);
      const inWin = all.filter((v) => v.t >= t0 && v.t <= t1);
      const f = (n) => n.toFixed(1);
      let s = `<defs><clipPath id="tlClip"><rect x="0" y="0" width="${W}" height="${bodyH}"/></clipPath></defs>`;
      const xs = Math.max(0, x(LAST));
      if (xs < W) s += `<rect class="tl-since" x="${f(xs)}" y="0" width="${f(W - xs)}" height="${bodyH}"/>`;
      const dayW = x(t0 + DAY) - x(t0);
      const every = Math.max(1, Math.ceil(56 / dayW));       // 天數多的時候隔幾天才標一次日期
      let dayNo0 = 0;
      for (let d = dayStart(t0); d <= t1; d += DAY, dayNo0++) {
        if (d >= t0) s += `<line class="tl-day" x1="${f(x(d))}" x2="${f(x(d))}" y1="0" y2="${total}"/>`;
        const a = Math.max(d, t0), b = Math.min(d + DAY, t1);
        const lab = ui.range >= 168 ? md(d) : `${md(d)}（${WEEK[new Date(d).getDay()]}）`;
        if (every > 1 ? (dayNo0 % every === 0 && d >= t0) : x(b) - x(a) > 54) s += `<text x="${f(every > 1 ? x(d) + 3 : (x(a) + x(b)) / 2)}" y="${total - 6}" text-anchor="${every > 1 ? 'start' : 'middle'}">${lab}</text>`;
        if (ui.range <= 72) {
          const step = ui.range <= 24 ? 4 : 12;
          for (let h = step; h < 24; h += step) {
            const tt = d + h * H;
            if (tt <= t0 || tt >= t1) continue;
            s += `<line class="tl-tick" x1="${f(x(tt))}" x2="${f(x(tt))}" y1="0" y2="${bodyH}"/>`;
            if (ui.range <= 24) s += `<text x="${f(x(tt) + 3)}" y="${bodyH - 3}">${pad2(h)}:00</text>`;
          }
        }
      }
      rows.forEach((r, i) => { if (i) s += `<line class="tl-sep" x1="0" x2="${W}" y1="${Y[r.id].y}" y2="${Y[r.id].y}"/>`; });
      s += `<line class="tl-day" x1="0" x2="${W}" y1="${bodyH}" y2="${bodyH}"/>`;
      if (xs > 0 && W - xs > 96) s += `<text class="since" x="${f(xs + 5)}" y="11">上一篇之後</text>`;
      s += '<g clip-path="url(#tlClip)">';
      const scale = (row, lo, hi, pt = 5, pb = 5) => (v) => row.y + pt + ((hi - Math.min(hi, Math.max(lo, v))) / (hi - lo)) * (row.h - pt - pb);
      const poly = (pts, cls) => (pts.length > 1 ? `<polyline class="tl-line ${cls}" points="${pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}"/>` : '');
      if (Y.t) {
        const yt = scale(Y.t, 35.6, 40, 13, 5);
        const pts = vit.filter((v) => v.temp != null);
        s += `<line class="tl-thr" x1="0" x2="${W}" y1="${f(yt(38))}" y2="${f(yt(38))}"/>`;
        s += poly(pts.map((v) => [x(v.t), yt(v.temp)]), 't');
        let lastLab = -99;
        pts.forEach((v) => {
          const hot = v.temp >= 38;
          s += `<circle class="tl-dot t ${hot ? 'hi' : ''}" cx="${f(x(v.t))}" cy="${f(yt(v.temp))}" r="${hot ? 3.2 : 2.2}"/>`;
          if (hot && x(v.t) - lastLab > 26) { s += `<text class="hi" x="${f(x(v.t))}" y="${f(yt(v.temp) - 6)}" text-anchor="middle">${v.temp.toFixed(1)}</text>`; lastLab = x(v.t); }
        });
        s += `<text x="${W - 4}" y="${f(yt(38) - 3)}" text-anchor="end">38</text>`;
      }
      if (Y.hr) {
        const yh = scale(Y.hr, 45, 150);
        const pts = vit.filter((v) => v.hr != null);
        s += poly(pts.map((v) => [x(v.t), yh(v.hr)]), '');
        pts.forEach((v) => { if (v.hr >= 110 || v.hr < 50) s += `<circle class="tl-dot ${v.hr >= 110 ? 'hi' : 'lo'}" cx="${f(x(v.t))}" cy="${f(yh(v.hr))}" r="2.4"/>`; });
      }
      if (Y.bp) {
        const yb = scale(Y.bp, 40, 190, 4, 4);
        vit.filter((v) => v.sys != null).forEach((v) => { s += `<line class="tl-bp" x1="${f(x(v.t))}" x2="${f(x(v.t))}" y1="${f(yb(v.sys))}" y2="${f(yb(v.dia))}"/>`; });
      }
      if (Y.sp) {
        const ysp = scale(Y.sp, 85, 100, 4, 4);
        const pts = vit.filter((v) => v.spo2 != null);
        s += poly(pts.map((v) => [x(v.t), ysp(v.spo2)]), '');
        let lastLab = -99;
        pts.forEach((v) => {
          if (v.spo2 >= 94) return;
          s += `<circle class="tl-dot lo" cx="${f(x(v.t))}" cy="${f(ysp(v.spo2))}" r="2.6"/>`;
          if (x(v.t) - lastLab > 24) { s += `<text class="val" x="${f(x(v.t) + 5)}" y="${f(ysp(v.spo2) + 2)}">${v.spo2}</text>`; lastLab = x(v.t); }
        });
      }
      if (Y.io && M.io) {
        const r = Y.io, baseY = r.y + r.h - 3, maxH = r.h - 17;
        const top = Math.max(1500, ...M.io.days.map((d) => Math.max(d.in, d.out)));
        M.io.days.forEach((d) => {
          if (!d.in && !d.out) return;
          const a = Math.max(d.ms + 8 * H, t0), b = Math.min(d.ms + 32 * H, NOW);
          if (b - a < 2 * H) return;
          const cx = (x(a) + x(b)) / 2, bw = Math.min(16, Math.max(5, (x(b) - x(a)) * 0.16));
          const hh = (n) => Math.max(1, (n / top) * maxH);
          s += `<rect class="tl-in" x="${f(cx - bw - 1)}" y="${f(baseY - hh(d.in))}" width="${f(bw)}" height="${f(hh(d.in))}"/><rect class="tl-out" x="${f(cx + 1)}" y="${f(baseY - hh(d.out))}" width="${f(bw)}" height="${f(hh(d.out))}"/>`;
          if (x(b) - x(a) > 44) s += `<text class="net ${d.net < 0 ? 'neg' : ''}" x="${f(cx + bw + 6)}" y="${f(baseY - 2)}">${signed(d.net)}${d.partial ? '*' : ''}</text>`;
        });
      }
      if (Y.wt) {
        const r = Y.wt; let lastX = -99;
        (M.weights || []).filter((w) => w.ms >= t0 && w.ms <= t1).forEach((w) => {
          s += `<circle class="tl-dot" cx="${f(x(w.ms))}" cy="${r.y + r.h / 2}" r="2.4"/>`;
          if (x(w.ms) - lastX > 40) { s += `<text class="val" x="${f(x(w.ms) + 6)}" y="${r.y + r.h / 2 + 4}">${w.kg.toFixed(1)}</text>`; lastX = x(w.ms); }
        });
      }
      if (Y.abx) {
        L.forEach((a, i) => {
          const a0 = Math.max(a.start, t0), a1 = Math.min(a.end == null ? NOW : a.end + DAY, t1);
          if (a1 <= a0) return;
          const yy = Y.abx.y + 4 + i * 17, x0 = x(a0), w = x(a1) - x0;
          s += `<rect class="tl-abx ${a.end != null ? 'ended' : i % 2 ? 'alt' : ''}" x="${f(x0)}" y="${yy}" width="${f(w)}" height="13" rx="2"/>`;
          const label = a.end != null ? `${a.name} ${md(a.start)}–${md(a.end)}` : `${a.name} · D${dayNo(a.start)}`;
          if (w > label.length * 6.4 + 12) s += `<text class="abx" x="${f(x0 + 6)}" y="${yy + 10}">${esc(label)}</text>`;
          else if (w > 30 && a.end == null) s += `<text class="abx" x="${f(x0 + 6)}" y="${yy + 10}">D${dayNo(a.start)}</text>`;
        });
      }
      if (Y.cx) {
        const groups = new Map();
        cultureList().filter((c) => c.t >= t0 && c.t <= t1).forEach((c) => { const key = Math.round(c.t / (3 * H)); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(c); });
        const rank = { grown: 0, pending: 1, ng: 2 };
        let lastEnd = -99;
        [...groups.values()].sort((a, b) => a[0].t - b[0].t).forEach((list) => {
          list.sort((a, b) => rank[a.status] - rank[b.status]);
          const cx = x(list[0].t), yy = Y.cx.y + 6;
          const kinds = new Map();
          list.forEach((c) => { const k = c.status + '|' + c.short; kinds.set(k, (kinds.get(k) || 0) + 1); });
          const parts = [...kinds].map(([k, n]) => { const [st, sh] = k.split('|'); return { st, text: sh + (n > 1 ? '×' + n : '') }; });
          const plain = parts.map((p) => p.text).join(' · ');
          const wText = plain.length * 6.2 + 12;
          const show = cx > lastEnd;
          s += `<g class="tl-cx ${list[0].status}" data-cx="${list[0].id}" tabindex="0" role="button" aria-label="跳到 ${md(list[0].t)} 的培養"><path d="M${f(cx - 5)},${yy} L${f(cx + 5)},${yy} L${f(cx)},${yy + 10} Z"/>`;
          if (show) { s += `<text x="${f(cx + 9)}" y="${yy + 10}">${parts.map((p) => `<tspan class="${p.st}">${esc(p.text)}</tspan>`).join('<tspan> · </tspan>')}</text>`; lastEnd = cx + wText; }
          s += '</g>';
        });
      }
      s += '</g>';
      if (ui.pin != null && ui.pin >= t0 && ui.pin <= t1) s += `<line class="tl-pin" x1="${f(x(ui.pin))}" x2="${f(x(ui.pin))}" y1="0" y2="${bodyH}"/>`;
      s += `<rect class="tl-dayhi" id="tlDayHi" y="0" height="${bodyH}" width="0"/><line class="tl-cross" id="tlCross" y1="0" y2="${bodyH}" x1="-10" x2="-10"/>`;
      const svg = $('#tlSvg');
      svg.setAttribute('viewBox', `0 0 ${W} ${total}`); svg.setAttribute('height', total);
      svg.innerHTML = s;
      geo = { W, t0, t1, x, bodyH };
      // 圖例
      const last = (k) => [...all].reverse().find((v) => v[k] != null);
      const rng = (k) => { const a = inWin.map((v) => v[k]).filter((v) => v != null); return a.length ? [Math.min(...a), Math.max(...a)] : null; };
      // 有在時間軸上點選時間點：圖例與插入的 V/S 都改用那個時間的數值；沒選就是最後一筆
      if (ui.pin != null && !['temp', 'hr', 'sys', 'spo2', 'rr'].some((k) => nearField(k, ui.pin))) ui.pin = null;
      const PIN = ui.pin;
      const pick = (k) => (PIN != null ? nearField(k, PIN) : last(k));
      const lt = pick('temp'), lh = pick('hr'), lb = pick('sys'), ls = pick('spo2'), lr = pick('rr');
      const tR = rng('temp'), hR = rng('hr'), sR = rng('spo2');
      const days = (M.io && M.io.days) || [];
      const full = days.filter((d) => !d.partial).pop(), part = days.filter((d) => d.partial).pop();
      const w = M.weights || []; const lw = w[w.length - 1], pw = [...w].reverse().find((r) => lw && dayStart(r.ms) < dayStart(lw.ms));
      const cl = cultureList(); const nPend = cl.filter((c) => c.status === 'pending' || c.pend.length).length;
      const vsText = () => {
        const lines = [];
        const tpr = [lt && `T: ${lt.temp.toFixed(1)} °C`, lh && `P: ${lh.hr} bpm`, lr && `R: ${lr.rr} /min`].filter(Boolean).join(' ');
        if (tpr) lines.push(tpr);
        if (lb) lines.push(`BP: ${lb.sys}/${lb.dia} mmHg`);
        if (ls) lines.push(`SpO2: ${ls.spo2}%${ls.o2 ? ' (' + ls.o2 + ')' : ''}`);
        const byDay = new Map(); w.forEach((r) => byDay.set(dayStart(r.ms), r));
        const tr = [...byDay.values()].slice(-4);
        if (tr.length) lines.push(`體重:${tr.map((r) => r.kg.toFixed(1)).join('>')}(${+md(tr[tr.length - 1].ms).split('/')[0]}/${+md(tr[tr.length - 1].ms).split('/')[1]})`);
        return lines.join('\n');
      };
      curVs = { text: vsText, when: PIN != null ? `${md(PIN)} ${hm(PIN)} ` : '最後一筆' };
      const dash = '<span class="s">—</span>';
      const html = {
        t: `<span class="n">體溫</span>${lt ? `<span class="v ${lt.temp >= 38 ? 'hi' : ''}">${lt.temp.toFixed(1)}</span><span class="s">${PIN != null ? `${md(lt.t)} ${hm(lt.t)}` : tR ? 'Tmax ' + tR[1].toFixed(1) : hm(lt.t)}</span>` : dash}${insBtn(vsText, PIN != null ? `[V/S] ${md(PIN)} ${hm(PIN)} 的數值` : '[V/S] 最後一筆與體重趨勢')}`,
        hr: `<span class="n">心跳</span>${lh ? `<span class="v">${lh.hr}</span><span class="s">${hR ? hR[0] + '–' + hR[1] : ''}</span>` : dash}`,
        bp: `<span class="n">血壓</span>${lb ? `<span class="v">${lb.sys}/${lb.dia}</span><span class="s">${md(lb.t)} ${hm(lb.t)}</span>` : dash}`,
        sp: `<span class="n">SpO₂</span>${ls ? `<span class="v ${ls.spo2 < 94 ? 'lo' : ''}">${ls.spo2}%</span><span class="s">${sR ? '最低 ' + sR[0] + '%' : ''}${lr ? ' · RR ' + lr.rr : ''}</span>` : dash}`,
        io: `<span class="n">I/O</span>${full ? `<span class="v ${full.net < 0 ? 'lo' : ''}">${signed(full.net)}</span><span class="s">${md(full.ms)}${part ? ' · 今 ' + signed(part.net) + '*' : ''}</span>` : `<span class="s">${M.loading.has('io') ? '載入中' : '無紀錄'}</span>`}`,
        wt: `<span class="n">體重</span>${lw ? `<span class="v">${lw.kg.toFixed(1)}</span><span class="s">kg · ${md(lw.ms)}${pw ? ' · ' + signed(+(lw.kg - pw.kg).toFixed(1)).replace(/(\d+)$/, (lw.kg - pw.kg).toFixed(1).replace('-', '')) : ''}</span>` : dash}`,
        abx: L.length ? L.map((a) => `<div><b>${esc(a.name)}</b><span class="s">${a.end != null ? '已停' : 'D' + dayNo(a.start)}</span></div>`).join('') : `<div><span class="s">${M.loading.has('abx') ? '抗生素載入中' : '無抗生素'}</span></div>`,
        cx: `<span class="n">培養</span><span class="v">${nPend}</span><span class="s">份未發</span>`,
      };
      const rangeLabel = ui.range === 24 ? '近 24 小時' : `近 ${Math.round(ui.range / 24)} 天`;
      $('#tlLegend').innerHTML = rows.map((r) => `<div class="tl-leg ${r.id === 'abx' ? 'abx' : ''} ${PIN != null && ['t', 'hr', 'bp', 'sp'].includes(r.id) ? 'pinned' : ''}" style="height:${r.h}px">${html[r.id]}</div>`).join('')
        + `<div class="tl-leg axis" style="height:${AXIS_H}px"><span ${M.vitalsNote ? `class="lim" title="多天的生命徵象查詢失敗（${esc(M.vitalsNote)}），目前只有近 2 天左右的數值"` : ''}>${rangeLabel}${M.vitalsNote ? '（生命徵象僅近 2 天）' : ''}</span>${PIN != null ? `<button class="linkbtn" type="button" id="btnUnpin" title="回到顯示最後一筆">已選 ${md(PIN)} ${hm(PIN)} · 取消</button>` : '<span title="點圖上的時間點，圖例和插入的 V/S 會改用那個時間的數值">點圖可選時間點</span>'}</div>`;
      if (ui.dayHi) highlightDay(ui.dayHi);
    }
    function highlightDay(ms) {
      ui.dayHi = ms;
      const el = $('#tlDayHi');
      if (!el || !geo) return;
      if (ms == null) { el.setAttribute('width', 0); return; }
      const a = Math.max(ms, geo.t0), b = Math.min(ms + DAY, geo.t1);
      if (b <= a) { el.setAttribute('width', 0); return; }
      el.setAttribute('x', geo.x(a)); el.setAttribute('width', geo.x(b) - geo.x(a));
    }

    /* ---------- 第一欄 ---------- */
    function renderCol1() {
      const B = base();
      let h = '';
      // 自上一篇以來
      const rows = [];
      const ACT = { 新增: ['新增', 'new'], 刪除: ['停用', 'stop'], 修改: ['調整', 'edit'] };
      const TYPE_ORDER = ['處方', '檢驗', '影醫', '病理', '伙食', ''];
      const ords = ((M.orders && M.orders.items) || []).filter((o) => o.ms > B)
        .sort((a, b) => (TYPE_ORDER.indexOf(a.type) + 9) % 9 - (TYPE_ORDER.indexOf(b.type) + 9) % 9 || a.ms - b.ms);
      for (const o of ords) {
        const [kind, cls] = ACT[o.act] || [o.act || '醫囑', ''];
        const name = o.name.replace(/\s*特殊醫囑.*$/, '').replace(/\s*\(Frequency:[^)]*\)\s*$/, '');
        rows.push(`<li class="row"><span class="tag ${cls}">${esc(kind)}</span><span class="main">${o.type ? `<span class="dose">${esc(o.type)}</span> ` : ''}${esc(name)}</span><span class="sub">${md(o.ms)} ${hm(o.ms)}</span>${insBtn(`${name} (${kind === '停用' ? 'DC' : kind === '調整' ? 'modified' : 'added'} ${md(o.ms)})`, name)}</li>`);
      }
      const prn = new Map();
      for (const g of ((M.meds && M.meds.given) || []).filter((x) => x.ms > B)) { if (!prn.has(g.name)) prn.set(g.name, []); prn.get(g.name).push(g); }
      for (const [name, list] of prn) {
        const times = list.map((x) => `${md(x.ms)} ${hm(x.ms)}`);
        rows.push(`<li class="row"><span class="tag prn">PRN</span><span class="main">${esc(name)} <span class="dose">給 ${list.length} 次</span></span><span class="sub" title="${esc(times.join('、'))}">${hm(list[0].ms)}${list.length > 1 ? ' 等' : ''}</span>${insBtn(`${name} ${list[0].freq} was given ${list.length} time${list.length > 1 ? 's' : ''} (${times.join(', ')})`, name + ' PRN')}</li>`);
      }
      for (const c of cultureList().filter((c) => c.e && fin(c.e.reported) && c.e.reported > B && (c.e.orgs.length || c.e.neg.length))) {
        rows.push(`<li class="row"><span class="tag rep">報告</span><span class="main">${esc(c.short)} ${md(c.t)}：${c.e.orgs.length ? `<span class="org">${esc(c.e.orgs.map((o) => orgAbbr(o.name)).join('、'))}</span>` : esc(c.e.neg[0])}</span><span class="sub">${md(c.e.reported)} ${hm(c.e.reported)}</span><button class="ib" type="button" data-focus="cx-${c.id}" title="看這份培養" aria-label="看這份培養">${icon('rows')}</button></li>`);
      }
      for (const p of (M.pacs || []).filter((p) => p.ms >= dayStart(B))) {
        rows.push(`<li class="row"><span class="tag rep">影像</span><span class="main">${esc(p.title)}</span><span class="sub">${md(p.ms)}</span>${insBtn(`<${md(p.ms)}> ${p.title}: ${p.imp.slice(0, 600)}`, p.title)}</li>`);
      }
      h += secOpen('since', '自上一篇以來', `<span class="meta">${fin(M.base) ? `${md(B)} ${hm(B)} 之後` : '找不到上一篇，先用近 24 小時'} · ${rows.length} 項</span>`);
      h += stateNote('orders', '醫囑變更') + stateNote('meds', '給藥紀錄');
      h += rows.length ? `<ul>${rows.join('')}</ul>` : (M.loading.has('orders') ? '' : '<p class="note">這段時間沒有新的醫囑、PRN 給藥或報告。</p>');
      h += secClose;

      // 目前用藥
      const abxList = M.abx || [];
      // 已停的：近 10 天直接列，更早的收在「更早已停」裡；[Abx] 插入鈕帶整個住院期間
      const live = abxList.filter((a) => a.end == null);
      const endedAll = abxList.filter((a) => a.end != null).sort((a, b) => b.end - a.end);
      const ended = endedAll.filter((a) => a.end > now() - 10 * DAY), older = endedAll.filter((a) => a.end <= now() - 10 * DAY);
      const abxLine = (a) => (a.end != null ? `${a.name} ${md(a.start)}-${md(a.end)}` : `${a.name} ${md(a.start)}- (D${dayNo(a.start)})`);
      const abxBlock = () => [...endedAll, ...live].sort((a, b) => a.start - b.start).map(abxLine).join('\n');
      const meds = ((M.meds && M.meds.today) || []).filter((m) => !(abxList.length && m.atc.some((c) => /^J0[1245]/.test(c))));
      h += secOpen('meds', '目前用藥', `<span class="meta">${live.length + meds.length} 項 · 今日給藥紀錄</span><span class="sp"></span>${abxList.length ? insBtn(abxBlock, '[Abx] 全部日程', 'Abx') : ''}`);
      h += stateNote('abx', '抗生素') + stateNote('meds', '用藥');
      if (abxList.length) {
        h += '<div class="grp">抗感染</div><ul>';
        h += live.map((a) => `<li class="row"><span class="tag day">D${dayNo(a.start)}</span><span class="main"><b>${esc(a.name)}</b> <span class="dose">${esc(a.dose)}</span></span><span class="sub">${md(a.start)} 起${a.start > dayStart(B) ? '<i class="dot-new" title="上一篇之後才開始"></i>' : ''}</span>${insBtn(abxLine(a), a.name)}</li>`).join('');
        const endedRow = (a) => `<li class="row"><span class="tag">已停</span><span class="main dose">${esc(a.name)} ${esc(a.dose)}</span><span class="sub">${md(a.start)}–${md(a.end)}</span>${insBtn(abxLine(a), a.name)}</li>`;
        h += ended.map(endedRow).join('');
        h += '</ul>';
        if (older.length) h += `<div class="sub-h">更早已停<span>${older.length} 項</span><span class="sp" style="flex:1"></span><button class="linkbtn" type="button" id="btnAbxOld" aria-expanded="${ui.abxOld}">${ui.abxOld ? '收合' : '顯示'}</button></div>${ui.abxOld ? `<ul>${older.map(endedRow).join('')}</ul>` : ''}`;
      }
      const isPrn = (m) => /PRN/i.test(m.freq);
      const groups = new Map();
      for (const m of meds.filter((m) => !isPrn(m))) { const g = ATC[(m.atc[0] || 'V')[0]] || '其他'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(m); }
      const medRow = (m) => {
        const isNew = m.start && m.start > B;
        const n = ((M.meds && M.meds.given) || []).filter((x) => x.id === m.id && x.ms > B).length;
        const line = `${m.name} ${m.dose} ${m.route} ${m.freq}`.replace(/\s+/g, ' ');
        return `<li class="row">${isNew ? '<span class="tag new">新增</span>' : ''}${isPrn(m) ? `<span class="tag ${n ? 'prn' : ''}">給 ${n} 次</span>` : ''}<span class="main"><b>${esc(m.name)}</b> <span class="dose">${esc(m.dose)} ${esc(m.route)} ${esc(m.freq)}</span></span><span class="sub">${m.start ? md(m.start) + ' 起' : ''}</span>${insBtn(line, m.name)}</li>`;
      };
      for (const [g, list] of groups) h += `<div class="grp">${esc(g)}</div><ul>${list.map(medRow).join('')}</ul>`;
      const prnList = meds.filter(isPrn);
      if (prnList.length) h += `<div class="grp">PRN</div><ul>${prnList.map(medRow).join('')}</ul>`;
      h += secClose;

      // I/O 與體重
      const io = M.io;
      const ioHead = '<span class="meta">mL · 護理日 08:00–隔日 07:59</span><span class="sp"></span>';
      if (io && io.days.length) {
        const days = io.days.slice(-4), off = io.days.length - days.length;
        const val = (it) => days.map((d, i) => it.vals[off + i] || 0);
        const ioText = () => days.map((d) => `I/O ${md(d.ms)}${d.partial ? ' (so far)' : ''}: ${Math.round(d.in)}/${Math.round(d.out)} (${d.net > 0 ? '+' : ''}${Math.round(d.net)})`).join('\n');
        h += secOpen('io', 'I/O 與體重', ioHead + insBtn(ioText, 'I/O ' + days.length + ' 天'));
        const cls = (d) => (d.ms + 32 * H > B ? 'since' : '');
        const cells = (fn, neg) => days.map((d, i) => { const v = fn(d, i); return `<td class="${cls(d)} ${neg && v < 0 ? 'neg' : ''}">${neg ? signed(v) : v ? Math.round(v) : '<span class="nil">–</span>'}</td>`; }).join('');
        h += `<table class="io"><colgroup><col>${days.map(() => '<col style="width:58px">').join('')}</colgroup><thead><tr><th></th>${days.map((d) => `<th class="${cls(d)}">${md(d.ms)}${d.partial ? ' <small title="今天進行中的班別">*</small>' : ''}</th>`).join('')}</tr></thead><tbody>`;
        h += `<tr class="tot"><td>Input <button class="linkbtn" type="button" id="btnInDetail" aria-expanded="${ui.inDetail}">${ui.inDetail ? '收合' : '明細'}</button></td>${cells((d) => d.in)}</tr>`;
        if (ui.inDetail) h += io.items.filter((it) => it.kind === 'in').map((it) => `<tr class="part"><td title="${esc(it.name)}">${esc(it.name)}</td>${val(it).map((v, i) => `<td class="${cls(days[i])}">${v ? Math.round(v) : '<span class="nil">–</span>'}</td>`).join('')}</tr>`).join('');
        h += `<tr class="tot"><td>Output</td>${cells((d) => d.out)}</tr>`;
        h += io.items.filter((it) => it.kind === 'out').map((it) => `<tr class="part"><td title="${esc(it.name)}">${esc(it.name)}</td>${val(it).map((v, i) => `<td class="${cls(days[i])}">${v ? Math.round(v) : '<span class="nil">–</span>'}</td>`).join('')}</tr>`).join('');
        h += `<tr class="net"><td>Net</td>${cells((d) => d.net, true)}</tr>`;
        const wOn = (d) => { const r = (M.weights || []).filter((x) => dayStart(x.ms) === d.ms).pop(); return r ? r.kg.toFixed(1) : '<span class="nil">–</span>'; };
        h += `<tr><td>體重 <small>kg</small></td>${days.map((d) => `<td class="${cls(d)}">${wOn(d)}</td>`).join('')}</tr></tbody></table>`;
      } else h += secOpen('io', 'I/O 與體重', ioHead) + (stateNote('io', 'I/O 總表') || (M.loading.has('io') ? '' : '<p class="note">這位病人近幾天沒有 I/O 紀錄。</p>'));
      h += secClose;

      // 管路
      const tubes = M.tubes || [];
      h += `${secOpen('tubes', '管路', `<span class="meta">${tubes.length} 條</span>`)}${stateNote('tubes', '管路')}<ul>`;
      h += tubes.map((l) => `<li class="row"><span class="tag">${fin(l.since) ? 'D' + dayNo(l.since) : '?'}</span><span class="main">${esc(l.name)}</span><span class="sub">${fin(l.since) ? md(l.since) + ' 起' : ''}</span>${insBtn(tubeLine(l), l.name)}</li>`).join('');
      h += '</ul>' + secClose;
      $('#col1').innerHTML = h;
    }

    /* ---------- 第二欄：Lab ---------- */
    const COLW = 50, DELTAW = 46, INSW = 26;
    let LM = null;
    const fmtGroup = (g, idxs, model) => {
      const rows = g.rows.filter((r) => !labHide.has(r.k) && idxs.some((i) => r.cells[i]));
      const dates = idxs.filter((i) => rows.some((r) => r.cells[i]));
      if (!rows.length || !dates.length) return '';
      const cw = rows.map((r) => Math.max(r.k.length, ...dates.map((i) => (r.cells[i] ? r.cells[i].v.length : 1))));
      const line = (label, get) => (label.padEnd(5) + rows.map((r, k) => '  ' + get(r).padEnd(cw[k])).join('')).replace(/\s+$/, '');
      return [`#. ${g.name}`, line('', (r) => r.k), ...dates.map((i) => line((model || LM).cols[i].d, (r) => (r.cells[i] ? r.cells[i].v : '-')))].join('\n');
    };
    function renderCol2() {
      // 一欄 COLW 寬：算出放得下幾個抽血日（3–8 個）
      const fit = Math.max(3, Math.min(8, Math.floor((($('#col2').clientWidth || 430) - 112 - DELTAW - INSW) / COLW)));
      LM = labModel(fit);
      let h = secOpen('lab', 'Lab', `<span class="meta">${LM ? `近 ${ui.labDays} 天 · ${LM.total} 個抽血日 · 點項目看趨勢` : ''}</span><span class="sp"></span><button class="ib ib-text" type="button" id="btnLabMerge" title="把 note 裡 [Lab] 最後日期之後的新結果補進去">${icon('insert')}補進 [Lab]</button>`);
      h += stateNote('labs', '檢驗報告');
      const dayBox = `<label class="range-n lab-n" title="Lab 表格要看最近幾天；預設 10 天">近 <input type="number" id="labDays" min="1" max="120" step="1" value="${ui.labDays}" aria-label="Lab 天數"> 天</label>`;
      if (!LM) { $('#col2').innerHTML = h + `<div class="lab-tools"><span class="meta"></span>${dayBox}</div>` + (M.loading.has('labs') || M.err.labs ? '' : `<p class="note">近 ${Math.max(14, ui.labDays)} 天沒有檢驗報告。</p>`) + secClose; return; }
      const n = LM.cols.length;
      if (!n) { $('#col2').innerHTML = h + `<div class="lab-tools"><span class="meta">這段時間沒有抽血</span>${dayBox}</div>` + (M.loading.has('labs') ? '' : `<p class="note">近 ${ui.labDays} 天沒有抽血結果，可以把天數調大。</p>`) + secClose; return; }
      const pager = LM.maxPage ? `<span class="pager"><button class="btn" type="button" data-labpage="1" ${ui.labPage >= LM.maxPage ? 'disabled' : ''} title="看更早的抽血日" aria-label="看更早的抽血日">‹</button><button class="btn" type="button" data-labpage="-1" ${ui.labPage <= 0 ? 'disabled' : ''} title="看較新的抽血日" aria-label="看較新的抽血日">›</button></span>` : '';
      const nOff = LM.groups.reduce((a, g) => a + g.rows.filter((r) => labHide.has(r.k)).length, 0);
      h += `<div class="lab-tools"><span class="meta">${LM.maxPage ? `顯示 ${LM.cols[0].d}–${LM.cols[n - 1].d}（共 ${LM.total} 個抽血日）` : LM.newIdx.length ? '上一篇之後的新日期：' + LM.newIdx.map((i) => LM.cols[i].d).join('、') : '上一篇之後沒有新的抽血日'}</span>${pager}${dayBox}<button class="btn" type="button" id="btnAbn" aria-pressed="${ui.abn}">只看異常</button><button class="btn" type="button" id="btnLabEdit" aria-pressed="${ui.labEdit}" title="選擇要顯示哪些檢驗項目">${ui.labEdit ? '完成' : `項目${nOff ? `（隱藏 ${nOff}）` : ''}`}</button></div>`;
      if (ui.labEdit) h += '<p class="note">取消勾選的項目不顯示，插入時也不會帶入。設定記在這台電腦的瀏覽器，所有病人共用。</p>';
      h += `<table class="lab"><colgroup><col>${LM.cols.map(() => `<col style="width:${COLW}px">`).join('')}<col style="width:${DELTAW}px"><col style="width:${INSW}px"></colgroup>`;
      const hc = (i) => (LM.newIdx.includes(i) ? 'since' : '');
      h += `<thead><tr><th>項目</th>${LM.cols.map((c, i) => `<th class="${hc(i)}" data-day="${c.ms}">${c.d}</th>`).join('')}<th>Δ</th><th></th></tr>`;
      h += `<tr><th></th>${LM.cols.map((c, i) => `<th class="${hc(i)}" data-day="${c.ms}" title="${esc(c.times.sort().join('、'))}">${c.times.length > 1 ? c.times.length + ' 次' : c.times[0] || ''}</th>`).join('')}<th></th><th></th></tr></thead><tbody>`;
      LM.groups.forEach((g, gi) => {
        const idxs = LM.newIdx.length ? LM.newIdx : [n - 1];
        const shown = g.rows.filter((r) => !labHide.has(r.k));
        if (!shown.length && !ui.labEdit) return;
        const hasNew = shown.some((r) => idxs.some((i) => r.cells[i]));
        h += `<tr class="g" data-g="${gi}"><td colspan="${n + 2}">${esc(g.name)}${ui.labEdit ? ` <button class="linkbtn" type="button" data-labg="${gi}">${shown.length ? '整組隱藏' : '整組顯示'}</button>` : ''}</td><td>${hasNew ? insBtn(() => fmtGroup(g, idxs), `${g.name} ${idxs.map((i) => LM.cols[i].d).join('、')}`) : ''}</td></tr>`;
        g.rows.forEach((r, ri) => {
          const off = labHide.has(r.k);
          if (off && !ui.labEdit) return;
          const have = r.cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
          const li = have[have.length - 1];
          const nums = r.all.map((p) => parseFloat(String(p.v).replace(/^[<>≦≧=]+/, ''))).filter(fin);
          let delta = '';
          if (r.all.length > 1) {
            const a = parseFloat(String(r.all[r.all.length - 1].v).replace(/^[<>≦≧=]+/, '')), b = parseFloat(String(r.all[r.all.length - 2].v).replace(/^[<>≦≧=]+/, ''));
            if (fin(a) && fin(b)) { const dv = a - b; const decs = (String(r.all[r.all.length - 1].v).split('.')[1] || '').replace(/\D.*$/, '').length; delta = `<span class="d">${dv > 0 ? '↑' : dv < 0 ? '↓' : '→'}${Math.abs(dv).toFixed(Math.min(decs, 3))}</span>`; }
          }
          const abn = r.cells.some((c) => c && (c.lv === 'high' || c.lv === 'low'));
          const cells = r.cells.map((c, i) => {
            if (!c) return `<td class="v ${hc(i)}" data-day="${LM.cols[i].ms}"><span class="nil">–</span></td>`;
            const cl = c.lv === 'high' ? 'hi' : c.lv === 'low' ? 'lo' : '';
            return `<td class="v ${hc(i)} ${i === n - 1 ? 'last' : ''}" data-day="${LM.cols[i].ms}" title="${esc(c.all.join('\n'))}"><span class="c ${cl}">${esc(c.v)}</span>${c.more ? `<sup>+${c.more}</sup>` : ''}</td>`;
          }).join('');
          const one = li != null ? `${r.k} ${r.cells[li].v}${r.unit && r.unit !== '*' ? ' ' + r.unit : ''} (${LM.cols[li].d})` : r.k;
          h += `<tr data-g="${gi}" data-r="${ri}" class="${abn ? 'abn' : ''} ${ui.abn && !abn && !ui.labEdit ? 'hide' : ''} ${off ? 'off' : ''}"><td>${ui.labEdit ? `<input type="checkbox" class="labck" data-labk="${esc(r.k)}" ${off ? '' : 'checked'} aria-label="顯示 ${esc(r.k)}">` : ''}<button class="k" type="button" aria-expanded="false" title="${r.ref ? '參考值 ' + esc(r.ref) : '頁面沒有提供參考值'}" ${nums.length < 2 ? 'data-flat="1"' : ''}>${esc(r.k)}<small>${esc(r.unit === '*' ? '' : r.unit)}</small></button></td>${cells}<td>${delta}</td><td>${insBtn(one, one)}</td></tr>`;
        });
      });
      h += '</tbody></table>' + secClose;
      $('#col2').innerHTML = h;
      if (ui.abn) $$('.lab tbody tr.g').forEach((g) => g.classList.toggle('hide', !$$(`.lab tbody tr[data-r][data-g="${g.dataset.g}"]:not(.hide)`).length));
    }
    function trendRow(r) {
      const pts = r.all.map((p) => ({ t: p.t, n: parseFloat(String(p.v).replace(/^[<>≦≧=]+/, '')), s: p.v, lv: p.lv })).filter((p) => fin(p.n)).slice(-10);
      const W = $('#col2 table.lab').clientWidth, Hh = 66;
      const x0 = 78, x1 = W - 22;
      const tmin = pts[0].t, tmax = pts[pts.length - 1].t;
      const cx = (t) => (tmax === tmin ? (x0 + x1) / 2 : x0 + ((t - tmin) / (tmax - tmin)) * (x1 - x0));
      const m = String(r.ref || '').replace(/\s+/g, '').match(/(-?\d+(?:\.\d+)?)[~～-](-?\d+(?:\.\d+)?)/);
      const ref = m ? [+m[1], +m[2]] : null;
      const vals = pts.map((p) => p.n).concat(ref || []);
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (hi === lo) hi = lo + 1;
      const padv = (hi - lo) * 0.12; lo -= padv; hi += padv;
      const y = (n) => 16 + ((hi - n) / (hi - lo)) * (Hh - 28);
      let s = '';
      if (ref) s += `<rect class="band" x="${x0 - 8}" width="${x1 - x0 + 16}" y="${y(ref[1]).toFixed(1)}" height="${Math.max(1, y(ref[0]) - y(ref[1])).toFixed(1)}"/><text x="8" y="${Math.min(Hh - 14, Math.max(14, (y(ref[1]) + y(ref[0])) / 2 + 4)).toFixed(1)}">${esc(r.ref.replace(/\s+/g, ''))}</text>`;
      if (pts.length > 1) s += `<polyline class="ln" points="${pts.map((p) => `${cx(p.t).toFixed(1)},${y(p.n).toFixed(1)}`).join(' ')}"/>`;
      let lastX = -99;
      pts.forEach((p, i) => {
        const X = cx(p.t);
        s += `<circle class="pt ${p.lv === 'high' ? 'hi' : p.lv === 'low' ? 'lo' : ''}" cx="${X.toFixed(1)}" cy="${y(p.n).toFixed(1)}" r="3"><title>${md(p.t)} ${hm(p.t)}　${esc(p.s)}</title></circle>`;
        if (X - lastX > 30 || i === pts.length - 1) { s += `<text x="${X.toFixed(1)}" y="${(y(p.n) - 6).toFixed(1)}" text-anchor="middle">${esc(p.s)}</text>`; lastX = X; }
      });
      s += `<text x="${x0}" y="${Hh - 3}" text-anchor="middle">${md(tmin)}</text><text x="${x1}" y="${Hh - 3}" text-anchor="middle">${md(tmax)}</text>`;
      return `<tr class="trend"><td colspan="${LM.cols.length + 3}"><svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(r.k)} 趨勢">${s}</svg></td></tr>`;
    }

    /* ---------- 第三欄 ---------- */
    function renderCol3() {
      const B = base();
      const C = cultureList();
      const pending = C.filter((c) => c.status === 'pending' || (c.pend.length && c.status !== 'grown'));
      const grown = C.filter((c) => c.status === 'grown');
      const quiet = C.filter((c) => c.status === 'ng' && !c.pend.length);
      const label = (c) => esc(c.short);
      const cxNote = (c) => {
        const day = md(c.t);
        if (!c.e || (!c.e.orgs.length && !c.e.neg.length)) return `<${day}> ${c.short}: pending`;
        if (!c.e.orgs.length) return `<${day}> ${c.short}: -`;
        const sens = c.e.sens.map((s) => { const pick = (k) => s.list.filter((x) => x.sir === k).map((x) => x.drug); return `  ${orgAbbr(s.org)}: S ${pick('S').join(', ') || '-'}; R ${pick('R').join(', ') || '-'}`; });
        return [`<${day}> ${c.short}: ${c.e.orgs.map((o) => orgAbbr(o.name) + (o.mark ? ' (' + o.mark + ')' : '')).join('; ')}${c.pend.length || c.e.prelim ? ' (preliminary)' : ''}`, ...sens].join('\n');
      };
      const ISO = isolates();
      const live = (M.abx || []).filter((a) => a.end == null);
      let h = secOpen('cx', '培養與藥敏', `<span class="tag pending">${pending.length} 份未發</span><span class="tag grown">${grown.length} 份有長</span><span class="sp"></span>${C.length ? insBtn(() => C.filter((c) => c.t > now() - 7 * DAY).sort((a, b) => a.t - b.t).map(cxNote).join('\n'), '[Pathogen] 近 7 天的培養', 'Pathogen') : ''}`);
      h += stateNote('labs', '培養報告') + stateNote('pending', '未發送檢驗進度');
      if (live.length && ISO.length) {
        h += '<div class="cover">';
        for (const a of live) {
          const chips = ISO.slice(0, 4).map((iso) => { const hit = sirFor(a, iso); return hit ? `<span class="tag ${hit.sir === 'S' ? 'new' : hit.sir === 'R' ? 'stop' : 'edit'}">${esc(iso.org)} ${esc(hit.sir || '?')}</span>` : `<span class="tag" title="這株菌的藥敏沒有測這支藥">${esc(iso.org)} 未測</span>`; }).join('');
          h += `<div><b>${esc(a.name)}</b><span class="tag day">D${dayNo(a.start)}</span>${chips}</div>`;
        }
        h += '</div>';
      }
      if (C.length) {
        const byDay = new Map();
        C.forEach((c) => { const k = dayStart(c.t); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(c); });
        h += '<table class="days"><colgroup><col style="width:58px"><col><col style="width:28px"><col style="width:28px"><col style="width:30px"></colgroup><thead><tr><th>送檢日</th><th>檢體</th><th title="有長">長</th><th title="還在等報告">等</th><th title="沒長">無</th></tr></thead><tbody>';
        [...byDay.entries()].slice(0, 12).forEach(([ms, list]) => {
          const cnt = (f) => list.filter(f).length;
          const g = cnt((c) => c.status === 'grown'), p = cnt((c) => c.status === 'pending'), n = cnt((c) => c.status === 'ng');
          const kinds = new Map(); list.forEach((c) => kinds.set(c.short, (kinds.get(c.short) || 0) + 1));
          const target = (list.find((c) => c.status === 'grown') || list[0]).id;
          const text = [...kinds].map(([k, v]) => k + (v > 1 ? ' ×' + v : '')).join('、');
          h += `<tr class="${g ? 'g1' : ''}"><td><button class="daybtn" type="button" data-focus="cx-${target}">${md(ms)}</button></td><td title="${esc(text)}">${esc(text)}</td><td>${g ? `<span class="n-g">${g}</span>` : '<span class="nil">–</span>'}</td><td>${p ? `<span class="n-p">${p}</span>` : '<span class="nil">–</span>'}</td><td>${n || '<span class="nil">–</span>'}</td></tr>`;
        });
        h += '</tbody></table>';
      }
      const cxRow = (c) => {
        const dd = dayNo(c.t) - 1;
        let tag, mid;
        if (c.status === 'grown') {
          tag = '<span class="tag grown">有長</span>';
          mid = `${label(c)} <span class="org">${esc(c.e.orgs.map((o) => orgAbbr(o.name) + (o.mark ? ' (' + o.mark + ')' : '')).join('、'))}</span>${c.e.prelim || c.pend.length ? ' <span class="tag pending">初步</span>' : ''}`;
        } else if (c.status === 'pending') {
          tag = `<span class="tag pending" title="送出 ${dd} 天還沒有最終報告">D+${dd}</span>`;
          mid = `${label(c)} <span class="dose">${esc([...new Set(c.pend)].join('、'))}</span>`;
        } else {
          tag = '<span class="tag">沒長</span>';
          mid = `${label(c)} <span class="dose">${esc((c.e.neg[0] || c.e.stain[0] || '').slice(0, 60))}</span>`;
        }
        const stain = c.e && c.e.stain.length ? `<span class="dose stain">染色 ${esc(c.e.stain.join('、'))}</span>` : '';
        const isNew = c.e && fin(c.e.reported) && c.e.reported > B ? '<i class="dot-new" title="上一篇之後才發的報告"></i>' : '';
        return `<li class="row" id="cx-${c.id}">${tag}<span class="main" title="${esc(c.spec)}">${mid}${isNew}${stain}</span><span class="sub">${md(c.t)} ${hm(c.t)}</span>${insBtn(() => cxNote(c), `${md(c.t)} ${c.short}`)}</li>`;
      };
      if (pending.length) h += `<div class="sub-h">未發報告<span>${pending.length} 份</span></div><ul>${pending.map(cxRow).join('')}</ul>`;
      if (grown.length) h += `<div class="sub-h">有長<span>${grown.length} 份</span></div><ul>${grown.map(cxRow).join('')}</ul>`;
      if (quiet.length) h += `<div class="sub-h">沒長<span>${quiet.length} 份</span><span class="sp" style="flex:1"></span><button class="linkbtn" type="button" id="btnQuiet" aria-expanded="${ui.quiet}">${ui.quiet ? '收合' : '顯示'}</button></div><ul id="quietList" ${ui.quiet ? '' : 'hidden'}>${quiet.map(cxRow).join('')}</ul>`;
      const others = (M.pending || []).map((p) => ({ p, items: p.items.filter((x) => !CX_ITEM.test(x.name)) })).filter((x) => x.items.length);
      if (others.length) h += `<div class="sub-h">其他未發檢驗<span>${others.length} 份檢體</span></div><ul>${others.map(({ p, items }) => `<li class="row"><span class="tag pending">未發</span><span class="main">${esc(items.map((x) => x.name).join('、'))} <span class="dose">${esc(p.spec)}</span></span><span class="sub">${fin(p.t) ? md(p.t) + ' ' + hm(p.t) : ''}</span>${insBtn(`${items.map((x) => x.name).join(', ')}: pending`, items[0].name)}</li>`).join('')}</ul>`;
      if (!C.length && !others.length && !M.loading.has('labs') && !M.err.labs) h += '<p class="note">近 14 天沒有培養或未發的檢驗。</p>';
      if (ISO.length) {
        const cols = ISO.slice(0, 4);
        const drugs = [];
        cols.forEach((iso) => iso.list.forEach((x) => { if (!drugs.includes(x.drug)) drugs.push(x.drug); }));
        const usingKeys = new Set(live.flatMap((a) => [drugKey(a.generic), drugKey(a.name)]));
        const usedKeys = new Set((M.abx || []).flatMap((a) => [drugKey(a.generic), drugKey(a.name)]));
        h += `<div class="sub-h">藥敏對照<span>底色是使用中的抗生素${ISO.length > 4 ? ` · 只列最近 4 種菌株型態（共 ${ISO.length}）` : ''}</span></div>`;
        h += `<table class="abg"><colgroup><col>${cols.map(() => '<col style="width:76px">').join('')}</colgroup><thead><tr><th>抗生素</th>${cols.map((i) => `<th>${esc(i.org)}<small>${esc([...new Set(i.from.map((f) => f.short + ' ' + md(f.t)))].slice(0, 3).join('、'))}${i.from.length > 3 ? ' 等' : ''}</small></th>`).join('')}</tr></thead><tbody>`;
        drugs.forEach((d) => {
          const k = drugKey(d), on = usingKeys.has(k), was = !on && usedKeys.has(k);
          const cell = (iso) => { const x = iso.list.find((y) => y.drug === d); return x ? `<span class="mic">${esc(x.mic)}</span><span class="sir ${esc(x.sir)}">${esc(x.sir || '–')}</span>` : '<span class="nil">–</span>'; };
          h += `<tr class="${on ? 'using' : ''}"><td title="${esc(d)}">${esc(d)}${on ? ' <span class="tag day">使用中</span>' : was ? ' <span class="tag">用過</span>' : ''}</td>${cols.map((i) => `<td>${cell(i)}</td>`).join('')}</tr>`;
        });
        h += '</tbody></table>';
      }
      h += secClose;

      const pacs = (M.pacs || []).slice(0, 10);
      h += `${secOpen('pacs', '影像報告', `<span class="meta">${pacs.filter((p) => p.ms >= dayStart(B)).length} 份新的 · 點一列看全文</span>`)}${stateNote('pacs', '影像報告')}`;
      h += pacs.map((r, i) => `<div class="rep"><div class="row"><span class="tag ${r.ms >= dayStart(B) ? 'rep' : ''}">${imgKind(r.title)}</span><button class="toggle" type="button" aria-expanded="false" data-rep="${i}"><span class="sub">${md(r.ms)}</span><span class="imp" title="${esc(r.title)}">${esc(r.imp.slice(0, 140) || r.title)}</span></button>${insBtn(`<${md(r.ms)}> ${r.title}: ${r.imp.slice(0, 600)}`, `${imgKind(r.title)} ${md(r.ms)}`)}</div><div class="full" hidden><b>${esc(r.title)}</b>\n${esc(r.body)}</div></div>`).join('');
      h += secClose;

      const nur = (M.nursing || []).filter((n) => n.ms > B).slice(0, 40);
      h += `${secOpen('nursing', '護理紀錄', `<span class="meta">上一篇之後 ${nur.length} 筆</span>`, 'nurse')}${stateNote('nursing', '護理紀錄')}<ul>`;
      h += nur.map((n) => `<li class="row"><span class="sub">${md(n.ms)} ${hm(n.ms)}</span><span class="main">${esc(n.text)}</span></li>`).join('');
      h += '</ul>' + secClose;

      const ho = M.handoff == null ? '' : String(M.handoff).trim();
      const hoLines = ho ? ho.split('\n').filter((l) => l.trim()).length : 0;
      h += secOpen('handoff', '護理交班', `<span class="meta">${M.loading.has('handoff') ? '載入中' : ho ? hoLines + ' 行' : '空白'}</span>`);
      h += stateNote('handoff', '護理交班') + (ho ? `<pre class="handoff">${esc(ho)}</pre>` : (M.loading.has('handoff') || M.err.handoff ? '' : '<p class="note">交班筆記是空白的。</p>'));
      h += secClose;
      $('#col3').innerHTML = h;
    }

    /* ---------- 工具列 ---------- */
    function renderBar() {
      $('#barBed').textContent = M.P.bed || '';
      $('#barWho').textContent = [M.P.sex, M.P.age, M.P.chart].filter(Boolean).join(' · ');
      const sel = $('#baseSel');
      const notes = M.notes || [];
      sel.innerHTML = notes.length ? notes.map((n) => `<option value="${n.ms}" ${n.ms === M.base ? 'selected' : ''}>${md(n.ms)} ${hm(n.ms)} ${esc(n.title.slice(0, 16))}</option>`).join('') + `<option value="${now() - DAY}" ${notes.some((n) => n.ms === M.base) ? '' : 'selected'}>近 24 小時</option>` : '<option>近 24 小時</option>';
    }
    let pend = 0;
    function render() {
      cancelAnimationFrame(pend);
      pend = requestAnimationFrame(() => {
        INS.length = 0;
        // 一區出錯不要拖累其他區
        for (const [name, fn] of [['工具列', renderBar], ['時間軸', drawTimeline], ['第一欄', renderCol1], ['Lab', renderCol2], ['第三欄', renderCol3]]) {
          try { fn(); } catch (e) { console.error('[pn-workspace]', name, e); say(`${name}顯示出錯：${(e && e.message) || e}`, 'warn'); }
        }
      });
    }
    function focusRow(id) {
      const el = root.getElementById(id);
      if (!el) return;
      const hidden = el.closest('[hidden]');
      if (hidden) { ui.quiet = true; hidden.hidden = false; const b = $('#btnQuiet'); if (b) b.textContent = '收合'; }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('flash-row'); void el.offsetWidth; el.classList.add('flash-row');
    }

    /* ---------- 事件 ---------- */
    const dock = $('#dock');
    // 按插入鈕時不要把焦點從 HIS 的文字框搶走，游標才留在原位
    dock.addEventListener('mousedown', (e) => { if (e.target.closest('.ib, #btnLabMerge, #btnFill')) e.preventDefault(); });
    dock.addEventListener('click', (e) => {
      const t = e.target;
      const b = t.closest('[data-ins]');
      if (b) { const it = INS[+b.dataset.ins]; if (it) hooks.insert(typeof it.text === 'function' ? it.text() : it.text, it.label); return; }
      if (t.closest('#btnLabMerge')) { hooks.labMerge(); return; }
      if (t.closest('#btnFill')) { hooks.fillAll(); return; }
      const fo = t.closest('[data-focus]'); if (fo) { focusRow(fo.dataset.focus); return; }
      const rg = t.closest('[data-range]');
      if (rg) {
        const custom = rg.dataset.range === 'custom';
        $$('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(x === rg)));
        $('#rangeBox').hidden = !custom;
        if (custom) { applyRangeDays(); $('#rangeDays').focus(); $('#rangeDays').select(); } else { ui.range = +rg.dataset.range; drawTimeline(); }
        return;
      }
      if (t.closest('#btnUnpin')) { ui.pin = null; drawTimeline(); return; }
      if (t.closest('#btnAbxOld')) { ui.abxOld = !ui.abxOld; renderCol1(); return; }
      const lp = t.closest('[data-labpage]');
      if (lp) { ui.labPage = Math.max(0, ui.labPage + (+lp.dataset.labpage)); renderCol2(); return; }
      if (t.closest('#btnCompact')) { ui.compact = !ui.compact; $('#btnCompact').setAttribute('aria-pressed', String(ui.compact)); drawTimeline(); return; }
      const fb = t.closest('[data-fold]');
      if (fb) {
        const key = fb.dataset.fold; fold[key] = !fold[key]; pset('fold', fold);
        fb.closest('.sec').classList.toggle('folded', fold[key]); fb.setAttribute('aria-expanded', String(!fold[key]));
        return;
      }
      if (t.closest('#btnAbn')) { ui.abn = !ui.abn; renderCol2(); return; }
      if (t.closest('#btnLabEdit')) { ui.labEdit = !ui.labEdit; renderCol2(); return; }
      const lg = t.closest('[data-labg]');
      if (lg) {
        const g = LM.groups[+lg.dataset.labg]; const anyShown = g.rows.some((r) => !labHide.has(r.k));
        g.rows.forEach((r) => (anyShown ? labHide.add(r.k) : labHide.delete(r.k)));
        pset('labHide', [...labHide]); renderCol2(); return;
      }
      if (t.closest('#btnQuiet')) { ui.quiet = !ui.quiet; renderCol3(); return; }
      if (t.closest('#btnInDetail')) { ui.inDetail = !ui.inDetail; renderCol1(); return; }
      if (t.closest('#btnReload')) { hooks.reload(); return; }
      if (t.closest('#btnHide')) { hooks.hide(true); return; }
      if (t.closest('#btnList')) { hooks.toggleList(); return; }
      const k = t.closest('.lab .k');
      if (k) {
        const tr = k.closest('tr');
        if (k.dataset.flat) { say('這個項目只有一筆數值，畫不出趨勢'); return; }
        const open = tr.classList.toggle('open');
        k.setAttribute('aria-expanded', String(open));
        if (open) tr.insertAdjacentHTML('afterend', trendRow(LM.groups[+tr.dataset.g].rows[+tr.dataset.r]));
        else if (tr.nextElementSibling && tr.nextElementSibling.classList.contains('trend')) tr.nextElementSibling.remove();
        return;
      }
      const rep = t.closest('.rep button.toggle');
      if (rep) { const full = rep.closest('.rep').querySelector('.full'); full.hidden = !full.hidden; rep.setAttribute('aria-expanded', String(!full.hidden)); rep.querySelector('.imp').style.whiteSpace = full.hidden ? '' : 'normal'; }
    });
    function applyRangeDays() {
      const el = $('#rangeDays');
      const d = Math.max(1, Math.min(60, Math.round(+el.value || 14)));
      el.value = d; ui.range = d * 24;
      if (hooks.needVitals) hooks.needVitals(d);
      drawTimeline();
    }
    dock.addEventListener('change', (e) => {
      if (e.target.id === 'rangeDays') { applyRangeDays(); return; }
      if (e.target.id === 'labDays') {
        const d = Math.max(1, Math.min(120, Math.round(+e.target.value || 10)));
        ui.labDays = d; ui.labPage = 0;
        if (hooks.needLabs) hooks.needLabs(d);
        renderCol2(); return;
      }
      const ck = e.target.closest && e.target.closest('.labck');
      if (!ck) return;
      if (ck.checked) labHide.delete(ck.dataset.labk); else labHide.add(ck.dataset.labk);
      pset('labHide', [...labHide]);
      ck.closest('tr').classList.toggle('off', !ck.checked);
    });
    $('#btnCompact').setAttribute('aria-pressed', String(ui.compact));
    $('#btnReopen').addEventListener('click', () => hooks.hide(false));
    $('#baseSel').addEventListener('change', (e) => hooks.setBase(+e.target.value));
    $('#col2').addEventListener('mouseover', (e) => { const c = e.target.closest('[data-day]'); highlightDay(c ? +c.dataset.day : null); });
    $('#col2').addEventListener('mouseleave', () => highlightDay(null));
    const plot = $('#tlPlot'), read = $('#tlRead');
    // 滑鼠位置對應到最近的一筆生命徵象；離太遠就不算
    const recordAt = (e) => {
      if (!geo || !(M.vitals || []).length) return null;
      const px = e.clientX - plot.getBoundingClientRect().left;
      const t = geo.t0 + (px / geo.W) * (geo.t1 - geo.t0);
      let best = null;
      for (const v of M.vitals) if (!best || Math.abs(v.t - t) < Math.abs(best.t - t)) best = v;
      return !best || best.t < geo.t0 || Math.abs(best.t - t) > (geo.t1 - geo.t0) * 0.06 ? null : best;
    };
    plot.addEventListener('mousemove', (e) => {
      const best = recordAt(e);
      if (!best) { read.hidden = true; return; }
      const cx = geo.x(best.t);
      const cross = $('#tlCross'); cross.setAttribute('x1', cx); cross.setAttribute('x2', cx);
      const on = (M.abx || []).filter((a) => a.start <= best.t && (a.end == null || a.end + DAY > best.t)).map((a) => `${esc(a.name)} D${dayNo(a.start, best.t)}`).join('、') || '無';
      const line = (k, v) => (v ? `<div><span class="k">${k}</span>${v}</div>` : '');
      read.innerHTML = `<b>${md(best.t)} ${hm(best.t)}</b><hr>`
        + line('體溫', best.temp != null ? `<span class="${best.temp >= 38 ? 'hot' : ''}">${best.temp.toFixed(1)} °C</span>` : '')
        + line('心跳', best.hr != null ? best.hr + ' bpm' : '') + line('血壓', best.sys != null ? `${best.sys}/${best.dia} mmHg` : '')
        + line('呼吸', best.rr != null ? best.rr + ' /min' : '') + line('SpO₂', best.spo2 != null ? `<span class="${best.spo2 < 94 ? 'hot' : ''}">${best.spo2}%</span>${best.o2 ? ' ' + esc(best.o2) : ''}` : '')
        + `<hr><div><span class="k">抗生素</span>${on}</div>`;
      read.hidden = false;
      const rw = read.offsetWidth;
      read.style.left = (cx + 14 + rw > geo.W ? cx - rw - 14 : cx + 14) + 'px';
    });
    plot.addEventListener('mouseleave', () => { read.hidden = true; const c = $('#tlCross'); if (c) { c.setAttribute('x1', -10); c.setAttribute('x2', -10); } });
    const go = (e) => { const g = e.target.closest('.tl-cx'); if (!g) return; if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); focusRow('cx-' + g.dataset.cx); };
    plot.addEventListener('click', go); plot.addEventListener('keydown', go);
    // 點時間軸上的時間點：選取那一筆（再點同一筆取消）。圖例與「插入 V/S」改用那個時間的數值
    plot.addEventListener('click', (e) => {
      if (e.target.closest('.tl-cx')) return;
      const best = recordAt(e);
      if (!best) return;
      ui.pin = ui.pin === best.t ? null : best.t;
      drawTimeline();
      say(ui.pin == null ? '已取消選取，V/S 回到最後一筆' : `已選 ${md(best.t)} ${hm(best.t)}：按體溫列右邊的插入鈕，會帶入這個時間的 V/S`);
    });
    new ResizeObserver(() => drawTimeline()).observe(plot);

    const debug = () => ({ geo: geo && { W: geo.W, t0: geo.t0, t1: geo.t1 }, ui: { ...ui }, now: now(), nowType: typeof M.now, base: base(), H, DAY, lanes: lanes().map((a) => [a.start, a.end]), plotW: $('#tlPlot').clientWidth });
    // 一鍵帶入用：上一篇之後的新抽血日，整理成 note 的表格文字（不受目前翻到哪一頁影響）
    function labNewText() {
      const page = ui.labPage; ui.labPage = 0;
      let m; try { m = labModel(8); } finally { ui.labPage = page; }
      if (!m || !m.newIdx.length) return { text: '', days: '' };
      return { text: m.groups.map((g) => fmtGroup(g, m.newIdx, m)).filter(Boolean).join('\n'), days: m.newIdx.map((i) => m.cols[i].d).join('、') };
    }
    const vsOut = () => (curVs ? { text: curVs.text(), when: curVs.when } : { text: '', when: '' });
    const tubesOut = () => { const t = M.tubes || []; return { text: t.map(tubeLine).join('\n'), n: t.length }; };
    return { debug, render, say, drawTimeline, labNewText, vsText: vsOut, tubesText: tubesOut, labText: () => (M.labs && M.labs.summary ? M.labs.summary.text : ''), setHidden: (v) => { dock.hidden = v; $('#btnReopen').hidden = !v; }, setListPressed: (v) => $('#btnList').setAttribute('aria-pressed', String(v)) };
  }
  return { create, SHELL };
})();
