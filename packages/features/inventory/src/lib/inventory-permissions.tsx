'use client';

import { createContext, useContext } from 'react';

export const InventoryPermissionsContext = createContext({
  canManage: false,
  canWriteTransactions: false,
  canWriteQuality: false,
  canApproveDocuments: false,
  /** Xem giá vốn, giá trị tồn (`inventory.cost.read`); không có thì API cũng không trả các trường đó. */
  canReadCost: false,
});

/** UI capabilities only; every mutation is independently authorized by the API. */
export const useInventoryPermissions = () => useContext(InventoryPermissionsContext);
