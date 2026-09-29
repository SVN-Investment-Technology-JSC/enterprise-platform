'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { hasTenantAction } from '@enterprise-platform/contracts-identity';
const Context = createContext({
  canCreate: false,
  canUpdate: false,
  canDelete: false,
});
export function OrganizationPermissionsProvider({
  permissions,
  children,
}: {
  readonly permissions: readonly string[];
  readonly children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      canCreate: hasTenantAction(permissions, 'core.organization.create'),
      canUpdate: hasTenantAction(permissions, 'core.organization.update'),
      canDelete: hasTenantAction(permissions, 'core.organization.delete'),
    }),
    [permissions],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useOrganizationPermissions = () => useContext(Context);
