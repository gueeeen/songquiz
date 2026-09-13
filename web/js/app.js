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
    mode: null,
    /** 這一題的計時器 handle，離開畫面時要收乾淨。 */
    ticker: null,
    /** 這一題的截止時間（performance.now 座標）。 */
    deadline: 0,
    /** 防連點：一題只能送一次答案，也防「時間到」和最後一下點擊撞在一起。 */
    answering: false,
    /** 結算頁正在播放的那顆重聽鈕。 */
    playing: null,
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
    // 自動播放需要使用者手勢，而「試聽／選模式／下一題」那一下就是手勢，所以這裡不會被擋。
    return player.play();
  }

  // ---- 開場：題庫狀態 ----
  function describeBank() {
    var line = el('bank-line');

    if (!bankReady) {
      line.textContent = '題庫還沒建。請執行「重建題庫.cmd」。';
      return;
    }

    var counts = {};
    bank.tracks.forEach(function (track) {
      counts[track.language] = (counts[track.language] || 0) + 1;
    });

    var census = Rules.LANGUAGES.filter(function (language) {
      return counts[language];
    }).map(function (language) {
      return Rules.nameOf(language) + ' ' + counts[language];
    }).join('、');

    // 順手寫出建立日期：Apple 的試聽網址會過期，題庫放久了要重建。
    var built = bank.generatedAt ? '，' + bank.generatedAt.slice(0, 10) + ' 建立' : '';

    line.textContent = '題庫：' + bank.tracks.length + ' 首（' + census + '）＋ ' +
      bank.decoys.length + ' 個誘餌' + built;
  }

  describeBank();

  var modeButtons = document.querySelectorAll('.mode');

  // 題庫不在就不讓人按下去：按了只會在出題那一步壞掉，不如一開始就按不動。
  if (!bankReady) {
    for (var i = 0; i < modeButtons.length; i++) modeButtons[i].disabled = true;
    el('btn-test').disabled = true;
  }

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
  for (var m = 0; m < modeButtons.length; m++) {
    modeButtons[m].addEventListener('click', function () {
      startGame(this.dataset.mode);
    });
  }

  function startGame(mode) {
    state.mode = mode;
    state.game = new window.Game(mode, bank);
    el('hud-score').textContent = '0';
    show('play');
    nextQuestion();
  }

  // ---- 出題 ----
  function nextQuestion() {
    stopTimer();
    el('verdict').hidden = true;
    el('play-hint').textContent = '正在播放…選出你聽到的那一首';

    var question = state.game.nextQuestion();
    if (!question) return showResult();

    el('hud-stage').textContent = question.stageLabel || '競速模式';
    el('hud-progress').textContent = '第 ' + question.number + ' / ' + question.total + ' 題';
    el('hud-target').textContent =
      question.scoreToClear > 0 ? '過關需 ' + num(question.scoreToClear) : '';

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

    box.hidden = false;
    box.classList.toggle('ok', outcome.correct);
    box.classList.toggle('no', !outcome.correct);

    title.textContent = outcome.correct ? '答對！＋' + outcome.gained : '答錯';
    answer.textContent = outcome.correct ? outcome.correctLabel : '正解：' + outcome.correctLabel;
    el('hud-score').textContent = num(outcome.roundScore);

    if (outcome.status === 'stageCleared') {
      title.textContent = '第 ' + outcome.stage + ' 關過關！';
      answer.textContent = '這一關 ' + num(outcome.roundScore) +
        ' 分（門檻 ' + num(outcome.scoreToClear) + '）';
      next.textContent = '前往第 ' + (outcome.stage + 1) + ' 關';
      next.onclick = nextQuestion;
      return;
    }

    if (outcome.status === 'stageFailed' || outcome.status === 'finished') {
      next.textContent = '看結算';
      next.onclick = showResult;
      return;
    }

    next.textContent = '下一題';
    next.onclick = nextQuestion;
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
      ? (cleared ? '六關全破！' : '闖關失敗：第 ' + game.stage + ' 關')
      : '競速結算';

    el('result-score').textContent = num(game.totalScore);
    el('result-of').textContent = stageMode ? '分（累積）' : '/ ' + num(Rules.PERFECT_SCORE);

    var correct = game.records.filter(function (record) {
      return record.correct;
    }).length;

    el('result-note').textContent = stageMode
      ? '打到第 ' + game.stage + ' / ' + Rules.STAGE_COUNT + ' 關，共答對 ' + correct + ' 題'
      : '答對 ' + correct + ' / ' + game.records.length + ' 題';

    showBest(game);
    renderReview(game.records);
  }

  // ---- 個人最佳 ----
  // 沒有伺服器可以存排行榜，所以成績記在這台瀏覽器裡，兩種模式各記一份；
  // 換一台裝置就是另一份紀錄——這是純靜態站換來的代價。
  function bestKey(mode, field) {
    return 'songquiz.best.' + mode + '.' + field;
  }

  function showBest(game) {
    var mode = game.mode;
    var bestScore = Number(recall(bestKey(mode, 'score'), 0));
    var bestStage = Number(recall(bestKey(mode, 'stage'), 0));

    // 先比對再覆蓋，否則畫面就只會看到「你的最佳＝這一次」。
    var newScore = game.totalScore > bestScore;
    var newStage = mode === 'stage' && game.stage > bestStage;

    if (newScore) remember(bestKey(mode, 'score'), game.totalScore);
    if (newStage) remember(bestKey(mode, 'stage'), game.stage);

    var line = el('result-best');
    var parts = [];

    if (bestScore === 0) {
      parts.push('這是你在這台裝置上的第一筆紀錄');
    } else {
      parts.push('你的最佳 ' + num(bestScore) + ' 分' +
        (mode === 'stage' ? '、最遠第 ' + bestStage + ' 關' : ''));
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

  el('btn-again').addEventListener('click', function () {
    startGame(state.mode);
  });

  el('btn-home').addEventListener('click', function () {
    stopTimer();
    player.pause();
    show('home');
  });
})();
