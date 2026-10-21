/* ============================================================================
   Своя игра: Северо-Западный федеральный округ — игровая логика
   ========================================================================== */

(function () {
  'use strict';

  /* ----------------------------- Настройки ----------------------------- */
  const STORAGE_KEY = 'svoya-igra-szfo-v1';
  const POINTS = [100, 250, 500, 1000];
  // 15 секунд на 100 и 250, 20 секунд на 500 и 1000
  const TIMER_SECONDS = { 100: 15, 250: 15, 500: 20, 1000: 20 };
  // подготовка перед запуском отсчёта (секунды)
  const PREPARE_SECONDS = 3;

  /* ------------------------------- DOM -------------------------------- */
  const $ = (sel) => document.querySelector(sel);
  const dom = {
    board: $('#board'),
    scoreboard: $('#scoreboard'),
    playersList: $('#players-list'),
    playerForm: $('#player-form'),
    playerName: $('#player-name'),
    statPlayers: $('#stat-players'),
    statQuestions: $('#stat-questions'),
    statPoints: $('#stat-points'),
    modal: $('#modal'),
    modalCat: $('#modal-cat'),
    modalTitle: $('#modal-title'),
    modalPoints: $('#modal-points'),
    modalBody: $('#modal-body'),
    modalFoot: $('#modal-foot'),
    modalClose: $('#modal-close'),
    timer: $('#timer'),
    timerValue: $('#timer-value'),
    timerFill: $('#timer-fill'),
    results: $('#results'),
    resultsBody: $('#results-body'),
    toast: $('#toast'),
    btnReset: $('#btn-reset'),
    btnSound: $('#btn-sound'),
    btnFullscreen: $('#btn-fullscreen'),
    btnResults: $('#btn-results')
  };

  /* ------------------------------ Состояние --------------------------- */
  const defaultState = () => ({ used: {}, players: [], sound: true, selectedCat: 0 });
  let state = loadState();

  let active = null;      // текущий открытый вопрос
  let timerId = null;
  let audioCtx = null;
  let toastId = null;

  /* ============================ Хранилище ============================= */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed);
    } catch (e) {
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* приватный режим — просто не сохраняем */ }
  }

  /* ============================== Утилиты ============================= */
  const tileKey = (catId, points) => catId + ':' + points;
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));

  function showToast(text) {
    dom.toast.textContent = text;
    dom.toast.hidden = false;
    clearTimeout(toastId);
    toastId = setTimeout(() => { dom.toast.hidden = true; }, 2200);
  }

  /* ============================== Звук =============================== */
  function ensureAudio() {
    if (!state.sound) return null;
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function beep(freq, duration, volume) {
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume || 0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) { /* игнорируем */ }
  }

  /* ============================ Отрисовка ============================= */
  function render() {
    renderBoard();
    renderScoreboard();
    renderStats();
  }

  function renderBoard() {
    // заголовки категорий
    let head = '<div class="board-head">' + CATEGORIES.map((cat, i) => (
      '<div class="board-head__item">' +
        '<span class="board-head__key">' + (i + 1) + '</span>' +
        '<span class="board-head__title">' + esc(cat.title) + '</span>' +
        '<span class="board-head__sub">' + esc(cat.subtitle || '') + '</span>' +
      '</div>'
    )).join('') + '</div>';

    // ячейки: строки по стоимости, столбцы — категории
    let cells = '';
    POINTS.forEach((points) => {
      CATEGORIES.forEach((cat, catIndex) => {
        const q = (cat.questions || []).find((x) => x.points === points);
        if (!q) { cells += '<div class="tile tile--empty" aria-hidden="true"></div>'; return; }
        const key = tileKey(cat.id, points);
        const status = state.used[key];
        const cls = ['tile'];
        if (status) cls.push('tile--' + status);
        if (active && active.key === key) cls.push('tile--open');
        if (active && active.catIndex === catIndex && !status) cls.push('tile--sel');
        const badge = status === 'answered' ? '✓'
          : status === 'timeout' ? '⏱'
          : status === 'skipped' ? '—' : '';
        cells +=
          '<button type="button" class="' + cls.join(' ') + '" data-cat="' + catIndex + '" data-points="' + points + '"' +
            (status ? ' disabled' : '') + ' aria-label="' + esc(cat.title + ', ' + points + ' очков') + '">' +
            (badge ? '<span class="tile__status">' + badge + '</span>' : '') +
            '<span class="tile__cat">' + esc(cat.title) + '</span>' +
            '<span class="tile__points">' + points + '</span>' +
          '</button>';
      });
    });

    dom.board.innerHTML = head + cells;
  }

  function renderScoreboard() {
    const players = state.players.slice().sort((a, b) => b.score - a.score);
    dom.playersList.innerHTML = players.map((p) => (
      '<option value="' + esc(p.name) + '"></option>'
    )).join('');

    if (!players.length) {
      dom.scoreboard.innerHTML = '<li class="scoreboard__empty">Пока нет игроков. Их можно добавить здесь или ввести имя сразу после вопроса.</li>';
      return;
    }

    dom.scoreboard.innerHTML = players.map((p, i) => (
      '<li class="scoreboard__row' + (i === 0 && p.score > 0 ? ' scoreboard__row--leader' : '') + '">' +
        '<span class="scoreboard__place">' + (i + 1) + '</span>' +
        '<span class="scoreboard__name" title="' + esc(p.name) + '">' + esc(p.name) + '</span>' +
        '<span class="scoreboard__score">' + p.score + '</span>' +
        '<button type="button" class="scoreboard__btn" data-act="minus" data-name="' + esc(p.name) + '" title="Снять 100 очков">−</button>' +
        '<button type="button" class="scoreboard__btn" data-act="plus" data-name="' + esc(p.name) + '" title="Начислить 100 очков">+</button>' +
        '<button type="button" class="scoreboard__btn scoreboard__btn--del" data-act="del" data-name="' + esc(p.name) + '" title="Убрать игрока">✕</button>' +
      '</li>'
    )).join('');
  }

  function renderStats() {
    const answered = Object.keys(state.used).filter((k) => state.used[k] === 'answered').length;
    const total = state.players.reduce((sum, p) => sum + p.score, 0);
    dom.statPlayers.textContent = state.players.length;
    dom.statQuestions.textContent = answered;
    dom.statPoints.textContent = total;
  }

  /* ============================ Таблица =============================== */
  function getPlayer(name) {
    const clean = String(name || '').trim();
    if (!clean) return null;
    let p = state.players.find((x) => x.name.toLowerCase() === clean.toLowerCase());
    if (!p) {
      p = { name: clean, score: 0 };
      state.players.push(p);
    }
    return p;
  }

  function addPoints(name, amount) {
    const p = getPlayer(name);
    if (!p) return null;
    p.score += amount;
    saveState();
    render();
    return p;
  }

  /* ========================== Модальное окно ========================== */
  function openModal() {
    dom.modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    stopTimer();
    dom.modal.hidden = true;
    dom.modalBody.innerHTML = '';
    dom.modalFoot.innerHTML = '';
    dom.timer.hidden = true;
    document.body.style.overflow = '';
    active = null;
    render();
    maybeFinish();
  }

  function setHead(cat, points, title) {
    dom.modalCat.textContent = cat ? cat.title : '';
    dom.modalTitle.textContent = title || '';
    dom.modalPoints.textContent = points ? points + ' очков' : '';
  }

  /* --------------------------- Открытие ------------------------------ */
  function openTile(catIndex, points) {
    const cat = CATEGORIES[catIndex];
    if (!cat) return;
    const q = (cat.questions || []).find((x) => x.points === points);
    if (!q) return;
    const key = tileKey(cat.id, points);
    if (state.used[key]) return;

    active = { catIndex, cat, points, q, key, multiplier: 1, stage: 'question', timedOut: false };
    openModal();

    if (q.special) renderWager();
    else startQuestion();
  }

  /* ------------------- Карточка «Удвоить и отдать» ------------------- */
  function renderWager() {
    const a = active;
    a.stage = 'wager';
    setHead(a.cat, a.points * a.multiplier, 'Особый вопрос');

    dom.modalBody.innerHTML =
      '<div class="banner">Удвоить и ответить самому<br>или отдайте вопрос любому игроку</div>' +
      '<p class="hint">Ведущий выбирает условия — вопрос игроки пока не видят.</p>' +
      '<div class="wager-options">' +
        '<button type="button" class="wager-opt' + (a.multiplier === 2 ? ' wager-opt--active' : '') + '" data-wager="2">' +
          '<span class="wager-opt__title">⚡ Удвоить</span>' +
          '<span class="wager-opt__sub">' + (a.points * 2) + ' очков — отвечает тот, кто выбрал вопрос</span>' +
        '</button>' +
        '<button type="button" class="wager-opt' + (a.multiplier === 1 ? ' wager-opt--active' : '') + '" data-wager="1">' +
          '<span class="wager-opt__title">✋ Отдать любому игроку</span>' +
          '<span class="wager-opt__sub">' + a.points + ' очков — игрок выбирается в момент ответа</span>' +
        '</button>' +
      '</div>';

    dom.modalFoot.innerHTML =
      '<button type="button" class="btn btn--ghost" data-action="skip">Пропустить вопрос</button>' +
      '<button type="button" class="btn btn--gold btn--big" data-action="show">Показать вопрос →</button>';

    dom.timer.hidden = true;
  }

  /* ------------------------ Показ вопроса ---------------------------- */
  function startQuestion() {
    const a = active;
    a.stage = 'question';
    setHead(a.cat, a.points * a.multiplier, 'Вопрос');

    dom.modalBody.innerHTML =
      '<div class="question">' + esc(a.q.q) + '</div>' +
      '<p class="hint" id="timer-hint">Приготовьтесь — отсчёт запустится через ' + PREPARE_SECONDS + ' секунды</p>';

    dom.modalFoot.innerHTML =
      '<button type="button" class="btn btn--ghost" data-action="skip">Пропустить</button>' +
      '<button type="button" class="btn btn--gold btn--big" data-action="reveal">Показать ответ</button>';

    dom.timer.hidden = false;
    startTimer(TIMER_SECONDS[a.points]);
    render();
  }

  /* --------------------------- Таймер --------------------------------
     Сначала идёт короткая подготовка (PREPARE_SECONDS), чтобы ведущий
     успел прочитать вопрос вслух, и только потом запускается отсчёт.      */
  function startTimer(seconds) {
    stopTimer();
    const prepMs = PREPARE_SECONDS * 1000;
    const prepEnd = Date.now() + prepMs;
    const total = seconds * 1000;
    const endAt = prepEnd + total;
    let lastBeep = seconds + 1;
    let lastPrep = PREPARE_SECONDS + 1;

    function tick() {
      const now = Date.now();

      /* --- фаза подготовки: 3-2-1 --- */
      if (now < prepEnd) {
        const leftPrep = Math.ceil((prepEnd - now) / 1000);
        dom.timerValue.textContent = leftPrep;
        dom.timerValue.classList.add('timer__value--prep');
        dom.timerValue.classList.remove('timer__value--warn');
        dom.timerFill.style.width = '100%';
        setHint('Приготовьтесь! Отсчёт начнётся через ' + leftPrep + '…');
        if (leftPrep !== lastPrep) {
          lastPrep = leftPrep;
          beep(540, 0.09, 0.05);
        }
        return;
      }

      /* --- основной отсчёт --- */
      dom.timerValue.classList.remove('timer__value--prep');
      setHint('На ответ: ' + seconds + ' секунд');

      const left = Math.max(0, endAt - now);
      const sec = Math.ceil(left / 1000);
      const ratio = left / total;

      dom.timerValue.textContent = sec;
      dom.timerValue.classList.toggle('timer__value--warn', sec <= 5);
      dom.timerFill.style.width = (ratio * 100).toFixed(2) + '%';

      if (sec <= 5 && sec > 0 && sec !== lastBeep) {
        lastBeep = sec;
        beep(760, 0.09, 0.05);
      }

      if (left <= 0) {
        stopTimer();
        beep(220, 0.5, 0.09);
        revealAnswer(true);
      }
    }

    tick();
    timerId = setInterval(tick, 100);
  }

  function setHint(text) {
    const hint = dom.modalBody.querySelector('#timer-hint');
    if (hint) hint.textContent = text;
  }

  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }

  /* -------------------------- Показ ответа --------------------------- */
  function revealAnswer(timedOut) {
    const a = active;
    if (!a) return;
    stopTimer();
    a.stage = 'answer';
    a.timedOut = !!timedOut;

    setHead(a.cat, a.points * a.multiplier, timedOut ? 'Время вышло!' : 'Ответ');

    const note = a.q.note ? '<div class="note"><b>Ведущему:</b> ' + esc(a.q.note) + '</div>' : '';

    let html =
      '<div class="answer">' +
        '<div class="answer__label">' + (timedOut ? 'Время вышло — ответ' : 'Ответ') + '</div>' +
        '<div class="answer__text">' + esc(a.q.a) + '</div>' +
      '</div>' + note;

    if (timedOut) {
      html += '<p class="hint" style="margin-top:14px">Ответ не засчитывается — вопрос закрыт.</p>';
    } else {
      html += scorePanelHtml();
    }

    dom.modalBody.innerHTML = html;
    dom.timer.hidden = true;

    dom.modalFoot.innerHTML = timedOut
      ? '<button type="button" class="btn btn--gold" data-action="close">Закрыть</button>'
      : '<button type="button" class="btn btn--ghost" data-action="no-points">Без начисления</button>' +
        '<button type="button" class="btn btn--gold" data-action="close">Закрыть</button>';

    // ячейка закрывается сразу при показе ответа
    state.used[a.key] = timedOut ? 'timeout' : 'answered';
    saveState();
    render();

    if (!timedOut) {
      const input = dom.modalBody.querySelector('#score-name');
      if (input) setTimeout(() => input.focus(), 60);
    }
  }

  function scorePanelHtml() {
    const a = active;
    const value = a.points * a.multiplier;
    return (
      '<div class="score-panel">' +
        '<div class="score-panel__title">Кто отвечал? Введите имя игрока</div>' +
        '<div class="score-panel__row">' +
          '<input type="text" id="score-name" list="players-list" placeholder="Имя игрока" autocomplete="off">' +
          '<input type="number" id="score-amount" value="' + value + '" step="50" title="Очки">' +
        '</div>' +
        '<div class="score-panel__actions">' +
          '<button type="button" class="btn btn--gold" data-action="award">Засчитать очки</button>' +
          '<button type="button" class="btn btn--danger" data-action="penalty">Ошибка (−' + value + ')</button>' +
        '</div>' +
        '<p class="hint" style="text-align:left;margin-top:8px">Имя можно выбрать из списка — очки одного игрока суммируются. ' +
          'За ошибку снимается столько же, сколько можно было заработать за вопрос.</p>' +
      '</div>'
    );
  }

  /* ============================ Действия ============================= */
  function awardPoints(sign) {
    const nameInput = dom.modalBody.querySelector('#score-name');
    const amountInput = dom.modalBody.querySelector('#score-amount');
    const name = (nameInput && nameInput.value || '').trim();
    if (!name) { showToast('Введите имя игрока'); if (nameInput) nameInput.focus(); return; }

    const value = active ? active.points * active.multiplier : 0;
    let amount = parseInt(amountInput && amountInput.value, 10);
    if (isNaN(amount)) amount = value;
    // за ошибку снимаем ровно столько, сколько можно было заработать
    amount = sign < 0 ? -value : amount;

    const p = addPoints(name, amount);
    if (!p) return;
    showToast(p.name + ': ' + (amount > 0 ? '+' : '') + amount + ' очков');
    closeModal();
  }

  function skipQuestion() {
    if (!active) return;
    state.used[active.key] = 'skipped';
    saveState();
    closeModal();
  }

  /* Все вопросы сыграны — показываем итоги */
  function maybeFinish() {
    const total = CATEGORIES.reduce((sum, cat) => sum + (cat.questions || []).length, 0);
    if (Object.keys(state.used).length < total) return;
    openResults();
    showToast('Все вопросы сыграны — итоги готовы');
  }

  /* ============================== Итоги =============================== */
  function openResults() {
    const players = state.players.slice().sort((a, b) => b.score - a.score);
    const answered = Object.keys(state.used).filter((k) => state.used[k] === 'answered').length;
    const timeouts = Object.keys(state.used).filter((k) => state.used[k] === 'timeout').length;
    const skipped = Object.keys(state.used).filter((k) => state.used[k] === 'skipped').length;
    const total = players.reduce((s, p) => s + p.score, 0);

    let body;
    if (!players.length) {
      body = '<p class="results-empty">Игроки ещё не добавлялись.</p>';
    } else {
      body = '<table class="results-table"><thead><tr><th>Место</th><th>Игрок</th><th>Очки</th></tr></thead><tbody>' +
        players.map((p, i) => (
          '<tr' + (i === 0 ? ' class="tr--leader"' : '') + '>' +
            '<td>' + (i + 1) + '</td>' +
            '<td>' + esc(p.name) + '</td>' +
            '<td>' + p.score + '</td>' +
          '</tr>'
        )).join('') +
        '</tbody></table>';
    }

    body += '<p class="hint" style="margin-top:16px">Отвечено вопросов: ' + answered +
      ' · не успели: ' + timeouts + ' · пропущено: ' + skipped +
      ' · всего очков в игре: ' + total + '</p>';

    dom.resultsBody.innerHTML = body;
    dom.results.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeResults() {
    dom.results.hidden = true;
    if (dom.modal.hidden) document.body.style.overflow = '';
  }

  function resultsAsText() {
    const players = state.players.slice().sort((a, b) => b.score - a.score);
    return 'Итоги игры «Своя игра: СЗФО»\n' +
      players.map((p, i) => (i + 1) + '. ' + p.name + ' — ' + p.score).join('\n') +
      '\n\n' + CATEGORIES.map((c) => '• ' + c.title).join('\n');
  }

  function copyResults() {
    const text = resultsAsText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => showToast('Итоги скопированы'))
        .catch(() => showToast('Не удалось скопировать'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showToast('Итоги скопированы'); }
      catch (e) { showToast('Не удалось скопировать'); }
      document.body.removeChild(ta);
    }
  }

  /* ============================ События ============================== */
  dom.board.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile || tile.disabled) return;
    openTile(parseInt(tile.dataset.cat, 10), parseInt(tile.dataset.points, 10));
  });

  dom.scoreboard.addEventListener('click', (e) => {
    const btn = e.target.closest('.scoreboard__btn');
    if (!btn) return;
    const name = btn.dataset.name;
    const act = btn.dataset.act;
    if (act === 'del') {
      state.players = state.players.filter((p) => p.name !== name);
    } else if (act === 'plus') {
      const p = state.players.find((x) => x.name === name);
      if (p) p.score += 100;
    } else if (act === 'minus') {
      const p = state.players.find((x) => x.name === name);
      if (p) p.score -= 100;
    }
    saveState();
    render();
  });

  dom.playerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = dom.playerName.value.trim();
    if (!name) return;
    getPlayer(name);
    dom.playerName.value = '';
    saveState();
    render();
  });

  dom.modal.addEventListener('click', (e) => {
    if (e.target.dataset && e.target.dataset.close) { closeModal(); return; }

    const wager = e.target.closest('[data-wager]');
    if (wager && active) {
      active.multiplier = parseInt(wager.dataset.wager, 10);
      renderWager();
      return;
    }

    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;

    switch (action) {
      case 'show':
        if (active) startQuestion();
        break;
      case 'reveal':
        revealAnswer(false);
        break;
      case 'award':
        awardPoints(1);
        break;
      case 'penalty':
        awardPoints(-1);
        break;
      case 'no-points':
      case 'close':
        closeModal();
        break;
      case 'skip':
        skipQuestion();
        break;
    }
  });

  dom.modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'score-name') {
      e.preventDefault();
      awardPoints(1);
    }
  });

  dom.modalClose.addEventListener('click', () => closeModal());

  dom.results.addEventListener('click', (e) => {
    if (e.target.dataset && e.target.dataset.close) { closeResults(); return; }
    if (e.target.closest('[data-copy]')) copyResults();
  });

  dom.btnResults.addEventListener('click', openResults);

  dom.btnSound.addEventListener('click', () => {
    state.sound = !state.sound;
    dom.btnSound.textContent = 'Звук: ' + (state.sound ? 'вкл' : 'выкл');
    dom.btnSound.setAttribute('aria-pressed', String(state.sound));
    saveState();
    if (state.sound) beep(880, 0.1, 0.05);
  });

  dom.btnFullscreen.addEventListener('click', () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
    }
  });

  dom.btnReset.addEventListener('click', () => {
    if (!confirm('Начать игру заново? Очки и отметки о вопросах будут сброшены.')) return;
    stopTimer();
    state = defaultState();
    saveState();
    render();
    showToast('Новая игра — поле очищено');
  });

  /* ------------------------- Клавиатура ----------------------------- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!dom.results.hidden) { closeResults(); return; }
      if (!dom.modal.hidden) { closeModal(); return; }
    }

    if (!dom.modal.hidden) {
      if (e.key === 'Enter') {
        const btn = dom.modalFoot.querySelector('[data-action="reveal"], [data-action="show"], [data-action="award"]');
        if (btn) { e.preventDefault(); btn.click(); }
      }
      return;
    }

    if (!dom.results.hidden) return;

    const key = e.key.toLowerCase();

    // A / S / D / F — выбрать категорию, затем 1–4 — цена вопроса
    const catKeys = ['a', 's', 'd', 'f'];
    if (catKeys.indexOf(key) !== -1) {
      state.selectedCat = catKeys.indexOf(key);
      render();
      showToast('Категория: ' + CATEGORIES[state.selectedCat].title + ' — теперь нажмите 1–4');
      return;
    }
    if (/^[1-4]$/.test(key)) {
      openTile(state.selectedCat, POINTS[parseInt(key, 10) - 1]);
    }
  });

  /* ============================== Старт ============================== */
  dom.btnSound.textContent = 'Звук: ' + (state.sound ? 'вкл' : 'выкл');
  render();

  // для удобства отладки
  window.SVOYA_IGRA = { state: () => state, CATEGORIES, POINTS };
})();
