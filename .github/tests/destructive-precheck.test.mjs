// Integration test: the apply job's "Destructive pre-check (read-only)" run: block,
// extracted verbatim from the committed railway-config.yml and executed for real
// against fixture railway-plan.json files, via a real bash/jq subprocess. Entirely
// offline: this step makes no railway or network call, only reads a local file.
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

describe('destructive pre-check step (extracted from railway-config.yml)', () => {
  let script;
  let tools;

  before(() => {
    tools = checkShellToolsAvailable();
    const text = readFileSync(WORKFLOW_PATH, 'utf8');
    script = extractStepScript(text, 'Destructive pre-check (read-only)');
    assert.ok(script, 'expected to extract the "Destructive pre-check (read-only)" run: block');
  });

  it('destructive: true — fails and names the destructive diff lines', (t) => {
    if (!tools.ok) return t.skip(tools.reason);
    const result = runExtractedScript(script, path.join(FIXTURES, 'plan-destructive-true.json'));
    assert.equal(result.status, 1);
    const combined = result.stdout + result.stderr + result.stepSummary;
    assert.match(combined, /- service: kata-relay-service/);
    assert.match(combined, /~ delete variable: OLD_SECRET/);
    assert.match(combined, /Destructive Railway change refused/);
  });

  it('destructive: false — succeeds with no destructive output', (t) => {
    if (!tools.ok) return t.skip(tools.reason);
    const result = runExtractedScript(script, path.join(FIXTURES, 'plan-destructive-false.json'));
    assert.equal(result.status, 0);
    const combined = result.stdout + result.stderr + result.stepSummary;
    assert.doesNotMatch(combined, /Destructive Railway change refused/);
  });

  it('no .destructive key at all — warns and exits 0, falling through to the CLI\'s own refusal', (t) => {
    if (!tools.ok) return t.skip(tools.reason);
    const result = runExtractedScript(script, path.join(FIXTURES, 'plan-no-destructive-key.json'));
    assert.equal(result.status, 0);
    const combined = result.stdout + result.stderr;
    assert.match(combined, /::warning::.*no readable \.destructive flag/);
    assert.doesNotMatch(result.stepSummary, /Destructive Railway change refused/);
  });

  it('.destructive is a non-boolean (e.g. "maybe") — treated the same as missing', (t) => {
    if (!tools.ok) return t.skip(tools.reason);
    const result = runExtractedScript(script, path.join(FIXTURES, 'plan-destructive-non-boolean.json'));
    assert.equal(result.status, 0);
    const combined = result.stdout + result.stderr;
    assert.match(combined, /::warning::.*no readable \.destructive flag/);
  });
});
