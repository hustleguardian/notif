import test from 'node:test';
import assert from 'node:assert/strict';
import CadenceLogic from './logic.js';

const {
  getNow, nextDueDate, formatFrequency, computeCycleStatus, migrateActivity,
  dateStrDaysAgo, completionIsoForDateStr, evalActivity, buildDigest,
  formatDigestNotification, nextCheckpointToFire, isOutstanding,
  priorityLabel, sortTodos, undoLastCompletionPeriod,
} = CadenceLogic;

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

test('dateStrDaysAgo: 0 days ago returns the same local calendar date', () => {
  const now = new Date(2026, 2, 15, 9, 30); // 2026-03-15, local time
  assert.equal(dateStrDaysAgo(now, 0), '2026-03-15');
});

test('dateStrDaysAgo: 1 day ago returns yesterday', () => {
  const now = new Date(2026, 2, 15, 9, 30);
  assert.equal(dateStrDaysAgo(now, 1), '2026-03-14');
});

test('dateStrDaysAgo: 2 days ago returns the day before yesterday', () => {
  const now = new Date(2026, 2, 15, 9, 30);
  assert.equal(dateStrDaysAgo(now, 2), '2026-03-13');
});

test('dateStrDaysAgo: crosses a month boundary correctly', () => {
  const now = new Date(2026, 2, 1, 9, 30); // 2026-03-01
  assert.equal(dateStrDaysAgo(now, 1), '2026-02-28'); // Feb 2026 has 28 days
});

test('dateStrDaysAgo: crosses a year boundary correctly', () => {
  const now = new Date(2026, 0, 1, 9, 30); // 2026-01-01
  assert.equal(dateStrDaysAgo(now, 1), '2025-12-31');
});

test('completionIsoForDateStr: produces a timestamp at local noon on the given date', () => {
  const iso = completionIsoForDateStr('2026-03-15');
  const d = new Date(iso);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 2);
  assert.equal(d.getDate(), 15);
  assert.equal(d.getHours(), 12);
  assert.equal(d.getMinutes(), 0);
});

test('completionIsoForDateStr composed with dateStrDaysAgo backdates to the right day', () => {
  const now = new Date(2026, 2, 15, 9, 30);
  const iso = completionIsoForDateStr(dateStrDaysAgo(now, 1));
  const d = new Date(iso);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 2);
  assert.equal(d.getDate(), 14);
});

// --- evalActivity ---

test('evalActivity: ended activity (endDate passed) returns status ended', () => {
  const act = {
    intervalCount: 1, intervalUnit: 'day', createdAt: '2026-01-01T00:00:00.000Z',
    completions: [], endDate: '2026-01-05',
  };
  const now = new Date('2026-01-10T00:00:00.000Z');
  const result = evalActivity(act, now);
  assert.equal(result.status, 'ended');
});

test('evalActivity: no completions anchors on createdAt', () => {
  const act = {
    intervalCount: 10, intervalUnit: 'day', createdAt: '2026-01-01T00:00:00.000Z',
    completions: [], endDate: null,
  };
  const now = new Date('2026-01-11T00:00:00.000Z'); // exactly at due instant
  const result = evalActivity(act, now);
  assert.equal(result.status, 'red');
});

test('evalActivity: anchors on the most recent completion, not createdAt', () => {
  const act = {
    intervalCount: 10, intervalUnit: 'day', createdAt: '2020-01-01T00:00:00.000Z',
    completions: ['2026-01-01T00:00:00.000Z', '2026-01-05T00:00:00.000Z'], endDate: null,
  };
  const now = new Date('2026-01-06T00:00:00.000Z'); // 1 day after the latest completion
  const result = evalActivity(act, now);
  assert.equal(result.status, 'green');
});

// --- buildDigest ---

test('buildDigest: groups amber/red activities by unit, ignores green ones that have been completed', () => {
  const now = new Date('2026-01-11T00:00:00.000Z');
  const activities = [
    { name: 'Overdue daily', intervalCount: 10, intervalUnit: 'day', createdAt: '2026-01-01T00:00:00.000Z', completions: [], endDate: null },
    { name: 'Recently done weekly', intervalCount: 1, intervalUnit: 'week', createdAt: '2026-01-01T00:00:00.000Z', completions: [now.toISOString()], endDate: null },
  ];
  const digest = buildDigest(activities, [], now);
  assert.deepEqual(digest.today, ['Overdue daily']);
  assert.deepEqual(digest.week, []);
});

test('buildDigest: excludes ended activities entirely', () => {
  const now = new Date('2026-01-11T00:00:00.000Z');
  const activities = [
    { name: 'Old one', intervalCount: 1, intervalUnit: 'day', createdAt: '2020-01-01T00:00:00.000Z', completions: [], endDate: '2020-02-01' },
  ];
  const digest = buildDigest(activities, [], now);
  assert.deepEqual(digest.today, []);
  assert.equal(digest.hasDayActivities, false);
});

