const TENANT_EMAIL_PATTERN = /^[^\s@]+@([a-z0-9]+(?:-[a-z0-9]+)*)\.(?:com|local)$/i;

export function tenantSlugFromEmail(email: string | undefined): string | undefined {
  const match = email?.trim().match(TENANT_EMAIL_PATTERN);
  return match?.[1]?.toLowerCase();
}
