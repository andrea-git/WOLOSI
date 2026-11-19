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
    const previous = getPreviousSessions(day.id, state.date, 2);

    for (const exercise of day.exercises) {
      const fragment = els.template.content.cloneNode(true);
      const card = fragment.querySelector('.exercise-card');
      const slotKey = exerciseSlotKey(day, exercise);
      const override = getExerciseOverride(day, exercise);
      const effectiveId = override.id || exercise.id;
      const current = normalizeExerciseLog(session.exercises[effectiveId], exercise.sets);
      const prev1 = normalizeExerciseLog(previous[0]?.exercises?.[effectiveId], exercise.sets);
      const prev2 = normalizeExerciseLog(previous[1]?.exercises?.[effectiveId], exercise.sets);

      fragment.querySelector('.exercise-name').textContent = exercise.name;
      fragment.querySelector('.exercise-meta').textContent = `${exercise.sets} × ${exercise.reps}${exercise.failure ? ` ${exercise.failure}` : ''}${exercise.optional ? ' · opzionale' : ''}`;
      fragment.querySelector('.exercise-static-note').textContent = exercise.note || '';

      const machineInput = fragment.querySelector('.machine-input');
      machineInput.value = override.machine || '';
      machineInput.addEventListener('input', () => {
        setExerciseOverride(slotKey, { machine: machineInput.value });
      });

      const idInput = fragment.querySelector('.exercise-id-input');
      idInput.value = effectiveId;
      const originalIdValue = effectiveId;
      const commitId = () => {
        const nextId = sanitizeExerciseId(idInput.value);
        if (!nextId) {
          idInput.value = originalIdValue;
          return;
        }
        if (nextId === originalIdValue) {
          idInput.value = nextId;
          return;
        }
        if (hasDuplicateEffectiveId(day, exercise, nextId)) {
          alert(`ID già usato in ${day.id}: ${nextId}`);
          idInput.value = originalIdValue;
          return;
        }
        setExerciseOverride(slotKey, { id: nextId }, true);
      };
      idInput.addEventListener('blur', commitId);
      idInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          idInput.blur();
        }
        if (event.key === 'Escape') {
          idInput.value = originalIdValue;
          idInput.blur();
        }
      });
      fragment.querySelector('.prev-date-1').textContent = shortDate(previous[0]?.date);
      fragment.querySelector('.prev-date-2').textContent = shortDate(previous[1]?.date);

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
      for (let i = 0; i < exercise.sets; i += 1) {
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

      const notes = fragment.querySelector('.notes');
      notes.value = current.notes || '';
      notes.addEventListener('input', () => updateNotes(day, exercise, effectiveId, notes.value));

      card.dataset.exerciseId = effectiveId;
      els.exerciseList.appendChild(fragment);
    }
  }

  function updateSeriesField(day, exercise, effectiveId, setIndex, field, value) {
    const session = getOrCreateSession(day);
    const current = normalizeExerciseLog(session.exercises[effectiveId], exercise.sets);
    const values = ensureLength(current[field], exercise.sets);
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
    return {
      loads: Array.from({ length: sets }, () => ''),
      reps: Array.from({ length: sets }, () => ''),
      rir: Array.from({ length: sets }, () => ''),
      notes: '',
    };
  }

  function normalizeExerciseLog(log, sets) {
    const empty = emptyExerciseLog(sets);
    if (!log) return empty;
    return {
      loads: ensureLength(log.loads || [], sets),
      reps: ensureLength(log.reps || [], sets),
      rir: ensureLength(log.rir || [], sets),
      notes: log.notes || '',
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
