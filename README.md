# ntuh-progress-revolution

台大醫院 HIS 病程頁（`InsertProgressNoteContent.aspx`）的工作畫面：一支 Tampermonkey userscript，在病程頁右側嵌入生命徵象時間軸、用藥與醫囑變動、Lab、培養與藥敏等參考資料，並可把內容插進 note 的文字框。

**只讀資料**：腳本不寫病歷、不暫存、不改設定。插入的文字要使用者自己按 HIS 的暫存才會存檔。

## 功能與設計

- 內容：生命徵象、I/O、抗生素、培養共用一條時間軸；「自上一篇以來」的醫囑變動與 PRN；目前用藥；I/O 與體重；管路；Lab 表格（預設近 10 天，天數可改；欄位放不下時用 ‹ › 翻頁）；培養、未發報告與藥敏對照；影像報告；護理紀錄；護理交班。
- 隔離：工具列床號旁邊會標出這位病人目前的隔離，例如「隔離 MRSA VRE」。來源是醫囑清單裡的隔離醫囑：「空氣隔離-TB」取 TB、「接觸隔離-VRE」取 VRE，沒有後綴的（庫賈氏症隔離、防蚊隔離、飛沫隔離）取「隔離」前面那一段。開立算開始；被刪除，或另開一筆「取消「…隔離…」」算解除。滑鼠停上去看完整名稱與開立日。
- Lab 表格的分組：藥物濃度（Tacrolimus、Sirolimus、Everolimus/Certican、Vancomycin、Digoxin 等）自成一組 `Drug`。Multiplex PCR panel 的各個目標和抹片染色不放在 Lab 表格，改列在第三欄的「病原檢驗」（連同流感、新冠快篩），寫進 note 時屬於 `[Pathogen]`，例如 `<11/14> Pneumonia PCR: Haemophilus influenzae >=1.0E+07 copies/mL`，全陰性寫 `-`。
- 每個區塊標題左邊有展開／收合鈕。預設收合：自上一篇以來、護理紀錄、護理交班。Lab 的「項目」可以勾選要顯示哪些檢驗項目（預設只隱藏 eGFR），隱藏的項目插入時也不會帶入。這兩項設定記在瀏覽器的 localStorage（`pnw.fold`、`pnw.labHide`），所有病人共用。
- 每一列都有「插入」鈕，把文字插到 HIS 原生文字框的游標處。「補進 [Lab]」會把 note 裡 [Lab] 最後日期之後的新結果接到既有表格下面（用 `PNLab.process`）；只會加行，不會刪掉或改寫原有內容。
- 插入的目標欄位：
  - Free note 只有一個文字框，就插在那裡。
  - HIS 的結構化 Progress／Weekly／On-service／Off-service 有很多欄位：插進「使用者最後點過的那個欄位」，狀態列會寫出欄位名稱。
  - 還沒點過任何欄位時：V/S 進 Objective（On-service 進 Physical Exam and Assessment），其餘進目前這個 PAP 的 Assessment。
  - 「補進 [Lab]」優先找有 `[Lab]` 段的欄位。
- 一鍵帶入（工具列的「帶入」）：把今天要更新的資料放進目前這篇 note 對應的地方。原則是只填空的地方、只加不刪；每個欄位都能 Ctrl+Z 復原，不會存檔。
  - V/S：結構化 Progress 放進 Objective（On-service 是 Physical Exam and Assessment），Free note 放進 `[V/S]` 段。那裡是空的就填入；**每一行都是 V/S 數值**（前一篇帶過來的舊數值）就整段換成新的；夾了別的字（例如 HIS 帶的 Pain 分數、手寫的描述）就不動。在時間軸上選了時間點時，帶入的是那個時間的數值。
  - 管路：結構化 Progress 的 Assessment of Catheterization 是空的才填。Free note 只在有空的 `[Tube]` 段時填。
  - Lab：有 `[Lab]` 段就把新結果接在既有表格後面（同「補進 [Lab]」）。結構化 note 的 Assessment 沒有 `[Lab]` 段時，在最後加一段，只放上一篇之後的新抽血日。
  - 影像：寫進 `[Image]` 段，一筆一行 `<MM/DD> 檢查名稱: Impression`；有醫囑還沒報告的寫 `pending`。沒有 `[Image]` 段時接在 `[Lab]` 段後面新增；note 用的是 `[CXR]`、`[CT]` 這類分開的段落時不新增。
  - 病原：培養與病原檢驗（細菌、病毒、真菌…，流感與新冠快篩也算）寫進 `[Pathogen]` 段，一筆一行 `<MM/DD> 檢體或項目: 結果`，還沒發的寫 `pending`。沒有這一段時接在 `[Abx]` 段後面新增，沒有 `[Abx]` 就接在 `[Lab]` 後面。會新增的是：還在 pending 的、上一篇之後採檢的、以及採檢較早但上一篇之後才發報告的。「補進 [Lab]」也會一起補這一段。
  - 影像與病原這兩段會改到既有文字的只有三種情況，內容都不會少：原本寫 `pending`、現在有結果的那一行換成結果；舊寫法的 `[MM/DD]` 換成 `<MM/DD>`；舊版放在 `[Lab]` 底下的 `#. Culture:`、`#. Image:`，整段都是日期開頭的行時搬進新的段落（夾了手寫的字就留在原地）。
  - 做了什麼、哪些沒動和原因，都寫在狀態列（太長時滑鼠停在上面看全文）。再按一次不會重複加入。
