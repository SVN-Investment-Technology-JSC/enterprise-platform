import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickBase, planPublish, productionRelease } from './publish-plan.mjs';

const sha = (n) => String(n).padStart(40, '0');
const head = sha(9);
const services = [
  { id: 'api', dockerfile: 'apps/api/Dockerfile' },
  { id: 'procedure-api', dockerfile: 'apps/procedure-api/Dockerfile' },
  { id: 'gateway', dockerfile: 'infrastructure/nginx/Dockerfile' },
];

// Commit n has time n; every commit below `head` is an ancestor of it.
const git = {
  isAncestor: (commit) => Number(commit) <= Number(head),
  commitTime: (commit) => Number(commit),
};

const version = (name, tags) => ({ name, tags });

test('reads the digest and the sha tags of the production image only', () => {
  const versions = [
    version('sha256:old', ['api-sha-' + sha(1)]),
    version('sha256:cur', [
      'api-production',
      'api-sha-' + sha(2),
      'api-sha-' + sha(5),
    ]),
    version('sha256:other', ['procedure-api-production', 'procedure-api-sha-' + sha(3)]),
  ];
  assert.deepEqual(productionRelease('api', versions), {
    digest: 'sha256:cur',
    shas: [sha(2), sha(5)],
  });
  assert.equal(productionRelease('web', versions), undefined);
});

test('picks the newest tag that is an ancestor of HEAD', () => {
  const offBranch = { ...git, isAncestor: (commit) => commit !== sha(7) };
  assert.equal(pickBase([sha(2), sha(5), sha(7)], head, offBranch), sha(5));
  assert.equal(pickBase([sha(7)], head, offBranch), undefined);
});

test('reuses unaffected services and builds affected and project-less ones', () => {
  const versions = [
    version('sha256:api', ['api-production', 'api-sha-' + sha(4)]),
    version('sha256:proc', ['procedure-api-production', 'procedure-api-sha-' + sha(4)]),
  ];
  const plan = planPublish({
    services,
    versions,
    head,
    git,
    affectedSince: () => ['api'],
  });
  assert.deepEqual(plan.build, ['api', 'gateway']);
  assert.deepEqual(plan.retag, [{ service: 'procedure-api', digest: 'sha256:proc' }]);
});

test('compares each service with its own base commit', () => {
  const versions = [
    version('sha256:api', ['api-production', 'api-sha-' + sha(8)]),
    // procedure-api missed the last publish, so its newest tag is older.
    version('sha256:proc', ['procedure-api-production', 'procedure-api-sha-' + sha(3)]),
  ];
  const seen = [];
  const plan = planPublish({
    services,
    versions,
    head,
    git,
    affectedSince: (base) => {
      seen.push(base);
      return base === sha(3) ? ['procedure-api'] : [];
    },
  });
  assert.deepEqual(seen.sort(), [sha(3), sha(8)]);
  assert.deepEqual(plan.build, ['procedure-api', 'gateway']);
  assert.deepEqual(plan.retag, [{ service: 'api', digest: 'sha256:api' }]);
});

test('builds everything when the registry or nx cannot be trusted', () => {
  const noRegistry = planPublish({
    services,
    versions: [],
    head,
    git,
    affectedSince: () => [],
  });
  assert.deepEqual(noRegistry.build, ['api', 'procedure-api', 'gateway']);
  assert.deepEqual(noRegistry.retag, []);

  const versions = [
    version('sha256:api', ['api-production', 'api-sha-' + sha(4)]),
    version('sha256:proc', ['procedure-api-production', 'procedure-api-sha-' + sha(4)]),
  ];
  const nxFails = planPublish({
    services,
    versions,
    head,
    git,
    affectedSince: () => {
      throw new Error('boom');
    },
  });
  assert.deepEqual(nxFails.build, ['api', 'procedure-api', 'gateway']);
  assert.deepEqual(nxFails.retag, []);
});
