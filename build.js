// 組出 Progress note 工作畫面（病程頁用）的成品：
//   dist/pn-workspace.user.js    — Tampermonkey userscript，在病程頁右側嵌入時間軸與參考資料
//   dist/pn-workspace.console.js — 同一份程式包成 IIFE，開發時直接注入頁面
//   dist/pn-workspace.core.js    — 只有資料層（檢驗整理＋PNLab＋his.js），除錯用
// 用法：node build.js
const fs = require('fs');
const path = require('path');
const R = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8').replace(/\r/g, '');

// 檢驗整理（NTUH-helper lab-summary.user.js）：取 IIFE 本體、去掉進入點。
// 多匯出一個 structured()：除了文字，也把各項目的值、單位、參考值與高低判定交出來
const lab = R('vendor/lab-summary.user.js');
const start = lab.indexOf('(function () {');
const cut = lab.indexOf('    // 進入點：被 data-helper');
if (start < 0 || cut < 0) throw new Error('lab-summary.user.js 結構改變，找不到切點');
const FT = 'function formatTrend(dates, data, specialGroups, view) {';
if (!lab.includes(FT)) throw new Error('lab-summary.user.js 結構改變，找不到 formatTrend');
const labStructured = '// ---- vendor: NTUH-helper lab-summary.user.js（去掉進入點，匯出文字與結構化資料） ----\n'
  + lab.slice(start, cut).replace(FT, 'let __pnwCap = null;\n    ' + FT + '\n        __pnwCap = { dates, data, specialGroups };')
  + `    window.PNLabSummary = {
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
`;

// Lab 的後處理（只留上一篇 note 之後的新結果、合併 Renal & e-、標 pending）：與 ntuh-progress-writer 共用的那一份
const pnLab = '// ---- src/pn-lab.js ----\n' + R('src/pn-lab.js');
const ws = (f) => `// ---- src/workspace/${f} ----\n` + R('src/workspace/' + f);

const wsCore = [pnLab, labStructured, ws('his.js')].join('\n');
const css = 'const PNW_CSS = ' + JSON.stringify(R('src/workspace/view.css')) + ';\n';
const wsAll = [wsCore, css, ws('view.js'), ws('page.js')].join('\n');
// @namespace 沿用拆專案前的值：改掉的話 Tampermonkey 會把它當成另一支腳本，變成重複安裝
const wsHeader = `// ==UserScript==
// @name         NTUH Progress note 工作畫面
// @namespace    local.ntuh-progress-note
// @version      0.3.1
// @description  在病程頁右側顯示生命徵象時間軸、I/O、用藥與醫囑變動、Lab、培養與藥敏、影像報告，並可把內容插入 note。只讀資料，不會自己儲存病歷。
// @match        *://*.ntuh.gov.tw/WebApplication/InPatient/Ward/InsertProgressNoteContent.aspx*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
`;

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/pn-workspace.core.js'), '(() => {\n' + wsCore + '\n})();\n');
// Console 版包一層 IIFE：重複貼上時才不會撞到上次留下的頂層 const
fs.writeFileSync(path.join(__dirname, 'dist/pn-workspace.console.js'), '(() => {\n' + wsAll + '\n})();\n');
fs.writeFileSync(path.join(__dirname, 'dist/pn-workspace.user.js'), wsHeader + '(() => {\n' + wsAll + '\n})();\n');
console.log('built workspace', fs.statSync(path.join(__dirname, 'dist/pn-workspace.user.js')).size, 'bytes');
