import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Decides, per service, whether a push must build a new image or can reuse the
// image that is currently deployed under `<service>-production`.
//
// A service is reused only when its Nx project is NOT affected between the
// commit its production image was last verified at and HEAD. That commit is the
// newest `<service>-sha-<commit>` tag on the production image that is an
// ancestor of HEAD. Comparing with the previous push instead would be unsafe:
// if that run failed half way, the next run would treat the service as
// unchanged and never publish the code of the failed run.
//
// Anything that cannot be resolved (no production image, no usable tag, nx
// failure, GHCR unreadable) falls back to building the service.

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function productionRelease(service, versions) {
  const production = versions.find((version) =>
    version.tags.includes(`${service}-production`),
  );
  if (!production) return undefined;
  const shaTag = new RegExp(`^${escapeRegExp(service)}-sha-([0-9a-f]{40})$`);
  const shas = production.tags
    .map((tag) => shaTag.exec(tag)?.[1])
    .filter((sha) => sha !== undefined);
  return { digest: production.name, shas };
}

export function pickBase(shas, head, git) {
  let best;
  for (const sha of shas) {
    if (!git.isAncestor(sha, head)) continue;
    const time = git.commitTime(sha);
    if (best === undefined || time > best.time) best = { sha, time };
  }
  return best?.sha;
}

export function planPublish({ services, versions, head, git, affectedSince }) {
  const build = [];
  const retag = [];
  const reasons = {};
  const affectedByBase = new Map();

  const affectedFor = (base) => {
    if (!affectedByBase.has(base)) {
      let affected;
      try {
        affected = new Set(affectedSince(base));
      } catch (error) {
        affected = undefined;
        reasons[`nx@${base.slice(0, 7)}`] = String(error?.message ?? error);
      }
      affectedByBase.set(base, affected);
    }
    return affectedByBase.get(base);
  };

  for (const { id, dockerfile } of services) {
    // Services without an Nx project (the gateway) are cheap and always built.
    if (!dockerfile.startsWith('apps/')) {
      build.push(id);
      reasons[id] = 'no Nx project';
      continue;
    }
    const release = productionRelease(id, versions);
    if (!release) {
      build.push(id);
      reasons[id] = 'no production image';
      continue;
    }
    const base = pickBase(release.shas, head, git);
    if (!base) {
      build.push(id);
      reasons[id] = 'production image has no tag on the HEAD history';
      continue;
    }
    const affected = affectedFor(base);
    if (!affected || affected.has(id)) {
      build.push(id);
      reasons[id] = affected ? `affected since ${base.slice(0, 7)}` : 'nx failed';
      continue;
    }
    retag.push({ service: id, digest: release.digest });
    reasons[id] = `unchanged since ${base.slice(0, 7)}`;
  }
  return { build, retag, reasons };
}

function run(file, args) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

async function listVersions({ owner, repository, token }) {
  const baseUrl = `https://api.github.com/orgs/${encodeURIComponent(owner)}/packages/container/${encodeURIComponent(repository)}/versions`;
  const versions = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(`${baseUrl}?per_page=100&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2026-03-10',
      },
    });
    if (!response.ok) {
      throw new Error(`GET ${baseUrl} failed (${response.status})`);
    }
    const result = await response.json();
    for (const version of result) {
      versions.push({
        name: version.name,
        tags: version.metadata?.container?.tags ?? [],
      });
    }
    if (result.length < 100) return versions;
  }
}

async function main() {
  const manifest = JSON.parse(
    await readFile(
      resolve(process.cwd(), 'tools/deployment/services.json'),
      'utf8',
    ),
  );
  const head = process.env.HEAD_SHA || run('git', ['rev-parse', 'HEAD']);

  let versions = [];
  try {
    versions = await listVersions({
      owner: process.env.GHCR_OWNER,
      repository: manifest.imageRepository,
      token: process.env.GITHUB_TOKEN,
    });
  } catch (error) {
    // Unreadable registry: every service falls back to a full build.
    console.error(`Cannot read GHCR package versions: ${error.message}`);
  }

  const git = {
    isAncestor: (sha, descendant) => {
      try {
        run('git', ['merge-base', '--is-ancestor', sha, descendant]);
        return true;
      } catch {
        return false;
      }
    },
    commitTime: (sha) => Number(run('git', ['show', '-s', '--format=%ct', sha])),
  };

  const plan = planPublish({
    services: manifest.services,
    versions,
    head,
    git,
    affectedSince: (base) =>
      JSON.parse(
        run('pnpm', [
          'exec',
          'nx',
          'show',
          'projects',
          '--affected',
          `--base=${base}`,
          `--head=${head}`,
          '--json',
        ]),
      ),
  });

  for (const [service, reason] of Object.entries(plan.reasons)) {
    console.error(`${service}: ${reason}`);
  }
  process.stdout.write(JSON.stringify({ build: plan.build, retag: plan.retag }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
