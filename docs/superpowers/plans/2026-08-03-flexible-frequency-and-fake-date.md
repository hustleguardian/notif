# Flexible Frequency & Fake Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cadence's "N times per calendar week/month" frequency model with a unified "every X days/weeks/months" rolling cadence, and add a testing panel that lets the user fake "now" to see notification/status behavior without waiting.

**Architecture:** Cadence is a single static `index.html` file (vanilla JS, no build step, no dependencies). This plan extracts the pure date/cycle math into a small standalone `logic.js` module (UMD-style: `window.CadenceLogic` in the browser, `module.exports` under Node), which is the only part of the app that gets automated tests (via Node's built-in `node:test`, zero new dependencies). All DOM/storage wiring stays inline in `index.html` and is verified manually in a browser, since the project has no DOM test tooling and adding one is out of scope.

**Tech Stack:** Vanilla HTML/CSS/JS, `node:test` + `node:assert/strict` (built into Node, no npm install), no framework, no build step.

## Global Constraints

- Static-file app only: `index.html` + `logic.js`, no build step, no npm dependencies, no `package.json`. Must keep working both opened directly (`file://`) and hosted on GitHub Pages.
- Pure cycle/date math lives in `logic.js` so it can be unit-tested with `node --test` without adding tooling.
- All user-facing copy stays in French, matching the existing tone (see current strings in `index.html`).
- The existing storage key `cadence_activities` must not change — preserves the user's already-saved data.
- `target`/`period` fields are fully replaced by `intervalCount`/`intervalUnit`/`createdAt` (per the design doc); legacy data is migrated in place, not kept as a parallel schema.

---

### Task 1: Initialize git repository

**Files:**
- None (repo-level operation)

**Interfaces:**
- N/A

- [ ] **Step 1: Initialize the repo**

Run: `git init` in `c:\dev\notif`

- [ ] **Step 2: Stage and commit existing files**

```bash
git add index.html docs
git commit -m "Initial commit: Cadence app + design docs"
```

- [ ] **Step 3: Verify**

Run: `git log --oneline` — expect one commit containing `index.html` and the `docs/` folder.

---

### Task 2: Create `logic.js` pure calculation module + Node test suite

**Files:**
- Create: `logic.js`
- Create: `logic.test.mjs`

**Interfaces:**
- Produces (used by Task 3 and Task 5 from `index.html` as `CadenceLogic.<fn>` and by other Node test files as `import CadenceLogic from './logic.js'`):
  - `getNow(fakeNowIso: string|null): Date`
  - `nextDueDate(anchorIso: string, intervalCount: number, intervalUnit: 'day'|'week'|'month'): Date`
  - `formatFrequency(intervalCount: number, intervalUnit: 'day'|'week'|'month'): string`
  - `computeCycleStatus({ anchorIso: string, intervalCount: number, intervalUnit: string, now: Date }): { status: 'green'|'amber'|'red', daysLeft: number, daysLate: number, pct: number }`
  - `migrateActivity(act: object, nowIso: string): object`

- [ ] **Step 1: Write the failing test file**

Create `logic.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import CadenceLogic from './logic.js';

const { getNow, nextDueDate, formatFrequency, computeCycleStatus, migrateActivity } = CadenceLogic;

test('getNow returns real date when no fake date given', () => {
  const before = Date.now();
  const now = getNow(null).getTime();
  const after = Date.now();
  assert.ok(now >= before && now <= after);
});

test('getNow returns exact fake date when given', () => {
  const now = getNow('2026-03-01T12:00:00.000Z');
  assert.equal(now.toISOString(), '2026-03-01T12:00:00.000Z');
});

test('nextDueDate: day unit adds N days', () => {
  const due = nextDueDate('2026-01-01T00:00:00.000Z', 3, 'day');
  assert.equal(due.toISOString(), '2026-01-04T00:00:00.000Z');
});

test('nextDueDate: week unit adds N*7 days', () => {
  const due = nextDueDate('2026-01-01T00:00:00.000Z', 2, 'week');
  assert.equal(due.toISOString(), '2026-01-15T00:00:00.000Z');
});

test('nextDueDate: month unit adds N months (mid-month, no overflow)', () => {
  const due = nextDueDate('2026-01-15T00:00:00.000Z', 1, 'month');
  assert.equal(due.toISOString(), '2026-02-15T00:00:00.000Z');
});

test('nextDueDate: month unit rolls over when day overflows target month (JS Date native behavior)', () => {
  // Jan 31 + 1 month -> Feb has 28 days in 2026, so it rolls into March 3.
  const due = nextDueDate('2026-01-31T00:00:00.000Z', 1, 'month');
  assert.equal(due.toISOString(), '2026-03-03T00:00:00.000Z');
});

test('formatFrequency: singular count uses plural noun, no number', () => {
  assert.equal(formatFrequency(1, 'day'), 'tous les jours');
  assert.equal(formatFrequency(1, 'week'), 'toutes les semaines');
  assert.equal(formatFrequency(1, 'month'), 'tous les mois');
});

test('formatFrequency: count > 1 includes the number', () => {
  assert.equal(formatFrequency(3, 'day'), 'tous les 3 jours');
  assert.equal(formatFrequency(2, 'week'), 'toutes les 2 semaines');
  assert.equal(formatFrequency(3, 'month'), 'tous les 3 mois');
});

test('computeCycleStatus: green when well within cycle', () => {
  const now = new Date('2026-01-11T00:00:00.000Z'); // 10 days after anchor
  const anchorIso = '2026-01-01T00:00:00.000Z'; // 30-day cycle
  const result = computeCycleStatus({ anchorIso, intervalCount: 30, intervalUnit: 'day', now });
  assert.equal(result.status, 'green');
  assert.equal(result.daysLeft, 20);
  assert.equal(result.daysLate, 0);
  assert.ok(Math.abs(result.pct - 10 / 30) < 1e-9);
});

test('computeCycleStatus: amber when close to due (<25% remaining)', () => {
  const now = new Date('2026-01-09T00:00:00.000Z'); // 8 days into a 10-day cycle
  const anchorIso = '2026-01-01T00:00:00.000Z';
  const result = computeCycleStatus({ anchorIso, intervalCount: 10, intervalUnit: 'day', now });
  assert.equal(result.status, 'amber');
  assert.equal(result.daysLeft, 2);
  assert.equal(result.daysLate, 0);
});

test('computeCycleStatus: red when overdue', () => {
  const now = new Date('2026-01-13T00:00:00.000Z'); // 2 days past a 10-day cycle from Jan 1
  const anchorIso = '2026-01-01T00:00:00.000Z';
  const result = computeCycleStatus({ anchorIso, intervalCount: 10, intervalUnit: 'day', now });
  assert.equal(result.status, 'red');
  assert.equal(result.daysLeft, 0);
  assert.equal(result.daysLate, 2);
  assert.equal(result.pct, 1);
});

test('computeCycleStatus: red exactly at due instant, daysLate is 0', () => {
  const anchorIso = '2026-01-01T00:00:00.000Z';
  const now = nextDueDate(anchorIso, 10, 'day'); // exactly due
  const result = computeCycleStatus({ anchorIso, intervalCount: 10, intervalUnit: 'day', now });
  assert.equal(result.status, 'red');
  assert.equal(result.daysLate, 0);
});

test('migrateActivity: converts old period/target schema', () => {
  const old = {
    id: 'a1', name: 'Muscu', period: 'week', target: 3,
    completions: ['2026-01-05T00:00:00.000Z', '2026-01-10T00:00:00.000Z'],
  };
  const migrated = migrateActivity(old, '2026-02-01T00:00:00.000Z');
  assert.equal(migrated.intervalUnit, 'week');
  assert.equal(migrated.intervalCount, 1);
  assert.equal(migrated.createdAt, '2026-01-05T00:00:00.000Z');
  assert.equal(migrated.period, undefined);
  assert.equal(migrated.target, undefined);
  assert.equal(migrated.name, 'Muscu');
});

test('migrateActivity: old activity with no completions uses nowIso as createdAt', () => {
  const old = { id: 'a2', name: 'Lecture', period: 'month', target: 1, completions: [] };
  const migrated = migrateActivity(old, '2026-02-01T00:00:00.000Z');
  assert.equal(migrated.createdAt, '2026-02-01T00:00:00.000Z');
});

test('migrateActivity: already-new-schema activity passes through unchanged', () => {
  const act = {
    id: 'a3', name: 'Don de plasma', intervalCount: 2, intervalUnit: 'month',
    createdAt: '2026-01-01T00:00:00.000Z', completions: [],
  };
  const migrated = migrateActivity(act, '2026-02-01T00:00:00.000Z');
  assert.deepEqual(migrated, act);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test logic.test.mjs`
Expected: FAIL — `Cannot find module './logic.js'` (or similar), since `logic.js` doesn't exist yet.

- [ ] **Step 3: Write `logic.js`**

```js
(function (global) {
  const MS_PER_DAY = 86400000;

  function getNow(fakeNowIso) {
    return fakeNowIso ? new Date(fakeNowIso) : new Date();
  }

  function nextDueDate(anchorIso, intervalCount, intervalUnit) {
    const anchor = new Date(anchorIso);
    if (intervalUnit === 'day') {
      return new Date(anchor.getTime() + intervalCount * MS_PER_DAY);
    }
    if (intervalUnit === 'week') {
      return new Date(anchor.getTime() + intervalCount * 7 * MS_PER_DAY);
    }
    if (intervalUnit === 'month') {
      const due = new Date(anchor.getTime());
      due.setMonth(due.getMonth() + intervalCount);
      return due;
    }
    throw new Error('Unknown intervalUnit: ' + intervalUnit);
  }

  function formatFrequency(intervalCount, intervalUnit) {
    const forms = {
      day: { article: 'tous les', plural: 'jours' },
      week: { article: 'toutes les', plural: 'semaines' },
      month: { article: 'tous les', plural: 'mois' },
    };
    const f = forms[intervalUnit];
    if (!f) throw new Error('Unknown intervalUnit: ' + intervalUnit);
    return intervalCount === 1
      ? `${f.article} ${f.plural}`
      : `${f.article} ${intervalCount} ${f.plural}`;
  }

  function computeCycleStatus({ anchorIso, intervalCount, intervalUnit, now }) {
    const anchor = new Date(anchorIso);
    const nextDue = nextDueDate(anchorIso, intervalCount, intervalUnit);
    const totalMs = nextDue.getTime() - anchor.getTime();
    const remainingMs = nextDue.getTime() - now.getTime();

    if (remainingMs <= 0) {
      return {
        status: 'red',
        daysLeft: 0,
        daysLate: Math.max(0, Math.floor(-remainingMs / MS_PER_DAY)),
        pct: 1,
      };
    }

    const ratio = remainingMs / totalMs;
    const status = ratio < 0.25 ? 'amber' : 'green';
    return {
      status,
      daysLeft: Math.ceil(remainingMs / MS_PER_DAY),
      daysLate: 0,
      pct: Math.min(1, Math.max(0, (now.getTime() - anchor.getTime()) / totalMs)),
    };
  }

  function migrateActivity(act, nowIso) {
    if (act.intervalUnit) return act;
    const { period, target, ...rest } = act;
    return {
      ...rest,
      intervalUnit: period || 'week',
      intervalCount: 1,
      createdAt: (act.completions && act.completions[0]) || nowIso,
    };
  }

  const api = { getNow, nextDueDate, formatFrequency, computeCycleStatus, migrateActivity };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.CadenceLogic = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test logic.test.mjs`
Expected: `tests 15`, `pass 15`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add logic.js logic.test.mjs
git commit -m "Add pure cycle-calculation logic module with test coverage"
```

---

### Task 3: Wire `logic.js` into `index.html` — new frequency form + cycle-based rendering

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `CadenceLogic.{getNow, nextDueDate, formatFrequency, computeCycleStatus}` from Task 2.
- Produces: `evalActivity(act, now)` — used later by Task 5 (`checkAndNotify`, `render`) without changes to its signature.
- Activity objects now have shape `{ id, name, intervalCount, intervalUnit, endDate, createdAt, completions }` (no more `period`/`target`).

This task intentionally bundles the form UI, the save/edit handlers, and the render/status logic together — they all depend on the same data shape change, and splitting them would leave the app in a broken intermediate state that a reviewer couldn't sensibly approve.

- [ ] **Step 1: Load `logic.js` in the page**

Find (near the end of `index.html`, right before the main inline script):

```html
</div>

<script>
let activities = [];
```

Replace with:

```html
</div>

<script src="logic.js"></script>
<script>
let activities = [];
```

- [ ] **Step 2: Replace the frequency fields in the "Nouvelle activité" sheet**

Find:

```html
    <div class="freq-row">
      <div class="field">
        <label>Fois</label>
        <input id="fCount" type="number" min="1" value="1">
      </div>
      <div class="field">
        <label>Par</label>
        <select id="fPeriod">
          <option value="week">Semaine</option>
          <option value="month">Mois</option>
        </select>
      </div>
    </div>
```

Replace with:

```html
    <div class="freq-row">
      <div class="field">
        <label>Tous les</label>
        <input id="fIntervalCount" type="number" min="1" value="1">
      </div>
      <div class="field">
        <label>Unité</label>
        <select id="fIntervalUnit">
          <option value="day">Jour(s)</option>
          <option value="week">Semaine(s)</option>
          <option value="month">Mois</option>
        </select>
      </div>
    </div>
```

- [ ] **Step 3: Replace `periodBounds` and `computeStatus` with `evalActivity`**

Find:

```js
function periodBounds(periodType){
  const now = new Date();
  if(periodType === 'week'){
    const day = (now.getDay() + 6) % 7; // Monday = 0
    const start = new Date(now); start.setHours(0,0,0,0); start.setDate(now.getDate() - day);
    const end = new Date(start); end.setDate(start.getDate() + 7);
    return {start, end, length: 7};
  } else {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth()+1, 1);
    const length = (end - start) / 86400000;
    return {start, end, length};
  }
}

