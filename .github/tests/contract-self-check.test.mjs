// Proves the contract checks actually bite: run them against deliberately mutated
// copies of the real railway-config.yml text and assert each mutation is reported as
// a violation. Then re-runs every check against the unmodified file once more in the
// same test file, establishing the baseline the mutations are diffed against.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  checkNoConfirmDestructive,
  checkOnlyRailwayInvocations,
  checkPlanNeedsSafetyTest,
  checkConcurrency,
} from './lib/workflow-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(__dirname, '..', 'workflows', 'railway-config.yml');

describe('contract self-check — a real regression must fail the suite', () => {
  let text;

  before(() => {
    text = readFileSync(WORKFLOW_PATH, 'utf8');
  });

  it('splicing --confirm-destructive onto the apply line is reported by checkNoConfirmDestructive and checkOnlyRailwayInvocations', () => {
    const mutated = text.replace(
      'railway config apply --plan railway-plan.json --yes',
      'railway config apply --plan railway-plan.json --yes --confirm-destructive',
    );
    assert.ok(mutated !== text, 'mutation must actually change the text');
    assert.notDeepEqual(checkNoConfirmDestructive(mutated), []);
    assert.notDeepEqual(checkOnlyRailwayInvocations(mutated), []);
  });

  it('removing `needs: safety-test` from plan is reported by checkPlanNeedsSafetyTest', () => {
    const mutated = text.replace('    needs: safety-test\n', '');
    assert.ok(mutated !== text, 'mutation must actually change the text');
    assert.notDeepEqual(checkPlanNeedsSafetyTest(mutated), []);
  });

  it('replacing the apply concurrency group with a different string is reported by checkConcurrency', () => {
    const mutated = text.replace('group: railway-config-apply', 'group: railway-config-staging');
    assert.ok(mutated !== text, 'mutation must actually change the text');
    assert.notDeepEqual(checkConcurrency(mutated), []);
  });

  it('collapsing jobs.apply back onto jobs.plan\'s concurrency group is reported by checkConcurrency', () => {
    const mutated = text.replace('group: railway-config-apply', 'group: railway-config-production');
    assert.ok(mutated !== text, 'mutation must actually change the text');
    assert.notDeepEqual(checkConcurrency(mutated), []);
  });

  it('every check reports no violations against the unmodified file (the baseline)', () => {
    assert.deepEqual(checkNoConfirmDestructive(text), []);
    assert.deepEqual(checkOnlyRailwayInvocations(text), []);
    assert.deepEqual(checkPlanNeedsSafetyTest(text), []);
    assert.deepEqual(checkConcurrency(text), []);
  });
});
