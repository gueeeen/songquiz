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

    // 這一關新解鎖的語種要保證出現：剩餘題數不夠塞的時候就先塞它。
    var mustBe = null;
    if (this.guaranteed.length > 0 &&
        this.questionCount - this.answered <= this.guaranteed.length) {
      mustBe = this.guaranteed[0];
    }

    var question = this.maker.next(this.activeLanguages(), this.used, mustBe) ||
                   this.maker.next(this.activeLanguages(), this.used, null);
    if (!question) return null;

    this.current = question;
    this.issuedAt = this.now();
    this.used[question.answer.id] = true;

    var at = this.guaranteed.indexOf(question.answer.language);
    if (at !== -1) this.guaranteed.splice(at, 1);

    this.status = Status.AWAITING_ANSWER;
    return this.view(question);
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
      choices: question.choices,
      streak: this.streak,
      multiplier: this.multiplier,
    };
  };

  window.Game = Game;
})();
