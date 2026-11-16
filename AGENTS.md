# ntuh-progress-revolution：給 agent 的規則

台大醫院 HIS 病程頁的工作畫面 userscript。細節見 `README.md`。

## 不能做的事

- **不寫病歷。** 腳本與測試都只讀資料。在真的 HIS 上不要按「暫存」「確認」「新增 Note」等任何會寫入的按鈕；Data 欄每列的「選」和使用者其他腳本的填入按鈕也會寫入，不要點。
- **病人資料不進專案。** 截圖、診斷輸出、任何含姓名、病歷號、身分證字號或登入憑證的東西，只放工作階段的暫存目錄。提交前掃過要提交的檔案。
- 登入 HIS 由使用者自己做（有密碼與驗證碼），不要代為輸入。
- 使用者開著 note 時不要重新整理他的病程頁（未暫存的內容會不見）；要換新版就注入 `dist/pn-workspace.console.js`，它會先收掉舊的那份。

## 開發時要知道的

- 病程頁把 `Date.now()` 改寫成回傳 Date 物件。`src/workspace/` 一律用 `(+new Date())`。
- 生命徵象的多天查詢與管路查詢不帶病人識別。相關的防護（排隊、跨分頁鎖、與近兩天來源比對）改動前先讀 `README.md` 那一段。
- `src/pn-lab.js` 與 `vendor/lab-summary.user.js` 是複本，來源見 `README.md`。
- `@namespace` 不要改。

## 驗證

```
node build.js
node --check dist/pn-workspace.console.js
```

院外用模擬頁（假資料）：專案根目錄起靜態伺服器（`python -m http.server 8770 --bind 127.0.0.1`），開
`http://localhost:8770/prototype/his-mock/InsertProgressNoteContent.aspx/?SESSION=MOCK&AccountIDSE=26T00000000&PersonID=A000000000`
（加 `&kind=progress` 是結構化 Progress note，加 `&kind=none` 是還沒開 note）。模擬頁照 HIS 的行為改寫了 `Date.now`。

改到版面或 HIS 相關的邏輯，要在真的病程頁再看一次才算驗證過；沒看過就在回報裡寫明。
