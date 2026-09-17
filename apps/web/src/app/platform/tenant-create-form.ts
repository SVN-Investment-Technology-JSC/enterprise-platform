export function organizationNamePatch(name: string) {
  return { name };
}

export function tenantSlugPatch(slug: string) {
  const databaseIdentifier = slug.replaceAll('-', '_');
  return {
    slug,
    databaseName: databaseIdentifier,
    secretRef: slug
      ? `TENANT_${databaseIdentifier.toUpperCase()}_DATABASE_URL`
      : '',
  };
}

export function sanitizeEmailLocal(value: string): string {
  return value.split('@', 1)[0];
}

export function tenantAdminEmail(local: string, tenantSlug: string): string {
  return `${local}@${tenantSlug}.com`;
}
