// 0) グローバルデータ（後で JSON から読み込む）
let questions = [];

// 1) 画面部品の取得
const questionImage = document.getElementById("questionImage");
const answerInput = document.getElementById("answerInput");
const checkBtn = document.getElementById("checkBtn");
const nextBtn = document.getElementById("nextBtn");
const feedback = document.getElementById("feedback");

// 四角の枠のコンテナ
const answerBoxes = document.getElementById("answerBoxes");

// 2) 状態
let currentIndex = 0;
let currentBoxes = [];          // 一文字ごとの枠の配列
let hasCheckedCurrent = false;  // この問題をすでに判定したかどうか
let attemptPhase = 1;           // 1回目: ヒントあり, 2回目: ヒントなし

// ラウンド用の順序 + 復習キュー
let baseOrder = [];             // ベースとなるランダム順（問題インデックスの配列）
let basePos = 0;                // baseOrder の次に読む位置
let reviewQueue = [];           // 間違えた問題のインデックスをためておくキュー

// 3) ユーティリティ：配列シャッフル
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ベース順を新しく作る（全問題インデックスをランダムに並べる）
function makeNewBaseOrder() {
  baseOrder = [];
  for (let i = 0; i < questions.length; i++) {
    baseOrder.push(i);
  }
  shuffle(baseOrder);
  basePos = 0;
}

// ベース順が妥当か確認し、必要なら再生成
function ensureBaseOrder() {
  if (!Array.isArray(baseOrder) || baseOrder.length !== questions.length || baseOrder.length === 0) {
    makeNewBaseOrder();
  }
  if (basePos >= baseOrder.length) {
    makeNewBaseOrder();
  }
}

// ベース順から 1 問選ぶ（可能なら avoidIndex を避ける）
function pickFromBaseOrder(avoidIndex) {
  ensureBaseOrder();

  if (questions.length === 1) {
    // 1問しかない場合は avoid できない
    const val = baseOrder[basePos];
    basePos = (basePos + 1) % baseOrder.length;
    return val;
  }

  // basePos 以降で avoidIndex 以外のものを探し、見つけたら basePos と入れ替えて取得
  for (let i = basePos; i < baseOrder.length; i++) {
    const idx = baseOrder[i];
    if (idx === avoidIndex) continue;

    // basePos と i をスワップして basePos の要素を使う
    const tmp = baseOrder[basePos];
    baseOrder[basePos] = baseOrder[i];
    baseOrder[i] = tmp;

    const val = baseOrder[basePos];
    basePos++;
    return val;
  }

  // どうしても avoidIndex しか残っていない場合はそれを使う
  const val = baseOrder[basePos];
  basePos++;
  return val;
}

// 復習キューから 1 問選ぶ（avoidIndex はできるだけ避ける）
// avoidIndex しかない場合は null を返し、今回は使わない
function pickFromReviewQueue(avoidIndex) {
  if (reviewQueue.length === 0) return null;

  const allowedPositions = [];
  for (let i = 0; i < reviewQueue.length; i++) {
    if (reviewQueue[i] !== avoidIndex) {
      allowedPositions.push(i);
    }
  }

  if (allowedPositions.length === 0) {
    // 全て avoidIndex なので、今回は使わず null
    return null;
  }

  const randomPosIndex = Math.floor(Math.random() * allowedPositions.length);
  const pickIdx = allowedPositions[randomPosIndex];
  const val = reviewQueue[pickIdx];
  reviewQueue.splice(pickIdx, 1); // 取り出した要素をキューから削除

  return val;
}

// 次に出す問題インデックスを決める
// ・復習 vs 新規 = 40% vs 60% で選択
// ・avoidIndex（直前の問題）は可能な限り避ける
function getNextIndex(avoidIndex) {
  const hasReview = reviewQueue.length > 0;

  if (!hasReview) {
    // 復習がない場合はベース順から
    return pickFromBaseOrder(avoidIndex);
  }

  // 0〜1の乱数
  const r = Math.random();
  const useReview = (r < 0.4); // 40% の確率で復習優先

  if (useReview) {
    const fromReview = pickFromReviewQueue(avoidIndex);
    if (fromReview !== null) {
      return fromReview;
    }
    // 避けるべきものしかない場合はベース順にフォールバック
    return pickFromBaseOrder(avoidIndex);
  } else {
    return pickFromBaseOrder(avoidIndex);
  }
}

// 4) 初期化：questions.json を読み込む
async function init() {
  try {
    const res = await fetch("questions.json");
    questions = await res.json();

    if (!Array.isArray(questions) || questions.length === 0) {
      feedback.textContent = "Keine Fragen gefunden.";
      return;
    }

    // ラウンド用ベース順を初期化し、最初の問題を決定
    makeNewBaseOrder();
    currentIndex = pickFromBaseOrder(null);
    attemptPhase = 1;
    loadQuestion(currentIndex);
  } catch (err) {
    console.error(err);
    feedback.textContent = "Fehler beim Laden der Fragen.";
  }
}

