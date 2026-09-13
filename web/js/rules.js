// 規則與數字全部集中在這一個檔案。要調難度就改這裡，不必翻遍狀態機。
//
// 刻意不用 ES module：這個站要能「雙擊 index.html 直接玩」，
// 而 file:// 下的 type="module" 會被瀏覽器的 CORS 規則擋掉。
// 所以一律是傳統 script，各自掛一個全域名稱。

(function () {
  'use strict';

  /** 語種。闖關模式就是靠這個逐關擴充題庫範圍。 */
  var LANGUAGES = ['mandarin', 'taiwanese', 'western', 'korean', 'japanese'];

  var LANGUAGE_NAMES = {
    mandarin: '華語',
    taiwanese: '台語',
    western: '西洋',
    korean: '韓語',
    japanese: '日語',
  };

  var QUESTION_SECONDS = 12;
  var QUESTIONS_PER_ROUND = 10;

  /** 答對的保底分。答對就算只剩一瞬間也拿得到。 */
  var BASE_SCORE = 500;

  /** 按剩餘時間給的獎勵上限。滿分 =（保底＋獎勵）× 題數 = 10000。 */
  var SPEED_BONUS = 500;

  /** 每題幾個選項。 */
  var CHOICE_COUNT = 9;

  /**
   * 闖關模式的六關：要幾分才過得去、開放哪些語種、這一關新解鎖什麼。
   *
   * 新解鎖的語種從該關起「保證至少出一題」（見 game.js），
   * 否則第三關解鎖了西洋歌，玩家卻可能整關都在聽華語，這一關等於沒有意義。
   */
  var STAGES = [
    { number: 1, scoreToClear: 4000, languages: ['mandarin'], unlocks: null },
    { number: 2, scoreToClear: 5000, languages: ['mandarin', 'taiwanese'], unlocks: 'taiwanese' },
    { number: 3, scoreToClear: 6000, languages: ['mandarin', 'taiwanese', 'western'], unlocks: 'western' },
    { number: 4, scoreToClear: 7000, languages: ['mandarin', 'taiwanese', 'western', 'korean'], unlocks: 'korean' },
    { number: 5, scoreToClear: 8000, languages: ['mandarin', 'taiwanese', 'western', 'korean', 'japanese'], unlocks: 'japanese' },
    { number: 6, scoreToClear: 9000, languages: ['mandarin', 'taiwanese', 'western', 'korean', 'japanese'], unlocks: null },
  ];

  /**
   * 這一題得幾分。答錯、逾時、沒作答都是零分——沒有部分給分。
   *
   * @param {boolean} correct 答對了嗎
   * @param {number} elapsedSeconds 從出題到作答經過幾秒
   */
  function scoreFor(correct, elapsedSeconds) {
    if (!correct) return 0;
    if (elapsedSeconds >= QUESTION_SECONDS) return 0;

    var left = (QUESTION_SECONDS - elapsedSeconds) / QUESTION_SECONDS;
    return BASE_SCORE + Math.round(SPEED_BONUS * Math.min(Math.max(left, 0), 1));
  }

  window.Rules = {
    LANGUAGES: LANGUAGES,
    LANGUAGE_NAMES: LANGUAGE_NAMES,
    QUESTION_SECONDS: QUESTION_SECONDS,
    QUESTIONS_PER_ROUND: QUESTIONS_PER_ROUND,
    BASE_SCORE: BASE_SCORE,
    SPEED_BONUS: SPEED_BONUS,
    CHOICE_COUNT: CHOICE_COUNT,
    STAGE_COUNT: STAGES.length,
    STAGES: STAGES,
    PERFECT_SCORE: (BASE_SCORE + SPEED_BONUS) * QUESTIONS_PER_ROUND,
    scoreFor: scoreFor,
    nameOf: function (language) {
      return LANGUAGE_NAMES[language] || language;
    },
  };
})();
