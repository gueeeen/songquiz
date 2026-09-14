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
  function playPreview(url) {
    player.src = url;
    player.currentTime = 0;
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

  function describeBank() {
    var line = el('bank-line');

    if (!bankReady) {
      line.textContent = '題庫還沒建。請執行「重建題庫.cmd」。';
      return;
    }

    var census = availableLanguages.map(function (language) {
      return Rules.nameOf(language) + ' ' + bankCounts[language];
    }).join('、');

    // 順手寫出建立日期：Apple 的試聽網址會過期，題庫放久了要重建。
    var built = bank.generatedAt ? '，' + bank.generatedAt.slice(0, 10) + ' 建立' : '';

    line.textContent = '題庫：' + bank.tracks.length + ' 首（' + census + '）＋ ' +
      bank.decoys.length + ' 個誘餌' + built;
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

    var count = Number(recall('songquiz.setup.count', Rules.QUESTIONS_PER_ROUND));
    setup.questionCount = Rules.QUESTION_COUNT_CHOICES.indexOf(count) === -1
      ? Rules.QUESTIONS_PER_ROUND
      : count;

    var mode = String(recall('songquiz.setup.mode', 'stage'));
    setup.mode = ['stage', 'speed', 'combo'].indexOf(mode) === -1 ? 'stage' : mode;
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
      var label = Rules.nameOf(language) + ' ' + bankCounts[language];

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

    Rules.QUESTION_COUNT_CHOICES.forEach(function (count) {
      box.append(chip(count + ' 題', count === setup.questionCount, function () {
        setup.questionCount = count;
        refreshSetup();
      }));
    });
  }

  var modeButtons = document.querySelectorAll('.mode');

  for (var m = 0; m < modeButtons.length; m++) {
    modeButtons[m].addEventListener('click', function () {
      setup.mode = this.dataset.mode;
      refreshSetup();
    });
  }

  /** 每個模式按鈕下面那行小字：這個設定在這個模式底下的實際後果。 */
  function modeNote(mode) {
    var count = setup.questionCount;

    if (mode === 'stage') {
      var stages = Rules.stagesFor(setup.languages, count, mode);
      return stages.length + ' 關 × 每關 ' + count + ' 題，共 ' + (stages.length * count) + ' 題';
    }

    if (mode === 'combo') {
      return count + ' 題，滿分 ' + num(Rules.perfectScoreFor(mode, count));
    }

    return count + ' 題，滿分 ' + num(Rules.perfectScoreFor(mode, count));
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
      button.querySelector('[data-note]').textContent = bankReady ? modeNote(button.dataset.mode) : '';
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

  el('btn-test').addEventListener('click', function () {
    var track = bank.tracks[Math.floor(Math.random() * bank.tracks.length)];
    playPreview(track.previewUrl).catch(function () {
      el('bank-line').textContent = '播不出來——檢查一下網路連線。';
    });
    // 三秒夠判斷現場音響的音量，又不會先把一整段放給旁邊的人聽。
    setTimeout(function () {
      player.pause();
    }, 3000);
  });

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

    player.pause();
    clearPlayingMark();

    el('review').replaceChildren();
    el('verdict').hidden = true;
    el('verdict-title').textContent = '';
    el('verdict-answer').textContent = '';
    el('result-best').textContent = '';
    el('result-note').textContent = '';
    el('hud-target').textContent = '';
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
    playPreview(question.previewUrl).catch(function () {
      el('play-hint').textContent = '瀏覽器擋住了自動播放——點畫面任一處再試。';
    });
    startTimer(question.seconds);
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
      button.textContent = choice.label;
      button.dataset.id = choice.id;
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
    var timer = document.querySelector('.timer');
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
  }

  // ---- 作答 ----
  function submit(choiceId) {
    if (state.answering) return;
    state.answering = true;
    stopTimer();
    player.pause();

    var buttons = document.querySelectorAll('.choice');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;

    var outcome = state.game.answer(choiceId);

    document.querySelector('.choice[data-id="' + outcome.correctChoiceId + '"]')
      .classList.add('correct');

    // 逾時的時候沒有「玩家選的那顆」可以標紅。
    var picked = document.querySelector('.choice[data-id="' + choiceId + '"]');
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
    renderReview(game.records);
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
      parts.push('這是你在這個設定下的第一筆紀錄');
    } else {
      parts.push('這個設定的最佳 ' + num(bestScore) + ' 分' +
        (game.mode === 'stage' ? '、最遠第 ' + bestStage + ' 關' : ''));
      if (newScore) parts.push('破紀錄！多了 ' + num(game.totalScore - bestScore) + ' 分');
      if (newStage) parts.push('也是走得最遠的一次');
    }

    line.textContent = parts.join('　');
    line.classList.toggle('record', newScore || newStage);
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
})();
