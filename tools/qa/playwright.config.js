// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * 實機那一類的自動化驗證。
 *
 * **這裡不重複 web/*.html 那三套做的事。** 那三套（規則 81 項、版面 55 項、
 * 整場 14 項）用無頭 Edge 跑得很快，涵蓋玩法與版面。這一份存在的理由只有一個：
 * 它們驗不到「真的會不會發出聲音」「預載有沒有真的變快」「Safari 的引擎上會怎樣」
 * 「兩台裝置連不連得上」。
 *
 * 三個瀏覽器：
 *   * iphone   ── WebKit ＋ iPhone 的視窗尺寸。**這是自動化能最接近 iOS 的東西**，
 *                 但不等於 iOS Safari：真機還有更嚴格的自動播放規則、鎖屏、
 *                 來電中斷。QA清單.md 裡標「只能實機」的那幾項仍然要人做。
 *   * android  ── Chromium ＋ Pixel 的視窗尺寸。
 *   * desktop  ── Chromium 桌機尺寸。
 *
 * 音訊：--autoplay-policy=no-user-gesture-required 只加在**不是在驗手勢**的測試上。
 * 驗手勢的那幾條刻意不加，否則測到的是「我把限制關掉了」。
 */
module.exports = defineConfig({
  testDir: './specs',

  // 這些測試會真的去 Apple 抓音檔，慢是正常的。
  timeout: 90_000,
  expect: { timeout: 15_000 },

  // 一次跑一個。多個同時跑會互相搶頻寬，把「載入要多久」測成隨機數。
  workers: 1,
  fullyParallel: false,

  // 網路會偶爾抖一下，但重試不能無限——重試兩次還過不了就是真的有問題。
  retries: process.env.CI ? 2 : 1,

  reporter: [['list'], ['html', { open: 'never' }]],

  // 預設測**工作目錄裡的版本**（serve.js 把 web/ 端成 HTTP）。
  // 開發時要驗的是手上改的東西，不是已經發佈的版本。
  // 要驗線上：QA_BASE_URL=https://gueeeen.github.io/songquiz/ npm test
  webServer: process.env.QA_BASE_URL ? undefined : {
    command: 'node serve.js',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
    timeout: 20_000,
  },

  use: {
    baseURL: process.env.QA_BASE_URL || 'http://localhost:4173/',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'iphone',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'android',
      use: {
        ...devices['Pixel 7'],
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
  ],
});
