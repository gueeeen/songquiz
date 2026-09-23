/**
 * 音檔預載：把下面幾題的試聽先抓進來，換題的時候就不會有空白。
 *
 * 這一份原本在 app.js 和 room.js 各有一份逐行相同的抄本。那個抄本已經咬過三次：
 * room.js 漏了 iOS 的手勢解鎖（房主整場沒聲音）、漏了每局重置、漏了結算頁收工。
 * 所以改成一份，用 factory 生實例——單人和多人是兩顆不同的 <audio>，
 * 各自要有自己的一組狀態。形狀照 boardui.js 的 window.BoardUI = { create }。
 *
 * **為什麼用 fetch 抓整個檔案，而不是 <audio> 的 preload：**
 * canplaythrough 是瀏覽器拿當下的下載速率去「估」的，不是真的抓完。限速到
 * 2 Mbps 實測它在 585 毫秒就發了，那時候 buffered 只有 1.1 秒（整首 30 秒）。
 * 預載看起來成功，實際只囤了一秒鐘的歌。fetch 的「抓完」就是真的抓完。
 *
 * 而且拿到整份資料可以做成 blob 直接餵播放器，順便解掉第二個問題：題目是從歌曲
 * 中段開始播的，播放器會發 `Range: bytes=458752-` 去要中間那一段，靠 HTTP 快取
 * 賭不到那個位元組範圍。Apple 的 CDN 給 `Access-Control-Allow-Origin: *`，
 * 所以 fetch 讀得到內容；哪天他們改了也不會壞，抓失敗就照原網址播。
 *
 * **為什麼不乾脆拿預載的那顆 Audio 直接當播放器：**
 * iOS 的音訊要先被使用者手勢解鎖才播得出來。頁面上那一顆 <audio> 是被那一下
 * 手勢解鎖的；用 new Audio() 生出來的沒有，之後 play() 會被拒絕。
 * 也就是說「直接用預載的那顆」在桌機更穩，在 iOS 反而會讓整個遊戲沒有聲音——
 * 而 iOS 是這個站的主要場景。所以維持「一顆播放器 ＋ 餵它 blob」。
 */
