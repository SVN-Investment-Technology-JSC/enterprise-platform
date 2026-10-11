'use client';

import { createContext, useContext } from 'react';

export const InventoryPermissionsContext = createContext({
  canManage: false,
  canWriteTransactions: false,
  canCreateStocktake: false,
  canApproveStocktake: false,
});

/** UI capabilities only; every mutation is independently authorized by the API. */
export const useInventoryPermissions = () => useContext(InventoryPermissionsContext);
