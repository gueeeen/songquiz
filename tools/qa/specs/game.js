// 幫測試操作遊戲用的一層。
//
// 測試裡不要出現選擇器，否則改一個 id 就要改二十個檔案；
// 而且「怎麼知道一題開始了」這種判斷寫錯，會讓整組測試量到錯的東西。

const { expect } = require('@playwright/test');

/** 首頁：挑模式、挑題數、開始。 */
async function start(page, options = {}) {
  await page.goto('./');

  // 語種膠囊是 app.js 依題庫長出來的，所以「膠囊出現」＝題庫讀完了。
  await expect(page.locator('#lang-chips .chip').first()).toBeVisible();

  if (options.mode) {
    // 要限定在單人那半邊：多人大廳的「出題方式」也用 data-mode，
    // 不限定的話選擇器會同時抓到兩個。
    await page.locator(`#screen-home .mode[data-mode="${options.mode}"]`).click();
  }

  if (options.languages) {
    // 先全部取消再勾要的。直接點想要的那幾個會變成「加在預設之上」。
    const chips = page.locator('#lang-chips .chip');
    const count = await chips.count();

    for (let i = 0; i < count; i++) {
      const chip = chips.nth(i);
      const on = (await chip.getAttribute('aria-pressed')) === 'true';
      const wanted = options.languages.includes(await chip.textContent());
      if (on !== wanted) await chip.click();
    }
  }

  if (options.questionCount) {
    await page.locator('#count-chips .chip', { hasText: `${options.questionCount} 題` }).first().click();
  }

  await expect(page.locator('#btn-start')).toBeEnabled();
  await page.locator('#btn-start').click();
  await expect(page.locator('#screen-play')).toBeVisible();

  // 開場預備：先囤幾首才開始。這一段的等待是刻意的，不算在每一題的等待裡。
  // 預備畫面本身就是被測的東西時，不要等它消失。
  if (options.waitForWarmup === false) return;

  // 預備的上限是六十秒（prefetch.js 的 WARM_LIMIT_MS），等它等滿還要留餘裕。
  await expect(page.locator('#warmup')).toBeHidden({ timeout: 75_000 });
}

/** 等這一題真的「開始」——不是選項出現，是計時開始跑。 */
async function waitForQuestionStart(page) {
  // app.js 在出題時把提示設成「載入中…」，等音樂真的響（或三秒守門到期）
  // 才換掉它。所以「提示不再是載入中」＝這一題開始了。
  //
  // 三個踩過的坑：
  //   * 用「選項出現」當基準：選項在音檔還沒來的時候就畫好了，量到的永遠是 0。
  //   * 開場預備結束的瞬間，提示曾經還是 index.html 的預設值（不是「載入中」），
  //     這個 wait 會立刻返回，量到 4 毫秒——看起來超快，其實什麼都沒等到。
  //     現在 app.js 在收起預備畫面**之前**就先把提示設成「載入中…」，洞補掉了。
  //   * 也試過改看倒數（#timer-text < 12），那個更糟：秒答的話上一題的殘值
  //     本來就小於 12，每一題都立刻通過，連限速下都量出 4 毫秒。
  await expect(page.locator('#play-hint')).not.toHaveText(/^載入中/, { timeout: 30_000 });
}

/** 現在是第幾題。 */
async function questionNumber(page) {
  const text = await page.locator('#hud-progress').textContent();
  const match = text.match(/第\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

/**
 * 隨便答一題，然後走到下一題（或結算）。
 *
 * `think` 是「聽幾秒才按」。預設 0，因為大部分測試不在乎作答速度，跑越快越好。
 * 但**量載入時間的時候一定要給它一個真實的值**：0 秒作答等於要求預載在翻牌的
 * 那一秒內把整首歌抓完，慢網路下那是做不到的（1 MB ÷ 2 Mbps ＝ 4 秒），
 * 測到的會是頻寬不是程式。
 */
async function answerAndAdvance(page, { think = 0 } = {}) {
  if (think) await page.waitForTimeout(think);
  await page.locator('#choices .choice').first().click();
  await expect(page.locator('#verdict')).toBeVisible();

  // 中間那幾題一秒後會自己跳，最後一題的鈕是「看結算」而且刻意不自動。
  const next = page.locator('#btn-next');
  if (await next.isVisible()) await next.click();
}

/** 這一頁實際發出去的音檔請求。 */
function watchAudio(page) {
  const requests = [];

  page.on('request', (request) => {
    if (/\.m4a(\?|$)/.test(request.url())) requests.push({ url: request.url(), at: Date.now() });
  });

  return requests;
}


/**
 * 盯著 #player.src：吃到預載就是 blob:，沒吃到就是 https:。順便數 revokeObjectURL。
 *
 * 為什麼看 src 而不看網路請求：被 AbortController 中止的下載，位元組已經到了，
 * Playwright 照樣報 requestfinished——從外面看會誤判成「我們有了」。
 * player.src 是頁面自己的選擇，騙不了人。
 *
 * 要在 goto 之前叫。
 */
async function watchPlayer(page) {
  await page.addInitScript(() => {
    window.__qaSrc = [];
    window.__qaRevoked = 0;

    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = function (url) { window.__qaRevoked += 1; return revoke(url); };

    document.addEventListener('DOMContentLoaded', () => {
      const player = document.getElementById('player');
      const real = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');

      Object.defineProperty(player, 'src', {
        get() { return real.get.call(this); },
        set(value) { window.__qaSrc.push(String(value).slice(0, 12)); return real.set.call(this, value); },
      });
    });
  });

  return {
    async read() {
      const raw = await page.evaluate(() => ({ src: window.__qaSrc, revoked: window.__qaRevoked }));
      return {
        blobs: raw.src.filter((s) => s.startsWith('blob:')).length,
        remote: raw.src.filter((s) => s.startsWith('https:')).length,
        revoked: raw.revoked,
      };
    },
    /** 兩個計數都要歸零，不然 read() 會把「這一段」和「整頁累計」混在一起。 */
    reset() { return page.evaluate(() => { window.__qaSrc = []; window.__qaRevoked = 0; }); },
  };
}

/**
 * 打完 count 題（或打到結算為止），回傳每一題的等待毫秒數與題號。
 *
 * `think` 是「聽幾秒才按」。預設 0（秒答），量載入時間的時候一定要給它一個
 * 真實的值——0 秒作答等於要求預載在翻牌的那一秒內把整首歌抓完，
 * 慢網路下那是做不到的，測到的會是頻寬不是程式。
 */
async function playThrough(page, count, { think = 0 } = {}) {
  const waits = [];
  const numbers = [];

  for (let i = 0; i < count; i++) {
    const shown = Date.now();
    await waitForQuestionStart(page);
    waits.push(Date.now() - shown);

    if (await page.locator('#screen-result').isVisible()) break;

    numbers.push(await questionNumber(page));
    await answerAndAdvance(page, { think });
  }

  return { waits, numbers };
}

module.exports = {
  start,
  waitForQuestionStart,
  questionNumber,
  answerAndAdvance,
  watchAudio,
  watchPlayer,
  playThrough,
};
