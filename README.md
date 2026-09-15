# 流行音樂猜歌王 SongQuiz

聽 30 秒試聽裡的一段，從九個選項裡選出是哪一首。**純靜態網頁**，雙擊就能玩。

開場先挑三件事：**語種（多選）**、**題數**（5／10／15／20）、**模式**。

- **闖關模式**：關卡跟著你挑的語種長——選 k 個語種就是 k+1 關，一關解鎖一個新語種，
  最後一關全部混合。每關要達到門檻分數才能過，沒過就從第一關重來。
- **競速模式**：一場打完，每題十二秒，答得越快分越高。
- **積分模式（連對加成）**：答對就連莊，倍率一路往上最高 ×5，答錯歸零。
  **不看速度**——只看你能連幾題。

設定會記住，下次打開沿用。題庫湊不出你挑的組合時（例如只選台語卻要每關 20 題），
開打前就會告訴你差幾首，而不是玩到一半沒歌。

題庫 **512 首可出題**、**765 個誘餌**（只當錯誤選項、不會被出題的歌名）。

---

## 玩

雙擊 **`開啟網站.cmd`**，或直接雙擊 `web\index.html`。

沒有伺服器、沒有安裝步驟、沒有打包工具。整個 `web\` 資料夾丟到任何靜態空間
（GitHub Pages 之類）也能直接跑。

**和朋友在同一個 Wi-Fi 搶答**：雙擊 **`區域網路開房.cmd`**，它會印出這台電腦的
區域網路網址（像 `http://192.168.0.17:5000/room.html`）——叫朋友用手機瀏覽器打開它，
一個人建房、把四位房號念出來，其他人輸入房號就進來了。
**不用註冊、不用金鑰、不用改任何設定**（網頁就是這台電腦送出去的，
所以它自己就知道中繼在哪裡）。第一次跑要在 Windows 防火牆提示按「允許存取」。
朋友不在同一個場地才需要另外設定 Supabase，步驟見 `多人房間.md`。

個人最佳成績記在瀏覽器的 localStorage 裡，按「模式＋題數＋語種組合」各記一筆
（闖關另外記最遠關卡）——5 題的積分和 20 題的闖關不是同一件事，混在一起比沒有意義。
換瀏覽器或清掉網站資料就會歸零——這是刻意的，沒有伺服器就沒有跨裝置的成績。

## 重建題庫

雙擊 **`重建題庫.cmd`**（需要網路，約一分鐘）。

它會照 `tools\SongQuiz.BankBuilder\Artists.cs` 的演出者名單，循序向 Apple 的
公開 Search API 查歌（約 64 個請求、每次間隔 400 毫秒），產生 `web\data\bank.js`。
想換歌就改那份名單。

`bank.js` **有進版控**——純靜態站的話，那個檔就是網站的內容本體，
少了它 clone 下來沒裝 .NET 的人就沒得玩。但 Apple 的試聽網址會過期，
放久了記得重建。

參數：

| 參數 | 預設 | 說明 |
|---|---|---|
| `--per-artist` | 8 | 每位演出者取幾首進題庫 |
| `--decoys` | 12 | 每位演出者取幾首當誘餌 |
| `--country` | TW | Apple 商店地區 |
| `--delay` | 400 | 兩次請求間隔（毫秒） |
| `--out` | `web\data\bank.js` | 輸出位置 |

## 測試

**遊戲規則**（68 項）：打開 `web\tests.html`，最上面會顯示 `RESULT PASS 68/68`。

**版面**（45 項）：打開 `web\layout-tests.html`。它把 `index.html` 分別用 390px 和
1200px 的寬度載進兩個 iframe，量實際排出來的尺寸——開始鈕有沒有釘在底部、出處會不會
被它蓋住、九宮格在桌機上是不是還像格子、日夜兩種主題的對比夠不夠（連「卡片對頁面」
和「邊框對卡片」都量，只量文字會漏掉「字很清楚但整頁糊成一片」那種壞法）。
這些都是宣告寫對、卻被別條規則蓋掉就看不出來的東西，所以一律量
`getBoundingClientRect` 和 `getComputedStyle`，不看 CSS 原始碼。

**整場**（14 項）：打開 `web\playthrough.html`。它把一整場十題從頭打到完，
看會不會走到結算頁，以及「再來一場」有沒有真的把上一場洗掉。
前兩份都不會真的跑完一局，而「打到第七題就卡住」這種錯，只有真的打完才看得到。

測試不依賴 Node，也沒有測試框架：三頁都是自己寫的極小跑法，打開就跑完。
要無頭跑（CI 也能用同一條）：