- 時間軸：範圍有 24h／3 天／7 天／自訂（1–60 天）。在圖上點一個時間點，圖例與「插入 V/S」會改用那個時間的數值（一小時內最接近的各項）；再點一次或按「取消」回到最後一筆。
- 抓取範圍：生命徵象預設 7 天、I/O 7 天（最多 30 天）、檢驗 14 天；時間軸或 Lab 的天數調大時只重抓需要的來源。抗生素查到入院日（至少 31 天、最多 400 天），已停超過 10 天的收在「更早已停」，`[Abx]` 插入鈕帶整個住院期間。
- 多天的生命徵象走生命徵象頁的查詢介面，這個介面**不帶病人識別**（伺服器回「最後載入生命徵象頁的病人」）。防護有三層：同頁排隊、跨分頁的 Web Lock、以及拿帶病人識別的近兩天來源（OuterData）比對重疊時段，對不上就整份捨棄、只顯示近兩天並在時間軸標示。這次登入還沒開過生命徵象頁時，查詢會先失敗，腳本會用隱藏 iframe 載入一次該頁再重試（最多 8 秒）。
- **只讀資料**。腳本不會按暫存、確認或新增；插入的內容要使用者自己按 HIS 的按鈕才會存檔。
- 不搬動 HIS 的表單元素，只加 CSS 讓出右側空間、把文字框拉高；工具列的「收起」可以回到原生版面。在 iframe 裡不會啟動（`ntuh-progress-writer` 的 `/pn` 寫入流程用隱藏 iframe 載入病程頁，兩者互不干擾）。
- 寬度：右側面板是 `視窗寬 − 700`，限制在 700–1240px；面板不到 1080px 時改成兩欄、整區一起捲。視窗高度不到 820px 時時間軸預設用精簡模式。
- 原始碼在 `src/workspace/`：`his.js`（資料層）、`view.js`＋`view.css`（顯示層，放在 shadow DOM 裡）、`page.js`（嵌入與插入）。`build.js` 給檢驗整理加了一個 `PNLabSummary.structured()`，交出各項目的值、單位、參考值與高低判定。
- **HIS 的病程頁把 `Date.now()` 改寫成回傳 Date 物件**（舊版 date.js）。`Date.now() + n` 會變成字串相接，所以 `src/workspace/` 一律寫 `(+new Date())`。模擬頁也照樣改寫了 `Date.now`，這類錯在院外就測得到。
- 院外測試：`prototype/his-mock/InsertProgressNoteContent.aspx/` 是模擬病程頁（假資料），用專案根目錄起一個靜態伺服器後開
  `http://localhost:8770/prototype/his-mock/InsertProgressNoteContent.aspx/?SESSION=MOCK&AccountIDSE=26T00000000&PersonID=A000000000`。
  網址加 `&kind=progress` 是結構化 Progress note 的版面，加 `&kind=none` 是還沒開任何 note。
- 狀態（2026-11-17，v0.6.0）：在 HIS 病程頁實測過資料載入、時間軸（含自訂天數、點選時間點）、版面嵌入（Free note 與 Weekly Summary 表單）、收合、Lab 天數與翻頁、護理交班、抗生素查整個住院期間、多天生命徵象與病人比對。**還沒在 HIS 上測**：所有會寫進文字框的動作——插入、「補進 [Lab]」、一鍵帶入——都只在模擬頁測過（欄位 id 是從 HIS 讀來的）。
- 安裝與更新：專案根目錄起靜態伺服器後，在裝有 Tampermonkey 的瀏覽器開 `http://localhost:8770/dist/pn-workspace.user.js`，Tampermonkey 會跳出安裝／更新頁。
- `prototype/index.html` 是最初的版面原型（純假資料）。

## 建置

```
node build.js
```

產生三個檔案：

- `dist/pn-workspace.user.js`：Tampermonkey userscript。
- `dist/pn-workspace.console.js`：同一份程式包成 IIFE，開發時直接注入頁面（重複注入時新版會先收掉舊的那份）。
- `dist/pn-workspace.core.js`：只有資料層，除錯用。

## 原始碼

- `src/workspace/his.js`：資料層，所有對 HIS 的請求都在這裡，全部是讀取。
- `src/workspace/view.js`、`view.css`：顯示層，放在 shadow DOM 裡，不碰網路也不碰病歷表單。
- `src/workspace/page.js`：嵌進病程頁、決定插入到哪個欄位、「補進 [Lab]」。
- `prototype/`：最初的版面原型與模擬病程頁，都是假資料。

與其他專案共用的檔案是**複本**，改的時候兩邊都要改：

| 檔案 | 來源 | 用途 |
| --- | --- | --- |
| `src/pn-lab.js` | `ntuh-progress-writer/src/pn-lab.js` | Lab 的後處理：只留 note 最後日期之後的新結果、合併 Renal & e-、標 pending。`process()` 回傳整份文字（`text`，批次用）和分開的 `lab`、`pathogen`、`image`（這裡用） |
| `vendor/lab-summary.user.js` | NTUH-helper 的「檢驗整理」 | 把檢驗報告頁整理成表格；build 時去掉進入點、加上 `structured()` |

userscript 的 `@namespace` 仍是 `local.ntuh-progress-note`：改掉的話 Tampermonkey 會把它當成另一支腳本，已安裝的人會變成裝兩份。

## 病人資料

- 專案裡不放任何真實病人資料；`prototype/` 的內容全是捏造的。
- 在 HIS 上測試時，截圖、診斷輸出等含病人資料的檔案只放在工作階段的暫存目錄，不進這個資料夾，也不進 Git。
