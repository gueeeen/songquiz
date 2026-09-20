// 多人房：兩個瀏覽器、兩條連線、真的走 Supabase。
//
// 這是 web/*.html 那三套完全驗不到的一塊——它們是單一頁面裡的假通道，
// 驗得到訊息格式，驗不到「兩台機器真的看到同一題」。

const { test, expect } = require('@playwright/test');

/** 房間的每個 id 都有 r- 前綴。 */
const r = (id) => `#r-${id}`;

async function openRoom(context, nick) {
  const page = await context.newPage();
  await page.goto('./');
  // 單人和多人兩塊各有一組切換鈕（兩邊長得一樣是刻意的），要限定在單人那邊按。
  await page.locator('#screen-home .who-pick[data-who="room"]').click();
  await expect(page.locator(r('nick'))).toBeVisible();
  await page.locator(r('nick')).fill(nick);
  return page;
}

/** 九個選項的字，用來比對兩邊是不是同一題。 */
async function choicesOf(page) {
  return page.locator(`${r('choices')} .choice`).allTextContents();
}

test.describe('多人房', () => {
  // WebKit 起不來的機器上，整組明確地跳過並說出原因——
  // 不然每一條都會回一樣的 launch 失敗，把真正的失敗埋掉（見 webkit-check.js）。
  test.skip(
    ({ browserName }) => browserName === 'webkit' && process.env.QA_WEBKIT_OK !== '1',
    'WebKit 在這台機器上起不來（Smart App Control 擋掉未簽章的 jxl.dll）',
  );

  // 兩條 Supabase 連線加上開場預備，比單人那幾條慢。
  test.setTimeout(150_000);

  test('兩台機器看到同一題，而且房主等大家囤好才開場', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', '兩個 context 各開一條 Supabase 連線，只在 Chromium 上跑');

    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();

    try {
      const host = await openRoom(hostContext, '房主');
      const guest = await openRoom(guestContext, '客人');

      // 開房。題數挑最少的，整場跑得完。
      await host.locator(`${r('count-chips')} .chip`).first().click();
      await host.locator(r('btn-create')).click();

      await expect(host.locator(r('room-code'))).not.toHaveText('----', { timeout: 30_000 });
      const code = (await host.locator(r('room-code')).textContent()).trim();

      await guest.locator(r('join-code')).fill(code);
      await guest.locator(r('btn-join')).click();

      // 兩個人都進來了才開始，否則房主會以為只有自己。
      await expect(host.locator(r('player-count'))).toHaveText(/2 人/, { timeout: 30_000 });

      await host.locator(r('btn-start-round')).click();

      // 開場預備：兩邊都該看到，而且**房主不會在客人還沒囤好之前就發題**。
      // 客人那一邊的預備畫面是收到第一題才收起來的，所以「客人看到過預備」
      // 就證明房主等過了。
      await expect(guest.locator(r('warmup'))).toBeVisible({ timeout: 30_000 });

      await expect(host.locator(`${r('choices')} .choice`)).toHaveCount(9, { timeout: 60_000 });
      await expect(guest.locator(`${r('choices')} .choice`)).toHaveCount(9, { timeout: 60_000 });

      // 預備畫面該收乾淨了。
      await expect(host.locator(r('warmup'))).toBeHidden();
      await expect(guest.locator(r('warmup'))).toBeHidden();

      // 同一題：九個選項的字要逐字相同，順序也要一樣
      //（順序不同的話，「第三個」對兩個人就不是同一首歌）。
      expect(await choicesOf(guest), '兩邊看到的不是同一題').toEqual(await choicesOf(host));

      // 而且兩邊都真的在放歌——房間裡卡住的人等於直接輸掉。
      for (const page of [host, guest]) {
        await expect.poll(
          () => page.evaluate(() => document.getElementById('r-player').currentTime),
          { message: '有一邊沒有真的在播', timeout: 30_000 },
        ).toBeGreaterThan(0);
      }
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
});
