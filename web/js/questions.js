// 出題器：挑一首歌當答案，再湊足九個看起來一樣合理的選項。
//
// 錯誤選項的兩條規則，都是為了堵同一個漏洞——「用排除法猜」：
// 一、錯誤選項必須和答案同語種，否則一題裡混進兩首韓文歌就等於送分；
// 二、誘餌（不會被出題的歌名）要一起參與，否則玩久了會發現
//     「選項裡出現過的歌才可能是答案」。

(function () {
  'use strict';

  function labelOf(song) {
    return song.title + ' — ' + song.artist;
  }

  /** 原地洗牌（Fisher–Yates）。隨機源從外面傳進來，測試才能固定結果。 */
  function shuffle(items, rng) {
    for (var i = items.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  /**
   * @param {{tracks: Array, decoys: Array}} bank 題庫
   * @param {function(): number} [rng] 亂數來源，預設 Math.random
   */
  function QuestionMaker(bank, rng) {
    this.bank = bank;
    this.rng = rng || Math.random;
  }

  /**
   * 出一題。題庫湊不出來（歌都聽過了）就回 null，由呼叫方決定怎麼收尾。
   *
   * @param {string[]} languages 這一關開放的語種
   * @param {Object} usedIds 已經出過的歌，key 是 track id
   * @param {string} [mustBe] 指定答案的語種（用於「新解鎖語種保證出現」）
   */
  QuestionMaker.prototype.next = function (languages, usedIds, mustBe) {
    var rng = this.rng;
    var pool = this.bank.tracks.filter(function (t) {
      if (languages.indexOf(t.language) === -1) return false;
      if (usedIds[t.id]) return false;
      if (mustBe && t.language !== mustBe) return false;
      return true;
    });

    if (pool.length === 0) return null;

    var answer = pool[Math.floor(rng() * pool.length)];
    var labels = this.wrongLabels(answer);

    labels.push(labelOf(answer));
    shuffle(labels, rng);

    var choices = labels.map(function (label, i) {
      return { id: i, label: label };
    });

    var answerLabel = labelOf(answer);
    var answerId = choices.filter(function (c) {
      return c.label === answerLabel;
    })[0].id;

    return { answer: answer, choices: choices, answerId: answerId };
  };

  /**
   * 湊出八個錯誤選項：同語種的真歌優先，不足再拿同語種誘餌補，
   * 還是不足才放寬到其他語種——寧可干擾力差一點，
   * 也不要選項數量忽多忽少（那本身就是線索）。
   */
  QuestionMaker.prototype.wrongLabels = function (answer) {
    var rng = this.rng;
    var wanted = window.Rules.CHOICE_COUNT - 1;
    var taken = {};
    var wrong = [];

    taken[labelOf(answer)] = true;

    function fill(candidates) {
      shuffle(candidates, rng);
      for (var i = 0; i < candidates.length; i++) {
        if (wrong.length === wanted) return;
        var label = candidates[i];
        if (!taken[label]) {
          taken[label] = true;
          wrong.push(label);
        }
      }
    }

    var tracks = this.bank.tracks;
    var decoys = this.bank.decoys;

    fill(tracks.filter(function (t) {
      return t.language === answer.language && t.id !== answer.id;
    }).map(labelOf));

    fill(decoys.filter(function (d) {
      return d.language === answer.language;
    }).map(labelOf));

    fill(tracks.filter(function (t) {
      return t.id !== answer.id;
    }).map(labelOf));

    fill(decoys.map(labelOf));

    return wrong;
  };

  window.QuestionMaker = QuestionMaker;
  window.labelOf = labelOf;
})();
