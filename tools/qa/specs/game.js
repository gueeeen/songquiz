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
  await expect(page.locator('#warmup')).toBeHidden({ timeout: 40_000 });
}

/**
 * 等這一題真的「開始」——不是選項出現，是計時開始跑。
 *
 * 這個分別是整組測試的關鍵：選項在音檔還沒來的時候就畫好了，
 * 用選項出現當基準的話，量到的永遠是 0 毫秒。
 * app.js 是在音樂真的響（或三秒守門到期）才開始計時的，所以看提示文字。
 */
async function waitForQuestionStart(page) {
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

module.exports = { start, waitForQuestionStart, questionNumber, answerAndAdvance, watchAudio };
