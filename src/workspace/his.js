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
