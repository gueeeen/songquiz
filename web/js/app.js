// 畫面層：放音樂、跑一條計時條、把 Game 的狀態畫出來。玩法本身都在 game.js。
//
// 這一版沒有伺服器（沒有 fetch、沒有 API），題庫是 data/bank.js 這個產生物，
// 它一載入就把自己掛成 window.SONG_BANK。所以這裡沒有非同步的載入流程：
// script 跑到這個檔的時候，題庫要嘛在、要嘛不在。

(function () {
  'use strict';

  var Rules = window.Rules;

  function el(id) {
    return document.getElementById(id);
  }

  /** 單人版的容器。class 選取一律限定在這裡面，不然會抓到多人房間的選項。 */
  var root = document.getElementById('solo-app');

  function q(selector) {
    return root.querySelector(selector);
  }

  function qa(selector) {
    return root.querySelectorAll(selector);
  }

  var screens = {
    home: el('screen-home'),
    play: el('screen-play'),
    result: el('screen-result'),
  };

  var player = el('player');

  var bank = window.SONG_BANK;
  var bankReady = !!(bank && bank.tracks && bank.tracks.length);

  var state = {
    game: null,
    /** 這一題的計時器 handle，離開畫面時要收乾淨。 */
    ticker: null,
    /** 這一題的截止時間（performance.now 座標）。 */
    deadline: 0,
    /** 防連點：一題只能送一次答案，也防「時間到」和最後一下點擊撞在一起。 */
    answering: false,
    /** 自動跳下一題的 handle。手動按「下一題」時要取消它，免得跳兩次。 */
    advanceTimer: null,
    /** 結算頁正在播放的那顆重聽鈕。 */
    playing: null,
    /** 這一局的排行榜狀態（本機名次、線上前幾名、有沒有上榜過）。 */
    board: null,
    /** 試聽的停止計時器。有值就代表正在試聽。 */
    testTimer: null,
    /** 「等音樂響」的上限計時器。載不動的時候靠它把這一題開下去。 */
    startGuard: null,
    warmTimer: null,
    /** 「當題載夠了沒」的上限計時器。等不到 canplaythrough 就靠它開始預載。 */
    prefetchTimer: null,
  };

  /** 開場挑的設定。開一場遊戲就是把這三個值交給 Game。 */
  var setup = {
    languages: [],
    questionCount: Rules.QUESTIONS_PER_ROUND,
    mode: 'stage',
  };

  function show(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].hidden = key !== name;
    });

    // 只有首頁有那條釘在底部的開始鈕。頁尾在兩半之外，要靠這個 class
    // 讓整頁留出位置，否則捲到底會被那條蓋住。
    document.body.classList.toggle('has-dock', name === 'home');
  }


  function num(value) {
    return value.toLocaleString('en-US');
  }

  // ---- 記住設定 ----
  // 從 file:// 開啟時，有些瀏覽器（隱私視窗、Safari）讀寫 localStorage 會直接丟例外。
  // 記不住音量和成績可以接受，整個畫面壞掉不行，所以統一走這兩個小包裝。
  function recall(key, fallback) {
    try {
      var value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function remember(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // 記不住就算了
    }
  }

  // ---- 音量 ----
  var volume = el('volume');

  function applyVolume() {
    player.volume = volume.value / 100;
    el('volume-out').textContent = volume.value + '%';
    remember('songquiz.volume', volume.value);
  }

  volume.value = recall('songquiz.volume', 80);
  volume.addEventListener('input', applyVolume);
  applyVolume();

  // ---- 播放 ----
  /**
   * 放一段試聽。
   *
   * @param {string} url Apple 的 30 秒試聽
   * @param {number} [offset] 從哪裡開始放（0～1 的比例）。不給就從頭。
   *
   * 為什麼要繞這麼一圈：
   *
   * 一、**seek 必須等 metadata。** 音檔還沒載到長度之前設 currentTime 會被忽略，
   *     所以要等 loadedmetadata；但那時已經離開使用者手勢了，直接在那裡呼叫 play()
   *     在 iOS 上可能被擋。所以 play() 仍然在手勢裡先發動，seek 稍後再補。
   * 二、**先靜音。** 承上，play() 先跑、seek 後到，中間那零點幾秒會漏出歌的開頭——
   *     而開頭正是最好認的地方。用 muted 而不是 volume：iOS 不讓程式改音量，
   *     但 muted 是可以的。
   */
  /** 目前掛在 <audio> 上的「開始播了」監聽。一次只能有一個。 */
  var playingHook = null;

  // ---- 預載 ----
  //
  // 問題：Apple 的試聽一首約 1 MB，抓下來要兩三秒。等按下「下一題」才開始抓，
  // 中間就是兩三秒沒有聲音的空白——那是整個遊戲體感最差的地方。
  //
  // 做法：當題**已經載得夠順**之後，才一首一首去抓後面的。
  //
  // **這裡有兩個先做錯過的地方，都只有在慢網路下才看得出來：**
  //
  // 一、原本當題一開始播就同時抓後面兩首。頻寬是共用的，三個 1 MB 的檔搶同一條線，
  //     結果當題自己都還沒載完。限速到 2 Mbps 實測：每一題都等滿三秒守門計時器
  //     （1827, 3364, 3378, 3359 ms）——等於完全沒有預載。
  // 二、所以改成排隊：一次只抓一首，前一首抓完才抓下一首。
  //     而且要等**當題**載得夠順（canplaythrough）才開始，正在播的那一首優先。
  //
  // 試聽檔的 Cache-Control 是 public, max-age=25407205（294 天），
  // 所以正式播放時瀏覽器直接從快取拿。
  //
  // **為什麼不乾脆拿預載的那顆 Audio 直接當播放器**（那樣就不必靠快取）：
  // iOS 的音訊要先被使用者手勢「解鎖」才播得出來。頁面上那一顆 <audio> 是在
  // 按下「開始」那一下解鎖的；用 new Audio() 生出來的沒有，之後 play() 會被拒絕。
  // 也就是說「直接用預載的那顆」在桌機更穩，在 iOS 反而會讓整個遊戲沒有聲音——
  // 而 iOS 是這個站的主要場景。所以維持「一顆播放器 ＋ 靠 HTTP 快取」。
  var PREFETCH_AHEAD = 2;

  /** 當題載到這個程度還沒回報，就不等了直接開始預載。 */
  var PREFETCH_START_MS = 4000;

  /** 已經抓好的：原始網址 → 本機的 blob 網址。 */
  var prefetched = {};

  /** 抓好的先後順序。太舊的要放掉，否則一場二十題會囤二十 MB。 */
  var order = [];
  var KEEP = 8;

  /** 排隊等著抓的網址。 */
  var pending = [];

  /** 正在抓的那一個。一次只抓一首——並行會互相搶頻寬。 */
  var loading = null;

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

  /** 預備最多等這麼久。網路真的爛的時候不能讓人永遠開不了場。 */
  var WARM_LIMIT_MS = 12000;

  /** 抓完一首就叫一次，給開場的進度條用。 */
  var onPrefetched = null;

  function queuePrefetch(url) {
    if (!url || prefetched[url] || pending.indexOf(url) !== -1) return;
    if (loading && loading.url === url) return;
    pending.push(url);
  }

  /**
   * 用 fetch 抓整個檔案，不要用 <audio> 預載。
   *
   * 原本這裡是 new Audio() ＋ preload='auto'，等 canplaythrough。**那是錯的，
   * 而且錯得很難看出來**：限速到 2 Mbps 實測，canplaythrough 在 585 毫秒就發了，
   * 但那時候 buffered 只有 1.1 秒（整首 30 秒）——瀏覽器是拿「目前的下載速率」
   * 去估「應該播得完」，不是真的抓完。所以預備看起來成功，實際只囤了一秒鐘的歌。
   *
   * 換成 fetch 之後，「抓完」就真的是抓完；而且拿到整份資料可以直接做成 blob
   * 餵給播放器，連第二個問題一起解掉——題目是從歌曲中段開始播的，播放器會發
   * `Range: bytes=458752-` 去要中間那一段，那個位元組範圍原本根本沒被預載到。
   *
   * Apple 的 CDN 給 `Access-Control-Allow-Origin: *`，所以 fetch 讀得到內容。
   * 讀不到（哪天他們改了）也不會壞：抓失敗就照原本的網址播，回到改動前的行為。
   */
  function pumpPrefetch() {
    if (loading || pending.length === 0) return;

    var url = pending.shift();
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var mine = { url: url, controller: controller };

    loading = mine;

    function settle(blobUrl) {
      if (loading !== mine) return;
      loading = null;

      if (blobUrl) {
        prefetched[url] = blobUrl;
        order.push(url);
        forget();
      }

      if (onPrefetched) onPrefetched(url, !!blobUrl);
      pumpPrefetch();
    }

    fetch(url, controller ? { signal: controller.signal } : undefined)
      .then(function (response) { return response.ok ? response.blob() : null; })
      .then(function (blob) { settle(blob ? URL.createObjectURL(blob) : null); })
      .catch(function () {
        // 被 yieldPrefetch 中止的不算數：它已經把網址排回隊伍了，別再往下走。
        if (controller && controller.signal.aborted) return;
        settle(null);
      });
  }

  /** 只留最近幾首。放掉的是已經播過的，不會再用到。 */
  function forget() {
    while (order.length > KEEP) {
      var old = order.shift();
      if (prefetched[old]) URL.revokeObjectURL(prefetched[old]);
      delete prefetched[old];
    }
  }

  /** 這首歌要從哪裡播：抓好了就用本機的，沒抓好就照原網址。 */
  function sourceFor(url) {
    return prefetched[url] || url;
  }

  /**
   * 把頻寬讓給正在播的那一首。
   *
   * 每換一題就先停掉手上的預載：新的一題要馬上有聲音，而預載和它搶的是
   * 同一條線。抓到一半的會丟掉重來，但那是划算的——使用者等的是現在這一首，
   * 不是下一首。等這一首載得夠順（canplaythrough）再繼續。
   */
  function yieldPrefetch() {
    clearTimeout(state.prefetchTimer);
    state.prefetchTimer = null;

    if (!loading) return;

    var url = loading.url;
    if (loading.controller) loading.controller.abort();
    loading = null;

    // 退回隊伍最前面，等一下再抓。
    if (url && !prefetched[url] && pending.indexOf(url) === -1) pending.unshift(url);
  }

  /** 一場結束就放掉。留著只是佔記憶體，而且下一場的題目不一樣。 */
  function dropPrefetched() {
    if (loading && loading.controller) loading.controller.abort();

    Object.keys(prefetched).forEach(function (url) {
      URL.revokeObjectURL(prefetched[url]);
    });

    prefetched = {};
    order = [];
    pending = [];
    loading = null;
  }

  function playPreview(url, offset, onPlaying) {

    var seeked = false;

    // 「開始播」要聽 playing 而不是 play()：play() 的 promise 只表示瀏覽器
    // 接受了這次播放要求，聲音可能還在等資料。分數看的是玩家何時聽到聲音。
    //
    // 上一題如果從頭到尾沒響過（載失敗、被擋掉），它掛的監聽會留在 <audio> 上，
    // 然後在這一題響的時候才觸發——那會用上一題的參數再開一個計時器，
    // 兩個計時器一起跑，同一題會被送出兩次。所以先把舊的拆掉。
    if (playingHook) player.removeEventListener('playing', playingHook);
    playingHook = onPlaying || null;
    if (playingHook) player.addEventListener('playing', playingHook, { once: true });


    player.src = url;
    player.muted = !!offset;

    function seek() {
      if (seeked) return;
      seeked = true;

      if (offset) {
        // 留住整整十二秒：從結尾往回算，再多留半秒緩衝，免得剛好卡在檔尾。
        var span = Math.max(0, (player.duration || 30) - Rules.QUESTION_SECONDS - 0.5);
        try {
          player.currentTime = offset * span;
        } catch (e) {
          // 這個瀏覽器不讓 seek 就算了，從頭放總比不放好。
        }
      }

      player.muted = false;
    }

    player.addEventListener('loadedmetadata', seek, { once: true });

    // metadata 遲遲不來的時候不能一直靜音——那會變成「畫面在跑但沒有聲音」。
    setTimeout(seek, 1200);

    // 自動播放需要使用者手勢，而「試聽／開始／下一題」那一下就是手勢，所以這裡不會被擋。
    return player.play();
  }

  // ---- 題庫 ----
  function countByLanguage() {
    var counts = {};
    if (!bankReady) return counts;
    bank.tracks.forEach(function (track) {
      counts[track.language] = (counts[track.language] || 0) + 1;
    });
    return counts;
  }

  var bankCounts = countByLanguage();

  /** 題庫裡真的有歌的語種。一首都沒有的語種不該出現在選項裡讓人白選。 */
  var availableLanguages = Rules.LANGUAGES.filter(function (language) {
    return bankCounts[language];
  });

  /**
   * 題庫那一行**只在出事的時候**才說話。
   *
   * 原本它一直掛著「512 首（華語 160、台語 80…）＋ 765 個誘餌」——那是給做題庫的人
   * 看的數字，對要玩的人沒有意義，還會讓人以為選項是從那幾百首裡挑的（其實是九選一）。
   * 但這一行不能整個拿掉：題庫沒建、或音檔播不出來的時候，它是唯一會說話的地方。
   */
  function describeBank() {
    var line = el('bank-line');

    if (!bankReady) {
      line.textContent = '題庫還沒建。請執行「重建題庫.cmd」。';
      return;
    }

    line.textContent = '';
  }

  // ---- 設定區 ----
  // 語種與題數的清單都從 Rules 與題庫算出來，不寫死在 HTML 裡，
  // 否則哪天加了新語種或改了題數選項，畫面和規則層就會各說各話。

  function loadSetup() {
    var saved = String(recall('songquiz.setup.languages', ''));
    var wanted = saved ? saved.split(',') : availableLanguages;

    setup.languages = availableLanguages.filter(function (language) {
      return wanted.indexOf(language) !== -1;
    });
    if (setup.languages.length === 0) setup.languages = availableLanguages.slice();

    var mode = String(recall('songquiz.setup.mode', 'stage'));
    setup.mode = ['stage', 'speed', 'combo'].indexOf(mode) === -1 ? 'stage' : mode;

    // 題數清單是依模式而定的（積分模式開到 80），所以要先知道模式才能驗題數。
    var count = Number(recall('songquiz.setup.count', Rules.QUESTIONS_PER_ROUND));
    setup.questionCount = Rules.nearestCountFor(setup.mode, count);
  }

  function saveSetup() {
    remember('songquiz.setup.languages', setup.languages.join(','));
    remember('songquiz.setup.count', setup.questionCount);
    remember('songquiz.setup.mode', setup.mode);
  }

  function chip(label, pressed, onClick) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = label;
    button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    button.addEventListener('click', onClick);
    return button;
  }

  function renderLanguageChips() {
    var box = el('lang-chips');
    box.replaceChildren();

    availableLanguages.forEach(function (language) {
      var on = setup.languages.indexOf(language) !== -1;
      // 只放語種名，不放首數。
      // 以前每個語種的首數不一樣（華語 160、台語 80…），那個數字幫得上忙；
      // 現在題庫每個語種都撈到同樣的上限，五顆膠囊會顯示五個一樣的數字——
      // 不提供任何資訊，只是讓每一顆變長。
      // 題庫夠不夠這一場，下面那行警告會講（Rules.capacityFor）。
      var label = Rules.nameOf(language);

      box.append(chip(label, on, function () {
        toggleLanguage(language);
      }));
    });
  }

  function toggleLanguage(language) {
    var at = setup.languages.indexOf(language);

    // 全部取消就無法出題了。最後一個不給取消，比按下去沒反應再跳錯誤好。
    if (at !== -1 && setup.languages.length === 1) return;

    if (at === -1) setup.languages.push(language);
    else setup.languages.splice(at, 1);

    setup.languages = Rules.orderLanguages(setup.languages);
    refreshSetup();
  }

  function renderCountChips() {
    var box = el('count-chips');
    box.replaceChildren();

    Rules.questionCountsFor(setup.mode).forEach(function (count) {
      box.append(chip(count + ' 題', count === setup.questionCount, function () {
        setup.questionCount = count;
        refreshSetup();
      }));
    });
  }

  var modeButtons = qa('.mode');

  for (var m = 0; m < modeButtons.length; m++) {
    modeButtons[m].addEventListener('click', function () {
      setup.mode = this.dataset.mode;
      // 換模式可能換掉整份題數清單（積分是 10～80，其他是 5～20），
      // 所以要把目前的題數挪到新清單裡最接近的那一個，不能留一個不存在的值。
      setup.questionCount = Rules.nearestCountFor(setup.mode, setup.questionCount);
      refreshSetup();
    });
  }

  /**
   * 每個模式按鈕下面那行小字。
   *
   * 只放**這個模式和別的模式不一樣的那個數字**，而且只在沒被選到時顯示。
   *
   * 分工：這一行是「選之前拿來比較三個模式」，摘要那一行是「選好之後確認」。
   * 原本兩邊都寫「6 關 × 每關 10 題」「滿分 10,000」，同一句話相隔二十幾個
   * 像素出現兩次，看起來像畫面出錯。
   */
  function modeNote(mode) {
    // 每個模式各自的題數清單不同，所以預覽要用「這個模式真的能挑到的那個題數」，
    // 否則在闖關模式下會看到積分那格寫「5 題」，而積分根本沒有 5 題這個選項。
    var count = Rules.nearestCountFor(mode, setup.questionCount);

    if (mode === 'stage') {
      var stages = Rules.stagesFor(setup.languages, count, mode);
      return '共 ' + (stages.length * count) + ' 題';
    }

    return '滿分 ' + num(Rules.perfectScoreFor(mode, count));
  }

  /** 按下開始之前的最後確認：設定要在畫面上看得出後果。 */
  function summaryLine() {
    var names = setup.languages.map(Rules.nameOf).join('／');
    var count = setup.questionCount;

    if (setup.mode === 'stage') {
      var stages = Rules.stagesFor(setup.languages, count, setup.mode);
      var thresholds = stages.length === 1
        ? num(stages[0].scoreToClear)
        : num(stages[0].scoreToClear) + '→' + num(stages[stages.length - 1].scoreToClear);

      return '闖關模式 · ' + stages.length + ' 關 × 每關 ' + count + ' 題 · ' +
        names + ' · 過關門檻 ' + thresholds;
    }

    if (setup.mode === 'combo') {
      return '積分模式 · ' + count + ' 題 · ' + names +
        ' · 滿分 ' + num(Rules.perfectScoreFor('combo', count)) +
        '（連對最高 ×' + Rules.COMBO_MAX_MULTIPLIER + '）';
    }

    return '競速模式 · ' + count + ' 題 · ' + names +
      ' · 滿分 ' + num(Rules.perfectScoreFor('speed', count));
  }

  /**
   * 題庫湊不出這場的話，要在開打前講清楚差多少、怎麼辦。
   * 玩到第三關才發現沒歌可出，是最糟的收場方式。
   */
  function warningLine(capacity) {
    var worst = capacity.shortfall[0];
    if (!worst) return '';

    var where = worst.stage ? '第 ' + worst.stage + ' 關' : '這一場';
    var langs = worst.languages.map(Rules.nameOf).join('／');

    return '題庫湊不出' + where + '：' + langs + ' 需要 ' + worst.needed +
      ' 首，只有 ' + worst.available + ' 首。少選幾題，或多勾幾個語種。';
  }

  function refreshSetup() {
    for (var i = 0; i < modeButtons.length; i++) {
      var button = modeButtons[i];
      var on = button.dataset.mode === setup.mode;
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      // 只有**沒被選到**的模式才顯示那行小字。
      // 選到的那一個，底下的摘要已經把同樣的數字講了一次——
      // 兩句一樣的話相隔二十幾個像素，看起來像畫面出錯。
      // 這一行的用途是「選之前比較三個模式」，選好之後它的任務就結束了。
      button.querySelector('[data-note]').textContent = (bankReady && !on) ? modeNote(button.dataset.mode) : '';
    }

    renderLanguageChips();
    renderCountChips();

    var capacity = bankReady
      ? Rules.capacityFor(bank, setup.languages, setup.questionCount, setup.mode)
      : { ok: false, shortfall: [] };

    el('setup-summary').textContent = bankReady ? summaryLine() : '';

    var warning = el('setup-warning');
    warning.textContent = bankReady ? warningLine(capacity) : '';
    warning.hidden = !warning.textContent;

    el('btn-start').disabled = !capacity.ok;
    saveSetup();
  }

  describeBank();
  loadSetup();
  refreshSetup();

  if (!bankReady) el('btn-test').disabled = true;

  /**
   * 試聽放多久。原本三秒，但三秒不夠調音量——手伸到音量旋鈕它就停了，
   * 得一直重按。十秒足夠一邊聽一邊把音量調到對的位置。
   * 鈕上不寫秒數：那是實作細節，寫出來反而像是「要等十秒」。
   */
  var TEST_MS = 10000;

  el('btn-test').addEventListener('click', function () {
    var button = this;

    // 播到一半再按一次就是停下來：試聽十秒，總得有辦法提早結束。
    if (state.testTimer) return stopTest();

    var track = bank.tracks[Math.floor(Math.random() * bank.tracks.length)];
    playPreview(track.previewUrl).catch(function () {
      el('bank-line').textContent = '播不出來——檢查一下網路連線。';
      stopTest();
    });

    button.textContent = '停止試聽';
    state.testTimer = setTimeout(stopTest, TEST_MS);
  });

  function stopTest() {
    clearTimeout(state.testTimer);
    state.testTimer = null;
    player.pause();
    el('btn-test').textContent = '試聽';
  }

  // ---- 開一場 ----
  el('btn-start').addEventListener('click', startGame);

  /**
   * 一段真的沒有聲音的 WAV（標頭 44 bytes，零個取樣）。
   *
   * iOS 的 <audio> 要在使用者手勢裡成功播過一次才會被「解鎖」，之後才准
   * 程式自己呼叫 play()。原本開始鍵是直接播第一題，手勢鏈是連著的；
   * 現在中間插了開場預備，等預備完再 play() 就已經離開手勢了，iOS 會擋下來——
   * **整場沒有聲音**，而 iOS 是這個站的主場景。
   *
   * 所以在按下去的那一瞬間先播這段靜音：播放器就解鎖了，預備要花多久都沒關係。
   */
  var SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

  function startGame() {
    clearLastRound();

    state.game = new window.Game({
      mode: setup.mode,
      bank: bank,
      languages: setup.languages,
      questionCount: setup.questionCount,
    });

    el('hud-score').textContent = '0';

    // 預備期間也要顯示這一場的進度。
    // 不設的話，「再來一場」會在準備中一直掛著上一場的「第 10 / 10 題」——
    // 看起來像是按了沒反應。
    el('hud-progress').textContent = '第 1 / ' + setup.questionCount + ' 題';
    el('timer-text').textContent = Rules.QUESTION_SECONDS.toFixed(1);

    show('play');

    // 還在手勢裡：先解鎖播放器。
    unlockPlayer();

    warmUp(startFirstQuestion);
  }

  function unlockPlayer() {
    player.muted = true;
    player.src = SILENCE;

    var played = player.play();
    if (played && played.catch) played.catch(function () {
      // 被擋掉也沒關係：那表示這個瀏覽器本來就不用解鎖，或者這一下不算手勢。
      // 兩種情況下面照常走，最壞就是回到改動前的行為。
    });
  }

  /**
   * 開場預備：先把前幾題的音檔抓進快取，再開始計時。
   *
   * 這是使用者自己提的解法，而且是對的——慢網路下的空白本來就消不掉，
   * 能做的是把它搬到玩家願意等的位置。題與題之間的三秒空白最難忍受
   * （剛按完答案，期待馬上聽到下一首）；開場的進度條則是大家都習慣的等待。
   * 網路快的時候整段只花零點幾秒，沒人會注意到。
   */
  function warmUp(then) {
    var want = Math.min(WARM_MAX, Math.max(WARM_MIN, Math.ceil(setup.questionCount * WARM_SHARE)));

    // 第一題也要囤。它原本是「邊播邊等」的，那一下等待同樣算在玩家頭上。
    var urls = state.game.peek(want).map(function (question) {
      return question.answer.previewUrl;
    });

    // 已經抓好的不用再等（同一首歌在上一場出現過）。
    urls = urls.filter(function (url) { return url && !prefetched[url]; });

    if (urls.length === 0) return then();

    el('warmup').hidden = false;
    el('choices').hidden = true;
    el('play-hint').hidden = true;
    progressWarm(0, urls.length);

    var done = 0;
    var finished = false;

    function finish() {
      if (finished) return;
      finished = true;

      clearTimeout(state.warmTimer);
      state.warmTimer = null;
      onPrefetched = null;

      el('warmup').hidden = true;
      el('choices').hidden = false;
      el('play-hint').hidden = false;

      then();
    }

    onPrefetched = function () {
      done += 1;
      progressWarm(done, urls.length);
      if (done >= urls.length) finish();
    };

    urls.forEach(queuePrefetch);
    pumpPrefetch();

    // 逾時就開始。囤到幾首算幾首，剩下的在遊戲中繼續抓。
    state.warmTimer = setTimeout(finish, WARM_LIMIT_MS);
  }

  function progressWarm(done, total) {
    el('warmup-fill').style.width = Math.round((done / total) * 100) + '%';
    el('warmup-text').textContent = '先下載 ' + total + ' 首，開始之後就不會中斷（' + done + ' / ' + total + '）';
  }

  function startFirstQuestion() {
    player.muted = false;
    nextQuestion();
  }

  /**
   * 把上一局留在畫面上的東西全部洗掉。
   *
   * 逐題回顧那一串會留到下一局結束才被重畫，中間如果有人回首頁再進來，
   * 就會看到上一局的歌還躺在下面——那些歌和這一局一點關係都沒有。
   * 音訊也要停：上一局結算頁按過「聽」而沒停，它會一路播進新的一局。
   */
  function clearLastRound() {
    stopTimer();
    clearTimeout(state.advanceTimer);
    state.advanceTimer = null;
    clearTimeout(state.startGuard);
    state.startGuard = null;


    player.pause();
    clearPlayingMark();

    el('review').replaceChildren();
    el('verdict').hidden = true;
    el('verdict-title').textContent = '';
    el('verdict-answer').textContent = '';
    el('result-best').textContent = '';
    el('result-note').textContent = '';
    el('hud-target').textContent = '';

    clearTimeout(state.prefetchTimer);
    state.prefetchTimer = null;
    clearTimeout(state.warmTimer);
    state.warmTimer = null;
    onPrefetched = null;
    el('warmup').hidden = true;
    el('choices').hidden = false;
    el('play-hint').hidden = false;
    dropPrefetched();
  }


  // ---- 出題 ----
  function nextQuestion() {
    stopTimer();
    el('verdict').hidden = true;
    el('play-hint').textContent = '正在播放…選出你聽到的那一首';

    var question = state.game.nextQuestion();
    if (!question) return showResult();

    el('hud-stage').textContent = question.stageLabel
      ? '第 ' + question.stage + ' / ' + question.stageCount + ' 關'
      : modeName(state.game.mode);
    el('hud-progress').textContent = '第 ' + question.number + ' / ' + question.total + ' 題';
    el('hud-target').textContent = targetLine(question);
    el('hud-target').classList.toggle('combo', state.game.mode === 'combo');

    // HUD 的分數講的是「這一關」（門檻也是這一關的），所以每關第一題先歸零，
    // 不要讓上一關的數字留在畫面上。
    if (question.number === 1) el('hud-score').textContent = '0';

    renderChoices(question.choices);
    el('play-hint').textContent = '載入中…';

    // 十二秒從音樂真的響起來才開始算（理由寫在 game.js 的 restartClock）。
    var begun = false;
    function begin(hint) {
      if (begun) return;
      begun = true;
      clearTimeout(state.startGuard);
      state.startGuard = null;
      state.game.restartClock();
      el('play-hint').textContent = hint || '正在播放…選出你聽到的那一首';
      startTimer(question.seconds);
    }

    // 每一題的起點由出題時決定（見 questions.js），所以同一首歌每次聽到的段落不同。
    playPreview(sourceFor(question.previewUrl), question.offset, function () {
      // 守門計時器已經先開場、音樂才姍姍來遲的情況：不能重開計時器（那會變兩個），
      // 但要把「還在載入」那句換掉，否則它會一直掛在畫面上，看起來像壞了。
      if (begun) {
        el('play-hint').textContent = '正在播放…選出你聽到的那一首';
        return;
      }
      begin();
    })

      .catch(function () {
        // 放不出來也要能玩下去，不然畫面會永遠停在「載入中」。
        begin('瀏覽器擋住了自動播放——點畫面任一處再試。');
      });

    // 載不動也不能無限等。三秒是上限：超過就照常開始，
    // 玩家至少看得到倒數，而不是對著一個不動的畫面。
    state.startGuard = setTimeout(function () { begin('還在載入…先開始計時了'); }, 3000);

    // 先把頻寬讓給這一題：上一題排的預載可能還在抓，那會拖慢現在要播的這一首。
    yieldPrefetch();

    // 把後面幾題生出來排隊，但**還不要開始抓**。
    for (var ahead = 0; ahead < PREFETCH_AHEAD; ahead++) {
      var coming = state.game.prepare();
      if (!coming) break;
      queuePrefetch(coming.answer.previewUrl);
    }

    // 等當題載得夠順才開始抓後面的：頻寬是共用的，一起抓的話
    // 正在播的這一首會被拖慢（限速實測過，每題都卡滿三秒）。
    player.addEventListener('canplaythrough', pumpPrefetch, { once: true });

    // canplaythrough 不一定會來（有些瀏覽器在檔案夠大時不發），所以加一個上限。
    clearTimeout(state.prefetchTimer);
    state.prefetchTimer = setTimeout(pumpPrefetch, PREFETCH_START_MS);

    state.answering = false;
  }


  function modeName(mode) {
    if (mode === 'combo') return '積分模式';
    if (mode === 'speed') return '競速模式';
    return '闖關模式';
  }

  /**
   * HUD 右下角那一行。闖關看門檻，積分看連對——
   * 這兩件事在各自的模式裡都是「現在最該盯著的數字」。
   */
  function targetLine(question) {
    if (state.game.mode === 'combo') {
      return question.streak > 0
        ? '×' + question.multiplier + ' 連對中（' + question.streak + ' 題）'
        : '答對就開始連莊';
    }

    return question.scoreToClear > 0 ? '過關需 ' + num(question.scoreToClear) : '';
  }

  function renderChoices(choices) {
    var box = el('choices');
    box.replaceChildren();

    choices.forEach(function (choice) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice';
      button.dataset.id = choice.id;

      // 歌名一行、歌手一行。九宮格裡要在一瞬間掃過九個選項，
      // 而人是靠歌名認歌的——歌名放大加粗，歌手退成註腳。
      var title = document.createElement('b');
      title.textContent = choice.title;
      var artist = document.createElement('i');
      artist.textContent = choice.artist;
      button.append(title, artist);

      button.addEventListener('click', function () {
        submit(choice.id);
      });
      box.append(button);
    });
  }

  // ---- 計時條 ----
  function startTimer(seconds) {
    var bar = el('timer-bar');
    var text = el('timer-text');
    var timer = q('.timer');
    timer.classList.remove('urgent');

    state.deadline = performance.now() + seconds * 1000;

    state.ticker = setInterval(function () {
      var left = Math.max(0, state.deadline - performance.now()) / 1000;
      bar.style.transform = 'scaleX(' + (left / seconds) + ')';
      text.textContent = left.toFixed(1);
      if (left <= 3) timer.classList.add('urgent');
      if (left === 0) submit(null); // 時間到：當成沒作答送出，Rules 會判零分
    }, 50);
  }

  function stopTimer() {
    if (state.ticker) clearInterval(state.ticker);
    state.ticker = null;
    clearTimeout(state.startGuard);
    state.startGuard = null;
  }


  // ---- 作答 ----
  function submit(choiceId) {
    if (state.answering) return;
    state.answering = true;
    stopTimer();
    player.pause();

    var buttons = qa('.choice');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;

    var outcome = state.game.answer(choiceId);

    q('.choice[data-id="' + outcome.correctChoiceId + '"]').classList.add('correct');

    // 逾時的時候沒有「玩家選的那顆」可以標紅。
    var picked = q('.choice[data-id="' + choiceId + '"]');
    if (!outcome.correct && picked) picked.classList.add('wrong');

    showVerdict(outcome);
  }

  function showVerdict(outcome) {
    var box = el('verdict');
    var title = el('verdict-title');
    var answer = el('verdict-answer');
    var next = el('btn-next');
    var combo = state.game.mode === 'combo';

    box.hidden = false;
    box.classList.toggle('ok', outcome.correct);
    box.classList.toggle('no', !outcome.correct);

    if (outcome.correct) {
      // 積分模式要看得出「這分是怎麼來的」，否則玩家不知道連對有沒有生效。
      title.textContent = combo
        ? '答對！＋' + outcome.gained + '（×' + Math.min(outcome.streak, Rules.COMBO_MAX_MULTIPLIER) + '）'
        : '答對！＋' + outcome.gained;
    } else {
      title.textContent = combo && outcome.streak === 0 ? '答錯，連對歸零' : '答錯';
    }

    answer.textContent = outcome.correct ? outcome.correctLabel : '正解：' + outcome.correctLabel;
    el('hud-score').textContent = num(outcome.roundScore);
    el('hud-target').textContent = targetLine(outcome);

    if (outcome.status === 'stageCleared') {
      title.textContent = '第 ' + outcome.stage + ' 關過關！';
      answer.textContent = '這一關 ' + num(outcome.roundScore) +
        ' 分（門檻 ' + num(outcome.scoreToClear) + '）';
      // 過關是一個值得停下來看的時刻，不自動跳。
      setNext('前往第 ' + (outcome.stage + 1) + ' 關', nextQuestion, false);
      return;
    }

    if (outcome.status === 'stageFailed' || outcome.status === 'finished') {
      setNext('看結算', showResult, false);
      return;
    }

    setNext('下一題', nextQuestion, true);
  }

  /** 答完之後，畫面停留多久才自動跳下一題。 */
  var REVEAL_MS = 1000;

  /**
   * 設定「下一題」那顆鈕，並決定要不要自動跳。
   *
   * 一個人玩的時候，每一題都要手動按一下才會前進——節奏被打斷，
   * 而且答錯之後還要按一下才能繼續，像是在罰站。所以答完就露一秒正解再自動跳，
   * 一秒足夠看清楚「剛剛那首是什麼」，又不會讓人等。
   * 鈕留著：想快一點的人可以直接按，按下去就取消自動跳，不會跳兩次。
   */
  function setNext(label, action, auto) {
    var next = el('btn-next');

    clearTimeout(state.advanceTimer);
    state.advanceTimer = null;

    next.textContent = label;
    next.onclick = function () {
      clearTimeout(state.advanceTimer);
      state.advanceTimer = null;
      action();
    };

    if (auto) state.advanceTimer = setTimeout(next.onclick, REVEAL_MS);
  }

  // ---- 結算 ----
  function showResult() {
    stopTimer();
    player.pause();

    var game = state.game;
    var stageMode = game.mode === 'stage';
    var cleared = game.status === 'finished';

    show('result');

    el('result-title').textContent = stageMode
      ? (cleared ? game.stageCount + ' 關全破！' : '闖關失敗：第 ' + game.stage + ' 關')
      : modeName(game.mode) + '結算';

    el('result-score').textContent = num(game.totalScore);

    // 闖關的總分是幾關累積的，拿單關滿分當分母會看起來像超過 100%。
    el('result-of').textContent = stageMode
      ? '分（累積）'
      : '/ ' + num(Rules.perfectScoreFor(game.mode, game.questionCount));

    var correct = game.records.filter(function (record) {
      return record.correct;
    }).length;

    el('result-note').textContent = stageMode
      ? '打到第 ' + game.stage + ' / ' + game.stageCount + ' 關，共答對 ' + correct + ' 題'
      : '答對 ' + correct + ' / ' + game.records.length + ' 題' +
        (game.mode === 'combo' ? '，最長連對 ' + longestStreak(game.records) + ' 題' : '');

    showBest(game);
    showBoards(game);
    renderReview(game.records);
  }

  // ---- 排行榜 ----

  /** 這一局的成績，兩份榜共用同一個形狀。 */
  function entryOf(game) {
    return {
      mode: game.mode,
      questionCount: game.questionCount,
      languages: game.languages,
      score: game.totalScore,
      stage: game.mode === 'stage' ? game.stage : null,
      correct: game.records.filter(function (r) { return r.correct; }).length,
      total: game.records.length,
    };
  }

  // 面板本身在 boardui.js：同一個元件放兩個地方（首頁與結算頁），
  // 各自有自己的篩選條件——首頁想看「積分・華語」的同時，
  // 結算頁那個還停在剛打完的模式，兩邊互不影響才符合直覺。
  var homeBoard = window.BoardUI.create(el('home-board'), {
    onlineOnly: true,
    filter: { mode: setup.mode },
  });

  var resultBoard = window.BoardUI.create(el('result-board'), {
    withSubmit: true,
    filter: { mode: setup.mode },
    onNickname: function (nickname) {
      remember('songquiz.nickname', nickname);
    },
  });

  // 首頁那份榜只在展開時才查：收起來的時候沒人在看，不必打網路。
  el('home-board-fold').addEventListener('toggle', function () {
    if (this.open) homeBoard.focusMode(setup.mode);
  });

  function showBoards(game) {
    var entry = entryOf(game);

    // 本機是自動記的（自己跟自己比，不需要誰同意）；
    // 線上要按面板裡那顆「上傳到線上榜」才送。這兩件事刻意分開，
    // 面板上也寫明了，因為同一顆按鈕同時做兩件事會讓人不知道自己送出了什麼。
    window.Leaderboard.addLocal(entry);

    resultBoard.showRun(entry, recall('songquiz.nickname', ''));
  }

  /** 最長連對要從紀錄倒推：game.streak 只留著結束那一刻的值。 */
  function longestStreak(records) {
    var best = 0;
    var run = 0;

    records.forEach(function (record) {
      run = record.gained > 0 ? run + 1 : 0;
      if (run > best) best = run;
    });

    return best;
  }

  // ---- 個人最佳 ----
  // 沒有伺服器可以存排行榜，所以成績記在這台瀏覽器裡。
  //
  // key 要把「模式 + 題數 + 語種」都算進去：5 題的積分和 20 題的闖關根本不是
  // 同一件事，只用模式當 key 的話，紀錄會互相蓋掉而且毫無意義
  // （選了只有華語的 5 題，卻被拿去和五語種 20 題比）。
  function bestKey(game, field) {
    return ['songquiz.best', game.mode, game.questionCount,
      game.languages.join('-'), field].join('.');
  }

  function showBest(game) {
    var bestScore = Number(recall(bestKey(game, 'score'), 0));
    var bestStage = Number(recall(bestKey(game, 'stage'), 0));

    // 先比對再覆蓋，否則畫面就只會看到「你的最佳＝這一次」。
    var newScore = game.totalScore > bestScore;
    var newStage = game.mode === 'stage' && game.stage > bestStage;

    if (newScore) remember(bestKey(game, 'score'), game.totalScore);
    if (newStage) remember(bestKey(game, 'stage'), game.stage);

    var line = el('result-best');
    var parts = [];

    if (bestScore === 0) {
      // 第一場不喊破紀錄。基準是「自己過去的成績」，而現在還沒有過去——
      // 語種組合有 31 種、題數四到五種、模式三種，加起來將近四百個獨立的紀錄格，
      // 每換一個設定都喊一次破紀錄，這三個字就不值錢了。
      parts.push('這台裝置上、這個設定的第一場');
    } else {
      // 講明基準是哪一台、哪一個設定：不寫清楚的話，看到「最佳」會以為是在跟別人比。
      parts.push('這台裝置上這個設定的最佳 ' + num(bestScore) + ' 分' +
        (game.mode === 'stage' ? '、最遠第 ' + bestStage + ' 關' : ''));
      if (newScore) parts.push('破紀錄！多了 ' + num(game.totalScore - bestScore) + ' 分');
      if (newStage) parts.push('也是走得最遠的一次');
    }

    line.textContent = parts.join('　');
    line.classList.toggle('record', bestScore > 0 && (newScore || newStage));

  }

  // ---- 逐題回顧 ----
  function renderReview(records) {
    var list = el('review');
    list.replaceChildren();

    records.forEach(function (record) {
      var item = document.createElement('li');
      item.className = record.correct ? 'ok' : 'no';

      var song = document.createElement('span');
      song.className = 'song';
      var title = document.createElement('b');
      title.textContent = record.title;
      var meta = document.createElement('i');
      meta.textContent = record.artist + '・' + Rules.nameOf(record.language);
      song.append(title, meta);

      var points = document.createElement('span');
      points.className = 'pts';
      points.textContent = record.correct ? record.gained + ' 分・' + record.seconds + ' 秒' : '—';

      item.append(song, points, replayButton(record));
      list.append(item);
    });
  }

  // 玩完最想知道的就是「剛剛那首到底是什麼」，所以結算頁每首都能把試聽再聽一次。
  function replayButton(record) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'play';
    button.textContent = '聽';

    button.addEventListener('click', function () {
      var stopping = state.playing === button;
      clearPlayingMark();
      if (stopping) return player.pause();

      state.playing = button;
      button.classList.add('playing');
      button.textContent = '停';
      playPreview(record.previewUrl).catch(clearPlayingMark);
    });

    return button;
  }

  function clearPlayingMark() {
    if (!state.playing) return;
    state.playing.classList.remove('playing');
    state.playing.textContent = '聽';
    state.playing = null;
  }

  // 播完、或被停掉（換聽另一首、離開結算頁）時，那顆鈕要跟著恢復原樣。
  player.addEventListener('ended', clearPlayingMark);
  player.addEventListener('pause', clearPlayingMark);

  el('btn-again').addEventListener('click', startGame);

  el('btn-home').addEventListener('click', function () {
    // 自動跳下一題的計時器一定要收掉，否則回到首頁之後它還是會把人拉進遊戲畫面。
    clearTimeout(state.advanceTimer);
    state.advanceTimer = null;
    stopTimer();
    player.pause();
    show('home');
  });

  /**
   * 切到多人那一邊時要呼叫。單人這半邊被藏起來不等於停下來——
   * 計時器還在跑、音樂還在放、一秒後還會自動跳下一題，
   * 那些都會在使用者已經在看房間畫面的時候繼續發生。
   */
  window.SoloShell = {
    stop: function () {
      clearLastRound();
      show('home');
    },
  };
})();
