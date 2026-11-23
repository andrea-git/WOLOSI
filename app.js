(() => {
  'use strict';

  const STORE_KEY = 'workout-logbook:v1';
  const PIN_KEY = 'workout-logbook:pin';
  const API_URL = '/api/logbook';

  const state = {
    plan: null,
    activeDayId: 'G1',
    date: localDateISO(),
    store: loadLocalStore(),
    saveTimer: null,
    cloudTimer: null,
    cloudBusy: false,
    pendingCloudJson: null,
    idEditContext: null,
    historyContext: null,
    photoCheckedSlots: new Set(),
    stopwatch: {
      elapsedMs: 0,
      startedAt: null,
      running: false,
      intervalId: null,
    },
    totalTimerIntervalId: null,
  };

  const els = {
    tabs: document.getElementById('tabs'),
    dayName: document.getElementById('dayName'),
    dateInput: document.getElementById('dateInput'),
    exerciseList: document.getElementById('exerciseList'),
    template: document.getElementById('exerciseTemplate'),
    exportBtn: document.getElementById('exportBtn'),
    importBtn: document.getElementById('importBtn'),
    importFile: document.getElementById('importFile'),
    syncStatus: document.getElementById('syncStatus'),
    idModal: document.getElementById('idModal'),
    idModalInput: document.getElementById('idModalInput'),
    idModalSave: document.getElementById('idModalSave'),
    idModalCancel: document.getElementById('idModalCancel'),
    idModalClose: document.getElementById('idModalClose'),
    photoModal: document.getElementById('photoModal'),
    photoModalImage: document.getElementById('photoModalImage'),
    photoModalClose: document.getElementById('photoModalClose'),
    historyModal: document.getElementById('historyModal'),
    historyModalTitle: document.getElementById('historyModalTitle'),
    historyModalMeta: document.getElementById('historyModalMeta'),
    historyModalScroller: document.getElementById('historyModalScroller'),
    historyModalClose: document.getElementById('historyModalClose'),
    historyLoadMore: document.getElementById('historyLoadMore'),
    workoutStartBtn: document.getElementById('workoutStartBtn'),
    workoutEndBtn: document.getElementById('workoutEndBtn'),
    workoutTotalDisplay: document.getElementById('workoutTotalDisplay'),
    workoutTotalDisplayTop: document.getElementById('workoutTotalDisplayTop'),
  };

  init();

  async function init() {
    wireGlobalEvents();
    els.dateInput.value = state.date;
    setSyncStatus('Cloud…', 'working');

    try {
      const response = await fetch('./workout.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Impossibile caricare workout.json');
      state.plan = await response.json();
      state.activeDayId = state.plan.days?.[0]?.id || 'G1';

      await initializeCloudStore();
      render();
    } catch (error) {
      els.exerciseList.innerHTML = `<div class="empty">${escapeHtml(error.message || 'Errore caricamento scheda')}</div>`;
    }
  }

  function wireGlobalEvents() {
    els.dateInput.addEventListener('change', () => {
      state.date = els.dateInput.value || localDateISO();
      renderExercises();
    });

    els.exportBtn.addEventListener('click', exportBackup);
    els.importBtn.addEventListener('click', () => els.importFile.click());
    els.importFile.addEventListener('change', importBackup);

    els.idModalCancel.addEventListener('click', closeIdModal);
    els.idModalClose.addEventListener('click', closeIdModal);
    els.idModal.addEventListener('click', (event) => {
      if (event.target === els.idModal) closeIdModal();
    });
    els.idModalSave.addEventListener('click', saveEditedId);
    els.idModalInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveEditedId();
      }
      if (event.key === 'Escape') closeIdModal();
    });

    els.photoModalClose.addEventListener('click', closePhotoModal);
    els.photoModal.addEventListener('click', (event) => {
      if (event.target === els.photoModal) closePhotoModal();
    });

    els.historyModalClose.addEventListener('click', closeHistoryModal);
    els.historyModal.addEventListener('click', (event) => {
      if (event.target === els.historyModal) closeHistoryModal();
    });
    els.historyLoadMore.addEventListener('click', () => {
      if (!state.historyContext) return;
      state.historyContext.limit += 10;
      renderExtendedHistory();
    });

    els.workoutStartBtn.addEventListener('click', startWorkoutTimer);
    els.workoutEndBtn.addEventListener('click', endWorkoutTimer);
  }

  async function initializeCloudStore() {
    const local = loadLocalStore();

    try {
      const response = await apiFetch({ method: 'GET', cache: 'no-store' });

      if (response.status === 404) {
        state.store = local;
        saveLocalStore();

        if (hasStoreData(local)) {
          setSyncStatus('Migrazione…', 'working');
          await pushRemoteNow(local);
          setSyncStatus('Cloud ✓', 'ok');
        } else {
          setSyncStatus('Cloud ✓', 'ok');
        }
        return;
      }

      if (!response.ok) throw new Error(await responseError(response));

      const payload = await response.json();
      validateStore(payload.data);
      state.store = payload.data;
      ensureOverridesStore();
      saveLocalStore();
      setSyncStatus('Cloud ✓', 'ok');
    } catch (error) {
      console.error(error);
      state.store = local;
      setSyncStatus('Solo locale', 'error');
    }
  }

  function render() {
    renderTabs();
    renderExercises();
  }

  function renderTabs() {
    els.tabs.innerHTML = '';
    for (const day of state.plan.days) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = day.id;
      button.className = day.id === state.activeDayId ? 'active' : '';
      button.addEventListener('click', () => {
        state.activeDayId = day.id;
        renderTabs();
        renderExercises();
      });
      els.tabs.appendChild(button);
    }
  }

  function renderExercises() {
    if (!state.plan) return;
    const day = state.plan.days.find((d) => d.id === state.activeDayId);
    if (!day) return;

    els.dayName.textContent = day.name;
    els.exerciseList.innerHTML = '';

    const session = getOrCreateSession(day);
    renderWorkoutTotalTimer(session);
    const previous = getPreviousSessions(day.id, state.date, 3);

    for (const exercise of day.exercises) {
      const fragment = els.template.content.cloneNode(true);
      const card = fragment.querySelector('.exercise-card');
      const slotKey = exerciseSlotKey(day, exercise);
      const override = getExerciseOverride(day, exercise);
      const effectiveId = override.id || exercise.id;
      const current = normalizeExerciseLog(session.exercises[effectiveId], exercise.sets);
      const prev1 = normalizeExerciseLog(previous[0]?.exercises?.[effectiveId], exercise.sets);
      const prev2 = normalizeExerciseLog(previous[1]?.exercises?.[effectiveId], exercise.sets);
      const setCount = current.setCount;

      fragment.querySelector('.exercise-name').textContent = exercise.name;
      fragment.querySelector('.exercise-meta').textContent = `${exercise.sets} × ${exercise.reps}${exercise.failure ? ` ${exercise.failure}` : ''}${exercise.optional ? ' · opzionale' : ''}`;
      fragment.querySelector('.exercise-static-note').textContent = exercise.note || '';

      const currentIndicator = fragment.querySelector('.current-performance-indicator');
      const prev1Indicator = fragment.querySelector('.prev1-performance-indicator');
      const prev2Indicator = fragment.querySelector('.prev2-performance-indicator');

      const currentRaw = session.exercises[effectiveId];
      const previousRaw1 = previous[0]?.exercises?.[effectiveId];
      const previousRaw2 = previous[1]?.exercises?.[effectiveId];
      const previousRaw3 = previous[2]?.exercises?.[effectiveId];

      restorePerformanceEvaluation(currentIndicator, currentRaw, previousRaw1, previous[0]?.id);
      restorePerformanceEvaluation(prev1Indicator, previousRaw1, previousRaw2, previous[1]?.id);
      restorePerformanceEvaluation(prev2Indicator, previousRaw2, previousRaw3, previous[2]?.id);

      currentIndicator.disabled = !previousRaw1;
      currentIndicator.title = currentIndicator.disabled
        ? 'Nessuna sessione precedente confrontabile'
        : 'Valuta la prestazione di oggi';
      currentIndicator.addEventListener('click', () => {
        const liveSession = getOrCreateSession(day);
        const liveCurrent = normalizeExerciseLog(liveSession.exercises[effectiveId], exercise.sets);
        const rendered = evaluateAndPersistPerformance(
          currentIndicator,
          liveSession,
          effectiveId,
          liveCurrent,
          previousRaw1,
          previous[0]?.id
        );
        if (!rendered) alert('Servono kg e ripetizioni validi sia oggi sia nella sessione precedente.');
      });

      prev1Indicator.disabled = !previousRaw1 || !previousRaw2;
      prev1Indicator.title = prev1Indicator.disabled
        ? 'Nessuna sessione precedente confrontabile'
        : `Valuta la prestazione del ${shortDate(previous[0]?.date)}`;
      prev1Indicator.addEventListener('click', () => {
        const rendered = evaluateAndPersistPerformance(
          prev1Indicator,
          previous[0],
          effectiveId,
          previousRaw1,
          previousRaw2,
          previous[1]?.id
        );
        if (!rendered) alert('Servono kg e ripetizioni validi in entrambe le sessioni.');
      });

      prev2Indicator.disabled = !previousRaw2 || !previousRaw3;
      prev2Indicator.title = prev2Indicator.disabled
        ? 'Nessuna sessione precedente confrontabile'
        : `Valuta la prestazione del ${shortDate(previous[1]?.date)}`;
      prev2Indicator.addEventListener('click', () => {
        const rendered = evaluateAndPersistPerformance(
          prev2Indicator,
          previous[1],
          effectiveId,
          previousRaw2,
          previousRaw3,
          previous[2]?.id
        );
        if (!rendered) alert('Servono kg e ripetizioni validi in entrambe le sessioni.');
      });

      const machineInput = fragment.querySelector('.machine-input');
      machineInput.value = override.machine || '';
      machineInput.addEventListener('input', () => {
        setExerciseOverride(slotKey, { machine: machineInput.value });
      });

      fragment.querySelector('.exercise-id-value').textContent = effectiveId;
      fragment.querySelector('.edit-id-btn').addEventListener('click', () => {
        openIdModal(day, exercise, slotKey, effectiveId);
      });

      setupMachinePhoto(fragment, slotKey, override);
      fragment.querySelector('.prev-date-1 .history-date-label').textContent = shortDate(previous[0]?.date);
      fragment.querySelector('.prev-date-2 .history-date-label').textContent = shortDate(previous[1]?.date);

      const copyBtn = fragment.querySelector('.copy-last-btn');
      copyBtn.disabled = !hasExerciseSeriesData(prev1);
      copyBtn.title = previous[0]?.date
        ? `Copia valori del ${shortDate(previous[0].date)}`
        : 'Nessun workout precedente da copiare';
      copyBtn.addEventListener('click', () => {
        if (!hasExerciseSeriesData(prev1)) return;
        const target = getOrCreateSession(day);
        target.exercises[effectiveId] = {
          ...normalizeExerciseLog(target.exercises[effectiveId], exercise.sets),
          setCount: prev1.setCount,
          loads: [...prev1.loads],
          reps: [...prev1.reps],
          rir: [...prev1.rir],
        };
        target.updatedAt = Date.now();
        upsertSession(target);
        renderExercises();
      });

      const clearBtn = fragment.querySelector('.clear-today-btn');
      clearBtn.addEventListener('click', () => {
        const target = getOrCreateSession(day);
        target.exercises[effectiveId] = emptyExerciseLog(exercise.sets);
        target.updatedAt = Date.now();
        upsertSession(target);
        renderExercises();
      });

      const tbody = fragment.querySelector('tbody');
      for (let i = 0; i < setCount; i += 1) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${i + 1}</td>
          <td>
            <div class="today-set">
              <label>
                <span>kg</span>
                <input class="load-input" inputmode="decimal" aria-label="${escapeHtml(exercise.name)} serie ${i + 1} carico" value="${escapeHtml(current.loads[i] || '')}">
              </label>
              <label>
                <span>rep</span>
                <input class="reps-input" inputmode="numeric" aria-label="${escapeHtml(exercise.name)} serie ${i + 1} ripetizioni" value="${escapeHtml(current.reps[i] || '')}">
              </label>
              <label>
                <span>RIR</span>
                <input class="rir-input" inputmode="numeric" aria-label="${escapeHtml(exercise.name)} serie ${i + 1} RIR" value="${escapeHtml(current.rir[i] || '')}">
              </label>
            </div>
          </td>
          <td class="history-value">${formatHistoricalSet(prev1, i)}</td>
          <td class="history-value">${formatHistoricalSet(prev2, i)}</td>
        `;

        const loadInput = tr.querySelector('.load-input');
        const repsInput = tr.querySelector('.reps-input');
        const rirInput = tr.querySelector('.rir-input');

        [loadInput, repsInput, rirInput].forEach((input) => {
          input.addEventListener('focus', () => {
            requestAnimationFrame(() => input.select());
          });
        });

        loadInput.addEventListener('input', () => {
          loadInput.value = sanitizeDecimal(loadInput.value);
          updateSeriesField(day, exercise, effectiveId, i, 'loads', loadInput.value);
        });
        repsInput.addEventListener('input', () => {
          repsInput.value = sanitizeInteger(repsInput.value, 3);
          updateSeriesField(day, exercise, effectiveId, i, 'reps', repsInput.value);
        });
        rirInput.addEventListener('input', () => {
          rirInput.value = sanitizeInteger(rirInput.value, 2);
          updateSeriesField(day, exercise, effectiveId, i, 'rir', rirInput.value);
        });
        tbody.appendChild(tr);
      }

      const removeSetBtn = fragment.querySelector('.remove-set-btn');
      const addSetBtn = fragment.querySelector('.add-set-btn');
      removeSetBtn.disabled = setCount <= 1;

      addSetBtn.addEventListener('click', () => {
        const target = getOrCreateSession(day);
        const log = normalizeExerciseLog(target.exercises[effectiveId], exercise.sets);
        const nextCount = log.setCount + 1;
        target.exercises[effectiveId] = {
          ...log,
          setCount: nextCount,
          loads: ensureLength(log.loads, nextCount),
          reps: ensureLength(log.reps, nextCount),
          rir: ensureLength(log.rir, nextCount),
        };
        target.updatedAt = Date.now();
        upsertSession(target);
        renderExercises();
      });

      removeSetBtn.addEventListener('click', () => {
        const target = getOrCreateSession(day);
        const log = normalizeExerciseLog(target.exercises[effectiveId], exercise.sets);
        if (log.setCount <= 1) return;

        const last = log.setCount - 1;
        const hasData = Boolean(log.loads[last] || log.reps[last] || log.rir[last]);
        if (hasData && !confirm('L’ultima serie contiene dati. Rimuoverla?')) return;

        const nextCount = log.setCount - 1;
        target.exercises[effectiveId] = {
          ...log,
          setCount: nextCount,
          loads: log.loads.slice(0, nextCount),
          reps: log.reps.slice(0, nextCount),
          rir: log.rir.slice(0, nextCount),
        };
        target.updatedAt = Date.now();
        upsertSession(target);
        renderExercises();
      });

      const historyOpenBtn = fragment.querySelector('.history-open-btn');
      historyOpenBtn.addEventListener('click', () => {
        openHistoryModal(day, exercise, effectiveId);
      });

      setupStopwatch(fragment);

      const notes = fragment.querySelector('.notes');
      notes.value = current.notes || '';
      notes.addEventListener('input', () => updateNotes(day, exercise, effectiveId, notes.value));

      card.dataset.exerciseId = effectiveId;
      els.exerciseList.appendChild(fragment);
    }
  }

  function startWorkoutTimer() {
    if (!state.plan) return;
    const day = state.plan.days.find((d) => d.id === state.activeDayId);
    if (!day) return;

    const session = getOrCreateSession(day);
    const timer = session.workoutTimer || {};

    // Ignore repeated START only while the timer is currently running.
    // After END, START begins a fresh cycle for the same session.
    if (timer.startedAt && !timer.endedAt) return;

    session.workoutTimer = {
      startedAt: Date.now(),
      endedAt: null,
      durationMs: null,
    };
    session.updatedAt = Date.now();
    upsertSession(session);
    renderWorkoutTotalTimer(session);
  }

  function endWorkoutTimer() {
    if (!state.plan) return;
    const day = state.plan.days.find((d) => d.id === state.activeDayId);
    if (!day) return;

    const session = getOrCreateSession(day);
    const timer = session.workoutTimer;
    if (!timer?.startedAt || timer.endedAt) return;

    const endedAt = Date.now();
    session.workoutTimer = {
      ...timer,
      endedAt,
      durationMs: Math.max(0, endedAt - Number(timer.startedAt)),
    };
    session.updatedAt = Date.now();
    upsertSession(session);
    renderWorkoutTotalTimer(session);
  }

  function renderWorkoutTotalTimer(session) {
    if (state.totalTimerIntervalId) {
      clearInterval(state.totalTimerIntervalId);
      state.totalTimerIntervalId = null;
    }

    const update = () => {
      const timer = session?.workoutTimer || null;
      const startedAt = Number(timer?.startedAt || 0);
      const endedAt = Number(timer?.endedAt || 0);
      const running = startedAt > 0 && endedAt === 0;

      let elapsedMs = 0;
      if (startedAt > 0) {
        elapsedMs = endedAt > 0
          ? Number(timer.durationMs ?? Math.max(0, endedAt - startedAt))
          : Math.max(0, Date.now() - startedAt);
      }

      const formatted = formatWorkoutTotalTime(elapsedMs);
      els.workoutTotalDisplay.textContent = formatted;
      if (els.workoutTotalDisplayTop) els.workoutTotalDisplayTop.textContent = formatted;
      els.workoutStartBtn.disabled = running;
      els.workoutEndBtn.disabled = !running;
    };

    update();

    const timer = session?.workoutTimer || null;
    if (timer?.startedAt && !timer?.endedAt) {
      state.totalTimerIntervalId = window.setInterval(update, 500);
    }
  }

  function formatWorkoutTotalTime(ms) {
    const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function setupStopwatch(fragment) {
    const display = fragment.querySelector('.stopwatch-display');
    const goBtn = fragment.querySelector('.stopwatch-go');
    const pauseBtn = fragment.querySelector('.stopwatch-pause');
    const stopBtn = fragment.querySelector('.stopwatch-stop');
    const resetBtn = fragment.querySelector('.stopwatch-reset');

    const updateLocal = () => {
      if (!display) return;
      display.textContent = formatStopwatch(stopwatchElapsedMs());
      goBtn.disabled = state.stopwatch.running;
      pauseBtn.disabled = !state.stopwatch.running;
      stopBtn.disabled = !state.stopwatch.running && state.stopwatch.elapsedMs === 0;
      resetBtn.disabled = state.stopwatch.running || state.stopwatch.elapsedMs === 0;
    };

    goBtn.addEventListener('click', () => {
      if (state.stopwatch.running) return;
      state.stopwatch.startedAt = Date.now();
      state.stopwatch.running = true;
      ensureStopwatchInterval();
      updateAllStopwatchDisplays();
    });

    pauseBtn.addEventListener('click', () => {
      if (!state.stopwatch.running) return;
      state.stopwatch.elapsedMs = stopwatchElapsedMs();
      state.stopwatch.startedAt = null;
      state.stopwatch.running = false;
      clearStopwatchIntervalIfIdle();
      updateAllStopwatchDisplays();
    });

    stopBtn.addEventListener('click', () => {
      state.stopwatch.elapsedMs = stopwatchElapsedMs();
      state.stopwatch.startedAt = null;
      state.stopwatch.running = false;
      clearStopwatchIntervalIfIdle();
      updateAllStopwatchDisplays();
    });

    resetBtn.addEventListener('click', () => {
      if (state.stopwatch.running) return;
      state.stopwatch.elapsedMs = 0;
      state.stopwatch.startedAt = null;
      updateAllStopwatchDisplays();
    });

    updateLocal();
  }

  function stopwatchElapsedMs() {
    if (!state.stopwatch.running || !state.stopwatch.startedAt) {
      return state.stopwatch.elapsedMs;
    }
    return state.stopwatch.elapsedMs + (Date.now() - state.stopwatch.startedAt);
  }

  function formatStopwatch(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function ensureStopwatchInterval() {
    if (state.stopwatch.intervalId) return;
    state.stopwatch.intervalId = window.setInterval(updateAllStopwatchDisplays, 250);
  }

  function clearStopwatchIntervalIfIdle() {
    if (state.stopwatch.running || !state.stopwatch.intervalId) return;
    clearInterval(state.stopwatch.intervalId);
    state.stopwatch.intervalId = null;
  }

  function updateAllStopwatchDisplays() {
    const text = formatStopwatch(stopwatchElapsedMs());
    document.querySelectorAll('.stopwatch').forEach((wrap) => {
      const display = wrap.querySelector('.stopwatch-display');
      const goBtn = wrap.querySelector('.stopwatch-go');
      const pauseBtn = wrap.querySelector('.stopwatch-pause');
      const stopBtn = wrap.querySelector('.stopwatch-stop');
      const resetBtn = wrap.querySelector('.stopwatch-reset');

      if (display) display.textContent = text;
      if (goBtn) goBtn.disabled = state.stopwatch.running;
      if (pauseBtn) pauseBtn.disabled = !state.stopwatch.running;
      if (stopBtn) stopBtn.disabled = !state.stopwatch.running && state.stopwatch.elapsedMs === 0;
      if (resetBtn) resetBtn.disabled = state.stopwatch.running || state.stopwatch.elapsedMs === 0;
    });
  }

  function updateSeriesField(day, exercise, effectiveId, setIndex, field, value) {
    const session = getOrCreateSession(day);
    const current = normalizeExerciseLog(session.exercises[effectiveId], exercise.sets);
    const values = ensureLength(current[field], current.setCount);
    values[setIndex] = value;
    session.exercises[effectiveId] = { ...current, [field]: values };
    scheduleSave(session);
  }

  function updateNotes(day, exercise, effectiveId, value) {
    const session = getOrCreateSession(day);
    const current = normalizeExerciseLog(session.exercises[effectiveId], exercise.sets);
    session.exercises[effectiveId] = { ...current, notes: value };
    scheduleSave(session);
  }

  function scheduleSave(session) {
    session.updatedAt = Date.now();
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => upsertSession(session), 300);
  }

  function getOrCreateSession(day) {
    const id = `${day.id}:${state.date}`;
    let session = state.store.sessions.find((s) => s.id === id);
    if (!session) {
      session = {
        id,
        date: state.date,
        dayId: day.id,
        exercises: {},
        updatedAt: Date.now(),
      };
      state.store.sessions.push(session);
    }

    for (const exercise of day.exercises) {
      const effectiveId = getExerciseOverride(day, exercise).id || exercise.id;
      session.exercises[effectiveId] = normalizeExerciseLog(session.exercises[effectiveId], exercise.sets);
    }
    return session;
  }

  function getPreviousSessions(dayId, date, limit) {
    return state.store.sessions
      .filter((s) => s.dayId === dayId && s.date < date && hasAnyData(s))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);
  }

  function hasAnyData(session) {
    return Object.values(session.exercises || {}).some((ex) => {
      const normalized = normalizeExerciseLog(ex, Math.max(
        ex?.loads?.length || 0,
        ex?.reps?.length || 0,
        ex?.rir?.length || 0
      ));
      return normalized.loads.some(Boolean)
        || normalized.reps.some(Boolean)
        || normalized.rir.some(Boolean)
        || String(normalized.notes || '').trim().length > 0;
    });
  }

  function hasStoreData(store) {
    return Array.isArray(store?.sessions) && store.sessions.some(hasAnyData);
  }

  function hasExerciseSeriesData(exerciseLog) {
    return exerciseLog.loads.some(Boolean)
      || exerciseLog.reps.some(Boolean)
      || exerciseLog.rir.some(Boolean);
  }

  function upsertSession(session) {
    const idx = state.store.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) state.store.sessions[idx] = session;
    else state.store.sessions.push(session);
    saveStore();
  }

  function emptyExerciseLog(sets) {
    const count = Math.max(1, Number(sets) || 1);
    return {
      setCount: count,
      loads: Array.from({ length: count }, () => ''),
      reps: Array.from({ length: count }, () => ''),
      rir: Array.from({ length: count }, () => ''),
      notes: '',
      performanceEvaluation: null,
    };
  }

  function normalizeExerciseLog(log, sets) {
    const fallbackCount = Math.max(1, Number(sets) || 1);
    if (!log) return emptyExerciseLog(fallbackCount);

    const count = Math.max(1, Number(log.setCount || fallbackCount));
    return {
      setCount: count,
      loads: ensureLength(log.loads || [], count),
      reps: ensureLength(log.reps || [], count),
      rir: ensureLength(log.rir || [], count),
      notes: log.notes || '',
      performanceEvaluation: log.performanceEvaluation || null,
    };
  }

  function ensureLength(values, length) {
    const copy = Array.from(values || []);
    while (copy.length < length) copy.push('');
    return copy.slice(0, length);
  }

  function ensureOverridesStore() {
    if (!state.store.exerciseOverrides || typeof state.store.exerciseOverrides !== 'object') {
      state.store.exerciseOverrides = {};
    }
    return state.store.exerciseOverrides;
  }

  function exerciseSlotKey(day, exercise) {
    return `${day.id}:${exercise.id}`;
  }

  function getExerciseOverride(day, exercise) {
    const overrides = ensureOverridesStore();
    return overrides[exerciseSlotKey(day, exercise)] || {};
  }

  function setExerciseOverride(slotKey, patch, rerender = false) {
    const overrides = ensureOverridesStore();
    overrides[slotKey] = { ...(overrides[slotKey] || {}), ...patch };

    if (patch.machine !== undefined && String(patch.machine).trim() === '') {
      delete overrides[slotKey].machine;
    }
    if (patch.id !== undefined && String(patch.id).trim() === '') {
      delete overrides[slotKey].id;
    }
    if (Object.keys(overrides[slotKey]).length === 0) delete overrides[slotKey];

    saveStore();
    if (rerender) renderExercises();
  }

  function setupMachinePhoto(fragment, slotKey, override) {
    const openBtn = fragment.querySelector('.machine-photo-open');
    const thumb = fragment.querySelector('.machine-photo-thumb');
    const addBtn = fragment.querySelector('.machine-photo-add');
    const changeBtn = fragment.querySelector('.machine-photo-change');
    const removeBtn = fragment.querySelector('.machine-photo-remove');
    const fileInput = fragment.querySelector('.machine-photo-file');

    const version = override.imageVersion || '';
    if (version) {
      const url = machinePhotoUrl(slotKey, version);
      thumb.src = url;
      openBtn.hidden = false;
      addBtn.hidden = true;
      changeBtn.hidden = false;
      removeBtn.hidden = false;
      openBtn.addEventListener('click', () => openPhotoModal(url));
    } else {
      openBtn.hidden = true;
      addBtn.hidden = false;
      changeBtn.hidden = true;
      removeBtn.hidden = true;

      // Recovery path: the JPEG may still exist even if older logbook merges
      // lost imageVersion metadata. Probe once per slot and restore metadata.
      if (!state.photoCheckedSlots.has(slotKey)) {
        state.photoCheckedSlots.add(slotKey);
        const probeVersion = `probe-${Date.now()}`;
        fetch(machinePhotoUrl(slotKey, probeVersion), { cache: 'no-store' })
          .then((response) => {
            if (!response.ok) return;
            setExerciseOverride(slotKey, { imageVersion: Date.now() }, true);
          })
          .catch(() => {});
      }
    }

    addBtn.addEventListener('click', () => fileInput.click());
    changeBtn.addEventListener('click', () => fileInput.click());
    removeBtn.addEventListener('click', async () => {
      if (!confirm('Rimuovere la foto di questa macchina?')) return;

      try {
        setSyncStatus('Rimozione foto…', 'working');
        removeBtn.disabled = true;
        changeBtn.disabled = true;

        const response = await apiFetchUrl(`/api/machine-image?slot=${encodeURIComponent(slotKey)}`, {
          method: 'DELETE',
        });

        if (!response.ok) throw new Error(await responseError(response));

        const overrides = ensureOverridesStore();
        overrides[slotKey] = {
          ...(overrides[slotKey] || {}),
          imageVersion: null,
        };
        state.photoCheckedSlots.add(slotKey);
        saveStore();
        setSyncStatus('Cloud ✓', 'ok');
        renderExercises();
      } catch (error) {
        console.error(error);
        setSyncStatus('Rimozione fallita', 'error');
        alert(error.message || 'Rimozione foto fallita');
      } finally {
        removeBtn.disabled = false;
        changeBtn.disabled = false;
      }
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;

      try {
        setSyncStatus('Foto…', 'working');
        addBtn.disabled = true;
        changeBtn.disabled = true;

        const dataUrl = await resizeImageToJpeg(file, 1000, 0.82);
        const response = await apiFetchUrl('/api/machine-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot: slotKey, dataUrl }),
        });

        if (!response.ok) throw new Error(await responseError(response));
        const payload = await response.json();
        setExerciseOverride(slotKey, { imageVersion: payload.imageVersion || Date.now() }, true);
        setSyncStatus('Cloud ✓', 'ok');
      } catch (error) {
        console.error(error);
        setSyncStatus('Foto fallita', 'error');
        alert(error.message || 'Caricamento foto fallito');
      } finally {
        addBtn.disabled = false;
        changeBtn.disabled = false;
      }
    });
  }

  function machinePhotoUrl(slotKey, version) {
    return `/api/machine-image?slot=${encodeURIComponent(slotKey)}&v=${encodeURIComponent(version || '')}`;
  }

  function openPhotoModal(url) {
    els.photoModalImage.src = url;
    els.photoModal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closePhotoModal() {
    els.photoModal.hidden = true;
    els.photoModalImage.removeAttribute('src');
    document.body.classList.remove('modal-open');
  }

  async function resizeImageToJpeg(file, maxSize, quality) {
    const objectUrl = URL.createObjectURL(file);

    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Impossibile leggere la foto'));
        img.src = objectUrl;
      });

      const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);

      return canvas.toDataURL('image/jpeg', quality);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function apiFetchUrl(url, options = {}, allowPinPrompt = true) {
    const headers = new Headers(options.headers || {});
    const savedPin = localStorage.getItem(PIN_KEY);
    if (savedPin) headers.set('X-Logbook-Pin', savedPin);

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401 && allowPinPrompt) {
      localStorage.removeItem(PIN_KEY);
      const pin = window.prompt('PIN del logbook:');
      if (pin === null) return response;
      localStorage.setItem(PIN_KEY, pin.trim());
      return apiFetchUrl(url, options, false);
    }

    return response;
  }

  function openHistoryModal(day, exercise, effectiveId) {
    state.historyContext = {
      day,
      exercise,
      effectiveId,
      limit: 10,
    };
    els.historyModalTitle.textContent = exercise.name;
    els.historyModalMeta.textContent = `${day.id} · storico esteso`;
    els.historyModal.hidden = false;
    document.body.classList.add('modal-open');
    renderExtendedHistory();
  }

  function closeHistoryModal() {
    state.historyContext = null;
    els.historyModal.hidden = true;
    els.historyModalScroller.innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  function renderExtendedHistory() {
    const ctx = state.historyContext;
    if (!ctx) return;

    const all = getPreviousSessions(ctx.day.id, state.date, Number.MAX_SAFE_INTEGER);
    const visible = all.slice(0, ctx.limit);
    const needed = all.slice(0, Math.min(all.length, ctx.limit + 1));

    els.historyModalScroller.innerHTML = '';

    if (!visible.length) {
      els.historyModalScroller.innerHTML = '<div class="history-empty">Nessuno storico disponibile.</div>';
      els.historyLoadMore.hidden = true;
      return;
    }

    const maxSets = visible.reduce((max, session) => {
      const log = session.exercises?.[ctx.effectiveId];
      return Math.max(max, Number(log?.setCount) || log?.loads?.length || 0);
    }, 1);

    const table = document.createElement('table');
    table.className = 'extended-history-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const seriesHead = document.createElement('th');
    seriesHead.textContent = 'Serie';
    headRow.appendChild(seriesHead);

    visible.forEach((session, index) => {
      const th = document.createElement('th');
      const wrap = document.createElement('div');
      wrap.className = 'extended-history-head';

      const dateLabel = document.createElement('span');
      dateLabel.textContent = shortDate(session.date);

      const indicator = document.createElement('button');
      indicator.type = 'button';
      indicator.className = 'performance-indicator performance-trigger';
      indicator.textContent = '?';

      const currentRaw = session.exercises?.[ctx.effectiveId];
      const previousSession = needed[index + 1];
      const previousRaw = previousSession?.exercises?.[ctx.effectiveId];

      restorePerformanceEvaluation(indicator, currentRaw, previousRaw, previousSession?.id);

      indicator.disabled = !currentRaw || !previousRaw;
      indicator.title = indicator.disabled
        ? 'Nessuna sessione precedente confrontabile'
        : `Valuta la prestazione del ${shortDate(session.date)}`;

      indicator.addEventListener('click', () => {
        const rendered = evaluateAndPersistPerformance(
          indicator,
          session,
          ctx.effectiveId,
          currentRaw,
          previousRaw,
          previousSession?.id
        );
        if (!rendered) alert('Servono kg e ripetizioni validi in entrambe le sessioni.');
      });

      wrap.append(dateLabel, indicator);
      th.appendChild(wrap);
      headRow.appendChild(th);
    });

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let i = 0; i < maxSets; i += 1) {
      const tr = document.createElement('tr');
      const setCell = document.createElement('td');
      setCell.textContent = String(i + 1);
      tr.appendChild(setCell);

      for (const session of visible) {
        const td = document.createElement('td');
        td.className = 'history-value';
        const log = normalizeExerciseLog(session.exercises?.[ctx.effectiveId], Math.max(1, session.exercises?.[ctx.effectiveId]?.setCount || 1));
        td.innerHTML = formatHistoricalSet(log, i);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    els.historyModalScroller.appendChild(table);

    els.historyLoadMore.hidden = visible.length >= all.length;
  }

  function openIdModal(day, exercise, slotKey, effectiveId) {
    state.idEditContext = { day, exercise, slotKey, effectiveId };
    els.idModalInput.value = effectiveId;
    els.idModal.hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(() => {
      els.idModalInput.focus();
      els.idModalInput.select();
    }, 0);
  }

  function closeIdModal() {
    state.idEditContext = null;
    els.idModal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function saveEditedId() {
    const ctx = state.idEditContext;
    if (!ctx) return;

    const nextId = sanitizeExerciseId(els.idModalInput.value);
    if (!nextId) {
      alert('L’ID non può essere vuoto.');
      return;
    }

    if (nextId === ctx.effectiveId) {
      closeIdModal();
      return;
    }

    if (hasDuplicateEffectiveId(ctx.day, ctx.exercise, nextId)) {
      alert(`ID già usato in ${ctx.day.id}: ${nextId}`);
      return;
    }

    setExerciseOverride(ctx.slotKey, { id: nextId }, false);
    closeIdModal();
    renderExercises();
  }

  function hasDuplicateEffectiveId(day, currentExercise, candidateId) {
    return day.exercises.some((exercise) => {
      if (exercise === currentExercise) return false;
      const effectiveId = getExerciseOverride(day, exercise).id || exercise.id;
      return effectiveId === candidateId;
    });
  }

  function sanitizeExerciseId(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9_-]/g, '')
      .replace(/-+/g, '-');
  }

  function emptyStore() {
    return { version: 1, sessions: [], exerciseOverrides: {} };
  }

  function validateStore(store) {
    if (!store || store.version !== 1 || !Array.isArray(store.sessions)) {
      throw new Error('Formato logbook non valido');
    }
  }

  function loadLocalStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return emptyStore();
      const parsed = JSON.parse(raw);
      validateStore(parsed);
      if (!parsed.exerciseOverrides || typeof parsed.exerciseOverrides !== 'object') parsed.exerciseOverrides = {};
      return parsed;
    } catch {
      return emptyStore();
    }
  }

  function saveLocalStore() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.store));
  }

  function saveStore() {
    saveLocalStore();
    state.pendingCloudJson = JSON.stringify(state.store);
    if (state.cloudTimer) clearTimeout(state.cloudTimer);
    state.cloudTimer = setTimeout(flushCloudQueue, 250);
  }

  async function flushCloudQueue() {
    if (state.cloudBusy || !state.pendingCloudJson) return;
    state.cloudBusy = true;

    try {
      while (state.pendingCloudJson) {
        const payload = state.pendingCloudJson;
        state.pendingCloudJson = null;
        setSyncStatus('Salvataggio…', 'working');

        const response = await apiFetch({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });

        if (!response.ok) throw new Error(await responseError(response));
      }
      setSyncStatus('Cloud ✓', 'ok');
    } catch (error) {
      console.error(error);
      setSyncStatus('Sync fallita', 'error');
    } finally {
      state.cloudBusy = false;
      if (state.pendingCloudJson) flushCloudQueue();
    }
  }

  async function pushRemoteNow(store) {
    const response = await apiFetch({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(store),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const payload = await response.json();
    if (payload?.data) {
      validateStore(payload.data);
      state.store = payload.data;
      ensureOverridesStore();
      saveLocalStore();
    }
  }

  async function apiFetch(options = {}, allowPinPrompt = true) {
    const headers = new Headers(options.headers || {});
    const savedPin = localStorage.getItem(PIN_KEY);
    if (savedPin) headers.set('X-Logbook-Pin', savedPin);

    const response = await fetch(API_URL, { ...options, headers });

    if (response.status === 401 && allowPinPrompt) {
      localStorage.removeItem(PIN_KEY);
      const pin = window.prompt('PIN del logbook:');
      if (pin === null) return response;
      localStorage.setItem(PIN_KEY, pin.trim());
      return apiFetch(options, false);
    }

    return response;
  }

  async function responseError(response) {
    try {
      const payload = await response.json();
      return payload?.error || `Errore ${response.status}`;
    } catch {
      return `Errore ${response.status}`;
    }
  }

  function setSyncStatus(text, mode) {
    if (!els.syncStatus) return;
    els.syncStatus.textContent = text;
    els.syncStatus.dataset.mode = mode || '';
  }

  function exportBackup() {
    saveLocalStore();
    const blob = new Blob([JSON.stringify(state.store, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workout-logbook-${localDateISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      validateStore(parsed);
      state.store = parsed;
      ensureOverridesStore();
      saveLocalStore();
      setSyncStatus('Import…', 'working');
      await pushRemoteNow(parsed);
      setSyncStatus('Cloud ✓', 'ok');
      renderExercises();
    } catch (error) {
      console.error(error);
      setSyncStatus('Import fallito', 'error');
      alert(error.message || 'Import fallito');
    }
  }

  function performanceSignature(log) {
    if (!log) return '';
    return JSON.stringify({
      setCount: Number(log.setCount) || 0,
      loads: Array.from(log.loads || []),
      reps: Array.from(log.reps || []),
      rir: Array.from(log.rir || []),
    });
  }

  function evaluateAndPersistPerformance(el, session, exerciseId, currentLog, previousRawLog, previousSessionId) {
    if (!session || !exerciseId || !currentLog || !previousRawLog || !previousSessionId) return false;

    const rendered = renderPerformanceIndicator(el, currentLog, previousRawLog, true);
    if (!rendered) return false;

    const exerciseLog = session.exercises?.[exerciseId];
    if (!exerciseLog) return false;

    exerciseLog.performanceEvaluation = {
      result: comparePerformance(performanceMetrics(currentLog), performanceMetrics(previousRawLog)),
      currentSignature: performanceSignature(currentLog),
      previousSignature: performanceSignature(previousRawLog),
      previousSessionId,
      evaluatedAt: Date.now(),
    };

    session.updatedAt = Date.now();
    saveStore();
    return true;
  }

  function restorePerformanceEvaluation(el, currentLog, previousRawLog, previousSessionId) {
    if (!el || !currentLog || !previousRawLog || !previousSessionId) return false;

    const saved = currentLog.performanceEvaluation;
    if (!saved) return false;

    const valid = saved.currentSignature === performanceSignature(currentLog)
      && saved.previousSignature === performanceSignature(previousRawLog)
      && saved.previousSessionId === previousSessionId;

    if (!valid) return false;
    return renderPerformanceIndicator(el, currentLog, previousRawLog, true);
  }

  function renderPerformanceIndicator(el, currentLog, previousRawLog, keepInteractive = false) {
    if (!el || !currentLog || !previousRawLog) return false;

    const current = performanceMetrics(currentLog);
    const previous = performanceMetrics(previousRawLog);
    if (!current || !previous) return false;

    const result = comparePerformance(current, previous);
    const symbols = { up: '↑', equal: '=', down: '↓' };
    const labels = { up: 'Prestazione migliore', equal: 'Prestazione equivalente', down: 'Prestazione inferiore' };

    el.hidden = false;
    el.className = `performance-indicator performance-${result}${keepInteractive ? ' performance-trigger' : ''}`;
    el.textContent = symbols[result];
    el.title = `${labels[result]} · tonnellaggio ${formatMetric(current.tonnage)} kg vs ${formatMetric(previous.tonnage)} kg · e1RM ${formatMetric(current.e1rm)} vs ${formatMetric(previous.e1rm)}`;
    el.setAttribute('aria-label', el.title);
    return true;
  }

  function performanceMetrics(log) {
    if (!log) return null;

    const loads = Array.from(log.loads || []);
    const reps = Array.from(log.reps || []);
    const rir = Array.from(log.rir || []);
    const count = Math.max(loads.length, reps.length, Number(log.setCount) || 0);

    let tonnage = 0;
    const e1rms = [];

    for (let i = 0; i < count; i += 1) {
      const load = Number(String(loads[i] ?? '').replace(',', '.'));
      const repCount = Number(reps[i]);
      if (!(load > 0) || !(repCount > 0)) continue;

      const rirValue = Number(rir[i]);
      const effectiveReps = repCount + (Number.isFinite(rirValue) && rirValue >= 0 ? rirValue : 0);

      tonnage += load * repCount;
      e1rms.push(load * (1 + effectiveReps / 30));
    }

    if (!e1rms.length || tonnage <= 0) return null;

    return {
      tonnage,
      e1rm: e1rms.reduce((sum, value) => sum + value, 0) / e1rms.length,
    };
  }

  function comparePerformance(current, previous) {
    const strengthRatio = current.e1rm / previous.e1rm;
    const volumeRatio = current.tonnage / previous.tonnage;

    // Forte calo di capacità stimata: il volume extra non basta a chiamarlo progresso.
    if (strengthRatio < 0.95) return 'down';

    // Capacità sostanzialmente mantenuta: decide il lavoro totale.
    if (strengthRatio >= 0.98 && strengthRatio <= 1.02) {
      if (volumeRatio > 1.03) return 'up';
      if (volumeRatio < 0.97) return 'down';
      return 'equal';
    }

    // Capacità chiaramente superiore: verde se il volume non crolla in modo marcato.
    if (strengthRatio > 1.02) {
      if (volumeRatio >= 0.95) return 'up';
      return 'equal';
    }

    // Lieve calo di capacità (2–5%): un volume molto maggiore lo rende equivalente,
    // non migliore; altrimenti è un peggioramento.
    if (volumeRatio > 1.05) return 'equal';
    return 'down';
  }

  function formatMetric(value) {
    return Number(value).toLocaleString('it-IT', { maximumFractionDigits: 1 });
  }

  function formatHistoricalSet(log, index) {
    if (!log) return '—';
    const load = log.loads?.[index] || '';
    const reps = log.reps?.[index] || '';
    const rir = log.rir?.[index] || '';
    if (!load && !reps && rir === '') return '—';

    const main = [];
    if (load) main.push(`${escapeHtml(load)}`);
    if (reps) main.push(`× ${escapeHtml(reps)}`);

    const mainHtml = main.length
      ? `<span class="history-main">${main.join(' ')}</span>`
      : '';
    const rirHtml = rir !== ''
      ? `<span class="history-rir">RIR ${escapeHtml(rir)}</span>`
      : '';

    return `<span class="history-stack">${mainHtml}${rirHtml}</span>`;
  }

  function localDateISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function shortDate(iso) {
    if (!iso) return '—';
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  }

  function sanitizeDecimal(value) {
    const normalized = String(value).replace(',', '.').replace(/[^0-9.]/g, '');
    const firstDot = normalized.indexOf('.');
    if (firstDot < 0) return normalized;
    return normalized.slice(0, firstDot + 1) + normalized.slice(firstDot + 1).replaceAll('.', '');
  }

  function sanitizeInteger(value, maxDigits) {
    return String(value).replace(/[^0-9]/g, '').slice(0, maxDigits);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
})();