// 5) 正解となる文字列をもとに、四角の枠を並べる
function buildAnswerBoxes(answerTemplate) {
  answerBoxes.innerHTML = "";
  currentBoxes = [];

  for (const ch of answerTemplate) {
    if (ch === " ") {
      // スペース部分（冠詞と名詞のあいだ）は空白として扱う
      const span = document.createElement("span");
      span.className = "box box-space";
      answerBoxes.appendChild(span);
      currentBoxes.push(span);
    } else {
      const span = document.createElement("span");
      span.className = "box";
      span.textContent = ""; // 最初は空
      answerBoxes.appendChild(span);
      currentBoxes.push(span);
    }
  }
}

// 6) 表示更新（問題を表示するときに枠を作り、必要ならヒントを入れる）
function loadQuestion(index) {
  if (!questions.length) return; // まだ読み込み中など

  const q = questions[index];
  const answerTemplate = q.answers[0]; // 例: "der Bär"

  questionImage.src = `images/${q.img}`;
  feedback.textContent = "";

  // 正解文字列をもとに四角の枠を作る
  buildAnswerBoxes(answerTemplate);

  // ヒント文字列を作成
  // attemptPhase = 1 のときだけ、
  // 「冠詞 + スペース + 名詞の最初の1文字」までを自動入力にする
  let hintText = "";

  if (attemptPhase === 1) {
    const spaceIndex = answerTemplate.indexOf(" ");

    if (spaceIndex >= 0 && spaceIndex < answerTemplate.length - 1) {
      // 例: "der Bär" -> "der B"
      hintText = answerTemplate.slice(0, spaceIndex + 2);
    } else if (answerTemplate.length > 0) {
      // スペースがない単語の場合は、先頭1文字だけ自動入力
      hintText = answerTemplate[0];
    }
  } else {
    // attemptPhase === 2 のときは完全ブランク
    hintText = "";
  }

  // 入力欄にヒント文字列を入れる（2回目は空文字）
  answerInput.value = hintText;

  // 入力済みの文字を四角の枠にも反映
  updateAnswerBoxesFromInput();

  // この問題はまだ判定していない状態にリセット
  hasCheckedCurrent = false;

  // カーソルを末尾に置いて、続きから入力できるようにする
  answerInput.focus();
  answerInput.setSelectionRange(
    answerInput.value.length,
    answerInput.value.length
  );
}

// 7) 入力の正規化（スペースは１つにまとめる）
function normalize(text) {
  return text
    .trim()               // 前後の空白を削除
    .replace(/\s+/g, " ") // 中のスペースやタブがいくつあっても「半角スペース１つ」に
    .toLowerCase();
}

// 8) 正誤判定
function checkAnswer() {
  if (!questions.length) return; // 念のためガード

  const q = questions[currentIndex];
  const user = normalize(answerInput.value);

  const ok = q.answers.some((a) => normalize(a) === user);

  if (ok) {
    feedback.textContent = "Richtig!";
  } else {
    feedback.textContent = `Nicht ganz... Richtige Antwort: ${q.answers[0]}`;

    // フェーズ2（完全ブランク）のときに間違えたら、復習キューに2回分追加
    if (attemptPhase === 2) {
      reviewQueue.push(currentIndex);
      reviewQueue.push(currentIndex);
    }
  }

  // この問題は判定済み
  hasCheckedCurrent = true;
}

// 9) 次の問題へ
function nextQuestion() {
  if (!questions.length) return;

  if (attemptPhase === 1) {
    // 1回目のあと → 同じ単語で 2回目（ヒントなし）
    attemptPhase = 2;
    loadQuestion(currentIndex);
  } else {
    // 2回目のあと → 他の単語へ進み、また 1回目から
    const avoidIndex = currentIndex;
    attemptPhase = 1;
    currentIndex = getNextIndex(avoidIndex);
    loadQuestion(currentIndex);
  }
}

// 10) 入力欄の内容を四角の中に反映する
function updateAnswerBoxesFromInput() {
  const value = answerInput.value;

  for (let i = 0; i < currentBoxes.length; i++) {
    const span = currentBoxes[i];

    // スペース用の枠には文字を表示しない
    if (span.classList.contains("box-space")) {
      continue;
    }

    const c = value[i] || "";
    span.textContent = c;
  }
}

// 11) イベント
checkBtn.addEventListener("click", checkAnswer);
nextBtn.addEventListener("click", nextQuestion);

// Enterキーの挙動：
// 1回目の Enter -> 判定
// 同じ問題で 2回目の Enter -> 次の問題（= 1回目⇔2回目の切り替え）
answerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (!hasCheckedCurrent) {
      checkAnswer();
    } else {
      nextQuestion();
    }
  }
});

// 入力のたびに四角を更新
answerInput.addEventListener("input", updateAnswerBoxesFromInput);

// 12) ページ読み込み時に初期化を実行
document.addEventListener("DOMContentLoaded", init);
