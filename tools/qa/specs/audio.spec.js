// 音訊：真的發得出聲音嗎、預載有沒有真的變快。
//
// 這是 web/*.html 那三套完全驗不到的一塊——無頭 Edge 沒有音效裝置，
// 而且連不到 Apple，所以那邊的音訊一律走「放不出來」那條路。

const { test, expect } = require('@playwright/test');
const {
  start, waitForQuestionStart, answerAndAdvance, watchAudio, watchPlayer, playThrough,
} = require('./game');
const { throttle } = require('./net');

/**
 * 超過這個就算「卡了」。
 *
 * 三秒是 app.js 那個守門計時器的期限：屆時畫面會顯示「還在載入…先開始計時了」，
 * 那正是使用者抱怨的那個空白。留一點餘裕抓在 1.5 秒。
 * 要防的是回到改動前——那時候第一題等 1827ms、後面三題全部撞上守門線
 * （3364, 3378, 3359）。
 */
const STALL_MS = 1500;

/**
 * **headless WebKit 沒有音效裝置。**
 *
 * 它從頭到尾不發 canplay／canplaythrough／playing（實測只有 loadstart），
 * 所以「音樂什麼時候響」在那上面根本不存在，每一題都得等三秒守門計時器。
 * 量時間的測試在那上面驗不到東西——而**假通過比跳過更糟**。
 *
 * 剩下能在 WebKit 上驗、而且真的驗到過 bug 的是「從 blob 播還是從遠端播」：
 * 那個看 player.src，和有沒有聲音無關。
 */
const NO_CLOCK = 'headless WebKit 沒有音效裝置，量不到「音樂什麼時候響」';

/** 限速走 CDP，WebKit 沒有。 */
const NO_CDP = 'CDP 限速只有 Chromium 支援';