function computeStatus(act){
  const now = new Date();
  if(act.endDate){
    const end = new Date(act.endDate + 'T23:59:59');
    if(now > end){
      return {count:0, target: act.target, status:'ended', daysLeft:0};
    }
  }
  const {start, end, length} = periodBounds(act.period);
  const count = act.completions.filter(ts => { const d = new Date(ts); return d >= start && d < end; }).length;
  const daysLeft = Math.max((end - now) / 86400000, 0);
  const ratio = daysLeft / length;
  let status = 'amber';
  if(count >= act.target) status = 'green';
  else if(ratio < 0.25) status = 'red';
  return {count, target: act.target, status, daysLeft: Math.ceil(daysLeft)};
}
```

Replace with:

```js
function evalActivity(act, now){
  if(act.endDate){
    const end = new Date(act.endDate + 'T23:59:59');
    if(now > end){
      return { status: 'ended', daysLeft: 0, daysLate: 0, pct: 1 };
    }
  }
  const anchorIso = act.completions.length
    ? act.completions[act.completions.length - 1]
    : act.createdAt;
  return CadenceLogic.computeCycleStatus({
    anchorIso, intervalCount: act.intervalCount, intervalUnit: act.intervalUnit, now,
  });
}
```

- [ ] **Step 4: Update `render()` to use `evalActivity` and `formatFrequency`**

Find the whole `render()` function (from `function render(){` through its closing `}`, right before `function escapeHtml`) and replace it with:

```js
function render(){
  const list = document.getElementById('list');
  const empty = document.getElementById('empty');
  const banner = document.getElementById('banner');

  if(activities.length === 0){
    list.innerHTML = '';
    empty.style.display = 'block';
    banner.classList.remove('show');
    return;
  }
  empty.style.display = 'none';

  const now = new Date();
  const overdue = [];
  const sorted = [...activities].sort((a,b) => {
    const ea = evalActivity(a, now).status === 'ended' ? 1 : 0;
    const eb = evalActivity(b, now).status === 'ended' ? 1 : 0;
    return ea - eb;
  });

  list.innerHTML = sorted.map(act => {
    const st = evalActivity(act, now);
    const color = colorFor(st.status);
    const freqLabel = CadenceLogic.formatFrequency(act.intervalCount, act.intervalUnit);
    const labels = {green:'à jour', red:'urgent', amber:'à faire', ended:'terminé'};
    const tagClass = st.status === 'ended' ? 'grey' : st.status;
    if(st.status === 'red') overdue.push(act.name);

    let freqLine;
    if(st.status === 'ended'){
      const endStr = new Date(act.endDate + 'T00:00:00').toLocaleDateString('fr-FR');
      freqLine = `${freqLabel} · terminé le ${endStr}`;
    } else if(act.endDate){
      const endStr = new Date(act.endDate + 'T00:00:00').toLocaleDateString('fr-FR');
      freqLine = `${freqLabel} · jusqu'au ${endStr}`;
    } else if(st.status === 'red'){
      freqLine = st.daysLate === 0 ? `${freqLabel} · en retard aujourd'hui` : `${freqLabel} · en retard de ${st.daysLate}j`;
    } else {
      freqLine = st.daysLeft === 0 ? `${freqLabel} · prochain aujourd'hui` : `${freqLabel} · prochain dans ${st.daysLeft}j`;
    }

    const dialCenter = st.status === 'ended' ? '✓'
      : st.status === 'red' ? (st.daysLate === 0 ? 'Auj.' : st.daysLate + 'j')
      : (st.daysLeft === 0 ? 'Auj.' : st.daysLeft + 'j');

    return `
      <div class="card ${st.status === 'ended' ? 'ended' : ''}">
        <div class="dial">${dialSVG(st.status === 'ended' ? 1 : st.pct, color)}
          <div class="count">${dialCenter}</div>
        </div>
        <div class="info">
          <p class="name" onclick="openEdit('${act.id}')">${escapeHtml(act.name)}</p>
          <div class="freq">${freqLine}</div>
          <span class="tag ${tagClass}">${labels[st.status]}</span>
        </div>
        <div class="actions">
          ${st.status === 'ended' ? '' : `<button class="btn-check" onclick="markDone('${act.id}')">Fait ✓</button>`}
          <button class="btn-del" onclick="removeActivity('${act.id}')">Supprimer</button>
        </div>
      </div>
    `;
  }).join('');

  if(overdue.length > 0){
    banner.classList.add('show');
    banner.innerHTML = `<b>En retard :</b> ${overdue.map(escapeHtml).join(', ')}. Marque-les si c'est fait, ou prends rendez-vous.`;
  } else {
    banner.classList.remove('show');
  }
}
```

- [ ] **Step 5: Update the "add" button handler**

Find:

```js
document.getElementById('addBtn').onclick = () => {
  editingId = null;
  document.getElementById('sheetTitle').textContent = 'Nouvelle activité';
  document.getElementById('fName').value = '';
  document.getElementById('fCount').value = 1;
  document.getElementById('fPeriod').value = 'week';
  fEndDate.value = '';
  setDurationMode(false);
  sheetBg.classList.add('show');
};
```

Replace with:

```js
document.getElementById('addBtn').onclick = () => {
  editingId = null;
  document.getElementById('sheetTitle').textContent = 'Nouvelle activité';
  document.getElementById('fName').value = '';
  document.getElementById('fIntervalCount').value = 1;
  document.getElementById('fIntervalUnit').value = 'week';
  fEndDate.value = '';
  setDurationMode(false);
  sheetBg.classList.add('show');
};
```

- [ ] **Step 6: Update `openEdit`**

Find:

```js
function openEdit(id){
  const act = activities.find(a => a.id === id);
  if(!act) return;
  editingId = id;
  document.getElementById('sheetTitle').textContent = 'Modifier l\'activité';
  document.getElementById('fName').value = act.name;
  document.getElementById('fCount').value = act.target;
  document.getElementById('fPeriod').value = act.period;
  if(act.endDate){
```

Replace the middle lines with:

```js
function openEdit(id){
  const act = activities.find(a => a.id === id);
  if(!act) return;
  editingId = id;
  document.getElementById('sheetTitle').textContent = 'Modifier l\'activité';
  document.getElementById('fName').value = act.name;
  document.getElementById('fIntervalCount').value = act.intervalCount;
  document.getElementById('fIntervalUnit').value = act.intervalUnit;
  if(act.endDate){
```

- [ ] **Step 7: Update the "save" button handler**

Find:

```js
document.getElementById('saveBtn').onclick = async () => {
  const name = document.getElementById('fName').value.trim();
  const count = parseInt(document.getElementById('fCount').value, 10) || 1;
  const period = document.getElementById('fPeriod').value;
  const limited = segLimited.classList.contains('active');
  const endDate = limited ? fEndDate.value : null;
  if(!name) return;
  if(limited && !endDate) return;

  if(editingId){
    const act = activities.find(a => a.id === editingId);
    if(act){
      act.name = name; act.target = count; act.period = period; act.endDate = endDate;
    }
  } else {
    activities.push({ id: uid(), name, target: count, period, endDate, completions: [] });
  }
  await saveData();
  sheetBg.classList.remove('show');
  render();
};
```

Replace with:

```js
document.getElementById('saveBtn').onclick = async () => {
  const name = document.getElementById('fName').value.trim();
  const intervalCount = parseInt(document.getElementById('fIntervalCount').value, 10) || 1;
  const intervalUnit = document.getElementById('fIntervalUnit').value;
  const limited = segLimited.classList.contains('active');
  const endDate = limited ? fEndDate.value : null;
  if(!name) return;
  if(limited && !endDate) return;

  if(editingId){
    const act = activities.find(a => a.id === editingId);
    if(act){
      act.name = name; act.intervalCount = intervalCount; act.intervalUnit = intervalUnit; act.endDate = endDate;
    }
  } else {
    activities.push({
      id: uid(), name, intervalCount, intervalUnit, endDate,
      createdAt: new Date().toISOString(),
      completions: [],
    });
  }
  await saveData();
  sheetBg.classList.remove('show');
  render();
};
```

- [ ] **Step 8: Update `checkAndNotify` to use `evalActivity`**

Find:

```js
function checkAndNotify(){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const overdue = activities.filter(a => computeStatus(a).status === 'red');
  if(overdue.length > 0){
```

Replace with:

```js
function checkAndNotify(){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  const overdue = activities.filter(a => evalActivity(a, now).status === 'red');
  if(overdue.length > 0){
```

- [ ] **Step 9: Manual browser verification**

Open `index.html` directly in a browser (double-click, or `start index.html`).

1. Confirm the page loads with no console errors (F12 → Console tab).
2. Click "+ Ajouter une activité". Fill: nom "A jour", "Tous les" = 1, unité = Jour(s). Save. Confirm the card shows "à jour" (green), "tous les jours · prochain aujourd'hui" (since it's due the same day it was created).
3. Add "B semaine": Tous les 2, Semaine(s). Confirm "toutes les 2 semaines · prochain dans 14j", green.
4. Add "C mois": Tous les 3, Mois. Confirm "tous les 3 mois · prochain dans ~90j" (exact number depends on month lengths), green.
5. In devtools console, force "A jour" overdue:
   ```js
   let acts = JSON.parse(localStorage.getItem('cadence_activities'));
   acts[0].createdAt = new Date(Date.now() - 5*86400000).toISOString();
   localStorage.setItem('cadence_activities', JSON.stringify(acts));
   location.reload();
   ```
   Confirm "A jour" now shows red "urgent" tag, "tous les jours · en retard de 4j", and the top red banner lists "A jour".
6. Click the "A jour" name to edit it — confirm the "Tous les"/unité fields are pre-filled (1 / Jour(s)), change to 2 / Semaine(s), save, confirm the card updates accordingly.
7. Click "Supprimer" on one card, confirm it's removed from the list and from `localStorage.getItem('cadence_activities')`.

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "Replace N-times-per-period frequency with rolling every-X-unit cadence"
```

---

### Task 4: Migrate legacy activity data on load

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `CadenceLogic.migrateActivity` from Task 2.
- Produces: `loadData()` now guarantees every activity in `activities` has `intervalCount`/`intervalUnit`/`createdAt` by the time `render()` runs, regardless of what schema was in storage.

- [ ] **Step 1: Update `loadData` to migrate on load**

Find:

```js
async function loadData(){
  try{
    if(hasCloudStorage){
      const res = await window.storage.get('activities', false);
      activities = res ? JSON.parse(res.value) : [];
    } else {
      const raw = localStorage.getItem('cadence_activities');
      activities = raw ? JSON.parse(raw) : [];
    }
  }catch(e){
    activities = [];
  }
  render();
}
```

Replace with:

```js
async function loadData(){
  try{
    if(hasCloudStorage){
      const res = await window.storage.get('activities', false);
      activities = res ? JSON.parse(res.value) : [];
    } else {
      const raw = localStorage.getItem('cadence_activities');
      activities = raw ? JSON.parse(raw) : [];
    }
  }catch(e){
    activities = [];
  }
  const nowIso = new Date().toISOString();
  const migrated = activities.map(act => CadenceLogic.migrateActivity(act, nowIso));
  const didMigrate = migrated.some((act, i) => act !== activities[i]);
  activities = migrated;
  if(didMigrate) await saveData();
  render();
}
```

- [ ] **Step 2: Manual browser verification**

1. With the app open, inject a legacy-schema activity via devtools console:
   ```js
   localStorage.setItem('cadence_activities', JSON.stringify([
     { id:'legacy1', name:'Ancien rituel', period:'month', target:2, endDate:null, completions:['2026-01-05T00:00:00.000Z'] }
   ]));
   location.reload();
   ```
2. Confirm the card renders with no console errors and shows "tous les mois" as the frequency label.
3. In the console, run `JSON.parse(localStorage.getItem('cadence_activities'))[0]` and confirm the *persisted* value now has `intervalUnit:'month'`, `intervalCount:1`, `createdAt:'2026-01-05T00:00:00.000Z'`, and no `period`/`target` keys — this checks the migration was saved back, not just applied in memory.
4. Reload again and confirm nothing changes (migration is idempotent — `didMigrate` should be `false` on the second load).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Migrate legacy period/target activities to the new interval schema on load"
```

---

### Task 5: Add fake-date "Mode test" panel and route all "now" through it

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `CadenceLogic.getNow` from Task 2, `evalActivity`/`render`/`checkAndNotify`/`markDone`/`loadData` from Tasks 3–4.
- Produces: `appNow(): Date` — the single source of truth for "now" everywhere in the app from this task onward.

- [ ] **Step 1: Add CSS for the test panel**

Find:

```css
  ::selection{background:rgba(63,191,174,0.3);}
```

Replace with:

```css
  .test-panel{
    margin-top:24px;
    background:var(--card);
    border:1px solid var(--line);
    border-radius:14px;
    padding:12px 16px;
    color:var(--muted);
  }
  .test-panel summary{
    cursor:pointer;
    font-family:'Space Mono', monospace;
    font-size:11px;
    letter-spacing:.1em;
    text-transform:uppercase;
    color:var(--text);
  }
  .test-panel .field{margin-top:12px; margin-bottom:0;}
  .test-panel-actions{
    display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:10px;
  }
  .test-panel-actions span{font-size:12px;}
  .test-panel-actions button{
    background:none; border:1px solid var(--line); color:var(--text);
    padding:6px 10px; border-radius:8px; font-size:12px; font-family:inherit; cursor:pointer;
  }

  ::selection{background:rgba(63,191,174,0.3);}
```

- [ ] **Step 2: Add the test panel markup**

Find:

```html
  <div class="empty" id="empty" style="display:none;">
    <div class="glyph">◐</div>
    <div>Aucun rituel pour l'instant.<br>Ajoute la première activité à suivre.</div>
  </div>
</div>
```

Replace with:

```html
  <div class="empty" id="empty" style="display:none;">
    <div class="glyph">◐</div>
    <div>Aucun rituel pour l'instant.<br>Ajoute la première activité à suivre.</div>
  </div>
  <details class="test-panel" id="testPanel">
    <summary>Mode test</summary>
    <div class="field">
      <label>Date simulée</label>
      <input id="fakeNowInput" type="datetime-local">
    </div>
    <div class="test-panel-actions">
      <span id="fakeNowStatus">Date réelle</span>
      <button type="button" id="resetFakeNowBtn">Réinitialiser</button>
    </div>
  </details>
</div>
```

- [ ] **Step 3: Add `fakeNow` state, `appNow()`, and storage helpers**

Find:

```js
let activities = [];
let editingId = null;

function uid(){ return 'a_' + Date.now() + '_' + Math.floor(Math.random()*10000); }
```

Replace with:

```js
let activities = [];
let editingId = null;
let fakeNow = null;

function uid(){ return 'a_' + Date.now() + '_' + Math.floor(Math.random()*10000); }

function appNow(){ return CadenceLogic.getNow(fakeNow); }

async function loadFakeNow(){
  try{
    if(hasCloudStorage){
      const res = await window.storage.get('fakeNow', false);
      return res ? res.value : null;
    } else {
      return localStorage.getItem('cadence_fake_now');
    }
  }catch(e){
    return null;
  }
}

async function saveFakeNow(iso){
  try{
    if(hasCloudStorage){
      await window.storage.set('fakeNow', iso || '', false);
    } else {
      if(iso) localStorage.setItem('cadence_fake_now', iso);
      else localStorage.removeItem('cadence_fake_now');
    }
  }catch(e){
    console.error('Erreur de sauvegarde', e);
  }
}

function toDatetimeLocalValue(date){
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function refreshFakeNowUI(){
  const input = document.getElementById('fakeNowInput');
  const status = document.getElementById('fakeNowStatus');
  if(fakeNow){
    input.value = toDatetimeLocalValue(new Date(fakeNow));
    status.textContent = 'Date simulée : ' + new Date(fakeNow).toLocaleString('fr-FR');
  } else {
    input.value = '';
    status.textContent = 'Date réelle';
  }
}
```

- [ ] **Step 4: Load `fakeNow` at startup and use it in migration**

Find (this is the version from Task 4):

```js
async function loadData(){
  try{
    if(hasCloudStorage){
      const res = await window.storage.get('activities', false);
      activities = res ? JSON.parse(res.value) : [];
    } else {
      const raw = localStorage.getItem('cadence_activities');
      activities = raw ? JSON.parse(raw) : [];
    }
  }catch(e){
    activities = [];
  }
  const nowIso = new Date().toISOString();
  const migrated = activities.map(act => CadenceLogic.migrateActivity(act, nowIso));
  const didMigrate = migrated.some((act, i) => act !== activities[i]);
  activities = migrated;
  if(didMigrate) await saveData();
  render();
}
```

Replace with:

```js
async function loadData(){
  fakeNow = await loadFakeNow();
  try{
    if(hasCloudStorage){
      const res = await window.storage.get('activities', false);
      activities = res ? JSON.parse(res.value) : [];
    } else {
      const raw = localStorage.getItem('cadence_activities');
      activities = raw ? JSON.parse(raw) : [];
    }
  }catch(e){
    activities = [];
  }
  const nowIso = appNow().toISOString();
  const migrated = activities.map(act => CadenceLogic.migrateActivity(act, nowIso));
  const didMigrate = migrated.some((act, i) => act !== activities[i]);
  activities = migrated;
  if(didMigrate) await saveData();
  refreshFakeNowUI();
  render();
}
```

- [ ] **Step 5: Route `render()`, `checkAndNotify()`, `markDone()`, and new-activity `createdAt` through `appNow()`**

In `render()`, find:

```js
  const now = new Date();
  const overdue = [];
```

Replace with:

```js
  const now = appNow();
  const overdue = [];
```

In `checkAndNotify()`, find:

```js
function checkAndNotify(){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  const overdue = activities.filter(a => evalActivity(a, now).status === 'red');
```

Replace with:

```js
function checkAndNotify(){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = appNow();
  const overdue = activities.filter(a => evalActivity(a, now).status === 'red');
```

In `markDone`, find:

```js
async function markDone(id){
  const act = activities.find(a => a.id === id);
  if(!act) return;
  act.completions.push(new Date().toISOString());
  await saveData();
  render();
}
```

Replace with:

```js
async function markDone(id){
  const act = activities.find(a => a.id === id);
  if(!act) return;
  act.completions.push(appNow().toISOString());
  await saveData();
  render();
}
```

In the save button handler, find:

```js
    activities.push({
      id: uid(), name, intervalCount, intervalUnit, endDate,
      createdAt: new Date().toISOString(),
      completions: [],
    });
```

Replace with:

```js
    activities.push({
      id: uid(), name, intervalCount, intervalUnit, endDate,
      createdAt: appNow().toISOString(),
      completions: [],
    });
```

- [ ] **Step 6: Wire the test panel controls**

Find:

```js
// Check on load, and every 30 min while the app stays open
loadData().then(refreshNotifUI);
setInterval(checkAndNotify, 30*60*1000);
```

Replace with:

```js
document.getElementById('fakeNowInput').onchange = async (e) => {
  const val = e.target.value;
  fakeNow = val ? new Date(val).toISOString() : null;
  await saveFakeNow(fakeNow);
  refreshFakeNowUI();
  render();
};

document.getElementById('resetFakeNowBtn').onclick = async () => {
  fakeNow = null;
  await saveFakeNow(null);
  refreshFakeNowUI();
  render();
};

// Check on load, and every 30 min while the app stays open
loadData().then(refreshNotifUI);
setInterval(checkAndNotify, 30*60*1000);
```

- [ ] **Step 7: Manual browser verification**

1. Reload the app fresh. Confirm the "Mode test" panel appears collapsed at the bottom; clicking its summary expands it to show a date/time field and "Date réelle".
2. Add an activity "Test fake" — tous les 2 jours.
3. In the test panel, set the date field to 3 days in the future and blur/change it. Confirm: the status text updates to "Date simulée : ...", and "Test fake" flips to red "urgent" with "en retard de 1j".
4. Reload the page (F5). Confirm the fake date is still active (persisted) and the card is still red.
5. Grant notification permission if not already granted (click "Activer" in the notifications row). In devtools console, run `checkAndNotify()` and confirm a native notification appears mentioning "Test fake".
6. Click "Réinitialiser" in the test panel. Confirm the status returns to "Date réelle", the date field clears, "Test fake" recalculates based on real time, and this also survives a reload.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Add fake-date test panel so notification/status behavior can be tested without waiting"
```

---

### Task 6: End-to-end manual verification pass

**Files:**
- None (verification only)

**Interfaces:**
- N/A

- [ ] **Step 1: Full regression checklist in a browser**

Open `index.html` fresh (clear `localStorage` first via devtools: `localStorage.clear()`, then reload).

1. Empty state: confirm the "Aucun rituel..." message shows.
2. Add one activity per unit: "Daily" (tous les 1 jour), "Weekly" (tous les 1 semaine), "Every 3 days" (tous les 3 jours), "Biweekly" (tous les 2 semaines), "Monthly" (tous les 1 mois), "Quarterly" (tous les 3 mois). Confirm each renders with the correct French label and a green "à jour" tag.
3. Click "Fait ✓" on "Every 3 days". Confirm its dial resets (near-empty ring) and the frequency line still reads "tous les 3 jours · prochain dans 3j".
4. Add an activity with "Jusqu'à une date" set to yesterday's date. Confirm it renders as "ended" (greyed out, ✓ dial, "terminé le ...", no "Fait"/only "Supprimer" button).
5. Use the "Mode test" panel to jump the fake date forward past "Weekly"'s due date. Confirm it turns red and appears in the top red banner, while unrelated activities (like the "ended" one) are unaffected.
6. Reset the fake date. Delete one activity and confirm it's gone from both the UI and `localStorage.getItem('cadence_activities')`.
7. Check the browser console throughout steps 1–6: zero errors or warnings.

- [ ] **Step 2: Re-run the automated logic tests one last time**

Run: `node --test logic.test.mjs`
Expected: all tests still pass (no regressions from the `index.html` edits, since they don't touch `logic.js`).

- [ ] **Step 3: Final commit (if any cleanup was needed)**

If Step 1 uncovered any bugs and you fixed them:

```bash
git add index.html logic.js
git commit -m "Fix issues found in end-to-end verification"
```

If nothing needed fixing, skip this step — Task 5's commit is the final state.
