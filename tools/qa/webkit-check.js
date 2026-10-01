// 開跑前先確認 WebKit 真的能開頁面，不能就讓 iphone 那一組明確地跳過。
//
// 為什麼需要這一支：Windows 的 Smart App Control 會擋掉沒有簽章的執行檔，
// 而 Playwright 的 WebKit 整包都沒有簽章。症狀是每一條 iphone 測試都回
//「Target page, context or browser has been closed」，十幾條一模一樣的錯誤
// 會把真正的失敗埋掉。
//
// **為什麼要試到 newPage，不能只試 launch。**
// 這一支原本只做 `launch()` ＋ `close()`，而那漏掉了真正的失敗模式：
// 主程序 Playwright.exe 起得來（launch 成功，連得上，problemsVersion 都讀得到），
// 但開頁面要再載入 WebKitNetworkProcess.exe，那一個被擋——所以瀏覽器是在
// **newPage() 才死**的。探測器因此回報「WebKit 沒問題」，然後 13 條測試
// 以同一個訊息失敗。實測（2026-10-01）：
//
//     launch  ok  connected=true  version=26.6
//     context ok
//     FAIL at newPage: Target page, context or browser has been closed
//
// 事件檢視器裡的原文（CodeIntegrity/Operational，id 3033／3077）：
//
//     Code Integrity determined that a process (…\Playwright.exe) attempted to
//     load …\WebKitNetworkProcess.exe that did not meet the Enterprise signing
//     level requirements
//
// 教訓是通用的：**探測器要走完真正要用到的那條路**，不是走到第一個會成功的
// 呼叫就收工。
//
// **這件事會自己變。** SAC 是看「信譽」的，同一台機器同一包 WebKit，今天早上
// 還能跑（那幾輪有 5 條 iphone 測試真的通過），下午就被擋了。所以這個探測
// 每次開跑都要重跑一遍（它掛在 globalSetup 上），不能記在設定檔裡。
//
// **刻意不去關 Smart App Control**：那是整台機器的安全降級，而且 Windows 只讓你
// 關、不讓你開回來。為了一個測試專案不值得。
//
// 查自己這台是不是這個狀況：
//   Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy'
//     → VerifiedAndReputablePolicyState 1 ＝ 開著
//   Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-CodeIntegrity/Operational';
//                                   StartTime=(Get-Date).AddHours(-1)}
//     → 會指名是哪一個檔案被擋
//
// 跳過不等於驗過。iOS 那一側還是要拿手機做，清單在 QA清單.md。

const { webkit } = require('@playwright/test');

/** 探測的上限。被 SAC 擋的時候 newPage 會卡到逾時，不能讓它卡住整場。 */
const PROBE_TIMEOUT_MS = 25_000;

module.exports = async () => {
  let browser = null;

  try {
    await withTimeout(async () => {
      browser = await webkit.launch();

      // 一路走到「頁面上真的有東西」。少任何一步都驗不到上面那個失敗模式：
      // launch 會過、newContext 也會過，死的是 newPage。
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.setContent('<p id="ok">ok</p>');

      const text = await page.textContent('#ok');
      if (text !== 'ok') throw new Error('頁面開起來了但讀不到內容（' + text + '）');
    }, PROBE_TIMEOUT_MS);

    process.env.QA_WEBKIT_OK = '1';
  } catch (error) {
    process.env.QA_WEBKIT_OK = '0';
    console.warn(
      '\n⚠ WebKit 在這台機器上開不了頁面，iphone 那一組會整組跳過。\n' +
      '  原因通常是 Smart App Control 擋掉未簽章的 WebKitNetworkProcess.exe\n' +
      '  （見 webkit-check.js 的說明，裡面有查證的指令）。\n' +
      '  Chromium 那兩組照跑。iOS 的部分請依 QA清單.md 用實機驗。\n' +
      '  原始錯誤：' + String(error && error.message).split('\n')[0] + '\n',
    );
  } finally {
    // 關不掉也不要讓探測本身變成失敗——它已經死了才會走到這裡。
    if (browser) await browser.close().catch(() => {});
  }
};

function withTimeout(run, ms) {
  return Promise.race([
    run(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('探測超過 ' + ms + ' 毫秒')), ms)),
  ]);
}
