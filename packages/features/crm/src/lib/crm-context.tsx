'use client';

import {
  CRM_NO_CAPABILITIES,
  type CrmCapabilities,
  type CrmPerson,
  type CustomerGroup,
  type CustomerKindOption,
} from '@enterprise-platform/contracts-crm';
import type { SearchableSelectOption } from '@enterprise-platform/shared-ui';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { listGroups, listKinds, listPeople } from './crm-api';

/**
 * Dữ liệu dùng chung cho mọi màn Bán hàng: quyền (để ẩn hiện), danh bạ chọn
 * người, nhóm khách, phân loại khách. Tải một lần khi mở phân hệ.
 */
export interface CrmContextValue {
  readonly capabilities: CrmCapabilities;
  readonly currentUserId?: string;
  readonly people: readonly CrmPerson[];
  readonly groups: readonly CustomerGroup[];
  readonly reloadGroups: () => void;
  readonly kinds: readonly CustomerKindOption[];
  readonly reloadKinds: () => void;
}

const CrmContext = createContext<CrmContextValue>({
  capabilities: CRM_NO_CAPABILITIES,
  people: [],
  groups: [],
  reloadGroups: () => undefined,
  kinds: [],
  reloadKinds: () => undefined,
});

export function CrmDataProvider({
  capabilities,
  currentUserId,
  children,
}: {
  capabilities: CrmCapabilities;
  currentUserId?: string;
  children: ReactNode;
}) {
  const [people, setPeople] = useState<readonly CrmPerson[]>([]);
  const [groups, setGroups] = useState<readonly CustomerGroup[]>([]);

  const [kinds, setKinds] = useState<readonly CustomerKindOption[]>([]);

  const reloadGroups = useCallback(() => {
    listGroups().then(setGroups).catch(() => undefined);
  }, []);
  const reloadKinds = useCallback(() => {
    listKinds().then(setKinds).catch(() => undefined);
  }, []);

  useEffect(() => {
    // Danh bạ lỗi (Tenant Core chậm) thì ô chọn người trống; thao tác khác vẫn chạy.
    listPeople().then(setPeople).catch(() => undefined);
    reloadGroups();
    reloadKinds();
  }, [reloadGroups, reloadKinds]);

  const value = useMemo(
    () => ({ capabilities, currentUserId, people, groups, reloadGroups, kinds, reloadKinds }),
    [capabilities, currentUserId, people, groups, reloadGroups, kinds, reloadKinds],
  );
  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrm(): CrmContextValue {
  return useContext(CrmContext);
}

/** Được thêm, sửa khách hàng, lead, cơ hội, hoạt động. */
export function useCanWrite(): boolean {
  const { capabilities } = useCrm();
  return capabilities.isTenantAdmin || capabilities.canWriteOpportunity;
}

export function peopleOptions(people: readonly CrmPerson[]): SearchableSelectOption[] {
  return people.map((person) => ({ value: person.userId, label: person.displayName }));
}

export function groupOptions(groups: readonly CustomerGroup[]): SearchableSelectOption[] {
  return groups.map((group) => ({ value: group.id, label: group.name, badge: group.code }));
}

export function kindOptions(kinds: readonly CustomerKindOption[]): SearchableSelectOption[] {
  return kinds.map((kind) => ({ value: kind.code, label: kind.name }));
}

/** Tuỳ chọn từ bảng nhãn (`{ KEY: 'Nhãn' }`). */
export function labelOptions(labels: Readonly<Record<string, string>>): SearchableSelectOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}
