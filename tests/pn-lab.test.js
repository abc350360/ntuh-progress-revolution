// 全部是合成資料，不連 HIS。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const PNLab = require(process.env.PN_LAB_MODULE || '../src/pn-lab');
const table = (name, cols, vals, day = '11/16') => {
  const widths = cols.map((c, i) => Math.max(c.length, vals[i].length));
  const line = (label, values) => label.padEnd(5) + values.map((v, i) => '  ' + v.padEnd(widths[i])).join('');
  return `#. ${name}\n${line('', cols)}\n${line(day, vals)}`;
};
const order = (name, day = 1116) => ({ name, type: '檢驗', act: '新增', startDay: day, startMd: `${Math.floor(day / 100)}/${day % 100}` });
const run = (text, orders = [], note = '') => PNLab.process(text, note, orders, [], 1117);

test('PCR 的 Acinetobacter 名稱變體全部進 Pathogen，其他 Lab 保留', () => {
  for (const name of ['Acinetobacter calcoaceticus-baumannii complex', 'Acinetobacter calcoacceticus-baumannii complex', 'Acinetobacter calcoaceticus baumannii complex', 'Acinetobacter baumannii complex']) {
    const r = run(table('Others', [name, 'LDH'], ['>=1.0E+06 copies/mL', '180']));
    assert.doesNotMatch(r.lab, /Acinetobacter/);
    assert.match(r.lab, /LDH/);
    assert.equal(r.pathogen.length, 1);
    assert.match(r.pathogen[0].res, /Acinetobacter/);
  }
});

test('Amylase 與 lipase 歸 Pancreas；體液 AMY 保持原分組', () => {
  const r = run(table('Others', ['AMY', 'Lip', 'LDH'], ['48', '22', '180']) + '\n' + table('Pleural', ['AMY'], ['80']), [order('Amylase'), order('Lipase')]);
  const groups = PNLab.parse(r.lab);
  assert.deepEqual(groups.find((g) => g.name === 'Pancreas')?.cols, ['AMY', 'Lip']);
  assert.deepEqual(groups.find((g) => g.name === 'Others')?.cols, ['LDH']);
  assert.deepEqual(groups.find((g) => g.name === 'Pleural')?.cols, ['AMY']);
  assert.doesNotMatch(r.lab, /pending/);
});

test('Spu/C 的結果與尚未發報告醫囑統一寫 Sp/C', () => {
  const r = run('#. Culture:\n[11/16] Spu/C: -', [order('Sputum Culture (Specimen: SPUSITE:)'), order('Sputum Culture (Specimen: SPUSITE:)', 1117)]);
  assert.deepEqual(r.pathogen.map((e) => e.label), ['Sp/C', 'Sp/C']);
  assert.equal(r.pathogen[0].res, '-');
  assert.equal(r.pathogen[1].res, 'pending');
});

test('Blood gas 與 Lactic acid 已有 V gas 結果，不再多出 Others pending', () => {
  const text = table('V gas', ['pH', 'PCO2', 'HCO3', 'BE', 'LA'], ['7.38', '44.2', '25.4', '0.8', '1.10']);
  const r = run(text, [order('Blood gas'), order('Lactic acid')]);
  assert.doesNotMatch(r.lab, /pending|Others/);
  assert.match(r.lab, /V gas/);
});

test('A gas 的結果也可完成 Blood gas 與 LA；另一日真正沒出仍保留 pending', () => {
  const text = table('A gas', ['pH', 'PCO2', 'HCO3', 'LA'], ['7.42', '39.1', '24.6', '1.20']);
  const r = run(text, [order('Blood gas'), order('Lactic acid'), order('Blood gas', 1117), order('Lactic acid', 1117)]);
  assert.doesNotMatch(r.lab, /11\/16\s+pending/);
  assert.match(r.lab, /11\/17\s+pending/);
  assert.doesNotMatch(r.lab, /Others/);
});

test('只有 LA 時不能當成 Blood gas 已出；血氣未含 LA 時仍標 LA pending', () => {
  const la = run(table('V gas', ['LA'], ['1.10']), [order('Blood gas')]);
  assert.match(la.lab, /pending/);
  const gas = run(table('A gas', ['pH', 'PCO2', 'HCO3'], ['7.42', '39.1', '24.6']), [order('Lactic acid')]);
  assert.match(gas.lab, /pending/);
});

test('明確的動脈血氣醫囑不能用靜脈血氣完成', () => {
  const text = table('V gas', ['pH', 'PCO2', 'HCO3', 'LA'], ['7.38', '44.2', '25.4', '1.10']);
  const r = run(text, [order('Blood gas (Specimen: ABG)'), order('Lactic acid')]);
  assert.match(r.lab, /#. A gas\n11\/16\s+pending/);
  assert.doesNotMatch(r.lab, /pending \(LA\)/);
});

test('Pancreas 新醫囑尚無結果時仍標 pending', () => {
  const r = run('', [order('Amylase'), order('Lipase')]);
  assert.match(r.lab, /#. Pancreas\n11\/16\s+pending/);
  assert.doesNotMatch(r.lab, /Others/);
});

test('既有 pending 對應正常且不變更 ECG 排除、Drug 與肝凝血分類', () => {
  const text = [table('Liver', ['T-Bil'], ['0.8']), table('Coagulation', ['aPTT'], ['31']), table('Others', ['Tacrolimus'], ['4.5'])].join('\n');
  const r = run(text, [order('BIL T'), order('PTT'), order('ECG routine'), order('Tacrolimus, FK-506')]);
  assert.doesNotMatch(r.lab, /pending|ECG|Others/);
  assert.match(r.lab, /#. Drug/);
});