(function () {
  'use strict';

  /** 當題在播的時候，前面要備著幾題。 */
  var PREFETCH_AHEAD = 2;

  /** 當題要走網路時，最多等這麼久就開始抓後面的。 */
  var PREFETCH_START_MS = 4000;

  /**
   * 開場先囤幾首再開始。
   *
   * 光靠「邊播邊抓下一首」在慢網路下救不了秒答的人：翻牌只有一秒，
   * 而一首 1 MB 的試聽在 2 Mbps 上要四秒，差額只能事先補起來。
   *
   * 取這一場題數的兩成（十題囤兩首、二十題囤四首），夾在 2～5 之間：
   * 少於兩首等於沒囤；多於五首會讓開場等太久，而且囤再多也擋不住
   * 「抓的速度跟不上玩的速度」——那是網速的問題，不是囤貨量的問題。
   */
  var WARM_SHARE = 0.2;
  var WARM_MIN = 2;
  var WARM_MAX = 5;

  /**
   * 預備的上限是**時間，不是首數**。
   *
   * 實測五首歌（合計 4.94 MB）在各種網速下要等多久：
   *
   *     好的 Wi-Fi 10 Mbps    4.3 秒
   *     普通 4G     4 Mbps   10.5 秒
   *     攤位 Wi-Fi  2 Mbps   21.4 秒
   *     很慢        1 Mbps   41.3 秒
   *     慢速 3G   400 Kbps  103.4 秒   ← 只有這一格爆掉
   *
   * 用「幾首」當上限的話，同一個數字在快網路上是四秒、在慢速 3G 上是一分四十秒。
   * 所以看時間：抓到六十秒為止，抓得到幾首算幾首，剩下的在遊戲中繼續抓。
   */
  var WARM_LIMIT_MS = 60000;

  /**
   * 囤到這個數就讓人選擇不等了。
   *
   * 兩首是「開始之後不會馬上卡住」的最低限度。再往上是錦上添花，
   * 而錦上添花不該用一分鐘的等待去換——所以給一顆鈕，要不要繼續等由玩家決定。
   */
  var WARM_ENOUGH = 2;

  /** 就算一首都還沒抓完，等這麼久也要讓人看得到出口。 */
  var WARM_SKIP_AFTER_MS = 15000;

  /**
   * 一段真的沒有聲音的 WAV（標頭 44 bytes，零個取樣）。
   *
   * iOS 的 <audio> 要在使用者手勢裡成功播過一次才會被「解鎖」，之後才准程式自己
   * 呼叫 play()。開場預備插在「按下開始」和「第一次 play()」之間，手勢鏈就斷了。
   * 房間更早就沒有手勢：客人的第一次 play() 是收到房主的 ask 訊息才發的。
   *
   * 所以不綁在某一顆鈕上，改成「頁面上第一次碰到就解鎖」——
   * 房主按開始、客人按加入、單人按試聽，都算。
   */
  var SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

  /**
   * @param {object} options
   * @param {HTMLAudioElement} options.player 這個實例負責的播放器。
   * @param {function(string): HTMLElement} options.el 呼叫端自己的 id 查詢
   *        （room.js 的會自動加 `r-` 前綴），預備畫面的四個元素靠它拿。
   * @param {function(): object} options.game 回傳現在的 Game，沒有就回 null。
   */
  function create(options) {
    var player = options.player;
    var el = options.el;
    var gameOf = options.game;

    /** 手上真的有的：原始網址 → blob 網址。 */
    var prefetched = {};

    /** 排隊等著抓的網址。 */
    var pending = [];

    /** 正在抓的那一個。一次只抓一首——並行會互相搶頻寬。 */
    var loading = null;

    /**
     * 已經為了讓出頻寬而中止過一次的網址。
     *
     * 中止掉的下載是從第零個位元組重來的（fetch 沒有續傳）。網路很慢的時候，
     * 一題的時間抓不完一首，於是每換一題就中止一次、重抓一次，同一首永遠抓不完。
     * 所以同一個網址只讓一次，第二次就讓它抓完——那一題可能慢一點，
     * 但總比永遠都慢好。
     */
    var yielded = {};

    /** 正在播的那一首的**原始**網址（不是 blob 網址）。 */
    var nowPlaying = null;

    var startTimer = null;
    var warmTimer = null;
    var skipTimer = null;

    /** 預備期間用來數進度；平常是 null。 */
    var onSettled = null;

    /**
     * 停掉正在跑的開場預備。
     *
     * drop() 和 hideWarm() 都必須經過這裡。只清計時器不夠：預備的 onSettled 還掛著
     * 的話，之後每抓好一首都會去寫預備畫面的進度條（那時候畫面已經收起來了），
     * 最後一首抓完還會叫 finish() → then()，在房間裡就是為一局早就開始的遊戲
     * 送出一個過期的 ready。
     *
     * 兩段預備重疊也靠這個：warmUp 開頭先取消上一段，不然上一段的計時器會在
     * 這一段跑到一半的時候把它的狀態清掉。
     */
    var cancelWarm = function () {};

    var unlocked = false;

    /** 這首歌要從哪裡播：抓好了就用本機的，沒抓好就照原網址。 */
    function sourceFor(url) {
      return prefetched[url] || url;
    }

    function release(url) {
      if (!url || !prefetched[url]) return;
      URL.revokeObjectURL(prefetched[url]);
      delete prefetched[url];
    }

    function queue(url) {
      if (!url || prefetched[url] || pending.indexOf(url) !== -1) return;
      if (loading && loading.url === url) return;
      pending.push(url);
    }

    function pump() {
      if (loading || pending.length === 0) return;

      var url = pending.shift();
      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      var mine = { url: url, controller: controller };

      loading = mine;

      // blob 網址要在守門**之後**才生。先生的話，被 yieldTo 讓出去的那一份
      // 會生出一個一 MB 的 blob 然後沒人 revoke——洩漏得無聲無息。
      function settle(blob) {
        if (loading !== mine) return;
        loading = null;

        if (blob) prefetched[url] = URL.createObjectURL(blob);
        if (onSettled) onSettled(url, !!blob);

        pump();
      }

      fetch(url, controller ? { signal: controller.signal } : undefined)
        .then(function (response) { return response.ok ? response.blob() : null; })
        .then(settle)
        .catch(function () {
          // 被 yieldTo 中止的不算數：要不要重抓由它決定，這裡不要往下走。
          if (controller && controller.signal.aborted) return;
          settle(null);
        });
    }

    /**
     * 把頻寬讓給正在播的那一首。
     *
     * 換題的時候，正在抓的下一首和現在要播的這一首搶同一條線。使用者等的是現在
     * 這一首，所以中止預載、抓到一半的丟掉重來。三種情況不讓：
     *
     *   * 當題已經抓好了 → 它從本機 blob 播，一個位元組都不用下載，沒人跟誰搶。
     *   * 這個網址已經讓過一次 → 見 `yielded`。
     *
     * **正在抓的就是當題的時候，照樣中止，但不要排回隊伍。** 播放器已經去連遠端了
     * （sourceFor 找不到 blob），排回去等於同一個檔被抓第二次，兩份一起跟播放器搶
     * 同一條線。試過「這種情況就不中止」，那更糟：預載和播放器同時抓同一個檔，
     * 限速實測那一題從 1331ms 變成 3377ms（撞上三秒守門線）。
     * 中止 ＋ 不重排，播放器就拿到全部頻寬，而那一份會進瀏覽器的 HTTP 快取。
     */
    function yieldTo(current) {
      clearTimeout(startTimer);
      startTimer = null;

      if (!loading) return;
      if (current && prefetched[current]) return;
      if (yielded[loading.url]) return;

      var url = loading.url;
      var isCurrent = url === current;

      yielded[url] = true;
      if (loading.controller) loading.controller.abort();
      loading = null;

      // 退回隊伍最前面，等一下再抓——當題除外，播放器自己在抓了。
      if (!isCurrent && url && !prefetched[url] && pending.indexOf(url) === -1) {
        pending.unshift(url);
      }
    }

    /**
     * 這一題開始播了：放掉上一首、補滿前面備著的題數、開始抓。
     *
     * 呼叫端必須**先**把 player.src 換到這一題，再叫這個函式——上一首的 blob 是在
     * 這裡 revoke 的，播放器還指著它的時候放掉會讓它失效。
     */
    function questionStarted(url) {
      // 上一首放掉。**只放剛剛播完的那一首**，不要按「留幾首」的數量去淘汰：
      // 下載跑在播放前面，「最舊的一筆」不保證已經播過，那樣會把還沒播到的 blob
      // 收掉，那一題就回退去連遠端。二十題一場實測，正常作答速度下有七題中獎。
      if (nowPlaying && nowPlaying !== url) release(nowPlaying);
      nowPlaying = url;

      // 先把頻寬讓給這一題。
      yieldTo(url);

      // 補到「前面有 PREFETCH_AHEAD 題備著」為止——不是每題固定生兩題。
      // 固定兩題的話一題只消耗一題，隊伍每題淨增一格，預載視窗會一路漂到整場的
      // 最後一題，下載跑到播放前面去（同一個 bug 的另一半）。
      var game = gameOf();
      if (game) {
        while (game.pendingCount() < PREFETCH_AHEAD) {
          var coming = game.prepare();
          if (!coming) break;
          queue(coming.answer.previewUrl);
        }
      }

      // 當題從本機 blob 播的話，直接開始抓，不用等。
      //
      // 這裡原本無條件掛在 canplaythrough 上，那是個會靜靜失效的依賴：
      // WebKit（至少 Playwright 的無頭版）從頭到尾只發 loadstart，不發
      // canplay／canplaythrough／playing。於是預載的鏈條被讓出去一次之後就再也
      // 沒有恢復，十五題一場實測有四題回退去連遠端——而 iOS 正是主場景。
      if (prefetched[url]) {
        pump();
        return;
      }

      // 當題要走網路：等它載得夠順再抓後面的。頻寬是共用的，一起抓的話正在播的
      // 這一首會被拖慢（限速實測過，每題都卡滿三秒）。
      player.addEventListener('canplaythrough', pump, { once: true });

      clearTimeout(startTimer);
      startTimer = setTimeout(pump, PREFETCH_START_MS);
    }

    /** 一場結束就全部放掉。留著只是佔記憶體，而且下一場的題目不一樣。 */
    function drop() {
      if (loading && loading.controller) loading.controller.abort();

      Object.keys(prefetched).forEach(function (url) {
        URL.revokeObjectURL(prefetched[url]);
      });

      prefetched = {};
      pending = [];
      loading = null;
      yielded = {};
      nowPlaying = null;

      cancelWarm();

      clearTimeout(startTimer);
      startTimer = null;
    }

    function unlock() {
      if (unlocked) return;
      unlocked = true;

      // 已經在播真的歌就別碰——那會把聲音切斷。
      if (player.src && !player.paused) return;

      player.muted = true;
      player.src = SILENCE;

      var started = player.play();
      if (started && started.catch) started.catch(function () {
        // 被擋掉也沒關係：那表示這個瀏覽器本來就不用解鎖，或這一下不算手勢。
        // 兩種情況下面照常走，最壞就是回到改動前的行為。
      });

      player.muted = false;
    }

    /**
     * 開場預備：先把前幾題的音檔抓進來，再開始計時。
     *
     * 慢網路下的等待本來就消不掉，能做的是把它搬到玩家願意等的位置。題與題之間的
     * 三秒空白最難忍受（剛按完答案，期待馬上聽到下一首）；開場的進度條則是大家都
     * 習慣的等待。網路快的時候整段只花零點幾秒，沒人會注意到。
     *
     * @param {function} then 好了之後要做什麼。單人是收起預備畫面直接開場，
     *        房間是回報自己準備好了、然後等房主發題。
     * @param {number} [cap] 最多囤幾首。人多的房間要壓低：**開場的突發流量是
     *        「人數 × 囤的首數」**，二十個人各囤五首就是一百 MB 同時湧進同一台
     *        無線基地台。房間那邊會依人數傳這個值進來。
     */
    function warmUp(then, cap) {
      // 上一段預備如果還在跑，先停掉——它的計時器會誤傷這一段。
      cancelWarm();

      var game = gameOf();
      if (!game) return then();

      var ceiling = Math.min(WARM_MAX, cap || WARM_MAX);
      var want = Math.min(ceiling, Math.max(WARM_MIN,
        Math.ceil(game.questionCount * WARM_SHARE)));

      // 第一題也要囤。它原本是「邊播邊等」的，那一下等待同樣算在玩家頭上。
      // 已經抓好的不用再等（同一首歌在上一場出現過）。
      var urls = game.peek(want).map(function (question) {
        return question.answer.previewUrl;
      }).filter(function (url) {
        return url && !prefetched[url];
      });

      if (urls.length === 0) return then();

      el('warmup').hidden = false;
      el('choices').hidden = true;
      el('play-hint').hidden = true;

      var startedAt = Date.now();
      var done = 0;
      var failed = 0;
      var finished = false;

      showProgress(done, urls.length, startedAt);

      /** 收乾淨，但不呼叫 then()——從外面取消的時候不該當成「好了」。 */
      cancelWarm = function () {
        finished = true;

        clearTimeout(warmTimer);
        warmTimer = null;
        clearTimeout(skipTimer);
        skipTimer = null;
        onSettled = null;
        el('btn-warmup-skip').hidden = true;
      };

      function finish() {
        if (finished) return;
        cancelWarm();
        then();
      }

      onSettled = function (url, ok) {
        // **抓失敗的不算進度。** 算進去的話，音檔全部 404（或 Apple 哪天收掉
        // Access-Control-Allow-Origin）的時候，進度條會在幾百毫秒內衝到 100%、
        // 「不等了」馬上冒出來說兩首備好了，而手上其實一首都沒有。
        // 房間裡更糟：會回報 ready，房主就開一場每題都卡的局。
        if (ok) done += 1;
        else failed += 1;

        showProgress(done, urls.length, startedAt);
        if (done >= WARM_ENOUGH) el('btn-warmup-skip').hidden = false;

        // 全部有結果了就走——都失敗也要走，不然會卡到逾時。
        if (done + failed >= urls.length) finish();
      };

      el('btn-warmup-skip').onclick = finish;

      // 抓得特別慢的時候，不要讓人乾等到第二首才看得到出口。
      // 400 Kbps 下第一首要二十秒、第二首四十秒——那一分鐘裡他沒有任何選擇。
      skipTimer = setTimeout(function () {
        if (!finished) el('btn-warmup-skip').hidden = false;
      }, WARM_SKIP_AFTER_MS);

      urls.forEach(queue);
      pump();

      // 逾時就開始。囤到幾首算幾首，剩下的在遊戲中繼續抓。
      warmTimer = setTimeout(finish, WARM_LIMIT_MS);
    }

    /**
     * 進度條、還剩幾首、大概還要多久。
     *
     * 預估是拿「已經抓好的平均速度」去推剩下的，抓完第一首才有得推——在那之前
     * 只說進度，不說時間。**寧可不說，也不要說一個錯的數字**：講了「還要 5 秒」
     * 結果等了三十秒，比什麼都不講更讓人火大。
     */
    function showProgress(done, total, startedAt) {
      el('warmup-fill').style.width = Math.round((done / total) * 100) + '%';

      var line = '先下載 ' + total + ' 首，開始之後就不會中斷（' + done + ' / ' + total + '）';

      if (done > 0 && done < total) {
        var each = (Date.now() - startedAt) / done;
        var left = Math.round((each * (total - done)) / 1000);
        if (left > 0) line += '・大約還要 ' + left + ' 秒';
      }

      el('warmup-text').textContent = line;
    }

    /** 這一邊準備好了，但還要等別人（房間用）。 */
    function showWaiting(text) {
      el('warmup-fill').style.width = '100%';
      el('warmup-text').textContent = text;
    }

    /**
     * 收起預備畫面。
     *
     * `hint` 一定要在收起畫面**之前**設好：不然中間有一格「預備畫面沒了、提示還是
     * HTML 裡的預設值」的空窗，那一格會讓人（和測試）以為這一題已經開始了。
     */
    function hideWarm(hint) {
      // 從外面收起畫面就等於這一段預備結束了（房間：房主發題了）。
      // 不停掉的話它會繼續在收起來的畫面上寫進度，最後還送出過期的 ready。
      cancelWarm();

      if (hint) el('play-hint').textContent = hint;

      el('warmup').hidden = true;
      el('btn-warmup-skip').hidden = true;
      el('choices').hidden = false;
      el('play-hint').hidden = false;
    }

    // 頁面上第一次互動就解鎖，當作保險。
    //
    // **pointerdown 一個不夠**：鍵盤按 Enter 啟動按鈕不會發 pointerdown，
    // 而 iOS 12 以前沒有 Pointer Events。click 補上這兩種。
    // capture 讓它跑在按鈕自己的處理器之前，所以那一下手勢還沒結束，iOS 會認。
    //
    // 但**不要只靠這個**：真正該解鎖的時機是「接下來就要 play() 了」，
    // 所以 app.js／room.js 在開始的那一下也直接叫 unlock()。
    // 只留監聽的版本一度讓 app.js 失去了「在手勢裡同步解鎖」這件事。
    ['pointerdown', 'click'].forEach(function (event) {
      document.addEventListener(event, unlock, { capture: true, once: true });
    });

    return {
      sourceFor: sourceFor,
      questionStarted: questionStarted,
      warmUp: warmUp,
      showWaiting: showWaiting,
      hideWarm: hideWarm,
      unlock: unlock,
      drop: drop,
    };
  }

  window.AudioPrefetch = { create: create };
})();
