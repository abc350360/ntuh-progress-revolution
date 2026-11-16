// Progress note 工作畫面：嵌進病程頁。HIS 原生的表單元素一個都不搬動，只加 CSS 讓出右邊的空間；
// 寫進文字框的內容一律經過使用者按「插入」，存檔仍然由使用者按 HIS 原生的按鈕。
(() => {
  'use strict';
  if (!/InsertProgressNoteContent\.aspx/i.test(location.pathname)) return;
  if (window.top !== window) return;               // /pn 用隱藏 iframe 載入病程頁時不要啟動
  // 同一頁重複執行（開發時從 Console 重貼新版）：先把舊的那份收乾淨再啟動
  if (document.getElementById('pnw-host')) {
    try { if (window.__pnw && window.__pnw.destroy) window.__pnw.destroy(); } catch (e) { /* 舊版沒有 destroy */ }
    for (const id of ['pnw-host', 'pnw-page-css']) { const el = document.getElementById(id); if (el) el.remove(); }
  }
  const ED = 'NTUHWeb1_BlankNoteMainTab_txbBlankContnt';
  const HIS = PNW_HIS;
  const P = HIS.context();
  if (!P.SESSION || !P.acct || !P.chart) { console.warn('[pn-workspace] 讀不到病人識別，沒有啟動'); return; }
  const fin = Number.isFinite, DAY = 86400000;
  const pref = (k, d) => { try { const v = localStorage.getItem('pnw.' + k); return v == null ? d : v; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem('pnw.' + k, v); } catch (e) { /* 只是記不住 */ } };

  const PAGE_CSS = `
html.pnw-on { overflow-x: hidden; }
html.pnw-on body { margin-right: var(--pnw-w) !important; }
html.pnw-on #datacontent, html.pnw-on #datatitle { display: none !important; }
html.pnw-on.pnw-nolist #recordcontent, html.pnw-on.pnw-nolist #recordtitle { display: none !important; }
html.pnw-on #edittitle { width: auto !important; }
html.pnw-on #recordtitle, html.pnw-on #recordcontent { width: 190px !important; }
/* 這兩張表改成固定版面：裡面有寫死寬度的元素時，表格不再被撐得比可用寬度還寬（文字框右緣才不會伸到工作畫面底下） */
html.pnw-on #UpperBannerInfoTable, html.pnw-on #tblProgressNote { table-layout: fixed !important; }
html.pnw-on #editcontent { overflow: hidden; }
html.pnw-on #Table1, html.pnw-on #Table1 *, html.pnw-on #edittitle, html.pnw-on #edittitle * { white-space: normal !important; }
/* 使用者其他腳本的浮動鈕原本貼在視窗右緣，會被工作畫面蓋住：往左讓開 */
html.pnw-on #__bp_floating_shell__ { right: calc(var(--pnw-w) + 16px) !important; left: auto !important; }
html.pnw-on #ntuh-filler-fab { right: calc(var(--pnw-w) + 24px) !important; left: auto !important; }
html.pnw-on #UpperBannerInfoTable, html.pnw-on #NTUHWeb1, html.pnw-on #maskarea, html.pnw-on #tblProgressNote,
html.pnw-on #tblNoteMainTab, html.pnw-on #Table1, html.pnw-on #tblMenuList { width: 100% !important; min-width: 0 !important; }
html.pnw-on #editcontent { width: auto !important; }
html.pnw-on #NTUHWeb1_PnlBlankNote, html.pnw-on #NTUHWeb1_PnlBlankNote > div, html.pnw-on #NTUHWeb1_PnlBlankNote > div > table,
html.pnw-on #BlankContentArea { width: 100% !important; box-sizing: border-box !important; }
html.pnw-on #${ED}, html.pnw-on #NTUHWeb1_BlankNoteMainTab_txbBlankTitle { width: 100% !important; box-sizing: border-box !important; }
html.pnw-on #${ED} { height: calc(100vh - 150px) !important; min-height: 420px !important; }
`;
  const style = document.createElement('style');
  style.id = 'pnw-page-css'; style.textContent = PAGE_CSS;
  document.head.appendChild(style);

  const host = document.createElement('div');
  host.id = 'pnw-host';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${PNW_CSS}</style>${PNW_VIEW.SHELL}`;
  document.documentElement.appendChild(host);       // 放在 <form> 外面，postback 不會帶到

  const M = { now: (+new Date()), base: NaN, P, notes: [], vitals: [], weights: [], io: null, abx: [], meds: null, orders: null, labs: null, micro: [], pending: [], pacs: [], nursing: [], handoff: null, tubes: [], err: {}, loading: new Set() };
  let listMode = 'auto';
  let hidden = pref('hidden', '0') === '1';

  /* ---------- 版面 ---------- */
  function layout() {
    const w = Math.max(700, Math.min(1240, window.innerWidth - 700));
    host.style.setProperty('--dock-w', w + 'px');
    document.documentElement.style.setProperty('--pnw-w', hidden ? '0px' : w + 'px');
    root.getElementById('dock').classList.toggle('narrow', w < 1080);
    document.documentElement.classList.toggle('pnw-on', !hidden);
    const noList = listMode === 'hide' || (listMode === 'auto' && fields().length > 0);
    document.documentElement.classList.toggle('pnw-nolist', noList);
    view.setListPressed(!noList);
    view.setHidden(hidden);
  }
  const onResize = () => layout();
  window.addEventListener('resize', onResize);

  /* ---------- 原生文字框 ---------- */
  // Free note 只有一個文字框；HIS 的 Progress／Weekly／On-service／Off-service 是好幾個欄位
  // （Subjective、Objective、Brief Summary、PAP 的 Assessment／Plan…）。插入進「使用者最後點過的那個欄位」；還沒點過就照內容給預設欄位。
  // picked：使用者自己點過（或打過字）的欄位；pos：每個欄位上次的游標位置。腳本自己寫入時不算「使用者點過」。
  let picked = null, typing = false;
  const pos = new WeakMap();
  const shown = (el) => !!(el && el.isConnected && el.offsetParent);
  const isField = (t) => !!t && t.nodeType === 1 && t.tagName === 'TEXTAREA' && !host.contains(t) && t.id !== 'pnwdiag' && !/Title$/.test(t.id);
  function fields() {
    const box = document.getElementById('editcontent') || document.body;
    return [...box.querySelectorAll('textarea')].filter((t) => isField(t) && shown(t));
  }
  const saveCaret = (e) => { const t = e.target; if (!isField(t)) return; pos.set(t, { s: t.selectionStart, e: t.selectionEnd }); if (!typing) picked = t; };
  ['focusin', 'keyup', 'mouseup', 'select', 'input'].forEach((ev) => document.addEventListener(ev, saveCaret, true));
  /** 欄位名稱：往上找最近的標題列（同一欄的那一格），找不到就回空字串 */
  // HIS 結構化 note 的欄位 id（2026-11-15 從病程頁隱藏的面板讀到的）
  const FIELD_IDS = [
    [/txbSubject$/, 'Subjective'], [/txbObject$/, 'Objective'], [/BSIBundle$/, 'Assessment of Catheterization'],
    [/BrifSummaryOfYesterday$/, 'Brief Summary of yesterday'], [/txbBriefSummary$/, 'Brief Summary'], [/PurposeOfAdmission$/, 'Purpose of Admission'],
    [/txbDiagnosisAndHistory$/, 'Diagnosis And History'], [/txbDiagnosis$/, 'Diagnosis'], [/PhysicalExamAndAssessment$/, 'On-Service PE and Assessment'], [/CurrentMedication$/, 'Current Medication'], [/VSComment$/, 'VS Comment'],
    [/txbProblem(\d+)$/, 'PAP $1 的診斷'], [/txbAssessment(\d+)$/, 'PAP $1 的 Assessment'], [/txbPlan(\d+)$/, 'PAP $1 的 Plan'],
  ];
  function fieldName(ta) {
    if (ta.id === ED) return '';
    for (const [re, name] of FIELD_IDS) { const m = ta.id.match(re); if (m) return name.replace('$1', m[1] || ''); }
    let el = ta, cellAt = -1;
    for (let up = 0; up < 6 && el && el.id !== 'editcontent' && el !== document.body; up++) {
      if (el.tagName === 'TD' || el.tagName === 'TH') cellAt = el.cellIndex;
      let p = el.previousElementSibling;
      for (let k = 0; k < 3 && p; k++, p = p.previousElementSibling) {
        if (p.querySelector && p.querySelector('textarea')) break;
        let src = p;
        if (p.tagName === 'TR' && p.cells.length > 1 && cellAt >= 0 && p.cells[cellAt]) src = p.cells[cellAt];
        const t = (src.textContent || '').replace(/\s+/g, ' ').replace(/新增PAP|適症副作用及療效/g, '').trim();
        if (t && t.length <= 44) return t;
      }
      el = el.parentElement;
    }
    return '';
  }
  // 還沒點過任何欄位時的預設去處：V/S 進 Objective（On-service 進 PE and Assessment），其餘進目前這個 PAP 的 Assessment
  function defaultField(all, label) {
    const by = (re) => all.find((t) => re.test(t.id) && !t.readOnly && !t.disabled);
    if (/^\[V\/S\]/.test(label || '')) return by(/txbObject$/) || by(/PhysicalExamAndAssessment$/) || null;
    return by(/txbAssessment\d+$/) || null;
  }
  function editor(label) {
    const all = fields();
    if (!all.length) { view.say('還沒有開啟 note：先在左邊清單選一篇，或按 HIS 的新增按鈕', 'warn'); return null; }
    let ta = shown(picked) ? picked : null;
    if (!ta) ta = all.find((t) => t.id === ED) || (all.length === 1 ? all[0] : null) || defaultField(all, label);
    if (!ta) { view.say('這篇 note 有好幾個欄位：先在要插入的欄位裡點一下，再按插入', 'warn'); return null; }
    if (ta.readOnly || ta.disabled) { view.say('這個欄位目前不能編輯', 'warn'); return null; }
    return ta;
  }
  const where = (ta) => { const n = fieldName(ta); return n ? `到「${n}」` : ''; };
  // 用 execCommand 寫入，Ctrl+Z 才復原得回來，HIS 自己掛的 input 事件也收得到
  function typeInto(ta, s, e, text) {
    typing = true;
    try {
      ta.focus();
      ta.setSelectionRange(s, e);
      if (!document.execCommand('insertText', false, text)) { ta.setRangeText(text, s, e, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    } finally { typing = false; }
    pos.set(ta, { s: ta.selectionStart, e: ta.selectionEnd });
  }
  function insert(text, label) {
    if (!text) { view.say('這一列沒有可以插入的內容', 'warn'); return; }
    const ta = editor(label); if (!ta) return;
    const at = pos.get(ta) || { s: ta.value.length, e: ta.value.length };
    const v = ta.value;
    let t = String(text);
    const before = v.slice(0, at.s), after = v.slice(at.e);
    if (before && !before.endsWith('\n')) t = '\n' + t;
    if (after && !after.startsWith('\n')) t += '\n';
    typeInto(ta, at.s, at.e, t);
    view.say(`已插入${where(ta)}：${label}（Ctrl+Z 可復原；還沒存檔）`, 'done');
  }

  /** 把 note 裡 [Lab] 最後日期之後的新結果補進去：同名表格接在下面，沒有的表格新增在 [Lab] 段尾 */
  function labMerge() {
    // 有 [Lab] 段的欄位優先（結構化 note 通常寫在 Assessment 裡）；都沒有就退回游標所在的欄位
    const hasLab = (t) => /^\s*\[Lab\]/im.test(t.value) && !t.readOnly && !t.disabled;
    const focused = shown(picked) ? picked : null;
    const ta = (focused && hasLab(focused) ? focused : fields().find(hasLab)) || editor('[Lab]');
    if (!ta) return;
    const labText = view.labText();
    if (!labText) { view.say('檢驗資料還沒載入，或近 14 天沒有檢驗', 'warn'); return; }
    const now = new Date();
    const pacsAll = (M.pacs || []).map((p) => { const d = new Date(p.ms); return { day: (d.getMonth() + 1) * 100 + d.getDate(), title: p.title }; });
    const res = window.PNLab.process(labText, ta.value, (M.orders && M.orders.rows) || [], pacsAll, (now.getMonth() + 1) * 100 + now.getDate());
    if (/^（/.test(res.text)) { view.say('note 的 [Lab] 已經是最新的，沒有可以補的結果', 'warn'); return; }
    const sections = res.text.split(/\n(?=#\. )/).map((blk) => { const ls = blk.split('\n'); return { title: ls[0].replace(/^#\.\s*/, '').replace(/:\s*$/, ''), lines: ls.slice(1) }; });
    const lines = ta.value.replace(/\r/g, '').split('\n');
    const labAt = lines.findIndex((l) => /^\s*\[Lab\]/i.test(l));
    if (labAt < 0) { insert(res.text, '新的 Lab（找不到 [Lab] 段，改插在游標處）'); return; }
    const secEnd = () => { let e = labAt + 1; while (e < lines.length && !/^\s*\[[A-Za-z]/.test(lines[e]) && !/^\s*==/.test(lines[e])) e++; while (e > labAt + 1 && !lines[e - 1].trim()) e--; return e; };
    const done = [];
    for (const sec of sections) {
      const isTable = sec.lines.length > 1 && /^\s/.test(sec.lines[0]);
      const end0 = secEnd();
      let hAt = -1;
      for (let i = labAt + 1; i < end0; i++) if (lines[i].trim().replace(/:\s*$/, '') === `#. ${sec.title}`) { hAt = i; break; }
      if (hAt < 0) {
        // 表格放在 Culture／Image 之前，其餘放段尾
        let at = end0;
        if (isTable) for (let i = labAt + 1; i < end0; i++) if (/^#\.\s*(Culture|Image)/i.test(lines[i].trim())) { at = i; break; }
        lines.splice(at, 0, `#. ${sec.title}${isTable ? '' : ':'}`, ...sec.lines);
        done.push(sec.title);
        continue;
      }
      let end = hAt + 1;
      while (end < secEnd() && !/^#\.\s/.test(lines[end].trim())) end++;
      while (end > hAt + 1 && !lines[end - 1].trim()) end--;
      if (!isTable) {
        const have = new Set(lines.slice(hAt + 1, end).map((l) => l.trim()));
        const add = sec.lines.filter((l) => l.trim() && !have.has(l.trim()));
        if (add.length) { lines.splice(end, 0, ...add); done.push(sec.title); }
        continue;
      }
      const head = lines[hAt + 1] || '';
      const cols = [...head.matchAll(/\S+/g)].map((m) => ({ k: m[0], at: m.index }));
      const newCols = sec.lines[0].trim().split(/\s{2,}/);
      const same = newCols.every((c) => cols.some((x) => x.k === c));
      const have = new Set(lines.slice(hAt + 2, end).map((l) => l.trim().split(/\s{2,}/)[0]));
      const rows = sec.lines.slice(1).filter((l) => l.trim() && !have.has(l.trim().split(/\s{2,}/)[0]));
      if (!rows.length) continue;
      if (same) {
        const out = rows.map((l) => {
          const parts = l.trim().split(/\s{2,}/);
          if (parts.length !== newCols.length + 1) return l;            // 例如「11/15  pending」整列
          let row = parts[0];
          cols.forEach((c) => { const i = newCols.indexOf(c.k); row = row.padEnd(Math.max(c.at, row.length + 2)) + (i >= 0 ? parts[i + 1] : '-'); });
          return row;
        });
        lines.splice(end, 0, ...out);
      } else {
        // 欄位不一樣（多了新項目）：整張新表接在原表後面，由使用者決定怎麼併
        lines.splice(end, 0, sec.lines[0], ...rows);
      }
      done.push(sec.title);
    }
    if (!done.length) { view.say('新的結果已經都在 [Lab] 裡了，沒有重複加入', 'warn'); return; }
    const top = ta.scrollTop;
    typeInto(ta, 0, ta.value.length, lines.join('\n'));
    const at = lines.slice(0, labAt + 1).join('\n').length;
    ta.setSelectionRange(at, at); ta.scrollTop = top;
    pos.set(ta, { s: at, e: at });
    view.say(`已補進${fieldName(ta) ? `「${fieldName(ta)}」的` : ''} [Lab]：${done.join('、')}（Ctrl+Z 可復原；還沒存檔）`, 'done');
  }

  /* ---------- 抓資料 ---------- */
  const KEYS = ['notes', 'tpr', 'io', 'labs', 'pending', 'abx', 'orders', 'nursing', 'handoff', 'pacs', 'tubes', 'meds'];
  function pickBase(notes) {
    if (!notes.length) return NaN;
    const today = HIS.dayStart((+new Date()));
    // 最新一篇是今天寫的（多半就是正在寫的這篇）→ 往前找昨天以前的那篇
    const prev = notes.find((n) => n.ms < today);
    return notes[0].ms >= today && prev ? prev.ms : notes[0].ms;
  }
  // 各來源各自載入、各自更新畫面。span：目前抓了幾天（時間軸或 Lab 的天數調大時只重抓需要的那幾個來源）
  let loadSeq = 0, S = HIS.sources(P), tLoad = 0;
  const span = { vit: 7, lab: 14 };
  const seqOf = {};
  function part(key, fn, apply) {
    const my = (seqOf[key] = (seqOf[key] || 0) + 1), gen = loadSeq;
    const live = () => seqOf[key] === my && gen === loadSeq;
    M.loading.add(key); delete M.err[key];
    return (async () => {
      try { const v = await fn(); if (live()) apply(v); } catch (e) { if (live()) M.err[key] = (e && e.message) || String(e); }
      if (!live()) return;
      M.loading.delete(key);
      view.render();
      if (!M.loading.size) {
        const bad = Object.keys(M.err);
        view.say(bad.length ? `${bad.length} 個來源抓取失敗（${bad.join('、')}），其餘已更新` : `資料已更新（${(((+new Date()) - tLoad) / 1000).toFixed(1)} 秒）· 插入後記得自己按 HIS 的暫存`, bad.length ? 'warn' : '');
      }
    })();
  }
  const PARTS = {
    notes: () => part('notes', S.notes, (v) => { M.notes = v; if (!fin(M.base) || !v.some((n) => n.ms === M.base)) M.base = pickBase(v); }),
    tpr: () => part('tpr', async () => {
      // 多天查詢（生命徵象頁的介面）不帶病人識別；近兩天的來源（OuterData）有帶。兩邊都抓，拿重疊的時段互相比對：
      // 對不上就表示多天查詢回的可能是別的病人（例如同時開了另一位的生命徵象頁），整份捨棄只用近兩天的
      const outerP = S.vitalsOuter().catch(() => null);
      let multi = null, note = '';
      try { multi = await S.tpr(span.vit); } catch (e) { note = (e && e.message) || String(e); }
      const outer = await outerP;
      if (multi && outer && outer.length) {
        const cmp = outer.filter((o) => o.temp != null || o.hr != null || o.sys != null);
        const same = (o, v) => Math.abs(v.t - o.t) <= 60000 && ((o.temp != null && v.temp === o.temp) || (o.hr != null && v.hr === o.hr) || (o.sys != null && v.sys === o.sys));
        const hit = cmp.filter((o) => multi.vitals.some((v) => same(o, v))).length;
        M.vitalsCheck = `${hit}/${cmp.length}`;
        if (cmp.length >= 2 && hit / cmp.length < 0.5) { note = `多天查詢回來的數值和這位病人近兩天的紀錄對不上（${hit}/${cmp.length}），已捨棄`; multi = null; }
      }
      if (multi) return { vitals: multi.vitals, weights: multi.weights, note: '' };
      if (outer) return { vitals: outer, weights: [], note: note || '多天查詢失敗' };
      throw new Error(note || '生命徵象抓取失敗');
    }, (v) => { M.vitals = v.vitals; M.weights = v.weights; M.vitalsNote = v.note || ''; if (v.note) console.warn('[pn-workspace] 生命徵象只有近 2 天：', v.note); }),
    io: () => part('io', () => S.io(span.vit), (v) => { M.io = v; }),
    labs: () => part('labs', () => S.labs(span.lab), (v) => { M.labs = v; M.micro = v.micro; }),
    pending: () => part('pending', S.pending, (v) => { M.pending = v; }),
    abx: () => part('abx', S.abx, (v) => { M.abx = v; }),
    orders: () => part('orders', S.orders, (v) => { M.orders = v; }),
    nursing: () => part('nursing', S.nursing, (v) => { M.nursing = v; }),
    handoff: () => part('handoff', S.handoff, (v) => { M.handoff = v; }),
    pacs: () => part('pacs', S.pacs, (v) => { M.pacs = v; }),
    tubes: () => part('tubes', S.tubes, (v) => { M.tubes = v; }),
    meds: () => part('meds', () => S.mar(fin(M.base) ? M.base : (+new Date()) - DAY), (v) => { M.meds = v; }),
  };
  async function load() {
    loadSeq++;
    S = HIS.sources(P);
    M.now = (+new Date()); M.err = {}; M.loading = new Set(KEYS);
    tLoad = (+new Date());
    view.say('抓資料中…'); view.render();
    const pNotes = PARTS.notes();
    for (const k of KEYS) if (k !== 'notes' && k !== 'meds') PARTS[k]();
    await pNotes;
    PARTS.meds();
  }
  // 天數調大、超過已經抓的範圍時才重抓
  function need(kind, days, keys, label) {
    if (days <= span[kind]) return;
    span[kind] = days; tLoad = (+new Date());
    view.say(`${label}改抓近 ${days} 天…`);
    keys.forEach((k) => PARTS[k]());
    view.render();
  }

  const view = PNW_VIEW.create(root, M, {
    insert, labMerge,
    reload: () => load(),
    needVitals: (days) => need('vit', days, ['tpr', 'io'], '生命徵象與 I/O'),
    needLabs: (days) => need('lab', days, ['labs'], '檢驗'),
    hide: (v) => { hidden = v; setPref('hidden', v ? '1' : '0'); layout(); },
    toggleList: () => { const off = document.documentElement.classList.contains('pnw-nolist'); listMode = off ? 'show' : 'hide'; layout(); },
    setBase: (ms) => {
      M.base = ms; view.render();
      PARTS.meds();
    },
  });

  // UpdatePanel 會把文字框整個換掉：出現時收起 note 清單讓出寬度，並把編輯區捲到最上面
  let hadEditor = false, moTimer = 0;
  const onDom = () => {
    const all = fields();
    const has = all.length > 0;
    if (has !== hadEditor) {
      hadEditor = has; layout();
      if (has && !hidden) { const pnl = all[0].closest('[id*="Pnl"]') || all[0]; pnl.scrollIntoView({ block: 'start' }); }
    }
  };
  // 文字框平常就在頁面裡、只是面板沒顯示，所以除了節點增減，也要看 style／class 的變化
  const mo = new MutationObserver(() => { clearTimeout(moTimer); moTimer = setTimeout(onDom, 120); });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

  layout(); onDom();
  load();
  const destroy = () => {
    loadSeq++; mo.disconnect(); clearTimeout(moTimer);
    window.removeEventListener('resize', onResize);
    ['focusin', 'keyup', 'mouseup', 'select', 'input'].forEach((ev) => document.removeEventListener(ev, saveCaret, true));
    host.remove(); style.remove();
    document.documentElement.classList.remove('pnw-on', 'pnw-nolist');
    document.documentElement.style.removeProperty('--pnw-w');
  };
  window.__pnw = { M, destroy, src: () => S, reload: load, render: () => view.render(), debug: () => view.debug(), nameOf: fieldName, fields: () => fields().map((t) => ({ id: t.id, name: fieldName(t), ro: t.readOnly || t.disabled })), version: '0.3.1' };
})();
