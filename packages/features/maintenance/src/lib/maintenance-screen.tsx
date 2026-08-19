'use client';

import type {
  MaintenanceFrequency,
  MaintenanceMatrix,
  MaintenancePriority,
  MaintenanceWorkspace,
} from '@enterprise-platform/contracts-maintenance';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  createMaintenanceSchedule,
  loadMaintenanceMatrix,
  loadMaintenanceWorkspace,
  loadOrganizationUnitNames,
  loadTenantHomePath,
  runMaintenanceScheduler,
  saveMaintenanceMatrix,
  updateMaintenanceSchedule,
} from './maintenance-api';
import { MaintenanceMatrixBoard } from './components/maintenance-matrix';
import styles from './maintenance.module.scss';

type View = 'matrix' | 'schedules' | 'occurrences';

const VIEWS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'matrix', label: 'Ma trận bảo trì' },
  { id: 'schedules', label: 'Lịch bảo trì' },
  { id: 'occurrences', label: 'Phiếu phát sinh' },
];

const FREQUENCY_LABEL: Record<MaintenanceFrequency, string> = {
  day: 'Ngày',
  week: 'Tuần',
  month: 'Tháng',
  quarter: 'Quý',
  year: 'Năm',
};

const PRIORITY_LABEL: Record<MaintenancePriority, string> = {
  High: 'Cao',
  Normal: 'Thường',
  Low: 'Thấp',
};

function initialView(): View {
  if (typeof window === 'undefined') return 'matrix';
  const hash = window.location.hash.slice(1) as View;
  return VIEWS.some((view) => view.id === hash) ? hash : 'matrix';
}

function formatDateTime(value?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'numeric',
    year: '2-digit',
  }).format(new Date(value));
}

