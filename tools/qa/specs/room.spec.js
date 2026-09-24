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
  test('中途有人敲門，不會把正在玩的人踢掉', async ({ browser, browserName }) => {
    // **這一條是照著一個真實的 bug 寫的。** 現場實際玩的時候，一個人中途輸入房號，
    // 其他所有非房主都被踢回大廳並顯示「這一場已經開打了」。
    //
    // 原因：房主是用 roster **廣播**回覆「正在進行中」的，而每個非房主收到 roster
    // 都照著 phase 走——於是全場一起 leaveRoom()。一個人敲門，整場被踢。
    //
    // 要三個 context 才測得到：房主、一個正在玩的人、一個中途敲門的人。
    // 兩個 context 的版本永遠看不到這個 bug，因為被踢的是「其他人」。
    test.skip(browserName !== 'chromium', '三條 Supabase 連線，只在 Chromium 上跑');

    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const laterContext = await browser.newContext();

    try {
      const host = await openRoom(hostContext, '房主');
      const player = await openRoom(playerContext, '正在玩的人');

      // 五題就好，這一條要跑到一場結束。
      await host.locator(`${r('count-chips')} .chip`).first().click();
      await host.locator(r('btn-create')).click();

      await expect(host.locator(r('room-code'))).not.toHaveText('----', { timeout: 30_000 });
      const code = (await host.locator(r('room-code')).textContent()).trim();

      await player.locator(r('join-code')).fill(code);
      await player.locator(r('btn-join')).click();
      await expect(host.locator(r('player-count'))).toHaveText(/2 人/, { timeout: 30_000 });

      await host.locator(r('btn-start-round')).click();

      // 兩邊都真的在玩了。
      await expect(host.locator(`${r('choices')} .choice`)).toHaveCount(9, { timeout: 60_000 });
      await expect(player.locator(`${r('choices')} .choice`)).toHaveCount(9, { timeout: 60_000 });

      // ── 現在讓第三個人中途敲門 ──
      const later = await openRoom(laterContext, '晚到的人');
      await later.locator(r('join-code')).fill(code);
      await later.locator(r('btn-join')).click();

      // **最重要的一條：正在玩的人不能被踢掉。**
      // 給訊息傳播的時間，然後確認他還在遊戲畫面上，而且大廳沒有跳錯誤。
      await player.waitForTimeout(3000);
      await expect(player.locator(r('screen-play')), '正在玩的人被踢出遊戲畫面了').toBeVisible();
      await expect(player.locator(`${r('choices')} .choice`)).toHaveCount(9);
      await expect(player.locator(r('screen-lobby'))).toBeHidden();

      // 晚到的人要排隊，而且**留在房裡**——不是退回大廳叫他重新輸入房號。
      await expect(later.locator(r('screen-waiting')), '晚到的人沒有進到等待室').toBeVisible();
      await expect(later.locator(r('waiting-hint'))).toHaveText(/排在第 1 位/);
      await expect(later.locator(r('lobby-error'))).toBeHidden();

      // 房主那邊也要看得到有人在等（名單在等待室，畫面雖然藏著但字要對）。
      // 原本這裡查的是 later —— 和上面兩行同一頁，所以房主的顯示從來沒被測到。
      await expect(host.locator(r('player-count'))).toHaveText(/1 人排隊/);

      // ── 打完這一場，排隊的人要自動進來 ──
      for (let i = 0; i < 6; i++) {
        if (await host.locator(r('screen-result')).isVisible()) break;

        for (const page of [host, player]) {
          const choice = page.locator(`${r('choices')} .choice`).first();
          if (await choice.isVisible()) await choice.click().catch(() => {});
        }

        await host.waitForTimeout(4500);
      }

      await expect(host.locator(r('screen-result')), '這一場沒有走到結算').toBeVisible({ timeout: 60_000 });

      // **剛打完的人要留在結算頁。**
      //
      // 這條是照著一個真實的 bug 加的：finishRound 送出 over 之後緊接著廣播名冊，
      // 而客人在 over 裡已經把 state.game 設成 null——當時的 case roster 用
      // 「state.game 是不是 null」推斷畫面，於是名冊把剛打完的人從結算頁拉回等待室，
      // 房主自己卻留在結算頁。只有「真的有人排隊」時才會發作
      //（admitQueued 空的就 return），也就是這一條測試的情境。
      await player.waitForTimeout(3000);
      await expect(player.locator(r('screen-result')), '剛打完的人被名冊拉離結算頁')
        .toBeVisible();

      // 晚到的人自己從「排隊中」變回等待室，名冊裡有三個人。
      await expect(later.locator(r('waiting-hint')), '打完了還在排隊')
        .not.toHaveText(/排在第/, { timeout: 30_000 });
      await expect(later.locator(r('screen-waiting'))).toBeVisible();
      await expect(later.locator(r('player-count'))).toHaveText(/3 人/);
    } finally {
      await hostContext.close();
      await playerContext.close();
      await laterContext.close();
    }
  });
});
