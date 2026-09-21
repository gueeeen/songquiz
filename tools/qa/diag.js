// 查問題用的，不是測試。
//
// 限速跑一場，把每一次音檔的抓取和播放器的事件按時間印出來。
// 當初就是靠它看出兩件事：
//   * <audio> 的 canplaythrough 在騙人（585ms 就回報「可以播完」，只抓到 1.1 秒）
//   * headless WebKit 從頭到尾只發 loadstart，不發 canplay／canplaythrough／playing
//
// 用法：node serve.js &  然後  node diag.js
//       node diag.js webkit    ← 換瀏覽器

const playwright = require('@playwright/test');
const { throttle } = require('./specs/net');

(async () => {
  const which = process.argv[2] || 'chromium';
  if (!playwright[which]) {
    console.error('不認識這個瀏覽器：' + which + '（可以用 chromium、webkit、firefox）');
    process.exit(1);
  }

  const browser = await playwright[which].launch(
    which === 'chromium' ? { args: ['--autoplay-policy=no-user-gesture-required'] } : {},
  );
  const page = await browser.newPage();

  // 限速走 CDP，只有 Chromium 有。WebKit 就用這台機器真實的網速跑——
  // 拿它來看的是「發了哪些事件」，不是「花了幾秒」。
  if (which === 'chromium') await throttle(page);
  else console.log(which + " 不支援 CDP 限速，用真實網速跑。");

  let t0 = Date.now();
  const at = () => String(Date.now() - t0).padStart(6);
  const log = [];
  const say = (line) => log.push(at() + '  ' + line);

  // 預載走 fetch，不是 <audio>——所以要攔 fetch。
  // （這裡原本攔 window.Audio，那是舊實作留下來的，攔了永遠不會響。）
  await page.addInitScript(() => {
    const real = window.fetch;
    let n = 0;

    window.fetch = function (input) {
      const url = String(typeof input === 'string' ? input : input.url);
      if (!/\.m4a/.test(url)) return real.apply(this, arguments);

      const id = ++n;
      const started = performance.now();
      console.log(`QA 預載#${id} 開始 ${url.slice(-24)}`);

      return real.apply(this, arguments).then(function (response) {
        const clone = response.clone();
        clone.blob().then(function (blob) {
          console.log(`QA 預載#${id} 收完 ${(blob.size / 1024 / 1024).toFixed(2)} MB` +
            ` 花了 ${Math.round(performance.now() - started)}ms`);
        });
        return response;
      });
    };

    document.addEventListener('DOMContentLoaded', () => {
      const player = document.getElementById('player');
      ['loadstart', 'loadedmetadata', 'canplay', 'canplaythrough', 'playing', 'waiting']
        .forEach((event) => player.addEventListener(event,
          () => console.log(`QA 播放器 ${event} readyState=${player.readyState}`)));
    });
  });

  page.on('console', (message) => { if (message.text().startsWith('QA')) say('· ' + message.text()); });
  page.on('request', (request) => {
    if (/\.m4a/.test(request.url()) && request.resourceType() === 'media') {
      say('→ 播放器自己去要 ' + request.url().slice(-24) + '（沒吃到預載）');
    }
  });

  await page.goto('http://localhost:4173/');
  await page.locator('#lang-chips .chip').first().waitFor();
  await page.locator('#screen-home .mode[data-mode="speed"]').click();
  await page.locator('#count-chips .chip', { hasText: '10 題' }).first().click();

  t0 = Date.now();
  say('按下開始');
  await page.locator('#btn-start').click();
  await page.locator('#warmup').waitFor({ state: 'hidden', timeout: 75_000 });
  say('=== 預備結束 ===');

  for (let i = 0; i < 3; i++) {
    await page.waitForFunction(
      () => !/^載入中/.test(document.getElementById('play-hint').textContent),
      null, { timeout: 30_000 });
    say('=== 第 ' + (i + 1) + ' 題響了 ===');
    await page.waitForTimeout(1500);
    await page.locator('#choices .choice').first().click();
    const next = page.locator('#btn-next');
    if (!(await next.isVisible())) break;
    await next.click();
  }

  log.forEach((line) => console.log(line));
  await browser.close();
})();
