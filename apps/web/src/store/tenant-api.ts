import { createApi, type BaseQueryFn } from '@reduxjs/toolkit/query/react';
import type {
  TenantAuthorizationAuditEntry,
  TenantPermission,
  TenantRole,
  TenantUserPermissionGrants,
} from '@enterprise-platform/contracts-identity';
import { authorizationRequest } from '@/app/(tenant)/authorization/authorization-client';
import type {
  TenantCoreUser,
  TenantUserInput,
} from '@/app/(tenant)/users/user-types';

export interface RequestArgs {
  path: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
}

export interface ApiError {
  message: string;
}

/** Gọi API Platform bằng `authorizationRequest` (cookie + CSRF); lỗi trả `{ message }` tiếng Việt từ máy chủ. */
const baseQuery: BaseQueryFn<RequestArgs, unknown, ApiError> = async ({
  path,
  method,
  body,
}) => {
  try {
    return { data: await authorizationRequest(path, method, body) };
  } catch (cause) {
    return {
      error: {
        message:
          cause instanceof Error ? cause.message : 'Không thể thực hiện thao tác.',
      },
    };
  }
};

/**
 * Bộ nhớ đệm cho các trang Tenant Portal về người dùng và phân quyền. Mỗi dữ liệu có tag; sau thao tác ghi chỉ
 * làm mất hiệu lực đúng dữ liệu liên quan (một người, danh sách, vai trò), nên đi từ danh sách vào chi tiết và
 * quay lại không gọi lại API vô nghĩa.
 */
export const tenantApi = createApi({
  reducerPath: 'tenantApi',
  baseQuery,
  keepUnusedDataFor: 300,
  tagTypes: ['UserList', 'User', 'Roles', 'Permissions', 'Grants', 'History'],
  endpoints: (build) => ({
    getUsers: build.query<TenantCoreUser[], void>({
      query: () => ({ path: 'tenant-users' }),
      transformResponse: (r: { users: TenantCoreUser[] }) => r.users,
      providesTags: (users) => [
        'UserList',
        ...(users ?? []).map((u) => ({ type: 'User' as const, id: u.id })),
      ],
    }),
    getUser: build.query<TenantCoreUser, string>({
      query: (id) => ({ path: `tenant-users/${id}` }),
      transformResponse: (r: { user: TenantCoreUser }) => r.user,
      providesTags: (_r, _e, id) => [{ type: 'User', id }],
    }),
    createUser: build.mutation<TenantCoreUser, TenantUserInput>({
      query: (body) => ({ path: 'tenant-users', method: 'POST', body }),
      transformResponse: (r: { user: TenantCoreUser }) => r.user,
      invalidatesTags: ['UserList'],
    }),
    updateUser: build.mutation<
      TenantCoreUser,
      { id: string; patch: TenantUserInput }
    >({
      query: ({ id, patch }) => ({
        path: `tenant-users/${id}`,
        method: 'PATCH',
        body: patch,
      }),
      transformResponse: (r: { user: TenantCoreUser }) => r.user,
      // Đổi tên hay trạng thái hiện ngay; máy chủ từ chối thì hoàn lại.
      async onQueryStarted({ id, patch }, { dispatch, queryFulfilled }) {
        const apply = (draft: Partial<TenantCoreUser>) => {
          if (patch.fullName !== undefined) draft.fullName = patch.fullName;
          if (patch.status !== undefined) {
            draft.status = patch.status;
            draft.isActive = patch.status === 'active';
          }
        };
        const undo = [
          dispatch(
            tenantApi.util.updateQueryData('getUser', id, (d) => apply(d)),
          ),
          dispatch(
            tenantApi.util.updateQueryData('getUsers', undefined, (d) => {
              const row = d.find((u) => u.id === id);
              if (row) apply(row);
            }),
          ),
        ];
        try {
          await queryFulfilled;
        } catch {
          undo.forEach((u) => u.undo());
        }
      },
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'User', id },
        'UserList',
        { type: 'History', id },
      ],
    }),
    deleteUser: build.mutation<void, string>({
      query: (id) => ({ path: `tenant-users/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => [
        'UserList',
        'Roles',
        { type: 'User', id },
      ],
    }),
    getRoles: build.query<TenantRole[], void>({
      query: () => ({ path: 'tenant-roles' }),
      transformResponse: (r: { roles: TenantRole[] }) => r.roles,
      providesTags: ['Roles'],
    }),
    getPermissions: build.query<TenantPermission[], void>({
      query: () => ({ path: 'tenant-permissions' }),
      transformResponse: (r: { permissions: TenantPermission[] }) =>
        r.permissions,
      providesTags: ['Permissions'],
    }),
    setUserRoles: build.mutation<
      { roleIds: string[] },
      { id: string; roleIds: string[] }
    >({
      query: ({ id, roleIds }) => ({
        path: `tenant-users/${id}/roles`,
        method: 'PUT',
        body: { roleIds },
      }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'User', id },
        'UserList',
        'Roles',
        { type: 'History', id },
      ],
    }),
    getUserGrants: build.query<TenantUserPermissionGrants, string>({
      query: (id) => ({ path: `tenant-users/${id}/permission-grants` }),
      providesTags: (_r, _e, id) => [{ type: 'Grants', id }],
    }),
    setUserGrants: build.mutation<
      TenantUserPermissionGrants,
      { id: string; actionKeys: string[] }
    >({
      query: ({ id, actionKeys }) => ({
        path: `tenant-users/${id}/permission-grants`,
        method: 'PUT',
        body: { actionKeys },
      }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'Grants', id },
        { type: 'User', id },
        'UserList',
        { type: 'History', id },
      ],
    }),
    getUserHistory: build.query<TenantAuthorizationAuditEntry[], string>({
      query: (id) => ({ path: `tenant-users/${id}/authorization-history` }),
      transformResponse: (r: { entries: TenantAuthorizationAuditEntry[] }) =>
        r.entries,
      providesTags: (_r, _e, id) => [{ type: 'History', id }],
    }),
  }),
});

export const {
  useGetUsersQuery,
  useGetUserQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useDeleteUserMutation,
  useGetRolesQuery,
  useGetPermissionsQuery,
  useSetUserRolesMutation,
  useGetUserGrantsQuery,
  useSetUserGrantsMutation,
  useGetUserHistoryQuery,
} = tenantApi;
