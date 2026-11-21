import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTourSteps, hasSeenTour, markTourSeen, tourKey, type TourContext } from './tourSteps';

const base: TourContext = { mode: 'api', showApprovals: false, showRouteSettings: false, canOpenDirectory: false, hasCompanies: true };
const ids = (ctx: TourContext) => buildTourSteps(ctx).map(step => step.id);

test('requester without signing or admin rights sees no restricted steps', () => {
  const list = ids(base);
  assert.ok(list.includes('new-request'));
  assert.ok(list.includes('nav-profile'));
  for (const hidden of ['nav-approvals', 'nav-signing-routes', 'nav-directory']) assert.ok(!list.includes(hidden), hidden);
});

test('signing inbox and admin steps follow the visible links', () => {
  const list = ids({ ...base, showApprovals: true, showRouteSettings: true, canOpenDirectory: true });
  for (const shown of ['nav-approvals', 'nav-signing-routes', 'nav-directory']) assert.ok(list.includes(shown), shown);
});

test('account awaiting company access skips request and form steps', () => {
  const list = ids({ ...base, hasCompanies: false, showApprovals: true });
  for (const hidden of ['company', 'search', 'request-list', 'new-request', 'forms-library', 'nav-approvals', 'nav-my-requests', 'nav-archive']) {
    assert.ok(!list.includes(hidden), hidden);
  }
  assert.deepEqual([list[0], list.at(-1)], ['welcome', 'replay']);
});

test('copy never claims signing authority from the tour itself', () => {
  for (const step of buildTourSteps({ ...base, showApprovals: true, showRouteSettings: true, canOpenDirectory: true })) {
    assert.doesNotMatch(step.body, /you can sign|authori[sz]ed to sign|approve any/i, step.id);
  }
});

test('page steps name a view and anchors use data-tour selectors', () => {
  const steps = buildTourSteps(base);
  assert.equal(steps.find(step => step.id === 'forms-library')?.view, 'forms-library');
  for (const step of steps) if (step.selector) assert.match(step.selector, /^\[data-tour="[a-z-]+"\]$/);
});

test('overview stops come first, on the dashboard, before the forms page', () => {
  const steps = buildTourSteps(base);
  assert.deepEqual(steps.slice(0, 4).map(step => step.id), ['welcome', 'request-list', 'new-request', 'forms-library']);
  assert.equal(steps[1].view, 'dashboard');
  assert.equal(steps[2].view, 'dashboard');
  assert.equal(steps.at(-1)?.id, 'replay');
});

test('phone layout drops the hidden header search so the step count stays true', () => {
  assert.ok(ids(base).includes('search'));
  assert.ok(!ids({ ...base, compact: true }).includes('search'));
  assert.equal(ids(base).length - ids({ ...base, compact: true }).length, 1);
});

test('request list copy mentions signing only when the inbox is shown', () => {
  const body = (ctx: TourContext) => buildTourSteps(ctx).find(step => step.id === 'request-list')!.body;
  assert.doesNotMatch(body(base), /signature/i);
  assert.match(body({ ...base, showApprovals: true }), /waiting for your signature/);
});

test('seen flag is per mode and user, and survives storage failures', () => {
  const map = new Map<string, string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
  assert.equal(tourKey('showcase', 'u1'), 'precisign.tour.v1.showcase.u1');
  assert.equal(hasSeenTour('api', 'u1', storage), false);
  markTourSeen('api', 'u1', storage);
  assert.equal(hasSeenTour('api', 'u1', storage), true);
  assert.equal(hasSeenTour('demo', 'u1', storage), false);
  assert.equal(hasSeenTour('api', 'u2', storage), false);

  const broken = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } };
  assert.doesNotThrow(() => markTourSeen('api', 'u1', broken));
  assert.equal(hasSeenTour('api', 'u1', broken), false);
  assert.equal(hasSeenTour('api', 'u1', undefined), false);
});
