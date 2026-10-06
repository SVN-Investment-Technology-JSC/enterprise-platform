import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const nxCli = join(dirname(require.resolve('nx/package.json')), 'dist/bin/nx.js');

// Keep development builds from allocating a plugin worker pool per service.
function runNx(args) {
  return spawnSync(process.execPath, [nxCli, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NX_ISOLATE_PLUGINS: 'false',
      NX_DAEMON: 'false',
    },
  });
}

export function runDevelopment(args, runner = runNx) {
  const projects = args.find((arg) => arg.startsWith('--projects='));
  if (args[0] === 'run-many' && args.includes('serve') && projects) {
    const backends = projects.slice('--projects='.length).split(',')
      .filter((name) => name === 'api' || name.endsWith('-api') || name === 'worker' || name === 'notification-worker');
    if (backends.length) {
      const build = runner(['run-many', '-t', 'build', `--projects=${backends.join(',')}`,
        '--configuration=development', '--parallel=2', '--outputStyle=stream']);
      if (build.error || build.status !== 0) return build;
      // Keep frontend ^build dependencies in the common graph as well.
      // Backend watchers run their webpack executor directly, without nested graphs.
      return runner(args);
    }
  }
  return runner(args);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runDevelopment(process.argv.slice(2));
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? (result.signal === 'SIGINT' ? 130 : 1));
}
