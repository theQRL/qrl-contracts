#!/usr/bin/env node
'use strict';

// Compiles test/vm/*.hyp on the legacy and IR pipelines and runs every `test…()` function in
// go-qrl's VM. A test passes when the call does not revert; a `testEmits…()` function also returns
// the topic of an event the call must have emitted.
//
//   GO_QRL=/path/to/go-qrl [HYPC=hypcjs] node scripts/test-vm.js [filter]

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const hypc = process.env.HYPC || 'hypcjs';
const goQrl = process.env.GO_QRL && path.resolve(process.env.GO_QRL);
const filter = process.argv[2];
const testDir = 'test/vm';

if (!goQrl) {
  console.error('error: set GO_QRL to a go-qrl checkout; the tests run in its VM');
  process.exit(2);
}

function compile(file, viaIR) {
  const input = {
    language: 'Hyperion',
    sources: { [file]: { content: fs.readFileSync(path.join(root, file), 'utf8') } },
    settings: {
      viaIR,
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { [file]: { '*': ['qrvm.bytecode.object', 'qrvm.methodIdentifiers'] } }
    }
  };
  // The compiler exits before a pipe drains, so its output goes to a file.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qrl-contracts-vm-test.'));
  let output;
  try {
    const outFile = path.join(scratch, 'output.json');
    const out = fs.openSync(outFile, 'w');
    const result = childProcess.spawnSync(hypc, ['--standard-json', '--base-path', '.'], {
      cwd: root,
      input: JSON.stringify(input),
      encoding: 'utf8',
      stdio: ['pipe', out, 'pipe']
    });
    fs.closeSync(out);
    if (result.status !== 0) throw new Error(`${hypc} failed on ${file}:\n${result.stderr}`);
    output = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  const errors = (output.errors || []).filter((error) => error.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((error) => error.formattedMessage).join('\n'));

  return Object.entries(output.contracts[file])
    .map(([name, contract]) => ({
      name,
      bytecode: `0x${contract.qrvm.bytecode.object}`,
      tests: Object.entries(contract.qrvm.methodIdentifiers)
        .filter(([signature]) => /^test\w*\(\)$/.test(signature))
        .filter(([signature]) => !filter || `${name}.${signature}`.includes(filter))
        .map(([signature, selector]) => ({ name: signature.slice(0, -2), selector: `0x${selector}` }))
    }))
    .filter((contract) => contract.tests.length > 0);
}

function execute(contracts) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qrl-contracts-vm-test.'));
  try {
    const overlay = path.join(scratch, 'overlay.json');
    fs.writeFileSync(
      overlay,
      JSON.stringify({
        Replace: {
          [path.join(goQrl, 'cmd/qrl-contracts-vm-test/main.go')]: path.join(__dirname, 'vm-runner/main.go')
        }
      })
    );
    const stdout = childProcess.execFileSync('go', ['run', '-overlay', overlay, './cmd/qrl-contracts-vm-test'], {
      cwd: goQrl,
      input: JSON.stringify(contracts),
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'inherit']
    });
    return JSON.parse(stdout);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function check(result) {
  if (!result.ok) return `${result.error} ${result.output}`;
  if (result.test.startsWith('testEmits') && !result.topics.includes(result.output)) {
    return `no event with topic ${result.output}`;
  }
  return null;
}

const files = fs
  .readdirSync(path.join(root, testDir))
  .filter((file) => file.endsWith('.t.hyp'))
  .sort()
  .map((file) => `${testDir}/${file}`);

let failed = 0;
let passed = 0;
for (const [pipeline, viaIR] of [
  ['legacy', false],
  ['ir', true]
]) {
  const contracts = files.flatMap((file) => compile(file, viaIR));
  if (contracts.length === 0) {
    console.error(filter ? `error: no test matches "${filter}"` : `error: no tests found in ${testDir}`);
    process.exit(1);
  }
  for (const result of execute(contracts)) {
    const failure = check(result);
    if (failure) {
      failed += 1;
      console.log(`FAIL [${pipeline}] ${result.contract}.${result.test}: ${failure}`);
    } else {
      passed += 1;
      if (process.env.VERBOSE) console.log(`ok   [${pipeline}] ${result.contract}.${result.test}`);
    }
  }
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
