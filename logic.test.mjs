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
