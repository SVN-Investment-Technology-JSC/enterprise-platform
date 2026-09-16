export function sanitizeTenantEmailLocal(value: string) {
  return value.replace(/\s/g, '').split('@', 1)[0];
}

export function buildTenantEmail(localPart: string, tenantSlug: string) {
  return `${sanitizeTenantEmailLocal(localPart)}@${tenantSlug}.com`;
}
