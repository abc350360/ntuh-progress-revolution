(() => {
// ---- src/pn-lab.js ----
// 檢驗整理（表格＋緊湊）輸出的後處理：合併 Renal & e-、去 eGFR/Glucose、只留上一篇 note 之後的新列、標 pending。
const PNLab = (() => {
  const DROP_COLS = new Set(['eGFR', 'Glucose']);
  const COL_GAP = 2, MAX_COLS = 8, EMPTY = '-';
  const dayOf = (label) => String(label).split(' ')[0];
  const dayNum = (d) => { const m = String(d).match(/^(\d{1,2})\/(\d{1,2})/); return m ? +m[1] * 100 + +m[2] : -1; };
  const timeNum = (label) => { const m = String(label).match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : -1; };
  const cmpLabel = (a, b) => (dayNum(a) - dayNum(b)) || (timeNum(a) - timeNum(b));

  // 以「所有行在該位置都是空白、且連續 ≥2 格」切欄（檢驗整理用 2 格欄距＋補齊對齊）
  function parseBlock(lines) {
    const w = Math.max(...lines.map((l) => l.length));
    const blank = [];
    for (let i = 0; i < w; i++) blank[i] = lines.every((l) => (l[i] || ' ') === ' ');
    const starts = [];
    for (let i = 0; i < w; i++) {
      if (blank[i]) continue;
      if (i === 0 || (blank[i - 1] && (i < 2 || blank[i - 2]))) starts.push(i);
    }
    // 表頭第一欄（日期欄）是空白，所以日期欄起點固定為 0
    if (starts[0] !== 0) starts.unshift(0);
    const cut = (l) => starts.map((s, k) => (l.slice(s, k + 1 < starts.length ? starts[k + 1] : undefined) || '').trim());
    const head = cut(lines[0]).slice(1);
    const rows = lines.slice(1).map(cut).map((c) => ({ label: c[0], vals: Object.fromEntries(head.map((h, k) => [h, c[k + 1] || EMPTY])) }));
    return { cols: head, rows };
  }

  function parse(text) {
    const groups = []; let g = null; let block = [];
    const flush = () => { if (g && block.length) { const b = parseBlock(block); for (const c of b.cols) if (!g.cols.includes(c)) g.cols.push(c); for (const r of b.rows) { const ex = g.rows.find((x) => x.label === r.label); if (ex) Object.assign(ex.vals, r.vals); else g.rows.push(r); } } block = []; };
    for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
      const m = line.match(/^#\.\s*(.+?):?\s*$/);
      if (m) { flush(); g = { name: m[1], cols: [], rows: [], culture: /^Culture$/i.test(m[1]), lines: [] }; groups.push(g); continue; }
      if (!g || !line.trim()) continue;
      if (g.culture) { g.lines.push(line.trim()); continue; }
      if (/^\s/.test(line)) flush();          // 表頭（日期欄空白）＝新的一段表格
      block.push(line);
    }
    flush();
    return groups;
  }

  function buildTable(title, cols, rows) {
    if (!cols.length || !rows.length) return null;
    const labelW = Math.max(...rows.map((r) => r.label.length));
    const blocks = [];
    for (let s = 0; s < cols.length; s += MAX_COLS) {
      const idx = cols.slice(s, s + MAX_COLS);
      const rr = rows.filter((r) => idx.some((c) => r.vals[c] && r.vals[c] !== EMPTY));
      if (!rr.length) continue;
      const cw = idx.map((c) => Math.max(c.length, ...rr.map((r) => (r.vals[c] || EMPTY).length)));
      const line = (label, get) => (label.padEnd(labelW) + idx.map((c, k) => ' '.repeat(COL_GAP) + get(c).padEnd(cw[k])).join('')).replace(/\s+$/, '');
      blocks.push([line('', (c) => c), ...rr.map((r) => line(r.label, (c) => r.vals[c] || EMPTY))].join('\n'));
    }
    return blocks.length ? `#. ${title}\n${blocks.join('\n')}` : null;
  }

  // 同一天若只剩一列就只顯示日期；日期列與時間列並存時，把日期列併進當天第一個不衝突的時間列
  function tidyRows(rows) {
    const byDay = new Map();
    for (const r of rows) { const d = dayOf(r.label); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(r); }
    const out = [];
    for (const [d, rs] of byDay) {
      const plain = rs.filter((r) => r.label === d), timed = rs.filter((r) => r.label !== d).sort((a, b) => cmpLabel(a.label, b.label));
      for (const p of plain) {
        const has = (r) => Object.entries(r.vals).some(([, v]) => v && v !== EMPTY);
        const tgt = timed.find((t) => Object.entries(p.vals).every(([k, v]) => !v || v === EMPTY || !t.vals[k] || t.vals[k] === EMPTY));
        if (tgt) { for (const [k, v] of Object.entries(p.vals)) if (v && v !== EMPTY) tgt.vals[k] = v; } else if (has(p)) timed.push(p);
      }
      const keep = (timed.length ? timed : plain).filter((r) => Object.values(r.vals).some((v) => v && v !== EMPTY));
      if (keep.length === 1) keep[0].label = d;
      out.push(...keep);
    }
    return out.sort((a, b) => cmpLabel(a.label, b.label));
  }

  // 上一篇 note 的 [Lab] 段最後一個日期；沒有 [Lab] 段回 -1（＝全部列出）
  function lastNoteLabDay(note) {
    const lines = String(note || '').replace(/\r/g, '').split('\n');
    const i = lines.findIndex((l) => /^\s*\[Lab\]/i.test(l));
    if (i < 0) return -1;
    let last = -1;
    for (let k = i + 1; k < lines.length; k++) {
      if (/^\s*\[[A-Za-z]/.test(lines[k]) || /^\s*==/.test(lines[k])) break;
      const m = lines[k].trim().match(/^(\d{1,2})\/(\d{1,2})\b/);
      if (m) last = Math.max(last, +m[1] * 100 + +m[2]);
    }
    return last;
  }

  // 醫囑項目 → 檢驗整理的類別與欄位（pending 填回各類別用）
  const LAB_MAP = [
    [/CBC/i, 'Hemogram', ['WBC', 'Hb', 'MCV', 'Plt']], [/WBC Classification|WBC D\/C/i, 'Hemogram', ['Seg']],
    [/CRP/i, 'Hemogram', ['CRP']], [/Procalcitonin/i, 'Hemogram', ['PCT']],
    [/^UN\b|\bBUN\b|Urea/i, 'Renal & e-', ['BUN']], [/Creatinine/i, 'Renal & e-', ['CRE']], [/Uric/i, 'Renal & e-', ['UA']],
    [/Sodium|\bNa\b/i, 'Renal & e-', ['Na']], [/Potassium|\bK\b/, 'Renal & e-', ['K']], [/Chloride|\bCl\b/, 'Renal & e-', ['Cl']],
    [/Calcium|\bCa\b/, 'Renal & e-', ['Ca']], [/Phosph/i, 'Renal & e-', ['P']], [/Magnesium|\bMg\b/, 'Renal & e-', ['Mg']],
    [/\bALT\b|GPT/i, 'Liver', ['ALT']], [/\bAST\b|GOT/i, 'Liver', ['AST']], [/Bilirubin-T|T-Bil/i, 'Liver', ['T-Bil']],
    [/Bilirubin-D|D-Bil/i, 'Liver', ['D-Bil']], [/Albumin/i, 'Liver', ['Alb']], [/\bALP\b|Alkaline/i, 'Liver', ['ALP']], [/GGT/i, 'Liver', ['GGT']],
    [/\bPT\b|Prothrombin/i, 'Coagulation', ['PT', 'INR']], [/a\.?P\.?T\.?T/i, 'Coagulation', ['aPTT']],
    [/NT-?pro/i, 'Cardiac', ['NT-proBNP']], [/CK-MB/i, 'Cardiac', ['CK-MB']], [/\bCK\b/, 'Cardiac', ['CK']], [/Troponin/i, 'Cardiac', ['TnT']],
  ];
  const cultureType = (s) => (/blood|\bB\/C|^B2/i.test(s) ? 'B/C' : /urine|\bU\/C|^B3/i.test(s) ? 'U/C' : /sputum|\bSpu?\/C|\bS\/C/i.test(s) ? 'Spu/C'
    : /cvc|cvp|picc|catheter tip|Cath/i.test(s) ? 'Tip/C' : /wound|pus|W\/C/i.test(s) ? 'W/C' : /stool/i.test(s) ? 'Stool/C' : 'Cul');

  // labText：檢驗整理表格＋緊湊輸出；note：上一篇 note；orderRows：醫囑簽收（全部）；pacsAll：已出報告影像
  function process(labText, note, orderRows, pacsAll, todayNum) {
    const groups = parse(labText);
    const cutoff = lastNoteLabDay(note);
    const allDays = new Set();
    for (const g of groups) for (const r of g.rows) allDays.add(dayNum(dayOf(r.label)));
    // 合併 Renal + Electrolytes
    const ren = groups.find((g) => g.name === 'Renal'), ele = groups.find((g) => g.name === 'Electrolytes');
    if (ren || ele) {
      const m = { name: 'Renal & e-', cols: [...(ren ? ren.cols : []), ...(ele ? ele.cols : [])], rows: [] };
      for (const src of [ren, ele]) if (src) for (const r of src.rows) m.rows.push({ label: r.label, vals: { ...r.vals } });
      // 同一 label 合併
      const by = new Map(); for (const r of m.rows) { if (by.has(r.label)) Object.assign(by.get(r.label).vals, Object.fromEntries(Object.entries(r.vals).filter(([, v]) => v !== EMPTY))); else by.set(r.label, r); }
      m.rows = [...by.values()];
      const at = groups.indexOf(ren || ele);
      groups.splice(at, 1, m);
      if (ren && ele) groups.splice(groups.indexOf(ele), 1);
    }
    // 培養：新的採檢日，或上一篇寫 pending 的那筆
    const cul = groups.find((g) => g.culture);
    const notePending = new Set();
    for (const l of String(note || '').split('\n')) {
      if (!/pending/i.test(l)) continue;
      const m = l.match(/\[?(\d{1,2})\/?(\d{2})\]?/); if (m) notePending.add(+m[1] * 100 + +m[2] + '|' + cultureType(l));
    }
    const culEntries = [];
    if (cul) for (const l of cul.lines) { const m = l.match(/^\[(\d{1,2})\/(\d{1,2})\]\s*(.+?):\s*(.*)$/); if (m) culEntries.push({ day: +m[1] * 100 + +m[2], md: `${m[1]}/${m[2]}`, label: m[3], type: cultureType(m[3]), res: m[4], line: l }); }
    const newCul = culEntries.filter((e) => e.day > cutoff || notePending.has(e.day + '|' + e.type));
    // pending：醫囑有開、報告還沒出；抽血依項目放回各檢驗類別，培養放 Culture，影像放 Image
    const labPend = new Map();   // group → Map(day → { md, cols:Set, names:Set })
    const addLabPend = (grp, o, cols, name) => {
      if (!labPend.has(grp)) labPend.set(grp, new Map());
      const m = labPend.get(grp); if (!m.has(o.startDay)) m.set(o.startDay, { md: o.startMd, cols: new Set(), names: new Set() });
      const e = m.get(o.startDay); for (const c of cols) e.cols.add(c); if (name) e.names.add(name);
    };
    const culPend = [], imgPend = [];
    const seen = new Set();
    const norm = (s) => String(s).replace(/\[[^\]]*\]/g, '').replace(/\(V\d+\)/g, '').replace(/特殊醫囑.*$/, '').replace(/\(Specimen.*$/, '').replace(/\s+/g, '').toLowerCase();
    const delKeys = new Set((orderRows || []).filter((o) => /刪除/.test(o.act)).map((o) => o.startDay + '|' + norm(o.name)));
    for (const o of orderRows || []) {
      if (/刪除/.test(o.act) || !o.startDay || o.startDay > todayNum || delKeys.has(o.startDay + '|' + norm(o.name))) continue;
      const ord = (n) => Math.floor(n / 100) * 31 + n % 100; if (ord(o.startDay) < ord(todayNum) - 10) continue;
      if (/影醫/.test(o.type)) {
        if (!/新增/.test(o.act)) continue;
        const key = 'img|' + o.startDay + '|' + norm(o.name); if (seen.has(key)) continue; seen.add(key);
        const done = (pacsAll || []).some((p) => norm(p.title) === norm(o.name) && p.day >= o.startDay - 1 && p.day <= o.startDay + 3);
        if (!done) imgPend.push(`[${o.startMd}] ${o.name.replace(/\[[^\]]*\]/g, '').replace(/特殊醫囑.*$/, '').trim()}: pending`);
      } else if (/檢驗/.test(o.type) && /culture|ID\+DS|培養|Gram|AFS|Fungus/i.test(o.name)) {
        const type = cultureType(o.name);
        const key = 'cul|' + o.startDay + '|' + type; if (seen.has(key)) continue; seen.add(key);
        if (!culEntries.some((e) => e.day === o.startDay && e.type === type)) culPend.push({ day: o.startDay, line: `[${o.startMd}] ${type}: pending` });
      } else if (/檢驗/.test(o.type) && !/ABO|Rh blood|Antibody|Blood Type|備血|cross/i.test(o.name) && (o.startDay > cutoff || o.startDay === todayNum)) {
        if (/Urinalysis|\bU\/A\b|Specimen:\s*URI|urine/i.test(o.name)) { addLabPend('Urine', o, [], ''); continue; }
        const hits = LAB_MAP.filter(([re]) => re.test(o.name));
        if (hits.length) for (const [, grp, cols] of hits) addLabPend(grp, o, cols, '');
        else addLabPend('Others', o, [], o.name.replace(/特殊醫囑.*$/, '').replace(/\(.*$/, '').trim());
      }
    }
    // 依類別輸出：有結果的列照常；同一天已有列 → 缺的欄填 pending；整天都還沒出 → 「日期  pending」
    const out = [];
    const order = groups.filter((g) => !g.culture).map((g) => g.name);
    for (const grp of labPend.keys()) if (!order.includes(grp)) order.push(grp);
    for (const name of order) {
      const g = groups.find((x) => x.name === name) || { name, cols: [], rows: [] };
      g.cols = g.cols.filter((c) => !DROP_COLS.has(c));
      const allRows = tidyRows(g.rows.map((r) => ({ label: r.label, vals: Object.fromEntries(g.cols.map((c) => [c, r.vals[c] || EMPTY])) })));
      const rows = allRows.filter((r) => dayNum(dayOf(r.label)) > cutoff);
      const whole = [];
      for (const [day, e] of [...(labPend.get(name) || new Map())].sort((a, b) => a[0] - b[0])) {
        // 那天已有結果、且上一篇 note 已涵蓋（day ≤ cutoff）→ 不是 pending（2026-10-16 實測：當天結果已寫進 note 卻被標 pending）
        if (day <= cutoff && allRows.some((r) => dayNum(dayOf(r.label)) === day)) continue;
        const sameDay = rows.filter((r) => dayNum(dayOf(r.label)) === day);
        if (sameDay.length && e.cols.size) {
          for (const c of e.cols) {
            if (DROP_COLS.has(c) || sameDay.some((r) => r.vals[c] && r.vals[c] !== EMPTY)) continue;
            if (!g.cols.includes(c)) g.cols.push(c);
            sameDay[sameDay.length - 1].vals[c] = 'pending';
          }
        } else if (!sameDay.length) whole.push(`${e.md}  pending${e.names.size ? ' (' + [...e.names].join(', ') + ')' : ''}`);
      }
      const cols = g.cols.filter((c) => rows.some((r) => r.vals[c] && r.vals[c] !== EMPTY));
      const t = buildTable(name, cols, rows);
      if (t || whole.length) out.push((t || `#. ${name}`) + (whole.length ? '\n' + whole.join('\n') : ''));
    }
    const culLines = [...newCul.map((e) => ({ day: e.day, line: e.line })), ...culPend].sort((a, b) => a.day - b.day).map((e) => e.line);
    if (culLines.length) out.push('#. Culture:\n' + culLines.join('\n'));
    if (imgPend.length) out.push('#. Image:\n' + imgPend.join('\n'));
    return { text: out.join('\n') || '（上一篇之後沒有新的檢驗結果）', cutoff };
  }
  return { parse, process, lastNoteLabDay, cultureType };
})();
if (typeof module !== 'undefined') module.exports = PNLab; else window.PNLab = PNLab;

// ---- vendor: NTUH-helper lab-summary.user.js（去掉進入點，匯出文字與結構化資料） ----
(function () {
    'use strict';

    // 新竹分院 LU 科室的項目名是中英混寫，且**空格有無不一致**：
    //   「BUN 血中尿素氮」「Creatinine肌酸酐」「Na 鈉」「MCV平均血球體積」
    // 中文若原樣流下去會把表格欄寬撐爆。用通則砍掉中文，而不是逐條列舉——
    // 分院會一直冒出新的混寫，列舉漏掉時是**靜默**的（沒有錯誤，只是排版壞掉）。
    const CJK_RE = /[\u2E80-\u2FDF\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+/g;
    function stripCJK(s) {
        return String(s || '').replace(CJK_RE, ' ').replace(/\s+/g, ' ').trim();
    }

    // 查表鍵：去括號 → 去中文 → 去標點空白 → 小寫。
    // 讓「Aty. lymphocyte」對得到 NAME_MAP 裡的「Aty.Lymphocyte」這種
    // 只差空格/大小寫的寫法，不必為每個變體各列一條。
    function nameKey(s) {
        return stripCJK(String(s || '').replace(/\(.*?\)/g, ' '))
            .replace(/[\s.\-_]/g, '').toLowerCase();
    }

    // ====== 分類定義 ======

    // 呈現方式：table＝日期為列的對齊表格，trend＝單行段落（值以 → 串接）。
    // 存 localStorage 讓下次開啟沿用；背景 worker 也讀同一把 key，
    // 兩者都跑在 MedicalReportContent.aspx 同源，不需另外傳遞。
    const VIEW_KEY = 'ntuh_lab_view_mode';
    const VIEW_TABLE = 'table';
    const VIEW_TREND = 'trend';
    const VIEW_INTERPRET = 'interpret';   // 判讀：最近兩次採檢的臨床解讀
    const OUTPUT_KEY = 'ntuh_lab_output_spacing';
    const OUTPUT_COMPACT = 'compact';
    const OUTPUT_SPACIOUS = 'spacious';

    function getViewPref() {
        try {
            const v = localStorage.getItem(VIEW_KEY);
            return (v === VIEW_TREND || v === VIEW_INTERPRET) ? v : VIEW_TABLE;
        } catch (e) {
            return VIEW_TABLE;
        }
    }
    function setViewPref(v) {
        try { localStorage.setItem(VIEW_KEY, v); } catch (e) { /* noop */ }
    }
    // 背景 worker 要一次算出四種組合（趨勢/表格 × 緊湊/寬鬆）給 progress-note-filler
    // 即時切換用。疏密是在各 format 函式內部讀 getOutputPref()，所以用一個暫時覆寫值
    // 包起來，而不是把 spacing 一路傳參數穿過整條格式化鏈。
    let outputOverride = null;
    function withOutputPref(v, fn) {
        const prev = outputOverride;
        outputOverride = v;
        try { return fn(); } finally { outputOverride = prev; }
    }

    function getOutputPref() {
        if (outputOverride) return outputOverride;
        try {
            return localStorage.getItem(OUTPUT_KEY) === OUTPUT_COMPACT ? OUTPUT_COMPACT : OUTPUT_SPACIOUS;
        } catch (e) {
            return OUTPUT_SPACIOUS;
        }
    }
    function setOutputPref(v) {
        try { localStorage.setItem(OUTPUT_KEY, v); } catch (e) { /* noop */ }
    }

    // 只在血液檢體套用（尿液 / 體液的同名項目走各自的對應表）
    const IGNORE = ['HCT', 'Hct', 'MCH', 'MCHC', 'RDW-CV', 'PS', 'RBC', 'Sugar',
        'Auer body', 'Others', 'Reference Comment'];

    const RARE_DIFF = ['Blast', 'Promyl.', 'Myelo.', 'Meta', 'Aty.Lym.', 'PlasmaCell', 'Normobl.'];

    // Hemogram 與感染指標一起看：WBC(Seg) Hb(MCV) Plt CRP PCT
    const HEMOGRAM_MAIN = ['WBC', 'Hb', 'Plt', 'CRP', 'PCT'];
    // 差別計數（Seg 已附在 WBC 後面，這裡放其餘的）獨立成一段
    const HEMOGRAM_EXT = ['Band', 'Eos.', 'Baso.', 'Lym.', 'Mono.'];
    const LIVER = ['ALT', 'AST', 'ALP', 'T-Bil', 'D-Bil', 'GGT', 'Alb', 'TP', 'NH3'];
    const RENAL = ['BUN', 'CRE', 'eGFR', 'UA'];
    const ELECTROLYTES = ['Na', 'K', 'Cl', 'Ca', 'P', 'Mg'];
    const CARDIAC = ['CK', 'CK-MB', 'TnT', 'NT-proBNP', 'BNP'];
    const LIPID = ['T-CHO', 'TG', 'LDL-C', 'HDL-C'];
    const TUMOR_MARKER = ['CgA', 'CEA', 'CA19-9', 'AFP', 'PSA', 'CA-125', 'CA15-3', 'SCC', 'NSE'];
    const SEROLOGY = ['HBsAg', 'Anti-HBs', 'Anti-HCV', 'HIV', 'VDRL'];
    const THYROID = ['TSH', 'Free T4', 'T4', 'T3'];
    const OTHERS = ['Glucose', 'HbA1c', 'LDH', 'AMY', 'Lip', 'VIT. B12', 'Folic Acid', 'LA'];
    // VBG 的 PO2 沒有臨床意義，只有 ABG 才看；LA 併進氣體分析一起呈現
    const VGAS_ORDER = ['pH', 'PCO2', 'HCO3', 'BE', 'LA'];
    const AGAS_ORDER = ['pH', 'PCO2', 'PO2', 'HCO3', 'BE', 'SO2', 'FiO2', 'LA'];
    const COAG = ['PT', 'INR', 'aPTT', 'PTT', 'D-dimer', 'Fibrinogen'];
    const STOOL_ORDER = ['WBC', 'RBC', 'OB'];

    // 只會出現在血氣報告的項目名（血液生化單不會有這些）
    const GAS_ITEM_NAMES = ['PH', 'pH', 'PCO2', 'pCO2', 'PO2', 'pO2',
        'HCO3', 'HCO3-', 'BaseExcess', 'Base Excess', 'BE'];

    // 血氧分析：動脈（機器直讀）與靜脈（生化機）項目名寫法不同
    const GAS_NAME_MAP = {
        'PH': 'pH', 'pH': 'pH', 'pCO2': 'PCO2', 'PCO2': 'PCO2',
        'pO2': 'PO2', 'PO2': 'PO2', 'HCO3-': 'HCO3', 'HCO3': 'HCO3',
        'Base Excess': 'BE', 'BaseExcess': 'BE', 'BE': 'BE',
        'LacticAcid': 'LA', 'Lactate': 'LA',
        'Cl-': 'Cl', 'K+': 'K', 'Na+': 'Na', 'Free Ca2+': 'iCa',
        'Hb': 'Hb', 'FiO2': 'FiO2', 'SO2': 'SO2', 'Glucose': 'Glucose',
    };
    const FLUID_ORDER = ['TNC', 'RBC', 'Neu%', 'Lym%', 'Meso%', 'Eos%', 'Alb', 'TP', 'Glucose', 'LDH', 'AMY', 'Adequacy', 'Cytology'];

    const CULTURE_KEYS = ["Gram's", 'ID+DS', 'Anaerobic', 'ID C.', 'ID Campy.',
        'Blood Culture',
        'VRE screening', 'CRE screening', 'MRSA screening', 'CRAB screening',
        'CMV viral load', 'Aspergillus Ag', 'EBV viral load',
        'Fungus', 'AFS+Culture', 'AFS +Culture',
        'SARS-CoV-2 Antigen', 'Influenza A+B'];

    const SPECIAL_CULTURE_MAP = {
        'CMV': 'CMV', 'EBV': 'EBV', 'Aspergillus': 'Aspergillus Ag',
        'AFS': 'AFS', 'Fungus': 'Fungus',
        'SARS-CoV-2 Antigen': 'SARS-CoV-2', 'Influenza A+B': 'Influenza A+B',
    };

    const PCR_MAP = {
        'SARS-CoV-2 RNA PCR': 'COVID PCR',
        'Influenza A RT-PCR Detection': 'Influenza A PCR',
        'Influenza B RT-PCR Detection': 'Influenza B PCR',
        'RSV RT-PCR Detection': 'RSV PCR',
    };

    // 血液分組的唯一來源：formatTrend 依這張表產生段落，
    // 「有沒有被任何一組收走」也依這張表判斷，兩邊不會再各寫一份而走鐘。
    const BLOOD_GROUPS = [
        ['Hemogram', HEMOGRAM_MAIN, []],
        ['DC', HEMOGRAM_EXT, RARE_DIFF],
        ['Liver', LIVER, []],
        ['Renal', RENAL, []],
        ['Electrolytes', ELECTROLYTES, []],
        ['Cardiac', CARDIAC, []],
        ['Coagulation', COAG, []],
        ['Lipid', LIPID, []],
        ['Tumor marker', TUMOR_MARKER, []],
        ['Thyroid', THYROID, []],
        ['Serology', SEROLOGY, []],
    ];

    const ATTACH = { WBC: 'Seg', Hb: 'MCV', CRE: 'eGFR' };
    const ATTACHED = new Set(['Seg', 'MCV', 'eGFR']);

    const HEMO_EXT_RANGE = {
        'Eos.': [0, 8], 'Baso.': [0, 2], 'Band': [0, 5],
        'Lym.': [20, 45], 'Mono.': [2, 10],
    };

    const URINE_ALWAYS_SHOW = ['RBC', 'WBC', 'Bac', 'U-Cre', 'U-UN', 'U-Na'];

    // CSF：顯示順序（未列到的項目接在後面）
    const CSF_ORDER = ['WBC', 'L/N', 'RBC', 'TP', 'Glucose', 'Lactate', 'LDH', 'ADA'];
    const CSF_NAME_MAP = {
        'WBC': 'WBC', 'RBC': 'RBC', 'L/N': 'L/N',
        'TP(CSF)': 'TP', 'Glucose(CSF)': 'Glucose',
        'Lactate(CSF)': 'Lactate', 'LDH(CSF)': 'LDH', 'ADA(CSF)': 'ADA',
    };

    // 同一個檢驗在不同科室（HE / LH / WB / RL…）名稱不同，一律正規化成同一個顯示名，
    // 名稱直接用縮寫，表格才不會被撐寬。
    const NAME_MAP = {
        // CBC：HE 科室的短名 + LH 科室的中英混寫
        'HB': 'Hb', 'Hb': 'Hb', 'Hgb 血紅素': 'Hb',
        'PLT': 'Plt', 'Platelet 血小板': 'Plt',
        'WBC': 'WBC', 'W.B.C 白血球': 'WBC',
        'MCV': 'MCV', 'MCV平均血球體積': 'MCV',
        'R.B.C 紅血球': 'RBC', 'Hct 血球比容積': 'HCT',
        'MCH平均血球血紅素': 'MCH', 'MCHC平均血色素比容積': 'MCHC',
        // DC：HE 用縮寫、LH 用全名
        'Seg': 'Seg', 'Neutrophil': 'Seg',
        'Eos.': 'Eos.', 'Eosinophil': 'Eos.',
        'Baso.': 'Baso.', 'Basophil': 'Baso.',
        'Band': 'Band', 'Band neutrophil': 'Band',
        'Lym.': 'Lym.', 'Lymphocyte': 'Lym.',
        'Mono': 'Mono.', 'Mono.': 'Mono.', 'Monocyte': 'Mono.',
        'Promyl.': 'Promyl.', 'Promyelocyte': 'Promyl.',
        'Myelo.': 'Myelo.', 'Myelocyte': 'Myelo.',
        'Meta': 'Meta', 'Metamyelocyte': 'Meta',
        'Aty.Lym.': 'Aty.Lym.', 'Aty.Lymphocyte': 'Aty.Lym.',
        'PlasmaCell': 'PlasmaCell', 'Plasma Cell': 'PlasmaCell',
        'Normobl.': 'Normobl.', 'Normoblast': 'Normobl.',
        // 生化
        'Alb': 'Alb', 'ALB': 'Alb', 'Albumin': 'Alb',
        'T-BIL': 'T-Bil', 'D-BIL': 'D-Bil',
        'AST': 'AST', 'ALT': 'ALT', 'ALP': 'ALP',
        'UN': 'BUN', 'BUN': 'BUN', 'CRE': 'CRE', 'UA': 'UA',
        // LU 科室（新竹）用英文全名，非中文問題，需列舉
        'Creatinine': 'CRE', 'Uric Acid': 'UA', 'RDW-CV': 'RDW', 'RDW': 'RDW',
        'Na': 'Na', 'K': 'K', 'Mg': 'Mg', 'Ca': 'Ca', 'P': 'P', 'Cl': 'Cl',
        'CRP': 'CRP', 'hsCRP': 'CRP',
        'Procalcitonin': 'PCT',
        'LacticAcid': 'LA', 'Lactate': 'LA',
        'pH': 'pH', 'pCO2': 'PCO2', 'pO2': 'PO2',
        'HCO3-': 'HCO3', 'Base Excess': 'BE',
        'HbA1c': 'HbA1c', 'HbA1c糖化血色素': 'HbA1c',
        'GLU AC': 'Glucose', 'Glucose': 'Glucose', 'Sugar': 'Glucose',
        'NT-pro BNP': 'NT-proBNP', 'BNP': 'BNP',
        'PT': 'PT', 'PT INR': 'INR', 'PTT': 'PTT',
        'D-dimer': 'D-dimer', 'Fibrinogen': 'Fibrinogen',
        'aPTT': 'aPTT',
        'Ammonia N': 'NH3', 'Ammonia': 'NH3',
        'CK': 'CK', 'CK-MB': 'CK-MB', 'Troponin-T': 'TnT', 'Troponin-I': 'TnI',
        'TP': 'TP', 'LDH': 'LDH', 'AMY': 'AMY', 'Amylase': 'AMY',
        'Lipase': 'Lip', 'GGT': 'GGT',
        'T-CHO': 'T-CHO', 'TG': 'TG', 'LDL-C': 'LDL-C', 'HDL-C': 'HDL-C',
        // 腫瘤標記
        'Chromogranin A': 'CgA', 'CEA': 'CEA', 'AFP': 'AFP', 'PSA': 'PSA',
        'CA19-9': 'CA19-9', 'CA-125': 'CA-125', 'CA15-3': 'CA15-3',
        // 甲狀腺
        'hsTSH': 'TSH', 'TSH': 'TSH', 'Free T4': 'Free T4', 'T4': 'T4', 'T3': 'T3',
        // 血清學（B/C 肝、HIV、梅毒）
        'HBsAg': 'HBsAg', 'Anti-HBs': 'Anti-HBs', 'Anti-HCV Ab': 'Anti-HCV',
        'Anti-HCV': 'Anti-HCV',
        'HIV Ag/Ab Combo -for screening test': 'HIV', 'HIV Ag/Ab Combo': 'HIV',
        'S.T.S.': 'VDRL',
    };

    const URINE_NAME_MAP = {
        'Protein(Dipstick)': 'Protein', 'Protein(C)': 'Protein',
        'Glu.(Dipstick)': 'Glucose', 'Glu.(C)': 'Glucose',
        'Ketone(Dipstick)': 'Ketone', 'Ketones(C)': 'Ketone',
        'O.B.(Dipstick)': 'OB', 'O.B.(C)': 'OB',
        'Urobil.(Dipstick)': 'Urobilinogen', 'Urobil.(C)': 'Urobilinogen',
        'Bil.(Dipstick)': 'Bil', 'Bil.(C)': 'Bil',   // 與 URINE_PLAIN_MAP 的 'Bilirubin':'Bil' 統一，
        // 否則同一個項目在總院顯示 Bilirubin、新竹顯示 Bil，兩院資料並存時會變成兩列
        'Nitrite(Dipstick)': 'Nitrite', 'Nitrite(C)': 'Nitrite',
        'WBC esterase (Dipstick)': 'Esterase', 'Leukocyte esterase': 'Esterase',
        'RBC (Sediment)': 'RBC', 'RBC(S)': 'RBC',
        'WBC (Sediment)': 'WBC', 'WBC(S)': 'WBC',
        'Epith. (Sediment)': 'Epi', 'EpithCell(S)': 'Epi',
        'Cast (Sediment)': 'Cast', 'Cast(S)': 'Cast',
        'Crystal (Sediment)': 'Crystal', 'Crystal(S)': 'Crystal',
        'Bacteria (Sediment)': 'Bac', 'Others (Sediment)': 'Others', 'Others(S)': 'Others',
        'Sp. Gr.(Dipstick)': 'Sp.Gr.', 'Sp. Gr.(C)': 'Sp.Gr.',
        'pH(Dipstick)': 'pH', 'pH(C)': 'pH',
        'Alb.(Dipstick)': 'Albumin', 'Albumin(Dipstick)': 'Albumin',
        'Creatinine(Dipstick)': 'Creatinine',
        'Alb./Cre.(Dipstick)': 'ACR', 'Albumin/Creatinine(Dipstick)': 'ACR',
        // LO 科室（新竹）用英文全名，非中文問題，需列舉
        'Epithelial cell': 'Epi', 'Albumin/CREA Ratio(Dipstick)': 'ACR',
    };

    // 註：尿液 dipstick 的白蛋白/肌酸酐/ACR 原本整組濾掉，2026-09-10 起保留——
    // 蛋白尿定量在腎功能追蹤是實用資訊。（新竹本來就因為名稱不同而濾不到，
    // 與其讓兩院輸出不一致，不如兩邊都顯示。）故此處不再有排除清單。

    // 舊式尿液鏡檢（M6 科室）：項目名沒有 (Dipstick)/(Sediment) 後綴，
    // 且 Protein / Glucose / Blood / Bacteria 這些名字和血液項目撞名，
    // 所以只在「檢體是尿液」時才套用這張表。
    const URINE_PLAIN_MAP = {
        'WBC/HPF': 'WBC', 'RBC/HPF': 'RBC', 'Epi Cell/HPF': 'Epi',
        'Bacteria': 'Bac', 'RBC(morphology)': 'RBC morph',
        'Urobilinogen': 'Urobilinogen', 'PH': 'pH', 'pH': 'pH',
        'Ketone': 'Ketone', 'Others': 'Others', 'Blood': 'OB',
        'Bilirubin': 'Bil', 'Crystals': 'Crystal', 'Crystal': 'Crystal',
        'Protein': 'Protein', 'Glucose': 'Glucose', 'Cast': 'Cast',
        'Nitrite': 'Nitrite', 'Sp. Gr.': 'Sp.Gr.',
    };

    // 尿液項目名同樣有分院的中英混寫（「Protein 蛋白質(Dipstick)」「R.B.C 紅血球」
    // 「Creatinine肌酸酐(Dipstick)」）。尿液走的是自己的對照表、不經過 normalizeName，
    // 所以這裡要各自建一份正規化索引，否則中文會原樣進表頭把欄寬撐爆。
    // 查表順序沿用原本的 URINE_NAME_MAP → CHEM → PLAIN。
    function buildKeyIndex(...maps) {
        const idx = {};
        for (const m of maps) {
            for (const [k, v] of Object.entries(m)) {
                const kk = nameKey(k);
                if (kk && !(kk in idx)) idx[kk] = v;
            }
        }
        return idx;
    }

    // 尿液生化（算 FeNa / FeUrea 用），跟血中同名，一樣只在尿液檢體套用
    const URINE_CHEM_MAP = {
        'CRE(U)': 'U-Cre', 'UN(U)': 'U-UN', 'Na(U)': 'U-Na',
        'K(U)': 'U-K', 'Cl(U)': 'U-Cl', 'Osm(U)': 'U-Osm',
        'TP(U)': 'U-TP', 'Alb(U)': 'U-Alb',
    };

    function normalizeUrineName(rawName, cleanName) {
        return URINE_NAME_MAP[rawName] || URINE_CHEM_MAP[rawName]
            || URINE_PLAIN_MAP[rawName] || URINE_PLAIN_MAP[cleanName]
            || URINE_MAP_BY_KEY[nameKey(rawName)]
            // 沒登錄過的項目就用原名，不要丟掉（不然會不知道漏了什麼），但中文要先砍掉
            || stripCJK(cleanName) || cleanName;
    }

    const STOOL_NAME_MAP = {
        'Stool WBC': 'WBC', 'Stool RBC': 'RBC', 'Occult Blood': 'OB',
        'Occult blood': 'OB',
    };

    // 腹水 / 胸水 / 其他體液
    const FLUID_NAME_MAP = {
        'Total nucleated cells': 'TNC', 'RBC count': 'RBC',
        'Sediment-Neu': 'Neu%', 'Sediment-Lym': 'Lym%',
        'Sediment-Mesothelial cell & Histiocyte': 'Meso%',
        'Sediment-Eosin': 'Eos%', 'Sediment-Note': '__SKIP__',
        'ALB': 'Alb', 'Alb': 'Alb', 'TP': 'TP', 'Glucose': 'Glucose',
        'LDH': 'LDH', 'AMY': 'AMY', 'Amylase': 'AMY',
        'Specimen Adequacy': 'Adequacy',
    };

    // ── 名稱正規化索引：所有對照表集中在這裡建，確保在任何 map 定義之後 ──
    // 每一種檢體都有自己的對照表，但**中英混寫是全院區共通的問題**，
    // 所以每張表都要有正規化索引 + 去中文 fallback，不能只修其中一條路徑。
    const NAME_MAP_BY_KEY  = buildKeyIndex(NAME_MAP);
    const URINE_MAP_BY_KEY = buildKeyIndex(URINE_NAME_MAP, URINE_CHEM_MAP, URINE_PLAIN_MAP);
    const GAS_MAP_BY_KEY   = buildKeyIndex(GAS_NAME_MAP);
    const CSF_MAP_BY_KEY   = buildKeyIndex(CSF_NAME_MAP);
    const STOOL_MAP_BY_KEY = buildKeyIndex(STOOL_NAME_MAP);
    const FLUID_MAP_BY_KEY = buildKeyIndex(FLUID_NAME_MAP);

    // 通用解析：直接比對 → 去括號比對 → 正規化鍵 → 去中文的原名（保底，不丟資料）
    function lookupName(rawName, cleanName, direct, byKey) {
        return direct[rawName] || direct[cleanName]
            || byKey[nameKey(rawName)]
            || stripCJK(cleanName) || cleanName;
    }

    // 文字結果的縮寫（不只項目名，值也要縮）
    const VALUE_ABBR = [
        [/^Negative$/i, 'Neg'],
        [/^Positive$/i, 'Pos'],
        [/^Non-Reactive$/i, 'NR'],
        [/^Reactive$/i, 'R'],
        [/^Not Detected$/i, 'Neg'],
        [/^Not found$/i, 'Neg'],
        [/^Satisfactory for evaluation$/i, 'Satisfactory'],
        [/^Negative for malignant cells$/i, 'Neg for malignancy'],
        [/^Suspicious for malignant cells$/i, 'Suspicious'],
        [/^Positive for malignant cells$/i, 'Malignant cells (+)'],
        [/^Normal$/i, 'Nl'],
        [/Yeast-like organism/i, 'Yeast'],
        [/Gram pos\. coccus/i, 'GPC'],
        [/Gram neg\. bacill(i|us)/i, 'GNB'],
        [/Gram pos\. bacill(i|us)/i, 'GPB'],
        [/Gram neg\. coccus/i, 'GNC'],
        [/Renal tubular epithelium/i, 'RTE'],
        [/Squamous epithelial cells?/i, 'Squam. epi'],
    ];

    function abbrValue(val) {
        if (!val) return val;
        let v = val;
        for (const [re, short] of VALUE_ABBR) {
            if (re.test(v)) v = v.replace(re, short);
        }
        return v;
    }

    // 檢體種類：決定這張表的每一列要走哪一組規則。
    // 舊版只看項目名，所以尿液的 PH 會被當成血氧分析的 pH、尿液 CRE(U) 會蓋掉血中 CRE。
    function specimenClass(headerText) {
        // 表頭的分隔可能是 &nbsp; 或連續空白，先壓成單一空格再比對，
        // 不然 /Venous Blood/ 這種字面空格會比不到
        const h = (headerText || '').replace(/\s+/g, ' ');
        if (/Arterial\s+Blood/i.test(h)) return 'agas';
        if (/Venous\s+Blood|Capillary\s+Blood/i.test(h)) return 'vgas';
        if (/C\.\s*S\.\s*F\.|\bCSF\b/i.test(h)) return 'csf';
        if (/URINE/i.test(h)) return 'urine';
        if (/STOOL|FECES/i.test(h)) return 'stool';
        if (/ASCITES|PLEURAL|PERICARDIAL|PERITONEAL|SYNOVIAL|EFFUSION|BILE|PUS|DRAINAGE/i.test(h)) return 'fluid';
        return 'blood';
    }

    // 體液的分組標題直接用檢體名（ASCITES → Ascites）
    function fluidGroupName(headerText) {
        const m = (headerText || '').replace(/\s+/g, ' ')
            .match(/(ASCITES|PLEURAL EFFUSION|PLEURAL|PERICARDIAL|PERITONEAL|SYNOVIAL|BILE|PUS|DRAINAGE)/i);
        if (!m) return 'Body fluid';
        const raw = m[1].toLowerCase();
        return raw.charAt(0).toUpperCase() + raw.slice(1);
    }

    const SKIP_KEYWORDS = [
        '檢驗項目', '計算', '採檢', '登入', '最後', '本尿',
        'High >', 'Low <', 'Average', '七日',
        'BLOOD', 'Peripheral', 'URINE', 'OTHER',
        'Venous', 'Catheter', 'Random', 'RANDOM',
        'Special Instructions',
        'RH', 'ABO Typing', 'antibody screen',
        'Reference Comment',
    ];

    // 「整列名稱剛好等於」才濾掉的項目。SKIP_KEYWORDS 是子字串比對，
    // 像 'Others' 這種通用字放進去會誤殺任何含該字的項目名，故獨立一組精確比對。
    //   Others / Auto DC：新竹 LU 科室 CBC 的末列，只是註記「這份 DC 由儀器自動判讀」，
    //   不是檢驗值，會多佔一個欄位。
    const SKIP_EXACT = new Set(['Others']);

    function shouldSkipRow(rawName) {
        const n = String(rawName || '').trim();
        if (!n) return true;
        if (SKIP_EXACT.has(n)) return true;
        return SKIP_KEYWORDS.some((kw) => n.indexOf(kw) > -1);
    }

    const GENUS_ABBR = [
        'Enterococcus', 'Staphylococcus', 'Streptococcus', 'Klebsiella',
        'Pseudomonas', 'Escherichia', 'Acinetobacter', 'Stenotrophomonas',
        'Bacteroides', 'Eggerthella', 'Eubacterium', 'Clostridioides',
        'Candida', 'Serratia', 'Proteus', 'Citrobacter', 'Morganella',
    ];

    const COMPLEX_ABBR = { 'Enterobacter cloacae complex': 'ECC' };

    function abbrGenus(text) {
        for (const [full, abbr] of Object.entries(COMPLEX_ABBR)) {
            if (text.indexOf(full) > -1) text = text.split(full).join(abbr);
        }
        for (const g of GENUS_ABBR) {
            if (text.indexOf(g) > -1) text = text.split(g).join(g.charAt(0) + '.');
        }
        return text;
    }

    // ====== 工具函式 ======

    function normalizeName(raw) {
        // WB 科室寫成 eGFR(MDRD)（沒空格），舊版只比對有空格的字串，
        // 結果 MDRD 值先卡位、CKD-EPI 就被丟掉了
        if (/eGFR\s*\(MDRD\)/i.test(raw)) return '__SKIP__';
        if (/eGFR\s*\(CKD-EPI\)/i.test(raw)) return 'eGFR';
        const clean = raw.replace(/\(.*?\)/g, '').trim();
        if (NAME_MAP[raw]) return NAME_MAP[raw];
        if (NAME_MAP[clean]) return NAME_MAP[clean];
        const byKey = NAME_MAP_BY_KEY[nameKey(raw)];
        if (byKey) return byKey;
        // 表裡沒有對應時，至少要把中文拿掉再顯示，別讓中英混寫撐爆欄寬
        return stripCJK(clean) || clean;
    }

    function parseGreenItemName(raw) {
        return raw.replace(/\(.*?\)/g, '').trim();
    }

    function cleanGreenValue(val) {
        // 值裡面的換行/連續空白（例如 Ca 1.54 跟 (危) 分屬不同節點）壓成單一空格，
        // 不然整欄會被撐開
        return val.replace(/\(Manual\s*checked\)/i, '').replace(/\(Manual\)/i, '')
            .replace(/\s+/g, ' ').trim();
    }

    function isUrineAbnormal(val) {
        if (!val || val === '-') return false;
        if (val.startsWith('≦') || val.startsWith('≤')) return false;
        if (/^(normal|negative|neg|nil|none|0)$/i.test(val.trim())) return false;
        if (val.toLowerCase().startsWith('normal')) return false;
        if (/\([0-9]*\+*\)/.test(val.replace(/\s+/g, ''))) return true;   // (2+) / ( +++ )
        if (/^[0-9]*\+$/.test(val)) return true;
        if (/^\++$/.test(val.replace(/[\s()]/g, ''))) return true;
        if (val.startsWith('≧') || val.startsWith('>=')) return true;
        if (/numerous|many|packed|gross/i.test(val)) return true;
        // 「Gr(3-5)」「Yeast(2+)」「Renal tubular epithelium(+)」等文字描述
        if (/[A-Za-z]/.test(val) && !/^(neg|nl|nr)$/i.test(val)) return true;
        return false;
    }

    // ( +++ ) → 3+；Protein 100 (2+) → 2+
    function displayUrineVal(val) {
        const compact = val.replace(/\s+/g, '');
        const pm = compact.match(/\(([0-9]+\+)\)/);
        if (pm) return pm[1];
        const plus = compact.match(/^\(?(\++)\)?$/);
        if (plus) return plus[1].length + '+';
        const tail = compact.match(/^\((\++)\)-(.+)$/);   // ( + )-Granular / ( +++ )-300 mg/dl
        if (tail) {
            const grade = tail[1].length + '+';
            // 後面只是把 + 號換算成數值（300 mg/dl），沒有額外資訊就不留
            return /^[0-9.]+(mg\/d[lL]|mg\/L|\/HPF)?$/.test(tail[2]) ? grade : grade + ' ' + tail[2];
        }
        return val.replace(/\s+/g, ' ').trim();
    }

    // 每個值的單位與參考範圍。判讀模式要靠它算正常/偏高/偏低，但趨勢與表格
    // 兩種呈現完全用不到——所以**不改 store 的值形狀**（仍是字串），而是掛一份
    // 平行的 meta，既有格式化程式碼一行都不必動。
    // 結構：STORE_META.get(store)[name][idx] = { unit, ref }
    const STORE_META = new WeakMap();
    function setStoreMeta(store, name, idx, meta) {
        if (!meta || (!meta.unit && !meta.ref)) return;
        let m = STORE_META.get(store);
        if (!m) { m = {}; STORE_META.set(store, m); }
        if (!m[name]) m[name] = [];
        m[name][idx] = meta;
    }
    function getStoreMeta(store, name, idx) {
        return STORE_META.get(store)?.[name]?.[idx] || null;
    }

    // 從一列的 td 取單位（cells[2]）與參考值（cells[3]）
    function rowMeta(cells) {
        return {
            unit: cells[2] ? (cells[2].textContent || '').replace(/\s+/g, ' ').trim() : '',
            ref: cells[3] ? (cells[3].textContent || '').replace(/\s+/g, ' ').trim() : '',
        };
    }

    function pushToStore(store, name, idx, val, meta) {
        if (!store[name]) store[name] = [];
        while (store[name].length <= idx) store[name].push('');
        const isFirst = !store[name][idx];
        if (isFirst) store[name][idx] = val;
        // **meta 不綁「誰先寫到值」**。同一個項目在同一天可能出現在多張表，
        // 其中有些是精簡欄位（沒有單位/參考值欄）。若精簡的那張先寫到值，
        // 舊版會連帶跳過 meta，之後欄位完整的表因為值已存在而整筆不寫，
        // 參考值就永遠補不上——判讀整個失效的真正原因。
        // 改為：只要目前還沒有 meta，任何一次帶著 meta 的寫入都補上去。
        if (meta && (meta.unit || meta.ref)) {
            if (!getStoreMeta(store, name, idx)) setStoreMeta(store, name, idx, meta);
        }
    }

    function padData(dataMap, len) {
        for (const nm of Object.keys(dataMap)) {
            while (dataMap[nm].length < len) dataMap[nm].push('');
        }
    }

    // 列的鍵是「MM/DD HH:MM」：同一天抽兩次以上時才分得開，
    // 只有日期的舊格式（沒有時間）也吃得下
    function dayPart(key) {
        return String(key || '').split(' ')[0];
    }
    function timeValue(key) {
        const m = String(key || '').match(/(\d{1,2}):(\d{2})/);
        return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
    }
    function dateKeyOrder(key) {
        const [mo, dd] = dayPart(key).split('/').map(Number);
        return [mo || 0, dd || 0, timeValue(key)];
    }

    function sortByDate(dArr, dataMap) {
        if (dArr.length <= 1) return;
        const order = dArr.map((d, i) => i);
        order.sort((a, b) => {
            const ka = dateKeyOrder(dArr[a]);
            const kb = dateKeyOrder(dArr[b]);
            for (let i = 0; i < ka.length; i++) {
                if (ka[i] !== kb[i]) return ka[i] - kb[i];
            }
            return 0;
        });
        const sortedDates = order.map(i => dArr[i]);
        for (let i = 0; i < sortedDates.length; i++) dArr[i] = sortedDates[i];
        for (const nm of Object.keys(dataMap)) {
            const old = dataMap[nm].slice();
            for (let i = 0; i < order.length; i++) dataMap[nm][i] = old[order[i]] || '';
        }
    }

    function specimenLabel(headerText) {
        if (/BLOOD/i.test(headerText)) {
            const srcM = headerText.match(/BLOOD\s+(\S+)\s+採檢/);
            return 'B/C (' + (srcM ? srcM[1].toLowerCase() : 'blood') + ')';
        }
        if (/URINE/i.test(headerText)) {
            const srcM = headerText.match(/URINE\s+(.*?)\s+採檢/);
            let src = 'urine';
            if (srcM) {
                const s = srcM[1].toLowerCase();
                if (s.indexOf('void') > -1) src = 'void';
                else if (s.indexOf('cath') > -1) src = 'cath';
                else src = s;
            }
            return 'U/C (' + src + ')';
        }
        if (/SPUTUM/i.test(headerText)) return 'Spu/C';
        const specM = headerText.match(/No:\S+\s+(.*?)\s*採檢/);
        let specDesc = '';
        if (specM) {
            const raw = specM[1].trim();
            if (/[一-鿿]/.test(raw)) {
                specDesc = raw.replace(/^[A-Z()\s\/]+/, '').trim() || raw;
            } else {
                const words = raw.split(/\s+/).filter(w => /^[A-Z]+$/.test(w));
                const last = words.length ? words[words.length - 1] : raw.split(/\s+/)[0];
                specDesc = last.charAt(0).toUpperCase() + last.slice(1).toLowerCase();
            }
        }
        return specDesc ? specDesc + '/C' : 'Other/C';
    }

    function cultureKeysMatch(rawName) {
        const lower = rawName.toLowerCase();
        return CULTURE_KEYS.some(ck => lower.indexOf(ck.toLowerCase()) > -1);
    }

    // ====== 清單版 DOM 讀取 ======

    function getReportDocument() {
        const frame = document.getElementById('Reportifrm');
        if (!frame) return document;

        try {
            const reportDoc = frame.contentDocument;
            if (!reportDoc || reportDoc.readyState !== 'complete' || reportDoc.URL === 'about:blank' || !reportDoc.body) {
                return null;
            }
            return reportDoc;
        } catch (e) {
            return null;
        }
    }

    function readListView(reportDoc, view) {
        const tables = reportDoc.querySelectorAll('table.DetailedSheet');
        if (!tables.length) return null;

        const dates = [];
        const trendData = {};
        const urineData = {};
        const urineDates = [];
        const aGasData = {};
        const aGasDates = [];
        const vGasData = {};
        const vGasDates = [];
        const csfData = {};
        const csfDates = [];
        const stoolData = {};
        const stoolDates = [];
        const fluidGroups = {};
        const cultureItems = [];
        const structuredCultures = [];
        let collectDate = '';   // MM/DD HH:MM，同日多次抽血要分得開
        let collectDay = '';    // MM/DD，培養報告用
        let headerText = '';

        const AGAS_SKIP = ['Hct'];

        tables.forEach(table => {
            let prev = table.previousElementSibling;
            while (prev && prev.tagName !== 'TABLE') {
                const txt = prev.textContent || '';
                const dm = txt.match(/採檢:(\d{4})\/(\d{2})\/(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
                if (dm) {
                    collectDay = dm[2] + '/' + dm[3];
                    collectDate = collectDay + (dm[4] ? ' ' + ('0' + dm[4]).slice(-2) + ':' + dm[5] : '');
                    headerText = txt;
                    break;
                }
                prev = prev.previousElementSibling;
            }

            const sClass = specimenClass(headerText);

            if (sClass === 'agas') {
                if (!aGasDates.includes(collectDate)) aGasDates.push(collectDate);
                const gDateIdx = aGasDates.indexOf(collectDate);

                const rows = table.querySelectorAll('tr');
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length < 2) return;
                    const rawName = (cells[0].textContent || '').trim();
                    const rawVal = (cells[1].textContent || '').trim();
                    if (!rawName || !rawVal) return;
                    if (shouldSkipRow(rawName)) return;
                    const cleanName = parseGreenItemName(rawName);
                    if (AGAS_SKIP.includes(cleanName) || IGNORE.includes(cleanName)) return;
                    const gasName = lookupName(rawName, cleanName, GAS_NAME_MAP, GAS_MAP_BY_KEY);
                    pushToStore(aGasData, gasName, gDateIdx, cleanGreenValue(rawVal), rowMeta(cells));
                });
                return;
            }

            if (collectDate && !dates.includes(collectDate)) dates.push(collectDate);
            const dateIdx = dates.indexOf(collectDate);

            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length < 2) return;

                const rawName = (cells[0].textContent || '').trim();
                const rawVal = (cells[1].textContent || '').trim();

                if (!rawName || !rawVal) return;
                if (/^\d{2}:\d{2}/.test(rawName)) return;
                if (shouldSkipRow(rawName)) return;

                const cleanName = parseGreenItemName(rawName);

                // CSF 檢體：獨立分組，不套用 IGNORE / 血液項目對應
                if (sClass === 'csf' && !cultureKeysMatch(rawName)) {
                    const csfName = lookupName(rawName, cleanName, CSF_NAME_MAP, CSF_MAP_BY_KEY);
                    if (!csfName) return;
                    if (!csfDates.includes(collectDate)) csfDates.push(collectDate);
                    pushToStore(csfData, csfName, csfDates.indexOf(collectDate), cleanGreenValue(rawVal), rowMeta(cells));
                    return;
                }

                const val = cleanGreenValue(rawVal);

                if (cultureKeysMatch(rawName)) {
                    if (/Epithelial cell|PMN/i.test(val)) return;
                    if (/No bacteria visible/i.test(val)) return;
                    // 結果和參考值一樣（例：No Salmonella & Shigella）也算陰性
                    const refCell = cells[3] ? (cells[3].textContent || '').trim() : '';
                    const flat = (s) => s.replace(/\s+/g, '').toLowerCase();
                    const isNeg = /no growth|no aerobic\s+pathogen|no anaerobic\s+pathogen|^Undetectable$|^Negative$|^No Fungus$/i.test(val)
                        || /^No\s/i.test(val)
                        || (!!refCell && flat(val) === flat(refCell));
                    const remark = cells[4] ? (cells[4].textContent || '').trim() : '';
                    let cResult = isNeg ? '-' : abbrValue(val.replace(/Multiple colonial morphotypes present[;,]\s*/i, ''));
                    if (!isNeg && remark) {
                        const rMap = {
                            'Carbapenem-resistant': 'CR', 'ESBL': 'ESBL',
                            'MRSA': 'MRSA', 'VRE': 'VRE', 'MDR': 'MDR',
                        };
                        for (const [pattern, abbr] of Object.entries(rMap)) {
                            if (remark.indexOf(pattern) > -1) { cResult += ' (' + abbr + ')'; break; }
                        }
                    }
                    let specialMatched = false;
                    for (const [key, label] of Object.entries(SPECIAL_CULTURE_MAP)) {
                        if (rawName.toLowerCase().indexOf(key.toLowerCase()) > -1) {
                            structuredCultures.push({ date: collectDay, label: label, result: cResult });
                            specialMatched = true;
                            break;
                        }
                    }
                    if (specialMatched) {
                        // handled above
                    } else if (/screening/i.test(rawName)) {
                        const scrType = rawName.match(/^(\S+)\s+screening/i);
                        const scrName = scrType ? scrType[1].toUpperCase() : rawName;
                        const scrRef = cells[3] ? (cells[3].textContent || '').trim() : '';
                        const scrNeg = (scrRef && val.toLowerCase() === scrRef.toLowerCase()) || /^No\s/i.test(val);
                        const specM2 = headerText.match(/No:\S+\s+(.*?)\s*採檢/);
                        let scrLabel = 'Swab';
                        if (specM2) {
                            const raw2 = specM2[1].trim();
                            const words2 = raw2.split(/\s+/).filter(w => /^[A-Z]+$/.test(w));
                            if (words2.length) scrLabel = words2[words2.length - 1].charAt(0).toUpperCase() + words2[words2.length - 1].slice(1).toLowerCase();
                        }
                        structuredCultures.push({ date: collectDay, label: scrLabel, result: scrName + ' (' + (scrNeg ? '-' : '+') + ')' });
                    } else if (/ID\+DS|ID C\.|ID Campy\.|^Anaerobic|^Gram's|^Blood Culture/i.test(rawName)) {
                        structuredCultures.push({ date: collectDay, label: specimenLabel(headerText), result: cResult });
                    } else {
                        cultureItems.push((collectDay ? '[' + collectDay + '] ' : '') + rawName + ': ' + val);
                    }
                    return;
                }

                const pcrName = PCR_MAP[rawName];
                if (pcrName) {
                    const pcrResult = (val === 'Not Detected' || val === 'Negative') ? '-' : '+';
                    cultureItems.push((collectDay ? '[' + collectDay + '] ' : '') + pcrName + ' ' + pcrResult);
                    return;
                }

                // 以下依「檢體種類」分流。舊版只看項目名，所以尿液的 PH 會被當成
                // 靜脈血氣的 pH、CRE(U)/UN(U) 會蓋掉血中 CRE/BUN。
                if (sClass === 'vgas') {
                    if (AGAS_SKIP.includes(cleanName)) return;
                    const gasName = lookupName(rawName, cleanName, GAS_NAME_MAP, GAS_MAP_BY_KEY);
                    if (!vGasDates.includes(collectDate)) vGasDates.push(collectDate);
                    pushToStore(vGasData, gasName, vGasDates.indexOf(collectDate), val, rowMeta(cells));
                    return;
                }

                if (sClass === 'urine') {
                    // 沒登錄過的項目就用原名，不要丟掉（不然會不知道漏了什麼）
                    const uName = normalizeUrineName(rawName, cleanName);
                    if (!uName) return;
                    if (!urineDates.includes(collectDate)) urineDates.push(collectDate);
                    pushToStore(urineData, uName, urineDates.indexOf(collectDate), abbrValue(val), rowMeta(cells));
                    return;
                }

                if (sClass === 'stool') {
                    const sName = lookupName(rawName, cleanName, STOOL_NAME_MAP, STOOL_MAP_BY_KEY);
                    if (!sName) return;
                    if (!stoolDates.includes(collectDate)) stoolDates.push(collectDate);
                    pushToStore(stoolData, sName, stoolDates.indexOf(collectDate), abbrValue(val), rowMeta(cells));
                    return;
                }

                if (sClass === 'fluid') {
                    const fName = FLUID_NAME_MAP[rawName] || FLUID_NAME_MAP[cleanName]
                        || FLUID_MAP_BY_KEY[nameKey(rawName)]
                        || (/Cytology/i.test(rawName) ? 'Cytology'
                            : (stripCJK(cleanName) || cleanName));
                    if (!fName || fName === '__SKIP__') return;
                    if (fName === 'Adequacy' && /satisfactory/i.test(val)) return;
                    if (/^N\/A$/i.test(val)) return;
                    const gName = fluidGroupName(headerText);
                    if (!fluidGroups[gName]) fluidGroups[gName] = { dates: [], data: {} };
                    const g = fluidGroups[gName];
                    if (!g.dates.includes(collectDate)) g.dates.push(collectDate);
                    pushToStore(g.data, fName, g.dates.indexOf(collectDate), abbrValue(val), rowMeta(cells));
                    return;
                }

                // 血液檢體。表頭寫法各院區不一致，萬一 Venous Blood 沒被認出來，
                // 就用項目名兜底當成靜脈血氣（尿液/糞便/體液前面已經分流掉，
                // 不會再發生尿液 PH 蓋掉血氣 pH 的事）；動脈血的表頭才會寫 Arterial。
                if (GAS_ITEM_NAMES.includes(rawName) || GAS_ITEM_NAMES.includes(cleanName)) {
                    const gasName = lookupName(rawName, cleanName, GAS_NAME_MAP, GAS_MAP_BY_KEY);
                    if (!vGasDates.includes(collectDate)) vGasDates.push(collectDate);
                    pushToStore(vGasData, gasName, vGasDates.indexOf(collectDate), val, rowMeta(cells));
                    return;
                }

                if (IGNORE.includes(cleanName)) return;
                const nm = normalizeName(rawName);
                if (nm === '__SKIP__' || IGNORE.includes(nm)) return;
                if (/^N\/A$/i.test(val)) return;

                const isG2 = RARE_DIFF.includes(nm);
                if (isG2 && (parseFloat(val) === 0 || !val)) return;

                pushToStore(trendData, nm, dateIdx, abbrValue(val), rowMeta(cells));
            });
        });

        if (!dates.length && !aGasDates.length && !vGasDates.length && !cultureItems.length && !structuredCultures.length) return null;

        // Lactate 是生化機驗的（跟血氣不同單），但臨床上要跟酸鹼一起看，
        // 所以把血液欄位裡的 LA 併進氣體分析那張表（有動脈血就掛動脈）。
        // 血氣機自己驗的 LA 留在該張氣體分析表（動脈就在動脈）；
        // 另外送檢驗科的 LacticAcid 一律掛到 VBG 欄位。
        // 同一天已有靜脈血氣、採檢時間又相近（90 分鐘內）就併到同一列，不另開一列。
        if (trendData.LA) {
            trendData.LA.forEach((v, i) => {
                if (!v) return;
                const dt = dates[i];
                let best = null;
                let bestGap = Infinity;
                vGasDates.forEach((k, ki) => {
                    if (dayPart(k) !== dayPart(dt)) return;
                    if (vGasData.LA && vGasData.LA[ki]) return;   // 該列已經有 LA 了
                    const ta = timeValue(k);
                    const tb = timeValue(dt);
                    const gap = (ta < 0 || tb < 0) ? 0 : Math.abs(ta - tb);
                    if (gap <= 90 && gap < bestGap) { best = k; bestGap = gap; }
                });
                if (!best) { best = dt; vGasDates.push(best); }
                // 值是從 trendData 搬過來的，meta 也要跟著搬，否則判讀模式會看不到 LA 的參考值
                pushToStore(vGasData, 'LA', vGasDates.indexOf(best), v, getStoreMeta(trendData, 'LA', i));
            });
            delete trendData.LA;
        }

        padData(trendData, dates.length);
        padData(urineData, urineDates.length);
        padData(csfData, csfDates.length);
        padData(stoolData, stoolDates.length);
        padData(aGasData, aGasDates.length);
        padData(vGasData, vGasDates.length);
        for (const g of Object.values(fluidGroups)) padData(g.data, g.dates.length);

        sortByDate(dates, trendData);
        sortByDate(aGasDates, aGasData);
        sortByDate(vGasDates, vGasData);
        sortByDate(urineDates, urineData);
        sortByDate(csfDates, csfData);
        sortByDate(stoolDates, stoolData);
        for (const g of Object.values(fluidGroups)) sortByDate(g.dates, g.data);

        const specialGroups = {};
        if (Object.keys(aGasData).length) {
            specialGroups['A gas'] = { dates: aGasDates, data: aGasData };
        }
        if (Object.keys(vGasData).length) {
            specialGroups['V gas'] = { dates: vGasDates, data: vGasData };
        }
        if (Object.keys(urineData).length) {
            specialGroups.Urine = { dates: urineDates, data: urineData };
        }
        if (Object.keys(stoolData).length) {
            specialGroups.Stool = { dates: stoolDates, data: stoolData };
        }
        for (const [gName, g] of Object.entries(fluidGroups)) {
            if (Object.keys(g.data).length) specialGroups[gName] = g;
        }
        if (Object.keys(csfData).length) {
            specialGroups.CSF = { dates: csfDates, data: csfData };
        }

        const cGroups = [];
        const cGroupMap = {};
        for (const c of structuredCultures) {
            const key = c.date + '||' + c.label;
            if (!cGroupMap[key]) {
                cGroupMap[key] = { date: c.date, label: c.label, results: [] };
                cGroups.push(cGroupMap[key]);
            }
            cGroupMap[key].results.push(c.result);
        }
        const cByDate = {};
        const cDateOrder = [];
        cGroups.sort((a, b) => {
            const [am, ad] = a.date.split('/').map(Number);
            const [bm, bd] = b.date.split('/').map(Number);
            return am !== bm ? am - bm : ad - bd;
        });
        for (const g of cGroups) {
            if (!cByDate[g.date]) { cByDate[g.date] = []; cDateOrder.push(g.date); }
            const allNeg = g.results.every(r => r === '-');
            const display = allNeg ? '-' : abbrGenus(g.results.filter(r => r !== '-').join('; '));
            cByDate[g.date].push(g.label + ': ' + display);
        }
        for (const dt of cDateOrder) {
            cultureItems.push('[' + dt + '] ' + cByDate[dt].join('\n[' + dt + '] '));
        }

        if (view === VIEW_INTERPRET) {
            const gasKind = Object.keys(aGasData).length ? 'agas' : 'vgas';
            const gasData = Object.keys(aGasData).length ? aGasData : vGasData;
            const gasDates = Object.keys(aGasData).length ? aGasDates : vGasDates;
            return buildInterpretView(dates, trendData, urineData, urineDates, gasData, gasDates, gasKind);
        }

        let result = formatTrend(dates, trendData, Object.keys(specialGroups).length ? specialGroups : null, view);
        if (cultureItems.length) {
            const sectionSep = getOutputPref() === OUTPUT_SPACIOUS ? '\n\n' : '\n';
            result = (result || '') + (result ? sectionSep : '') + '#. Culture:\n' + cultureItems.join('\n');
        }
        return result;
    }

    // ====== 綠單版 DOM 讀取 ======

    const GREEN_SECTION_MAP = {
        'Complete Blood Cell Count': 'CBC',
        'Blood Biochemistry': 'Biochemistry',
        'General BioChemistry': 'Biochemistry',
        'Coagulation Profile': 'Coagulation',
        'Blood Gas': 'Gas',
        'Urine examination': 'Urine',
        'Stool examination': 'Stool',
        'Punctate examination': 'Punctate',
    };

    function readGreenSheetView(reportDoc, view) {
        const fieldsets = reportDoc.querySelectorAll('fieldset');
        if (!fieldsets.length) return null;

        const dates = [];
        const data = {};
        const specialGroups = {};
        const groupOrder = [];
        let datesCollected = false;

        fieldsets.forEach(fs => {
            const legend = fs.querySelector('legend');
            if (!legend) return;
            const legendText = legend.textContent.trim();

            let sectionType = null;
            let specialName = null;
            for (const [keyword, type] of Object.entries(GREEN_SECTION_MAP)) {
                if (legendText.indexOf(keyword) > -1) {
                    sectionType = type;
                    if (['Urine', 'Stool'].includes(type)) {
                        specialName = type;
                    } else if (type === 'Punctate') {
                        const pm = legendText.match(/Punctate examination\s+(.*)/);
                        specialName = pm ? pm[1].trim() : 'Punctate';
                        if (/C\.\s*S\.\s*F\.|\bCSF\b/i.test(specialName)) specialName = 'CSF';
                    }
                    break;
                }
            }
            if (!sectionType) sectionType = 'Other';

            const tables = fs.querySelectorAll('table');
            tables.forEach(table => {
                const rows = table.querySelectorAll('tr');
                if (rows.length < 2) return;

                const headerCells = rows[0].querySelectorAll('td, th');
                if (headerCells.length < 2) return;

                const sectionDates = [];
                for (let j = 1; j < headerCells.length; j++) {
                    const txt = headerCells[j].textContent.trim();
                    const dm = txt.match(/\d{4}\/(\d{2})\/(\d{2})/);
                    sectionDates.push(dm ? dm[1] + '/' + dm[2] : '');
                }

                const isSpecial = specialName !== null;
                if (isSpecial) {
                    if (!specialGroups[specialName]) {
                        specialGroups[specialName] = { dates: sectionDates, data: {} };
                        groupOrder.push(specialName);
                    }
                } else if (!datesCollected) {
                    for (const d of sectionDates) dates.push(d);
                    datesCollected = true;
                }

                const targetData = isSpecial ? specialGroups[specialName].data : data;
                const targetDates = isSpecial ? specialGroups[specialName].dates : dates;

                for (let i = 1; i < rows.length; i++) {
                    const cells = rows[i].querySelectorAll('td, th');
                    if (cells.length < 2) continue;

                    const rawName = (cells[0].textContent || '').trim();
                    if (!rawName) continue;

                    if (/^\d{2}:\d{2}/.test(rawName)) continue;
                    if (shouldSkipRow(rawName)) continue;

                    const cleanName = parseGreenItemName(rawName);
                    if (IGNORE.includes(cleanName)) continue;

                    if (isSpecial && specialName === 'Urine') {
                        const uName = URINE_NAME_MAP[rawName] || URINE_NAME_MAP[cleanName]
                            || URINE_MAP_BY_KEY[nameKey(rawName)] || null;
                        if (!uName) continue;
                        const vals = [];
                        for (let j = 1; j < cells.length && j <= targetDates.length; j++) {
                            vals.push(cleanGreenValue(cells[j].textContent.trim()));
                        }
                        while (vals.length < targetDates.length) vals.push('');
                        if (!targetData[uName]) {
                            targetData[uName] = vals;
                        } else {
                            for (let j = 0; j < targetDates.length; j++) {
                                if (!targetData[uName][j] && vals[j]) targetData[uName][j] = vals[j];
                            }
                        }
                        continue;
                    }

                    const nm = normalizeName(rawName);
                    if (nm === '__SKIP__') continue;

                    const isG2 = RARE_DIFF.includes(nm);

                    const vals = [];
                    for (let j = 1; j < cells.length && j <= targetDates.length; j++) {
                        vals.push(cleanGreenValue(cells[j].textContent.trim()));
                    }
                    while (vals.length < targetDates.length) vals.push('');

                    if (isG2) {
                        const hasNonZero = vals.some(v => v && parseFloat(v) !== 0);
                        if (!hasNonZero) continue;
                    }

                    if (!targetData[nm]) {
                        targetData[nm] = vals;
                    } else {
                        for (let j = 0; j < targetDates.length; j++) {
                            if (!targetData[nm][j] && vals[j]) targetData[nm][j] = vals[j];
                        }
                    }
                }
            });
        });

        if (!dates.length && !Object.keys(specialGroups).length) return null;

        return formatTrend(dates, data, specialGroups, view);
    }

    // ====== 表格式趨勢格式化 ======

    const COL_GAP = 2;    // 欄與欄之間的空格數
    const MAX_COLS = 8;   // 單一表格最多幾欄，超過就再開一段表格（避免過寬）
    const EMPTY = '-';    // 該日無此項目時填的符號

    // 以顯示寬度計（中文/全形算 2 格），純 ASCII 算 1 格
    function dispWidth(s) {
        let w = 0;
        for (const ch of String(s)) {
            w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(ch) ? 2 : 1;
        }
        return w;
    }

    function padCell(s, w) {
        return s + ' '.repeat(Math.max(0, w - dispWidth(s)));
    }

    function fmtDateLabel(d) {
        return String(d || '');
    }

    // 該分組裡同一天只有一筆就只顯示 MM/DD，有兩筆以上才把時間帶出來，
    // 這樣常見的「一天抽一次」維持原本的緊湊樣子
    function rowLabelsFor(keys) {
        const perDay = {};
        for (const k of keys) {
            const d = dayPart(k);
            perDay[d] = (perDay[d] || 0) + 1;
        }
        return keys.map(k => (perDay[dayPart(k)] > 1 ? fmtDateLabel(k) : dayPart(k)));
    }

    // colNames: 欄位名陣列；rowLabels: 每列的日期；cells[列][欄]: 值
    function buildTable(title, colNames, rowLabels, cells) {
        if (!colNames.length || !rowLabels.length) return null;

        const labelW = Math.max(...rowLabels.map(dispWidth));
        const blocks = [];

        for (let start = 0; start < colNames.length; start += MAX_COLS) {
            const idx = [];
            for (let c = start; c < Math.min(start + MAX_COLS, colNames.length); c++) idx.push(c);

            // 欄位太多要換第二張表時，只列這幾欄真的有值的日期，
            // 不然第二張表會是一整片「-」
            const rowIdx = [];
            for (let r = 0; r < rowLabels.length; r++) {
                if (idx.some(c => cells[r][c] && cells[r][c] !== EMPTY)) rowIdx.push(r);
            }
            if (!rowIdx.length) continue;

            const colW = idx.map(c => Math.max(
                dispWidth(colNames[c]),
                ...rowIdx.map(r => dispWidth(cells[r][c]))
            ));

            const line = (label, get) => (
                padCell(label, labelW) +
                idx.map((c, k) => ' '.repeat(COL_GAP) + padCell(get(c), colW[k])).join('')
            ).replace(/\s+$/, '');

            const lines = [line('', c => colNames[c])];
            rowIdx.forEach(r => lines.push(line(rowLabels[r], c => cells[r][c])));
            blocks.push(lines.join('\n'));
        }
        if (!blocks.length) return null;

        const blockSep = getOutputPref() === OUTPUT_SPACIOUS ? '\n\n' : '\n';
        return (title ? title + '\n' : '') + blocks.join(blockSep);
    }

    function findActiveIdx(refDates, allKeys, dd2) {
        const activeIdx = [];
        for (let i = 0; i < refDates.length; i++) {
            for (const nm of allKeys) {
                if (dd2[nm] && dd2[nm][i]) { activeIdx.push(i); break; }
            }
        }
        return activeIdx;
    }

    // 值以 → 串接；中間有沒抽的日期就多一個箭頭表示間隔（段落模式用）
    function compactTrend(vals) {
        const filled = vals.filter(x => x);
        if (filled.length === 0) return null;
        if (filled.length === 1) return filled[0];
        const parts = [];
        for (let i = 0; i < vals.length; i++) {
            if (!vals[i]) continue;
            if (parts.length > 0) {
                const prevIdx = vals.lastIndexOf(parts[parts.length - 1].val, i - 1);
                const gap = i - prevIdx - 1;
                parts.push({ val: vals[i], arrow: '→'.repeat(gap + 1) });
            } else {
                parts.push({ val: vals[i], arrow: '' });
            }
        }
        return parts.map((p, i) => i === 0 ? p.val : p.arrow + p.val).join('');
    }

    // 兩種呈現共用同一套分組流程，差別只在「單一群組怎麼畫」：
    //   VIEW_TABLE → 日期為列、檢驗項目為欄的等寬對齊表格
    //   VIEW_TREND → 單行段落（原作者格式）
    // 分組清單與 #. 前綴都只寫一次。先前前綴由各群組自帶時，上游新加的 CSF
    // 分組就漏掉了前綴，集中處理可避免再發生。
    let __pnwCap = null;
    function formatTrend(dates, data, specialGroups, view) {
        __pnwCap = { dates, data, specialGroups };
        const isTable = view !== VIEW_TREND;
        const spacious = getOutputPref() === OUTPUT_SPACIOUS;
        const headingSep = spacious ? ':\n' : ': ';
        const sectionSep = spacious ? '\n\n' : '\n';

        function isAbnormal(nm, vals) {
            const range = HEMO_EXT_RANGE[nm];
            if (!range) return true;
            for (const v of vals) {
                if (!v) continue;
                const n = parseFloat(v);
                if (isNaN(n)) continue;
                if (n < range[0] || n > range[1]) return true;
            }
            return false;
        }

        function fmtItem(nm, dd2) {
            const v = dd2[nm];
            if (!v) return null;
            if (HEMO_EXT_RANGE[nm] && !isAbnormal(nm, v)) return null;
            const trend = compactTrend(v);
            if (!trend) return null;
            let s = nm + ' ' + trend;
            if (ATTACH[nm]) {
                const ank = ATTACH[nm];
                const av = dd2[ank];
                if (av) {
                    const aTrend = compactTrend(av);
                    if (aTrend) s += ' (' + ank + ' ' + aTrend + ')';
                }
            }
            return s;
        }

        function buildGroup(title, keys, extKeys, dt, customDates) {
            const dd2 = dt || data;
            const refDates = customDates || dates;
            const allKeys = [...keys, ...(extKeys || [])];
            const activeIdx = findActiveIdx(refDates, allKeys, dd2);
            if (!activeIdx.length) return null;

            if (!isTable) {
                const filtered = {};
                for (const nm of allKeys) {
                    if (!dd2[nm]) continue;
                    filtered[nm] = activeIdx.map(i => dd2[nm][i] || '');
                }
                const items = [];
                for (const nm of allKeys) {
                    if (ATTACHED.has(nm)) continue;
                    const s = fmtItem(nm, filtered);
                    if (s) items.push(s);
                }
                if (!items.length) return null;
                const gd = rowLabelsFor(activeIdx.map(i => refDates[i]));
                return title + ' [' + gd.join(', ') + ']' + headingSep + items.join(', ');
            }

            // 欄位順序：附屬項目（Seg / MCV / eGFR）緊接在主項目後面
            const colKeys = [];
            for (const nm of allKeys) {
                if (ATTACHED.has(nm)) continue;
                if (!colKeys.includes(nm)) colKeys.push(nm);
                const an = ATTACH[nm];
                if (an && !colKeys.includes(an)) colKeys.push(an);
            }

            const cols = colKeys.filter(nm => {
                const v = dd2[nm];
                if (!v) return false;
                if (!activeIdx.some(i => v[i])) return false;
                // Eos./Baso./Band/Lym./Mono. 全在正常範圍就不列
                if (HEMO_EXT_RANGE[nm] && !isAbnormal(nm, activeIdx.map(i => v[i]))) return false;
                return true;
            });
            if (!cols.length) return null;

            const rowLabels = rowLabelsFor(activeIdx.map(i => refDates[i]));
            const cells = activeIdx.map(i => cols.map(nm => dd2[nm][i] || EMPTY));
            return buildTable(title, cols, rowLabels, cells);
        }

        function buildUrine(sg) {
            const dt = sg.data;
            const uDates = sg.dates || [];
            const cols = [];
            const colVals = [];
            for (const k of Object.keys(dt)) {
                const always = URINE_ALWAYS_SHOW.includes(k);
                const pts = dt[k].map(v => {
                    if (always) return v || EMPTY;
                    return (v && isUrineAbnormal(v)) ? displayUrineVal(v) : EMPTY;
                });
                if (pts.every(p => p === EMPTY)) continue;
                cols.push(k);
                colVals.push(pts);
            }
            if (!cols.length) return null;
            if (!isTable) {
                return 'Urine [' + rowLabelsFor(uDates).join(', ') + ']' + headingSep
                    + cols.map((k, c) => k + ' ' + colVals[c].join('→')).join(', ');
            }
            const rowLabels = rowLabelsFor(uDates);
            const cells = uDates.map((d, i) => colVals.map(v => v[i] || EMPTY));
            return buildTable('Urine', cols, rowLabels, cells);
        }

        const groups = [];
        const push = (g) => { if (g) groups.push(g); };

        // Hemogram 只放追感染/貧血會一起看的那幾項，其餘 DC 自成一段
        for (const [title, keys, ext] of BLOOD_GROUPS) push(buildGroup(title, keys, ext));

        // 沒被任何一組收走的項目一律進 Others。舊版是比對 ALL_KNOWN 清單，
        // 「在 ALL_KNOWN 裡但不屬於任何分組」的項目（例如血氣的 PCO2/HCO3
        // 落到血液欄位時）會兩邊都不收、無聲消失。改成只認實際分組。
        const claimed = new Set([...ATTACHED, ...OTHERS, ...IGNORE]);
        for (const [, keys, ext] of BLOOD_GROUPS) {
            for (const k of [...keys, ...ext]) claimed.add(k);
        }
        const leftover = Object.keys(data).filter(k => !claimed.has(k));
        push(buildGroup('Others', OTHERS, leftover));

        if (specialGroups) {
            for (const [sgName, sgData] of Object.entries(specialGroups)) {
                if (sgName === 'Urine') {
                    push(buildUrine(sgData));
                    continue;
                }
                // 各分組的欄位順序表；沒列到的項目接在後面
                const order = sgName === 'CSF' ? CSF_ORDER
                    : sgName === 'Stool' ? STOOL_ORDER
                    : sgName === 'V gas' ? VGAS_ORDER
                    : (sgName === 'A gas' || sgName === 'Gas') ? AGAS_ORDER
                    : FLUID_ORDER;
                const extra = Object.keys(sgData.data).filter(k => {
                    if (order.includes(k)) return false;
                    // VBG 的 PO2 沒有臨床意義（只有 ABG 才看），直接不列
                    if (sgName === 'V gas' && k === 'PO2') return false;
                    return true;
                });
                push(buildGroup(sgName, order, extra, sgData.data, sgData.dates));
            }
        }

        if (!groups.length) return null;

        // #. 前綴集中在這裡加，兩種模式都吃得到
        return groups.map(g => '#. ' + g).join(sectionSep);
    }

    // ====== 橫式版 DOM 讀取 ======

    function readHorizontalView(reportDoc, view) {
        const allTables = reportDoc.querySelectorAll('table');
        if (!allTables.length) return null;

        const dates = [];
        const data = {};
        const datesSet = new Set();

        allTables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            if (rows.length < 2) return;

            let headerCells = rows[0].cells;
            if (!headerCells.length) return;

            const firstHeader = (headerCells[0].textContent || '').trim();
            if (!firstHeader.match(/\(\d+\/\d+\)/)) return;

            // 實際橫式頁的第一列表頭只有群組名，第二列才是檢驗項目。
            // 仍兼容群組名與項目位於同一列的舊格式。
            let itemStart = 1;
            let dataStart = 1;
            if (headerCells.length === 1) {
                headerCells = rows[1].cells;
                itemStart = 0;
                dataStart = 2;
            }
            if (headerCells.length <= itemStart) return;

            const itemNames = [];
            for (let j = itemStart; j < headerCells.length; j++) {
                itemNames.push((headerCells[j].textContent || '').trim());
            }

            for (let i = dataStart; i < rows.length; i++) {
                const cells = rows[i].cells;
                if (cells.length < 2) continue;

                const dateCell = (cells[0].textContent || '').trim();
                const dm = dateCell.match(/\d{4}\/(\d{2})\/(\d{2})/);
                if (!dm) continue;
                const dateLabel = dm[1] + '/' + dm[2];

                if (!datesSet.has(dateLabel)) {
                    datesSet.add(dateLabel);
                    dates.push(dateLabel);
                }
                const dateIdx = dates.indexOf(dateLabel);

                for (let j = 1; j < cells.length && j <= itemNames.length; j++) {
                    const rawItemName = itemNames[j - 1];
                    const val = cleanGreenValue((cells[j].textContent || '').trim());
                    if (!val) continue;

                    const cleanName = parseGreenItemName(rawItemName);
                    if (IGNORE.includes(cleanName)) continue;

                    const nm = normalizeName(rawItemName);
                    if (nm === '__SKIP__') continue;

                    // 綠單趨勢版的表格是「一列一項目、各欄為日期」，沒有單位/參考值欄，
                    // 拿不到 meta → 這種頁面不支援判讀模式（UI 會退回趨勢/表格）
                    pushToStore(data, nm, dateIdx, val);
                }
            }
        });

        if (!dates.length) return null;

        padData(data, dates.length);

        return formatTrend(dates, data, null, view);
    }

    // ====== 偵測目前的樣式（清單/橫式/直式/綠單） ======

    function detectViewMode(reportDoc) {
        const MODE_MAP = { '清單': 'list', '橫式': 'horizontal', '直式': 'vertical', '綠單': 'green' };
        const radios = reportDoc.querySelectorAll('input[type="radio"][id*="LabRangeSlider1_rbn"]');
        for (const r of radios) {
            if (!r.checked) continue;
            const label = reportDoc.querySelector('label[for="' + r.id + '"]');
            const txt = label ? label.textContent.trim() : (r.nextSibling?.textContent?.trim() || '');
            for (const [key, mode] of Object.entries(MODE_MAP)) {
                if (txt.indexOf(key) > -1) return mode;
            }
        }
        return 'list';
    }

    // ====== 主流程 ======

    // 依目前 view mode 讀出整理後文字（無資料回 null）。worker 與 run() 共用。
    // view：VIEW_TABLE / VIEW_TREND，決定輸出格式；mode 是頁面本身的檢視樣式，兩者無關
    function computeReport(view, reportDoc) {
        const mode = detectViewMode(reportDoc);
        // 判讀需要參考值欄，只有清單版的表格有；其餘版面回 null 讓 UI 退回趨勢/表格
        if (mode === 'green') return view === VIEW_INTERPRET ? null : readGreenSheetView(reportDoc, view);
        if (mode === 'list') return readListView(reportDoc, view);
        if (mode === 'horizontal') return view === VIEW_INTERPRET ? null : readHorizontalView(reportDoc, view);
        return '（直式模式不支援，請切換至清單、橫式或綠單）';
    }

    function run() {
        const reportDoc = getReportDocument();
        if (!reportDoc) {
            alert('報告尚未載入，請稍後再試');
            return;
        }

        // 兩種格式各算一次存起來，之後切換只換 textContent，不必重讀 DOM
        const texts = {};
        texts[VIEW_TABLE] = computeReport(VIEW_TABLE, reportDoc);
        texts[VIEW_TREND] = computeReport(VIEW_TREND, reportDoc);
        texts[VIEW_INTERPRET] = computeReport(VIEW_INTERPRET, reportDoc);
        if (!texts[VIEW_TABLE] && !texts[VIEW_TREND]) {
            alert('未偵測到檢驗項目');
            return;
        }
        showResult(texts);
    }

    // ====== 背景 worker：被 progress-note-data-helper 以 ntuh_token 開頁時 ======
    // 頁面預設清單、開頁即有資料 → 輪詢 computeReport 到非空 →
    // 寫 localStorage['ntuh_data_'+token]（與 data-helper 同信封）→ 關頁。
    function runReportWorker(token) {
        const KEY = 'ntuh_data_' + token;
        const done = (obj) => {
            try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (e) { /* noop */ }
            setTimeout(() => window.close(), 150);
        };
        const t0 = performance.now();
        const iv = setInterval(() => {
            let res = null;
            const reportDoc = getReportDocument();
            try { if (reportDoc) res = computeReport(getViewPref(), reportDoc); } catch (e) { /* 尚未就緒 */ }
            if (res) {
                clearInterval(iv);
                // 四種呈現組合一次算完隨結果帶走：filler 端切換排版就不必重開背景分頁。
                // key 格式 `${view}_${spacing}`，與 filler 的 LAB_VARIANT_KEY 對應。
                const variants = {};
                for (const view of [VIEW_TREND, VIEW_TABLE, VIEW_INTERPRET]) {
                    for (const sp of [OUTPUT_COMPACT, OUTPUT_SPACIOUS]) {
                        try {
                            const t = withOutputPref(sp, () => computeReport(view, reportDoc));
                            if (t) variants[view + '_' + sp] = t;
                        } catch (e) { /* 單一組合失敗不影響其他組合 */ }
                    }
                }
                done({ ok: true, text: res, variants });
                return;
            }
            // 防呆：頁面就緒（view-mode radio 出現）但 computeReport 仍無資料 → 回「無檢驗資料」，避免空等逾時。
            // 就緒後給 8s 寬限（背景分頁被瀏覽器節流時，DetailedSheet 表格 render 可能 >3s，太短會誤判空）；最終 20s 也回無資料訊息而非 error。
            const pageReady = !!reportDoc?.querySelector('input[type="radio"][id*="LabRangeSlider1_rbn"]');
            if ((pageReady && performance.now() - t0 > 8000) || performance.now() - t0 > 20000) {
                clearInterval(iv);
                done({ ok: true, text: '(無檢驗資料)' });
            }
        }, 400);
    }

    // ══════════════════════════════════════════════════════════
    // 判讀引擎（純函式：吃 [{name, val, unit, ref}]，吐字串，不碰 DOM）
    // 一律以「資料附的參考值」判斷高低，寫死的閾值只在沒有 ref 時當後備——
    // 各院區/科室的參考範圍不同（總院 vs 新竹 LU），寫死會判錯。
    // ══════════════════════════════════════════════════════════

    // ── 內建參考範圍（頁面抓不到時的後備）────────────────────
    // 只收錄**實際在 NTUH 報告頁出現過**的範圍，不自行編造——錯的參考值
    // 會產出錯的臨床判讀，比沒有判讀更糟。沒收錄的項目維持「只顯示值、
    // 不下判斷」。頁面若有給參考值一律優先用頁面的（那是依性別給的，較準）。
    // 來源：新竹 LU/LH 科室報告頁實測 dump（2026-09）。
    const BUILTIN_REF = {
        WBC: [3.25, 9.16], MCV: [80.9, 99.3], MCH: [25.5, 33.2], MCHC: [31.0, 34.9],
        Plt: [150, 378], RDW: [11.6, 15.0],
        Seg: [41.6, 74.4], 'Lym.': [18.0, 48.8], 'Mono.': [3.3, 8.9],
        'Eos.': [0.3, 7.9], 'Baso.': [0.2, 1.6], Band: [0, 5],
        BUN: [7, 25], Na: [136, 145], K: [3.5, 5.1], Mg: [0.78, 1.11],
        'T-Bil': [0.3, 1], AST: [8, 31], aPTT: [25.6, 32.6],
        CRP: [0, 1.0],            // hs-CRP，頁面寫 <1.0(評估感染或發炎性疾病)
        Glucose: [0, 100],        // Sugar(One touch)，頁面寫 <100
        // 依性別不同的項目：頁面有給就用頁面的，這裡只是後備
        Hb: { M: [13.5, 17.5], F: [11.0, 15.2] },
        HCT: { M: [41.0, 53.0], F: [34.8, 46.3] },
        RBC: { M: [4.4, 5.9], F: [3.78, 5.25] },
        CRE: { M: [0.7, 1.3], F: [0.6, 1.3] },
    };

    // 病人性別：報告/病歷頁的病人橫幅常見「王素真(F,1955/12/07,70y9m)」。
    // 抓不到時不猜——性別相異的項目就退回「只顯示值」，不用可能錯的範圍下判斷。
    let patientSex = '';
    function detectPatientSex(doc) {
        try {
            const t = (doc || document).documentElement.innerText || '';
            const m = t.match(/\(\s*([MF])\s*,\s*\d{4}\//);
            patientSex = m ? m[1] : '';
        } catch (e) { patientSex = ''; }
        return patientSex;
    }

    // 參考範圍解析：頁面的優先，其次內建
    function refFor(item) {
        const fromPage = parseRef(item && item.ref);
        if (fromPage) return fromPage;
        const b = BUILTIN_REF[item && item.name];
        if (!b) return null;
        if (Array.isArray(b)) return { lo: b[0], hi: b[1], builtin: true };
        if (!patientSex || !b[patientSex]) return null;   // 性別未知就不猜
        return { lo: b[patientSex][0], hi: b[patientSex][1], builtin: true };
    }

    // 參考值字串 → { lo, hi }。認得 a~b / a-b / ≦x / ≧x / Normal(<30) 等寫法；
    // 「本項結果屬計算值」這種說明文字回 null（＝無法判定高低）。
    function parseRef(ref) {
        if (!ref) return null;
        const s = String(ref).replace(/\s+/g, '');
        let m = s.match(/(-?\d+(?:\.\d+)?)[~～](-?\d+(?:\.\d+)?)/);
        if (m) return { lo: +m[1], hi: +m[2] };
        m = s.match(/^(-?\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
        if (m) return { lo: +m[1], hi: +m[2] };
        m = s.match(/[≦≤<]=?(-?\d+(?:\.\d+)?)/);
        if (m) return { lo: -Infinity, hi: +m[1] };
        m = s.match(/[≧≥>]=?(-?\d+(?:\.\d+)?)/);
        if (m) return { lo: +m[1], hi: Infinity };
        return null;
    }

    // 值字串 → 數字。「100 (2+)」→100、「≧300 (2+)」→300、「>150」→150；
    // 「3-5」這種區間與「Auto DC」這種文字回 null（不能拿去比大小）。
    function numVal(val) {
        if (val === null || val === undefined) return null;
        const s = String(val).replace(/,/g, '').trim();
        if (/^\d+(?:\.\d+)?\s*-\s*\d/.test(s)) return null;   // 區間
        const m = s.match(/-?\d+(?:\.\d+)?/);
        return m ? +m[0] : null;
    }

    // 邊界值算正常（BUN 23.9 而參考值 7~25 → normal）
    const cmp = (n, r) => (n < r.lo ? 'low' : n > r.hi ? 'high' : 'normal');

    function levelOf(item) {
        if (!item) return null;
        const n = numVal(item.val);
        if (n === null) return null;
        const fromPage = parseRef(item.ref);
        if (fromPage) return cmp(n, fromPage);
        const b = BUILTIN_REF[item.name];
        if (!b) return null;
        if (Array.isArray(b)) return cmp(n, { lo: b[0], hi: b[1] });
        if (patientSex && b[patientSex]) return cmp(n, { lo: b[patientSex][0], hi: b[patientSex][1] });
        // 性別未知：男女範圍各算一次，**結論一致就採用**（如 Cre 0.37 不論男女都偏低），
        // 結論不同才放棄（如 Hb 11.4 對女性正常、對男性偏低）。
        const lm = b.M && cmp(n, { lo: b.M[0], hi: b.M[1] });
        const lf = b.F && cmp(n, { lo: b.F[0], hi: b.F[1] });
        return lm && lf && lm === lf ? lm : null;
    }

    // 判讀輸出用的顯示名（store 內部名沿用縮寫表，這裡只做臨床習慣的微調）
    const DISPLAY_NAME = { Plt: 'PLT', CRE: 'Cre' };
    const dispName = (n) => DISPLAY_NAME[n] || n;

    // eGFR 不顯示單位（protocol 9(2)）
    function fmtItem(it) {
        if (!it) return '';
        if (it.name === 'eGFR') return dispName(it.name) + ': ' + it.val;
        return dispName(it.name) + ': ' + it.val + (it.unit ? ' ' + it.unit : '');
    }
    const fmtVal = (it) => (it.name === 'eGFR' ? it.val : it.val + (it.unit ? ' ' + it.unit : ''));
    // 一條「發現」。改成物件而非字串，兩個時間點才比對得起來：
    //   id        比對用的鍵（同一個 id 才算同一條發現）
    //   desc      描述（Hypokalemia / normal K / Normocytic anemia）
    //   items     這條發現引用到的檢驗值
    //   showNames 括號內要不要標項目名（protocol 9(1) 的兩種格式）
    //   abnormal  是否為異常發現（決定排序與 improved/worsen）
    const F = (id, desc, items, showNames, abnormal) =>
        ({ id, desc, items: items.filter(Boolean), showNames, abnormal });
    const withItems = (desc, items, id) => F(id || desc, desc, items, true, true);
    const withVal = (desc, it, id) => F(id || (it && it.name) || desc, desc, [it], false, true);
    const normalOf = (desc, items, showNames, id) =>
        F(id || (items[0] && items[0].name) || desc, desc, items, showNames, false);

    // 一段的組裝：異常在前、正常在後（protocol 9(4)）
    // 異常在前、正常在後（protocol 9(4)）
    function joinFindings(abnormal, normal, unknown) {
        return abnormal.concat(normal, unknown || []).filter(Boolean);
    }

    // 沒有可解析的參考值時，仍要把值列出來（標 ?），不要讓項目憑空消失。
    // 判讀模式曾經因為抓不到參考值而整段不見，只剩唯一有後路的 Others——
    // 資料消失比判讀不出來嚴重得多。
    const unknownOf = (it) => F(it.name, dispName(it.name), [it], false, false);

    function pickItems(items) {
        const by = {};
        items.forEach((it) => { if (it && it.val && !by[it.name]) by[it.name] = it; });
        return by;
    }

    // ── #. Hemogram ────────────────────────────────────────────
    function interpretHemogram(by) {
        const hb = by.Hb, mcv = by.MCV, wbc = by.WBC, plt = by.Plt;
        if (!hb && !wbc && !plt) return [];
        const lHb = levelOf(hb), lWbc = levelOf(wbc), lPlt = levelOf(plt);
        const ab = [], nl = [], unk = [];

        if (lHb === 'low' && lWbc === 'low' && lPlt === 'low') {
            return [withItems('Pancytopenia', [hb, wbc, plt], 'CBC')];
        }
        if (lHb === 'normal' && lWbc === 'normal' && lPlt === 'normal') {
            return [normalOf('Normal hemogram', [hb, wbc, plt], true, 'CBC')];
        }

        if (lHb === 'low') {
            const lMcv = levelOf(mcv);
            const kind = lMcv === 'low' ? 'Microcytic'
                : lMcv === 'high' ? 'Macrocytic'
                    : lMcv === 'normal' ? 'Normocytic' : '';
            ab.push(withItems((kind ? kind + ' anemia' : 'Anemia'), kind ? [hb, mcv] : [hb], 'Hb'));
        } else if (lHb === 'high') {
            ab.push(withVal('elevated Hb', hb));
        } else if (lHb === 'normal') { nl.push(normalOf('normal Hb', [hb], false)); }
        else if (hb) { unk.push(unknownOf(hb)); }

        if (lWbc === 'high') ab.push(withItems('Leukocytosis', [wbc], 'WBC'));
        else if (lWbc === 'low') ab.push(withItems('Leukopenia', [wbc], 'WBC'));
        else if (lWbc === 'normal') nl.push(normalOf('normal WBC', [wbc], false));
        else if (wbc) unk.push(unknownOf(wbc));

        if (lPlt === 'high') ab.push(withItems('Thrombocytosis', [plt], 'Plt'));
        else if (lPlt === 'low') ab.push(withItems('Thrombocytopenia', [plt], 'Plt'));
        else if (lPlt === 'normal') nl.push(normalOf('normal PLT', [plt], false));
        else if (plt) unk.push(unknownOf(plt));

        return joinFindings(ab, nl, unk);
    }

    // ── #. BCS（肝腎）──────────────────────────────────────────
    const LIVER_KEYS = ['Alb', 'AST', 'ALT', 'ALP', 'GGT', 'T-Bil', 'D-Bil'];
    const KIDNEY_KEYS = ['CRE', 'BUN', 'eGFR'];

    function ckdStage(egfr) {
        if (egfr === null) return '';
        if (egfr >= 90) return 'Stage 1';
        if (egfr >= 60) return 'Stage 2';
        if (egfr >= 45) return 'Stage 3a';
        if (egfr >= 30) return 'Stage 3b';
        if (egfr >= 15) return 'Stage 4';
        return 'Stage 5';
    }

    function interpretBCS(by) {
        const liver = LIVER_KEYS.map((k) => by[k]).filter(Boolean);
        const kidney = KIDNEY_KEYS.map((k) => by[k]).filter(Boolean);
        if (!liver.length && !kidney.length) return [];
        const ab = [], nl = [];

        // R value：肝細胞型與膽汁鬱積型酵素同時上升時才算。
        // 用標準式 (ALT/ULN) ÷ (ALP/ULN)，ULN 取自資料的參考值上限，
        // 跨院區 ULN 不同也不會失準（原 prompt 的 2.5*ALT/ALP 是固定 ULN 的簡化式）。
        const alt = by.ALT, alp = by.ALP;
        const hepUp = ['ALT', 'AST'].some((k) => levelOf(by[k]) === 'high');
        const choUp = ['ALP', 'GGT'].some((k) => levelOf(by[k]) === 'high');
        if (hepUp && choUp && alt && alp) {
            const rAlt = refFor(alt), rAlp = refFor(alp);
            const nAlt = numVal(alt.val), nAlp = numVal(alp.val);
            if (rAlt && rAlp && isFinite(rAlt.hi) && isFinite(rAlp.hi) && nAlp && rAlp.hi) {
                const R = (nAlt / rAlt.hi) / (nAlp / rAlp.hi);
                const pattern = R > 5 ? 'Hepatocellular pattern'
                    : R < 2 ? 'Cholestatic pattern' : 'Mixed pattern';
                ab.push(F('LiverPattern', pattern + ' (R = ' + R.toFixed(1) + ')', [alt, alp], true, true));
            }
        }

        // 膽紅素：T-Bil 上升才分直接/間接
        const tb = by['T-Bil'], db = by['D-Bil'];
        if (levelOf(tb) === 'high') {
            const nT = numVal(tb.val), nD = db ? numVal(db.val) : null;
            if (nT && nD !== null) {
                const ratio = nD / nT;
                ab.push(withItems((ratio > 0.15 ? 'Direct' : 'Indirect') + ' hyperbilirubinemia', [tb, db], 'T-Bil'));
            } else {
                ab.push(withItems('Hyperbilirubinemia', [tb], 'T-Bil'));
            }
        }

        // 其餘肝指標的個別異常（已經被 R value / 膽紅素講過的就不重複）
        const unk = [];
        const covered = new Set();
        if (hepUp && choUp) { covered.add('ALT'); covered.add('ALP'); }
        if (levelOf(tb) === 'high') { covered.add('T-Bil'); covered.add('D-Bil'); }
        LIVER_KEYS.forEach((k) => {
            if (covered.has(k) || !by[k]) return;
            const l = levelOf(by[k]);
            if (l === 'high') ab.push(withVal('elevated ' + k, by[k]));
            else if (l === 'low') ab.push(withVal('decreased ' + k, by[k]));
            else if (!l) unk.push(unknownOf(by[k]));
        });

        // 腎功能
        const lCre = levelOf(by.CRE), lBun = levelOf(by.BUN);
        if (lCre === 'high') ab.push(withVal('elevated Cre', by.CRE));
        else if (lCre === 'low') ab.push(withVal('decreased Cre', by.CRE));
        else if (by.CRE && !lCre) unk.push(unknownOf(by.CRE));
        if (lBun === 'high') ab.push(withVal('elevated BUN', by.BUN));
        else if (lBun === 'low') ab.push(withVal('decreased BUN', by.BUN));
        else if (by.BUN && !lBun) unk.push(unknownOf(by.BUN));
        // eGFR 沒有數值型參考值（欄位是說明文字），Cre 正常時本來就不顯示；
        // 但 Cre 也判不出來時，至少把 eGFR 的值列出來
        if (by.eGFR && !lCre) unk.push(unknownOf(by.eGFR));
        // Cre 正常就不必標 CKD 分期（protocol 4(4)）。
        // 只在 Cre **偏高**時標——Cre 偏低（如 0.37）配上高 eGFR 標「CKD Stage 1」
        // 是誤導的訊號，那不是慢性腎病，只是肌肉量少/稀釋。
        if (lCre === 'high' && by.eGFR) {
            const st = ckdStage(numVal(by.eGFR.val));
            if (st) ab.push(F('CKD', 'CKD ' + st, [by.eGFR], true, true));
        }

        // 全正常的收斂說法
        const liverAllNormal = liver.length && liver.every((it) => levelOf(it) === 'normal');
        const kidneyCore = ['CRE', 'BUN'].map((k) => by[k]).filter(Boolean);
        const kidneyAllNormal = kidneyCore.length && kidneyCore.every((it) => levelOf(it) === 'normal');
        if (liverAllNormal && kidneyAllNormal) {
            return [normalOf('Normal liver and kidney function', liver.concat(kidney), true, 'LiverKidney')];
        }
        // 整組「normal liver/kidney function」不成立時（有異常、或有項目判不出來），
        // 個別判定為正常的項目仍要列出來，否則會憑空消失。
        if (liverAllNormal) nl.push(normalOf('normal liver function', liver, true, 'Liver'));
        else liver.forEach((it) => { if (levelOf(it) === 'normal') nl.push(normalOf('normal ' + it.name, [it], false)); });
        if (kidneyAllNormal) nl.push(normalOf('normal kidney function', kidney, true, 'Kidney'));
        else kidneyCore.forEach((it) => { if (levelOf(it) === 'normal') nl.push(normalOf('normal ' + dispName(it.name), [it], false)); });
        if (!liver.length) nl.push(F('Liver', 'no liver profile', [], false, false));
        if (!kidney.length) nl.push(F('Kidney', 'no kidney profile', [], false, false));
        return joinFindings(ab, nl, unk);
    }

    // ── #. Electrolytes ────────────────────────────────────────
    const LYTE_KEYS = ['Na', 'K', 'Ca', 'Mg', 'Cl', 'P'];
    const LYTE_NAMED = { Na: ['Hypernatremia', 'Hyponatremia'], K: ['Hyperkalemia', 'Hypokalemia'] };

    function interpretLytes(by) {
        const present = LYTE_KEYS.map((k) => by[k]).filter(Boolean);
        if (!present.length) return [];
        const ab = [], nl = [], unk = [];
        LYTE_KEYS.forEach((k) => {
            const it = by[k];
            if (!it) return;
            const l = levelOf(it);
            if (l === 'high') {
                ab.push(LYTE_NAMED[k] ? withItems(LYTE_NAMED[k][0], [it], k) : withVal('elevated ' + k, it, k));
            } else if (l === 'low') {
                ab.push(LYTE_NAMED[k] ? withItems(LYTE_NAMED[k][1], [it], k) : withVal('decreased ' + k, it, k));
            } else if (l === 'normal') {
                nl.push(normalOf('normal ' + k, [it], false));
            } else {
                unk.push(unknownOf(it));
            }
        });
        return joinFindings(ab, nl, unk);
    }

    // ── #. Coagulation ─────────────────────────────────────────
    const COAG_KEYS = ['PT', 'INR', 'aPTT', 'PTT'];
    function interpretCoag(by) {
        const present = COAG_KEYS.map((k) => by[k]).filter(Boolean);
        if (!present.length) return [];
        const ab = [], unk = [];
        let allNormal = true;
        COAG_KEYS.forEach((k) => {
            const it = by[k];
            if (!it) return;
            const l = levelOf(it);
            if (l === 'high') { ab.push(withVal('prolonged ' + k, it)); allNormal = false; }
            else if (l === 'low') { ab.push(withVal('shortened ' + k, it)); allNormal = false; }
            else if (l !== 'normal') { allNormal = false; unk.push(unknownOf(it)); }
        });
        if (allNormal) return [normalOf('Normal coagulation function', present, true, 'Coag')];
        return joinFindings(ab, present.filter((it) => levelOf(it) === 'normal').map((it) => normalOf('normal ' + it.name, [it], false)), unk);
    }

    // ── #. Others ──────────────────────────────────────────────
    const OTHER_KEYS = ['CRP', 'PCT'];
    function interpretOthers(by) {
        const present = OTHER_KEYS.map((k) => by[k]).filter(Boolean);
        if (!present.length) return [];
        const ab = [], nl = [];
        present.forEach((it) => {
            const l = levelOf(it);
            if (l === 'high') ab.push(withVal('elevated ' + it.name, it));
            else if (l === 'low') ab.push(withVal('decreased ' + it.name, it));
            else if (l === 'normal') nl.push(normalOf('normal ' + it.name, [it], false));
            else nl.push(unknownOf(it));
        });
        return joinFindings(ab, nl);
    }

    // ── #. Urine ───────────────────────────────────────────────
    // 只留 protocol 6(1) 指定的七項，其餘尿液項目不顯示
    const URINE_DIPSTICK = [
        ['Protein', 'Proteinuria'], ['ACR', 'Albuminuria'], ['Glucose', 'Glycosuria'],
    ];
    const URINE_SEDIMENT = [
        ['RBC', 'Hematuria', 'no hematuria'],
        ['WBC', 'Pyuria', 'no pyuria'],
        ['Epi', 'Poor specimen quality', 'good specimen quality'],
    ];

    // 「2+」「3+」「4+」算陽性；1+ 與 +/- 不算（protocol 6(2)）
    function plusGrade(val) {
        const m = String(val || '').match(/(\d)\s*\+/);
        return m ? +m[1] : 0;
    }
    // 「10-19」「20-29」「>100」→ 取下界 ≥10 算陽性；「0-2」「3-5」「6-9」不算
    function sedimentHigh(val) {
        const s = String(val || '').replace(/\s+/g, '');
        const m = s.match(/(\d+)/);
        if (!m) return false;
        if (/^[>≧≥]/.test(s)) return +m[1] >= 10;
        return +m[1] >= 10;
    }

    function interpretUrine(by) {
        const keys = URINE_DIPSTICK.map((x) => x[0])
            .concat(URINE_SEDIMENT.map((x) => x[0]), ['Bac']);
        if (!keys.some((k) => by[k])) return [];
        const ab = [], nl = [];

        URINE_DIPSTICK.forEach(([k, pos]) => {
            const it = by[k];
            if (!it) return;
            // 只顯示 + 級數（protocol 6(2) 的範例是 Proteinuria (3+)），
            // 不要把「100 (2+)」整串塞進括號變成括號套括號
            const g = plusGrade(it.val);
            const shown = g ? g + '+' : String(it.val).trim();
            const uIt = { name: k, val: shown, unit: '' };
            if (g >= 2) ab.push(F(k, pos, [uIt], false, true));
            else nl.push(F(k, 'no ' + pos.toLowerCase(), [uIt], false, false));
        });
        URINE_SEDIMENT.forEach(([k, pos, neg]) => {
            const it = by[k];
            if (!it) return;
            const sIt = { name: k, val: it.val, unit: '' };
            if (sedimentHigh(it.val)) ab.push(F(k, pos, [sIt], false, true));
            else nl.push(F(k, neg, [sIt], false, false));
        });
        const bac = by.Bac;
        if (bac) {
            const isNeg = /^[-–—]$/.test(String(bac.val).trim()) || /^(neg|none|nil)$/i.test(bac.val);
            const bIt = { name: 'Bac', val: bac.val, unit: '' };
            if (isNeg) nl.push(F('Bac', 'no bacteriuria', [bIt], false, false));
            else ab.push(F('Bac', 'Bacteriuria', [bIt], false, true));
        }
        return joinFindings(ab, nl);
    }

    // ── #. Blood gas ───────────────────────────────────────────
    // 參考範圍依檢體別：動脈與靜脈不同，原 protocol 只給了靜脈。
    const GAS_REF = {
        agas: { pH: [7.35, 7.45], PCO2: [35, 45], PO2: [80, 100], HCO3: [22, 26] },
        vgas: { pH: [7.31, 7.41], PCO2: [40, 50], PO2: [30, 50], HCO3: [24, 30] },
    };

    function interpretGas(by, kind) {
        const R = GAS_REF[kind] || GAS_REF.vgas;
        const g = (k) => (by[k] ? numVal(by[k].val) : null);
        const pH = g('pH'), pco2 = g('PCO2'), hco3 = g('HCO3'), po2 = g('PO2'), be = g('BE');
        if (pH === null && pco2 === null && hco3 === null) return '';
        const label = kind === 'agas' ? 'ABG' : 'VBG';
        const bits = [];

        let primary = '';
        if (pH !== null) {
            if (pH < R.pH[0]) primary = 'acidemia';
            else if (pH > R.pH[1]) primary = 'alkalemia';
        }
        const respHigh = pco2 !== null && pco2 > R.PCO2[1];
        const respLow = pco2 !== null && pco2 < R.PCO2[0];
        const metaLow = hco3 !== null && hco3 < R.HCO3[0];
        const metaHigh = hco3 !== null && hco3 > R.HCO3[1];

        // 先定出**原發**疾患，代償公式再依它分支。
        // 不能看「哪個值超出範圍」就套公式——呼吸性鹼中毒的低 HCO3 正是代償，
        // 誤判成原發代謝性酸中毒會去套 Winter，結論整個反掉。
        let dx = '';
        let primaryType = 'none';
        if (primary === 'acidemia') {
            if (metaLow && respHigh) { dx = 'mixed metabolic and respiratory acidosis'; primaryType = 'mixed'; }
            else if (metaLow) { dx = 'metabolic acidosis'; primaryType = 'met-acid'; }
            else if (respHigh) { dx = 'respiratory acidosis'; primaryType = 'resp-acid'; }
            else dx = 'acidemia';
        } else if (primary === 'alkalemia') {
            if (metaHigh && respLow) { dx = 'mixed metabolic and respiratory alkalosis'; primaryType = 'mixed'; }
            else if (metaHigh) { dx = 'metabolic alkalosis'; primaryType = 'met-alk'; }
            else if (respLow) { dx = 'respiratory alkalosis'; primaryType = 'resp-alk'; }
            else dx = 'alkalemia';
        } else if (respHigh || respLow || metaLow || metaHigh) {
            // pH 已回到範圍內＝代償後。原發看方向一致的那一組：
            // HCO3 低 + pCO2 低 → 原發代謝性酸中毒；HCO3 高 + pCO2 高 → 原發代謝性鹼中毒
            if (metaLow) { dx = 'compensated metabolic acidosis'; primaryType = 'met-acid'; }
            else if (metaHigh) { dx = 'compensated metabolic alkalosis'; primaryType = 'met-alk'; }
            else if (respHigh) { dx = 'compensated respiratory acidosis'; primaryType = 'resp-acid'; }
            else { dx = 'compensated respiratory alkalosis'; primaryType = 'resp-alk'; }
        } else {
            dx = 'no acid-base disturbance';
        }
        bits.push(label + ': ' + dx);

        // Anion gap（需要 Na 與 Cl，血氣單沒有就從血液生化補）
        const na = g('Na'), cl = g('Cl');
        if (na !== null && cl !== null && hco3 !== null) {
            const ag = na - (cl + hco3);
            bits.push('AG ' + ag.toFixed(1) + (ag > 12 ? ' (elevated)' : ag < 8 ? ' (low)' : ' (normal)'));
        }

        const near = (x) => Math.abs(hco3 - x) <= 2;
        const acuteChronic = (acute, chronic) => 'expected HCO3 ' + acute.toFixed(1) + ' (acute) / '
            + chronic.toFixed(1) + ' (chronic) vs actual ' + hco3
            + (near(acute) ? ' \u2192 acute pattern'
                : near(chronic) ? ' \u2192 chronic pattern'
                    : Math.min(acute, chronic) < hco3 && hco3 < Math.max(acute, chronic)
                        ? ' \u2192 between acute and chronic compensation'
                        : ' \u2192 outside expected compensation (concomitant metabolic disorder)');

        if (primaryType === 'met-acid' && pco2 !== null) {
            // Winter's formula 是以**動脈**值推導的；靜脈 pCO2 約高 5-8 mmHg，
            // 用 VBG 直接比會系統性偏向「代償不足」，故對靜脈血加註提醒。
            const exp = 1.5 * hco3 + 8;
            const d = pco2 - exp;
            bits.push('Winter expected pCO2 ' + exp.toFixed(0) + ' vs actual ' + pco2
                + (Math.abs(d) <= 2 ? ' \u2192 appropriate respiratory compensation'
                    : d > 2 ? ' \u2192 inadequate respiratory compensation'
                        : ' \u2192 excess respiratory compensation')
                + (kind === 'vgas' ? ' (venous; Winter derived from arterial)' : ''));
        } else if (primaryType === 'met-alk' && pco2 !== null) {
            const exp = 0.7 * (hco3 - 24) + 40;
            const d = pco2 - exp;
            bits.push('expected pCO2 ' + exp.toFixed(0) + ' vs actual ' + pco2
                + (Math.abs(d) <= 5 ? ' \u2192 appropriate respiratory compensation'
                    : d > 5 ? ' \u2192 more hypoventilation than expected'
                        : ' \u2192 less hypoventilation than expected'));
        } else if (primaryType === 'resp-acid' && hco3 !== null) {
            bits.push(acuteChronic(24 + 0.1 * (pco2 - 40), 24 + 0.35 * (pco2 - 40)));
        } else if (primaryType === 'resp-alk' && hco3 !== null) {
            // 原 prompt 寫 24 - 0.2*(pCO2-40)，pCO2<40 時反而預測 bicarb 上升（正負號寫反）
            bits.push(acuteChronic(24 - 0.2 * (40 - pco2), 24 - 0.4 * (40 - pco2)));
        }

        if (be !== null) bits.push('BE ' + be);
        if (po2 !== null) {
            bits.push('pO2 ' + po2 + (po2 < R.PO2[0] ? ' (low)' : po2 > R.PO2[1] ? ' (high)' : ' (normal)'));
        }
        return bits.join('; ');
    }

    // ══ 渲染：單一時間點 ══
    function renderFinding(f) {
        if (!f.items.length) return f.desc;
        if (f.showNames) return f.desc + ' (' + f.items.map(fmtItem).join(', ') + ')';
        return f.desc + ' (' + f.items.map(fmtVal).join(', ') + ')';
    }

    // ══ 渲染：兩時間點比較（值寫成 old → new）══
    // 「顯著變化」的定義（原 protocol 只說 significant，沒給標準）：
    //   1. 跨越正常/異常界線 → 一定標（異常→正常 improved、正常→異常 worsen）
    //   2. 兩次都異常 → 相對變化 ≥ CHANGE_PCT 才標，靠近參考範圍為 improved、遠離為 worsen
    // 這樣 MCV 92.4→90.2（-2.4%）與 PLT 204→214（+4.9%）不會被亂標，
    // 而 Hb 9.8→7.2（-26%）與 CRP 11.69→2.72（-77%）會標出來。
    const CHANGE_PCT = 0.2;

    function changeTag(oldIt, newIt) {
        if (!oldIt || !newIt) return '';
        const lo = levelOf(oldIt), ln = levelOf(newIt);
        const no = numVal(oldIt.val), nn = numVal(newIt.val);
        if (!lo || !ln) return '';
        if (lo !== 'normal' && ln === 'normal') return 'improved';
        if (lo === 'normal' && ln !== 'normal') return 'worsen';
        if (lo === 'normal' && ln === 'normal') return '';
        if (no === null || nn === null || !no) return '';
        if (Math.abs(nn - no) / Math.abs(no) < CHANGE_PCT) return '';
        // 兩次都異常：往正常方向走＝改善
        if (ln === 'low') return nn > no ? 'improved' : 'worsen';
        return nn < no ? 'improved' : 'worsen';
    }

    function renderPair(fOld, fNew) {
        const parts = fNew.items.map((it) => {
            const prev = fOld && fOld.items.find((o) => o.name === it.name);
            const vals = prev && prev.val !== it.val ? prev.val + ' \u2192 ' + it.val : it.val;
            const unit = it.name === 'eGFR' ? '' : (it.unit ? ' ' + it.unit : '');
            return (fNew.showNames ? dispName(it.name) + ': ' : '') + vals + unit;
        });
        const primaryNew = fNew.items[0];
        const primaryOld = fOld && fOld.items[0];
        const tag = changeTag(primaryOld, primaryNew);

        // 描述的選用：
        //  - 異常 → 正常：留**舊的**描述（改善的是那個 leukocytosis / hyponatremia，
        //    寫成 'improved normal WBC' 語意不通）
        //  - 兩次都異常：'improved elevated CRP' 冗贅，去掉 elevated/decreased 前綴，
        //    方向已由箭頭表達
        let desc = fNew.desc;
        if (tag === 'improved' && fOld && fOld.abnormal && !fNew.abnormal) {
            desc = fOld.desc;
        } else if (tag && /^(elevated|decreased) /.test(desc)) {
            desc = desc.replace(/^(elevated|decreased) /, '');
        }
        const body = desc + (parts.length ? ' (' + parts.join(', ') + ')' : '');
        return tag ? tag + ' ' + body : body;
    }

    // ── 組裝 ───────────────────────────────────────────────
    // 段落順序：Hemogram → BCS → Lyte → Coag → Gas → Urine → Others
    function sectionsFor(sets) {
        const by = pickItems(sets.blood || []);
        const uBy = pickItems(sets.urine || []);
        const gBy = pickItems((sets.gas || []).concat(
            ['Na', 'Cl'].map((k) => by[k]).filter(Boolean)   // 血氣單沒 Na/Cl 就借血液生化算 AG
        ));
        return [
            { title: 'Hemogram', findings: interpretHemogram(by) },
            { title: 'BCS', findings: interpretBCS(by) },
            { title: 'Electrolytes', findings: interpretLytes(by) },
            { title: 'Coagulation', findings: interpretCoag(by) },
            { title: 'Blood gas', text: interpretGas(gBy, sets.gasKind || 'vgas') },
            { title: 'Urine', findings: interpretUrine(uBy) },
            { title: 'Others', findings: interpretOthers(by) },
        ];
    }

    // 單一時間點
    function buildInterpretation(sets) {
        const out = [];
        sectionsFor(sets).forEach((sec) => {
            const body = typeof sec.text === 'string' ? sec.text
                : (sec.findings || []).map(renderFinding).join(', ');
            if (body) out.push('#. ' + body);
        });
        return out.join('\n');
    }

    // 兩時間點比較。規則（第二份 protocol）：
    //   1. 描述用新資料
    //   2. 舊有新無 → 刪掉（病人沒再驗就別留著舊值誤導）
    //   3. 新有舊無 → 另起一段標題列出（'#. New:'）
    //   4. 值寫成 old → new
    //   5. 顯著變化標 improved / worsen
    function buildComparison(oldSets, newSets, oldLabel, newLabel) {
        const oldSecs = sectionsFor(oldSets);
        const newSecs = sectionsFor(newSets);
        const out = [];
        if (oldLabel && newLabel) out.push('[Lab] ' + oldLabel + ' -> ' + newLabel);

        newSecs.forEach((sec, i) => {
            if (typeof sec.text === 'string') {
                if (sec.text) out.push('#. ' + sec.text);
                return;
            }
            const oldFs = (oldSecs[i].findings || []);
            const lines = (sec.findings || []).map((f) => {
                // 找不到前一筆就原地顯示單值（renderPair 會省略箭頭與 improved/worsen）。
                // 不另外歸到一段 "新項目"——只驗過一次的項目仍屬於它自己的段落。
                const prev = oldFs.find((o) => o.id === f.id);
                return renderPair(prev, f);
            });
            if (lines.length) out.push('#. ' + lines.join(', '));
        });
        return out.join('\n');
    }

    // ── 從 store + meta 組出判讀引擎要的 items ──────────────────
    function mkItem(store, nm, idx, date) {
        const m = getStoreMeta(store, nm, idx) || {};
        return { name: nm, val: store[nm][idx], unit: m.unit || '', ref: m.ref || '', date: date };
    }

    // **逐項目**取最近兩筆有值的紀錄，而不是逐「採檢時間」切快照。
    // 各套組是分開抽的（今天只抽生化、CBC 是昨天的），照欄位切會讓昨天的 CBC
    // 變成「舊有新無」而被整組刪掉——那是錯的，昨天的 CBC 仍是目前最新的 CBC。
    function itemsByRecency(store, ord) {
        const latest = [], prev = [];
        Object.keys(store || {}).forEach((nm) => {
            const hits = [];
            for (const o of ord) {
                if (store[nm] && store[nm][o.i]) hits.push(o);
                if (hits.length === 2) break;
            }
            if (!hits.length) return;
            latest.push(mkItem(store, nm, hits[0].i, hits[0].d));
            if (hits.length > 1) prev.push(mkItem(store, nm, hits[1].i, hits[1].d));
        });
        return { latest: latest, prev: prev };
    }

    // 日期鍵是 "MM/DD HH:MM"（沒有年份）。跨年時 12 月要排在 1 月前面，
    // 所以偵測到同時出現 12 月與 1 月就把 1 月當第 13 月。
    function orderNewestFirst(dates) {
        const months = new Set(dates.map((d) => +(d.match(/^(\d{2})/) || [])[1]));
        const wrap = months.has(12) && months.has(1);
        const key = (d) => {
            const m = d.match(/^(\d{2})\/(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
            if (!m) return -1;
            let mo = +m[1];
            if (wrap && mo <= 6) mo += 12;
            return ((mo * 100 + +m[2]) * 100 + (+m[3] || 0)) * 100 + (+m[4] || 0);
        };
        return dates.map((d, i) => ({ d: d, i: i, k: key(d) })).sort((a, b) => b.k - a.k);
    }
    const dayLabel = (d) => String(d).split(/\s+/)[0];

    // 判讀呈現：每個項目各自跟自己的上一筆比。
    // 拿不到參考值（綠單/橫式頁面沒有該欄）就回 null，讓 UI 退回趨勢/表格。
    function buildInterpretView(dates, trendData, urineData, urineDates, gasData, gasDates, gasKind) {
        const ord = orderNewestFirst(dates || []);
        if (!ord.length) return null;
        detectPatientSex(document);
        const blood = itemsByRecency(trendData, ord);
        // 尿液與血氣採檢時間常與抽血不同步，各自取自己最新的一次，不做比較
        const uOrd = orderNewestFirst(urineDates || []);
        const gOrd = orderNewestFirst(gasDates || []);
        const urine = uOrd.length ? itemsByRecency(urineData || {}, uOrd).latest : [];
        const gas = gOrd.length ? itemsByRecency(gasData || {}, gOrd).latest : [];

        // 診斷探針：把引擎實際收到的 items（含單位/參考值）掛到 window，
        // 在報告頁 console 打 __ntuhLabItems 就能看到擷取層到底交出了什麼。
        // 判讀出問題時，這是唯一能分辨「沒抓到參考值」與「抓到但解析失敗」的方法。
        try {
            window.__ntuhLabItems = {
                dates: dates,
                latest: blood.latest, prev: blood.prev,
                urine: urine, gas: gas,
                patientSex: patientSex || '(未偵測到)',
                usedBuiltinRef: blood.latest.filter((it) => !parseRef(it.ref) && refFor(it))
                    .map((it) => it.name),
                stillUnknown: blood.latest.filter((it) => !refFor(it)).map((it) => it.name),
                noRef: blood.latest.filter((it) => !it.ref).map((it) => it.name),
                unparsedRef: blood.latest.filter((it) => it.ref && !parseRef(it.ref))
                    .map((it) => it.name + ' → "' + it.ref + '"'),
            };
        } catch (e) { /* noop */ }

        if (!blood.latest.length && !urine.length && !gas.length) return null;

        const newSets = { blood: blood.latest, urine: urine, gas: gas, gasKind: gasKind };
        if (!blood.prev.length) return buildInterpretation(newSets);

        // 標題的日期範圍取「實際被引用到的」最舊與最新，而不是報告頁的前兩欄——
        // 各項目的前一筆可能落在不同天。
        const used = blood.latest.concat(blood.prev).map((it) => it.date).filter(Boolean);
        const usedOrd = orderNewestFirst(used);
        const newest = usedOrd.length ? dayLabel(usedOrd[0].d) : '';
        const oldest = usedOrd.length ? dayLabel(usedOrd[usedOrd.length - 1].d) : '';
        const oldSets = { blood: blood.prev, urine: [], gas: [], gasKind: gasKind };
        return buildComparison(oldSets, newSets,
            oldest && oldest !== newest ? oldest : '', newest);
    }

    // ====== UI ======

    // texts: { table: '...', trend: '...' }
    function showResult(texts) {
        const old = document.getElementById('lab-summary-box');
        if (old) old.remove();

        // 記住的模式若剛好沒算出東西，就退到另一種，免得開出空白框
        let view = getViewPref();
        if (!texts[view]) view = view === VIEW_TABLE ? VIEW_TREND : VIEW_TABLE;
        const output = getOutputPref();

        const box = document.createElement('div');
        box.id = 'lab-summary-box';
        box.style.cssText = [
            'position:fixed', 'bottom:20px', 'right:20px', 'z-index:999999',
            'background:#fff', 'border:2px solid #1a6fa8', 'border-radius:6px',
            'box-shadow:0 4px 16px rgba(0,0,0,.25)', 'padding:0',
            'max-width:calc(100vw - 40px)',
            'font-family:sans-serif', 'font-size:13px', 'overflow:hidden',
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = 'background:#1a6fa8;color:#fff;padding:7px 10px 7px 12px;font-weight:500;display:flex;align-items:center;justify-content:space-between;gap:12px;';
        const title = document.createElement('span');
        title.textContent = '檢驗整理';

        // 呈現方式切換：放標題列，下方工具列留給「複製」「關閉」等動作
        const toggleButtonStyle = 'padding:3px 12px;border:none;border-radius:3px;cursor:pointer;font-size:12px;font-family:inherit;background:transparent;color:#bcd7ee;';
        const seg = document.createElement('span');
        seg.style.cssText = 'display:flex;background:#15537f;border-radius:4px;padding:2px;';
        const segBtns = {};
        [[VIEW_TREND, '趨勢'], [VIEW_TABLE, '表格'], [VIEW_INTERPRET, '判讀']].forEach(([v, label]) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.style.cssText = toggleButtonStyle;
            b.onclick = () => { if (texts[v]) apply(v); };
            segBtns[v] = b;
            seg.appendChild(b);
        });

        const controls = document.createElement('span');
        controls.style.cssText = 'display:flex;align-items:center;gap:12px;';
        const outputSeg = document.createElement('span');
        outputSeg.style.cssText = 'display:flex;background:#15537f;border-radius:4px;padding:2px;';
        const outputBtns = {};
        [[OUTPUT_COMPACT, '緊湊'], [OUTPUT_SPACIOUS, '寬鬆']].forEach(([spacing, label]) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.style.cssText = toggleButtonStyle;
            b.onclick = () => {
                if (spacing === output) return;
                setOutputPref(spacing);
                run();
            };
            outputBtns[spacing] = b;
            outputSeg.appendChild(b);
        });
        controls.appendChild(outputSeg);
        controls.appendChild(seg);

        header.appendChild(title);
        header.appendChild(controls);

        const content = document.createElement('div');
        content.id = 'lab-summary-text';

        // 兩種呈現共用等寬字型，約 64 字後換行。
        function apply(v) {
            view = v;
            setViewPref(v);
            box.style.width = 'min(64ch,calc(100vw - 40px))';
            content.style.cssText = [
                'padding:10px 14px', 'background:#f7f7f7',
                'max-height:70vh', 'overflow:auto',
                'font-family:Consolas,"Courier New",monospace',
                'font-size:12.5px', 'line-height:1.5',
                'white-space:pre-wrap', 'overflow-wrap:anywhere',
                'tab-size:4',
            ].join(';');
            content.textContent = texts[v];
            Object.entries(segBtns).forEach(([k, b]) => {
                const on = k === v;
                b.style.background = on ? '#fff' : 'transparent';
                b.style.color = on ? '#1a6fa8' : '#bcd7ee';
                b.disabled = !texts[k];
                b.style.cursor = texts[k] ? 'pointer' : 'not-allowed';
            });
            Object.entries(outputBtns).forEach(([k, b]) => {
                const on = k === output;
                b.style.background = on ? '#fff' : 'transparent';
                b.style.color = on ? '#1a6fa8' : '#bcd7ee';
            });
        }

        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'padding:6px 12px 10px;background:#f7f7f7;display:flex;gap:8px;';

        const copyBtn = document.createElement('button');
        copyBtn.textContent = '複製';
        copyBtn.style.cssText = 'padding:3px 14px;border:1px solid #ccc;border-radius:4px;cursor:pointer;background:#fff;font-size:12px;';
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(texts[view]).then(
                () => { copyBtn.textContent = '已複製 ✓'; setTimeout(() => copyBtn.textContent = '複製', 1500); },
                () => { copyBtn.textContent = '複製失敗'; }
            );
        };

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '關閉';
        closeBtn.style.cssText = 'padding:3px 14px;border:1px solid #ccc;border-radius:4px;cursor:pointer;background:#fff;font-size:12px;';
        closeBtn.onclick = () => box.remove();

        toolbar.appendChild(copyBtn);
        toolbar.appendChild(closeBtn);
        box.appendChild(header);
        box.appendChild(content);
        box.appendChild(toolbar);
        apply(view);
        document.body.appendChild(box);
    }

    function addButton() {
        if (!document.body) { setTimeout(addButton, 100); return; }

        const btn = document.createElement('button');
        btn.id = 'lab-summary-btn';
        btn.textContent = '整理檢驗';
        btn.style.cssText = [
            'position:fixed', 'bottom:45px', 'right:60px', 'z-index:999999',
            'padding:6px 14px', 'background:#e67e22', 'color:#fff',
            'border:none', 'border-radius:4px', 'cursor:pointer',
            'font-family:sans-serif', 'font-weight:bold', 'font-size:13px',
        ].join(';');
        btn.onclick = run;
        document.body.appendChild(btn);
    }

    window.PNLabSummary = {
        compute: (doc) => withOutputPref(OUTPUT_COMPACT, () => computeReport(VIEW_TABLE, doc)),
        structured: (doc, sex) => {
            __pnwCap = null;
            patientSex = sex === 'M' || sex === 'F' ? sex : '';
            const text = withOutputPref(OUTPUT_COMPACT, () => computeReport(VIEW_TABLE, doc));
            const cap = __pnwCap; __pnwCap = null;
            const pack = (dates, data) => ({
                dates: (dates || []).slice(),
                items: Object.keys(data || {}).map((name) => ({
                    name,
                    vals: data[name].slice(),
                    unit: (data[name].map((v, i) => (getStoreMeta(data, name, i) || {}).unit).find(Boolean)) || '',
                    ref: (data[name].map((v, i) => (getStoreMeta(data, name, i) || {}).ref).find(Boolean)) || '',
                    level: data[name].map((v, i) => (v ? levelOf({ name, val: v, ref: (getStoreMeta(data, name, i) || {}).ref }) : null)),
                })),
            });
            return {
                text: typeof text === 'string' ? text : '',
                blood: cap ? pack(cap.dates, cap.data) : null,
                special: cap && cap.specialGroups ? Object.fromEntries(Object.entries(cap.specialGroups).map(([k, g]) => [k, pack(g.dates, g.data)])) : {},
                groups: BLOOD_GROUPS.map(([t, a, b]) => [t, [...a, ...b]]),
                others: OTHERS.slice(), attach: Object.assign({}, ATTACH),
            };
        },
    };
})();

// ---- src/workspace/his.js ----
// Progress note 工作畫面的資料層（唯讀）。在病程頁（InsertProgressNoteContent.aspx）執行，
// 只發查詢請求，不按任何會寫入病歷的按鈕。各來源的網址與格式見 README 與 batch.js。
const PNW_HIS = (() => {
  'use strict';
  const ORIGIN = location.origin;
  const base = ORIGIN + '/WebApplication/InPatient/';
  const SVC = base + 'Ward/ProgressNoteControl/Service/';
  const opt = { credentials: 'same-origin' };
  const DAY = 86400000;
  const two = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}/${two(d.getMonth() + 1)}/${two(d.getDate())}`;
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tsOf = (s) => {
    const m = String(s || '').match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[\sT]+(\d{1,2}):(\d{2}))?/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : NaN;
  };
  const dayStart = (ms) => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();
  const dec = (s) => [['A0010 0111', "'"], ['A0011 1100', '<'], ['A0011 1110', '>'], ['A0010 0110', '&'], ['A0101 1111', '_'], ['A0000 0000', ','], ['A0000 0001', '+']]
    .reduce((a, [e, r]) => a.split(e).join(r), String(s ?? ''));

  /** 從病程頁的網址與標題讀出這位病人 */
  function context() {
    const q = new URLSearchParams(location.search);
    const param = (name) => { for (const [k, v] of q) if (k.toLowerCase() === name.toLowerCase()) return v; return ''; };
    const title = document.title || '';
    const acct = param('AccountIDSE');
    let personId = param('PersonID');
    if (!personId) {
      const ck = document.cookie.split('; ').find((c) => c.startsWith('Page_Session_InPatientPatientListSessionKey=')) || '';
      ck.slice(ck.indexOf('=') + 1).split('&').forEach((part) => {
        const i = part.indexOf('=');
        if (i < 0 || !/^Pat\d+$/.test(part.slice(0, i))) return;
        let v = part.slice(i + 1).replace(/%u([0-9a-f]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
        try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* 保留原字串 */ }
        const id = (v.split('|')[1] || '').split('_');
        if (id.length >= 4 && id[id.length - 1].trim() === acct) personId = id.slice(2, -1).join('_').trim();
      });
    }
    const bed = title.match(/床[:：]\s*\w+-(\w+)\s*-(\d+)-(\d+)/) || [];
    const who = title.match(/-([^(-]+)\(([MF]),(\d{4}\/\d{2}\/\d{2}),([^)]*)\)\s*(\d{6,8})/) || [];
    return {
      SESSION: param('SESSION'), acct, personId,
      chart: who[5] || (title.match(/\)\s*(\d{6,8})\b/) || [])[1] || '',
      name: (who[1] || '').trim(), sex: who[2] || '', age: who[4] || '',
      ward: bed[1] || '', bed: bed[1] ? `${bed[1]}-${bed[2]}-${bed[3]}` : '',
      adm: (title.match(/入[:：]\s*(\d{4}\/\d{2}\/\d{2})/) || [])[1] || '',
    };
  }

  async function getHtml(url, init) {
    const res = await fetch(url, { ...opt, ...init });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (/login/i.test(new URL(res.url).pathname)) throw new Error('登入逾時，請重新登入');
    const buf = await res.arrayBuffer();
    let cs = ((res.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || [])[1];
    if (!cs) cs = (new TextDecoder('latin1').decode(buf.slice(0, 3000)).match(/charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
    let html;
    try { html = new TextDecoder(cs).decode(buf); } catch (e) { html = new TextDecoder('utf-8').decode(buf); }
    return { html, url: res.url };
  }
  async function postJson(url, body) {
    const res = await fetch(url, { ...opt, method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(url.split('/').pop() + ' HTTP ' + res.status);
    let v = JSON.parse(await res.text());
    if (v && typeof v === 'object' && 'd' in v) v = v.d;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { /* 純字串 */ } }
    return v;
  }
  // WebForms postback：保留 hidden/text/select，不帶任何按鈕；radio/checkbox 只帶已勾的
  function formBody(doc, target, extra) {
    const form = doc.querySelector('form');
    if (!form || !form.querySelector('input[name="__VIEWSTATE"]')) throw new Error('讀不到表單');
    const body = new URLSearchParams();
    for (const el of form.querySelectorAll('input,textarea,select')) {
      if (!el.name || el.disabled || ['submit', 'button', 'image', 'reset', 'file'].includes(el.type)) continue;
      if (['checkbox', 'radio'].includes(el.type) && !el.hasAttribute('checked')) continue;
      if (el.tagName === 'SELECT') { const o = el.querySelector('option[selected]') || el.querySelector('option'); if (o) body.append(el.name, o.value); continue; }
      body.append(el.name, el.tagName === 'TEXTAREA' ? el.textContent : (el.getAttribute('value') ?? (el.type === 'checkbox' ? 'on' : '')));
    }
    body.set('__EVENTTARGET', target); body.set('__EVENTARGUMENT', '');
    for (const [k, v] of Object.entries(extra || {})) body.set(k, v);
    return { body, action: form.getAttribute('action') || '' };
  }
  const postForm = (url, body) => getHtml(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  // 伺服器靠「最後載入的頁面」記住病人的端點（管路、體重）要排隊
  let chain = Promise.resolve();
  const serial = (fn) => { const job = chain.then(fn, fn); chain = job.catch(() => {}); return job; };

  function sources(P) {
    const now = new Date();
    const outer = async (datatype) => {
      const v = await postJson(SVC + 'OuterData.asmx/GetOuterDataTable', { jsonstring: JSON.stringify({ AccountIdse: P.acct, PersonId: P.personId, ChartNo: P.chart, DeptCode: '', EmpDeptCode: '' }), datatype });
      return (v && v.Html) || '';
    };

    /* ---------- note 清單與內文 ---------- */
    const NOTE_TYPES = ['progress', 'weekly', 'onservice', 'offservice', 'admission', 'transfer'];
    const NOTE_TITLE = /^\s*(weekly|progress|on.?service|off.?service|transfer|admission)/i;
    async function notes() {
      const list = await postJson(SVC + 'Notes.asmx/GetMoreData', { jsonstring: JSON.stringify({
        ChartNo: P.chart, AccountNo: P.acct, LoginHospCode: 'T0', LoginEmpNo: '', _OnlyLatestVersion: 'Y', _IsShowWithoutCancel: 'Y',
        SortingType: 'desc', SessionKey: '', PatientClass: '', FullURLTitle: '', _DTStart: P.adm || ymd(new Date((+new Date()) - 30 * DAY)), _DTEnd: ymd(new Date((+new Date()) + DAY)),
      }) });
      if (!Array.isArray(list)) throw new Error('note 清單格式不符');
      const type = (n) => String(n.NoteType || '').toLowerCase().replace(/[\s_-]+/g, '');
      return list.map((n) => ({ seq: n.CaseSeqNo, ver: n.Version, type: type(n), rawType: n.NoteType, title: dec(n.HandleFullName), ms: tsOf(n.InsertDateTimeFullString) }))
        .filter((n) => Number.isFinite(n.ms) && (NOTE_TYPES.includes(n.type) || (n.type === 'blank' && NOTE_TITLE.test(n.title))))
        .slice(0, 12);
    }
    async function noteText(n) {
      if (n.type === 'admission') return '';
      const c = await postJson(SVC + 'Notes.asmx/GetNoteContent', { jsonstring: JSON.stringify({ AccountIdse: P.acct, CaseSeqNo: n.seq, Version: n.ver, StrInDate: P.adm ? P.adm + ' 00:00' : '', HospCode: 'T0', EmpNo: '', Status: '' }), notetype: n.rawType });
      return [dec(c && c.Content), dec(c && c.BriefSummary)].filter((s) => s.trim()).join('\n\n').replace(/\r/g, '');
    }

    /* ---------- 生命徵象 ---------- */
    async function vitalsOuter() {
      const doc = parse(await outer('vitalsign'));
      let rows = [...doc.querySelectorAll('[id$="_Content"]')].map(txt);
      if (!rows.length) rows = [...doc.querySelectorAll('tr')].map(txt);
      const by = new Map();
      for (const t of rows) {
        const ms = tsOf(t);
        if (!Number.isFinite(ms) || ms < (+new Date()) - 40 * DAY) continue;
        if (!by.has(ms)) by.set(ms, { t: ms });
        const r = by.get(ms);
        let m;
        if ((m = t.match(/\bT:\s*([\d.]+)/))) r.temp = +m[1];
        if ((m = t.match(/\bP:\s*(\d+)/))) r.hr = +m[1];
        if ((m = t.match(/\bR:\s*(\d+)/))) r.rr = +m[1];
        if ((m = t.match(/BP:\s*(\d+)\s*\/\s*(\d+)/))) { r.sys = +m[1]; r.dia = +m[2]; }
        if ((m = t.match(/SpO2:\s*(\d+)\s*%(?:\(([^)]*)\))?/i))) { r.spo2 = +m[1]; r.o2 = (m[2] || '').replace(/,\s*$/, ''); }
        if ((m = t.match(/Pain score:\s*(\d+)/i))) r.pain = +m[1];
      }
      return [...by.values()].filter((r) => (r.temp > 30 && r.temp < 45) || r.hr || r.sys || r.spo2 || r.rr).sort((a, b) => a.t - b.t);
    }

    /* ---------- I/O 總表（護理日 08:00–07:59） ---------- */
    async function io(spanDays) {
      const url = `${base}Nursing/Estimate_IO_Summery.aspx?AccountIDSE=${encodeURIComponent(P.acct)}&SESSION=${encodeURIComponent(P.SESSION)}`;
      const num = (s) => { const n = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
      const tableOf = (doc) => {
        const mark = [...doc.querySelectorAll('td,th,span,label,a')].find((e) => /IO類別統計表/.test(e.textContent) && e.textContent.length < 60);
        return mark ? mark.closest('table') : null;
      };
      const days = new Map(), items = new Map();
      const day = (ms) => { if (!days.has(ms)) days.set(ms, { ms, shifts: {}, partial: true }); return days.get(ms); };
      function read(doc) {
        const t = tableOf(doc);
        const q = tsOf((doc.querySelector('[id$="tbx_QueryDate"]') || {}).getAttribute?.('value'));
        if (!t || !Number.isFinite(q) || /查無資料/.test(t.textContent) || t.rows.length < 3) return false;
        // 10 個數值欄：前天 白/小夜｜大夜/合計（屬前天的護理日）、昨天 白/小夜｜大夜/合計、今天 白/小夜
        const nd = [q - 2 * DAY, q - DAY, q].map(dayStart);
        const slot = [[0, 'd'], [0, 'e'], [0, 'n'], [0, 'total'], [1, 'd'], [1, 'e'], [1, 'n'], [1, 'total'], [2, 'd'], [2, 'e']];
        const body = [...t.rows].slice(2).map((r) => [...r.cells]).filter((c) => txt(c[0]) && c.length >= 11);
        const iIn = body.findIndex((c) => txt(c[0]) === '輸入合計');
        body.forEach((c, idx) => {
          const name = txt(c[0]);
          const vals = c.slice(1, 11).map((x) => num(txt(x)));
          const sum = name === '輸入合計' ? 'in' : name === '輸出合計' ? 'out' : /淨差/.test(name) ? 'net' : null;
          const kind = iIn >= 0 && idx < iIn ? 'in' : 'out';
          slot.forEach(([di, key], i) => {
            const d = day(nd[di]);
            if (sum) {
              if (key === 'total') { d[sum] = vals[i]; d.partial = false; } else { d.shifts[key] = d.shifts[key] || {}; d.shifts[key][sum] = vals[i]; }
            } else {
              const id = kind + '|' + name;
              if (!items.has(id)) items.set(id, { name, kind, by: {} });
              const it = items.get(id);
              it.by[nd[di]] = it.by[nd[di]] || {};
              it.by[nd[di]][key] = vals[i];
            }
          });
        });
        return true;
      }
      let { html, url: u } = await getHtml(url);
      let doc = parse(html);
      if (/查無資料/.test((tableOf(doc) || doc.body).textContent) && !doc.querySelector('[id$="cbItemCodeStatistic"]')) return { days: [], items: [] };
      const cb = doc.querySelector('[id$="cbItemCodeStatistic"]');
      const dateBox = doc.querySelector('[id$="tbx_QueryDate"]');
      if (!cb || !dateBox) throw new Error('I/O 總表頁面格式改變');
      const act = (d) => new URL(d.querySelector('form').getAttribute('action') || url, u).href;
      // 切到「種類統計表」，一條引流管一列
      let fb = formBody(doc, cb.name, { [cb.name]: 'on' });
      doc = parse((await postForm(act(doc), fb.body)).html);
      read(doc);
      // 每次查詢給 3 個護理日；往回每 2 天查一次，直到涵蓋要的天數（最多 30 天）
      const lastBack = Math.max(4, Math.min(30, spanDays || 7) - 3);
      for (let back = 2; back <= lastBack; back += 2) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
        fb = formBody(doc, dateBox.name, { [dateBox.name]: ymd(d), [cb.name]: 'on' });
        doc = parse((await postForm(act(doc), fb.body)).html);
        if (!read(doc)) break;
      }
      const list = [...days.values()].sort((a, b) => a.ms - b.ms).map((d) => {
        if (d.partial) {
          const s = Object.values(d.shifts);
          d.in = s.reduce((n, x) => n + (x.in || 0), 0); d.out = s.reduce((n, x) => n + (x.out || 0), 0); d.net = d.in - d.out;
        }
        d.in = d.in || 0; d.out = d.out || 0; d.net = d.net ?? d.in - d.out;
        return d;
      }).filter((d) => d.ms <= dayStart(now.getTime()));
      const tot = (it, ms, partial) => { const b = it.by[ms] || {}; return partial ? (b.d || 0) + (b.e || 0) + (b.n || 0) : (b.total ?? (b.d || 0) + (b.e || 0) + (b.n || 0)); };
      return { days: list, items: [...items.values()].map((it) => ({ name: it.name, kind: it.kind, vals: list.map((d) => tot(it, d.ms, d.partial)) })).filter((it) => it.vals.some((v) => v)) };
    }

    /* ---------- 檢驗（含培養與藥敏） ---------- */
    async function labs(days) {
      const span = Math.max(14, Math.min(120, Math.round(days || 14)));
      const url = `${ORIGIN}/WebApplication/ElectronicMedicalReportViewer/MedicalReportContent.aspx?SESSION=${encodeURIComponent(P.SESSION)}&PatClass=I&WardCode=${encodeURIComponent(P.ward)}&ChartNo=${encodeURIComponent(P.chart)}&HospitalCode=T0&Seed=&IntervalDay=-${span - 1}`;
      const doc = parse((await getHtml(url)).html);
      const s = window.PNLabSummary ? window.PNLabSummary.structured(doc, P.sex) : null;
      return { summary: s, micro: micro(doc) };
    }
    const MICRO_RE = /Culture|ID\+DS|ID C\.|ID Campy|Anaerobic|Gram'?s|AF Stain|AFS|Fung|KOH|India ink|screening/i;
    const STAIN_RE = /Gram'?s|Stain|KOH|India ink/i;
    function micro(doc) {
      const out = [];
      for (const head of doc.querySelectorAll('div.logInGroup')) {
        let sheet = head.nextElementSibling;
        while (sheet && !(sheet.tagName === 'TABLE' && /DetailedSheet/.test(sheet.className))) { if (/logInGroup/.test(sheet.className || '')) { sheet = null; break; } sheet = sheet.nextElementSibling; }
        if (!sheet) continue;
        const rows = [...sheet.querySelectorAll('tbody tr')].map((r) => [...r.cells].map(txt)).filter((c) => c.length >= 2 && c[0] && c[0] !== '檢驗項目');
        if (!rows.some((c) => MICRO_RE.test(c[0]))) continue;
        const h = txt(head);
        const spec = txt(head.querySelector('.dlSpecimenName')) || (h.match(/No:\S+\s+(.*?)\s*採檢/) || [])[1] || '';
        const e = { no: (h.match(/No:\s*(\S+)/) || [])[1] || '', spec, t: tsOf((h.match(/採檢:\s*([\d/]+\s+[\d:]+)/) || [])[1]), reported: tsOf((h.match(/最後報告:\s*([\d/]+\s+[\d:]+)/) || [])[1]), stain: [], orgs: [], neg: [], prelim: false, sens: [] };
        for (const c of rows) {
          const [name, val, , ref, remark] = c;
          if (!MICRO_RE.test(name)) continue;
          if (/待確認/.test(remark || '')) e.prelim = true;
          if (STAIN_RE.test(name)) { if (!/Epithelial|PMN|Mononuclear/i.test(val)) e.stain.push(val); continue; }
          const flat = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
          const isNeg = /no growth|no aerobic\s+pathogen|no anaerobic\s+pathogen|^Undetectable$|^Negative$|^No Fungus$|normal flora|mixed flora/i.test(val) || /^No\s/i.test(val) || (!!ref && flat(val) === flat(ref));
          const mark = ['Carbapenem-resistant', 'ESBL', 'MRSA', 'VRE', 'MDR'].find((k) => (remark || '').includes(k));
          if (isNeg) e.neg.push(val); else e.orgs.push({ item: name, name: val.replace(/Multiple colonial morphotypes present[;,]\s*/i, ''), mark: mark === 'Carbapenem-resistant' ? 'CR' : mark || '' });
        }
        const ab = sheet.nextElementSibling;
        if (ab && ab.tagName === 'TABLE' && /labAntiBiotic/.test(ab.className)) {
          const groups = [...ab.rows[0].cells].slice(1).map((c) => txt(c));
          const drugs = [...ab.rows].slice(2).map((r) => [...r.cells].map(txt)).filter((c) => c[0]);
          groups.forEach((g, gi) => {
            const list = drugs.map((c) => { const [code, ...rest] = c[0].split(':'); return { code: code.trim(), drug: (rest.join(':') || code).trim(), sir: (c[1 + gi * 3] || '').trim(), mic: (c[2 + gi * 3] || '').trim(), note: (c[3 + gi * 3] || '').trim() }; }).filter((x) => x.sir || x.mic);
            const org = e.orgs.filter((o) => o.item === g).map((o) => o.name).join(' / ') || (e.orgs.length === 1 ? e.orgs[0].name : g);
            if (list.length) e.sens.push({ item: g, org, list });
          });
        }
        out.push(e);
      }
      return out.sort((a, b) => b.t - a.t);
    }

    /* ---------- 未發送檢驗進度 ---------- */
    async function pending() {
      const qs = new URLSearchParams({ SESSION: P.SESSION, hfdChartNo: P.chart, hfdPatName: '', hdfHospData: P.chart + '_T0', Personid: P.personId });
      const doc = parse((await getHtml(`${ORIGIN}/WebApplication/ElectronicMedicalReportViewer/ExternalPage/UnConfirmedLabReportOpen.aspx?${qs}`)).html);
      const out = [];
      for (const t of doc.querySelectorAll('table')) {
        if (t.querySelector('table') || !t.rows.length || t.rows[0].cells.length < 3 || !/檢驗項目/.test(t.rows[0].textContent)) continue;
        let headText = '';
        for (let n = t.previousSibling; n && !(n.nodeType === 1 && n.tagName === 'TABLE'); n = n.previousSibling) headText = (n.textContent || '') + ' ' + headText;
        if (!/登記/.test(headText)) headText = txt(t.parentElement).split('檢驗項目')[0];
        headText = headText.replace(/\s+/g, ' ');
        const reg = (headText.match(/登記:\s*([\d/]+\s+[\d:]+)/g) || []).pop() || '';
        out.push({
          t: tsOf(reg), spec: ((headText.match(/檢體:\s*(.+?)\s*科室:/g) || []).pop() || '').replace(/^檢體:\s*|\s*科室:$/g, ''),
          no: ((headText.match(/No:\s*(\S+)/g) || []).pop() || '').replace(/^No:\s*/, ''),
          items: [...new Map([...t.rows].slice(1).map((r) => [...r.cells].map(txt)).filter((c) => c[0]).map((c) => [c[0].replace(/\s*#\d+$/, ''), { name: c[0].replace(/\s*#\d+$/, ''), spec: c[1] || '', state: (c[2] || '').replace(/\(.*$/, '') }])).values()],
        });
      }
      return out.filter((e) => e.items.length).sort((a, b) => b.t - a.t);
    }

    /* ---------- 用藥：今日現行處方＋PRN 實際給藥 ---------- */
    const realTs = (v0) => { const v = tsOf(v0); return Number.isFinite(v) && v > 946684800000 ? v : null; };
    async function mar(fromMs) {
      const g = (el, k) => el.querySelector(':scope > ' + k)?.textContent?.trim() || '';
      const days = [];
      const first = Math.max(dayStart(fromMs || (+new Date())), dayStart((+new Date())) - 4 * DAY);
      for (let d = new Date(first); d.getTime() <= now.getTime(); d.setDate(d.getDate() + 1)) days.push(new Date(d));
      const given = []; let today = [];
      for (const d of days) {
        const qs = new URLSearchParams({ Mode: 'Query', AccountIDSE: P.acct, Personid: P.personId, Year: String(d.getFullYear()), Month: two(d.getMonth() + 1), Day: two(d.getDate()) });
        const res = await fetch(`${base}Ward/AsynchronousProcessHandler.ashx?${qs}`, opt);
        if (!res.ok) throw new Error('給藥紀錄 HTTP ' + res.status);
        const x = new DOMParser().parseFromString(await res.text(), 'text/xml');
        if (x.documentElement.localName !== 'ObjectSerializer') throw new Error('給藥紀錄格式不符');
        const drugs = [...x.querySelectorAll('Today > ActiveDrugs')].filter((el) => g(el, 'IsEmer') !== 'Y');
        if (d.toDateString() === now.toDateString()) {
          today = drugs.filter((el) => g(el, 'OrderStatus') !== 'D').map((el) => ({
            id: g(el, 'PhrOrderIdse'), name: g(el, 'TradeEngNameComplex') || g(el, 'TradeEngName'), generic: g(el, 'GenericName'),
            dose: (g(el, 'DoseAndUnit') || g(el, 'OrderDose') + ' ' + g(el, 'DoseUnit')).replace(/<[^>]*>[\s\S]*$/, '').trim(), route: g(el, 'RouteCode'), freq: g(el, 'RepeatPatternCode'),
            start: realTs(g(el, 'StartDateTime')) || realTs(g(el, 'StartDateTimeShowHH').replace(/(\d{4}\/\d{2}\/\d{2})\s+(\d{1,2})$/, '$1 $2:00')), end: realTs(g(el, 'EndDateTime')), special: g(el, 'SpecialOrder').replace(/^特殊醫囑:\s*/, ''),
            atc: [...el.querySelectorAll(':scope > DrugATCCodes > string')].map((s) => s.textContent.trim()).filter(Boolean),
          }));
        }
        for (const el of drugs) {
          const freq = g(el, 'RepeatPatternCode');
          if (!/PRN|STAT|^ST$|ONCE/i.test(freq)) continue;
          for (const r of el.querySelectorAll('MAR > DrugGivenList')) {
            if (g(r, 'IDSE') === '0' || g(r, 'Disposition') !== '0') continue;
            given.push({ ms: new Date(d.getFullYear(), d.getMonth(), d.getDate(), +g(r, 'Hour') || 0, +g(r, 'Minute') || 0).getTime(), id: g(el, 'PhrOrderIdse'), name: g(el, 'TradeEngNameComplex') || g(el, 'TradeEngName'), dose: (g(r, 'OrderDoseUsed') || g(el, 'OrderDose')) + g(el, 'DoseUnit'), freq, route: g(el, 'RouteCode') });
          }
        }
      }
      const seen = new Set();
      today = today.filter((x) => { const k = `${x.name}|${x.dose}|${x.freq}|${x.route}`; if (seen.has(k)) return false; seen.add(k); return true; });
      return { today, given: given.sort((a, b) => a.ms - b.ms) };
    }

    /* ---------- 抗生素日程（藥歷，近 31 天） ---------- */
    function abxBrand(full) {
      let s = String(full || '').replace(/^\s*\[自備藥\]\s*/, '').replace(/[（(]\s*管\s*\d+\s*[）)]/g, ' ').replace(/\(\s*as\b[^)]*\)/gi, ' ');
      const q = s.indexOf('('); if (q >= 0) s = s.slice(q + 1);
      const toks = s.replace(/[()（）]/g, ' ').trim().split(/\s+/);
      for (const t of toks) { if (!t || /^[一-鿿㐀-䶿]/.test(t) || /^\d/.test(t)) continue; return t.replace(/[,;]+$/, ''); }
      return toks.find(Boolean) || s.trim();
    }
    async function abx() {
      const url = `${ORIGIN}/WebApplication/OtherIndependentProj/MedicationHistory/Default.aspx?SESSION=${encodeURIComponent(P.SESSION)}&PersonID=${encodeURIComponent(P.personId)}`;
      let doc = parse((await getHtml(url)).html);
      const query = (d) => {
        const form = d.querySelector('form');
        const btn = d.querySelector('[id$="_btnQuery"]'), anti = d.querySelector('[id$="_ckbAntibiotics"]');
        const date = d.querySelector('[id$="_txbStartDate"]'), days = d.querySelector('[id$="_txbDays"]');
        const types = [...d.querySelectorAll('input[id*="_cblPatientType_"]')];
        if (!form || !btn || !anti || !date || !days || !types.length || !form.querySelector('input[name="__VIEWSTATE"]')) throw new Error('藥歷查詢表單讀不到');
        const body = new URLSearchParams();
        for (const el of form.querySelectorAll('input')) {
          if (!el.name || el.disabled || ['submit', 'button', 'checkbox', 'radio'].includes(el.type)) continue;
          body.append(el.name, el.getAttribute('value') ?? '');
        }
        body.set('__EVENTTARGET', ''); body.set('__EVENTARGUMENT', '');
        // 從今天往回查：至少 31 天；住院比較久就查到入院日（多抓 2 天），上限 400 天
        const admMs = tsOf(P.adm ? P.adm + ' 00:00' : '');
        const back = Number.isFinite(admMs) ? Math.ceil((now.getTime() - admMs) / DAY) + 2 : 31;
        body.set(date.name, ymd(now)); body.set(days.name, String(Math.max(31, Math.min(400, back))));
        for (const el of types) body.set(el.name, el.getAttribute('value') ?? 'on');
        const all = d.querySelector('[id$="_ckbPatientTypeAll"]'); if (all) body.set(all.name, all.getAttribute('value') ?? 'on');
        body.set(anti.name, anti.getAttribute('value') ?? 'on'); body.set(btn.name, btn.getAttribute('value') ?? '');
        return body;
      };
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        doc = parse((await getHtml(url, { method: 'POST', body: query(doc) })).html);
        const sel = [...doc.querySelectorAll('input[type="checkbox"][checked]')].filter((el) => /_ckb/.test(el.id) && !/_ckbPatientTypeAll$/.test(el.id));
        ok = sel.length === 1 && sel[0].id.endsWith('_ckbAntibiotics');
      }
      if (!ok) throw new Error('藥歷未套用抗生素分類');
      const tb = doc.querySelector('[id$="_grvData"]');
      if (!tb) {
        if (txt(doc.querySelector('[id$="_lblMessage"]')).includes('查無')) return [];
        throw new Error('藥歷結果表讀不到');
      }
      const H = [...tb.rows[0].cells].map(txt);
      const [iStart, iStop, iName, iContent] = ['開始日', '停用日', '藥名', '處方內容'].map((n) => H.indexOf(n));
      if ([iStart, iStop, iName, iContent].some((i) => i < 0)) throw new Error('藥歷欄位格式改變');
      const today = dayStart(now.getTime());
      const groups = new Map();
      for (const tr of [...tb.rows].slice(1)) {
        if (txt(tr.cells[0]) !== '住') continue;
        const s = tsOf(txt(tr.cells[iStart])); if (!Number.isFinite(s) || s > today) continue;
        const st = tsOf(txt(tr.cells[iStop]));
        const raw = txt(tr.cells[iName]); const brand = abxBrand(raw);
        const name = (brand && !/^\d/.test(brand) ? brand : raw.split('(')[0].trim()).slice(0, 40);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push({ s, e: Number.isFinite(st) ? st : null, generic: raw.split('(')[0].trim(), rx: txt(tr.cells[iContent]) });
      }
      return [...groups].map(([name, os]) => {
        const live = os.filter((o) => o.e === null || o.e >= today);
        const newest = (live.length ? live : os).slice().sort((a, b) => b.s - a.s)[0];
        return {
          name, generic: newest.generic, start: Math.min(...os.map((o) => o.s)), end: live.length ? null : Math.max(...os.map((o) => o.e)),
          dose: newest.rx.replace(/\s*for\s.*$/i, '').replace(/\s*分\s*\d+\s*天.*$/, '').replace(/\s+/g, ' ').trim().slice(0, 60),
        };
      }).sort((a, b) => (a.end === null) === (b.end === null) ? b.start - a.start : a.end === null ? -1 : 1);
    }

    /* ---------- 醫囑變更 ---------- */
    async function orders() {
      const url = `${base}Nursing/WorkList_OrderCheck.aspx?SESSION=${encodeURIComponent(P.SESSION)}&PatClass=I&AccountIDSE=${encodeURIComponent(P.acct)}&PersonID=${encodeURIComponent(P.personId)}&Hosp=T0&Seed=&EMRPop=Y`;
      let { html, url: u } = await getHtml(url); let doc = parse(html);
      const checked = (d) => (d.querySelector('input[type="radio"][name$="rbl_SignStatus"][checked]') || {}).value;
      if (checked(doc) !== 'A') {
        const all = doc.querySelector('input[type="radio"][name$="rbl_SignStatus"][value="A"]');
        if (!all) throw new Error('醫囑簽收頁讀不到「全部」選項');
        const idx = (all.id.match(/_(\d+)$/) || [])[1];
        const { body, action } = formBody(doc, `${all.name}$${idx}`, { [all.name]: 'A' });
        ({ html } = await getHtml(new URL(action, u).href, { method: 'POST', body })); doc = parse(html);
        if (checked(doc) !== 'A') throw new Error('沒有切到「全部」');
      }
      const acct = txt(doc.querySelector('[id$="lbl_CaseNo"]')) || txt(doc.querySelector('[id$="lblCaseNo"]'));
      if (acct && acct !== P.acct) throw new Error('醫囑簽收頁與病人不符，已丟棄');
      const tb = doc.querySelector('[id$="gv_OrderList"]'); if (!tb) return { items: [], rows: [] };
      const head = tb.querySelector('thead tr') || tb.rows[0];
      const H = [...head.cells].map((c) => txt(c).replace(/\s+/g, '')); const col = (n) => H.indexOf(n);
      const [iType, iAct, iStart, iEnd, iName] = ['類別', '狀態', '起日', '迄日', '醫令名稱'].map(col);
      const items = [], rows = [];
      for (const tr of tb.querySelectorAll('tr')) {
        if (tr === head || tr.querySelector('th')) continue;
        const c = tr.cells, title = tr.getAttribute('title') || '';
        if (c.length !== H.length) continue;
        const om = title.match(/開立日\s*[:：]\s*(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
        const cell = c[iName].cloneNode(true); for (const b of cell.querySelectorAll('b')) b.before(' ');
        const name = txt(cell).replace(/\s*計價別\s*[:：].*$/, '');
        const sd = (iStart >= 0 && txt(c[iStart]).match(/^(?:\d{4}\/)?(\d{1,2})\/(\d{1,2})/)) || (om && [null, om[1], om[2]]);
        if (sd) rows.push({ type: iType >= 0 ? txt(c[iType]) : '', act: txt(c[iAct]), startDay: +sd[1] * 100 + +sd[2], startMd: `${sd[1].padStart(2, '0')}/${sd[2].padStart(2, '0')}`, name });
        if (!om) continue;
        const sm = title.match(/簽收日\s*[:：]\s*(\d{4})\/(\d{1,2})/);
        const y = sm ? +sm[1] - (+om[1] > +sm[2] ? 1 : 0) : now.getFullYear();
        let ms = new Date(y, om[1] - 1, +om[2], +om[3], +om[4]).getTime(); if (!sm && ms > (+new Date())) ms = new Date(y - 1, om[1] - 1, +om[2], +om[3], +om[4]).getTime();
        const end = iEnd >= 0 ? txt(c[iEnd]) : '';
        items.push({ ms, type: iType >= 0 ? txt(c[iType]) : '', act: txt(c[iAct]), name, end: end && !/長期/.test(end) ? end : '' });
      }
      return { items: items.sort((a, b) => a.ms - b.ms), rows, paged: !!doc.querySelector('a[href*="Page$"]') };
    }

    /* ---------- 護理過程紀錄 ---------- */
    async function nursing() {
      const url = `${base}Nursing/NursingProgressNote.aspx?SESSION=${encodeURIComponent(P.SESSION)}&AccountIDSE=${encodeURIComponent(P.acct)}`;
      let { html, url: u } = await getHtml(url); let doc = parse(html);
      let grid = doc.querySelector('[id$="gv_List"]');
      if (!grid || grid.rows.length <= 1) {
        const lab = [...doc.querySelectorAll('label')].find((l) => /顯示紀錄/.test(l.textContent));
        const cb = lab && doc.getElementById(lab.getAttribute('for'));
        if (!cb) throw new Error('找不到「顯示紀錄」');
        const { body, action } = formBody(doc, cb.name, { [cb.name]: 'on' });
        ({ html } = await getHtml(new URL(action, u).href, { method: 'POST', body })); doc = parse(html);
        grid = doc.querySelector('[id$="gv_List"]');
      }
      if (!grid || grid.rows.length <= 1) return [];
      const out = [];
      for (const tr of [...grid.rows].slice(1)) {
        const c = [...tr.cells].map((x) => x.textContent.replace(/\s+/g, ' ').trim());
        const m = (c[0] || '').match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/); if (!m) continue;
        let ms = new Date(now.getFullYear(), m[1] - 1, +m[2], +m[3], +m[4]).getTime(); if (ms > (+new Date()) + DAY) ms = new Date(now.getFullYear() - 1, m[1] - 1, +m[2], +m[3], +m[4]).getTime();
        out.push({ ms, text: [c[1], c[2], c[3]].filter(Boolean).join('｜') });
      }
      return out.sort((a, b) => b.ms - a.ms);
    }

    /* ---------- 護理交班筆記（Ward/OffDutyNurV2.aspx 的 txbMsgNote，只讀） ---------- */
    async function handoff() {
      const { html } = await getHtml(`${base}Ward/OffDutyNurV2.aspx?SESSION=${encodeURIComponent(P.SESSION)}&InQuerySortMode=QByEmp&AccountIDSE=${encodeURIComponent(P.acct)}&Type=Nur`);
      const el = parse(html).querySelector('textarea[id$="txbMsgNote"]');
      if (!el) throw new Error('頁面沒有交班筆記欄');
      return el.textContent.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    }

    /* ---------- 影像報告 ---------- */
    async function pacs() {
      const doc = parse(await outer('pacs'));
      const out = [];
      for (const tr of doc.querySelectorAll('tbody tr')) {
        const content = [...tr.querySelectorAll('td')].map((td) => td.textContent).find((t) => t.includes('@@@'));
        if (!content) continue;
        const seg = content.split('@@@').map((s) => s.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim());
        const ms = tsOf(seg[0]); if (!Number.isFinite(ms)) continue;
        const body = (seg[2] || seg[1] || '').trim();
        const imp = (body.match(/\b(?:impression|imp|conclusion)\b\s*[:：]\s*([\s\S]+)$/i) || body.match(/\bfindings?\b\s*[:：]\s*([\s\S]+)$/i) || [])[1] || '';
        out.push({ ms, title: seg[0].replace(/^\d{4}\/\d{2}\/\d{2}\s*/, '').replace(/\s*\(V\d+\)\s*$/, ''), body, imp: (imp.trim() || body).replace(/\s+/g, ' ') });
      }
      return out.sort((a, b) => b.ms - a.ms);
    }

    /* ---------- 管路、體重（伺服器記住目前病人，要排隊） ---------- */
    const tubes = () => serial(() => patientLock(async () => {
      await getHtml(`${base}Nursing/CatheterCare.aspx?session=${encodeURIComponent(P.SESSION)}&AccountIDSE=${encodeURIComponent(P.acct)}&PatClass=I`);
      const res = await fetch(`${base}Nursing/CatheterCare_Handler.aspx?aa=${(+new Date())}&mode=getCatheterRecord&catherStatus=UnRemovedOnly`, opt);
      const x = new DOMParser().parseFromString(await res.text(), 'text/xml');
      const tt = (n, t) => (n.getElementsByTagName(t)[0] || {}).textContent?.trim() || '';
      const decs = [...x.getElementsByTagName('decorate')];
      if (decs.some((d) => tt(d, 'caseno') !== String(P.acct))) throw new Error('管路資料與病人不符，已丟棄');
      return decs.map((d) => ({ name: tt(d, 'CatheterName'), since: tsOf(tt(d, 'CatheterInsertDateTime')) })).filter((s) => s.name && !/留置針|IV\s*Catheter/i.test(s.name));
    }));
    // 生命徵象頁的查詢介面：TPR、血壓、SpO2、體重都能指定日期範圍。
    // 不帶病人識別，伺服器回「最後載入 TPR 頁的病人」，所以要排隊
    // 生命徵象與管路的查詢都不帶病人識別（伺服器回「最後載入那一頁的病人」）。同一個瀏覽器開了兩位病人的分頁時，
    // 兩邊的「載入頁面→查詢」不能交錯，所以用跨分頁的 Web Lock 包起來（瀏覽器不支援就只剩同頁排隊）
    const patientLock = (fn) => (navigator.locks && navigator.locks.request ? navigator.locks.request('pnw-nursing-session', fn) : fn());
    const tpr = (days) => serial(() => patientLock(async () => {
      const span = Math.max(7, Math.min(60, Math.round(days || 7)));
      const tprUrl = `${base}Nursing/VitalSign_TPR.aspx?session=${encodeURIComponent(P.SESSION)}&AccountIDSE=${encodeURIComponent(P.acct)}`;
      const rangeStr = (d, hms) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}-${hms}`;
      const query = async (group, daysBack) => {
        const n = new Date(); const from = new Date(n); from.setDate(from.getDate() - daysBack);
        const start = rangeStr(from, '00:00:00'), end = rangeStr(n, '23:59:59');
        const cur = `${n.getFullYear()}/${n.getMonth() + 1}/${n.getDate()} ${n.getHours()}:${n.getMinutes()}:${n.getSeconds()}`;
        const qs = `check=${encodeURIComponent(n.toString())}&SerialNo=undefined&RecordAreaID=${encodeURIComponent(`VitalSign_${group}_${start}_${end}`)}&Kind=VitalSign&Group=${group}`
          + `&StartDateTime=${encodeURIComponent(start)}&EndDateTime=${encodeURIComponent(end)}&CurrentDateTime=${encodeURIComponent(cur)}&Type=init`;
        const res = await fetch(`${base}Nursing/VitalSign_getPopupWindowData.aspx?${qs}`, opt);
        if (!res.ok) throw new Error('生命徵象 HTTP ' + res.status);
        const xml = await res.text();
        if (/^\s*並未將物件參考/.test(xml)) throw new Error('伺服器未鎖定病人');
        if (!new RegExp(`FieldGroup=['"]${group}['"]`).test(xml)) throw new Error('生命徵象資料格式不符');
        const recs = [];
        for (const m of xml.matchAll(/<TableRecordContent\b[^>]*>([\s\S]*?)<\/TableRecordContent>/g)) {
          const tag = (k) => { const x = m[1].match(new RegExp('<' + k + '>([\\s\\S]*?)</' + k + '>')); return x ? x[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim() : ''; };
          const ms = tsOf(tag('attTime')), st = tag('attStatus');
          if (Number.isFinite(ms) && !/^D/i.test(st)) recs.push({ ms, v: tag('attValue'), st });
        }
        // 同一時間有多個版本時只留狀態 N（正常）的那筆
        const by = new Map();
        for (const r of recs) { const o = by.get(r.ms); if (!o || (o.st !== 'N' && r.st === 'N')) by.set(r.ms, r); }
        return [...by.values()].sort((x, y) => x.ms - y.ms);
      };
      await (await fetch(tprUrl, opt)).arrayBuffer();
      await (await fetch(`${base}Nursing/VitalSign_arrangeFieldGroupHandler.aspx?aa=${encodeURIComponent(new Date().toString())}`, opt)).text();
      const collect = async () => {
        const by = new Map();
        const at = (ms) => { if (!by.has(ms)) by.set(ms, { t: ms }); return by.get(ms); };
        for (const r of await query('TPR', span)) {
          const m = r.v.match(/^\s*([\d.]+)?\s*\/\s*(\d+)?\s*\/\s*(\d+)?/); if (!m) continue;
          const o = at(r.ms);
          if (m[1] && +m[1] > 30 && +m[1] < 45) o.temp = +m[1];
          if (m[2]) o.hr = +m[2];
          if (m[3]) o.rr = +m[3];
        }
        for (const r of await query('BloodPressure', span)) { const m = r.v.match(/(\d+)\s*\/\s*(\d+)/); if (m) { const o = at(r.ms); o.sys = +m[1]; o.dia = +m[2]; } }
        for (const r of await query('SpO2', span)) { const m = r.v.match(/(\d+)\s*%(?:\(([^)]*)\))?/); if (m) { const o = at(r.ms); o.spo2 = +m[1]; o.o2 = (m[2] || '').replace(/-%|,?-L|,\s*$/g, ''); } }
        const weights = (await query('PhysicalWeight', Math.max(14, span))).map((r) => ({ ms: r.ms, kg: parseFloat(r.v) })).filter((r) => r.kg > 0);
        return { vitals: [...by.values()].sort((x, y) => x.t - y.t), weights };
      };
      try { return await collect(); } catch (e) { if (!/未鎖定病人/.test(String(e && e.message))) throw e; }
      // 這個登入階段還沒開過生命徵象頁時，上面的查詢會回「並未將物件參考…」。
      // 跟批次腳本一樣：用隱藏 iframe 把 TPR 頁完整載入一次（只是開頁面，不送出任何東西），再查一次
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const fr = document.createElement('iframe');
      fr.style.cssText = 'position:fixed;left:-3000px;top:0;width:1200px;height:900px;visibility:hidden';
      fr.setAttribute('aria-hidden', 'true'); fr.tabIndex = -1;
      fr.src = tprUrl;
      try {
        document.body.appendChild(fr);
        const t0 = (+new Date());
        for (;;) {
          await sleep(300);
          let ready = false;
          try { const d = fr.contentDocument; ready = !!(d && d.readyState === 'complete' && d.body && d.body.innerHTML.length > 1000); } catch (e) { /* 載入中 */ }
          if (ready) break;
          if ((+new Date()) - t0 > 20000) throw new Error('生命徵象頁載入逾時');
        }
        // 頁面載完後，它自己的程式還要再跟伺服器要幾次資料才算初始化完成：每秒重試，最多 8 次
        let last;
        for (let i = 0; i < 8; i++) {
          await sleep(i ? 1000 : 800);
          try { return await collect(); } catch (e) { if (!/未鎖定病人/.test(String(e && e.message))) throw e; last = e; }
        }
        throw last;
      } finally { fr.remove(); }
    }));

    return { notes, noteText, tpr, vitalsOuter, io, labs, pending, mar, abx, orders, nursing, handoff, pacs, tubes };
  }

  return { context, sources, tsOf, dayStart, DAY };
})();
if (typeof window !== 'undefined') window.PNW_HIS = PNW_HIS;

