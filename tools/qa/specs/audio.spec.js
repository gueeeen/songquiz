// 音訊：真的發得出聲音嗎、預載有沒有真的變快。
//
// 這是 web/*.html 那三套完全驗不到的一塊——無頭 Edge 沒有音效裝置，
// 而且連不到 Apple，所以那邊的音訊一律走「放不出來」那條路。

const { test, expect } = require('@playwright/test');
const { start, waitForQuestionStart, answerAndAdvance, watchAudio } = require('./game');

test.describe('音訊', () => {
  /**
   * 把頻寬壓到攤位 Wi-Fi 的等級。
   *
   * 這台機器連 Apple 太快（冷啟動只要一兩百毫秒），量不到使用者遇到的狀況。
   * 2 Mbps 下一首 1 MB 的試聽要抓四秒多，超過 app.js 那個三秒守門計時器——
   * 沒有預載的話每一題都會卡。限速用 Chrome DevTools Protocol，WebKit 沒有。
   */
  async function throttle(context, page) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 300,
      downloadThroughput: (2 * 1024 * 1024) / 8,   // 2 Mbps
      uploadThroughput: (1 * 1024 * 1024) / 8,
    });
  }

  /** 連答四題，回傳每一題「畫面出現」到「音樂響起」之間的等待。 */
  async function measure(page, { think = 0 } = {}) {
    const waits = [];

    for (let i = 0; i < 4; i++) {
      const shown = Date.now();
      await waitForQuestionStart(page);
      waits.push(Date.now() - shown);
      await answerAndAdvance(page, { think });
    }

    return waits;
  }

  test('第一題真的播得出聲音', async ({ page }) => {
    // 「播得出來」不能只看 play() 有沒有被拒絕：那個 promise 解析了也可能
    // 一秒都沒前進（網路斷、檔案壞）。要看 currentTime 真的在走。
    //
    // 要**輪詢 currentTime 本身**，不能先輪詢 paused 再讀一次 currentTime：
    // 開場預備做好之後歌是從本機的 blob 播的，paused 變 false 和「跑了第一毫秒」
    // 幾乎同時發生，讀到的還是 0——那是量測的問題，不是播不出來。
    // （這條在線上的舊版會過、在新版失敗，差別只在舊版要等一秒載入。）
    await start(page, { mode: 'speed', questionCount: 5 });
    await waitForQuestionStart(page);

    await expect.poll(
      async () => page.evaluate(() => {
        const player = document.getElementById('player');
        return { paused: player.paused, at: player.currentTime };
      }),
      { message: '音檔沒有真的在播', timeout: 20_000 },
    ).toMatchObject({ paused: false });

    await expect.poll(
      () => page.evaluate(() => document.getElementById('player').currentTime),
      { message: '播放位置沒有前進', timeout: 10_000 },
    ).toBeGreaterThan(0);
  });

  test('十二秒是從音樂響起才算的', async ({ page }) => {
    // 從出題就起算的話，音檔載入的時間會被算進玩家的作答時間——
    // 排行榜是跨裝置比的，那就變成拿網速當實力。
    await start(page, { mode: 'speed', questionCount: 5 });
    await waitForQuestionStart(page);

    const left = Number(await page.locator('#timer-text').textContent());
    expect(left, `計時開始時只剩 ${left} 秒，代表倒數比音樂早開始`).toBeGreaterThan(11);
  });

  test('預載：當題在播的時候就已經去抓後面兩題了', async ({ page }) => {
    const audio = watchAudio(page);

    await start(page, { mode: 'speed', questionCount: 10 });
    await waitForQuestionStart(page);

    // 抓後面的那兩個請求是在開始播之後才發的，給它一點時間。
    await expect.poll(() => audio.length, {
      message: '沒有看到預載的請求',
      timeout: 20_000,
    }).toBeGreaterThanOrEqual(3);

    const distinct = new Set(audio.map((r) => r.url));
    expect(distinct.size, '三個請求指向同一個檔，那不是預載').toBeGreaterThanOrEqual(3);
  });

  test('預載有效：正常速度作答時，整場都不用等', async ({ page }) => {
    // 「正常速度」＝聽個三秒才按。十二秒的題目，這是玩家的常態。
    //
    // 這一條是整份 QA 最重要的：它說的是絕大多數人實際會遇到的體驗。
    // 第二題開始音檔應該已經在手上了——還要等兩三秒就表示預載沒生效
    //（最可能的原因：試聽檔的 Cache-Control 變了，或 fetch 被擋掉了）。
    await start(page, { mode: 'speed', questionCount: 10 });
    const waits = await measure(page, { think: 3000 });

    test.info().annotations.push({ type: '正常作答每題等待(ms)', description: waits.join(', ') });

    // 三秒是 app.js 那個守門計時器的期限：超過它，畫面會顯示
    // 「還在載入…先開始計時了」——那正是使用者抱怨的那個空白。
    expect(
      Math.max(...waits),
      `正常速度作答還是會卡：${waits.join(', ')}`,
    ).toBeLessThan(1500);
  });

  test('預載有效：秒答時，開場囤的那幾題一定不用等', async ({ page }) => {
    // 秒答正是使用者抱怨的那個操作（「猜完第一首後直接按下一首」）。
    //
    // **這裡只保證開場囤的那幾題，而且那是物理上限，不是妥協。**
    // 秒答的人每一題只花一秒多就換下一首，而抓一首歌沒那麼快
    //（這台機器連 Apple 大約 0.3～1 秒，攤位 Wi-Fi 上是四秒多）。
    // 抓的速度追不上玩的速度，囤的貨遲早會見底——見底之後由守門計時器
    // 誠實地說「還在載入」。這條測試一度寫成「四題全部都要快」，
    // 結果在非限速環境下隨機失敗（4, 26, 28, 1838），那是在賭網路不是在測程式。
    //
    // 真正要防的是回到改動前：那時候**第一題就等 1827ms、後面三題全部撞上
    // 三秒的守門線**（3364, 3378, 3359）。
    await start(page, { mode: 'speed', questionCount: 10 });
    const waits = await measure(page);

    test.info().annotations.push({ type: '秒答每題等待(ms)', description: waits.join(', ') });

    const covered = waits.slice(0, 2);
    expect(
      Math.max(...covered),
      `開場預備囤的前兩題還是卡了：${waits.join(', ')}`,
    ).toBeLessThan(1500);
  });

  test('換下一題的時候不會出現「還在載入」', async ({ page }) => {
    // 上一條量的是時間，這一條量的是使用者真正看到的那句話。
    await start(page, { mode: 'speed', questionCount: 10 });
    await waitForQuestionStart(page);

    const seen = [];

    for (let i = 0; i < 3; i++) {
      await answerAndAdvance(page);
      await waitForQuestionStart(page);
      seen.push(await page.locator('#play-hint').textContent());
    }

    const stuck = seen.filter((text) => text.includes('還在載入'));
    expect(stuck.length, `第二題之後仍然出現「還在載入」：${seen.join(' / ')}`).toBe(0);
  });

  test('慢網路下，正常速度作答時完全不會卡', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP 限速只有 Chromium 支援');
    await throttle(context, page);

    await start(page, { mode: 'speed', questionCount: 10 });

    // 聽五秒才按——十二秒的題目，這是玩家的常態。
    const waits = await measure(page, { think: 5000 });
    test.info().annotations.push({ type: '限速＋正常作答(ms)', description: waits.join(', ') });

    // 三秒是 app.js 那個守門計時器的期限：超過它，畫面會顯示
    // 「還在載入…先開始計時了」——那正是使用者抱怨的那個空白。
    expect(
      Math.max(...waits),
      `限速下正常作答仍然會卡：${waits.join(', ')}`,
    ).toBeLessThan(1500);
  });

  test('慢網路下，連續秒答時前幾題有被開場預備接住', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP 限速只有 Chromium 支援');
    await throttle(context, page);

    await start(page, { mode: 'speed', questionCount: 10 });

    // 秒答：最惡劣的情況，也正是使用者抱怨的那個操作
    //（「猜完第一首後直接按下一首」）。
    const waits = await measure(page);
    test.info().annotations.push({ type: '限速＋秒答(ms)', description: waits.join(', ') });

    // **這裡只保證前兩題，而且那是物理上限，不是妥協。**
    // 2 Mbps 抓得動一首要四點四秒；秒答的人每一題只花一秒多就換下一首。
    // 抓的速度追不上玩的速度，囤的貨遲早會見底——十題全部囤完要等四十四秒，
    // 那個開場沒有人要等。開場預備買到的就是「這一場的兩成」，
    // 見底之後由守門計時器誠實地說「還在載入」。
    //
    // 真正要防的是回到改動前：那時候**第一題就等 1827ms、後面三題全部撞上
    // 三秒的守門線**（3364, 3378, 3359）。
    const covered = waits.slice(0, 2);
    expect(
      Math.max(...covered),
      `開場預備囤的前兩題還是卡了：${waits.join(', ')}`,
    ).toBeLessThan(1500);
  });

  test('最極端的情況：慢網路下囤五首，不會卡超過一分鐘', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP 限速只有 Chromium 支援');
    await throttle(context, page);

    // 連段模式的四十題會囤滿五首（WARM_MAX）。一般的十題只囤兩首。
    const clicked = Date.now();
    await start(page, { mode: 'combo', questionCount: 40 });
    const waited = Date.now() - clicked;

    test.info().annotations.push({ type: '囤五首卡了(ms)', description: String(waited) });

    // 一分鐘是使用者訂的線：超過那個就寧可不要預載。
    // 實測 2 Mbps 抓五首（合計 4.94 MB）是 21 秒；真的爆掉的只有慢速 3G（103 秒），
    // 而那一格會被 WARM_LIMIT_MS 切掉——所以**不管網速多爛，這條都該過**。
    expect(waited, `開場卡了 ${(waited / 1000).toFixed(1)} 秒`).toBeLessThan(62_000);

    // 卡完之後第一題還是要馬上有聲音，不然剛剛那一分鐘白等了。
    const shown = Date.now();
    await waitForQuestionStart(page);
    expect(Date.now() - shown, '等了那麼久，第一題居然還要載').toBeLessThan(1500);
  });

  test('囤夠兩首之後就可以「不等了」', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP 限速只有 Chromium 支援');
    await throttle(context, page);

    await page.goto('./');
    await expect(page.locator('#lang-chips .chip').first()).toBeVisible();
    await page.locator('#screen-home .mode[data-mode="combo"]').click();
    await page.locator('#count-chips .chip', { hasText: '40 題' }).first().click();
    await page.locator('#btn-start').click();

    // 沒囤夠之前不該出現——那時候按下去會馬上卡住，那不是選擇，是壞掉。
    await expect(page.locator('#warmup')).toBeVisible();
    await expect(page.locator('#btn-warmup-skip')).toBeHidden();

    // 抓好兩首才冒出來。
    await expect(page.locator('#btn-warmup-skip')).toBeVisible({ timeout: 40_000 });

    await page.locator('#btn-warmup-skip').click();
    await expect(page.locator('#warmup')).toBeHidden();

    // 按了就真的開場，而且開頭那兩首是囤好的，不用再等。
    const shown = Date.now();
    await waitForQuestionStart(page);
    expect(Date.now() - shown, '按了「不等了」之後第一題還要載').toBeLessThan(1500);
  });
});
