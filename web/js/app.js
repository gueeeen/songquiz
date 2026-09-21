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
    /** 「當題載夠了沒」的上限計時器。等不到 canplaythrough 就靠它開始預載。 */
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

  /**
   * 音檔預載。整套機制、踩過的坑、和量出來的數字都在 js/prefetch.js。
   *
   * 這裡只留一個實例：`el` 是這一邊的 id 查詢，`game` 讓它自己去問「還有幾題
   * 排在隊伍裡」，不必把 Game 的狀態複製一份出來。
   */
  var prefetch = window.AudioPrefetch.create({
    player: player,
    el: el,
    game: function () { return state.game; },
  });

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

  function startGame() {
    clearLastRound();

    state.game = new window.Game({
      mode: setup.mode,
      bank: bank,
      languages: setup.languages,
      questionCount: setup.questionCount,
    });

    el('hud-score').textContent = '0';

    show('play');

    // 還在手勢裡：先解鎖播放器。預備會讓第一次 play() 離開手勢好幾秒，
    // iOS 不認就整場沒有聲音。
    prefetch.unlock();

    warmThenPlay();
  }

  /**
   * 預備完才真的開場。
   *
   * 闖關模式的每一關都要走這一條，不只第一關：prepareRound() 會把預生的隊伍清掉，
   * 而 prepare() 刻意不跨關預生（新的一關換語種），所以過關的那一刻手上一首都沒有。
   * 只在 startGame 預備的話，第二關第一題是全冷的——而闖關是預設模式，
   * 那一下正是「按了前往第 N 關然後等三秒」。
   */
  function warmThenPlay() {
    el('verdict').hidden = true;

    // **先把上一段的預載狀態清掉。** 過關的那一刻可能還有一首在抓（屬於上一關，
    // 而上一關的題目已經被 prepareRound() 丟掉了）。不清的話那一首會沉澱到這一關的
    // 進度計數裡：done 多算一首不在清單裡的歌，進度條可能直接跳到 2/2、
    // 「不等了」立刻冒出來，而手上其實只有一首。房間那邊同一個地方也是這樣做的。
    prefetch.drop();

    // 預備期間也要顯示這一關的進度。
    // 不設的話，畫面會在準備中一直掛著上一關的關數、進度和分數——
    // 看起來像是按了沒反應。
    el('hud-stage').textContent = stageLabelFor(state.game);
    el('hud-progress').textContent = '第 1 / ' + state.game.questionCount + ' 題';
    el('hud-target').textContent = '';
    el('timer-text').textContent = Rules.QUESTION_SECONDS.toFixed(1);

    prefetch.warmUp(function () {
      prefetch.hideWarm('載入中…');
      nextQuestion();
    });
  }

  /** 預備畫面上的關卡標籤。nextQuestion 會用題目自己的 stageLabel 蓋掉它。 */
  function stageLabelFor(game) {
    return game.mode === 'stage' ? '第 ' + game.stage + ' 關' : '';
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

    prefetch.hideWarm();
    prefetch.drop();
  }

  // ---- 出題 ----
  function nextQuestion() {
    stopTimer();
    el('verdict').hidden = true;
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
    playPreview(prefetch.sourceFor(question.previewUrl), question.offset, function () {
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

    // 這一題開始播了：放掉上一首、補滿前面備著的題數、繼續抓。
    // **一定要在 playPreview 之後**——上一首的 blob 是在那裡 revoke 的。
    prefetch.questionStarted(question.previewUrl);

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
      setNext('前往第 ' + (outcome.stage + 1) + ' 關', warmThenPlay, false);
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

    // 一場結束就別再抓了。留著的話，結算頁按「聽」的時候還在跟排隊中的
    // 下載搶頻寬，而那些歌這一場已經用不到了。
    prefetch.drop();

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
