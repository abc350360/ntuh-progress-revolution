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
  const hasLab = (t) => /^\s*\[Lab\]/im.test(t.value) && !t.readOnly && !t.disabled;
  function labMerge() {
    // 有 [Lab] 段的欄位優先（結構化 note 通常寫在 Assessment 裡）；都沒有就退回游標所在的欄位
    const focused = shown(picked) ? picked : null;
    const ta = (focused && hasLab(focused) ? focused : fields().find(hasLab)) || editor('[Lab]');
    if (!ta) return;
    const r = labMergeInto(ta);
    if (r.insert) { insert(r.insert, '新的 Lab（找不到 [Lab] 段，改插在游標處）'); return; }
    // 培養與病原檢驗跟著 Lab 一起補，但寫在 [Pathogen] 段
    const pa = datedMergeInto(ta, pathogenEntries(), PATHOGEN, ta.id !== ED);
    const parts = [r.done.length ? '[Lab]：' + r.done.join('、') : '', pa.added || pa.updated || pa.moved ? '[Pathogen]：' + datedMsg(pa, '結果') : ''].filter(Boolean);
    if (!parts.length) { view.say(r.why, 'warn'); return; }
    view.say(`已補進${fieldName(ta) ? `「${fieldName(ta)}」` : ''} ${parts.join('；')}（Ctrl+Z 可復原；還沒存檔）`, 'done');
  }
  /** 把新結果併進 ta 的 [Lab] 段。回傳 { done: 補了哪些表, why: 沒補的原因, insert: 找不到 [Lab] 段時可另外插入的文字 }，不自己顯示訊息 */
  function labMergeInto(ta) {
    const labText = view.labText();
    if (!labText) return { done: [], why: '檢驗資料還沒載入，或近 14 天沒有檢驗' };
    const now = new Date();
    const pacsAll = (M.pacs || []).map((p) => { const d = new Date(p.ms); return { day: (d.getMonth() + 1) * 100 + d.getDate(), title: p.title }; });
    const res = window.PNLab.process(labText, ta.value, (M.orders && M.orders.rows) || [], pacsAll, (now.getMonth() + 1) * 100 + now.getDate());
    // res.lab 只有檢驗表格；影像與培養另外由 datedMergeInto() 寫進 [Image]、[Pathogen] 段
    if (!res.lab) return { done: [], why: '[Lab] 已經是最新的，沒有可以補的結果' };
    const sections = res.lab.split(/\n(?=#\. )/).map((blk) => { const ls = blk.split('\n'); return { title: ls[0].replace(/^#\.\s*/, '').replace(/:\s*$/, ''), lines: ls.slice(1) }; });
    const lines = ta.value.replace(/\r/g, '').split('\n');
    const labAt = lines.findIndex((l) => /^\s*\[Lab\]/i.test(l));
    if (labAt < 0) return { done: [], why: '找不到 [Lab] 段', insert: res.lab };
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
    if (!done.length) return { done: [], why: '新的結果已經都在 [Lab] 裡了' };
    const top = ta.scrollTop;
    typeInto(ta, 0, ta.value.length, lines.join('\n'));
    const at = lines.slice(0, labAt + 1).join('\n').length;
    ta.setSelectionRange(at, at); ta.scrollTop = top;
    pos.set(ta, { s: at, e: at });
    return { done };
  }

  /* ---------- 一鍵帶入：把今天要更新的資料放進這篇 note 對應的地方 ---------- */
  // 原則：只填空的地方、只加不刪。唯一會取代舊內容的情況是「那一段每一行都是 V/S 數值」
  // （前一篇帶過來的舊數值，本來就要換掉）；夾了別的字就不動。
  const VS_LINE = /^\s*(?:\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s+)?(?:T\s*[:：]|BP\s*[:：]|SpO2\s*[:：]|體重\s*[:：])/i;
  const onlyVs = (text) => { const ls = text.split('\n').filter((l) => l.trim()); return ls.length > 0 && ls.every((l) => VS_LINE.test(l)); };
  // 段落標題：[V/S]、[Lab]、[Image]… 或 ===Plan===。「[11/14] Sputum: …」這種日期開頭的是內容，不是標題
  const SEC_HEAD = /^\s*(?:\[(?!\d{1,2}\/\d{1,2}\])[^\]\n]+\]|={2,})/;
  /** 在 free note 裡找 [名稱] 段：內容是 lines[from..to)，不含段尾的空行 */
  function block(lines, re) {
    const head = lines.findIndex((l) => re.test(l));
    if (head < 0) return null;
    let to = head + 1; while (to < lines.length && !SEC_HEAD.test(lines[to])) to++;
    while (to > head + 1 && !lines[to - 1].trim()) to--;
    return { head, from: head + 1, to };
  }
  function setBlock(ta, lines, b, text) {
    lines.splice(b.from, b.to - b.from, ...text.split('\n'));
    const top = ta.scrollTop;
    typeInto(ta, 0, ta.value.length, lines.join('\n'));
    ta.scrollTop = top;
  }
  const linesOf = (ta) => ta.value.replace(/\r/g, '').split('\n');

  /* ---------- 影像與病原：各自一段（[Image]、[Pathogen]），一筆一行「<MM/DD> 名稱: 結果」 ---------- */
  const pad2 = (n) => String(n).padStart(2, '0');
  const mdOf = (ms) => { const d = new Date(ms); return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`; };
  const normTitle = (s) => String(s).replace(/^Spu\/C\b/i, 'Sp/C').replace(/\(Indication.*$/i, '').replace(/\(入院檢查\)/g, '').replace(/\s+/g, '').toLowerCase();
  const DATED = /^\s*[\[<](\d{1,2})\/(\d{1,2})[\]>]\s*(.*)$/;      // 新寫法 <11/10>；也認得舊寫法 [11/10]
  const dayKey = (md) => { const m = String(md).match(/(\d{1,2})\/(\d{1,2})/); return m ? +m[1] * 100 + +m[2] : -1; };
  const numOf = (ms) => { const d = new Date(ms); return (d.getMonth() + 1) * 100 + d.getDate(); };
  const pacsDays = () => (M.pacs || []).map((p) => ({ day: numOf(p.ms), title: p.title }));
  const sinceMs = () => HIS.dayStart(fin(M.base) ? M.base : (+new Date()) - DAY);
  const pnProcess = (labText) => window.PNLab.process(labText || '', '', (M.orders && M.orders.rows) || [], pacsDays(), numOf(+new Date()));
  /** 上一篇之後已出報告的影像，加上近 10 天有醫囑但還沒報告的 */
  function imageEntries() {
    const out = (M.pacs || []).filter((p) => p.ms >= sinceMs()).map((p) => ({ md: mdOf(p.ms), title: p.title, text: (p.imp || '').slice(0, 600) || '(no report text)', pending: false, fresh: true }));
    for (const e of pnProcess('').image) out.push({ md: e.md, title: e.title, text: 'pending', pending: true, fresh: true });
    return out.sort((x, y) => dayKey(x.md) - dayKey(y.md));
  }
  /** 培養與病原檢驗（含流感、新冠快篩）：近 14 天的結果與還沒發的。
   *  fresh（值得新增一行）＝還在 pending、上一篇之後才採檢，或採檢較早但上一篇之後才發報告（培養常常隔幾天才有結果） */
  function pathogenEntries() {
    const since = numOf(sinceMs()), out = [];
    const base = fin(M.base) ? M.base : (+new Date()) - DAY;
    const lateDays = new Set((M.micro || []).filter((e) => fin(e.reported) && e.reported > base && fin(e.t)).map((e) => numOf(e.t)));
    for (const e of pnProcess(view.labText()).pathogen) {
      const text = String(e.res || '').trim() || '-', pending = /^pending$/i.test(text);
      out.push({ md: e.md, title: String(e.label).trim(), text, pending, fresh: pending || e.day >= since || lateDays.has(e.day) });
    }
    return out.sort((x, y) => dayKey(x.md) - dayKey(y.md));
  }
  const IMAGE = {
    name: '[Image]', head: /^\s*\[Images?\]/i, legacy: /^#\.\s*Image:?\s*$/i, after: [/^\s*\[Lab\]/i],
    blockIf: /^\s*\[(?:CXR|CT|MRI|KUB|X-?ray|Echo|Sono)\b[^\]]*\]/i, blocked: 'note 用的是 [CXR] 這類段落，沒有 [Image] 段',
    none: '上一篇之後沒有新的影像', same: '[Image] 已經是最新的', noAnchor: 'note 裡沒有 [Lab] 段可以接',
  };
  const PATHOGEN = {
    name: '[Pathogen]', head: /^\s*\[Pathogens?\]/i, legacy: /^#\.\s*Culture:?\s*$/i, after: [/^\s*\[(?:Abx|Antibiotics?)\]/i, /^\s*\[Lab\]/i], loose: true,
    none: '上一篇之後沒有新的培養或病原檢驗', same: '[Pathogen] 已經是最新的', noAnchor: 'note 裡沒有 [Abx] 或 [Lab] 段可以接',
  };
  /**
   * 把 entries 併進 spec 那一段，沒有就新增（接在 spec.after 第一個找得到的段落後面；endOk 時可以放最後）。
   * 只加行。會改到既有文字的只有三種，內容都不會少：
   *   1. 原本寫 pending、現在有結果的那一行，換成結果；
   *   2. 舊寫法的日期 [MM/DD] 換成 <MM/DD>；
   *   3. 舊版放在 [Lab] 底下的「#. Culture:」「#. Image:」，整段都是日期開頭的行時，搬進這一段。
   * 回傳 { added, updated, moved, why }
   */
  function datedMergeInto(ta, entries, spec, endOk) {
    const lines = linesOf(ta);
    const fresh = entries.filter((en) => en.fresh);
    const legacyAt = () => lines.findIndex((l) => spec.legacy.test(l.trim()));
    let li = legacyAt(), le = li;
    if (li >= 0) { le = li + 1; while (le < lines.length && DATED.test(lines[le])) le++; }
    const next = li >= 0 ? lines[le] : undefined;
    const movable = li >= 0 && le > li + 1 && (next === undefined || !next.trim() || SEC_HEAD.test(next) || /^#\./.test(next.trim()));
    let b = block(lines, spec.head);
    if (!b) {
      if (!fresh.length && !movable) return { added: 0, updated: 0, moved: 0, why: spec.none };
      if (spec.blockIf && lines.some((l) => spec.blockIf.test(l))) return { added: 0, updated: 0, moved: 0, why: spec.blocked };
      if (!spec.after.some((re) => block(lines, re)) && !endOk) return { added: 0, updated: 0, moved: 0, why: spec.noAnchor };
    }
    // 先把舊寫法那一段拿出來（之後原封不動放進新的段落，只換日期的括號）
    let carried = [];
    if (movable) carried = lines.splice(li, le - li).slice(1);
    // 沒搬走的舊段落（夾了別的字）：留在原地，但比對重複時要算進去
    const stay = []; li = legacyAt();
    if (li >= 0) for (let i = li + 1; i < lines.length && !SEC_HEAD.test(lines[i]) && !/^#\./.test(lines[i].trim()); i++) stay.push(lines[i]);
    b = block(lines, spec.head);
    if (!b) {
      let at = lines.length; while (at > 0 && !lines[at - 1].trim()) at--;
      for (const re of spec.after) { const x = block(lines, re); if (x) { at = x.to; break; } }
      lines.splice(at, 0, spec.name);
      b = { head: at, from: at + 1, to: at + 1 };
    }
    let moved = 0, reformatted = 0;
    for (const l of carried) { lines.splice(b.to, 0, l.replace(/^(\s*)\[(\d{1,2}\/\d{1,2})\]/, '$1<$2>')); b.to++; moved++; }
    for (let i = b.from; i < b.to; i++) { const n = lines[i].replace(/^(\s*)\[(\d{1,2}\/\d{1,2})\]/, '$1<$2>'); if (n !== lines[i]) { lines[i] = n; reformatted++; } }
    const same = (line, en) => {
      const m = line.match(DATED); if (!m || +m[1] * 100 + +m[2] !== dayKey(en.md)) return false;
      const have = normTitle(m[3]), want = normTitle(en.title), label = have.split(':')[0];
      return have.startsWith(want) || (!!spec.loose && label.length >= 3 && want.startsWith(label));
    };
    let added = 0, updated = 0;
    for (const en of entries) {
      const line = `<${en.md}> ${en.title}: ${en.text}`;
      let hit = -1; for (let i = b.from; i < b.to; i++) if (same(lines[i], en)) { hit = i; break; }
      if (hit < 0) { if (en.fresh && !stay.some((l) => same(l, en))) { lines.splice(b.to, 0, line); b.to++; added++; } }
      else if (!en.pending && /pending\)?\s*$/i.test(lines[hit].trim())) { lines[hit] = line; updated++; }
    }
    if (!added && !updated && !moved && !reformatted) return { added: 0, updated: 0, moved: 0, why: fresh.length || b.to > b.from ? spec.same : spec.none };
    const top = ta.scrollTop;
    typeInto(ta, 0, ta.value.length, lines.join('\n'));
    ta.scrollTop = top;
    return { added, updated, moved: moved + reformatted };
  }
  const datedMsg = (r, what) => [r.added ? '新增 ' + r.added + ' 筆' : '', r.updated ? r.updated + ' 筆 pending 換成' + what : '', r.moved ? '改成新寫法 ' + r.moved + ' 行' : ''].filter(Boolean).join('、');
  function fillAll() {
    const all = fields().filter((t) => !t.readOnly && !t.disabled);
    if (!all.length) { view.say('還沒有開啟可以編輯的 note：先在左邊清單選一篇，或按 HIS 的新增按鈕', 'warn'); return; }
    if (['tpr', 'labs', 'tubes'].some((k) => M.loading.has(k))) { view.say('資料還在載入，等狀態列顯示「資料已更新」再按一次', 'warn'); return; }
    const by = (re) => all.find((t) => re.test(t.id));
    const free = all.find((t) => t.id === ED);
    const nm = (t) => fieldName(t) || 'note';
    const done = [], skip = [];
    const vs = view.vsText(), tubes = view.tubesText();

    // 1. V/S：free note 的 [V/S] 段；結構化 Progress 的 Objective（On-service 是 Physical Exam and Assessment）
    if (!vs.text) skip.push('V/S：沒有生命徵象資料');
    else if (free) {
      const lines = linesOf(free), b = block(lines, /^\s*\[V\/S\]/i);
      const cur = b ? lines.slice(b.from, b.to).join('\n') : '';
      if (!b) skip.push('V/S：note 裡沒有 [V/S] 段');
      else if (cur.trim() === vs.text.trim()) skip.push('V/S：已經是這組數值');
      else if (!cur.trim() || onlyVs(cur)) { setBlock(free, lines, b, vs.text); done.push(`[V/S]（${cur.trim() ? '換成' : '填入'}${vs.when}）`); }
      else skip.push('V/S：[V/S] 段有數值以外的內容');
    } else {
      const o = by(/txbObject$/) || by(/PhysicalExamAndAssessment$/);
      if (!o) skip.push('V/S：這種 note 沒有放生命徵象的欄位');
      else if (o.value.trim() === vs.text.trim()) skip.push(`V/S：${nm(o)} 已經是這組數值`);
      else if (!o.value.trim() || onlyVs(o.value)) { const was = o.value.trim(); typeInto(o, 0, o.value.length, vs.text); done.push(`${nm(o)}（${was ? '換成' : '填入'}${vs.when}的 V/S）`); }
      else skip.push(`V/S：${nm(o)} 已有其他內容`);
    }

    // 2. 管路：只填空的。free note 的 [Tube] 段通常有手寫的細節，有內容就不動也不提
    if (tubes.text) {
      if (free) {
        const lines = linesOf(free), b = block(lines, /^\s*\[(?:Tubes?|Lines?|Catheters?|管路)\]/i);
        if (b && !lines.slice(b.from, b.to).join('').trim()) { setBlock(free, lines, b, tubes.text); done.push(`[Tube]（${tubes.n} 條）`); }
      } else {
        const c = by(/BSIBundle$/);
        if (c && !c.value.trim()) { typeInto(c, 0, 0, tubes.text); done.push(`${nm(c)}（管路 ${tubes.n} 條）`); }
        else if (c) skip.push(`管路：${nm(c)} 已有內容`);
      }
    }

    // 3. Lab：有 [Lab] 段就把新結果接在既有表格後面；結構化 note 沒有 [Lab] 段時，在 Assessment 最後加一段
    const target = free || by(/txbAssessment\d+$/);
    if (!target) skip.push('Lab：找不到 Assessment 欄');
    else if (hasLab(target)) {
      const r = labMergeInto(target);
      if (r.done.length) done.push(`${free ? '' : nm(target) + ' 的 '}[Lab]（${r.done.join('、')}）`); else skip.push('Lab：' + r.why);
    } else {
      const lab = view.labNewText();
      if (!lab.text) skip.push('Lab：上一篇之後沒有新的抽血結果');
      else if (free) skip.push('Lab：note 裡沒有 [Lab] 段');
      else { const v = target.value; typeInto(target, v.length, v.length, (v && !v.endsWith('\n') ? '\n' : '') + '[Lab]\n' + lab.text + '\n'); done.push(`${nm(target)}（新增 [Lab] ${lab.days}）`); }
    }

    // 4. 影像、5. 病原：跟 Lab 同一個欄位，各自一段。[Image] 接在 [Lab] 後面；[Pathogen] 接在 [Abx] 後面，沒有 [Abx] 就接在 [Lab] 後面
    if (target) {
      const pre = free ? '' : nm(target) + ' 的 ';
      const im = datedMergeInto(target, imageEntries(), IMAGE, !free);
      if (im.added || im.updated || im.moved) done.push(`${pre}[Image]（${datedMsg(im, '報告')}）`); else skip.push('影像：' + im.why);
      const pa = datedMergeInto(target, pathogenEntries(), PATHOGEN, !free);
      if (pa.added || pa.updated || pa.moved) done.push(`${pre}[Pathogen]（${datedMsg(pa, '結果')}）`); else skip.push('病原：' + pa.why);
    }

    view.say((done.length ? '已帶入：' + done.join('；') : '沒有可以帶入的內容') + (skip.length ? '｜沒動：' + skip.join('；') : '') + (done.length ? '（Ctrl+Z 可復原；還沒存檔）' : ''), done.length ? 'done' : 'warn');
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
    insert, labMerge, fillAll,
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
  window.__pnw = { M, destroy, src: () => S, imagePreview: () => imageEntries(), pathogenPreview: () => pathogenEntries(), reload: load, render: () => view.render(), debug: () => view.debug(), nameOf: fieldName, fields: () => fields().map((t) => ({ id: t.id, name: fieldName(t), ro: t.readOnly || t.disabled })), version: '0.6.2' };
})();
