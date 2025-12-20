// 0) グローバルデータ（後で JSON から読み込む）
let questions = [];

// 1) 画面部品の取得
const questionImage = document.getElementById("questionImage");
const answerInput = document.getElementById("answerInput");
const checkBtn = document.getElementById("checkBtn");
const feedback = document.getElementById("feedback");
const answerBoxes = document.getElementById("answerBoxes");
const soundToggle = document.getElementById("soundToggle");


// 追加：カウンター表示
const wordCounter = document.getElementById("wordCounter");
const correctCounter = document.getElementById("correctCounter");
const wrongCounter = document.getElementById("wrongCounter");

// 2) 状態
let currentIndex = 0;
let currentBoxes = [];          // 一文字ごとの枠の配列
let hasCheckedCurrent = false;  // この問題をすでに判定したかどうか
let attemptPhase = 1;           // 1回目: ヒントあり, 2回目: ヒントなし

// 追加：タイプした単語数（= フェーズ2まで完了した単語数）
let typedWordCount = 0;
let correctCount = 0;    // Richtig（フェーズ2の正解数）
let wrongCount = 0;      // Falsch（フェーズ2の誤答数）

// ラウンド用の順序 + 復習キュー
let baseOrder = [];             // ベースとなるランダム順（問題インデックスの配列）
let basePos = 0;                // baseOrder の次に読む位置
let reviewQueue = [];           // 間違えた問題のインデックスをためておくキュー

let soundEnabled = true;
let audioCtx = null;

function updateCounters() {
  if (wordCounter) wordCounter.textContent = `Wörter: ${typedWordCount}`;
  if (correctCounter) correctCounter.textContent = `Richtig: ${correctCount}`;
  if (wrongCounter) wrongCounter.textContent = `Falsch: ${wrongCount}`;
}

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

// サウンド関数を追加
function ensureAudio() {
  if (!soundEnabled) return;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
}

function playTone(freq, durationSec, type, gainValue) {
  if (!soundEnabled) return;
  ensureAudio();
  if (!audioCtx) return;

  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainValue, t0 + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(t0);
  osc.stop(t0 + durationSec);
}

function playKeyClick() { playTone(1800, 0.02, "square", 0.04); }
function playBackspace() { playTone(500, 0.03, "square", 0.03); }
function playSuccess() {
  playTone(880, 0.07, "sine", 0.05);
  setTimeout(() => playTone(1320, 0.07, "sine", 0.05), 70);
}
function playError() { playTone(180, 0.12, "sawtooth", 0.03); }


// ベース順から 1 問選ぶ（可能なら avoidIndex を避ける）
function pickFromBaseOrder(avoidIndex) {
  ensureBaseOrder();

  if (questions.length === 1) {
    const val = baseOrder[basePos];
    basePos = (basePos + 1) % baseOrder.length;
    return val;
  }

  for (let i = basePos; i < baseOrder.length; i++) {
    const idx = baseOrder[i];
    if (idx === avoidIndex) continue;

    const tmp = baseOrder[basePos];
    baseOrder[basePos] = baseOrder[i];
    baseOrder[i] = tmp;

    const val = baseOrder[basePos];
    basePos++;
    return val;
  }

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
    return null;
  }

  const randomPosIndex = Math.floor(Math.random() * allowedPositions.length);
  const pickIdx = allowedPositions[randomPosIndex];
  const val = reviewQueue[pickIdx];
  reviewQueue.splice(pickIdx, 1);

  return val;
}

// 次に出す問題インデックスを決める（新規60% / 復習40%）
function getNextIndex(avoidIndex) {
  const hasReview = reviewQueue.length > 0;

  if (!hasReview) {
    return pickFromBaseOrder(avoidIndex);
  }

  const r = Math.random();
  const useReview = (r < 0.4); // 復習 40%

  if (useReview) {
    const fromReview = pickFromReviewQueue(avoidIndex);
    if (fromReview !== null) return fromReview;
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

    // 追加：カウンター初期化
    typedWordCount = 0;
    correctCount = 0;
    wrongCount = 0;
    updateCounters();
    
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
      const span = document.createElement("span");
      span.className = "box box-space";
      answerBoxes.appendChild(span);
      currentBoxes.push(span);
    } else {
      const span = document.createElement("span");
      span.className = "box";
      span.textContent = "";
      answerBoxes.appendChild(span);
      currentBoxes.push(span);
    }
  }
}

