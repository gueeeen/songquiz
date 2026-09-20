# tools/qa —— 真的開瀏覽器的那一層測試

`web/` 裡那三份 `*.html` 測試跑得很快，但它們是無頭 Edge、連不到外網，
所以有一整類東西驗不到。這一層補的就是那些：

| 驗什麼 | 檔案 |
| --- | --- |
| 真的發得出聲音、慢網路下會不會卡、預載有沒有生效 | `specs/audio.spec.js` |
| 兩台機器看到同一題、房主等不等大家 | `specs/room.spec.js` |
| 操作遊戲用的一層（選擇器只寫在這裡） | `specs/game.js` |

## 怎麼跑

```
npm install                    # 第一次
npx playwright install chromium webkit

npm test                       # 三組瀏覽器全跑
npm test -- --project=desktop  # 只跑桌機，開發時最常用
npm run test:headed            # 看得到畫面
npm run report                 # 打開上一次的報告
```

一輪正常的結果是 **28 通過、5 跳過**。跳過的那五條用 Chrome DevTools Protocol
（限速兩條、囤五首、不等了、多人房），WebKit 沒有。

## WebKit 起不來的時候

開頭印出「WebKit 在這台機器上起不來」就是這個狀況，`iphone` 那一組會整組
明確跳過（**22 通過、11 跳過**），Chromium 兩組照跑。

原因幾乎都是 Windows 的 Smart App Control：它擋掉沒有簽章的執行檔，而 Playwright
的 WebKit 附的 `jxl.dll` 沒有簽章——DLL 載不進去，瀏覽器以 `0xC0000142` 死掉。
確認方式：

```powershell
(Get-ItemProperty 'HKLM:SYSTEMCurrentControlSetControlCIPolicy').VerifiedAndReputablePolicyState
# 1 = Smart App Control 開著
Get-AuthenticodeSignature "$env:LOCALAPPDATAms-playwrightwebkit-*jxl.dll"
# NotSigned
```

**不要為了這個去關 Smart App Control。** 那是整台機器的安全降級，而且 Windows
只讓你關、不讓你開回來。WebKit 這一組本來就只是「最接近 iOS 的東西」，
不等於 iOS Safari；跳過它的代價是回到原本的狀態——iOS 那一側靠實機驗，
清單在 `QA清單.md`。要真的跑 WebKit 就換一台沒開 SAC 的機器或 CI。

## 測的是哪一份程式

**預設是工作目錄裡的版本。** `serve.js` 把 `web/` 端在 `http://localhost:4173/`，
Playwright 啟動時自己拉起來。開發時要驗的是手上改的東西，不是已經發佈的版本
（這件事踩過坑：對著線上跑，改壞了也看不出來）。

要驗線上就給 `QA_BASE_URL`：

```
set QA_BASE_URL=https://gueeeen.github.io/songquiz/ && npm test
```

給 `file://` 不會動——那個站雖然雙擊就能玩，但 Playwright 的 baseURL
解相對路徑的方式不一樣。

## diag.js

不是測試，是查問題用的。限速跑一場，把每一個音檔請求和播放器事件按時間印出來：

```
node serve.js &
node diag.js
```

當初就是靠它看出 `canplaythrough` 在騙人——限速下它 585 毫秒就回報
「可以一路播完」，但那時候 `buffered` 只有 1.1 秒（整首 30 秒）。
瀏覽器是拿下載速率去*估*的，不是真的抓完。預載因此改成用 `fetch`。

## 這一層仍然取代不了實機

Playwright 的 WebKit **不是** iOS Safari：真機的自動播放規則更嚴，
還有鎖屏、切 App、來電中斷。`QA清單.md` 裡標明了哪些還是要拿手機做。
