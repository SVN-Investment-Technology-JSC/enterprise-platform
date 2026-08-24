import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workspaceRoot = process.cwd();
const manifestPath = resolve(workspaceRoot, 'tools/deployment/services.json');
const token = process.env.GITHUB_TOKEN;
const owner = process.env.GHCR_OWNER;
const retainPerService = Number.parseInt(
  process.env.RETAIN_PER_SERVICE ?? '10',
  10,
);
const dryRun = process.env.DRY_RUN === 'true';

function fail(message) {
  throw new Error(`GHCR cleanup: ${message}`);
}

if (!token) fail('GITHUB_TOKEN is required.');
if (!owner) fail('GHCR_OWNER is required.');
if (!Number.isSafeInteger(retainPerService) || retainPerService < 1) {
  fail('RETAIN_PER_SERVICE must be a positive integer.');
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!manifest.imageRepository || !Array.isArray(manifest.services)) {
  fail('deployment manifest must define imageRepository and services.');
}

const serviceIds = new Set(manifest.services.map(({ id }) => id));
if (
  serviceIds.size === 0 ||
  [...serviceIds].some((id) => typeof id !== 'string')
) {
  fail('deployment manifest has no valid service ids.');
}

const baseUrl = `https://api.github.com/orgs/${encodeURIComponent(owner)}/packages/container/${encodeURIComponent(manifest.imageRepository)}/versions`;
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2026-03-10',
};

async function github(path, options = {}) {
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `${options.method ?? 'GET'} ${path} failed (${response.status}): ${body}`,
    );
  }
  return response.status === 204 ? undefined : response.json();
}

async function listVersions() {
  const versions = [];
  for (let page = 1; ; page += 1) {
    const result = await github(`${baseUrl}?per_page=100&page=${page}`);
    versions.push(...result);
    if (result.length < 100) return versions;
  }
}

function taggedVersionsFor(service, versions) {
  const shaTag = new RegExp(`^${service}-sha-[0-9a-f]+$`);
  const productionTag = `${service}-production`;

  return versions
    .map((version) => ({
      version,
      tags: version.metadata?.container?.tags ?? [],
    }))
    .filter(({ tags }) => tags.some((tag) => shaTag.test(tag)))
    .filter(({ tags }) => !tags.includes(productionTag))
    .filter(({ tags }) => tags.every((tag) => shaTag.test(tag)))
    .sort(
      (a, b) =>
        Date.parse(b.version.created_at) - Date.parse(a.version.created_at),
    );
}

const versions = await listVersions();
const candidates = new Map();

for (const service of serviceIds) {
  const oldVersions = taggedVersionsFor(service, versions).slice(
    retainPerService,
  );
  for (const { version } of oldVersions) candidates.set(version.id, version);
}

const deletionList = [...candidates.values()].sort(
  (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
);

console.log(
  `Found ${versions.length} package versions. Keeping ${retainPerService} SHA releases per service; ${deletionList.length} old version(s) are eligible for deletion.`,
);

for (const version of deletionList) {
  const tags = version.metadata?.container?.tags?.join(', ') || '(untagged)';
  if (dryRun) {
    console.log(`[dry-run] Would delete version ${version.id}: ${tags}`);
  } else {
    await github(`${baseUrl}/${version.id}`, { method: 'DELETE' });
    console.log(`Deleted version ${version.id}: ${tags}`);
  }
}