const PNW_CSS = ":host {\n  all: initial;\n  --shell: #0f3540; --shell-2: #1a4855; --shell-line: #2c5b68; --on-shell: #eef5f6; --on-shell-dim: #b3cbd0;\n  --ground: #e6ecec; --panel: #ffffff; --head: #f1f5f5; --line: #cfd9da; --line-soft: #e4eaeb;\n  --ink: #12282e; --ink-2: #41585f; --ink-3: #5a7078;\n  --accent: #0b6676; --accent-ink: #084c58; --accent-bg: #dceef1; --since: #eaf5f6;\n  --hi: #ad1f2d; --hi-bg: #fde6e8; --lo: #1a59a0; --lo-bg: #e1edfa;\n  --ok: #1c6f37; --ok-bg: #dff2e3; --warn: #7d5200; --warn-bg: #fbecc8; --mute-bg: #e9eeee;\n  --ui: \"Segoe UI Variable Text\", \"Segoe UI\", \"Microsoft JhengHei UI\", \"PingFang TC\", system-ui, sans-serif;\n  --ease: cubic-bezier(.16, 1, .3, 1);\n}\n*, *::before, *::after { box-sizing: border-box; }\n* { scrollbar-width: thin; scrollbar-color: #b4c3c6 transparent; }\n::selection { background: #b9dfe6; color: var(--ink); }\nbutton, select { font: inherit; color: inherit; cursor: pointer; }\n:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-radius: 3px; }\nh2, p, ul { margin: 0; padding: 0; }\nul { list-style: none; }\n.ic { width: 16px; height: 16px; flex: none; }\n\n.dock {\n  position: fixed; top: 0; right: 0; bottom: 0; width: var(--dock-w, 1220px); z-index: 2147483000;\n  display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto minmax(0, 1fr);\n  background: var(--ground); color: var(--ink); border-left: 1px solid #7f979c;\n  font: 13px/1.45 var(--ui); font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased; text-align: left;\n}\n.dock[hidden] { display: none; }\n.reopen {\n  position: fixed; right: 0; top: 40%; z-index: 2147483000; writing-mode: vertical-rl;\n  padding: 10px 5px; border: 0; border-radius: 6px 0 0 6px; background: var(--shell); color: var(--on-shell); font: 600 13px var(--ui); letter-spacing: .1em;\n}\n.reopen[hidden] { display: none; }\n\n/* 工具列 */\n.bar { display: flex; align-items: center; gap: 10px; height: 38px; min-width: 0; padding: 0 8px 0 12px; background: var(--shell); color: var(--on-shell); white-space: nowrap; }\n.bar > * { flex: none; }\n.bar :focus-visible { outline-color: #9fe0ea; }\n.bar b { font-size: 14px; font-weight: 650; }\n.bar .dim { color: var(--on-shell-dim); font-size: 12px; }\n.bar .status { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--on-shell-dim); font-size: 12.5px; }\n.bar .status.done { color: #c9f1c9; font-weight: 600; }\n.bar .status.warn { color: #ffd98a; font-weight: 600; }\n.bar select { height: 26px; max-width: 210px; border: 1px solid var(--shell-line); border-radius: 5px; background: var(--shell-2); color: var(--on-shell); font-size: 12.5px; padding: 0 4px; }\n.seg { display: flex; border: 1px solid var(--shell-line); border-radius: 5px; overflow: hidden; }\n.seg button { border: 0; background: none; color: var(--on-shell-dim); padding: 3px 9px; font-size: 12.5px; }\n.seg button + button { border-left: 1px solid var(--shell-line); }\n.seg button:hover { color: var(--on-shell); background: var(--shell-2); }\n.seg button[aria-pressed=\"true\"] { background: var(--on-shell); color: var(--shell); font-weight: 600; }\n.bar-btn { display: flex; align-items: center; gap: 5px; height: 26px; padding: 0 8px; border: 1px solid var(--shell-line); border-radius: 5px; background: none; color: var(--on-shell); font-size: 12.5px; }\n.bar-btn:hover { background: var(--shell-2); }\n.bar-btn[aria-pressed=\"true\"] { background: var(--shell-2); border-color: #5d8d99; }\n\n/* 時間軸 */\n.tl { display: grid; grid-template-columns: 196px minmax(0, 1fr); background: var(--panel); border-bottom: 1px solid var(--line); }\n.tl-legend { background: var(--head); border-right: 1px solid var(--line); }\n.tl-leg { display: flex; align-items: center; gap: 7px; padding: 0 6px 0 10px; border-top: 1px solid var(--line-soft); white-space: nowrap; overflow: hidden; }\n.tl-leg:first-child { border-top: 0; }\n.tl-leg .n { width: 38px; color: var(--ink-2); font-size: 12px; flex: none; }\n.tl-leg .v { font-size: 14px; font-weight: 650; }\n.tl-leg .v.hi { color: var(--hi); }\n.tl-leg .v.lo { color: var(--lo); }\n.tl-leg .s { color: var(--ink-3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }\n.tl-leg.abx { flex-direction: column; align-items: stretch; justify-content: center; gap: 0; padding-top: 2px; }\n.tl-leg.abx div { display: flex; gap: 8px; height: 17px; align-items: center; font-size: 12px; overflow: hidden; }\n.tl-leg.abx b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }\n.tl-leg.axis { justify-content: space-between; color: var(--ink-3); font-size: 12px; }\n.tl-leg .ib { margin-left: auto; }\n.tl-plot { position: relative; min-width: 0; }\n#tlSvg { display: block; width: 100%; }\n#tlSvg text { font-family: var(--ui); font-size: 11px; fill: var(--ink-3); font-variant-numeric: tabular-nums; }\n.tl-since { fill: var(--since); }\n.tl-sep { stroke: var(--line-soft); }\n.tl-day { stroke: var(--line); }\n.tl-tick { stroke: var(--line-soft); }\n.tl-thr { stroke: var(--hi); stroke-dasharray: 3 3; opacity: .55; }\n.tl-line { fill: none; stroke: var(--ink-2); stroke-width: 1.5; stroke-linejoin: round; }\n.tl-line.t { stroke: #7a4a16; stroke-width: 1.7; }\n.tl-dot { fill: var(--panel); stroke: var(--ink-2); stroke-width: 1.3; }\n.tl-dot.t { stroke: #7a4a16; }\n.tl-dot.hi { fill: var(--hi); stroke: var(--hi); }\n.tl-dot.lo { fill: var(--lo); stroke: var(--lo); }\n.tl-bp { stroke: var(--ink-2); stroke-width: 2.5; stroke-linecap: round; }\n.tl-in { fill: #7fb9c4; }\n.tl-out { fill: #53666d; }\n#tlSvg text.net { fill: var(--ink); font-weight: 600; }\n#tlSvg text.net.neg { fill: var(--lo); }\n#tlSvg text.val { fill: var(--ink); }\n#tlSvg text.hi { fill: var(--hi); font-weight: 650; }\n.tl-abx { fill: var(--accent); }\n.tl-abx.ended { fill: #9aaeb3; }\n.tl-abx.alt { fill: #5b4a9c; }\n#tlSvg text.abx { fill: #fff; font-weight: 600; }\n.tl-cx { cursor: pointer; }\n.tl-cx path { stroke-width: 1.4; }\n.tl-cx.grown path { fill: var(--hi); stroke: var(--hi); }\n.tl-cx.pending path { fill: var(--warn-bg); stroke: var(--warn); }\n.tl-cx.ng path { fill: var(--mute-bg); stroke: var(--ink-3); }\n#tlSvg tspan.grown { fill: var(--hi); font-weight: 650; }\n#tlSvg tspan.pending { fill: var(--warn); font-weight: 600; }\n#tlSvg tspan.ng { fill: var(--ink-3); }\n#tlSvg text.since { fill: var(--accent-ink); font-weight: 600; }\n.tl-cross { stroke: var(--ink); stroke-width: 1; opacity: .55; pointer-events: none; }\n.tl-dayhi { fill: var(--accent); opacity: .12; pointer-events: none; }\n.tl-read { position: absolute; top: 6px; z-index: 5; pointer-events: none; min-width: 168px; padding: 7px 10px; border-radius: 5px; background: var(--ink); color: #f0f6f7; font-size: 12px; line-height: 1.5; box-shadow: 0 6px 18px -4px rgba(9, 32, 38, .45); }\n.tl-read[hidden] { display: none; }\n.tl-read b { font-weight: 600; }\n.tl-read .k { color: #a9c2c7; display: inline-block; width: 42px; }\n.tl-read .hot { color: #ffb3ba; font-weight: 650; }\n.tl-read hr { border: 0; border-top: 1px solid #36525a; margin: 4px 0; }\n\n/* 參考區 */\n.ref { display: grid; grid-template-columns: minmax(0, 0.93fr) minmax(0, 1.07fr) minmax(0, 1fr); gap: 8px; padding: 8px; min-height: 0; }\n.col { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; min-height: 0; overflow-y: auto; overflow-x: hidden; }\n.sec + .sec { border-top: 1px solid var(--line); }\n.sec-h { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 3px 6px 3px 10px; background: var(--head); border-bottom: 1px solid var(--line); }\n.sec-h h2 { font-size: 13px; font-weight: 650; }\n.sec-h .meta { color: var(--ink-3); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.sec-h .sp { flex: 1; }\n.note { padding: 8px 10px; color: var(--ink-3); font-size: 12.5px; }\n.note.err { color: var(--hi); }\n.ib { display: inline-grid; place-items: center; width: 24px; height: 20px; flex: none; border: 0; border-radius: 4px; background: none; color: #8498a0; padding: 0; }\n.ib:hover, .ib:focus-visible { background: var(--accent-bg); color: var(--accent-ink); }\n.ib-text { width: auto; display: inline-flex; gap: 4px; padding: 0 7px 0 4px; height: 22px; color: var(--accent-ink); font-size: 12px; font-weight: 600; white-space: nowrap; }\n.row { display: flex; align-items: baseline; gap: 8px; padding: 2px 4px 2px 10px; min-height: 23px; border-top: 1px solid var(--line-soft); }\n.row:first-child { border-top: 0; }\n.row:hover { background: #f6f9f9; }\n.row .ib { align-self: center; }\n.row .main { flex: 1; min-width: 0; overflow-wrap: anywhere; }\n.row .sub { color: var(--ink-3); font-size: 12px; white-space: nowrap; }\n.row .dose { color: var(--ink-2); font-size: 12px; }\n.grp { padding: 4px 10px 1px; font-size: 12px; color: var(--ink-3); background: #fafcfc; border-top: 1px solid var(--line-soft); }\n.tag { flex: none; min-width: 34px; text-align: center; padding: 0 5px; border-radius: 3px; font-size: 12px; font-weight: 600; background: var(--mute-bg); color: var(--ink-2); white-space: nowrap; }\n.tag.new { background: var(--ok-bg); color: var(--ok); }\n.tag.stop { background: var(--hi-bg); color: var(--hi); }\n.tag.edit, .tag.pending { background: var(--warn-bg); color: var(--warn); }\n.tag.prn, .tag.send { background: var(--lo-bg); color: var(--lo); }\n.tag.rep { background: var(--accent-bg); color: var(--accent-ink); }\n.tag.day { background: var(--accent); color: #fff; min-width: 0; }\n.tag.grown { background: var(--hi-bg); color: var(--hi); }\n.dot-new { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); margin-left: 5px; vertical-align: 2px; }\n.flash-row { animation: rowflash 1.6s var(--ease); }\n@keyframes rowflash { from { background: #bfe3ea; } to { background: transparent; } }\n\ntable { width: 100%; border-collapse: collapse; table-layout: fixed; font: inherit; color: inherit; }\nth { font-weight: 500; }\ntd, th { padding: 0 4px; height: 21px; text-align: right; white-space: nowrap; overflow: hidden; }\ntd:first-child, th:first-child { text-align: left; padding-left: 10px; text-overflow: ellipsis; }\nthead th { position: sticky; z-index: 2; background: var(--panel); color: var(--ink-2); font-size: 12px; }\nthead tr:last-child th { border-bottom: 1px solid var(--line); }\n.since { background: var(--since); }\nthead th.since { background: var(--since); color: var(--accent-ink); font-weight: 650; }\ntbody tr { border-top: 1px solid var(--line-soft); }\n.nil { color: #a9b8bc; }\n\n.io td, .io th { height: 22px; }\n.io thead th { top: 30px; }\n.io .tot td { font-weight: 650; }\n.io .part td:first-child { padding-left: 22px; color: var(--ink-2); }\n.io .part td { color: var(--ink-2); font-size: 12px; }\n.io .net td { border-top: 1px solid var(--line); font-weight: 650; }\n.io .neg { color: var(--lo); }\n.io small { color: var(--ink-3); font-size: 11px; font-weight: 400; }\n\n.lab-tools { display: flex; align-items: center; gap: 8px; padding: 5px 8px 5px 10px; border-bottom: 1px solid var(--line-soft); }\n.lab-tools .meta { color: var(--ink-3); font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.btn { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; padding: 2px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--panel); color: var(--ink); font-size: 12px; }\n.btn:hover { border-color: #9fb3b7; background: var(--head); }\n.btn[aria-pressed=\"true\"] { background: var(--accent-bg); border-color: #8ec3cc; color: var(--accent-ink); }\n.lab thead th { top: 30px; }\n.lab thead tr:last-child th { top: 51px; font-size: 11px; color: var(--ink-3); }\n.lab .g td { background: var(--head); color: var(--ink-2); font-size: 12px; font-weight: 650; height: 22px; text-align: left; }\n.lab .g td:last-child { text-align: right; padding: 0 1px; }\n.lab .k { all: unset; cursor: pointer; display: flex; align-items: baseline; gap: 5px; width: 100%; color: var(--ink); font: inherit; }\n.lab .k:hover { color: var(--accent-ink); text-decoration: underline; text-underline-offset: 2px; }\n.lab .k:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }\n.lab .k small { color: var(--ink-3); font-size: 11px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }\n.lab td.v { color: var(--ink-2); padding: 0 2px; }\n.lab td.v.last { color: var(--ink); font-weight: 650; }\n.lab td:last-child, .lab th:last-child { padding: 0 1px; }\n.lab .c { display: inline-block; padding: 0 4px; border-radius: 3px; line-height: 17px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }\n.lab .c.hi { background: var(--hi-bg); color: var(--hi); font-weight: 650; }\n.lab .c.lo { background: var(--lo-bg); color: var(--lo); font-weight: 650; }\n.lab sup { font-size: 9px; color: var(--ink-3); margin-left: 1px; }\n.lab .d { color: var(--ink-3); font-size: 12px; }\n.lab tr.hide { display: none; }\n.lab tr.open { background: #f6f9f9; }\n.lab tr.trend td { padding: 0; height: auto; background: #f6f9f9; text-align: left; }\n.lab tr.trend svg { display: block; width: 100%; height: 66px; }\n.lab tr.trend text { font-size: 11px; fill: var(--ink-2); font-family: var(--ui); }\n.lab .band { fill: #dfeaeb; }\n.lab .ln { fill: none; stroke: var(--ink-2); stroke-width: 1.5; }\n.lab .pt { fill: var(--panel); stroke: var(--ink-2); stroke-width: 1.4; }\n.lab .pt.hi { fill: var(--hi); stroke: var(--hi); }\n.lab .pt.lo { fill: var(--lo); stroke: var(--lo); }\n\n.cover { padding: 6px 10px 7px; border-bottom: 1px solid var(--line-soft); display: grid; gap: 4px; }\n.cover div { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }\n.cover b { font-weight: 650; }\n.cover .sub { color: var(--ink-3); font-size: 12px; }\n.days td, .days th { height: 20px; font-size: 12px; }\n.days thead th { top: 30px; }\n.days td:nth-child(2), .days th:nth-child(2) { text-align: left; text-overflow: ellipsis; }\n.days tr.g1 td { background: #fdf1f2; }\n.daybtn, .linkbtn { all: unset; cursor: pointer; color: var(--accent-ink); font: inherit; font-size: 12px; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px; }\n.daybtn:focus-visible, .linkbtn:focus-visible { outline: 2px solid var(--accent); }\n.days .n-g { color: var(--hi); font-weight: 650; }\n.days .n-p { color: var(--warn); font-weight: 650; }\n.sub-h { padding: 5px 10px 2px; font-size: 12px; font-weight: 650; color: var(--ink-2); border-top: 1px solid var(--line); background: #fafcfc; display: flex; gap: 6px; align-items: baseline; }\n.sub-h span { font-weight: 400; color: var(--ink-3); }\n.org { font-weight: 650; color: var(--hi); }\n.stain { display: block; }\n.abg thead th { position: static; height: auto; vertical-align: bottom; padding: 3px 4px; white-space: normal; line-height: 1.2; overflow-wrap: anywhere; }\n.abg thead th small { display: block; color: var(--ink-3); font-size: 11px; font-weight: 400; }\n.abg td { height: 22px; }\n.abg .mic { color: var(--ink-3); font-size: 12px; display: inline-block; min-width: 34px; }\n.abg .sir { display: inline-block; width: 20px; text-align: center; border-radius: 3px; font-weight: 700; font-size: 12px; line-height: 17px; }\n.abg .S { background: var(--ok-bg); color: var(--ok); }\n.abg .I, .abg .SDD { background: var(--warn-bg); color: var(--warn); }\n.abg .R { background: var(--hi-bg); color: var(--hi); }\n.abg tr.using td { background: var(--since); }\n.abg tr.using td:first-child { font-weight: 650; color: var(--accent-ink); }\n.rep .imp { color: var(--ink); }\n.rep .full { padding: 4px 30px 8px 10px; color: var(--ink-2); font-size: 12.5px; line-height: 1.55; background: #f6f9f9; border-top: 1px solid var(--line-soft); white-space: pre-wrap; overflow-wrap: anywhere; }\n.rep .full[hidden] { display: none; }\n.rep .toggle { all: unset; cursor: pointer; flex: 1; min-width: 0; display: flex; gap: 8px; align-items: baseline; font: inherit; }\n.rep .toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }\n.rep .toggle .imp { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }\n.nurse .row { align-items: flex-start; }\n.nurse .sub { width: 76px; flex: none; padding-top: 1px; }\n[hidden] { display: none !important; }\n\n.dock.narrow .ref { grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); overflow-y: auto; align-content: start; }\n.dock.narrow .col { overflow: visible; }\n.dock.narrow .col3 { grid-column: 1 / -1; }\n.dock.narrow .sec-h, .dock.narrow thead th { position: static; }\n@media (prefers-reduced-motion: reduce) { .flash-row { animation: none; } }\n\n/* 區塊收合、Lab 項目編輯、護理交班 */\n.fold { all: unset; display: inline-grid; place-items: center; width: 20px; height: 20px; margin-left: -6px; border-radius: 4px; cursor: pointer; color: var(--ink-2); flex: none; }\n.fold:hover { background: var(--line-soft); color: var(--ink); }\n.fold:focus-visible { outline: 2px solid var(--accent); }\n.fold .ic { width: 14px; height: 14px; transition: transform .12s; }\n.sec.folded .fold .ic { transform: rotate(-90deg); }\n.sec.folded .sec-b { display: none; }\n.sec.folded .sec-h { border-bottom: 0; }\n.lab td:first-child:has(.labck) { display: flex; align-items: center; }\n.labck { margin: 0 6px 0 0; flex: none; accent-color: var(--accent); }\n.lab tr.off .k, .lab tr.off td.v, .lab tr.off .d { opacity: .42; }\n.handoff { margin: 0; padding: 8px 10px; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 13px; line-height: 1.55; color: var(--ink); }\n/* 窄版：兩欄依內容長高，整個參考區一起捲（不然矮螢幕會把欄壓扁、互相蓋住） */\n.dock.narrow .ref { grid-auto-rows: max-content; }\n.dock.narrow .col { min-height: max-content; }\n@media (prefers-reduced-motion: reduce) { .fold .ic { transition: none; } }\n/* 窄版的工具列放不下狀態訊息：訊息自己佔第二行，按鈕可以換行 */\n.dock.narrow .bar { flex-wrap: wrap; height: auto; min-height: 38px; row-gap: 4px; padding-top: 6px; padding-bottom: 6px; }\n.dock.narrow .bar .status { order: 9; flex: 0 0 100%; }\n.dock.narrow .bar .status:empty { display: none; }\n.dock.narrow #barWho, .dock.narrow .bar label:not(.range-n) { display: none; }\n.dock.narrow .bar select { max-width: 128px; }\n.dock.narrow .bar { column-gap: 6px; }\n/* 自訂天數（時間軸、Lab）、選取的時間點、Lab 翻頁 */\n.range-n { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; white-space: nowrap; }\n.range-n[hidden] { display: none; }\n.range-n input { width: 44px; height: 24px; padding: 0 2px 0 5px; border: 1px solid var(--shell-line); border-radius: 5px; background: var(--shell-2); color: var(--on-shell); font: inherit; font-variant-numeric: tabular-nums; }\n.lab-n { color: var(--ink-2); }\n.lab-n input { height: 22px; border-color: var(--line); background: var(--panel); color: var(--ink); }\n.range-n input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }\n.pager { display: inline-flex; gap: 2px; }\n.pager .btn { padding: 0 7px; font-size: 14px; line-height: 20px; }\n.btn:disabled { opacity: .4; cursor: default; }\n.tl-pin { stroke: var(--accent); stroke-width: 1.5; }\n.tl-plot { cursor: crosshair; }\n.tl-leg.pinned .v { color: var(--accent-ink); }\n.tl-leg.pinned .v.hi { color: var(--hi); }\n.tl-leg.pinned .v.lo { color: var(--lo); }\n.tl-leg.axis .linkbtn { overflow: hidden; text-overflow: ellipsis; }\n.lab-tools { flex-wrap: wrap; row-gap: 4px; }\n.tl-leg.axis .lim { color: var(--warn); }\n";

