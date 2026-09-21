// 一場遊戲：出題、計時、判分、關卡推進。畫面（app.js）只負責顯示它的狀態。
//
// 這一版是純靜態站，所以答案和計分都在瀏覽器裡——和參考站一樣。
// 代價是「玩家打開開發者工具就能看到答案」，換到的是整個站可以丟在任何
// 靜態空間、甚至雙擊 index.html 就能玩，不需要任何伺服器。
// 要做可信的排行榜時，判分必須搬回伺服器；那時再說。

(function () {
  'use strict';

  var Rules = window.Rules;

  var Status = {
    AWAITING_ANSWER: 'awaitingAnswer',
    BETWEEN_QUESTIONS: 'betweenQuestions',
    STAGE_CLEARED: 'stageCleared',
    STAGE_FAILED: 'stageFailed',
    FINISHED: 'finished',
  };

  /**
   * 一場遊戲的設定全部走這一個物件——語種、題數、模式是玩家開場挑的，
   * 三個都當參數傳進來，而不是從 Rules 讀死值。
   *
   * @param {Object} options
   * @param {'stage'|'speed'|'combo'} options.mode 玩法
   * @param {{tracks: Array, decoys: Array}} options.bank 題庫
   * @param {string[]} options.languages 玩家勾選的語種，至少一個
   * @param {number} options.questionCount 闖關＝每關題數；競速／積分＝整場題數
   * @param {function(): number} [options.rng] 亂數來源（測試用）
   * @param {function(): number} [options.now] 回傳「現在幾秒」（測試用）
   */
  function Game(options) {
    options = options || {};

    this.mode = options.mode;
    this.languages = Rules.orderLanguages(options.languages);
    this.questionCount = options.questionCount || Rules.QUESTIONS_PER_ROUND;
    this.maker = new window.QuestionMaker(options.bank, options.rng);
    this.now = options.now || function () {
      return performance.now() / 1000;
    };

    // 關卡表在開場就定好：關數與門檻都跟著玩家的選擇跑，
    // 中途不會變，畫面可以直接讀 stages 畫進度。
    this.stages = this.mode === 'stage'
      ? Rules.stagesFor(this.languages, this.questionCount, this.mode)
      : [];
    this.stageCount = this.stages.length;

    this.stage = this.mode === 'stage' ? 1 : 0;
    this.status = Status.BETWEEN_QUESTIONS;
    this.answered = 0;
    this.roundScore = 0;
    this.totalScore = 0;
    this.records = [];

    this.streak = 0;
    this.multiplier = Rules.multiplierFor(1);

    this.used = {};
    this.guaranteed = [];
    this.current = null;
    this.issuedAt = 0;

    /**
     * 已經生出來、還沒輪到的題目。
     *
     * 存在的理由是音檔：Apple 的試聽一首約 1 MB，抓下來要兩三秒。
     * 等按下「下一題」才知道要放哪一首的話，中間就是一段沒有聲音的空白。
     * 先把題目生出來，畫面層就能在當題還在播的時候去預載下一題的音檔。
     */
    this.queue = [];

    this.prepareRound();
  }

  Game.Status = Status;

  /** 這一關的規則；競速與積分模式沒有關卡規則。 */
  Game.prototype.currentStage = function () {
    return this.mode === 'stage' ? this.stages[this.stage - 1] : null;
  };

  Game.prototype.activeLanguages = function () {
    var stage = this.currentStage();
    return stage ? stage.languages : this.languages;
  };

  /**
   * 出下一題。整場已結束、或題庫湊不出題時回 null。
   */
  Game.prototype.nextQuestion = function () {
    if (this.status === Status.FINISHED || this.status === Status.STAGE_FAILED) return null;
    if (this.answered >= this.questionCount) return null;

    // 先用排隊中的。沒有就現生——預載只是加速，不是必要條件。
    var question = this.queue.shift() || this.makeQuestion();
    if (!question) return null;

    this.current = question;
    this.issuedAt = this.now();
    this.status = Status.AWAITING_ANSWER;
    return this.view(question);
  };

  /**
   * 生一題出來並記帳（用過的歌、保證出現的語種），但**不**開始計時。
   *
   * 記帳必須在生的時候做，不能等到輪到它才做：否則排隊中的兩題可能是同一首歌。
   */
  Game.prototype.makeQuestion = function () {
    // 已經生出來的題數（答完的 ＋ 排隊中的）。保證出現的語種要照這個算，
    // 用 answered 的話會把排隊中的那幾題當成還沒出，然後太早塞保證題。
    var issued = this.answered + this.queue.length;

    var mustBe = null;
    if (this.guaranteed.length > 0 &&
        this.questionCount - issued <= this.guaranteed.length) {
      mustBe = this.guaranteed[0];
    }

    var question = this.maker.next(this.activeLanguages(), this.used, mustBe) ||
                   this.maker.next(this.activeLanguages(), this.used, null);
    if (!question) return null;

    this.used[question.answer.id] = true;

    var at = this.guaranteed.indexOf(question.answer.language);
    if (at !== -1) this.guaranteed.splice(at, 1);

    return question;
  };

  /**
   * 預先生一題放進隊伍，回傳它（畫面層只拿 answer.previewUrl 去預載音檔）。
   * 不能預生的時候回 null。
   */
  Game.prototype.prepare = function () {
    if (this.status !== Status.AWAITING_ANSWER) return null;
    if (this.answered + 1 + this.queue.length >= this.questionCount) return null;

    // **這一關的最後一題不預生下一題。**
    // 答完它可能過關，而過關會換一組語種、重設「保證出現」的清單——
    // 先生出來的那一題屬於上一關，語種是錯的。
    // 判斷寫成 answered + 1：現在這一題還沒答，answered 還沒加上它。
    //
    // 目前這一行其實碰不到：上面那道 `answered + 1 + queue.length >= questionCount`
    // 已經先攔掉了（queue.length 不會是負的）。留著是因為它攔的是**不同的理由**
    // ——上面那道管「總題數」，這一道管「關卡邊界」。哪天上面那道放寬了
    // （例如允許跨題數預生），這一道就是唯一的防線。
    if (this.mode === 'stage' && this.answered + 1 >= this.questionCount) return null;

    var question = this.makeQuestion();
    if (!question) return null;

    this.queue.push(question);
    return question;
  };

  /**
   * 先把接下來的幾題生出來，但**都不要開始**。
   *
   * 給開場預備用：要先知道是哪幾首才抓得到音檔，但這時候還不能起算作答時間。
   * 生出來的排在隊伍裡，nextQuestion() 會照順序拿到同樣這幾題。
   *
   * 和 prepare() 的差別：prepare() 是「這一題在播的時候順手多生一題」，
   * 所以它要求狀態是「等作答中」——開場時還沒有任何一題，狀態不符，它會回 null。
   * 開場預備一度只囤到一首就是因為誤用了它。
   */
  Game.prototype.peek = function (count) {
    var want = Math.min(count || 1, this.questionCount - this.answered);

    while (this.queue.length < want) {
      var question = this.makeQuestion();
      if (!question) break;
      this.queue.push(question);
    }

    return this.queue.slice(0, want);
  };

  /**
   * 已經生好、還沒輪到的題數。
   *
   * 畫面層要靠它決定「還要不要再預生一題」。少了這個就只能盲目地每題固定
   * 呼叫 prepare() 兩次，但一題只消耗一題——隊伍每題淨增一格，預載視窗
   * 會一路漂到整場的最後一題。實測二十題的一場把二十首全抓下來了，
   * 而且有六題的音檔在播到之前就被回收，回退去連遠端。
   */
  Game.prototype.pendingCount = function () {
    return this.queue.length;
  };

  /**
   * 把這一題的碼表歸零。
   *
   * 出題的當下就起算，等於把「音檔從 Apple 載下來的時間」算進玩家的作答時間——
   * 網路慢的人先天少分，而且他永遠不知道自己輸在哪。自己跟自己比還好（同一支手機
   * 大致公平），但排行榜是跨裝置比的，那就變成拿網速當實力。
   * 所以播放端要在音樂真的響起來的時候呼叫這個，十二秒從那一刻才開始。
   */
  Game.prototype.restartClock = function () {
    if (this.status !== Status.AWAITING_ANSWER) return;
    this.issuedAt = this.now();
  };

  /**
   * 作答。choiceId 傳 null 代表時間到都沒選。
   */
  Game.prototype.answer = function (choiceId) {
    if (this.status !== Status.AWAITING_ANSWER || !this.current) {
      throw new Error('現在沒有等待作答的題目。');
    }

    var elapsed = Math.max(0, this.now() - this.issuedAt);
    var correct = choiceId !== null && choiceId === this.current.answerId;
    var gained = this.mode === 'combo'
      ? Rules.comboScoreFor(correct, elapsed, this.streak + 1)
      : Rules.scoreFor(correct, elapsed);
    var answer = this.current;

    // 拿到分就算連對延續；逾時才答對是零分，連對一樣斷掉。
    this.setStreak(gained > 0 ? this.streak + 1 : 0);

    this.roundScore += gained;
    this.totalScore += gained;
    this.answered++;
    this.records.push({
      title: answer.answer.title,
      artist: answer.answer.artist,
      language: answer.answer.language,
      previewUrl: answer.answer.previewUrl,
      correct: correct,
      gained: gained,
      seconds: Math.round(elapsed * 10) / 10,
    });

    this.current = null;

    // 回報的是「剛剛打完的那一關」，所以在關卡推進之前先抄下來。
    var playedStage = this.stage;
    var playedScore = this.roundScore;
    var stageRule = this.currentStage();
    var threshold = stageRule ? stageRule.scoreToClear : 0;

    this.status = this.answered >= this.questionCount
      ? this.closeRound()
      : Status.BETWEEN_QUESTIONS;

    // 過關就當場推進，不要等到下次出題才算——否則在「過關」與「出下一題」
    // 之間，stage 講的是上一關，任何讀它的人都會慢一拍。
    if (this.status === Status.STAGE_CLEARED) {
      this.stage++;
      this.prepareRound();
    }

    return {
      correct: correct,
      correctChoiceId: answer.answerId,
      correctLabel: window.labelOf(answer.answer),
      gained: gained,
      roundScore: playedScore,
      totalScore: this.totalScore,
      status: this.status,
      stage: playedStage,
      stageCount: this.stageCount,
      scoreToClear: threshold,
      streak: this.streak,
      multiplier: this.multiplier,
    };
  };

  /**
   * 連對數與倍率一起更新。multiplier 講的是「下一題答對能拿幾倍」，
   * 所以出題時讀到的就是這一題的倍率，不必自己算。
   */
  Game.prototype.setStreak = function (streak) {
    this.streak = streak;
    this.multiplier = Rules.multiplierFor(streak + 1);
  };

  /** 一關（或一場）打完了，看是過關、失敗還是整場結束。 */
  Game.prototype.closeRound = function () {
    if (this.mode !== 'stage') return Status.FINISHED;

    var stage = this.stages[this.stage - 1];
    if (this.roundScore < stage.scoreToClear) return Status.STAGE_FAILED;
    return this.stage >= this.stageCount ? Status.FINISHED : Status.STAGE_CLEARED;
  };

  /**
   * 一關開打前的歸零。刻意不動 status——
   * 過關的那一刻狀態必須留著讓畫面看見「你過關了」，不能被歸零蓋掉。
   */
  Game.prototype.prepareRound = function () {
    this.answered = 0;
    this.roundScore = 0;
    this.guaranteed = [];

    // 換關的時候把排隊中的清掉。照 prepare() 的規則這裡本來就該是空的
    // （最後一題不預生），但萬一哪天規則改了，留著上一關的題目是最難查的那種錯。
    this.queue = [];

    var stage = this.currentStage();
    if (stage && stage.unlocks) this.guaranteed.push(stage.unlocks);
  };

  Game.prototype.view = function (question) {
    var stage = this.currentStage();
    return {
      number: this.answered + 1,
      total: this.questionCount,
      stage: this.stage,
      stageCount: this.stageCount,
      stageLabel: stage ? '第 ' + this.stage + ' 關' : null,
      scoreToClear: stage ? stage.scoreToClear : 0,
      seconds: Rules.QUESTION_SECONDS,
      previewUrl: question.answer.previewUrl,
      /** 從試聽的哪裡開始放（0～1）。同一顆種子會得到同一個值，多人才會聽到同一段。 */
      offset: question.offset,
      choices: question.choices,
      streak: this.streak,
      multiplier: this.multiplier,
    };
  };

  window.Game = Game;
})();
