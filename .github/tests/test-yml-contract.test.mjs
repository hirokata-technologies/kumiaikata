import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  checkTestRailwayJobExists,
  checkTestRailwayRunsPnpmTestRailway,
  checkTestRailwayRunsPnpmTestWorkflows,
  checkTestRailwayNoPathsNoSecrets,
  checkExistingJobsUnchanged,
  checkTestYmlTopLevelUnchanged,
} from './lib/workflow-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(__dirname, '..', 'workflows', 'test.yml');

describe('test.yml contract', () => {
  let text;

  before(() => {
    text = readFileSync(WORKFLOW_PATH, 'utf8');
  });

  it('a test-railway job exists under jobs:', () => {
    assert.deepEqual(checkTestRailwayJobExists(text), []);
  });

  it("test-railway's steps run pnpm test:railway", () => {
    assert.deepEqual(checkTestRailwayRunsPnpmTestRailway(text), []);
  });

  it("test-railway's steps run pnpm test:workflows, after pnpm test:railway (BUG-029)", () => {
    assert.deepEqual(checkTestRailwayRunsPnpmTestWorkflows(text), []);
  });

  it('test-railway has no paths: filter and no env:/secrets: block', () => {
    assert.deepEqual(checkTestRailwayNoPathsNoSecrets(text), []);
  });

  it('test-web and test-api job blocks are still present with a checkout step', () => {
    assert.deepEqual(checkExistingJobsUnchanged(text), []);
  });

  it('top-level on:, permissions:, concurrency: are unchanged from the pre-REQ-005 shape', () => {
    assert.deepEqual(checkTestYmlTopLevelUnchanged(text), []);
  });
});