test('buildDigest: hasDayActivities is true when a green never-completed day activity exists', () => {
  const now = new Date('2026-01-11T00:00:00.000Z');
  const activities = [
    { name: 'Never done', intervalCount: 5, intervalUnit: 'day', createdAt: now.toISOString(), completions: [], endDate: null },
  ];
  const digest = buildDigest(activities, [], now);
  assert.equal(digest.hasDayActivities, true);
});

test('buildDigest: a green activity that HAS been completed does not appear as outstanding', () => {
  const now = new Date('2026-01-11T00:00:00.000Z');
  const activities = [
    { name: 'Recently done', intervalCount: 5, intervalUnit: 'day', createdAt: '2026-01-01T00:00:00.000Z', completions: [now.toISOString()], endDate: null },
  ];
  const digest = buildDigest(activities, [], now);
  assert.deepEqual(digest.today, []);
});

test('buildDigest: a fresh "tous les jours" (daily) activity appears in today even though it is green', () => {
  const now = new Date(2026, 2, 15, 10, 0);
  const activities = [
    { name: 'Muscu', intervalCount: 1, intervalUnit: 'day', createdAt: now.toISOString(), completions: [], endDate: null },
  ];
  const digest = buildDigest(activities, [], now);
  assert.deepEqual(digest.today, ['Muscu']);
});

test('buildDigest: a "tous les jours" activity drops out of today once completed today', () => {
  const now = new Date(2026, 2, 15, 15, 0);
  const activities = [
    {
      name: 'Muscu', intervalCount: 1, intervalUnit: 'day',
      createdAt: new Date(2026, 2, 14, 10, 0).toISOString(),
      completions: [new Date(2026, 2, 15, 10, 0).toISOString()],
      endDate: null,
    },
  ];
  const digest = buildDigest(activities, [], now);
  assert.deepEqual(digest.today, []);
});

test('buildDigest: a non-literal-daily cadence ("tous les 3 jours") already completed uses the amber/red rule, not completed-today', () => {
  const now = new Date(2026, 2, 15, 10, 0);
  const activities = [
    { name: 'Every 3 days', intervalCount: 3, intervalUnit: 'day', createdAt: '2026-02-01T00:00:00.000Z', completions: [now.toISOString()], endDate: null },
  ];
  const digest = buildDigest(activities, [], now);
  // Just completed, still green (plenty of time left in this 3-day cycle) — should NOT
  // show up in today's digest, unlike a literal "tous les jours" habit which would.
  assert.deepEqual(digest.today, []);
});

// --- isOutstanding ---

test('isOutstanding: a fresh "tous les jours" habit is outstanding (not done today yet)', () => {
  const now = new Date(2026, 2, 15, 10, 0);
  const act = { intervalCount: 1, intervalUnit: 'day', createdAt: now.toISOString(), completions: [], endDate: null };
  assert.equal(isOutstanding(act, now), true);
});

test('isOutstanding: a "tous les jours" habit already completed today is not outstanding', () => {
  const now = new Date(2026, 2, 15, 15, 0);
  const act = {
    intervalCount: 1, intervalUnit: 'day',
    createdAt: new Date(2026, 2, 14, 10, 0).toISOString(),
    completions: [new Date(2026, 2, 15, 9, 0).toISOString()],
    endDate: null,
  };
  assert.equal(isOutstanding(act, now), false);
});

test('isOutstanding: a never-completed activity is always outstanding, even if freshly created (green)', () => {
  const now = new Date(2026, 2, 15, 10, 0);
  const act = { intervalCount: 3, intervalUnit: 'day', createdAt: now.toISOString(), completions: [], endDate: null };
  assert.equal(isOutstanding(act, now), true);
});

test('isOutstanding: a non-literal-daily cadence that HAS been completed and is still green is not outstanding', () => {
  const now = new Date(2026, 2, 15, 10, 0);
  const act = {
    intervalCount: 3, intervalUnit: 'day',
    createdAt: '2026-03-01T00:00:00.000Z',
    completions: [now.toISOString()],
    endDate: null,
  };
  assert.equal(isOutstanding(act, now), false);
});

test('isOutstanding: an overdue weekly activity is outstanding', () => {
  const now = new Date('2026-01-20T00:00:00.000Z');
  const act = { intervalCount: 1, intervalUnit: 'week', createdAt: '2026-01-01T00:00:00.000Z', completions: [], endDate: null };
  assert.equal(isOutstanding(act, now), true);
});

