// 多人房間：房主開一間、朋友輸房號進來、先答對的人拿一分，最後用題數排名。
//
// 這一頁是獨立的（不從 index.html 走），因為單人玩的人不該為多人功能付出載入成本。
// 它只借用單人版的三個純邏輯層（rules／questions／game），一行都沒有改到它們。
//
// 兩件事值得先講清楚，看下面的程式才不會覺得奇怪：
//
// 一、**Game 在這裡只當「出題器」。** 真正的計分是房間自己的（先答對的拿一分），
//     Game 的 totalScore 在這一頁是沒有意義的數字，不要去讀它。
//
// 二、**沒有伺服器，所以房主就是裁判。** 誰先答對由房主收到訊息的順序決定。
//     理由寫在 arbitrate() 上面。

(function () {
  'use strict';

  var Rules = window.Rules;
  var Realtime = window.Realtime;

  /** 揭曉正解之後停多久再出下一題。短到不無聊，長到看得完「誰搶到」。 */
  var REVEAL_MS = 3500;

  /**
   * 客人送出 hello 之後等多久還沒收到名冊，就當這個房號不存在。
   * 一個來回的訊息其實一兩百毫秒就到，但房主那一頁可能在手機上被系統降速
   * （切到背景、省電模式），所以給得寬一點——誤判「房號不存在」比多等三秒難處理得多。
   */
  var JOIN_TIMEOUT_MS = 8000;

  function el(id) {
    return document.getElementById(id);
  }

  function num(value) {
    return value.toLocaleString('en-US');
  }

  /**
   * 固定種子的亂數（mulberry32）。
   *
   * 為什麼一定要自己帶一顆：所有人要看到同一題、同樣的選項順序，唯一乾淨的作法
   * 就是「同一顆種子跑同一套出題程式」——房主只需要廣播一個整數，
   * 不必逐題把題目、九個選項和它們的順序都傳一遍。
   * Math.random 沒有種子可以固定，所以只能自己寫一顆。
   *
   * mulberry32 選它的理由很單純：短、只用 32 位元整數運算，
   * 在所有瀏覽器上逐位元一致（Math.imul 是規格保證的）。
   * 這裡不需要密碼學強度，需要的是「兩台機器算出來一模一樣」。
   */
  function seededRng(seed) {
    var a = seed >>> 0;

    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var bank = window.SONG_BANK;
  var bankReady = !!(bank && bank.tracks && bank.tracks.length);

  /**
   * 題庫指紋。所有人得用同一份題庫，否則同一顆種子也會抽出不同的歌
   * ——而且畫面上看起來完全正常，只是大家在猜不同的題目。
   * 把它跟著設定一起傳，開場就能抓到「有人的分頁是舊版的」。
   */
  var bankStamp = bankReady ? (bank.generatedAt || '?') + '/' + bank.tracks.length : 'none';

  var bankCounts = {};
  if (bankReady) {
    bank.tracks.forEach(function (track) {
      bankCounts[track.language] = (bankCounts[track.language] || 0) + 1;
    });
  }

  var availableLanguages = Rules.LANGUAGES.filter(function (language) {
    return bankCounts[language];
  });

  var player = el('player');

  // ---- 狀態 ----

  var state = {
    /** 'host'｜'guest'。沒進房之前是 null。 */
    role: null,
    adapter: null,
    roomCode: '',
    myName: '',
    hostId: '',
    /** 名冊。房主自己維護，客人用房主廣播的那一份覆蓋。 */
    players: [],
    settings: null,
    game: null,
    /** 我自己數的題號（1-based）。闖關模式 view.number 每關會歸零，不能拿它當全場題號。 */
    index: 0,
    totalQuestions: 0,
    /** 這一題的正解。從 game.current 抄下來，因為 game.answer() 之後它就沒了。 */
    answerId: null,
    answerLabel: '',
    /** 這一題我還能不能答。答過（不管對錯）或已經被搶走就是 true。 */
    locked: true,
    /** 房主視角：這一題已經有人答對了嗎。 */
    resolved: false,
    /** 房主視角：這一題誰已經出手過了，避免同一人連點兩次。 */
    claimed: {},
    points: {},
    ticker: null,
    deadline: 0,
    revealTimer: null,
    joinTimer: null,
  };

  /** 房主開場挑的設定。 */
  var setup = {
    languages: availableLanguages.slice(),
    questionCount: Rules.QUESTIONS_PER_ROUND,
    mode: 'speed',
  };

  var screens = {
    lobby: el('screen-lobby'),
    waiting: el('screen-waiting'),
    play: el('screen-play'),
    result: el('screen-result'),
  };

  function show(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].hidden = key !== name;
    });
  }

  function isHost() {
    return state.role === 'host';
  }

  function nameOfPlayer(id) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i].name;
    }
    return '（離線的人）';
  }

  // ---- 連線狀態列 ----

  function setNet(text, tone) {
    var box = el('net-status');
    box.textContent = text;
    box.className = 'net ' + (tone || '');
  }

  function setNotice(text) {
    var box = el('net-notice');
    box.textContent = text || '';
    box.hidden = !text;
  }

  function lobbyError(text) {
    var box = el('lobby-error');
    box.textContent = text || '';
    box.hidden = !text;
  }

  // ---- 挑 adapter ----
  // ?rt=broadcast 可以蓋掉設定檔，強制走同機通道。
  // 這是留給測試工具的後門：就算哪天真的接上了 Supabase，
  // 也還要能用同一台電腦的兩個分頁把整個協定跑一遍。

  function forcedProvider() {
    var match = /[?&]rt=(broadcast|supabase)/.exec(window.location.search);
    return match ? match[1] : null;
  }

  function showPicked(picked) {
    setNotice(picked.notice);

    if (!picked.adapter) {
      setNet('多人房間無法使用', 'bad');
      el('btn-create').disabled = true;
      el('btn-join').disabled = true;
    } else {
      setNet(picked.adapter.label + '：未連線', '');
    }
  }

  showPicked(Realtime.pick(forcedProvider()));

  // 載入的當下「這個網址有沒有中繼」還在探測中，所以上面那行字是暫時的。
  // 探測回來之後再問一次——不然在區域網路開的房會一直顯示成別條線。
  Realtime.relayReady().then(function () {
    showPicked(Realtime.pick(forcedProvider()));
  });

  /** 每次進房都要一個乾淨的 adapter（上一間房的 channel 不能留著）。 */
  function freshAdapter() {
    var next = Realtime.pick(forcedProvider());
    var adapter = next.adapter;

    adapter.onStatus(function (status, detail) {
      var words = {
        connecting: '連線中…',
        open: '已連線',
        closed: '已離線',
        error: '連線出問題',
      };
      setNet(adapter.label + '：' + (words[status] || status) +
        (detail ? '（' + detail + '）' : ''),
        status === 'error' ? 'bad' : (status === 'open' ? 'ok' : ''));
    });

    adapter.onMessage(handleMessage);
    return adapter;
  }

  // ---- 設定區（只有房主看得到）----

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
      box.append(chip(Rules.nameOf(language) + ' ' + bankCounts[language], on, function () {
        var at = setup.languages.indexOf(language);
        if (at !== -1 && setup.languages.length === 1) return;
        if (at === -1) setup.languages.push(language);
        else setup.languages.splice(at, 1);
        setup.languages = Rules.orderLanguages(setup.languages);
        refreshSetup();
      }));
    });
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

  function totalQuestionsFor(settings) {
    if (settings.mode !== 'stage') return settings.questionCount;
    return Rules.stagesFor(settings.languages, settings.questionCount, 'stage').length *
      settings.questionCount;
  }

  function describeSettings(settings) {
    var names = settings.languages.map(Rules.nameOf).join('／');
    var total = totalQuestionsFor(settings);
    var modeName = { stage: '闖關', speed: '競速', combo: '積分' }[settings.mode] || settings.mode;

    // 房間的分數是「搶到幾題」，所以這裡只講題數，不講單人版的滿分。
    return modeName + '出題 · 共 ' + total + ' 題 · ' + names +
      (settings.mode === 'stage'
        ? '（' + Rules.stagesFor(settings.languages, settings.questionCount, 'stage').length +
          ' 關 × 每關 ' + settings.questionCount + ' 題）'
        : '');
  }

  function refreshSetup() {
    for (var i = 0; i < modeButtons.length; i++) {
      modeButtons[i].setAttribute('aria-pressed',
        modeButtons[i].dataset.mode === setup.mode ? 'true' : 'false');
    }

    renderLanguageChips();
    renderCountChips();

    var capacity = bankReady
      ? Rules.capacityFor(bank, setup.languages, setup.questionCount, setup.mode)
      : { ok: false, shortfall: [] };

    el('setup-summary').textContent = bankReady ? describeSettings(setup) : '';

    var warning = el('setup-warning');
    var worst = capacity.shortfall[0];
    warning.textContent = worst
      ? '題庫湊不出' + (worst.stage ? '第 ' + worst.stage + ' 關' : '這一場') + '：' +
        worst.languages.map(Rules.nameOf).join('／') + ' 需要 ' + worst.needed +
        ' 首，只有 ' + worst.available + ' 首。少選幾題，或多勾幾個語種。'
      : '';
    warning.hidden = !warning.textContent;

    el('btn-create').disabled = !capacity.ok || !picked.adapter;
  }

  function describeBank() {
    var line = el('bank-line');

    if (!bankReady) {
      line.textContent = '題庫還沒建。請先執行「重建題庫.cmd」。';
      return;
    }

    line.textContent = '題庫：' + bank.tracks.length + ' 首 ＋ ' +
      bank.decoys.length + ' 個誘餌' +
      (bank.generatedAt ? '，' + bank.generatedAt.slice(0, 10) + ' 建立' : '');
  }

  describeBank();
  refreshSetup();

  // ---- 建房 ----

  el('btn-create').addEventListener('click', function () {
    var name = readNickname();
    if (!name) return;

    state.role = 'host';
    state.myName = name;
    state.roomCode = Realtime.makeRoomCode();
    state.settings = {
      mode: setup.mode,
      languages: setup.languages.slice(),
      questionCount: setup.questionCount,
      // 種子只要是整數就好。用時間 ^ 亂數，是為了「同一台電腦連開兩場」也不會撞。
      seed: (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0,
      bankStamp: bankStamp,
    };

    state.adapter = freshAdapter();
    state.hostId = state.adapter.selfId;
    state.players = [{ id: state.hostId, name: name }];
    state.points = {};

    lobbyError('');

    state.adapter.connect(state.roomCode).then(function () {
      enterWaiting();
    }, function (error) {
      state.role = null;
      lobbyError('開不了房間：' + error.message);
    });
  });

  // ---- 加入 ----

  var joinInput = el('join-code');

  joinInput.addEventListener('input', function () {
    // 一邊打一邊正規化，這樣畫面上看到的就是真的會被拿去用的房號。
    var caretAtEnd = joinInput.selectionStart === joinInput.value.length;
    joinInput.value = Realtime.normalizeRoomCode(joinInput.value);
    if (caretAtEnd) joinInput.selectionStart = joinInput.selectionEnd = joinInput.value.length;
  });

  el('btn-join').addEventListener('click', function () {
    var name = readNickname();
    if (!name) return;

    var code = Realtime.normalizeRoomCode(joinInput.value);
    if (code.length !== Realtime.CODE_LENGTH) {
      return lobbyError('房號是 ' + Realtime.CODE_LENGTH + ' 個英數字，再確認一下。');
    }

    state.role = 'guest';
    state.myName = name;
    state.roomCode = code;
    state.players = [];
    state.points = {};

    state.adapter = freshAdapter();
    lobbyError('連線中…');

    state.adapter.connect(code).then(function () {
      state.adapter.send('hello', { name: name });

      // 房主不在（或房號打錯）的時候沒有人會回話，只能靠等。
      // 這是不自架伺服器的必然代價：沒有一個地方可以問「這間房存在嗎」。
      state.joinTimer = setTimeout(function () {
        leaveRoom();
        lobbyError('房號 ' + code + ' 沒有人回應。確認房主還開著那一頁，也確認房號沒打錯。' +
          (state.adapter && !state.adapter.crossDevice
            ? '（現在走的是同機通道，跨裝置要先設定 realtime-config.js）'
            : ''));
      }, JOIN_TIMEOUT_MS);
    }, function (error) {
      state.role = null;
      lobbyError('連不上：' + error.message);
    });
  });

  function readNickname() {
    var name = el('nick').value.trim().slice(0, 12);
    if (!name) {
      lobbyError('先取個暱稱，別人才知道是誰搶到的。');
      el('nick').focus();
      return null;
    }
    el('nick').value = name;
    return name;
  }

  // ---- 等待室 ----

  function enterWaiting() {
    el('room-code').textContent = state.roomCode;
    el('room-settings').textContent = describeSettings(state.settings);
    el('btn-start-round').hidden = !isHost();
    el('waiting-hint').textContent = isHost()
      ? '把房號念給朋友，他們在自己的裝置上輸入就能進來。人到齊了按開始。'
      : '已經進房了，等房主按開始。';

    renderPlayers();
    show('waiting');

    if (isHost()) broadcastRoster('waiting');
  }

  function renderPlayers() {
    var list = el('player-list');
    list.replaceChildren();

    state.players.forEach(function (person) {
      var item = document.createElement('li');
      item.textContent = person.name;
      if (person.id === state.hostId) item.className = 'host';
      if (person.id === state.adapter.selfId) item.textContent += '（你）';
      list.append(item);
    });

    el('player-count').textContent = state.players.length + ' 人';
  }

  function broadcastRoster(phase) {
    state.adapter.send('roster', {
      hostId: state.hostId,
      players: state.players,
      settings: state.settings,
      phase: phase,
    });
  }

  /** 一個人就開打要按兩次。第一次只是提醒，不是拒絕——測試和「朋友還在路上」都是正當理由。 */
  var soloConfirmed = false;

  el('btn-start-round').addEventListener('click', function () {
    if (!isHost()) return;

    if (state.players.length < 2 && !soloConfirmed) {
      soloConfirmed = true;
      el('waiting-hint').textContent = '只有你一個人——這樣等於單人練習，沒有人可以搶。再按一次就開始。';
      el('btn-start-round').textContent = '還是開始';
      return;
    }

    beginRound();
  });

  function beginRound() {
    state.adapter.send('start', { settings: state.settings });
    startWithSettings(state.settings);
  }

  // ---- 開一場 ----

  function startWithSettings(settings) {
    state.settings = settings;
    state.index = 0;
    state.totalQuestions = totalQuestionsFor(settings);
    state.points = {};

    state.players.forEach(function (person) {
      state.points[person.id] = 0;
    });

    /**
     * 每一台機器都用**完全相同的輸入**推進同一顆 Game，這是「所有人看到同一題」的全部秘密：
     * 同一顆種子（rng）、同一組設定，而且時鐘固定回 0。
     *
     * 為什麼要固定時鐘：Game 會用 now() 算作答秒數去判分，而在闖關模式，
     * 「這一關拿幾分」決定過關或失敗。一旦各人分數不同，關卡進度就會分岔，
     * 下一題開放的語種跟著不同，畫面就再也不是同一題了。
     * 固定時鐘（elapsed 永遠是 0，等於每題都拿單題滿分）＋每題一律餵正解
     * （見 applyAward），所以闖關模式在這裡永遠不會「過不了關」，
     * 而 Game 的內部狀態（rng 走到哪、出過哪些歌、第幾關）在所有人身上逐字相同。
     *
     * 代價是 game.totalScore 變成一個沒有意義的數字——房間本來就不看它，
     * 房間的分數是「你搶到幾題」。
     */
    state.game = new window.Game({
      mode: settings.mode,
      bank: bank,
      languages: settings.languages,
      questionCount: settings.questionCount,
      rng: seededRng(settings.seed),
      now: function () {
        return 0;
      },
    });

    el('q-mode').textContent = describeSettings(settings);
    el('btn-next-q').hidden = !isHost();
    show('play');

    if (settings.bankStamp && settings.bankStamp !== bankStamp) {
      setNotice('警告：你的題庫和房主的不一樣（' + bankStamp + ' vs ' + settings.bankStamp +
        '）。同一顆種子在不同題庫上會抽出不同的歌，這場的題目不會一致。');
    }

    if (isHost()) askNext();
  }

  /** 房主出下一題。Game 出不出來（整場結束）就結算。 */
  function askNext() {
    clearTimeout(state.revealTimer);

    var view = state.game.nextQuestion();
    if (!view) return finishRound();

    state.adapter.send('ask', { index: state.index + 1, signature: signatureOf(view) });
    beginQuestion(view);
  }

  /**
   * 這一題的指紋：拿九個選項的字數、按位置加權加起來。
   *
   * 只要題目不同、或選項順序不同，這個數就會不同——正好是要驗的兩件事。
   * 刻意不傳題目本身也不傳正解：這個數看不出答案是哪一個，
   * 而題目是各自用種子算出來的，本來就不需要走網路。
   */
  function signatureOf(view) {
    var sum = 0;
    view.choices.forEach(function (choice, i) {
      sum += (i + 1) * choice.label.length;
    });
    return view.choices.length + ':' + sum;
  }

  function beginQuestion(view) {
    state.index++;
    state.locked = false;
    state.resolved = false;
    state.claimed = {};

    // 正解要在這裡抄下來：game.answer() 一旦呼叫，game.current 就變 null 了。
    state.answerId = state.game.current.answerId;
    state.answerLabel = window.labelOf(state.game.current.answer);

    el('q-progress').textContent = '第 ' + state.index + ' / ' + state.totalQuestions + ' 題' +
      (view.stageLabel ? '（' + view.stageLabel + '）' : '');
    el('verdict').hidden = true;
    el('btn-next-q').disabled = true;
    el('play-hint').textContent = '正在播放…最快答對的人拿一分';
    el('play-hint').className = 'hint';

    renderChoices(view.choices);
    renderBoard();
    startTimer(view.seconds);

    // 每個人在自己的裝置上放自己的音檔。放不出來（無頭瀏覽器、自動播放被擋）
    // 不能讓整場停住，所以只是換一句提示。
    player.src = view.previewUrl;
    player.currentTime = 0;
    var playing = player.play();
    if (playing && playing.catch) {
      playing.catch(function () {
        el('play-hint').textContent = '瀏覽器擋住了自動播放——點畫面任一處，下一題就會有聲音。';
      });
    }
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
        claim(choice.id);
      });
      box.append(button);
    });
  }

  function lockChoices() {
    var buttons = document.querySelectorAll('.choice');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
  }

  // ---- 作答 ----

  /**
   * 我按下了一個選項。
   *
   * 對錯是在自己這台機器上判的——答案本來就在瀏覽器裡（純靜態站的既有取捨），
   * 送一個 boolean 和送一個 choiceId 的可信度完全一樣，而送 boolean 少一次
   * 「房主也要有同一份題庫」的假設。房主要驗的是「誰先」，不是「對不對」。
   */
  function claim(choiceId) {
    if (state.locked) return;
    state.locked = true;

    var correct = choiceId === state.answerId;

    var pickedButton = document.querySelector('.choice[data-id="' + choiceId + '"]');
    if (pickedButton) pickedButton.classList.add(correct ? 'mine' : 'wrong');

    if (correct) {
      lockChoices();
      el('play-hint').textContent = '送出了，等房主判定…';
    } else {
      // 答錯不能重答同一題，但題目還沒結束（別人還在搶），所以只鎖自己。
      lockChoices();
      el('play-hint').textContent = '答錯了。這一題你出局，看誰搶到。';
      el('play-hint').className = 'hint bad';
    }

    if (isHost()) arbitrate(state.adapter.selfId, state.index, correct);
    else state.adapter.send('claim', { index: state.index, correct: correct });
  }

  /**
   * 「誰先答對」的判定：**由房主仲裁，判準是房主收到 claim 的先後**，
   * 不看玩家自己回報的時間。
   *
   * 為什麼不用玩家的時間戳：
   * 一、沒有共同時鐘。各台機器的 Date.now() 可能差好幾秒，performance.now() 的原點
   *     更是各自的頁面載入時間——兩邊的「0.8 秒」根本不是在量同一件事，
   *     而校時（NTP 式的來回估算）在一個猜歌遊戲上是明顯過頭的工程。
   * 二、這是純靜態站，答案就在瀏覽器裡。讓玩家自報毫秒數等於讓他自己填分數；
   *     而「房主收到的順序」是他改不動的——改了只會讓自己的訊息更晚到。
   * 三、房主是唯一對所有 claim 有「全序」的節點。要有全序就得有一個仲裁者，
   *     不自架伺服器的前提下，房主是唯一自然的選擇。
   *
   * 代價，誠實講：網路慢的人吃虧，而房主的 claim 少走一趟網路，天生就佔便宜。
   * 這在「不自架伺服器」的前提下沒有解，只能不要再加一層不公平——
   * 所以房主自己的 claim 走的是同一個函式、同一個判斷（上面 claim() 直接呼叫它），
   * 不特別優待也不特別懲罰，而且畫面上會寫明「房主裁判」，玩的人知道規則是什麼。
   *
   * 平手：不存在。訊息是一則一則進 handler 的，第一個把 resolved 從 false 翻成 true
   * 的人就是贏家，之後所有 claim 都會看到 resolved === true 而被擋掉。
   * 就算 BroadcastChannel 在同一個 tick 派送好幾則，handler 仍然是依序執行。
   *
   * 慢的人看得到「已經被搶走」：會。判定的同一刻就廣播 award，
   * 所有人立刻鎖選項、看到是誰搶到、看到正解——不用在那裡乾等十二秒。
   */
  function arbitrate(fromId, index, correct) {
    if (!isHost()) return;
    if (index !== state.index) return; // 上一題的遲到訊息
    if (state.resolved) return;        // 已經被搶走
    if (state.claimed[fromId]) return; // 一人一題只能出手一次
    state.claimed[fromId] = true;

    if (!correct) {
      // 答錯不結束這一題，只是這個人出局。廣播出去讓所有人看得到有人已經出手，
      // 現場才知道「還剩幾個人有機會」。
      state.adapter.send('strike', { index: index, id: fromId });
      renderStrike(fromId);
      return;
    }

    state.resolved = true;
    state.points[fromId] = (state.points[fromId] || 0) + 1;

    // points 整份傳出去，而不是只傳「誰加一分」：只傳增量的話，
    // 中途掉一則訊息就會讓某個人的分數從此永遠少一分，而且沒有人會發現。
    state.adapter.send('award', { index: index, winnerId: fromId, points: state.points });
    applyAward(index, fromId, state.points);
  }

  /** 時間到都沒人答對。只有房主會走到這裡——它是唯一有權宣布這一題作廢的人。 */
  function arbitrateTimeout() {
    if (!isHost() || state.resolved) return;
    state.resolved = true;
    state.adapter.send('award', { index: state.index, winnerId: null, points: state.points });
    applyAward(state.index, null, state.points);
  }

  function renderStrike(fromId) {
    if (fromId === state.adapter.selfId) return;
    var box = el('play-hint');
    if (box.className.indexOf('bad') !== -1) return; // 自己答錯的訊息比較重要，不要蓋掉
    box.textContent = nameOfPlayer(fromId) + ' 答錯了，還沒有人搶到。';
  }

  /**
   * 這一題結束。所有人（含房主）都走這一段，所以畫面與 Game 的推進完全同步。
   */
  function applyAward(index, winnerId, points) {
    if (index !== state.index) return;

    stopTimer();
    lockChoices();
    player.pause();

    state.locked = true;
    state.resolved = true;
    state.points = points || state.points;

    // 每題一律餵正解給 Game，而且是在這裡、所有人同一個時機餵。
    // 這是讓每台機器的 Game 走在同一步的另一半（另一半是同一顆種子）。
    state.game.answer(state.answerId);

    var correctButton = document.querySelector('.choice[data-id="' + state.answerId + '"]');
    if (correctButton) correctButton.classList.add('correct');

    var box = el('verdict');
    var title = el('verdict-title');

    box.hidden = false;
    box.className = 'verdict ' + (winnerId ? (winnerId === state.adapter.selfId ? 'ok' : 'taken') : 'no');

    if (!winnerId) title.textContent = '時間到，沒有人答對';
    else if (winnerId === state.adapter.selfId) title.textContent = '你搶到了！＋1';
    else title.textContent = nameOfPlayer(winnerId) + ' 先答對，這一分被搶走了';

    el('verdict-answer').textContent = '正解：' + state.answerLabel;
    renderBoard();

    if (isHost()) {
      el('btn-next-q').disabled = false;
      el('btn-next-q').textContent = state.index >= state.totalQuestions ? '看結算' : '下一題';
      // 自動接下一題，房主不必每題都按。想快一點就按那顆鈕。
      state.revealTimer = setTimeout(askNext, REVEAL_MS);
    }
  }

  el('btn-next-q').addEventListener('click', function () {
    if (!isHost()) return;
    clearTimeout(state.revealTimer);
    askNext();
  });

  // ---- 計時條 ----

  function startTimer(seconds) {
    stopTimer();

    var bar = el('timer-bar');
    var text = el('timer-text');
    state.deadline = performance.now() + seconds * 1000;

    state.ticker = setInterval(function () {
      var left = Math.max(0, state.deadline - performance.now()) / 1000;
      bar.style.transform = 'scaleX(' + (left / seconds) + ')';
      text.textContent = left.toFixed(1);

      if (left === 0) {
        stopTimer();
        // 每個人的計時器各自從「收到 ask」起算，所以到期的時刻本來就不會完全一樣。
        // 只有房主的到期有效力，其他人到期就只是自己不能再答了。
        if (isHost()) arbitrateTimeout();
        else if (!state.locked) {
          state.locked = true;
          lockChoices();
          el('play-hint').textContent = '你這一題沒答，等房主宣布結果。';
        }
      }
    }, 50);
  }

  function stopTimer() {
    if (state.ticker) clearInterval(state.ticker);
    state.ticker = null;
  }

  // ---- 即時比分 ----

  function standings() {
    return state.players.map(function (person) {
      return { id: person.id, name: person.name, points: state.points[person.id] || 0 };
    }).sort(function (a, b) {
      // 同分就照暱稱排，至少每次重畫的順序是一樣的——名次會跳動比並列更難看。
      return b.points - a.points || a.name.localeCompare(b.name);
    });
  }

  function renderBoard() {
    var box = el('board');
    box.replaceChildren();

    standings().forEach(function (row) {
      var item = document.createElement('li');
      if (row.id === state.adapter.selfId) item.className = 'me';

      var who = document.createElement('span');
      who.textContent = row.name;
      var pts = document.createElement('b');
      pts.textContent = row.points;

      item.append(who, pts);
      box.append(item);
    });
  }

  // ---- 結算 ----

  function finishRound() {
    var rows = standings();
    state.adapter.send('over', { standings: rows });
    showResult(rows);
  }

  function showResult(rows) {
    stopTimer();
    clearTimeout(state.revealTimer);
    player.pause();
    show('result');

    var top = rows[0];
    var tie = rows.length > 1 && rows[1].points === top.points;

    el('result-title').textContent = !top || top.points === 0
      ? '沒有人搶到任何一題'
      : (tie ? '並列第一：' + rows.filter(function (r) {
          return r.points === top.points;
        }).map(function (r) {
          return r.name;
        }).join('、')
        : top.name + ' 拿下這一場');

    el('result-note').textContent = '共 ' + state.totalQuestions + ' 題，' +
      rows.reduce(function (sum, r) {
        return sum + r.points;
      }, 0) + ' 題有人搶到。';

    var list = el('standings');
    list.replaceChildren();

    rows.forEach(function (row, i) {
      var item = document.createElement('li');
      if (row.id === state.adapter.selfId) item.className = 'me';

      var rank = document.createElement('i');
      rank.textContent = (i + 1);
      var who = document.createElement('span');
      who.textContent = row.name;
      var pts = document.createElement('b');
      pts.textContent = row.points + ' 題';

      item.append(rank, who, pts);
      list.append(item);
    });

    el('btn-again-room').hidden = !isHost();
  }

  el('btn-again-room').addEventListener('click', function () {
    if (!isHost()) return;

    // 換一顆種子，否則「再來一場」會是一模一樣的題目。
    state.settings.seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    beginRound();
  });

  el('btn-exit').addEventListener('click', leaveRoom);
  el('btn-leave').addEventListener('click', leaveRoom);

  function leaveRoom() {
    stopTimer();
    clearTimeout(state.revealTimer);
    clearTimeout(state.joinTimer);
    player.pause();

    if (state.adapter) {
      if (state.adapter.status === 'open') state.adapter.send('bye', {});
      state.adapter.close();
    }

    state.role = null;
    state.game = null;
    state.players = [];

    // 「一個人開打要按兩次」的那個提醒也要跟著歸零，
    // 否則下一間房會在你還沒看到提醒之前就直接開打。
    soloConfirmed = false;
    el('btn-start-round').textContent = '開始';

    setNotice(picked.notice);
    show('lobby');
    lobbyError('');
  }

  // 關分頁的時候先說一聲，房主才不會在名冊上留一個永遠不會回來的人。
  window.addEventListener('beforeunload', function () {
    if (state.adapter && state.adapter.status === 'open') state.adapter.send('bye', {});
  });

  // ---- 收訊息 ----

  function handleMessage(message) {
    var payload = message.payload;

    switch (message.type) {
      case 'hello':
        if (!isHost()) return;

        // 已經開打了就不收人。臨時加入的人沒有跑過前面幾題，
        // 名次會看起來像作弊，不如老實請他等下一場。
        if (state.game) {
          state.adapter.send('roster', {
            hostId: state.hostId, players: state.players, settings: state.settings, phase: 'playing',
          });
          return;
        }

        if (!state.players.some(function (p) { return p.id === message.from; })) {
          state.players.push({ id: message.from, name: String(payload.name || '無名').slice(0, 12) });
        }
        renderPlayers();
        broadcastRoster('waiting');
        return;

      case 'roster':
        if (isHost()) return; // 房主自己就是名冊的來源
        clearTimeout(state.joinTimer);

        if (payload.phase === 'playing') {
          leaveRoom();
          return lobbyError('房號 ' + state.roomCode + ' 這一場已經開打了，等他們打完再進來。');
        }

        state.hostId = payload.hostId;
        state.players = payload.players || [];
        state.settings = payload.settings;
        lobbyError('');
        enterWaiting();
        return;

      case 'start':
        if (isHost()) return;
        startWithSettings(payload.settings);
        return;

      case 'ask':
        if (isHost()) return;

        var view = state.game && state.game.nextQuestion();
        if (!view) {
          setNotice('出不了題了（題庫和房主的不一致？）。這一場到這裡。');
          return;
        }

        beginQuestion(view);

        // 指紋不合就表示「大家在猜不同的題目」。這種錯不講出來，
        // 現場只會覺得「他怎麼都搶不到」，永遠查不到原因。
        if (payload.signature && payload.signature !== signatureOf(view)) {
          setNotice('警告：第 ' + state.index + ' 題和房主的不一樣（題庫或版本不同步）。' +
            '這一場的結果不算。');
        }
        return;

      case 'claim':
        arbitrate(message.from, payload.index, !!payload.correct);
        return;

      case 'strike':
        if (isHost()) return;
        if (payload.index === state.index) renderStrike(payload.id);
        return;

      case 'award':
        if (isHost()) return;
        applyAward(payload.index, payload.winnerId, payload.points);
        return;

      case 'over':
        if (isHost()) return;
        state.players = (payload.standings || []).map(function (row) {
          return { id: row.id, name: row.name };
        });
        showResult(payload.standings || []);
        return;

      case 'bye':
        if (!isHost()) return;
        state.players = state.players.filter(function (p) {
          return p.id !== message.from;
        });
        if (!state.game) {
          renderPlayers();
          broadcastRoster('waiting');
        } else {
          renderBoard();
        }
        return;

      default:
        // 不認得的訊息一律忽略：以後加新訊息時，舊分頁不會因此壞掉。
        return;
    }
  }

  show('lobby');
})();
