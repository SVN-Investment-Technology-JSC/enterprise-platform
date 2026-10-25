import assert from 'node:assert/strict';
import { test } from 'node:test';
import { delimiter, join } from 'node:path';
import { developmentEnv, runDevelopment } from './dev.mjs';

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

test('builds and starts the video worker with the other backends', () => {
  const withVideo = ['run-many', '-t', 'dev', 'serve', '--projects=web,api,worker,video-worker'];
  const calls = [];
  runDevelopment(withVideo, (args) => { calls.push(args); return { status: 0 }; });
  assert.ok(calls[0].includes('build'));
  assert.ok(calls[0].includes('--projects=api,worker,video-worker'));
  assert.deepEqual(calls[1], withVideo);
});

test('keeps single-project commands focused on that project', () => {
  const calls = [];
  runDevelopment(['serve', 'worker'], (args) => { calls.push(args); return { status: 0 }; });
  assert.deepEqual(calls, [['serve', 'worker']]);
});

test('adds the pnpm module directory to NODE_PATH once, keeping existing entries', () => {
  const first = developmentEnv({ NODE_PATH: 'x' }).NODE_PATH.split(delimiter);
  assert.equal(first[0], 'x');
  assert.ok(first[1].endsWith(join('.pnpm', 'node_modules')));
  const again = developmentEnv({ NODE_PATH: first.join(delimiter) }).NODE_PATH.split(delimiter);
  assert.deepEqual(again, first);
});