// 6) 表示更新
function loadQuestion(index) {
  if (!questions.length) return;

  const q = questions[index];
  const answerTemplate = q.answers[0];

  questionImage.src = `images/${q.img}`;
  feedback.textContent = "";

  buildAnswerBoxes(answerTemplate);

  let hintText = "";

  if (attemptPhase === 1) {
    const spaceIndex = answerTemplate.indexOf(" ");
    if (spaceIndex >= 0 && spaceIndex < answerTemplate.length - 1) {
      hintText = answerTemplate.slice(0, spaceIndex + 2); // "der B"
    } else if (answerTemplate.length > 0) {
      hintText = answerTemplate[0];
    }
  } else {
    hintText = "";
  }

  answerInput.value = hintText;
  updateAnswerBoxesFromInput();

  hasCheckedCurrent = false;
  updateActionButtonLabel();

  answerInput.focus();
  answerInput.setSelectionRange(
    answerInput.value.length,
    answerInput.value.length
  );
}

// 7) 入力の正規化
function normalize(text) {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function handleAction() {
  if (!hasCheckedCurrent) {
    checkAnswer();
  } else {
    nextQuestion();
  }
}

// 8) 正誤判定
function checkAnswer() {
  if (!questions.length) return;

  // 同じフェーズで二重カウントしない
  if (hasCheckedCurrent) return;

  const q = questions[currentIndex];
  const user = normalize(answerInput.value);
  const ok = q.answers.some((a) => normalize(a) === user);

  if (ok) {
    feedback.textContent = "Richtig!";
    if (typeof playSuccess === "function") playSuccess();
  } else {
    feedback.textContent = `Nicht ganz... Richtige Antwort: ${q.answers[0]}`;
    if (typeof playError === "function") playError();

    // フェーズ2で間違えたら復習キューに2回
    if (Number(attemptPhase) === 2) {
      reviewQueue.push(currentIndex);
      reviewQueue.push(currentIndex);
    }
  }

  // 案1：フェーズ2の判定結果だけを集計
  if (Number(attemptPhase) === 2) {
    typedWordCount++;
    if (ok) {
      correctCount++;
    } else {
      wrongCount++;
    }
    if (typeof updateCounters === "function") updateCounters();
  }

  hasCheckedCurrent = true;

  // 1ボタン化しているなら、表示を Prüfen / Nächstes に切替
  if (typeof updateActionButtonLabel === "function") updateActionButtonLabel();
}

  function handleAction() {
  if (!hasCheckedCurrent) {
    checkAnswer();
  } else {
    nextQuestion();
  }
}

function updateActionButtonLabel() {
  // 判定前：Prüfen / 判定後：Nächstes
  checkBtn.textContent = hasCheckedCurrent ? "Nächstes" : "Prüfen";
  // もし表記を Pruefen/Naechstes にしたい場合：
  // checkBtn.textContent = hasCheckedCurrent ? "Naechstes" : "Pruefen";
}

  // 追加：フェーズ2で判定したら「単語をタイプした数」を +1
  if (attemptPhase === 2) {
    typedWordCount++;
    updateCounters();
  }

  hasCheckedCurrent = true;
  updateActionButtonLabel();


// 9) 次の問題へ
function nextQuestion() {
  if (!questions.length) return;

  if (attemptPhase === 1) {
    attemptPhase = 2;
    loadQuestion(currentIndex);
  } else {
    const avoidIndex = currentIndex;
    attemptPhase = 1;
    currentIndex = getNextIndex(avoidIndex);
    loadQuestion(currentIndex);
  }
}

// 10) 四角表示更新
function updateAnswerBoxesFromInput() {
  const value = answerInput.value;

  for (let i = 0; i < currentBoxes.length; i++) {
    const span = currentBoxes[i];

    if (span.classList.contains("box-space")) continue;

    const c = value[i] || "";
    span.textContent = c;
  }
}

// 11) イベント
checkBtn.addEventListener("click", handleAction);


// ★ここに追加（トグル反映）
if (soundToggle) {
  soundEnabled = soundToggle.checked;
  soundToggle.addEventListener("change", () => {
    soundEnabled = soundToggle.checked;
    if (soundEnabled) ensureAudio();
  });
}

answerInput.addEventListener("keydown", (e) => {
  // キーリピート（押しっぱなし）で音が連打されるのを避ける
  if (e.repeat) return;

  // 修飾キー付きは音を鳴らさない（Cmd+C など）
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // Backspace
  if (e.key === "Backspace") {
    playBackspace();
    return; // 入力処理はブラウザに任せる
  }

  // Enter（判定→次へ）
  if (e.key === "Enter") {
    handleAction();
    return;
  }

  // 1文字キー（文字・数字・記号・スペース等）
  // iPad外付けキーボードでは e.key が "a" や "ä" や " " のようになります
  if (typeof e.key === "string" && e.key.length === 1) {
    playKeyClick();
  }
});

answerInput.addEventListener("input", updateAnswerBoxesFromInput);

// 12) 初期化
document.addEventListener("DOMContentLoaded", init);

document.addEventListener("pointerdown", () => {
  ensureAudio();
}, { once: true });

