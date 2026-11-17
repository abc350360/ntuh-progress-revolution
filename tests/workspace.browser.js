// 在 prototype/his-mock 頁面 evaluate 此檔；只使用合成資料，禁止在 HIS 執行。
(async () => {
  if (!['localhost', '127.0.0.1'].includes(location.hostname) || !location.pathname.includes('/prototype/his-mock/')) throw new Error('只能在假資料模擬頁執行');
  const w = window.__pnw, M = w.M, root = document.getElementById('pnw-host').shadowRoot;
  if (M.loading.size) throw new Error('請先等模擬頁載入完成');
  const checks = [], check = (name, ok) => checks.push({ name, pass: !!ok });
  const render = async () => { w.render(); await new Promise(requestAnimationFrame); };
  const now = (+new Date()), d = new Date(now), day = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  const cols = ['Acinetobacter calcoaceticus baumannii complex', 'AMY', 'Lip', 'LDH'], vals = ['>=1.0E+06 copies/mL', '48', '22', '180'];
  const widths = cols.map((c, i) => Math.max(c.length, vals[i].length));
  const line = (label, values) => label.padEnd(5) + values.map((v, i) => '  ' + v.padEnd(widths[i])).join('');
  const saved = { ...M };
  const fields = w.fields(), editor = document.getElementById(fields.find((f) => /Assessment|BlankContnt/.test(f.id))?.id);
  if (!editor) throw new Error('找不到模擬頁的 note 欄位');
  const textBefore = editor.value;
  try {
    Object.assign(M, { now, base: now - 86400000, micro: [], pending: [], orders: { items: [], rows: [] }, labs: { summary: {
      text: `#. Others\n${line('', cols)}\n${line(day, vals)}\n#. Culture:\n[${day}] Influenza A+B: -`,
      blood: { dates: [day], items: cols.map((name, i) => ({ name, vals: [vals[i]], level: [null], unit: '', ref: '' })) },
      groups: [], special: {}, attach: {}, others: [],
    } } });
    await render();
    const button = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Pathogen');
    check('沒有培養時仍有 Pathogen 整批插入鈕', button);
    editor.value = '[Lab]\n\n[Abx]\n\n[Pathogen]\n'; editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length);
    editor.dispatchEvent(new Event('click', { bubbles: true }));
    if (button) button.click();
    check('整批 Pathogen 帶入 PCR 與快篩', editor.value.includes('Acinetobacter') && editor.value.includes('Influenza A+B: -'));
    check('Lab 顯示 Pancreas 分組', root.querySelector('#col2').textContent.includes('Pancreas'));
    check('PCR 不留在 Lab Others', !root.querySelector('#col2').textContent.includes('Acinetobacter'));
    const preview = w.pathogenPreview();
    check('一鍵帶入的資料來源也包含 PCR', preview.some((e) => e.text.includes('Acinetobacter')));
    M.micro = [{ no: 'SYNTHETIC', spec: 'SPUTUM', t: now, reported: now, stain: [], orgs: [], neg: ['No growth'], prelim: false, sens: [] }];
    await render();
    check('培養清單的痰簡稱為 Sp/C', root.querySelector('#col3').textContent.includes('Sp/C'));
    const combined = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Pathogen');
    editor.value = ''; editor.focus(); editor.setSelectionRange(0, 0); editor.dispatchEvent(new Event('click', { bubbles: true }));
    if (combined) combined.click();
    check('整批 Pathogen 同時保留培養與病原檢驗', editor.value.includes('Sp/C: -') && editor.value.includes('Acinetobacter') && editor.value.includes('Influenza A+B: -'));
    M.labs.summary.text += `\n[${day}] Spu/C: -`;
    await render();
    editor.value = `[Lab]\n\n[Abx]\n\n[Pathogen]\n<${day}> Spu/C: pending\n`;
    editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length); editor.dispatchEvent(new Event('click', { bubbles: true }));
    root.querySelector('#btnLabMerge').click();
    check('舊 Spu/C pending 換成 Sp/C 結果且不重複', !editor.value.includes('Spu/C: pending') && (editor.value.match(/Spu?\/C:/g) || []).length === 1 && editor.value.includes('Sp/C: -'));
    const once = editor.value;
    root.querySelector('#btnLabMerge').click();
    check('補進 Lab 與 Pathogen 重按不重複', editor.value === once);
  } finally {
    editor.value = textBefore;
    Object.assign(M, saved); await render();
  }
  return { checks, pass: checks.every((c) => c.pass), dateNowReturnsDate: Date.now() instanceof Date };
})();
