const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 300,
    downloadThroughput: (2 * 1024 * 1024) / 8, uploadThroughput: (1024 * 1024) / 8,
  });

  let t0 = Date.now();
  const at = () => String(Date.now() - t0).padStart(6);
  const log = [];
  const say = (s) => log.push(`${at()}  ${s}`);

  page.on('request', r => { if (/\.m4a/.test(r.url())) say(`→ 送出 ${r.url().slice(-24)} range=${r.headers().range || '-'}`); });
  page.on('requestfinished', async r => {
    if (!/\.m4a/.test(r.url())) return;
    const sizes = await r.sizes().catch(() => ({}));
    say(`✔ 收完 ${r.url().slice(-24)} ${sizes.responseBodySize || '?'} bytes`);
  });
  page.on('console', m => { if (m.text().startsWith('QA')) say(`· ${m.text()}`); });

  await page.goto('http://localhost:4173/');
  await page.locator('#lang-chips .chip').first().waitFor();
  await page.locator('#screen-home .mode[data-mode="speed"]').click();
  await page.locator('#count-chips .chip', { hasText: '10 題' }).first().click();

  // 從頁面裡看預載的那幾顆 Audio 到底發生什麼事
  await page.evaluate(() => {
    const Real = window.Audio;
    let n = 0;
    window.Audio = function () {
      const a = new Real();
      const id = ++n;
      ['loadstart', 'loadedmetadata', 'canplay', 'canplaythrough', 'error', 'suspend', 'stalled'].forEach(ev =>
        a.addEventListener(ev, () => console.log(`QA 預載#${id} ${ev} readyState=${a.readyState} buffered=${a.buffered.length ? a.buffered.end(0).toFixed(1) : 0}s`)));
      return a;
    };
    const p = document.getElementById('player');
    ['loadstart', 'loadedmetadata', 'canplay', 'canplaythrough', 'playing', 'waiting'].forEach(ev =>
      p.addEventListener(ev, () => console.log(`QA 播放器 ${ev} readyState=${p.readyState}`)));
  });

  t0 = Date.now();
  say('按下開始');
  await page.locator('#btn-start').click();
  await page.locator('#warmup').waitFor({ state: 'hidden', timeout: 45000 });
  say('=== 預備結束 ===');
  await page.waitForFunction(() => !/^載入中/.test(document.getElementById('play-hint').textContent), null, { timeout: 30000 });
  say('=== 第一題開始響 ===');

  await page.waitForTimeout(1000);
  log.forEach(l => console.log(l));
  await browser.close();
})();
