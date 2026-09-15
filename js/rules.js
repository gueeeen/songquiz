// 規則與數字全部集中在這一個檔案。要調難度就改這裡，不必翻遍狀態機。
//
// 刻意不用 ES module：這個站要能「雙擊 index.html 直接玩」，
// 而 file:// 下的 type="module" 會被瀏覽器的 CORS 規則擋掉。
// 所以一律是傳統 script，各自掛一個全域名稱。

(function () {
  'use strict';

  /**
   * 語種。這個順序就是闖關模式的難度順序（華語最熟、日語最生），
   * 所以玩家勾選的語種一律照這個順序重排，不照他勾選的先後。
   */
  var LANGUAGES = ['mandarin', 'taiwanese', 'western', 'korean', 'japanese'];

  var LANGUAGE_NAMES = {
    mandarin: '華語',
    taiwanese: '台語',
    western: '西洋',
    korean: '韓語',
    japanese: '日語',
  };

  var QUESTION_SECONDS = 12;

  /** 題數的預設值。實際題數由玩家挑，狀態機一律吃 questionCount。 */
  var QUESTIONS_PER_ROUND = 10;

  var QUESTION_COUNT_CHOICES = [5, 10, 15, 20];

  /**
   * 積分模式的題數選項。
   *
   * 它和另外兩個模式不同：闖關與競速是「一場有明確的長度」，
   * 而積分是「連對能連多久」——那本質上是一條可以一直往下猜的路，
   * 所以題數開到 80。80 是題庫撐得住的上限（單語種最少 72 首），
   * 再多就會出現「湊不出題」而不是「玩到累」。
   */
  var COMBO_COUNT_CHOICES = [10, 20, 40, 60, 80];

  /** 這個模式可以挑哪些題數。 */
  function questionCountsFor(mode) {
    return mode === 'combo' ? COMBO_COUNT_CHOICES : QUESTION_COUNT_CHOICES;
  }

  /** 題數不在這個模式的清單裡時，挑一個最接近的——不要默默給一個離很遠的值。 */
  function nearestCountFor(mode, count) {
    var choices = questionCountsFor(mode);
    if (choices.indexOf(count) !== -1) return count;

    // 一樣近的時候往大的靠（15 在 10 和 20 之間，取 20）：
    // 題數變多只是玩久一點，變少是把人原本想玩的量砍掉，後者比較討人厭。
    return choices.reduce(function (best, option) {
      return Math.abs(option - count) <= Math.abs(best - count) ? option : best;
    }, choices[0]);
  }

  /** 答對的保底分。答對就算只剩一瞬間也拿得到。 */
  var BASE_SCORE = 500;

  /** 按剩餘時間給的獎勵上限。單題滿分 = 保底＋獎勵 = 1000。 */
  var SPEED_BONUS = 500;

  /** 積分模式的單題底分，乘上連對倍率就是該題分數。 */
  var COMBO_BASE = 500;

  /** 連對倍率的上限。再連下去也不會超過這個數，免得一場的勝負只由前幾題決定。 */
  var COMBO_MAX_MULTIPLIER = 5;

  /** 每題幾個選項。 */
  var CHOICE_COUNT = 9;

  /** 過關門檻佔該關滿分的比例：第一關四成、最後一關九成，中間線性插值。 */
  var CLEAR_RATIO_FIRST = 0.4;
  var CLEAR_RATIO_LAST = 0.9;

  /** 只有一關（玩家只挑一個語種）時沒有「由易到難」可言，取中間值當門檻。 */
  var CLEAR_RATIO_SOLO = 0.6;

  /**
   * 這一題得幾分（闖關／競速）。答錯、逾時、沒作答都是零分——沒有部分給分。
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

  /**
   * 積分模式的單題分數。刻意不看 elapsedSeconds 的多寡——
   * 這個模式要獎勵的是「連續答對」，秒答和拖到第十一秒答對同分，
   * 十二秒只是「還算不算答到」的界線。
   *
   * @param {boolean} correct 答對了嗎
   * @param {number} elapsedSeconds 從出題到作答經過幾秒
   * @param {number} streak 算進這一題之後的連對數（1-based：這是第幾連對）
   */
  function comboScoreFor(correct, elapsedSeconds, streak) {
    if (!correct) return 0;
    if (elapsedSeconds >= QUESTION_SECONDS) return 0;

    return COMBO_BASE * multiplierFor(streak);
  }

  /** 第 streak 連對的倍率。1-based，封頂在 COMBO_MAX_MULTIPLIER。 */
  function multiplierFor(streak) {
    return Math.min(Math.max(streak, 1), COMBO_MAX_MULTIPLIER);
  }

  /** 這個模式單題最多拿幾分。用來把過關門檻換算成絕對分數。 */
  function maxQuestionScoreFor(mode) {
    if (mode === 'combo') return COMBO_BASE * COMBO_MAX_MULTIPLIER;
    return BASE_SCORE + SPEED_BONUS;
  }

  /**
   * 把玩家勾選的語種去重、並照 LANGUAGES 的難度順序重排。
   * 勾選的先後對難度沒有意義，先勾日語不代表日語該當第一關。
   */
  function orderLanguages(languages) {
    var chosen = languages && languages.length ? languages : LANGUAGES;
    return LANGUAGES.filter(function (language) {
      return chosen.indexOf(language) !== -1;
    });
  }

  /**
   * 這一場的關卡表。k 個語種 → k + 1 關，最後一關是全語種總決賽；
   * k = 1 時沒有「累積解鎖」可演，就只有一關。
   *
   * 第 i 關開放 languages[0 .. i-1]（累積解鎖），第 i 關（i ≥ 2）新解鎖
   * languages[i-1]，而新解鎖的語種保證至少出一題（見 game.js 的 guaranteed）——
   * 否則某一關解鎖了西洋歌，玩家卻可能整關都在聽華語，這一關等於沒有意義。
   *
   * @param {string[]} languages 玩家勾選的語種（會自動重排）
   * @param {number} questionCount 每關幾題
   * @param {string} [mode] 算門檻用的模式，預設 'stage'
   */
  function stagesFor(languages, questionCount, mode) {
    var ordered = orderLanguages(languages);
    var count = questionCount || QUESTIONS_PER_ROUND;
    var stageCount = ordered.length === 1 ? 1 : ordered.length + 1;
    var perfect = maxQuestionScoreFor(mode || 'stage') * count;
    var stages = [];

    for (var i = 1; i <= stageCount; i++) {
      var isLast = i === stageCount;
      var ratio = stageCount === 1
        ? CLEAR_RATIO_SOLO
        : CLEAR_RATIO_FIRST + (CLEAR_RATIO_LAST - CLEAR_RATIO_FIRST) * (i - 1) / (stageCount - 1);

      stages.push({
        number: i,
        scoreToClear: Math.round(perfect * ratio),
        languages: isLast ? ordered.slice() : ordered.slice(0, i),
        unlocks: (i >= 2 && !isLast) ? ordered[i - 1] : null,
      });
    }

    return stages;
  }

  /**
   * 這個模式全對能拿幾分。畫面拿它當分母，不要自己乘。
   *
   * @param {'stage'|'speed'|'combo'} mode
   * @param {number} questionCount 闖關＝每關題數，其餘＝整場題數
   */
  function perfectScoreFor(mode, questionCount) {
    var count = questionCount || QUESTIONS_PER_ROUND;

    if (mode === 'combo') {
      var total = 0;
      for (var i = 1; i <= count; i++) total += COMBO_BASE * multiplierFor(i);
      return total;
    }

    // 闖關算的是「單關」滿分：整場滿分要幾關就乘幾關，那是畫面的事。
    return (BASE_SCORE + SPEED_BONUS) * count;
  }

  /** 題庫裡這些語種各有幾首可出題的歌。 */
  function countByLanguage(bank) {
    var counts = {};
    (bank && bank.tracks ? bank.tracks : []).forEach(function (track) {
      counts[track.language] = (counts[track.language] || 0) + 1;
    });
    return counts;
  }

  /**
   * 這一場湊得出題嗎。
   *
   * 同一場不重複出歌，所以闖關模式要算的是**整場**的需求量，
   * 而且每一關只能用「已解鎖」的語種——第二關湊不出來，第六關的歌再多也救不了。
   * 關卡的語種是層層包含的，所以逐關檢查「前 i 關的總需求 ≤ 第 i 關可用的歌數」
   * 就是完整的判準，不會漏報也不會誤報。
   *
   * 選「台語 + 每關 20 題」這種組合本來就湊不出來，寧可開打前講清楚，
   * 也不要玩到第三關才發現沒歌可出。
   *
   * @returns {{ok: boolean, needed: number, available: number, shortfall: Array}}
   */
  function capacityFor(bank, languages, questionCount, mode) {
    var ordered = orderLanguages(languages);
    var count = questionCount || QUESTIONS_PER_ROUND;
    var counts = countByLanguage(bank);
    var shortfall = [];

    function availableIn(list) {
      return list.reduce(function (sum, language) {
        return sum + (counts[language] || 0);
      }, 0);
    }

    // 一首歌都沒有的語種要單獨講：它過不了「保證至少出一題」，
    // 但整關的歌數可能被別的語種撐住，逐關檢查看不出來。
    ordered.forEach(function (language) {
      if (!counts[language]) {
        shortfall.push({
          stage: null,
          languages: [language],
          needed: 1,
          available: 0,
          missing: 1,
        });
      }
    });

    var needed = count;
    var available = availableIn(ordered);

    if (mode === 'stage') {
      var stages = stagesFor(ordered, count, mode);
      needed = stages.length * count;

      stages.forEach(function (stage) {
        var wanted = stage.number * count;
        var have = availableIn(stage.languages);
        if (wanted > have) {
          shortfall.push({
            stage: stage.number,
            languages: stage.languages.slice(),
            needed: wanted,
            available: have,
            missing: wanted - have,
          });
        }
      });
    } else if (needed > available) {
      shortfall.push({
        stage: null,
        languages: ordered.slice(),
        needed: needed,
        available: available,
        missing: needed - available,
      });
    }

    return {
      ok: shortfall.length === 0,
      needed: needed,
      available: available,
      shortfall: shortfall,
    };
  }

  window.Rules = {
    LANGUAGES: LANGUAGES,
    LANGUAGE_NAMES: LANGUAGE_NAMES,
    QUESTION_SECONDS: QUESTION_SECONDS,
    QUESTIONS_PER_ROUND: QUESTIONS_PER_ROUND,
    QUESTION_COUNT_CHOICES: QUESTION_COUNT_CHOICES,
    COMBO_COUNT_CHOICES: COMBO_COUNT_CHOICES,
    questionCountsFor: questionCountsFor,
    nearestCountFor: nearestCountFor,
    BASE_SCORE: BASE_SCORE,
    SPEED_BONUS: SPEED_BONUS,
    COMBO_BASE: COMBO_BASE,
    COMBO_MAX_MULTIPLIER: COMBO_MAX_MULTIPLIER,
    CHOICE_COUNT: CHOICE_COUNT,
    PERFECT_SCORE: (BASE_SCORE + SPEED_BONUS) * QUESTIONS_PER_ROUND,
    scoreFor: scoreFor,
    comboScoreFor: comboScoreFor,
    multiplierFor: multiplierFor,
    maxQuestionScoreFor: maxQuestionScoreFor,
    orderLanguages: orderLanguages,
    stagesFor: stagesFor,
    perfectScoreFor: perfectScoreFor,
    capacityFor: capacityFor,
    nameOf: function (language) {
      return LANGUAGE_NAMES[language] || language;
    },
  };
})();
