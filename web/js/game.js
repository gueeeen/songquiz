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
   * @param {'stage'|'speed'} mode 玩法
   * @param {{tracks: Array, decoys: Array}} bank 題庫
   * @param {Object} [options] rng：亂數來源；now：回傳「現在幾秒」的函式（測試用）
   */
  function Game(mode, bank, options) {
    options = options || {};

    this.mode = mode;
    this.maker = new window.QuestionMaker(bank, options.rng);
    this.now = options.now || function () {
      return performance.now() / 1000;
    };

    this.stage = mode === 'stage' ? 1 : 0;
    this.status = Status.BETWEEN_QUESTIONS;
    this.answered = 0;
    this.roundScore = 0;
    this.totalScore = 0;
    this.records = [];

    this.used = {};
    this.guaranteed = [];
    this.current = null;
    this.issuedAt = 0;

    this.prepareRound();
  }

  Game.Status = Status;

  /** 這一關的規則；競速模式沒有關卡規則。 */
  Game.prototype.currentStage = function () {
    return this.mode === 'stage' ? Rules.STAGES[this.stage - 1] : null;
  };

  Game.prototype.activeLanguages = function () {
    var stage = this.currentStage();
    return stage ? stage.languages : Rules.LANGUAGES;
  };

  /**
   * 出下一題。整場已結束、或題庫湊不出題時回 null。
   */
  Game.prototype.nextQuestion = function () {
    if (this.status === Status.FINISHED || this.status === Status.STAGE_FAILED) return null;
    if (this.answered >= Rules.QUESTIONS_PER_ROUND) return null;

    // 這一關新解鎖的語種要保證出現：剩餘題數不夠塞的時候就先塞它。
    var mustBe = null;
    if (this.guaranteed.length > 0 &&
        Rules.QUESTIONS_PER_ROUND - this.answered <= this.guaranteed.length) {
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
    var gained = Rules.scoreFor(correct, elapsed);
    var answer = this.current;

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

    this.status = this.answered >= Rules.QUESTIONS_PER_ROUND
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
      scoreToClear: threshold,
    };
  };

  /** 一關（或一場）打完了，看是過關、失敗還是整場結束。 */
  Game.prototype.closeRound = function () {
    if (this.mode === 'speed') return Status.FINISHED;

    var stage = Rules.STAGES[this.stage - 1];
    if (this.roundScore < stage.scoreToClear) return Status.STAGE_FAILED;
    return this.stage >= Rules.STAGE_COUNT ? Status.FINISHED : Status.STAGE_CLEARED;
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
      total: Rules.QUESTIONS_PER_ROUND,
      stage: this.stage,
      stageLabel: stage ? '第 ' + this.stage + ' 關' : null,
      scoreToClear: stage ? stage.scoreToClear : 0,
      seconds: Rules.QUESTION_SECONDS,
      previewUrl: question.answer.previewUrl,
      choices: question.choices,
    };
  };

  window.Game = Game;
})();
