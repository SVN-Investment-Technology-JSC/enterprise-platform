import { access, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const workspaceRoot = process.cwd();
const manifestPath = resolve(workspaceRoot, 'tools/deployment/services.json');
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const imageRepositoryPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const moduleSpecifierPattern = /^@?[a-zA-Z0-9][a-zA-Z0-9@._/-]*$/;

function fail(message) {
  throw new Error(`Invalid deployment manifest: ${message}`);
}

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch (error) {
  throw new Error(
    `Cannot read ${manifestPath}: ${(error instanceof Error && error.message) || String(error)}`,
  );
}

if (!Array.isArray(manifest.services) || manifest.services.length === 0) {
  fail('"services" must be a non-empty array.');
}
if (
  typeof manifest.imageRepository !== 'string' ||
  !imageRepositoryPattern.test(manifest.imageRepository)
) {
  fail('"imageRepository" must be a lowercase OCI image repository name.');
}

const serviceIds = new Set();
const services = [];

for (const service of manifest.services) {
  if (!service || typeof service !== 'object')
    fail('every service must be an object.');

  const { id, dockerfile, runtimeCheck } = service;
  if (typeof id !== 'string' || !idPattern.test(id))
    fail(`service id "${id}" must be lowercase kebab-case.`);
  if (serviceIds.has(id)) fail(`service id "${id}" is duplicated.`);
  if (typeof dockerfile !== 'string' || !dockerfile.endsWith('/Dockerfile')) {
    fail(
      `service "${id}" must define a Dockerfile path ending in "/Dockerfile".`,
    );
  }
  const dockerfilePath = resolve(workspaceRoot, dockerfile);
  if (!dockerfilePath.startsWith(`${workspaceRoot}${sep}`))
    fail(`service "${id}" Dockerfile escapes the workspace.`);
  try {
    await access(dockerfilePath);
  } catch {
    fail(`service "${id}" Dockerfile does not exist: ${dockerfile}.`);
  }

  if (runtimeCheck !== undefined) {
    if (
      !runtimeCheck ||
      typeof runtimeCheck !== 'object' ||
      Array.isArray(runtimeCheck) ||
      !Array.isArray(runtimeCheck.nodeModules) ||
      runtimeCheck.nodeModules.length === 0
    ) {
      fail(
        `service "${id}" runtimeCheck must define a non-empty nodeModules array.`,
      );
    }
    for (const moduleSpecifier of runtimeCheck.nodeModules) {
      if (
        typeof moduleSpecifier !== 'string' ||
        !moduleSpecifierPattern.test(moduleSpecifier)
      ) {
        fail(
          `service "${id}" runtimeCheck contains an invalid Node module specifier.`,
        );
      }
    }
  }

  serviceIds.add(id);
  services.push({
    service: id,
    dockerfile,
    imageRepository: manifest.imageRepository,
    runtimeCheck,
  });
}

process.stdout.write(JSON.stringify({ include: services }));