export function MaintenanceScreen() {
  const [view, setView] = useState<View>('matrix');
  const [matrix, setMatrix] = useState<MaintenanceMatrix>();
  const [unitNames, setUnitNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [workspace, setWorkspace] = useState<MaintenanceWorkspace>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [homePath, setHomePath] = useState('/');

  const reload = useCallback(async () => {
    try {
      setError(undefined);
      const [nextWorkspace, nextMatrix] = await Promise.all([
        loadMaintenanceWorkspace(),
        loadMaintenanceMatrix(),
      ]);
      setWorkspace(nextWorkspace);
      setMatrix(nextMatrix);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải Maintenance.');
    }
  }, []);

  useEffect(() => {
    setView(initialView());
    void reload();
    void loadTenantHomePath().then(setHomePath);
    void loadOrganizationUnitNames().then(setUnitNames);
  }, [reload]);

  useEffect(() => {
    if (typeof window !== 'undefined') window.location.hash = view;
  }, [view]);

  const submitSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await createMaintenanceSchedule({
        assetCode: String(form.get('assetCode') ?? '').trim(),
        procedureDefinitionId: String(form.get('procedureDefinitionId') ?? '') || undefined,
        frequency: form.get('frequency') as MaintenanceFrequency,
        priority: form.get('priority') as MaintenancePriority,
        startDate: String(form.get('startDate') ?? ''),
        activate: form.get('activate') === 'on',
      });
      setCreating(false);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tạo được lịch bảo trì.');
    } finally {
      setBusy(false);
    }
  };

  const toggleSchedule = async (id: string, status: 'active' | 'paused') => {
    setBusy(true);
    try {
      await updateMaintenanceSchedule(id, { status });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không cập nhật được lịch.');
    } finally {
      setBusy(false);
    }
  };

  const triggerScheduler = async () => {
    setBusy(true);
    try {
      const result = await runMaintenanceScheduler();
      await reload();
      setError(result.generated === 0 ? 'Chưa có lịch nào đến hạn.' : undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không chạy được scheduler.');
    } finally {
      setBusy(false);
    }
  };

  const saveMatrix = async (
    entries: Parameters<typeof saveMaintenanceMatrix>[0]['entries'],
  ) => {
    setBusy(true);
    try {
      const result = await saveMaintenanceMatrix({ entries });
      await reload();
      setError(
        result.created + result.reactivated + result.paused + result.updated === 0
          ? 'Không có thay đổi nào cần lưu.'
          : undefined,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được ma trận bảo trì.');
    } finally {
      setBusy(false);
    }
  };

  const canManage = workspace?.permissions.canManageSchedules ?? false;

  return (
    <div className={styles.page}>
      <header className={styles.banner}>
        <div>
          <span className={styles.eyebrow}>Operations · Maintenance</span>
          <h1>Bảo trì phòng ngừa</h1>
          <p>
            Lập lịch theo thiết bị và sinh phiếu công việc sang Quy trình. Thiết bị được quản lý
            trong module Kho &amp; Vật tư.
          </p>
        </div>
        <div className={styles.bannerActions}>
          {/* Ai đang đăng nhập: các phân hệ khác đều hiện, thiếu ở đây thì người
              dùng không biết mình đang thao tác dưới danh nghĩa nào. */}
          {workspace ? (
            <span className={styles.actor}>
              <strong>{workspace.actor.name}</strong>
            </span>
          ) : null}
          {canManage ? (
            <button
              type="button"
              className={`${styles.action} ${styles.actionPrimary}`}
              onClick={() => setCreating((open) => !open)}
              disabled={busy}
            >
              + Lịch bảo trì
            </button>
          ) : null}
          {canManage ? (
            <button
              type="button"
              className={`${styles.action} ${styles.actionGhost}`}
              onClick={triggerScheduler}
              disabled={busy}
            >
              Chạy scheduler
            </button>
          ) : null}
          <a className={`${styles.action} ${styles.actionGhost}`} href={homePath}>
            ← Trang chủ
          </a>
        </div>
      </header>

      <nav className={styles.tabs}>
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${styles.tab} ${view === item.id ? styles.tabActive : ''}`}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      {!workspace ? (
        <p className={styles.empty}>Đang tải dữ liệu bảo trì…</p>
      ) : (
        <>
          <div className={styles.kpiRow}>
            <article className={styles.kpi}>
              <span>Lịch đang chạy</span>
              <strong>{workspace.metrics.activeSchedules}</strong>
            </article>
            <article className={styles.kpi}>
              <span>Sắp đến hạn</span>
              <strong>{workspace.metrics.upcomingOccurrences}</strong>
            </article>
            <article className={styles.kpi}>
              <span>Đã sinh phiếu</span>
              <strong>{workspace.metrics.generatedOccurrences}</strong>
            </article>
            <article className={styles.kpi}>
              <span>Đã hoàn thành</span>
              <strong>{workspace.metrics.completedOccurrences}</strong>
            </article>
          </div>

          {creating ? (
            <form className={styles.card} onSubmit={submitSchedule}>
              <h2>Lịch bảo trì mới</h2>
              <div className={styles.formGrid}>
                <label>
                  Mã thiết bị (từ Kho)
                  <input name="assetCode" required placeholder="VD: EQ-001" />
                </label>
                <label>
                  Quy trình áp dụng
                  <select name="procedureDefinitionId" defaultValue="">
                    <option value="">— Không gắn quy trình —</option>
                    {workspace.procedureCatalog.map((entry) => (
                      <option key={entry.definitionId} value={entry.definitionId}>
                        {entry.code} · {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tần suất
                  <select name="frequency" defaultValue="month">
                    {Object.entries(FREQUENCY_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Mức ưu tiên
                  <select name="priority" defaultValue="Normal">
                    {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Ngày bắt đầu
                  <input name="startDate" type="date" required />
                </label>
                <label className={styles.checkbox}>
                  <input name="activate" type="checkbox" defaultChecked />
                  Kích hoạt ngay
                </label>
              </div>
              <div className={styles.formActions}>
                <button type="submit" className={`${styles.action} ${styles.actionPrimary}`} disabled={busy}>
                  Lưu lịch
                </button>
                <button
                  type="button"
                  className={`${styles.action} ${styles.actionGhost}`}
                  onClick={() => setCreating(false)}
                >
                  Huỷ
                </button>
              </div>
            </form>
          ) : null}

          {view === 'matrix' && matrix ? (
            <MaintenanceMatrixBoard
              matrix={matrix}
              canManage={canManage}
              busy={busy}
              unitNames={unitNames}
              onSave={saveMatrix}
              onEditTasks={(assetCode) => {
                // Đầu việc thuộc hồ sơ thiết bị bên Kho — nguồn duy nhất, không
                // nhân bản sang Bảo trì.
                window.location.assign(`/modules/inventory#assets:${assetCode}`);
              }}
            />
          ) : null}

          {view === 'schedules' ? (
            <section className={styles.card}>
              <h2>Lịch bảo trì</h2>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Mã lịch</th>
                      <th>Thiết bị</th>
                      <th>Quy trình</th>
                      <th>Tần suất</th>
                      <th>Ưu tiên</th>
                      <th>Trạng thái</th>
                      <th>Đến hạn kế tiếp</th>
                      {canManage ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.schedules.map((schedule) => (
                      <tr key={schedule.id}>
                        <td className={styles.code}>{schedule.code}</td>
                        <td className={styles.code}>{schedule.assetCode}</td>
                        <td>
                          {schedule.procedureDefinitionCode ?? '—'}
                          {schedule.procedureDefinitionName ? (
                            <span className={styles.sub}>{schedule.procedureDefinitionName}</span>
                          ) : null}
                        </td>
                        <td>{FREQUENCY_LABEL[schedule.frequency]}</td>
                        <td>
                          <span className={styles.pill}>{PRIORITY_LABEL[schedule.priority]}</span>
                        </td>
                        <td>{schedule.status}</td>
                        <td>{formatDateTime(schedule.nextDueAt)}</td>
                        {canManage ? (
                          <td>
                            <button
                              type="button"
                              className={styles.linkButton}
                              disabled={busy}
                              onClick={() =>
                                toggleSchedule(
                                  schedule.id,
                                  schedule.status === 'active' ? 'paused' : 'active',
                                )
                              }
                            >
                              {schedule.status === 'active' ? 'Tạm dừng' : 'Kích hoạt'}
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {workspace.schedules.length === 0 ? (
                  <p className={styles.empty}>Chưa có lịch bảo trì nào.</p>
                ) : null}
              </div>
            </section>
          ) : null}

          {view === 'occurrences' ? (
            <section className={styles.card}>
              <h2>Phiếu công việc phát sinh</h2>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Lịch</th>
                      <th>Thiết bị</th>
                      <th>Đến hạn</th>
                      <th>Ưu tiên</th>
                      <th>Trạng thái</th>
                      <th>Hồ sơ quy trình</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.occurrences.map((occurrence) => (
                      <tr key={occurrence.id}>
                        <td>{occurrence.scheduleTitle}</td>
                        <td className={styles.code}>{occurrence.assetCode}</td>
                        <td>{formatDateTime(occurrence.dueAt)}</td>
                        <td>
                          <span className={styles.pill}>{PRIORITY_LABEL[occurrence.priority]}</span>
                        </td>
                        <td className={occurrence.status === 'failed' ? styles.negative : undefined}>
                          {occurrence.status}
                          {occurrence.failureReason ? (
                            <span className={styles.sub}>{occurrence.failureReason}</span>
                          ) : null}
                        </td>
                        <td className={styles.code}>{occurrence.procedureInstanceCode ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {workspace.occurrences.length === 0 ? (
                  <p className={styles.empty}>Chưa có phiếu phát sinh.</p>
                ) : null}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
