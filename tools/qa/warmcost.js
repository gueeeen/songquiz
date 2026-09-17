// 量「開場預備要卡多久」。不是測試，是拿來決定要囤幾首的。
const { chromium } = require('@playwright/test');

const 網速 = [
  { 名: '好的 Wi-Fi  10 Mbps', bps: 10 * 1024 * 1024, 延遲: 40 },
  { 名: '普通 4G      4 Mbps', bps: 4 * 1024 * 1024, 延遲: 100 },
  { 名: '攤位 Wi-Fi   2 Mbps', bps: 2 * 1024 * 1024, 延遲: 300 },
  { 名: '很慢         1 Mbps', bps: 1 * 1024 * 1024, 延遲: 300 },
  { 名: '慢速 3G    400 Kbps', bps: 400 * 1024, 延遲: 400 },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:4173/');
  await page.locator('#lang-chips .chip').first().waitFor();

  // 從真的題庫裡拿五首不同的歌。
  const urls = await page.evaluate(() => {
    const seen = new Set();
    const out = [];
    for (const t of window.SONG_BANK.tracks) {
      if (t.previewUrl && !seen.has(t.previewUrl)) { seen.add(t.previewUrl); out.push(t.previewUrl); }
      if (out.length === 5) break;
    }
    return out;
  });

  console.log('五首歌，每首的大小：');
  const sizes = [];
  for (const u of urls) {
    const n = await page.evaluate(async (url) => {
      const r = await fetch(url, { method: 'HEAD' });
      return Number(r.headers.get('content-length') || 0);
    }, u);
    sizes.push(n);
  }
  console.log('  ' + sizes.map(n => (n / 1024 / 1024).toFixed(2) + ' MB').join('、') +
    '　合計 ' + (sizes.reduce((a, b) => a + b, 0) / 1024 / 1024).toFixed(2) + ' MB\n');

  console.log('網速                　1 首　　2 首　　3 首　　4 首　　5 首');
  console.log('─'.repeat(64));

  for (const s of 網速) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: s.延遲,
      downloadThroughput: s.bps / 8, uploadThroughput: s.bps / 8,
    });

    // 每次都換一組 cache-buster，不然第二種網速會直接吃到快取。
    const stamp = Date.now();
    const 累計 = await page.evaluate(async ({ urls, stamp }) => {
      const out = [];
      const t0 = performance.now();
      for (const u of urls) {
        await fetch(u + '?qa=' + stamp).then(r => r.blob());
        out.push(Math.round(performance.now() - t0));
      }
      return out;
    }, { urls, stamp });

    console.log(s.名.padEnd(20) +
      累計.map(ms => (ms / 1000).toFixed(1) + ' 秒').map(t => t.padStart(7)).join(' '));

    await cdp.detach();
  }

  await browser.close();
})();