test('isOutstanding: an ended activity is never outstanding', () => {
  const now = new Date('2026-01-20T00:00:00.000Z');
  const act = { intervalCount: 1, intervalUnit: 'day', createdAt: '2020-01-01T00:00:00.000Z', completions: [], endDate: '2020-02-01' };
  assert.equal(isOutstanding(act, now), false);
});

test('buildDigest: hasDayActivities is false when there are no day-unit activities', () => {
  const now = new Date('2026-01-11T00:00:00.000Z');
  const activities = [
    { name: 'Monthly thing', intervalCount: 1, intervalUnit: 'month', createdAt: now.toISOString(), completions: [], endDate: null },
  ];
  const digest = buildDigest(activities, [], now);
  assert.equal(digest.hasDayActivities, false);
});

// --- formatDigestNotification ---

test('formatDigestNotification: lists each item on its own dashed line per section', () => {
  const digest = { today: ['Muscu'], week: ['Étirement'], month: ['Don de plasma'], hasDayActivities: true };
  const result = formatDigestNotification(digest);
  assert.equal(
    result.body,
    "Aujourd'hui :\n- Muscu\n\nCette semaine :\n- Étirement\n\nCe mois :\n- Don de plasma"
  );
});

test('formatDigestNotification: multiple items in the same section each get their own dashed line', () => {
  const digest = { today: ['Muscu', 'Course'], week: [], month: [], hasDayActivities: true };
  const result = formatDigestNotification(digest);
  assert.equal(result.body, "Aujourd'hui :\n- Muscu\n- Course");
});

test('formatDigestNotification: shows the "tout fait" tick when today is empty but day activities exist', () => {
  const digest = { today: [], week: ['Étirement'], month: ['Don de plasma'], hasDayActivities: true };
  const result = formatDigestNotification(digest);
  assert.equal(
    result.body,
    "Aujourd'hui : tout fait ✓\n\nCette semaine :\n- Étirement\n\nCe mois :\n- Don de plasma"
  );
});

test('formatDigestNotification: omits the "Aujourd\'hui" line entirely when there are no day-unit activities', () => {
  const digest = { today: [], week: ['Étirement'], month: [], hasDayActivities: false };
  const result = formatDigestNotification(digest);
  assert.equal(result.body, "Cette semaine :\n- Étirement");
});

test('formatDigestNotification: empty body when there is nothing to report', () => {
  const digest = { today: [], week: [], month: [], hasDayActivities: false };
  const result = formatDigestNotification(digest);
  assert.equal(result.body, '');
});

// --- nextCheckpointToFire ---

test('nextCheckpointToFire: returns null before the first checkpoint of the day', () => {
  const now = new Date(2026, 2, 15, 8, 0);
  const { checkpointId } = nextCheckpointToFire(now, null);
  assert.equal(checkpointId, null);
});

test('nextCheckpointToFire: fires "morning" once 9h has passed with no prior state', () => {
  const now = new Date(2026, 2, 15, 9, 30);
  const { checkpointId, newState } = nextCheckpointToFire(now, null);
  assert.equal(checkpointId, 'morning');
  assert.equal(newState.sent.morning, true);
});

test('nextCheckpointToFire: does not re-fire a checkpoint already sent today', () => {
  const now = new Date(2026, 2, 15, 10, 0);
  const state = { date: '2026-03-15', sent: { morning: true } };
  const { checkpointId } = nextCheckpointToFire(now, state);
  assert.equal(checkpointId, null);
});

test('nextCheckpointToFire: catch-up fires only the most recent missed checkpoint', () => {
  const now = new Date(2026, 2, 15, 18, 0); // after all three checkpoints
  const { checkpointId, newState } = nextCheckpointToFire(now, null);
  assert.equal(checkpointId, 'evening');
  // earlier missed checkpoints are marked sent too, so they don't fire later
  assert.equal(newState.sent.morning, true);
  assert.equal(newState.sent.midday, true);
  assert.equal(newState.sent.evening, true);
});

test('nextCheckpointToFire: fires "midday" when morning already sent and it is now past noon', () => {
  const now = new Date(2026, 2, 15, 13, 0);
  const state = { date: '2026-03-15', sent: { morning: true } };
  const { checkpointId } = nextCheckpointToFire(now, state);
  assert.equal(checkpointId, 'midday');
});

test('nextCheckpointToFire: stale state from a previous day resets and treats today as fresh', () => {
  const now = new Date(2026, 2, 15, 9, 30);
  const state = { date: '2026-03-14', sent: { morning: true, midday: true, evening: true } };
  const { checkpointId } = nextCheckpointToFire(now, state);
  assert.equal(checkpointId, 'morning');
});

// --- priorityLabel ---

