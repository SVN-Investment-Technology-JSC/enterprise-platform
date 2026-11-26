'use client';

import type { WorkItemProcedureSteps } from '@enterprise-platform/contracts-workspace';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getStandaloneTaskProcedureSteps,
  getWorkItemProcedureSteps,
} from './workspace-api';

export type ProcedureStepsKind = 'work-item' | 'standalone-task';

/** Chu kỳ nạp lại khi hồ sơ còn chạy và tab đang hiện. */
export const PROCEDURE_STEPS_POLL_MS = 20_000;

export interface ProcedureStepsState {
  readonly data: WorkItemProcedureSteps | undefined;
  readonly loading: boolean;
  readonly reload: () => void;
}

/**
 * Nạp các bước hồ sơ quy trình của một công việc. Nạp lại khi `version` đổi (ví dụ `updatedAt` của công việc) và
 * mỗi 20 giây khi hồ sơ còn `running` và tab đang hiện. Bỏ kết quả của lần gọi cũ để đổi việc không hiện nhầm.
 */
export function useProcedureSteps(
  kind: ProcedureStepsKind,
  id: string | undefined,
  version?: string | number,
): ProcedureStepsState {
  const [data, setData] = useState<WorkItemProcedureSteps>();
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const dataRef = useRef<WorkItemProcedureSteps | undefined>(undefined);
  dataRef.current = data;
  const reload = useCallback(() => setTick((n) => n + 1), []);

  // Đổi sang việc khác thì bỏ dữ liệu cũ ngay, đừng để hiện các bước của việc trước.
  useEffect(() => {
    setData(undefined);
  }, [kind, id]);

  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    setLoading(true);
    const fetcher =
      kind === 'standalone-task'
        ? getStandaloneTaskProcedureSteps
        : getWorkItemProcedureSteps;
    fetcher(id)
      .then((next) => {
        if (alive) setData(next);
      })
      .catch(() => {
        // Lỗi mạng: coi như tạm thời không đọc được, nút "Thử lại" gọi `reload`.
        // Lần nạp nền lỗi thì giữ các bước đang hiện, đừng thay bằng thông báo.
        if (alive)
          setData(
            (prev) =>
              prev ?? { linked: true, available: false, steps: [], events: [] },
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [kind, id, version, tick]);

  useEffect(() => {
    if (!id) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (dataRef.current?.status !== 'running') return;
      setTick((n) => n + 1);
    }, PROCEDURE_STEPS_POLL_MS);
    return () => clearInterval(timer);
  }, [id]);

  return { data, loading, reload };
}
