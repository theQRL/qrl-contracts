#!/usr/bin/env node
'use strict';

// Runs test/vm/*.t.hyp as Hyperion semantic tests in qrvmone, on the legacy and IR pipelines, with
// and without the optimizer. Every `test…()` function becomes one semantic test on a fresh deployment;
// ihyptest records what the call did and a call that reverts fails the run.
//
//   IHYPTEST=/path/to/ihyptest QRVMONE=/path/to/libqrvmone node scripts/test-hyptest.js [filter]

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ihyptest = process.env.IHYPTEST;
const qrvmone = process.env.QRVMONE;
const filter = process.argv[2];
const testDir = 'test/vm';
const suite = 'qrlContracts';
const suiteDirs = [
  ...['yulOptimizerTests', 'yulInterpreterTests', 'objectCompiler', 'yulControlFlowGraph', 'yulCallGraph'],
  ...['yulStackLayout', 'yulStackShuffling', 'controlFlowSideEffects', 'functionSideEffects', 'yulSyntaxTests'],
  'qrvmCodeTransform'
]
  .map((name) => `libyul/${name}`)
  .concat(
    ['syntaxTests', 'ASTJSON', 'ABIJson', 'natspecJSON', 'smtCheckerTests', 'gasTests', 'memoryGuardTests']
      .concat(['astPropertyTests'])
      .map((name) => `libhyperion/${name}`)
  );

if (!ihyptest || !qrvmone) {
  console.error('error: set IHYPTEST to the ihyptest binary and QRVMONE to the qrvmone library');
  process.exit(2);
}

const importPattern = /^(import\s+(?:[^"]*\sfrom\s+)?")([^"]+)(";)/gm;

function resolve(file, imported) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), imported));
}

// Source names of everything `file` imports, dependencies first.
function dependencies(file, seen = new Set()) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  return [...source.matchAll(importPattern)].flatMap((match) => {
    const imported = resolve(file, match[2]);
    if (seen.has(imported)) return [];
    seen.add(imported);
    return [...dependencies(imported, seen), imported];
  });
}

// One semantic test per test function, so that each runs on a fresh deployment.
function semanticTests(file) {
  const sources = dependencies(file).map(
    (name) => `==== Source: ${name} ====\n${fs.readFileSync(path.join(root, name), 'utf8')}`
  );
  // The contract under test is the last one of the last source, and ihyptest orders sources by
  // name when it records results, so the test source gets a name that sorts after the others.
  const test = fs.readFileSync(path.join(root, file), 'utf8');
  const main = test.replace(importPattern, (_, head, imported, tail) => `${head}${resolve(file, imported)}${tail}`);
  sources.push(`==== Source: ~${path.posix.basename(file)} ====\n${main}`);

  const group = path.posix.basename(file, '.t.hyp');
  return [...test.matchAll(/function (test\w*)\(\) external/g)].map((match) => ({
    name: `${group}.${match[1]}`,
    content: `${sources.join('\n')}\n// ----\n// ${match[1]}() ->\n`
  }));
}

function run(optimize) {
  const testPath = fs.mkdtempSync(path.join(os.tmpdir(), 'qrl-contracts-hyptest.'));
  const dir = path.join(testPath, 'libhyperion', 'semanticTests', suite);
  fs.mkdirSync(dir, { recursive: true });
  // ihyptest refuses a test path that lacks the directory of any of its suites.
  for (const suiteDir of suiteDirs) fs.mkdirSync(path.join(testPath, suiteDir), { recursive: true });
  try {
    const tests = fs
      .readdirSync(path.join(root, testDir))
      .filter((file) => file.endsWith('.t.hyp'))
      .flatMap((file) => semanticTests(`${testDir}/${file}`))
      .filter((test) => !filter || test.name.includes(filter));
    for (const test of tests) fs.writeFileSync(path.join(dir, `${test.name}.hyp`), test.content);

    const args = ['--no-smt', '--no-color', '--testpath', testPath, '--vm', qrvmone];
    if (optimize) args.push('--optimize');
    args.push('-t', `semanticTests/${suite}*`);
    const ihyp = (extra) =>
      childProcess.spawnSync(ihyptest, [...extra, ...args], {
        encoding: 'utf8',
        input: '',
        timeout: 600000,
        maxBuffer: 256 * 1024 * 1024
      });
    const complete = (result) => {
      const summary = (result.stdout || '').match(/Semantic Test Summary: (\d+)\/(\d+) tests successful(.*)/);
      return result.status === 0 && summary && summary[1] === summary[2] && Number(summary[2]) === tests.length;
    };

    // ihyptest records events and gas a few calls at a time, so let it settle before the strict run.
    for (let round = 0; round < 6 && !complete(ihyp(['--accept-updates'])); round += 1);

    // With the recorded results in place, both pipelines must reproduce them exactly.
    const result = ihyp([]);
    if (result.error) throw result.error;
    if (!complete(result)) {
      console.error((result.stdout + result.stderr).slice(-8000));
      throw new Error(`ihyptest did not complete every test (exit ${result.status})`);
    }

    // The files now hold what each call did.
    const outcomes = tests.map((test) => {
      const recorded = fs.readFileSync(path.join(dir, `${test.name}.hyp`), 'utf8').split('\n// ----\n').pop();
      const call = recorded.match(/^\/\/ test\w*\(\) ->(.*)$/m);
      return { name: test.name, failed: !call || call[1].includes('FAILURE') };
    });
    return outcomes;
  } finally {
    fs.rmSync(testPath, { recursive: true, force: true });
  }
}

let failed = 0;
let passed = 0;
for (const optimize of [false, true]) {
  const label = optimize ? 'optimized' : 'unoptimized';
  const outcomes = run(optimize);
  for (const outcome of outcomes) {
    if (outcome.failed) {
      failed += 1;
      console.log(`FAIL [${label}] ${outcome.name}`);
    } else {
      passed += 1;
      if (process.env.VERBOSE) console.log(`ok   [${label}] ${outcome.name}`);
    }
  }
}

console.log(`${passed} passed, ${failed} failed (each on the legacy and IR pipelines)`);
process.exit(failed === 0 ? 0 : 1);
