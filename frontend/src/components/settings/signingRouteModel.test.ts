import test from 'node:test';
import assert from 'node:assert/strict';
import type { UserProfile, WorkflowConfig, WorkflowStageConfig } from '../../types';
import { routeDraft } from '../../utils/routeForms';
import { describeRouteChanges, moveIntermediate, skipExample, stepIssues, stepLabel } from './signingRouteModel';

const person = (id: string, name: string) => ({ id, name }) as UserProfile;
const people = [person('u-sami', 'Sami'), person('u-farhan', 'Farhan'), person('u-fariha', 'Fariha'), person('u-noor', 'Noor')];
const form = 'Administrative & Payment Request' as const;

function savedRoute(): WorkflowConfig {
  const route = routeDraft('PEW', form);
  route.version = 3;
  route.stages[0] = { ...route.stages[0], id: 'dept', assignedUserId: 'u-sami', backupSignerIds: [] };
  route.stages[1] = { ...route.stages[1], id: 'final', assignedUserId: 'u-fariha', backupSignerIds: [] };
  return route;
}
const clone = (route: WorkflowConfig) => structuredClone(route);
const review = (id: string, name: string): WorkflowStageConfig => ({ id, stageNumber: 1, name, isFinalApproval: false, canReject: true, canReturnForCorrection: true, mapsToDocumentSignature: false, backupSignerIds: [] });

test('labels use the form signature slot names and review step names', () => {
  const route = savedRoute();
  assert.equal(stepLabel(form, route.stages[0]), 'Department Head Signature');
  assert.equal(stepLabel(form, route.stages[1]), 'Approver Signature');
  assert.equal(stepLabel(form, review('r', '  ')), 'Review step');
});

test('summarises a backup added and a final approver change in concrete words', () => {
  const saved = savedRoute();
  const draft = clone(saved);
  draft.stages[0].backupSignerIds = ['u-farhan'];
  draft.stages[1].assignedUserId = 'u-sami';
  assert.deepEqual(describeRouteChanges(form, saved, draft, people), [
    'Backup added: Farhan',
    'Final approver changed from Fariha to Sami',
  ]);
});

test('reports added, removed, renamed and reordered steps', () => {
  const saved = savedRoute();
  saved.stages.splice(1, 0, review('finance', 'Finance check'));
  const draft = clone(saved);
  draft.stages = [draft.stages[1], draft.stages[0], draft.stages[2]];
  draft.stages[0].name = 'Finance review';
  draft.stages.splice(2, 0, review('legal', 'Legal'));
  const changes = describeRouteChanges(form, saved, draft, people);
  assert.ok(changes.includes('Step added: Legal'));
  assert.ok(changes.includes('Order changed: Finance review → Department Head Signature → Legal → Approver Signature'));
  assert.ok(changes.includes('Step renamed from Finance check to Finance review'));
  const removed = clone(saved); removed.stages.splice(1, 1);
  assert.deepEqual(describeRouteChanges(form, saved, removed, people), ['Step removed: Finance check']);
});

test('a form without a saved route describes the whole new route', () => {
  const draft = savedRoute();
  draft.stages[0].backupSignerIds = ['u-noor'];
  assert.deepEqual(describeRouteChanges(form, undefined, draft, people), [
    'New route with 3 signing steps',
    'Suggested signer for Department Head Signature: Sami',
    'Backup added: Noor (Department Head Signature)',
    'Final approver: Fariha',
  ]);
});

test('no differences means no changes, including bypass and processing team toggles', () => {
  const saved = savedRoute();
  assert.deepEqual(describeRouteChanges(form, saved, clone(saved), people), []);
  const draft = clone(saved);
  draft.allowFinalBypass = !saved.allowFinalBypass;
  draft.processingUserIds = ['u-noor'];
  assert.deepEqual(describeRouteChanges(form, saved, draft, people), [
    saved.allowFinalBypass ? 'Final approver bypass turned off' : 'Final approver bypass turned on',
    'Processing team added: Noor',
  ]);
});

test('skip example names the actual steps and follows the optional-signer rule', () => {
  const route = savedRoute();
  assert.equal(skipExample(form, route), 'If Department Head Signature is skipped, the request goes to Approver Signature.');
  const finalOnly = routeDraft('PEW', 'IT Request');
  assert.equal(skipExample('IT Request', finalOnly), null, 'a route with only the required final step has nothing to skip');
});

test('eligibility issues are reported per control', () => {
  const eligible = [people[0], people[1]];
  assert.deepEqual(stepIssues({ ...review('r', ''), assignedUserId: 'u-noor', backupSignerIds: ['u-fariha'] }, eligible, 'PEW Works'), {
    name: 'Enter a name for this review step.',
    signer: 'This employee can no longer sign for PEW Works. Choose another signer or let the requester choose.',
    backups: 'A backup can no longer sign for PEW Works. Remove them or choose another.',
  });
  assert.equal(stepIssues({ ...review('r', 'Ok'), assignedUserId: 'u-sami', backupSignerIds: ['u-sami'] }, eligible, 'X').backups,
    'The suggested signer cannot also be their own backup.');
  assert.deepEqual(stepIssues({ ...review('r', 'Ok'), assignedUserId: 'u-sami' }, eligible, 'X'), {});
});

test('reorder moves whole intermediate steps and never passes the final approval', () => {
  const stages = [review('a', 'A'), review('b', 'B'), { ...review('f', 'F'), isFinalApproval: true }];
  stages[0].assignedUserId = 'u-sami'; stages[0].backupSignerIds = ['u-farhan'];
  const moved = moveIntermediate(stages, 0, 1)!;
  assert.deepEqual(moved.map(step => step.id), ['b', 'a', 'f']);
  assert.equal(moved[1].assignedUserId, 'u-sami');
  assert.deepEqual(moved[1].backupSignerIds, ['u-farhan'], 'signer and backups move with their step');
  assert.equal(moveIntermediate(stages, 1, 1), null, 'cannot move past the final approval');
  assert.equal(moveIntermediate(stages, 0, -1), null, 'cannot move before the requester');
  assert.equal(moveIntermediate(stages, 2, -1), null, 'the final approval does not move');
  const single = [review('a', 'A'), { ...review('f', 'F'), isFinalApproval: true }];
  assert.equal(moveIntermediate(single, 0, -1), null);
  assert.equal(moveIntermediate(single, 0, 1), null, 'one intermediate step has no destination');
});
