const STORAGE_KEYS = {
  STATE: "quiz.state.v2",
};

const DATA_URL = "./questions.json";

function shuffle(array) {
  const arr = [...array];

  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

function formatTime(sec) {
  const minutes = Math.floor(sec / 60).toString().padStart(2, "0");
  const seconds = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

class QuizEngine {
  constructor(quiz) {
    this.title = quiz.title;
    this.timeLimitSec = quiz.timeLimitSec;
    this.passThreshold = quiz.passThreshold;

    this.questions = shuffle(
      quiz.questions.map((question) => {
        const indexedOptions = question.options.map((option, index) => ({
          option,
          index,
        }));

        const shuffledOptions = shuffle(indexedOptions);

        return {
          ...question,
          options: shuffledOptions.map((item) => item.option),
          correctIndex: shuffledOptions.findIndex(
            (item) => item.index === question.correctIndex
          ),
        };
      })
    );

    this.currentIndex = 0;
    this.answers = {};
    this.remainingSec = quiz.timeLimitSec;
    this.isFinished = false;
    this.questionStartTime = Date.now();
    this.analytics = {
      timePerQuestion: {},
      topics: {},
    };
  }

  get currentQuestion() {
    return this.questions[this.currentIndex];
  }

  get length() {
    return this.questions.length;
  }

  select(optionIndex) {
    this.answers[this.currentQuestion.id] = optionIndex;
  }

  getSelectedIndex() {
    return this.answers[this.currentQuestion.id];
  }

  recordQuestionTime() {
    const question = this.currentQuestion;
    if (!question) return;

    const spentSeconds = Math.round((Date.now() - this.questionStartTime) / 1000);

    this.analytics.timePerQuestion[question.id] =
      (this.analytics.timePerQuestion[question.id] || 0) + spentSeconds;

    const topic = question.topic || "Без темы";

    if (!this.analytics.topics[topic]) {
      this.analytics.topics[topic] = {
        total: 0,
        correct: 0,
      };
    }

    this.analytics.topics[topic].total += 1;

    if (this.answers[question.id] === question.correctIndex) {
      this.analytics.topics[topic].correct += 1;
    }

    this.questionStartTime = Date.now();
  }

  next() {
    this.recordQuestionTime();

    if (this.currentIndex < this.length - 1) {
      this.currentIndex += 1;
    }
  }

  prev() {
    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
    }
  }

  finish() {
    this.recordQuestionTime();

    const correct = this.questions.filter(
      (question) => this.answers[question.id] === question.correctIndex
    ).length;

    const percent = this.questions.length > 0 ? correct / this.questions.length : 0;

    this.isFinished = true;

    return {
      correct,
      total: this.questions.length,
      percent,
      passed: percent >= this.passThreshold,
    };
  }

  tick() {
    this.remainingSec = Math.max(0, this.remainingSec - 1);

    if (this.remainingSec === 0 && !this.isFinished) {
      return this.finish();
    }

    return null;
  }

  toState() {
    return {
      currentIndex: this.currentIndex,
      answers: this.answers,
      remainingSec: this.remainingSec,
      isFinished: this.isFinished,
      analytics: this.analytics,
      questions: this.questions,
    };
  }

  static fromState(quiz, state) {
    const engine = new QuizEngine(quiz);
    Object.assign(engine, state);
    return engine;
  }
}

const els = {
  title: document.querySelector("#quiz-title"),
  progress: document.querySelector("#progress"),
  timer: document.querySelector("#timer"),
  questionCounter: document.querySelector("#question-counter"),
  qText: document.querySelector("#question-text"),
  form: document.querySelector("#options-form"),
  btnPrev: document.querySelector("#btn-prev"),
  btnNext: document.querySelector("#btn-next"),
  btnFinish: document.querySelector("#btn-finish"),
  quizSection: document.querySelector("#quiz-section"),
  result: document.querySelector("#result-section"),
  resultSummary: document.querySelector("#result-summary"),
  reviewPanel: document.querySelector("#review-panel"),
  analyticsPanel: document.querySelector("#analytics-panel"),
  btnReview: document.querySelector("#btn-review"),
  btnRestart: document.querySelector("#btn-restart"),
};

let engine = null;
let timerId = null;
let reviewMode = false;

async function loadQuiz() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить ${DATA_URL}: ${response.status}`);
  }
  return response.json();
}

function saveState() {
  if (!engine) return;
  localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(engine.toState()));
}

function loadState(quiz) {
  const raw = localStorage.getItem(STORAGE_KEYS.STATE);

  if (!raw) {
    return new QuizEngine(quiz);
  }

  try {
    return QuizEngine.fromState(quiz, JSON.parse(raw));
  } catch {
    return new QuizEngine(quiz);
  }
}

function updateOptionStyles() {
  const selectedIndex = engine.getSelectedIndex();

  els.form.querySelectorAll(".option").forEach((label, index) => {
    label.classList.toggle("is-selected", index === selectedIndex);
  });
}

function renderQuestion() {
  const question = engine.currentQuestion;
  if (!question) return;

  els.progress.textContent = `Вопрос ${engine.currentIndex + 1} из ${engine.length}`;
  els.questionCounter.textContent = `Вопрос ${engine.currentIndex + 1} из ${engine.length}`;
  els.qText.textContent = question.text;

  els.form.innerHTML = "";

  question.options.forEach((option, index) => {
    const label = document.createElement("label");
    label.className = "option";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "option";
    input.value = String(index);

    if (engine.getSelectedIndex() === index) {
      input.checked = true;
      label.classList.add("is-selected");
    }

    input.addEventListener("change", () => {
      engine.select(index);
      updateOptionStyles();
      renderNavigation();
      saveState();
    });

    const text = document.createElement("span");
    text.textContent = option;

    label.appendChild(input);
    label.appendChild(text);
    els.form.appendChild(label);
  });
}

function renderNavigation() {
  const selected = Number.isInteger(engine.getSelectedIndex());
  const isLastQuestion = engine.currentIndex === engine.length - 1;

  els.btnPrev.disabled = engine.currentIndex === 0;

  els.btnNext.classList.toggle("hidden", isLastQuestion);
  els.btnFinish.classList.toggle("hidden", !isLastQuestion);

  els.btnNext.disabled = !selected || isLastQuestion;
  els.btnFinish.disabled = !selected;
}

function renderTimer() {
  els.timer.textContent = formatTime(engine.remainingSec);
}

function renderReview() {
  els.reviewPanel.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "review";

  engine.questions.forEach((question, index) => {
    const selected = engine.answers[question.id];

    const article = document.createElement("article");
    article.className = "review-item";

    const title = document.createElement("p");
    title.className = "review-item__title";
    title.textContent = `${index + 1}. ${question.text}`;

    const userAnswer = document.createElement("p");
    userAnswer.className = "review-item__meta";

    const userText =
      selected !== undefined ? question.options[selected] : "Не выбран";

    userAnswer.textContent = `Ваш ответ: ${userText}`;

    const correctAnswer = document.createElement("p");
    correctAnswer.className = "review-item__meta";
    correctAnswer.textContent = `Правильный ответ: ${question.options[question.correctIndex]}`;

    article.appendChild(title);
    article.appendChild(userAnswer);
    article.appendChild(correctAnswer);

    wrapper.appendChild(article);
  });

  els.reviewPanel.appendChild(wrapper);
}

function renderAnalytics() {
  els.analyticsPanel.innerHTML = "";

  const analyticsWrapper = document.createElement("div");
  analyticsWrapper.className = "analytics-grid";

  const timingCard = document.createElement("div");
  timingCard.className = "analytics-card";

  timingCard.innerHTML = `
    <h3>Время по вопросам</h3>
    ${engine.questions.map((question, index) => `
      <p>
        Вопрос ${index + 1}: ${engine.analytics.timePerQuestion[question.id] || 0} сек.
      </p>
    `).join("")}
  `;

  const topicsCard = document.createElement("div");
  topicsCard.className = "analytics-card";

  const topicEntries = Object.entries(engine.analytics.topics);

  topicsCard.innerHTML = `
    <h3>Статистика по темам</h3>
    ${
      topicEntries.length
        ? topicEntries
            .map(([topic, value]) => `<p>${topic}: ${value.correct} / ${value.total}</p>`)
            .join("")
        : "<p>Нет данных</p>"
    }
  `;

  analyticsWrapper.appendChild(timingCard);
  analyticsWrapper.appendChild(topicsCard);

  els.analyticsPanel.appendChild(analyticsWrapper);
}

function showResult(summary) {
  els.quizSection.classList.add("hidden");
  els.result.classList.remove("hidden");

  const percent = Math.round(summary.percent * 100);

  els.resultSummary.textContent =
    `${summary.correct} / ${summary.total} (${percent}%) — ` +
    (summary.passed ? "тест пройден" : "тест не пройден");

  renderAnalytics();

  if (reviewMode) {
    renderReview();
    els.reviewPanel.classList.remove("hidden");
  }
}

function bindEvents() {
  els.btnNext.addEventListener("click", () => {
    engine.next();
    renderQuestion();
    renderNavigation();
    saveState();
  });

  els.btnPrev.addEventListener("click", () => {
    engine.prev();
    renderQuestion();
    renderNavigation();
    saveState();
  });

  els.btnFinish.addEventListener("click", () => {
    const summary = engine.finish();
    clearInterval(timerId);
    renderNavigation();
    showResult(summary);
    saveState();
  });

  els.btnRestart.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEYS.STATE);
    location.reload();
  });

  els.btnReview.addEventListener("click", () => {
    reviewMode = !reviewMode;

    els.btnReview.textContent = reviewMode
      ? "Скрыть ответы"
      : "Посмотреть ответы";

    els.reviewPanel.classList.toggle("hidden", !reviewMode);

    if (!reviewMode) return;

    renderReview();
  });
}

async function init() {
  try {
    const quiz = await loadQuiz();

    els.title.textContent = quiz.title;
    engine = loadState(quiz);

    bindEvents();
    renderQuestion();
    renderNavigation();
    renderTimer();

    timerId = setInterval(() => {
      const result = engine.tick();

      renderTimer();
      saveState();

      if (result) {
        clearInterval(timerId);
        showResult(result);
      }
    }, 1000);
  } catch (error) {
    els.title.textContent = "Ошибка загрузки";
    els.questionCounter.textContent = "Не удалось загрузить тест";
    els.qText.textContent = String(error.message || error);
    console.error(error);
  }
}

init();
