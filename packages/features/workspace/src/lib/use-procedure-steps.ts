'use client';

import type { WorkItemProcedureSteps } from '@enterprise-platform/contracts-workspace';
import {
  retainProcedureRoom,
  subscribeRealtime,
  type ProcedureInstanceSignal,
} from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getStandaloneTaskProcedureSteps,
  getWorkItemProcedureSteps,
} from './workspace-api';

export type ProcedureStepsKind = 'work-item' | 'standalone-task';

/** Chu kỳ nạp lại khi hồ sơ còn chạy và tab đang hiện. */
export const PROCEDURE_STEPS_POLL_MS = 20_000;
/** Gom tín hiệu dồn dập thành một lần nạp. */
const PROCEDURE_STEPS_SIGNAL_DEBOUNCE_MS = 400;
/** Khoảng tối thiểu giữa hai lần nạp do quay lại tab. */
const PROCEDURE_STEPS_WAKE_GAP_MS = 2_000;

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
    // Quay lại tab hay cửa sổ: nạp lại ngay thay vì chờ nhịp. `focus` và `visibilitychange` hay đến cùng lúc.
    let lastWake = 0;
    const onWake = () => {
      if (document.visibilityState === 'hidden' || dataRef.current?.status !== 'running') return;
      const now = Date.now();
      if (now - lastWake < PROCEDURE_STEPS_WAKE_GAP_MS) return;
      lastWake = now;
      setTick((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [id]);

  // Người khác duyệt / trả về hồ sơ: tín hiệu (chỉ id) trong phòng của hồ sơ. Phòng chỉ vào được khi người xem là
  // người tham gia hồ sơ (realtime hỏi module Quy trình); không vào được thì vẫn còn nhịp nạp lại ở trên.
  const instanceId = data?.instanceId;
  useEffect(() => {
    if (!instanceId) return undefined;
    const release = retainProcedureRoom(instanceId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeRealtime((event) => {
      if (event.event !== 'procedure.instance.changed') return;
      if ((event.data as Partial<ProcedureInstanceSignal> | undefined)?.instanceId !== instanceId) return;
      clearTimeout(timer);
      timer = setTimeout(() => setTick((n) => n + 1), PROCEDURE_STEPS_SIGNAL_DEBOUNCE_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
      release();
    };
  }, [instanceId]);

  return { data, loading, reload };
}
