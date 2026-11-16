// 原型用的假資料。病人、數值、報告全部是虛構的，不對應任何真實病歷。
(function () {
  'use strict';
  const H = 3600e3;
  const ts = (s) => +new Date(s);

  // ---- 生命徵象：固定亂數種子，每次打開都長一樣 ----
  let seed = 20261115;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const FEVER = {
    '2026-11-12T22:00': 38.6,
    '2026-11-13T02:00': 38.1,
    '2026-11-13T18:00': 38.2,
    '2026-11-14T22:00': 38.4,
    '2026-11-15T02:00': 37.6,
    '2026-11-15T06:00': 37.9,
  };
  const SPO2 = { '2026-11-15T02:00': 91, '2026-11-12T22:00': 92 };
  const vitals = [];
  const pad2 = (n) => String(n).padStart(2, '0');
  for (let t = ts('2026-11-08T02:00:00'); t <= ts('2026-11-15T06:00:00'); t += 4 * H) {
    const d = new Date(t);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:00`;
    const sick = t >= ts('2026-11-12T12:00:00');
    const temp = FEVER[key] ?? +((sick ? 37.1 : 36.6) + rnd() * 0.5).toFixed(1);
    const hot = temp >= 38;
    vitals.push({
      t,
      temp,
      hr: Math.round(72 + (temp - 36.8) * 14 + rnd() * 8),
      sys: Math.round(122 - (hot ? 9 : 0) + rnd() * 14 - 7),
      dia: Math.round(66 - (hot ? 4 : 0) + rnd() * 10 - 5),
      rr: Math.round(17 + (hot ? 3 : 0) + rnd() * 3),
      spo2: SPO2[key] ?? Math.round(97 - (hot ? 2 : 0) - rnd() * 2),
    });
  }

  // ---- Lab：照使用者的 note 寫法（列是日期、欄是項目、兩格欄距）----
  const labCols = [
    { d: '11/11', t: '05:38' },
    { d: '11/12', t: '05:41' },
    { d: '11/13', t: '05:35' },
    { d: '11/14', t: '05:44' },
    { d: '11/15', t: '05:40' },
  ];
  const labGroups = [
    { name: 'CBC', rows: [
      { k: 'WBC', unit: 'K/µL', lo: 4, hi: 10, v: ['11.2', '16.8', '15.2', '13.9', '12.8'] },
      { k: 'Hb', unit: 'g/dL', lo: 13.5, hi: 17.5, v: ['9.4', '9.2', '9.1', '8.8', '8.9'] },
      { k: 'PLT', unit: 'K/µL', lo: 150, hi: 400, v: ['198', '186', '205', '212', '230'] },
      { k: 'Seg', unit: '%', lo: 40, hi: 75, v: ['78.2', '88.1', '85.0', '82.4', '79.6'] },
      { k: 'Band', unit: '%', lo: 0, hi: 3, v: [null, '4.0', '2.0', null, null] },
    ] },
    { name: 'Renal & e-', rows: [
      { k: 'BUN', unit: 'mg/dL', lo: 7, hi: 25, v: ['38', '44', '49', '46', '41'] },
      { k: 'CRE', unit: 'mg/dL', lo: 0.7, hi: 1.3, v: ['1.7', '1.9', '1.9', '1.7', '1.6'] },
      { k: 'Na', unit: 'mmol/L', lo: 135, hi: 145, v: ['136', '134', '133', '135', '137'] },
      { k: 'K', unit: 'mmol/L', lo: 3.5, hi: 5.1, v: ['4.4', '4.1', '3.9', '3.6', '3.3'] },
      { k: 'Ca', unit: 'mg/dL', lo: 8.6, hi: 10.3, v: [null, '8.1', null, null, '8.3'] },
      { k: 'Mg', unit: 'mg/dL', lo: 1.8, hi: 2.6, v: [null, '1.9', null, null, '1.7'] },
    ] },
    { name: 'Liver', rows: [
      { k: 'AST', unit: 'U/L', lo: 0, hi: 40, v: ['31', null, '28', null, '26'] },
      { k: 'ALT', unit: 'U/L', lo: 0, hi: 41, v: ['24', null, '22', null, '20'] },
      { k: 'T-bil', unit: 'mg/dL', lo: 0.2, hi: 1.2, v: ['0.8', null, '0.7', null, '0.6'] },
      { k: 'Alb', unit: 'g/dL', lo: 3.5, hi: 5, v: [null, '3.0', null, null, '2.9'] },
    ] },
    { name: 'Infection', rows: [
      { k: 'CRP', unit: 'mg/dL', lo: 0, hi: 0.5, v: ['3.2', '14.1', '12.6', null, '8.4'] },
      { k: 'PCT', unit: 'ng/mL', lo: 0, hi: 0.5, v: [null, '2.8', null, null, 'pending'] },
      { k: 'Lac', unit: 'mmol/L', lo: 0.5, hi: 2.2, v: [null, '2.6', '1.8', null, null] },
    ] },
    { name: 'Cardiac', rows: [
      { k: 'NT-proBNP', unit: 'pg/mL', lo: 0, hi: 125, v: [null, '4820', null, null, '3950'] },
      { k: 'hs-TnT', unit: 'ng/L', lo: 0, hi: 14, v: [null, '38', '36', null, null] },
    ] },
    { name: 'Coag', rows: [
      { k: 'PT', unit: 'sec', lo: 9.5, hi: 12.5, v: [null, '11.8', null, null, null] },
      { k: 'INR', unit: '', lo: 0.8, hi: 1.2, v: [null, '1.08', null, null, null] },
    ] },
    { name: 'ABG', rows: [
      { k: 'pH', unit: '', lo: 7.35, hi: 7.45, v: [null, '7.36', null, null, null] },
      { k: 'pCO2', unit: 'mmHg', lo: 35, hi: 45, v: [null, '34', null, null, null] },
      { k: 'pO2', unit: 'mmHg', lo: 80, hi: 100, v: [null, '68', null, null, null] },
      { k: 'HCO3', unit: 'mmol/L', lo: 22, hi: 26, v: [null, '19.2', null, null, null] },
    ] },
  ];

  /** 產生「表格＋緊湊」的一段：#. 標題、表頭列、每個日期一列 */
  function fmtTable(group, colIdx) {
    const rows = group.rows.filter((r) => colIdx.some((i) => r.v[i] != null));
    const dates = colIdx.filter((i) => rows.some((r) => r.v[i] != null));
    if (!rows.length || !dates.length) return '';
    const labelW = Math.max(...dates.map((i) => labCols[i].d.length));
    const cw = rows.map((r) => Math.max(r.k.length, ...dates.map((i) => String(r.v[i] ?? '-').length)));
    const line = (label, get) =>
      (label.padEnd(labelW) + rows.map((r, k) => '  ' + get(r).padEnd(cw[k])).join('')).replace(/\s+$/, '');
    return [
      `#. ${group.name}`,
      line('', (r) => r.k),
      ...dates.map((i) => line(labCols[i].d, (r) => String(r.v[i] ?? '-'))),
    ].join('\n');
  }

  // 上一篇（11/14）的 [Lab] 只到 11/14，而且只列當時在追的幾組
  const prevLab = ['CBC', 'Renal & e-', 'Infection']
    .map((n) => fmtTable(labGroups.find((g) => g.name === n), [1, 2, 3]))
    .join('\n');

  const prevNote = `===Diagnosis===
[Active]
#. Pneumonia, right lower lobe, sputum culture pending, on Cefepime
#. Acute kidney injury on chronic kidney disease stage 3, CRE 1.9 mg/dL on 2026/11/13
#. Heart failure with reduced ejection fraction, LVEF 38% on 2026/11/10, on Bisoprolol and Entresto
[Underlying]
#. Type 2 diabetes mellitus, HbA1C=7.4% on 2026/11/02, on insulin glargine
#. Coronary artery disease, on Bokey
   - s/p DES*1 to LAD on 2024/03/18
#. Urinary tract infection (Escherichia coli) on 2026/11/09, treated

===Course===
The patient was admitted on 11/04 for fever and productive cough. Tazocin was shifted to Cefepime on 11/04 due to persistent fever. Urine culture on 11/09 yielded Escherichia coli. Fever recurred on 11/12 with increased oxygen demand, and sputum and blood cultures were repeated.

===Assessment===
[Event]
Fever up to 38.2 on 11/13 evening. O2 nasal cannula 2 L/min.
[V/S]
T: 37.2 °C P: 88 bpm R: 18 /min
BP: 116/62 mmHg
體重:63.9>63.6>63.2(11/14)
[PE]
Chest: coarse crackles over right lower lung
Heart: regular heart beat, no murmur
Extremities: no pitting edema
[Lab]
${prevLab}
#. Culture
11/12 Sputum: pending
11/12 B/C x2: pending
[CXR]
2026/11/12: Right lower lobe consolidation
[Abx]
Tazocin 11/01-11/04
Cefepime 11/04-

===Plan===
. Keep Cefepime, follow up sputum and blood culture
. Monitor I/O and body weight, hold diuretics if CRE rising
. O2 support and chest care`;

  window.PN = {
    now: '2026-11-15T08:30:00',
    lastNote: '2026-11-14T08:20:00',
    fmtTable,
    patient: {
      bed: '05-2', seq: '2 / 6', name: '林○○', age: 68, sex: '男', chart: '0000000',
      admitted: '2026-11-04', vs: '王醫師',
      dx: 'RLL pneumonia · AKI on CKD 3 · HFrEF',
      allergy: 'NKDA', diet: 'DM 軟質 1600 kcal', o2: 'NC 3 L/min',
    },
    vitals,
    io: [
      { d: '2026-11-09', po: 1050, iv: 1200, urine: 1650, stool: 1, wt: 64.1 },
      { d: '2026-11-10', po: 1100, iv: 1080, urine: 1900, stool: 0, wt: 64.0 },
      { d: '2026-11-11', po: 1000, iv: 1050, urine: 1980, stool: 1, wt: 63.9 },
      { d: '2026-11-12', po: 900, iv: 1400, urine: 1750, stool: 1, wt: 63.9 },
      { d: '2026-11-13', po: 950, iv: 1150, urine: 1920, stool: 0, wt: 63.6 },
      { d: '2026-11-14', po: 1000, iv: 950, urine: 2080, stool: 2, wt: 63.2 },
      { d: '2026-11-15', po: 120, iv: 300, urine: 610, stool: 0, wt: 62.4, partial: '至 08:00' },
    ],
    abx: [
      { name: 'Cefepime', dose: '2 g IV Q12H', start: '2026-11-04T10:00:00', end: null, why: 'RLL pneumonia' },
      { name: 'Vancomycin', dose: '1 g IV Q12H', start: '2026-11-14T10:30:00', end: null, why: 'recurrent fever, empirical' },
      { name: 'Tazocin', dose: '4.5 g IV Q8H', start: '2026-11-01T09:00:00', end: '2026-11-04T10:00:00', why: 'empirical' },
    ],
    meds: [
      { g: '心血管', items: [
        { name: 'Bisoprolol', dose: '1.25 mg PO QD', since: '11/05' },
        { name: 'Entresto', dose: '50 mg PO BID', since: '11/06' },
        { name: 'Bokey', dose: '100 mg PO QD', since: '11/04' },
        { name: 'Atorvastatin', dose: '20 mg PO QN', since: '11/04' },
      ] },
      { g: '內分泌與電解質', items: [
        { name: 'Insulin glargine', dose: '8 U SC QN', since: '11/04', flag: '調整', note: '6 U → 8 U' },
        { name: 'Insulin aspart', dose: 'sliding scale SC TIDAC', since: '11/04' },
        { name: 'Potassium chloride', dose: '20 mEq PO BID', since: '11/15', flag: '新增' },
      ] },
      { g: '呼吸與腸胃', items: [
        { name: 'Ipratropium / salbutamol', dose: '1 vial INH Q6H', since: '11/12' },
        { name: 'Acetylcysteine', dose: '600 mg PO BID', since: '11/05' },
        { name: 'Esomeprazole', dose: '40 mg PO QDAC', since: '11/04' },
        { name: 'Sennoside', dose: '2 tab PO QN', since: '11/08' },
      ] },
      { g: 'PRN', items: [
        { name: 'Acetaminophen', dose: '500 mg PO Q6H PRN', since: '11/04', given: ['11/14 22:10', '11/15 03:30'] },
        { name: 'Metoclopramide', dose: '10 mg IV Q8H PRN', since: '11/06', given: [] },
      ] },
    ],
    changes: [
      { kind: '新增', cls: 'new', text: 'Vancomycin 1 g IV Q12H', at: '11/14 10:30', ins: 'Vancomycin 1 g IV Q12H was added on 11/14 for recurrent fever.' },
      { kind: '停用', cls: 'stop', text: 'Furosemide 20 mg IV QD', at: '11/14 10:32', ins: 'Furosemide was discontinued on 11/14.' },
      { kind: '調整', cls: 'edit', text: 'Insulin glargine 6 U → 8 U QN', at: '11/14 17:05', ins: 'Insulin glargine was titrated from 6 U to 8 U QN on 11/14.' },
      { kind: '新增', cls: 'new', text: 'Potassium chloride 20 mEq PO BID', at: '11/15 07:50', ins: 'Potassium chloride 20 mEq BID was added on 11/15 for K 3.3 mmol/L.' },
      { kind: 'PRN', cls: 'prn', text: 'Acetaminophen 500 mg 給 2 次', at: '22:10、次日 03:30', ins: 'Acetaminophen 500 mg PRN was given twice (11/14 22:10, 11/15 03:30).' },
      { kind: '送檢', cls: 'send', text: 'B/C ×2、U/C', at: '11/14 22:20', ins: 'Blood culture x2 and urine culture were sent on 11/14.' },
      { kind: '報告', cls: 'rep', text: 'Sputum culture：K. pneumoniae＋藥敏', at: '11/14 16:05', ins: 'Sputum culture on 11/12 yielded Klebsiella pneumoniae (Cefepime S, Ceftriaxone R).' },
      { kind: '報告', cls: 'rep', text: 'CXR 11/14 正式報告', at: '11/14 15:40', ins: 'CXR on 11/14: increased RLL consolidation with small right pleural effusion.' },
      { kind: '事件', cls: 'evt', text: 'BT 38.4，無寒顫', at: '11/14 22:00', ins: 'Fever up to 38.4 on 11/14 22:00 without chills.' },
      { kind: '事件', cls: 'evt', text: 'SpO₂ 91%，NC 2 → 3 L/min 後 95%', at: '11/15 02:00', ins: 'Desaturation to 91% on 11/15 02:00, improved to 95% after O2 nasal cannula 3 L/min.' },
    ],
    lines: [
      { name: 'CVC（右內頸）', since: '2026-11-08' },
      { name: 'Foley', since: '2026-11-10' },
      { name: 'Peripheral IV（左前臂）', since: '2026-11-13' },
    ],
    labs: { cols: labCols, groups: labGroups, lastNoteDay: '11/14' },
    cultures: [
      { id: 'c1', t: '2026-11-14T22:20:00', spec: 'B/C', n: 2, site: 'peripheral', status: 'pending' },
      { id: 'c2', t: '2026-11-14T22:40:00', spec: 'U/C', n: 1, site: 'Foley', status: 'pending' },
      { id: 'c3', t: '2026-11-12T22:30:00', spec: 'Sputum', n: 1, site: 'expectorated', status: 'grown', org: 'Klebsiella pneumoniae', qty: 'heavy', iso: 'A', reported: '2026-11-14T16:05:00', stain: 'GNB 3+，WBC >25/LPF' },
      { id: 'c4', t: '2026-11-12T22:20:00', spec: 'B/C', n: 2, site: 'peripheral', status: 'pending', interim: 'no growth 2 days' },
      { id: 'c5', t: '2026-11-09T09:10:00', spec: 'U/C', n: 1, site: 'midstream', status: 'grown', org: 'Escherichia coli', qty: '>10⁵ CFU/mL', iso: 'B', reported: '2026-11-11T15:20:00' },
      { id: 'c6', t: '2026-11-04T11:00:00', spec: 'B/C', n: 2, site: 'peripheral', status: 'ng', reported: '2026-11-09T11:30:00' },
      { id: 'c7', t: '2026-11-04T11:20:00', spec: 'Sputum', n: 1, site: 'expectorated', status: 'ng', org: 'Mixed normal flora', reported: '2026-11-07T14:00:00' },
      { id: 'c8', t: '2026-11-01T09:30:00', spec: 'B/C', n: 2, site: 'peripheral', status: 'ng', reported: '2026-11-06T10:00:00' },
    ],
    isolates: [
      { id: 'A', org: 'K. pneumoniae', full: 'Klebsiella pneumoniae', from: 'Sputum 11/12' },
      { id: 'B', org: 'E. coli', full: 'Escherichia coli', from: 'U/C 11/09' },
    ],
    // [藥名, A 株 SIR, A 株 MIC, B 株 SIR, B 株 MIC]
    antibiogram: [
      ['Ampicillin', 'R', '≥32', 'R', '≥32'],
      ['Ampicillin/sulbactam', 'R', '≥32', 'I', '16'],
      ['Cefazolin', 'R', '≥64', 'S', '≤4'],
      ['Ceftriaxone', 'R', '≥64', 'S', '≤1'],
      ['Ceftazidime', 'R', '16', 'S', '≤1'],
      ['Cefepime', 'S', '≤1', 'S', '≤1'],
      ['Piperacillin/tazobactam', 'S', '8', 'S', '≤4'],
      ['Ertapenem', 'S', '≤0.5', 'S', '≤0.5'],
      ['Meropenem', 'S', '≤0.25', 'S', '≤0.25'],
      ['Amikacin', 'S', '≤2', 'S', '≤2'],
      ['Gentamicin', 'S', '≤1', 'S', '≤1'],
      ['Ciprofloxacin', 'R', '≥4', 'R', '≥4'],
      ['Levofloxacin', 'I', '1', 'R', '≥8'],
      ['TMP/SMX', 'S', '≤20', 'R', '≥320'],
      ['Tigecycline', 'S', '1', '', ''],
    ],
    reports: [
      { id: 'r1', d: '11/15', kind: 'CXR', title: 'Chest PA (portable)', pending: true, imp: 'formal report pending', body: '' },
      { id: 'r2', d: '11/14', kind: 'CXR', title: 'Chest AP (portable)', isNew: true,
        imp: 'Increased RLL consolidation with small right pleural effusion, mildly progressed compared with 11/12.',
        body: 'Portable AP view. Increased consolidation over right lower lung field. Blunting of right costophrenic angle, suggestive of small pleural effusion. Cardiomegaly. Right internal jugular CVC with tip at SVC. No pneumothorax.' },
      { id: 'r3', d: '11/12', kind: 'CXR', title: 'Chest AP (portable)',
        imp: 'Right lower lobe consolidation.',
        body: 'Portable AP view. Patchy consolidation over right lower lung field. Cardiomegaly. No pneumothorax.' },
      { id: 'r4', d: '11/10', kind: 'Echo', title: 'Transthoracic echocardiography',
        imp: 'LVEF 38%, global hypokinesia, moderate MR, no pericardial effusion.',
        body: 'LVEDD 58 mm, LVESD 47 mm, LVEF 38% (M-mode). Global hypokinesia of LV. Moderate MR, mild TR. Estimated RVSP 38 mmHg. No pericardial effusion. No intracardiac thrombus.' },
      { id: 'r5', d: '11/09', kind: 'Sono', title: 'Renal echo',
        imp: 'Normal sized kidneys with increased cortical echogenicity, no hydronephrosis.',
        body: 'Right kidney 9.8 cm, left kidney 10.1 cm. Increased cortical echogenicity bilaterally. No hydronephrosis, no stone. Urinary bladder with Foley catheter in situ.' },
    ],
    nursing: [
      { at: '11/14 22:00', text: 'BT 38.4℃，無寒顫，依醫囑給 Acetaminophen 500 mg，並抽 B/C ×2、留 U/C。' },
      { at: '11/15 00:10', text: '追蹤 BT 37.8℃，流汗多，協助更衣。' },
      { at: '11/15 02:00', text: 'SpO₂ 91%，痰多黃稠，抽痰後 NC 由 2 調至 3 L/min，SpO₂ 回升 95%。' },
      { at: '11/15 06:00', text: '體重 62.4 kg。尿量可，尿色淡黃。進食約五成。' },
    ],
    prevNote,
    draft: prevNote.replace('Fever up to 38.2 on 11/13 evening. O2 nasal cannula 2 L/min.', ''),
  };
})();
