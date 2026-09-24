// Integration test: the plan job's "Validate pinned plan file" run: block, extracted
// verbatim from the committed railway-config.yml and executed for real against
// fixture files, via a real bash/jq subprocess. Offline: reads only local files.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractStepScript } from './lib/workflow-contract.mjs';
import { checkShellToolsAvailable, runExtractedScript } from './lib/run-script.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(__dirname, '..', 'workflows', 'railway-config.yml');
const FIXTURES = path.join(__dirname, 'fixtures');

describe('plan validation step (extracted from railway-config.yml)', () => {
  let script;
  let tools;

  before(() => {
    tools = checkShellToolsAvailable();
    const text = readFileSync(WORKFLOW_PATH, 'utf8');
    script = extractStepScript(text, 'Validate pinned plan file');
    assert.ok(script, 'expected to extract the "Validate pinned plan file" run: block');
  });

  it('not valid JSON at all — fails, error mentions "not valid JSON"', (t) => {
    if (!tools.ok) return t.skip(tools.reason);
    const result = runExtractedScript(script, path.join(FIXTURES, 'plan-invalid-json.txt'));
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /not valid JSON/);
  });

  it('valid JSON with no .changeSet at all — fails, error mentions changeSet.changes', (t) => {
    if (!tools.ok) return t.skip(tools.reason);
    const result = runExtractedScript(script, path.join(FIXTURES, 'plan-no-changeset.json'));
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /changeSet\.changes/);
  });

  it('valid JSON with .changeSet but no .changeSet.changes array — fails, error mentions changeSet.changes', (t) => {
    if (!tools.ok) return t.skip(tools.reason);
    const result = runExtractedScript(script, path.join(FIXTURES, 'plan-no-changes-array.json'));
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /changeSet\.changes/);
  });

  it('valid, well-formed JSON with .changeSet.changes as an empty array — succeeds', (t) => {
    if (!tools.ok) return t.skip(tools.reason);
    const result = runExtractedScript(script, path.join(FIXTURES, 'plan-empty-changes.json'));
    assert.equal(result.status, 0);
  });

  it('the file is missing entirely — fails, error mentions the file was not produced', (t) => {
    if (!tools.ok) return t.skip(tools.reason);
    const result = runExtractedScript(script, null);
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /was not produced/);
  });
});