```
msedge --headless=new --disable-gpu --virtual-time-budget=5000 --dump-dom "file:///…/web/tests.html"

msedge --headless=new --disable-gpu --allow-file-access-from-files ^
       --virtual-time-budget=20000 --dump-dom "file:///…/web/layout-tests.html"

msedge --headless=new --disable-gpu --allow-file-access-from-files ^
       --autoplay-policy=no-user-gesture-required ^
       --virtual-time-budget=120000 --dump-dom "file:///…/web/playthrough.html"
```

後兩條一定要加 `--allow-file-access-from-files`：從 `file://` 開的頁面，
iframe 算跨來源，沒有這個旗標就讀不到裡面的文件，測試會全部掛在「讀得到被測頁面」。

**題庫產生器**（19 項，歌名清洗與輸出格式）：`dotnet test`。

以上全部是無頭瀏覽器在桌機上跑的。**真機、真的發得出聲音、兩台裝置連不連得上——
那些自動測試驗不到**，清單在 [QA清單.md](QA清單.md)，要拿著手機一項一項做。

---

## 出處與授權

### 音源：Apple Music 官方 30 秒試聽

播放的每一段都是 **Apple Music 官方的 30 秒試聽**，透過 Apple 公開的
[iTunes Search API](https://performance-partners.apple.com/search-api) 取得網址，
播放時**由 Apple 的伺服器直接串流到玩家的瀏覽器**。

- 本專案**不下載、不轉存、不代理、不快取**任何音訊；`web/data/bank.js` 裡存的
  只有歌名、演出者與 Apple 的試聽網址。
- **所有歌曲的著作權屬於原權利人**（詞曲作者、表演者、唱片公司）。
- 本專案與 Apple Inc. 沒有任何關係，也未經其背書。Apple、Apple Music、iTunes
  是 Apple Inc. 的商標。

### 玩法：參考台大流行音樂創作社

玩法（九選一、每題十二秒、語種逐關解鎖、題庫做成 `.js` 而不是 `.json`）參考了
**台大流行音樂創作社（NTUPM）** 的「金曲猜歌王」
[ntupm-songguesser](https://github.com/ntupm18th/ntupm-songguesser)（MIT 授權）。

**本專案的程式碼是獨立實作的**：沒有取用它的任何程式碼、題庫、誘餌清單或素材。
向他們把這個玩法做出來並且開源致謝。

### 本專案的程式碼

MIT，見 [LICENSE](LICENSE)。**授權只涵蓋本專案的原始碼，不涵蓋歌曲。**

---

## 目錄

```
web/                  這就是網站本體
  index.html
  style.css
  js/rules.js         規則與計分（純函式，不碰 DOM）
  js/questions.js     出題：九選一、同語種誘餌
  js/game.js          回合狀態機：闖關／競速／積分
  js/app.js           唯一碰 DOM 與音訊的檔案
  data/bank.js        題庫（window.SONG_BANK）
  tests.html          規則測試，打開就跑
  room.html           轉址到 index.html#room（舊網址還在流傳）
  js/shell.js         單人／多人的切換（同一頁，不跳頁）
  js/realtime.js      即時層：同機／區域網路／Supabase 三個 adapter 共用一組介面
  js/room.js          房間邏輯：名冊、出題同步、搶答仲裁、排行榜
  js/feedback.js      意見箱：只送出，不讀回（那張表沒有開讀取權限）
  js/feedbackui.js    意見箱的畫面：左下角的信箱打開的那顆彈窗
tools/
  SongQuiz.BankBuilder/   C# 離線工具：產生 data/bank.js
  SongQuiz.LanServer/     C# 區域網路伺服器：靜態檔 ＋ WebSocket 中繼，不懂遊戲
  supabase-排行榜.sql     建排行榜的表（只跑一次）
  supabase-意見箱.sql     建意見箱的表（只跑一次；只給寫不給讀）
tests/
  SongQuiz.BankBuilder.Tests/
架構.md               為什麼是靜態站、答案在瀏覽器裡的取捨
多人房間.md           三條連線路徑、房間協定、怎麼驗
QA清單.md             自動測試驗不到的那些，要拿著手機做

代辦清單.md           做到哪、下一步做什麼
```

## 已知的取捨

**答案在瀏覽器裡。** 純靜態就代表題庫、正解、計分公式都在玩家手上，
開發者工具看得到——和參考站一樣。要做可信的排行榜時，判分必須搬回伺服器；
第一版的 ASP.NET Core 判分實作留在 git 歷史（提交「骨幹：兩種模式的猜歌遊戲，答案留在伺服器」）可以翻回去參考。
