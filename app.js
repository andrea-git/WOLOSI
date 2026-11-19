(() => {
  'use strict';

  const STORE_KEY = 'workout-logbook:v1';
  const state = {
    plan: null,
    activeDayId: 'G1',
    date: localDateISO(),
    store: loadStore(),
    saveTimer: null,
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
  };

  init();

  async function init() {
    wireGlobalEvents();
    els.dateInput.value = state.date;

    try {
      const response = await fetch('./workout.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Impossibile caricare workout.json');
      state.plan = await response.json();
      state.activeDayId = state.plan.days?.[0]?.id || 'G1';
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
      const current = normalizeExerciseLog(session.exercises[exercise.id], exercise.sets);
      const prev1 = normalizeExerciseLog(previous[0]?.exercises?.[exercise.id], exercise.sets);
      const prev2 = normalizeExerciseLog(previous[1]?.exercises?.[exercise.id], exercise.sets);

      fragment.querySelector('.exercise-name').textContent = exercise.name;
      fragment.querySelector('.exercise-meta').textContent = `${exercise.sets} × ${exercise.reps}${exercise.failure ? ` ${exercise.failure}` : ''}${exercise.optional ? ' · opzionale' : ''}`;
      fragment.querySelector('.exercise-static-note').textContent = exercise.note || '';
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
        target.exercises[exercise.id] = {
          ...normalizeExerciseLog(target.exercises[exercise.id], exercise.sets),
          loads: [...prev1.loads],
          reps: [...prev1.reps],
          rir: [...prev1.rir],
        };
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
          updateSeriesField(day, exercise, i, 'loads', loadInput.value);
        });
        repsInput.addEventListener('input', () => {
          repsInput.value = sanitizeInteger(repsInput.value, 3);
          updateSeriesField(day, exercise, i, 'reps', repsInput.value);
        });
        rirInput.addEventListener('input', () => {
          rirInput.value = sanitizeInteger(rirInput.value, 2);
          updateSeriesField(day, exercise, i, 'rir', rirInput.value);
        });
        tbody.appendChild(tr);
      }

      const notes = fragment.querySelector('.notes');
      notes.value = current.notes || '';
      notes.addEventListener('input', () => updateNotes(day, exercise, notes.value));

      card.dataset.exerciseId = exercise.id;
      els.exerciseList.appendChild(fragment);
    }
  }

  function updateSeriesField(day, exercise, setIndex, field, value) {
    const session = getOrCreateSession(day);
    const current = normalizeExerciseLog(session.exercises[exercise.id], exercise.sets);
    const values = ensureLength(current[field], exercise.sets);
    values[setIndex] = value;
    session.exercises[exercise.id] = { ...current, [field]: values };
    scheduleSave(session);
  }

  function updateNotes(day, exercise, value) {
    const session = getOrCreateSession(day);
    const current = normalizeExerciseLog(session.exercises[exercise.id], exercise.sets);
    session.exercises[exercise.id] = { ...current, notes: value };
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
      session.exercises[exercise.id] = normalizeExerciseLog(session.exercises[exercise.id], exercise.sets);
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

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { version: 1, sessions: [] };
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || !Array.isArray(parsed.sessions)) throw new Error('invalid');
      return parsed;
    } catch {
      return { version: 1, sessions: [] };
    }
  }

  function saveStore() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.store));
  }

  function exportBackup() {
    saveStore();
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
      if (parsed?.version !== 1 || !Array.isArray(parsed.sessions)) {
        throw new Error('Formato backup non valido');
      }
      state.store = parsed;
      saveStore();
      renderExercises();
    } catch (error) {
      alert(error.message || 'Import fallito');
    }
  }

  function formatHistoricalSet(log, index) {
    if (!log) return '—';
    const load = log.loads?.[index] || '';
    const reps = log.reps?.[index] || '';
    const rir = log.rir?.[index] || '';
    if (!load && !reps && !rir) return '—';

    const parts = [];
    if (load) parts.push(`${escapeHtml(load)}`);
    if (reps) parts.push(`×${escapeHtml(reps)}`);
    if (rir !== '') parts.push(`R${escapeHtml(rir)}`);
    return parts.join(' ');
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