test('priorityLabel: maps each priority to its French label', () => {
  assert.equal(priorityLabel('high'), 'Haute');
  assert.equal(priorityLabel('medium'), 'Moyenne');
  assert.equal(priorityLabel('low'), 'Basse');
});

// --- sortTodos ---

test('sortTodos: undone tasks come before done tasks', () => {
  const todos = [
    { id: 't1', name: 'Done one', priority: 'high', done: true },
    { id: 't2', name: 'Not done', priority: 'low', done: false },
  ];
  const sorted = sortTodos(todos);
  assert.deepEqual(sorted.map(t => t.id), ['t2', 't1']);
});

test('sortTodos: within the same done-state, higher priority comes first', () => {
  const todos = [
    { id: 't1', name: 'Low', priority: 'low', done: false },
    { id: 't2', name: 'High', priority: 'high', done: false },
    { id: 't3', name: 'Medium', priority: 'medium', done: false },
  ];
  const sorted = sortTodos(todos);
  assert.deepEqual(sorted.map(t => t.id), ['t2', 't3', 't1']);
});

test('sortTodos: does not mutate the input array', () => {
  const todos = [
    { id: 't1', name: 'Low', priority: 'low', done: false },
    { id: 't2', name: 'High', priority: 'high', done: false },
  ];
  const original = [...todos];
  sortTodos(todos);
  assert.deepEqual(todos, original);
});

// --- buildDigest / formatDigestNotification with todos ---

test('buildDigest: includes undone todos sorted by priority, excludes done ones', () => {
  const now = new Date('2026-01-11T00:00:00.000Z');
  const todos = [
    { id: 't1', name: 'Low task', priority: 'low', done: false },
    { id: 't2', name: 'High task', priority: 'high', done: false },
    { id: 't3', name: 'Finished task', priority: 'high', done: true },
  ];
  const digest = buildDigest([], todos, now);
  assert.deepEqual(digest.todo, ['High task', 'Low task']);
});

test('formatDigestNotification: adds an "À faire" section with each todo on its own dashed line', () => {
  const digest = { today: [], week: [], month: [], todo: ['High task', 'Low task'], hasDayActivities: false };
  const result = formatDigestNotification(digest);
  assert.equal(result.body, 'À faire :\n- High task\n- Low task');
});

test('formatDigestNotification: omits the "À faire" line when there are no outstanding todos', () => {
  const digest = { today: [], week: ['Étirement'], month: [], todo: [], hasDayActivities: false };
  const result = formatDigestNotification(digest);
  assert.equal(result.body, "Cette semaine :\n- Étirement");
});

// --- undoLastCompletionPeriod ---

test('undoLastCompletionPeriod: day unit removes every completion from the same calendar day as the last one', () => {
  const completions = [
    '2026-03-10T09:00:00.000Z', // an earlier day, should survive
    '2026-03-15T09:00:00.000Z',
    '2026-03-15T09:00:01.000Z',
    '2026-03-15T17:17:55.000Z', // last one, same day as the two above
  ];
  const result = undoLastCompletionPeriod(completions, 'day');
  assert.deepEqual(result, ['2026-03-10T09:00:00.000Z']);
});

test('undoLastCompletionPeriod: week unit removes every completion from the same Mon-Sun week as the last one', () => {
  const completions = [
    '2026-03-01T09:00:00.000Z', // previous week, should survive
    '2026-03-09T09:00:00.000Z', // Monday of the target week
    '2026-03-12T09:00:00.000Z', // Thursday, same week
  ];
  const result = undoLastCompletionPeriod(completions, 'week');
  assert.deepEqual(result, ['2026-03-01T09:00:00.000Z']);
});

test('undoLastCompletionPeriod: month unit removes every completion from the same calendar month as the last one', () => {
  const completions = [
    '2026-02-28T09:00:00.000Z', // previous month, should survive
    '2026-03-01T09:00:00.000Z',
    '2026-03-31T09:00:00.000Z',
  ];
  const result = undoLastCompletionPeriod(completions, 'month');
  assert.deepEqual(result, ['2026-02-28T09:00:00.000Z']);
});

test('undoLastCompletionPeriod: a single completion is removed entirely, leaving an empty array', () => {
  const result = undoLastCompletionPeriod(['2026-03-15T09:00:00.000Z'], 'day');
  assert.deepEqual(result, []);
});

test('undoLastCompletionPeriod: an empty array stays empty', () => {
  const result = undoLastCompletionPeriod([], 'day');
  assert.deepEqual(result, []);
});

test('undoLastCompletionPeriod: does not mutate the input array', () => {
  const completions = ['2026-03-15T09:00:00.000Z', '2026-03-15T10:00:00.000Z'];
  const original = [...completions];
  undoLastCompletionPeriod(completions, 'day');
  assert.deepEqual(completions, original);
});
