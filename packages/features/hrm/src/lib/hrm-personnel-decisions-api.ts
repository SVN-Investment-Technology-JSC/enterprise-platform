'use client';
import { useCallback, useEffect, useState } from 'react';
import type {
  CreateHrmPersonnelDecisionPayload,
  HrmAppointmentContext,
  HrmPersonnelDecision,
  HrmPersonnelDecisionStatus,
  HrmPersonnelDecisionType,
  HrmReportingOverview,
  UpdateHrmPersonnelDecisionPayload,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from './hrm-api';

export interface PersonnelDecisionFilters {
  status?: HrmPersonnelDecisionStatus | '';
  type?: HrmPersonnelDecisionType | '';
  employeeId?: string;
}

export async function listPersonnelDecisions(
  filters: PersonnelDecisionFilters = {},
) {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.type) qs.set('type', filters.type);
  if (filters.employeeId) qs.set('employeeId', filters.employeeId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await hrmFetch<{ data: HrmPersonnelDecision[] }>(
    `/personnel-decisions${suffix}`,
  );
  return res.data;
}

export async function getPersonnelDecision(id: string) {
  const res = await hrmFetch<{ data: HrmPersonnelDecision }>(
    `/personnel-decisions/${id}`,
  );
  return res.data;
}

export async function createPersonnelDecision(
  payload: CreateHrmPersonnelDecisionPayload,
) {
  const res = await hrmFetch<{ data: HrmPersonnelDecision }>(
    '/personnel-decisions',
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return res.data;
}

export async function updatePersonnelDecision(
  id: string,
  payload: UpdateHrmPersonnelDecisionPayload,
) {
  const res = await hrmFetch<{ data: HrmPersonnelDecision }>(
    `/personnel-decisions/${id}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  );
  return res.data;
}

export type PersonnelDecisionCommand =
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'retry-apply';

export async function runPersonnelDecisionCommand(
  id: string,
  command: PersonnelDecisionCommand,
  body: { reason?: string } = {},
) {
  const res = await hrmFetch<{ data: HrmPersonnelDecision }>(
    `/personnel-decisions/${id}/${command}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return res.data;
}

export async function getReportingLines(employeeId: string) {
  const res = await hrmFetch<{ data: HrmReportingOverview }>(
    `/employees/${employeeId}/reporting-lines`,
  );
  return res.data;
}

export async function getAppointmentContext(employeeId: string) {
  const res = await hrmFetch<{ data: HrmAppointmentContext }>(
    `/employees/${employeeId}/appointment-context`,
  );
  return res.data;
}

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string;
  reload: () => void;
}

function useAsync<T>(
  load: (() => Promise<T>) | null,
  deps: readonly unknown[],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!load) {
      setData(null);
      setError('');
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    load()
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : 'Không tải được dữ liệu',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}

export function usePersonnelDecisions(filters: PersonnelDecisionFilters) {
  return useAsync(
    () => listPersonnelDecisions(filters),
    [filters.status, filters.type, filters.employeeId],
  );
}

export function useReportingLines(employeeId: string | null | undefined) {
  return useAsync(
    employeeId ? () => getReportingLines(employeeId) : null,
    [employeeId],
  );
}

export function useAppointmentContext(employeeId: string | null | undefined) {
  return useAsync(
    employeeId ? () => getAppointmentContext(employeeId) : null,
    [employeeId],
  );
}
