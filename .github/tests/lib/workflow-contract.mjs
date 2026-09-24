// Shared, offline, regex/string-level checks against the committed workflow YAML text.
// No YAML parser: the workflow files are read as raw text and parsed with a small set
// of indentation-aware primitives. Every check function takes the *whole file text* and
// returns an array of violation strings — an empty array means "passed". Returning
// violations (rather than throwing) is what lets contract-self-check.test.mjs run the
// same checks against a deliberately mutated copy of the text and assert on the list.

/** @param {string} line */
export function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

/**
 * Collect the lines that belong to the block introduced by `lines[keyLineIndex]`:
 * every following line more indented than the key line, stopping at the first
 * non-blank line at or below that indent.
 */
export function getBlockLines(lines, keyLineIndex) {
  const baseIndent = indentOf(lines[keyLineIndex]);
  const block = [];
  for (let i = keyLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      block.push(line);
      continue;
    }
    if (indentOf(line) <= baseIndent) break;
    block.push(line);
  }
  return block;
}

export function findLineIndex(lines, regex, fromIndex = 0) {
  for (let i = fromIndex; i < lines.length; i++) {
    if (regex.test(lines[i])) return i;
  }
  return -1;
}

/** Top-level (or block-scoped) keys sitting at an exact indent within blockLines. */
export function getKeysAtIndent(blockLines, indent) {
  const keys = [];
  for (const line of blockLines) {
    if (line.trim() === '') continue;
    if (indentOf(line) !== indent) continue;
    const m = line.match(/^\s*([A-Za-z_][\w-]*):/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/** The indent of the first non-blank line in a block, or null if the block is empty. */
export function firstIndent(blockLines) {
  for (const line of blockLines) {
    if (line.trim() !== '') return indentOf(line);
  }
  return null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Read a `key: [a, b, c]` (inline) or
 *   key:
 *     - a
 *     - b
 * (block) list value out of a set of lines. Returns null if the key is absent.
 */
export function getListValue(blockLines, key) {
  const keyRe = new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(.*)$`);
  const idx = blockLines.findIndex((l) => keyRe.test(l));
  if (idx === -1) return null;
  const m = blockLines[idx].match(keyRe);
  const inline = m[1].trim();

  if (inline.startsWith('[')) {
    let content = inline;
    let i = idx;
    while (!content.includes(']') && i + 1 < blockLines.length) {
      i++;
      content += ' ' + blockLines[i].trim();
    }
    const inner = content.replace(/^\[/, '').replace(/\].*$/, '');
    return inner
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter((s) => s.length > 0);
  }

  if (inline === '') {
    const items = [];
    for (let i = idx + 1; i < blockLines.length; i++) {
      const l = blockLines[i];
      if (l.trim() === '') continue;
      const bm = l.match(/^\s*-\s*(.+)$/);
      if (!bm) break;
      items.push(bm[1].trim().replace(/^["']|["']$/g, ''));
    }
    return items;
  }

  return [inline.replace(/^["']|["']$/g, '')];
}

/** Extract the dedented body of a `run: |` block belonging to the step named `stepName`. */
export function extractStepScript(text, stepName) {
  const lines = text.split('\n');
  const stepRe = new RegExp(`-\\s*name:\\s*${escapeRegExp(stepName)}\\s*$`);
  const stepLineIdx = lines.findIndex((l) => stepRe.test(l.trim()));
  if (stepLineIdx === -1) return null;
  const stepIndent = indentOf(lines[stepLineIdx]);

  let runIdx = -1;
  for (let i = stepLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const ind = indentOf(line);
    if (ind <= stepIndent) break; // left the step block without finding run:
    if (/^\s*run:\s*\|/.test(line)) {
      runIdx = i;
      break;
    }
  }
  if (runIdx === -1) return null;
  const runIndent = indentOf(lines[runIdx]);

  const scriptLines = [];
  let bodyIndent = null;
  for (let i = runIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      scriptLines.push('');
      continue;
    }
    const ind = indentOf(line);
    if (bodyIndent === null) {
      if (ind <= runIndent) break;
      bodyIndent = ind;
    }
    if (ind < bodyIndent) break;
    scriptLines.push(line.slice(bodyIndent));
  }
  while (scriptLines.length && scriptLines[scriptLines.length - 1] === '') scriptLines.pop();
  return scriptLines.join('\n');
}

/** Lines belonging to a named job's block (`jobs.<jobName>`), or null if absent. */
export function getJobBlock(text, jobName) {
  const lines = text.split('\n');
  const jobsIdx = findLineIndex(lines, /^jobs:\s*$/);
  if (jobsIdx === -1) return null;
  const jobsBlock = getBlockLines(lines, jobsIdx);
  const jobIndent = firstIndent(jobsBlock);
  if (jobIndent === null) return null;
  const jobRe = new RegExp(`^\\s{${jobIndent}}${escapeRegExp(jobName)}:\\s*$`);
  const jobLineOffset = jobsBlock.findIndex((l) => jobRe.test(l));
  if (jobLineOffset === -1) return null;
  // Recover absolute index in `lines` and reuse getBlockLines from there.
  const jobLineAbsIdx = jobsIdx + 1 + jobLineOffset;
  return getBlockLines(lines, jobLineAbsIdx);
}

// ---------------------------------------------------------------------------
// railway-config.yml checks
// ---------------------------------------------------------------------------

export function checkSingleTrigger(text) {
  const lines = text.split('\n');
  const idx = findLineIndex(lines, /^on:\s*$/);
  if (idx === -1) return ['no top-level `on:` key found'];
  const block = getBlockLines(lines, idx);
  const indent = firstIndent(block);
  if (indent === null) return ['`on:` block is empty'];
  const keys = getKeysAtIndent(block, indent);
  const violations = [];
  if (keys.length !== 1) violations.push(`expected exactly one trigger key under on:, found [${keys.join(', ')}]`);
  if (keys[0] !== 'pull_request') violations.push(`expected trigger key to be pull_request, got ${keys[0]}`);
  return violations;
}

export function checkNoPullRequestTarget(text) {
  return text.includes('pull_request_target') ? ['pull_request_target found — forbidden'] : [];
}

export function checkPRTypes(text) {
  const lines = text.split('\n');
  const idx = findLineIndex(lines, /^on:\s*$/);
  if (idx === -1) return ['no on: block'];
  const onBlock = getBlockLines(lines, idx);
  const types = getListValue(onBlock, 'types');
  const expected = ['opened', 'synchronize', 'reopened', 'closed'];
  if (!types) return ['on.pull_request.types not found'];
  const sortedActual = [...types].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    return [`expected types [${expected.join(', ')}], got [${types.join(', ')}]`];
  }
  return [];
}

export function checkBranches(text) {
  const lines = text.split('\n');
  const idx = findLineIndex(lines, /^on:\s*$/);
  if (idx === -1) return ['no on: block'];
  const onBlock = getBlockLines(lines, idx);
  const branches = getListValue(onBlock, 'branches');
  if (!branches) return ['on.pull_request.branches not found'];
  if (JSON.stringify(branches) !== JSON.stringify(['main'])) {
    return [`expected branches [main], got [${branches.join(', ')}]`];
  }
  return [];
}

export function checkPaths(text) {
  const lines = text.split('\n');
  const idx = findLineIndex(lines, /^on:\s*$/);
  if (idx === -1) return ['no on: block'];
  const onBlock = getBlockLines(lines, idx);
  const paths = getListValue(onBlock, 'paths');
  const expected = ['.railway/**', 'package.json', 'pnpm-lock.yaml'];
  if (!paths) return ['on.pull_request.paths not found'];
  const sortedActual = [...paths].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    return [`expected paths [${expected.join(', ')}], got [${paths.join(', ')}]`];
  }
  return [];
}

export function checkPlanNeedsSafetyTest(text) {
  const planBlock = getJobBlock(text, 'plan');
  if (!planBlock) return ['jobs.plan not found'];
  const needs = getListValue(planBlock, 'needs');
  if (!needs || !needs.includes('safety-test')) {
    return [`jobs.plan.needs does not include safety-test (found: ${needs ? needs.join(', ') : 'none'})`];
  }
  return [];
}

export function checkPlanForkGuard(text) {
  const planBlock = getJobBlock(text, 'plan');
  if (!planBlock) return ['jobs.plan not found'];
  const ifIdx = planBlock.findIndex((l) => /^\s*if:\s*/.test(l));
  if (ifIdx === -1) return ['jobs.plan.if not found'];
  const ifBlock = [planBlock[ifIdx], ...getBlockLines(planBlock, ifIdx)].join('\n');
  if (!ifBlock.includes('head.repo.full_name == github.repository')) {
    return ['jobs.plan.if missing fork guard (head.repo.full_name == github.repository)'];
  }
  return [];
}

export function checkApplyGuard(text) {
  const applyBlock = getJobBlock(text, 'apply');
  if (!applyBlock) return ['jobs.apply not found'];
  const ifIdx = applyBlock.findIndex((l) => /^\s*if:\s*/.test(l));
  if (ifIdx === -1) return ['jobs.apply.if not found'];
  const ifBlock = [applyBlock[ifIdx], ...getBlockLines(applyBlock, ifIdx)].join('\n');
  const violations = [];
  if (!/action\s*==\s*'closed'/.test(ifBlock)) violations.push("missing action == 'closed'");
  if (!/pull_request\.merged\s*==\s*true/.test(ifBlock)) violations.push('missing pull_request.merged == true');
  if (!/base\.ref\s*==\s*'main'/.test(ifBlock)) violations.push("missing base.ref == 'main'");
  if (!ifBlock.includes('head.repo.full_name == github.repository')) violations.push('missing fork guard');
  return violations;
}

// jobs.plan and jobs.apply each hold their OWN concurrency group — never the same one.
// Sharing a group is exactly what let a newer plan run queue-race a pending apply
// (review finding 44): splitting them means an apply can only ever queue behind another
// apply, never behind or ahead of an unrelated plan run.
const EXPECTED_GROUPS = { plan: 'railway-config-production', apply: 'railway-config-apply' };

export function checkConcurrency(text) {
  const violations = [];
  for (const jobName of ['plan', 'apply']) {
    const jobBlock = getJobBlock(text, jobName);
    if (!jobBlock) {
      violations.push(`jobs.${jobName} not found`);
      continue;
    }
    const ccIdx = jobBlock.findIndex((l) => /^\s*concurrency:\s*$/.test(l));
    if (ccIdx === -1) {
      violations.push(`jobs.${jobName}.concurrency not found`);
      continue;
    }
    const ccBlock = getBlockLines(jobBlock, ccIdx);
    const group = getListValue(ccBlock, 'group');
    const cancelInProgress = getListValue(ccBlock, 'cancel-in-progress');
    const expectedGroup = EXPECTED_GROUPS[jobName];
    if (!group || group[0] !== expectedGroup) {
      violations.push(`jobs.${jobName}.concurrency.group expected ${expectedGroup}, got ${group ? group[0] : 'none'}`);
    }
    if (!cancelInProgress || cancelInProgress[0] !== 'false') {
      violations.push(`jobs.${jobName}.concurrency.cancel-in-progress expected false, got ${cancelInProgress ? cancelInProgress[0] : 'none'}`);
    }
  }
  // no other concurrency group anywhere in the file, and plan/apply must not share one
  const groupMatches = [...text.matchAll(/group:\s*(\S+)/g)].map((m) => m[1]);
  const knownGroups = Object.values(EXPECTED_GROUPS);
  const other = groupMatches.filter((g) => !knownGroups.includes(g));
  if (other.length > 0) {
    violations.push(`unexpected concurrency group(s) in file: ${other.join(', ')}`);
  }
  return violations;
}

// review finding 34: the pinned plan artifact must not sit at the actions default
// (90 days) — it is an infrastructure diff, accessible to anyone with repository
// access, and should not outlive the review window it exists for.
export function checkPlanArtifactRetention(text) {
  const lines = text.split('\n');
  const stepRe = /^\s*-\s*name:\s*Upload pinned plan\s*$/;
  const stepLineIdx = lines.findIndex((l) => stepRe.test(l));
  if (stepLineIdx === -1) return ['"Upload pinned plan" step not found in jobs.plan'];
  // getBlockLines already stops at the next sibling step (same indent as this one),
  // so this is the "Upload pinned plan" step's own fields and nothing past it.
  const scoped = getBlockLines(lines, stepLineIdx).filter((l) => l.trim() !== '');
  const withLine = scoped.find((l) => /^\s*with:\s*$/.test(l));
  if (!withLine) return ['"Upload pinned plan" step has no with: block'];
  const withIdx = scoped.indexOf(withLine);
  const withBlock = getBlockLines(scoped, withIdx);
  const retention = getListValue(withBlock, 'retention-days');
  if (!retention || retention[0] !== '30') {
    return [`"Upload pinned plan" step expected retention-days: 30, got ${retention ? retention[0] : 'none'}`];
  }
  return [];
}

export function checkNoConfirmDestructive(text) {
  const lines = text.split('\n');
  const violations = [];
  lines.forEach((line, i) => {
    if (line.includes('--confirm-destructive') && !line.trim().startsWith('#')) {
      violations.push(`non-comment line ${i + 1} contains --confirm-destructive: ${line.trim()}`);
    }
  });
  return violations;
}

export function checkOnlyRailwayInvocations(text) {
  const lines = text.split('\n');
  const expected = [
    'railway --version',
    'railway config plan --out railway-plan.json',
    'railway config apply --plan railway-plan.json --yes',
  ];
  const found = [];
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return;
    // both `run: railway --version` (inline) and a bare `railway ...` line inside a
    // `run: |` block are commands the workflow actually executes.
    const inlineRunMatch = trimmed.match(/^run:\s*(railway\s.*)$/);
    const candidate = inlineRunMatch ? inlineRunMatch[1] : trimmed;
    if (/^railway\s/.test(candidate)) found.push(candidate);
  });
  const violations = [];
  const sortedFound = [...found].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedFound) !== JSON.stringify(sortedExpected)) {
    violations.push(`expected railway invocations [${expected.join(' | ')}], found [${found.join(' | ')}]`);
  }
  const applyCount = found.filter((l) => l.startsWith('railway config apply')).length;
  if (applyCount !== 1) {
    violations.push(`expected exactly one railway config apply invocation, found ${applyCount}`);
  }
  return violations;
}

export function checkRailwayTokenScoping(text) {
  const lines = text.split('\n');
  const violations = [];

  // The workflow-level env: block (top-level, immediately under `env:` at column 0)
  // must not declare RAILWAY_TOKEN.
  const topEnvIdx = findLineIndex(lines, /^env:\s*$/);
  if (topEnvIdx !== -1) {
    const topEnvBlock = getBlockLines(lines, topEnvIdx);
    if (topEnvBlock.some((l) => /^\s*RAILWAY_TOKEN:/.test(l))) {
      violations.push('RAILWAY_TOKEN found in the workflow-level env: block');
    }
  }

  // Non-comment lines mentioning RAILWAY_TOKEN must be exactly two, and each must sit
  // inside a step-level env: block.
  const nonCommentLines = [];
  lines.forEach((line, i) => {
    if (line.includes('RAILWAY_TOKEN') && !line.trim().startsWith('#')) {
      nonCommentLines.push(i);
    }
  });
  if (nonCommentLines.length !== 2) {
    violations.push(`expected RAILWAY_TOKEN on exactly 2 non-comment lines, found ${nonCommentLines.length}`);
  }
  for (const i of nonCommentLines) {
    // walk upward for the nearest `env:` line more shallowly indented than this line;
    // it must not be the top-level env: block found above.
    const lineIndent = indentOf(lines[i]);
    let envLineIdx = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].trim() === '') continue;
      const ind = indentOf(lines[j]);
      if (ind < lineIndent && /^\s*env:\s*$/.test(lines[j])) {
        envLineIdx = j;
        break;
      }
      if (ind === 0) break; // hit a top-level key without finding env: first
    }
    if (envLineIdx === -1 || indentOf(lines[envLineIdx]) === 0) {
      violations.push(`line ${i + 1} (RAILWAY_TOKEN) is not inside a step-level env: block`);
    }
  }
  return violations;
}

export function checkPermissions(text) {
  const violations = [];
  const lines = text.split('\n');
  const topPermIdx = findLineIndex(lines, /^permissions:\s*$/);
  if (topPermIdx === -1) {
    violations.push('top-level permissions: not found');
  } else {
    const block = getBlockLines(lines, topPermIdx);
    const keys = getKeysAtIndent(block, firstIndent(block));
    const contents = getListValue(block, 'contents');
    if (keys.length !== 1 || keys[0] !== 'contents' || !contents || contents[0] !== 'read') {
      violations.push(`expected top-level permissions to be exactly contents: read, got ${JSON.stringify(block)}`);
    }
  }

  const planBlock = getJobBlock(text, 'plan');
  if (!planBlock) {
    violations.push('jobs.plan not found');
  } else {
    const permIdx = planBlock.findIndex((l) => /^\s*permissions:\s*$/.test(l));
    if (permIdx === -1) {
      violations.push('jobs.plan.permissions not found');
    } else {
      const block = getBlockLines(planBlock, permIdx);
      const pullRequests = getListValue(block, 'pull-requests');
      if (!pullRequests || pullRequests[0] !== 'write') {
        violations.push('jobs.plan.permissions missing pull-requests: write');
      }
    }
  }

  const applyBlock = getJobBlock(text, 'apply');
  if (!applyBlock) {
    violations.push('jobs.apply not found');
  } else {
    const permIdx = applyBlock.findIndex((l) => /^\s*permissions:\s*$/.test(l));
    if (permIdx === -1) {
      violations.push('jobs.apply.permissions not found');
    } else {
      const block = getBlockLines(applyBlock, permIdx);
      const actions = getListValue(block, 'actions');
      if (!actions || actions[0] !== 'read') {
        violations.push('jobs.apply.permissions missing actions: read');
      }
    }
  }

  if (/id-token/.test(text)) {
    violations.push('id-token found somewhere in the file — expected nowhere');
  }
  return violations;
}

export function checkActionPinning(text) {
  const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  const violations = [];
  for (const u of uses) {
    const atIdx = u.lastIndexOf('@');
    if (atIdx === -1) {
      violations.push(`${u} has no @ pin`);
      continue;
    }
    const ref = u.slice(atIdx + 1);
    if (!/^v\d+/.test(ref)) {
      violations.push(`${u} is not pinned to a tag matching ^v\\d+ (got @${ref})`);
    }
  }
  return violations;
}

export function checkApplyNoPlan(text) {
  const applyBlock = getJobBlock(text, 'apply');
  if (!applyBlock) return ['jobs.apply not found'];
  const joined = applyBlock.join('\n');
  if (/railway config plan/.test(joined)) {
    return ['jobs.apply calls railway config plan — apply must not re-evaluate'];
  }
  return [];
}

export function checkStepOrder(text) {
  const applyBlock = getJobBlock(text, 'apply');
  if (!applyBlock) return ['jobs.apply not found'];
  const joined = applyBlock.join('\n');
  const precheckIdx = joined.indexOf('Destructive pre-check (read-only)');
  const applyStepIdx = joined.indexOf('- name: Apply');
  if (precheckIdx === -1) return ['"Destructive pre-check (read-only)" step not found in jobs.apply'];
  if (applyStepIdx === -1) return ['"Apply" step not found in jobs.apply'];
  if (!(precheckIdx < applyStepIdx)) {
    return ['"Destructive pre-check (read-only)" must precede the "Apply" step'];
  }
  return [];
}

// ---------------------------------------------------------------------------
// test.yml checks
// ---------------------------------------------------------------------------

export function checkTestRailwayJobExists(text) {
  const block = getJobBlock(text, 'test-railway');
  return block ? [] : ['jobs.test-railway not found'];
}

export function checkTestRailwayRunsPnpmTestRailway(text) {
  const block = getJobBlock(text, 'test-railway');
  if (!block) return ['jobs.test-railway not found'];
  const joined = block.join('\n');
  if (!/run:\s*pnpm test:railway/.test(joined)) {
    return ['jobs.test-railway does not run `pnpm test:railway`'];
  }
  return [];
}

// BUG-029: the contract test suite in .github/tests/ must actually run somewhere,
// not just exist. It runs as a step of test-railway, after `pnpm test:railway`.
export function checkTestRailwayRunsPnpmTestWorkflows(text) {
  const block = getJobBlock(text, 'test-railway');
  if (!block) return ['jobs.test-railway not found'];
  const joined = block.join('\n');
  if (!/run:\s*pnpm test:workflows/.test(joined)) {
    return ['jobs.test-railway does not run `pnpm test:workflows`'];
  }
  const railwayIdx = joined.indexOf('run: pnpm test:railway');
  const workflowsIdx = joined.indexOf('run: pnpm test:workflows');
  if (!(railwayIdx !== -1 && workflowsIdx !== -1 && railwayIdx < workflowsIdx)) {
    return ['jobs.test-railway must run `pnpm test:workflows` after `pnpm test:railway`'];
  }
  return [];
}

export function checkTestRailwayNoPathsNoSecrets(text) {
  const block = getJobBlock(text, 'test-railway');
  if (!block) return ['jobs.test-railway not found'];
  const violations = [];
  if (block.some((l) => /^\s*paths:\s*$/.test(l))) violations.push('jobs.test-railway has a paths: filter');
  if (block.some((l) => /^\s*env:\s*$/.test(l))) violations.push('jobs.test-railway has an env: block');
  if (block.some((l) => /^\s*secrets:\s*$/.test(l))) violations.push('jobs.test-railway has a secrets: block');
  return violations;
}

export function checkExistingJobsUnchanged(text) {
  const violations = [];
  const web = getJobBlock(text, 'test-web');
  const api = getJobBlock(text, 'test-api');
  if (!web) violations.push('jobs.test-web not found');
  else if (!web.some((l) => /uses:\s*actions\/checkout@/.test(l))) violations.push('jobs.test-web missing checkout step');
  if (!api) violations.push('jobs.test-api not found');
  else if (!api.some((l) => /uses:\s*actions\/checkout@/.test(l))) violations.push('jobs.test-api missing checkout step');
  return violations;
}

export function checkTestYmlTopLevelUnchanged(text) {
  const lines = text.split('\n');
  const violations = [];

  const onIdx = findLineIndex(lines, /^on:\s*$/);
  if (onIdx === -1) {
    violations.push('no on: block');
  } else {
    const onBlock = getBlockLines(lines, onIdx);
    const indent = firstIndent(onBlock);
    const keys = getKeysAtIndent(onBlock, indent);
    if (JSON.stringify([...keys].sort()) !== JSON.stringify(['pull_request', 'push'])) {
      violations.push(`expected on: keys [push, pull_request], got [${keys.join(', ')}]`);
    }
  }

  const permIdx = findLineIndex(lines, /^permissions:\s*$/);
  if (permIdx === -1) {
    violations.push('no top-level permissions: block');
  } else {
    const block = getBlockLines(lines, permIdx);
    const contents = getListValue(block, 'contents');
    if (!contents || contents[0] !== 'read') violations.push('top-level permissions.contents expected read');
  }

  const ccIdx = findLineIndex(lines, /^concurrency:\s*$/);
  if (ccIdx === -1) {
    violations.push('no top-level concurrency: block');
  } else {
    const block = getBlockLines(lines, ccIdx);
    const group = getListValue(block, 'group');
    const cancel = getListValue(block, 'cancel-in-progress');
    if (!group || !group[0] || !group[0].includes('test-')) violations.push('top-level concurrency.group unexpected');
    if (!cancel || cancel[0] !== 'true') violations.push('top-level concurrency.cancel-in-progress expected true');
  }

  return violations;
}
