// 量「開場預備要卡多久」。不是測試，是拿來決定要囤幾首的。
//
// 這支的輸出就是 prefetch.js 裡那張表的來源，也是「上限用時間而不是首數」
// 這個決定的依據：同一個「五首」在好的 Wi-Fi 上是四秒，在慢速 3G 上是一分四十秒。
//
// 用法：node serve.js &  然後  node warmcost.js

const { chromium } = require('@playwright/test');
const { PROFILES, throttle } = require('./specs/net');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:4173/');
  await page.locator('#lang-chips .chip').first().waitFor();

  // 從真的題庫裡拿五首不同的歌。
  const urls = await page.evaluate(() => {
    const seen = new Set();
    const out = [];

    for (const track of window.SONG_BANK.tracks) {
      if (track.previewUrl && !seen.has(track.previewUrl)) {
        seen.add(track.previewUrl);
        out.push(track.previewUrl);
      }
      if (out.length === 5) break;
    }

    return out;
  });

  const sizes = [];
  for (const url of urls) {
    sizes.push(await page.evaluate(async (one) => {
      const response = await fetch(one, { method: 'HEAD' });
      return Number(response.headers.get('content-length') || 0);
    }, url));
  }

  const total = sizes.reduce((a, b) => a + b, 0);
  console.log('五首歌：' + sizes.map((n) => (n / 1024 / 1024).toFixed(2) + ' MB').join('、') +
    '　合計 ' + (total / 1024 / 1024).toFixed(2) + ' MB\n');

  console.log('網速                　1 首　　2 首　　3 首　　4 首　　5 首');
  console.log('─'.repeat(64));

  for (const key of Object.keys(PROFILES)) {
    const cdp = await throttle(page, key);

    // 每一種網速都換一組 cache-buster，不然第二種會直接吃到快取。
    const stamp = Date.now();
    const cumulative = await page.evaluate(async (args) => {
      const out = [];
      const t0 = performance.now();

      for (const url of args.urls) {
        await fetch(url + '?qa=' + args.stamp).then((response) => response.blob());
        out.push(Math.round(performance.now() - t0));
      }

      return out;
    }, { urls, stamp });

    console.log(PROFILES[key].name.padEnd(20) +
      cumulative.map((ms) => (ms / 1000).toFixed(1) + ' 秒').map((t) => t.padStart(7)).join(' '));

    await cdp.detach();
  }

  await browser.close();
})();
