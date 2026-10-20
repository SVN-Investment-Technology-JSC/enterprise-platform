export interface TenantCoreUser {
  roleIds?: string[];
  /** Khóa action được cấp thẳng cho người dùng, ngoài vai trò. */
  directActionKeys?: string[];
  roles?: { id: string; name: string }[];
  id: string;
  username: string | null;
  fullName: string;
  email: string;
  systemRole: 'tenant-admin' | 'tenant-user';
  status: 'active' | 'disabled';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenantUserInput {
  fullName?: string;
  email?: string;
  password?: string;
  status?: 'active' | 'disabled';
}
