// 檢驗整理（表格＋緊湊）輸出的後處理：合併 Renal & e-、去 eGFR/Glucose、只留上一篇 note 之後的新列、標 pending。
// 輸出的寫法（使用者 2026-11-16）：培養與病原檢驗放 [Pathogen] 段、影像放 [Image] 段，都不在 [Lab] 底下；
// 這兩段一筆一行，日期寫 <MM/DD>（方括號留給段落標題）。輸入（檢驗整理）仍是「#. Culture:」＋[MM/DD]。
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
  const cultureType = (s) => (/influenza/i.test(s) ? 'Influenza A+B' : /sars-cov|covid/i.test(s) ? 'SARS-CoV-2' : /blood|\bB\/C|^B2/i.test(s) ? 'B/C' : /urine|\bU\/C|^B3/i.test(s) ? 'U/C' : /sputum|\bSpu?\/C|\bS\/C/i.test(s) ? 'Spu/C'
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
    // pending：醫囑有開、報告還沒出；抽血依項目放回各檢驗類別，培養與病原檢驗放 [Pathogen]，影像放 [Image]
    const labPend = new Map();   // group → Map(day → { md, cols:Set, names:Set })
    const addLabPend = (grp, o, cols, name) => {
      if (!labPend.has(grp)) labPend.set(grp, new Map());
      const m = labPend.get(grp); if (!m.has(o.startDay)) m.set(o.startDay, { md: o.startMd, cols: new Set(), names: new Set() });
      const e = m.get(o.startDay); for (const c of cols) e.cols.add(c); if (name) e.names.add(name);
    };
    const culPend = [], imgPend = [];
    const seen = new Set();
    // 醫囑名稱後面常帶「(Indication:…小部位:…)」「(入院檢查)」，報告標題沒有；比對前先拿掉
    const norm = (s) => String(s).replace(/\[[^\]]*\]/g, '').replace(/\(V\d+\)/g, '').replace(/特殊醫囑.*$/, '').replace(/\(Specimen.*$/, '').replace(/\(Indication.*$/i, '').replace(/\(入院檢查\)/g, '').replace(/\s+/g, '').toLowerCase();
    // 同一項檢查：名稱相同，或其中一邊是另一邊的開頭（醫囑名稱比報告標題多了附註時）
    const sameExam = (a, b) => a === b || (a.length >= 6 && b.length >= 6 && (a.startsWith(b) || b.startsWith(a)));
    const delKeys = new Set((orderRows || []).filter((o) => /刪除/.test(o.act)).map((o) => o.startDay + '|' + norm(o.name)));
    for (const o of orderRows || []) {
      if (/刪除/.test(o.act) || !o.startDay || o.startDay > todayNum || delKeys.has(o.startDay + '|' + norm(o.name))) continue;
      const ord = (n) => Math.floor(n / 100) * 31 + n % 100; if (ord(o.startDay) < ord(todayNum) - 10) continue;
      if (/影醫/.test(o.type)) {
        if (!/新增/.test(o.act)) continue;
        const key = 'img|' + o.startDay + '|' + norm(o.name); if (seen.has(key)) continue; seen.add(key);
        const done = (pacsAll || []).some((p) => sameExam(norm(p.title), norm(o.name)) && p.day >= o.startDay - 1 && p.day <= o.startDay + 3);
        if (!done) imgPend.push({ day: o.startDay, md: o.startMd, title: o.name.replace(/\[[^\]]*\]/g, '').replace(/特殊醫囑.*$/, '').replace(/\s*\(Indication.*$/i, '').replace(/\(入院檢查\)/g, '').trim() });
      } else if (/檢驗/.test(o.type) && /culture|ID\+DS|培養|Gram|AFS|Fungus|Influenza|SARS-CoV/i.test(o.name)) {
        const type = cultureType(o.name);
        const key = 'cul|' + o.startDay + '|' + type; if (seen.has(key)) continue; seen.add(key);
        if (!culEntries.some((e) => e.day === o.startDay && e.type === type)) culPend.push({ day: o.startDay, md: o.startMd, label: type, res: 'pending' });
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
    const pad = (md) => String(md).split('/').map((x) => x.padStart(2, '0')).join('/');
    const pathogen = [...newCul.map((e) => ({ day: e.day, md: pad(e.md), label: e.label, res: e.res || '-' })), ...culPend.map((e) => ({ ...e, md: pad(e.md) }))].sort((a, b) => a.day - b.day);
    const image = imgPend.map((e) => ({ ...e, md: pad(e.md) })).sort((a, b) => a.day - b.day);
    const lab = out.join('\n');
    const parts = [lab];
    if (pathogen.length) parts.push('[Pathogen]\n' + pathogen.map((e) => `<${e.md}> ${e.label}: ${e.res}`).join('\n'));
    if (image.length) parts.push('[Image]\n' + image.map((e) => `<${e.md}> ${e.title}: pending`).join('\n'));
    // text：整份（給批次輸出）；lab／pathogen／image：分開的三部分（給病程頁工作畫面各自併進對應的段落）
    return { text: parts.filter(Boolean).join('\n') || '（上一篇之後沒有新的檢驗結果）', cutoff, lab, pathogen, image };
  }
  return { parse, process, lastNoteLabDay, cultureType };
})();
if (typeof module !== 'undefined') module.exports = PNLab; else window.PNLab = PNLab;
