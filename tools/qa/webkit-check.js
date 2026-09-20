// 開跑前先確認 WebKit 起不起得來，起不來就讓 iphone 那一組明確地跳過。
//
// 為什麼需要這一支：Windows 的 Smart App Control 會擋掉沒有簽章的執行檔，
// 而 Playwright 的 WebKit 附的 jxl.dll 沒有簽章——DLL 載不進去，
// 瀏覽器以 0xC0000142（DLL 初始化失敗）死掉。症狀是每一條 iphone 測試都回
// 「browserType.launch: Target page, context or browser has been closed」，
// 二十幾條一模一樣的錯誤會把真正的失敗埋掉。
//
// **刻意不去關 Smart App Control**：那是整台機器的安全降級，而且 Windows 只讓你
// 關、不讓你開回來。為了一個測試專案不值得。
//
// 查自己這台是不是這個狀況：
//   Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy'
//     → VerifiedAndReputablePolicyState 1 ＝ 開著
//   Get-AuthenticodeSignature "$env:LOCALAPPDATA\ms-playwright\webkit-*\jxl.dll"
//     → NotSigned
//
// 跳過不等於驗過。iOS 那一側還是要拿手機做，清單在 QA清單.md。

const { webkit } = require('@playwright/test');

module.exports = async () => {
  try {
    const browser = await webkit.launch();
    await browser.close();
    process.env.QA_WEBKIT_OK = '1';
  } catch (error) {
    process.env.QA_WEBKIT_OK = '0';
    console.warn(
      '\n⚠ WebKit 在這台機器上起不來，iphone 那一組會整組跳過。\n' +
      '  原因通常是 Smart App Control 擋掉未簽章的 jxl.dll（見 webkit-check.js 的說明）。\n' +
      '  Chromium 那兩組照跑。iOS 的部分請依 QA清單.md 用實機驗。\n' +
      '  原始錯誤：' + String(error.message).split('\n')[0] + '\n',
    );
  }
};
