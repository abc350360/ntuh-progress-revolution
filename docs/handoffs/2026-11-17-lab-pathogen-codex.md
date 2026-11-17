# 病原檢驗與 Lab 分類修正交接

- 更新時間：2026-11-17 Asia/Taipei，含後續 HIS 唯讀驗證與安裝
- 寫入者：Codex，接續 Claude Code 原始 session `b642518d-7711-4d27-aa75-5305bd25b2fd`
- 專案實體路徑：`C:/Users/user/Desktop/Claude/projects/ntuh-progress-revolution`
- Git branch / HEAD：`main`；接手時 HEAD 為 `8238756`，本次修正的 commit 見 `git log`。沒有 push。
- 工作目標：完成 Claude Code 用量耗盡前最後一批 Pathogen、Pancreas、Sp/C、血氣與 LA pending 修正。
- 界線：HIS 僅唯讀；不登入、不重新整理既有病程頁、不按任何病歷寫入按鈕；專案僅有合成測試資料。

## 已完成

- `src/workspace/view.js`：Pathogen 整批插入加入畫面下方的病原檢驗；只有病原檢驗時也顯示按鈕。血液 AMY／Lip 歸 Pancreas，痰培養顯示 Sp/C。
- `src/pn-lab.js`：辨認 Acinetobacter 名稱變體，包含先前報告欄位實際出現的 `calcoacceticus` 拼法；搬移血液 AMY／Lip，保留體液 AMY 原分組；Blood gas 與 LA 依同日 A gas／V gas 結果比對，明確指定動靜脈時分開判斷，真正沒結果仍 pending。
- `src/workspace/page.js`：舊 Spu/C 與新 Sp/C 視為同一檢查，避免更新 pending 時重複新增。
- 工作畫面建置版本 v0.6.1；共用 `src/pn-lab.js` 已同步到 `ntuh-progress-writer`，批次建置版本 v0.2.8。兩份共用原始碼 SHA-256 相同。
- `tests/pn-lab.test.js` 與 `tests/workspace.browser.js` 是合成資料回歸測試；README 更新行為與驗證界線。未修改 vendor 檢驗整理複本。

## 驗證

- 兩個專案的 `node build.js` 與成品 `node --check` 通過。
- `node --test tests/pn-lab.test.js`：9/9 通過；以 `PN_LAB_MODULE` 指向 writer 原始碼再跑也是 9/9。
- Ego Lite 模擬頁：Free note、結構化 Progress 各 9/9 通過，包含沒有培養、整批 PCR＋快篩、Lab 分組、舊 Spu/C pending 更新與重複補入；模擬頁的 Date.now 仍回傳 Date。
- 原始 Acinetobacter 拼字另加入 Node 測試，先確認失敗，再修到通過。瀏覽器測試使用其他名稱變體，未重播真實報告。
- `git diff --check` 通過。所有真實 HIS 寫入動作均未執行。
- 使用者後續授權直接操作 Ego-lite、更新腳本並 commit。兩個真實 HIS 案例只注入新版，確認沒有來源載入錯誤；前後全部 145 個 textarea 內容一致，沒有按插入、補進 Lab、帶入、暫存、確認或新增。
- PCR 案例來源的 Acinetobacter 為陰性，已移出 Lab；肺炎 PCR 摘要仍保留陽性病原，Sp/C 顯示正常。血氣案例同時有 A gas／V gas 與 LA，醫囑的 Blood gas／Lactic acid 已不再誤標 pending。兩個案例都沒有 Amylase／lipase 結果，Pancreas 的真實資料顯示尚未驗證。
- Ego-lite 的 Tampermonkey 工作畫面已從 v0.6.0 更新為 v0.6.1；先備份舊腳本到工作階段暫存，確認自動重新載入頁面原本為關閉，再更新。重新開啟腳本管理器讀回原始碼，與 `dist/pn-workspace.user.js` 完全相同，SHA-256 `449c514056e6fffec710218d3d3aaa998b64d7fdf3781d84fa41500bfef4d85e`。病程頁沒有重新整理，原病房清單與最後驗證的病程頁保留給使用者。
- 畫面、欄位快照與詳細診斷結果只在系統暫存目錄，沒有放進 repo。Ego-lite 的晨間批次腳本未更新，本次只更新工作畫面。

## 接手工作

- 之後有含 Amylase／lipase 結果的已授權案例時，再唯讀確認 Pancreas 顯示；不為測試修改真實資料。
- 真實頁面的「插入」「補進 [Lab]」「帶入」依專案規則仍不操作。使用者既有文字不可被測試改動。
- 本機同步的 `ntuh-progress-writer` 版本為 v0.2.8，其批次建置沒有在真實 HIS 執行；它的已安裝版本與本機版本可能不同。使用者未要求 push。
