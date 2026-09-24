// Executes an extracted `run: |` shell script for real, in a scratch temp directory,
// via a real `bash` subprocess. Used by the integration tests that exercise the
// destructive pre-check and plan-validation scripts pulled straight out of the
// committed railway-config.yml text (see lib/workflow-contract.mjs#extractStepScript).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * @returns {{ok: true} | {ok: false, reason: string}} whether `bash` and `jq` are
 * available on this machine. The plan requires skipping (not failing) when jq is
 * missing rather than treating it as a hard dependency of the suite.
 */
export function checkShellToolsAvailable() {
  const bash = spawnSync('bash', ['--version']);
  if (bash.status !== 0) return { ok: false, reason: 'bash is not available on this machine' };
  const jq = spawnSync('jq', ['--version']);
  if (jq.status !== 0) return { ok: false, reason: 'jq is not available on this machine' };
  return { ok: true };
}

/**
 * Run `script` (already dedented) in a fresh temp directory with `bash`. Optionally
 * copy a fixture file into that directory first as `railway-plan.json` (skip when
 * `fixturePath` is null, to exercise the "file missing entirely" case).
 *
 * @param {string} script
 * @param {string | null} fixturePath
 * @returns {{status: number, stdout: string, stderr: string, stepSummary: string}}
 */
export function runExtractedScript(script, fixturePath) {
  const dir = mkdtempSync(path.join(tmpdir(), 'railway-config-test-'));
  try {
    if (fixturePath) {
      copyFileSync(fixturePath, path.join(dir, 'railway-plan.json'));
    }
    const scriptPath = path.join(dir, 'script.sh');
    writeFileSync(scriptPath, script, 'utf8');

    const stepSummaryPath = path.join(dir, 'step-summary.md');
    writeFileSync(stepSummaryPath, '', 'utf8');

    const result = spawnSync('bash', [scriptPath], {
      cwd: dir,
      env: {
        ...process.env,
        GITHUB_STEP_SUMMARY: stepSummaryPath,
      },
      encoding: 'utf8',
    });

    const stepSummary = existsSync(stepSummaryPath) ? readFileSync(stepSummaryPath, 'utf8') : '';

    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      stepSummary,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