test.describe('音訊', () => {
  // WebKit 起不來的機器上，整組明確地跳過並說出原因——
  // 不然每一條都會回一樣的 launch 失敗，把真正的失敗埋掉（見 webkit-check.js）。
  test.skip(
    ({ browserName }) => browserName === 'webkit' && process.env.QA_WEBKIT_OK !== '1',
    'WebKit 在這台機器上起不來（Smart App Control 擋掉未簽章的 jxl.dll）',
  );

  /** 連答四題，回傳每一題「畫面出現」到「音樂響起」之間的等待。 */
  async function measure(page, options) {
    return (await playThrough(page, 4, options)).waits;
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

  test('十二秒是從音樂響起才算的', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', NO_CLOCK);

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

  test('預載有效：正常速度作答時，整場都不用等', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', NO_CLOCK);

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
    ).toBeLessThan(STALL_MS);
  });

  test('預載有效：秒答時，開場囤的那幾題一定不用等', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', NO_CLOCK);

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
    ).toBeLessThan(STALL_MS);
  });

  test('整場每一題都從本機播，而且 blob 都有被放掉', async ({ page }) => {
    // **這一條是補漏的，而且是照著一個真實的 bug 寫的。**
    //
    // 原本所有預載測試都只打四題就結束，那個 bug 從第六題左右才發作：
    // 推進預載的迴圈每題固定 prepare() 兩次、卻只消耗一題，隊伍每題淨增一格，
    // 下載一路跑到播放前面去，而 forget() 是按「最舊的一筆」淘汰的——
    // 最舊的不保證播過，還沒播到的 blob 就被 revoke 掉了。
    // 二十題一場實測（正常作答速度）**七題**抓好了又回去連遠端，
    // 慢網路上那七題就是三秒空白。
    //
    // 量的是 player.src：吃到預載就是 blob:，沒吃到就是 https:。這比看網路請求
    // 可靠——被 AbortController 中止的下載，位元組已經到了，Playwright 照樣報
    // requestfinished，從外面看會誤判成「我們有了」。
    //
    // 給一點作答時間（1.5 秒，比人還快）：秒答的話頻寬本來就追不上，
    // 會有幾題還沒抓完就輪到了，那是物理不是 bug（另外兩條測試管那件事）。
    // 這一條要釘的是「該吃到的都吃到了」。
    const played = await watchPlayer(page);

    await start(page, { mode: 'speed', questionCount: 15 });

    const { numbers } = await playThrough(page, 15, { think: 1500 });
    const { blobs, remote, revoked } = await played.read();

    test.info().annotations.push({
      type: '十五題一場',
      description: `從 blob 播 ${blobs} 次、從遠端播 ${remote} 次、放掉 ${revoked} 個 blob`,
    });

    // 題號不能跳。跳號表示有一題被消耗掉卻沒播——那會連著把它的 blob 也放掉。
    expect(numbers, '題號跳掉了，有一題被吃掉').toEqual([...Array(numbers.length).keys()].map((n) => n + 1));

    expect(remote, `有 ${remote} 題是直接連遠端播的——那幾題沒吃到預載`).toBe(0);
    expect(blobs, '從 blob 播的次數和題數不合').toBe(numbers.length);

    // 記憶體要放得掉。一場八十題的連段模式如果都不放，會囤到八十 MB。
    expect(revoked, 'blob 沒有被放掉').toBeGreaterThanOrEqual(numbers.length);
  });

  test('「再來一場」也整場都從本機播', async ({ page }) => {
    // 測的是「第二場的預載還會不會動」。第一場結束會 dropPrefetched() 把整個
    // 預載狀態清掉，而開場預備、預生、blob 都是那之後重新長出來的——
    // 這條路以前沒有任何測試走過。
    //
    // **它抓不到 state.nowPlaying 跨場沒清那個漏洞**（那個是看程式看出來、
    // 直接修掉的）。要觸發它得同時湊到兩件事：同一首歌在下一場重現
    // （Game 的 used 是每場重置的，所以有可能，但兩千首裡抽二十首，機率很低），
    // 而且那一場完成的下載數要超過 KEEP 才會叫到 forget()。
    // 五題的場兩個條件都不成立，寫成二十題也只是把機率從很低變成低。
    // 拿修正前的程式跑過這一條，它是通過的——所以不要以為它在守那件事。
    const played = await watchPlayer(page);

    await start(page, { mode: 'speed', questionCount: 5 });
    await playThrough(page, 5, { think: 1200 });
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 30_000 });

    // 第一場的計數歸零，只看第二場。
    await played.reset();

    await page.locator('#btn-again').click();
    await expect(page.locator('#warmup')).toBeHidden({ timeout: 75_000 });

    await playThrough(page, 5, { think: 1200 });

    const { blobs, remote } = await played.read();

    test.info().annotations.push({
      type: '第二場',
      description: `從 blob 播 ${blobs} 次、從遠端播 ${remote} 次`,
    });

    expect(remote, `第二場有 ${remote} 題是直接連遠端播的`).toBe(0);
  });

  test('闖關模式也有開場預備', async ({ page }) => {
    // 闖關是**預設模式**，但整組 Playwright 測試到現在都在跑 speed／combo。
    //
    // 這一條只驗第一關的開頭。**第二關的開頭驗不到**：要走到那裡得先過關，
    // 而過關要答對，題目的正解在作答前不會出現在 DOM 上，從外面猜不到。
    // 那一格列在 QA清單.md 的實機項目裡。
    const played = await watchPlayer(page);

    // waitForWarmup: false ＝ 不要幫我等預備消失，預備本身就是要看的東西。
    await start(page, { mode: 'stage', waitForWarmup: false });

    await expect(page.locator('#warmup')).toBeVisible();
    await expect(page.locator('#warmup')).toBeHidden({ timeout: 75_000 });

    await waitForQuestionStart(page);
    await expect(page.locator('#choices .choice')).toHaveCount(9);

    const { blobs, remote } = await played.read();
    test.info().annotations.push({
      type: '闖關第一題',
      description: `從 blob 播 ${blobs} 次、從遠端播 ${remote} 次`,
    });

    expect(remote, '闖關第一題沒吃到開場預備').toBe(0);
  });

  test('換下一題的時候不會出現「還在載入」', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', NO_CLOCK);

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

  test('慢網路下，正常速度作答時完全不會卡', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', NO_CDP);
    await throttle(page);

    await start(page, { mode: 'speed', questionCount: 10 });

    // 聽五秒才按——十二秒的題目，這是玩家的常態。
    const waits = await measure(page, { think: 5000 });
    test.info().annotations.push({ type: '限速＋正常作答(ms)', description: waits.join(', ') });

    // 三秒是 app.js 那個守門計時器的期限：超過它，畫面會顯示
    // 「還在載入…先開始計時了」——那正是使用者抱怨的那個空白。
    expect(
      Math.max(...waits),
      `限速下正常作答仍然會卡：${waits.join(', ')}`,
    ).toBeLessThan(STALL_MS);
  });

  test('慢網路下，連續秒答時前幾題有被開場預備接住', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', NO_CDP);
    await throttle(page);

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
    ).toBeLessThan(STALL_MS);
  });

  test('最極端的情況：慢網路下囤五首，不會卡超過一分鐘', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', NO_CDP);
    await throttle(page);

    // 連段模式的四十題會囤滿五首（WARM_MAX）。一般的十題只囤兩首。
    //
    // 要從**預備畫面出現**開始量，不是從按下開始。限速之下光是載入頁面就
    // 好幾秒，算進去的話量到的是「頁面載入 ＋ 預備」，而被測的上限只管預備。
    await page.goto('./');
    await expect(page.locator('#lang-chips .chip').first()).toBeVisible();
    await page.locator('#screen-home .mode[data-mode="combo"]').click();
    await page.locator('#count-chips .chip', { hasText: '40 題' }).first().click();
    await page.locator('#btn-start').click();

    await expect(page.locator('#warmup')).toBeVisible();
    const clicked = Date.now();
    await expect(page.locator('#warmup')).toBeHidden({ timeout: 75_000 });
    const waited = Date.now() - clicked;

    test.info().annotations.push({ type: '囤五首卡了(ms)', description: String(waited) });

    // 一分鐘是使用者訂的線：超過那個就寧可不要預載。
    // 實測 2 Mbps 抓五首（合計 4.94 MB）是 21 秒；真的爆掉的只有慢速 3G（103 秒），
    // 而那一格會被 WARM_LIMIT_MS 切掉——所以**不管網速多爛，這條都該過**。
    expect(waited, `開場卡了 ${(waited / 1000).toFixed(1)} 秒`).toBeLessThan(62_000);

    // 卡完之後第一題還是要馬上有聲音，不然剛剛那一分鐘白等了。
    const shown = Date.now();
    await waitForQuestionStart(page);
    expect(Date.now() - shown, '等了那麼久，第一題居然還要載').toBeLessThan(STALL_MS);
  });

  test('囤夠兩首之後就可以「不等了」', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', NO_CDP);
    await throttle(page);

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
    expect(Date.now() - shown, '按了「不等了」之後第一題還要載').toBeLessThan(STALL_MS);
  });
});
