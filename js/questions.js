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

  /**
   * 一個選項。label 仍然是那條「歌名 — 歌手」的字串，因為去重、比對答案、
   * 測試都靠它；title 與 artist 是額外帶出來的，給畫面分成兩行用。
   *
   * 為什麼不讓畫面自己去拆 label：歌名裡本來就可能有破折號
   * （題庫裡就有「Lose Yourself — Eminem」這種、也有歌名含「-」的），
   * 在畫面層拆字串遲早會把某一首歌的名字剖成兩半。
   */
  function optionOf(song) {
    return { label: labelOf(song), title: song.title, artist: song.artist };
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

    /**
     * 順序是：先挑語種 → 再挑「哪一格」 → 再挑歌。
     *
     * **語種要先挑，而且每個語種機會均等。** 原本是直接從混合的池子裡抽，
     * 等於按題庫大小加權——哪個語種的歌多就出得多，而那不是任何人想要的。
     * 選了三個語種就大約各三分之一，才是選項該有的意思。
     *
     * **「哪一格」是每個語種各一組比例，而且切的維度不一樣**（見 rules.js）：
     * 華語／台語／西洋按年代（兩成 2000 前、兩成今年、六成中間），
     * 日語九成簡單一成困難，韓語六三一。所以它一定要在語種之後決定——
     * 混著的池子沒有「這一題的年代」或「這一題的難度」可言。
     *
     * 這裡刻意不知道格子是按年代還是按難度切的，只問 rules.js「吃不吃這一首」。
     */
    var byLanguage = {};
    pool.forEach(function (track) {
      (byLanguage[track.language] = byLanguage[track.language] || []).push(track);
    });

    var picks = Object.keys(byLanguage);
    var language = picks[Math.floor(rng() * picks.length)];
    var mine = byLanguage[language];

    var slice = window.Rules.sliceFor(language, rng());

    // 那一格抽不到歌的時候（題數多、後面幾題把那一格用完了）就退回這個語種的
    // 整池。寧可比例偏掉一題，也不要出不了題——出不了題的下一步是整場結束。
    // 台語「今年」只有十幾首，長場次一定會走到這條退路。
    var sliced = mine.filter(function (t) { return window.Rules.sliceAccepts(slice, t); });
    var from = sliced.length > 0 ? sliced : mine;

    var answer = from[Math.floor(rng() * from.length)];
    var options = this.wrongOptions(answer);

    options.push(optionOf(answer));
    shuffle(options, rng);

    var choices = options.map(function (option, i) {
      return { id: i, label: option.label, title: option.title, artist: option.artist };
    });

    var answerLabel = labelOf(answer);
    var answerId = choices.filter(function (c) {
      return c.label === answerLabel;
    })[0].id;

    /**
     * 這一題要從試聽的哪裡開始放（0～1 的比例，實際秒數由播放端換算）。
     *
     * 為什麼在這裡產生：它必須跟著「出題」一起被決定，才能用同一顆種子重現——
     * 多人房間所有人要聽到同一段，而他們唯一共享的東西就是那顆種子。
     * 如果在播放的時候才 Math.random()，每台機器會聽到不同的片段。
     *
     * 為什麼是比例不是秒數：出題層不知道音檔多長（Apple 的試聽多半是 30 秒，
     * 但不保證），換算成秒數要等 metadata 載進來才知道，那是播放端的事。
     */
    return {
      answer: answer,
      choices: choices,
      answerId: answerId,
      offset: rng(),
    };
  };

  /**
   * 湊出八個錯誤選項：同語種的真歌優先，不足再拿同語種誘餌補，
   * 還是不足才放寬到其他語種——寧可干擾力差一點，
   * 也不要選項數量忽多忽少（那本身就是線索）。
   */
  QuestionMaker.prototype.wrongOptions = function (answer) {
    var rng = this.rng;
    var wanted = window.Rules.CHOICE_COUNT - 1;
    var taken = {};
    var wrong = [];

    taken[labelOf(answer)] = true;

    // 去重仍然以 label 為準：同一首歌在題庫與誘餌裡各有一份是常態。
    function fill(candidates) {
      shuffle(candidates, rng);
      for (var i = 0; i < candidates.length; i++) {
        if (wrong.length === wanted) return;
        var option = candidates[i];
        if (!taken[option.label]) {
          taken[option.label] = true;
          wrong.push(option);
        }
      }
    }

    var tracks = this.bank.tracks;
    var decoys = this.bank.decoys;

    fill(tracks.filter(function (t) {
      return t.language === answer.language && t.id !== answer.id;
    }).map(optionOf));

    fill(decoys.filter(function (d) {
      return d.language === answer.language;
    }).map(optionOf));

    fill(tracks.filter(function (t) {
      return t.id !== answer.id;
    }).map(optionOf));

    fill(decoys.map(optionOf));

    return wrong;
  };

  window.QuestionMaker = QuestionMaker;
  window.labelOf = labelOf;
  window.optionOf = optionOf;
})();
