import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  checkSingleTrigger,
  checkNoPullRequestTarget,
  checkPRTypes,
  checkBranches,
  checkPaths,
  checkPlanNeedsSafetyTest,
  checkPlanForkGuard,
  checkApplyGuard,
  checkConcurrency,
  checkNoConfirmDestructive,
  checkOnlyRailwayInvocations,
  checkRailwayTokenScoping,
  checkPermissions,
  checkActionPinning,
  checkApplyNoPlan,
  checkStepOrder,
  checkPlanArtifactRetention,
} from './lib/workflow-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(__dirname, '..', 'workflows', 'railway-config.yml');

describe('railway-config.yml contract', () => {
  let text;

  before(() => {
    text = readFileSync(WORKFLOW_PATH, 'utf8');
  });

  it('on: has exactly one trigger key, pull_request', () => {
    assert.deepEqual(checkSingleTrigger(text), []);
  });

  it('never uses pull_request_target', () => {
    assert.deepEqual(checkNoPullRequestTarget(text), []);
  });

  it('on.pull_request.types is exactly opened, synchronize, reopened, closed', () => {
    assert.deepEqual(checkPRTypes(text), []);
  });

  it('on.pull_request.branches is [main]', () => {
    assert.deepEqual(checkBranches(text), []);
  });

  it('on.pull_request.paths is exactly .railway/**, package.json, pnpm-lock.yaml', () => {
    assert.deepEqual(checkPaths(text), []);
  });

  it('jobs.plan.needs includes safety-test', () => {
    assert.deepEqual(checkPlanNeedsSafetyTest(text), []);
  });

  it('jobs.plan.if contains the fork guard', () => {
    assert.deepEqual(checkPlanForkGuard(text), []);
  });

  it('jobs.apply.if contains closed/merged/base.ref/fork guard', () => {
    assert.deepEqual(checkApplyGuard(text), []);
  });

  it('jobs.plan holds railway-config-production and jobs.apply holds its own railway-config-apply group, both cancel-in-progress: false, and no other group appears', () => {
    assert.deepEqual(checkConcurrency(text), []);
  });

  it('every --confirm-destructive occurrence is on a comment line (here: none at all)', () => {
    assert.deepEqual(checkNoConfirmDestructive(text), []);
  });

  it('the only non-comment railway binary invocations are --version, config plan, and exactly one config apply', () => {
    assert.deepEqual(checkOnlyRailwayInvocations(text), []);
  });

  it('RAILWAY_TOKEN is only ever declared inside step-level env: blocks', () => {
    assert.deepEqual(checkRailwayTokenScoping(text), []);
  });

  it('permissions are minimal: contents: read at top, pull-requests: write on plan, actions: read on apply, no id-token', () => {
    assert.deepEqual(checkPermissions(text), []);
  });

  it('every uses: is pinned to a ^v\\d+ tag', () => {
    assert.deepEqual(checkActionPinning(text), []);
  });

  it('jobs.apply never calls railway config plan', () => {
    assert.deepEqual(checkApplyNoPlan(text), []);
  });

  it('the destructive pre-check step precedes the Apply step', () => {
    assert.deepEqual(checkStepOrder(text), []);
  });

  it('the Upload pinned plan step sets retention-days: 30', () => {
    assert.deepEqual(checkPlanArtifactRetention(text), []);
  });
});