// ---- src/workspace/view.js ----
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
    <button class="bar-btn" type="button" id="btnCompact" aria-pressed="false" title="只留體溫、抗生素、培養">${icon('rows')}精簡</button>
    <span class="status" id="status" role="status" aria-live="polite"></span>
    <button class="bar-btn" type="button" id="btnList" aria-pressed="false" title="顯示或隱藏 HIS 左邊的 note 清單">${icon('list')}清單</button>
    <button class="bar-btn" type="button" id="btnReload" title="重新抓這位病人的資料">${icon('reload')}重抓</button>
    <button class="bar-btn" type="button" id="btnHide" title="收起工作畫面，回到 HIS 原本的版面">${icon('close')}收起</button>
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
      el.textContent = msg; el.className = 'status' + (kind ? ' ' + kind : '');
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
        rows.push(`<li class="row"><span class="tag rep">影像</span><span class="main">${esc(p.title)}</span><span class="sub">${md(p.ms)}</span>${insBtn(`[${imgKind(p.title)}] ${new Date(p.ms).getFullYear()}/${md(p.ms)}: ${p.imp.slice(0, 400)}`, p.title)}</li>`);
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
      h += tubes.map((l) => `<li class="row"><span class="tag">${fin(l.since) ? 'D' + dayNo(l.since) : '?'}</span><span class="main">${esc(l.name)}</span><span class="sub">${fin(l.since) ? md(l.since) + ' 起' : ''}</span>${insBtn(`${l.name.replace(/[（(].*$/, '').trim() || l.name}${fin(l.since) ? ` since ${md(l.since)} (D${dayNo(l.since)})` : ''}`, l.name)}</li>`).join('');
      h += '</ul>' + secClose;
      $('#col1').innerHTML = h;
    }

    /* ---------- 第二欄：Lab ---------- */
    const COLW = 50, DELTAW = 46, INSW = 26;
    let LM = null;
    const fmtGroup = (g, idxs) => {
      const rows = g.rows.filter((r) => !labHide.has(r.k) && idxs.some((i) => r.cells[i]));
      const dates = idxs.filter((i) => rows.some((r) => r.cells[i]));
      if (!rows.length || !dates.length) return '';
      const cw = rows.map((r) => Math.max(r.k.length, ...dates.map((i) => (r.cells[i] ? r.cells[i].v.length : 1))));
      const line = (label, get) => (label.padEnd(5) + rows.map((r, k) => '  ' + get(r).padEnd(cw[k])).join('')).replace(/\s+$/, '');
      return [`#. ${g.name}`, line('', (r) => r.k), ...dates.map((i) => line(LM.cols[i].d, (r) => (r.cells[i] ? r.cells[i].v : '-')))].join('\n');
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
        const day = `${+md(c.t).split('/')[0]}/${+md(c.t).split('/')[1]}`;
        if (!c.e || (!c.e.orgs.length && !c.e.neg.length)) return `[${day}] ${c.short}: pending`;
        if (!c.e.orgs.length) return `[${day}] ${c.short}: -`;
        const sens = c.e.sens.map((s) => { const pick = (k) => s.list.filter((x) => x.sir === k).map((x) => x.drug); return `  ${orgAbbr(s.org)}: S ${pick('S').join(', ') || '-'}; R ${pick('R').join(', ') || '-'}`; });
        return [`[${day}] ${c.short}: ${c.e.orgs.map((o) => orgAbbr(o.name) + (o.mark ? ' (' + o.mark + ')' : '')).join('; ')}${c.pend.length || c.e.prelim ? ' (preliminary)' : ''}`, ...sens].join('\n');
      };
      const ISO = isolates();
      const live = (M.abx || []).filter((a) => a.end == null);
      let h = secOpen('cx', '培養與藥敏', `<span class="tag pending">${pending.length} 份未發</span><span class="tag grown">${grown.length} 份有長</span><span class="sp"></span>${C.length ? insBtn(() => C.filter((c) => c.t > now() - 7 * DAY).sort((a, b) => a.t - b.t).map(cxNote).join('\n'), '#. Culture 近 7 天', 'Culture') : ''}`);
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
      h += pacs.map((r, i) => `<div class="rep"><div class="row"><span class="tag ${r.ms >= dayStart(B) ? 'rep' : ''}">${imgKind(r.title)}</span><button class="toggle" type="button" aria-expanded="false" data-rep="${i}"><span class="sub">${md(r.ms)}</span><span class="imp" title="${esc(r.title)}">${esc(r.imp.slice(0, 140) || r.title)}</span></button>${insBtn(`[${imgKind(r.title)}] ${new Date(r.ms).getFullYear()}/${md(r.ms)}: ${r.imp.slice(0, 600)}`, `${imgKind(r.title)} ${md(r.ms)}`)}</div><div class="full" hidden><b>${esc(r.title)}</b>\n${esc(r.body)}</div></div>`).join('');
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
    dock.addEventListener('mousedown', (e) => { if (e.target.closest('.ib, #btnLabMerge')) e.preventDefault(); });
    dock.addEventListener('click', (e) => {
      const t = e.target;
      const b = t.closest('[data-ins]');
      if (b) { const it = INS[+b.dataset.ins]; if (it) hooks.insert(typeof it.text === 'function' ? it.text() : it.text, it.label); return; }
      if (t.closest('#btnLabMerge')) { hooks.labMerge(); return; }
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
    return { debug, render, say, drawTimeline, labText: () => (M.labs && M.labs.summary ? M.labs.summary.text : ''), setHidden: (v) => { dock.hidden = v; $('#btnReopen').hidden = !v; }, setListPressed: (v) => $('#btnList').setAttribute('aria-pressed', String(v)) };
  }
  return { create, SHELL };
})();

// ---- src/workspace/page.js ----
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

})();
