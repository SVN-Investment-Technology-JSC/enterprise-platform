import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runDevelopment } from './dev.mjs';

const stack = ['run-many', '-t', 'dev', 'serve', '--projects=web,api,worker'];

test('does not start services when their dependency build fails', () => {
  let calls = 0;
  const result = runDevelopment(stack, () => { calls++; return { status: 7 }; });
  assert.equal(result.status, 7);
  assert.equal(calls, 1);
});

test('finishes the backend build before starting the continuous services', () => {
  let built = false;
  let started = false;
  const result = runDevelopment(stack, (args) => {
    if (args.includes('build')) {
      assert.equal(started, false);
      assert.ok(args.includes('--projects=api,worker'));
      built = true;
    } else {
      assert.equal(built, true);
      assert.ok(!args.includes('--excludeTaskDependencies'));
      assert.deepEqual(args, stack);
      started = true;
    }
    return { status: 0 };
  });
  assert.equal(result.status, 0);
  assert.equal(started, true);
});

test('keeps single-project commands focused on that project', () => {
  const calls = [];
  runDevelopment(['serve', 'worker'], (args) => { calls.push(args); return { status: 0 }; });
  assert.deepEqual(calls, [['serve', 'worker']]);
});
