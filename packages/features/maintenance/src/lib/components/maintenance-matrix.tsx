'use client';

import type {
  MaintenanceFrequency,
  MaintenanceMatrix,
  MaintenanceMatrixRow,
  MaintenancePriority,
} from '@enterprise-platform/contracts-maintenance';
import { useEffect, useMemo, useState } from 'react';
import styles from './maintenance-matrix.module.scss';

/**
 * Tần suất mặc định, chỉ dùng khi chưa đọc được danh mục từ cấu hình module.
 *
 * Không còn là danh sách đóng: admin thêm/xoá tần suất trong Cài đặt, và cột
 * của ma trận dựng theo danh mục đó.
 */
const FALLBACK_FREQUENCIES: ReadonlyArray<{ id: MaintenanceFrequency; label: string }> = [
  { id: 'day', label: 'Ngày' },
  { id: 'week', label: 'Tuần' },
  { id: 'month', label: 'Tháng' },
  { id: 'quarter', label: 'Quý' },
  { id: 'year', label: 'Năm' },
];

const PRIORITY_LABEL: Record<MaintenancePriority, string> = {
  High: 'Cao',
  Normal: 'Thường',
  Low: 'Thấp',
};

/** Trạng thái đang sửa của một hàng, tách khỏi dữ liệu server để bấm nhiều ô rồi mới lưu. */
interface Draft {
  frequencies: Set<MaintenanceFrequency>;
  procedureDefinitionId: string;
  priority: MaintenancePriority;
}

function toDraft(
  row: MaintenanceMatrixRow,
  frequencies: ReadonlyArray<{ id: MaintenanceFrequency; label: string }>,
): Draft {
  return {
    frequencies: new Set(
      frequencies.filter((entry) => row.cells[entry.id]).map((entry) => entry.id),
    ),
    procedureDefinitionId: row.procedureDefinitionId ?? '',
    priority: row.priority,
  };
}

function formatDue(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function MaintenanceMatrixBoard({
  matrix,
  canManage,
  busy,
  unitNames,
  frequencies: frequencyCatalog,
  onSave,
  onEditTasks,
  onAddAsset,
  onRemoveAsset,
  onRunNow,
}: {
  matrix: MaintenanceMatrix;
  canManage: boolean;
  busy: boolean;
  /** Danh mục tần suất từ cấu hình module; bỏ trống thì dùng năm tần suất dựng sẵn. */
  frequencies?: ReadonlyArray<{ id: MaintenanceFrequency; label: string }>;
  /** Tên đơn vị phụ trách, tra theo orgUnitId của thiết bị. */
  unitNames?: ReadonlyMap<string, string>;
  onSave: (
    entries: {
      assetCode: string;
      frequencies: MaintenanceFrequency[];
      procedureDefinitionId?: string;
      priority: MaintenancePriority;
    }[],
  ) => void;
  onEditTasks?: (assetCode: string) => void;
  /** Thêm một thiết bị của Kho vào ma trận. */
  onAddAsset?: (assetCode: string) => void;
  /** Gỡ thiết bị khỏi ma trận, xoá mọi lịch của nó. */
  onRemoveAsset?: (assetCode: string) => void;
  /** Tạo phiếu bảo trì ngay cho thiết bị. */
  onRunNow?: (assetCode: string) => void;
}) {
  const frequencies = frequencyCatalog?.length ? frequencyCatalog : FALLBACK_FREQUENCIES;
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());

  // Đọc phòng thủ: một phản hồi thiếu trường không được phép làm hỏng cả trang.
  const rows = useMemo(() => matrix.rows ?? [], [matrix]);
  const catalog = matrix.procedureCatalog ?? [];

  useEffect(() => {
    setDrafts(new Map(rows.map((row) => [row.asset.code, toDraft(row, frequencies)])));
  }, [rows]);

  const dirty = useMemo(() => {
    return rows.some((row) => {
      const draft = drafts.get(row.asset.code);
      if (!draft) return false;
      const original = toDraft(row, frequencies);
      if (draft.procedureDefinitionId !== original.procedureDefinitionId) return true;
      if (draft.priority !== original.priority) return true;
      if (draft.frequencies.size !== original.frequencies.size) return true;
      return [...draft.frequencies].some((frequency) => !original.frequencies.has(frequency));
    });
  }, [drafts, rows]);

  const mutate = (assetCode: string, change: (draft: Draft) => Draft) =>
    setDrafts((current) => {
      const next = new Map(current);
      const draft = next.get(assetCode);
      if (draft) next.set(assetCode, change(draft));
      return next;
    });

  const toggle = (assetCode: string, frequency: MaintenanceFrequency) =>
    mutate(assetCode, (draft) => {
      const frequencies = new Set(draft.frequencies);
      if (frequencies.has(frequency)) frequencies.delete(frequency);
      else frequencies.add(frequency);
      return { ...draft, frequencies };
    });

  const save = () =>
    onSave(
      rows.map((row) => {
        const draft = drafts.get(row.asset.code) ?? toDraft(row, frequencies);
        return {
          assetCode: row.asset.code,
          frequencies: [...draft.frequencies],
          procedureDefinitionId: draft.procedureDefinitionId || undefined,
          priority: draft.priority,
        };
      }),
    );

  return (
    <section className={styles.board}>
      <header className={styles.head}>
        <div>
          <h2>Ma trận bảo trì thiết bị</h2>
          <p>
            Tick các tần suất cần bảo trì. Một thiết bị có thể có nhiều chu kỳ cùng lúc. Bỏ tick sẽ
            tạm dừng lịch chứ không xoá, để các phiếu đã sinh không bị mồ côi.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            className={styles.save}
            onClick={save}
            disabled={busy || !dirty}
            title={dirty ? undefined : 'Chưa có thay đổi nào để lưu.'}
          >
            Lưu cấu hình
          </button>
        ) : null}
      </header>

      {!matrix.assetDirectoryAvailable ? (
        <p className={styles.warning}>
          Chưa đọc được danh mục thiết bị từ Kho — bảng chỉ hiện các thiết bị đã có lịch bảo trì.
        </p>
      ) : null}

      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.assetHead}>Thiết bị</th>
              <th>Đơn vị phụ trách</th>
              <th>Mức ưu tiên</th>
              {frequencies.map((entry) => (
                <th key={entry.id} className={styles.freqHead}>
                  {entry.label}
                </th>
              ))}
              <th className={styles.flowHead}>Luồng thực thi khi tạo lệnh</th>
              <th className={styles.actionHead}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const draft = drafts.get(row.asset.code) ?? toDraft(row, frequencies);
              return (
                <tr key={row.asset.code}>
                  <td>
                    <div className={styles.asset}>
                    <span>
                      <strong>{row.asset.name}</strong>
                      <small>{row.asset.code}</small>
                    </span>
                    </div>
                  </td>
                  <td className={styles.unit}>
                    {row.asset.orgUnitId
                      ? unitNames?.get(row.asset.orgUnitId) ?? '—'
                      : <em>kế thừa cấp trên</em>}
                  </td>
                  <td>
                    <select
                      className={styles.select}
                      value={draft.priority}
                      disabled={!canManage || busy}
                      onChange={(event) =>
                        mutate(row.asset.code, (current) => ({
                          ...current,
                          priority: event.target.value as MaintenancePriority,
                        }))
                      }
                    >
                      {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>

                  {frequencies.map((entry) => {
                    const checked = draft.frequencies.has(entry.id);
                    return (
                      <td
                        key={entry.id}
                        className={`${styles.freqCell} ${checked ? styles.freqOn : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canManage || busy}
                          aria-label={`${row.asset.name} — ${entry.label}`}
                          onChange={() => toggle(row.asset.code, entry.id)}
                        />
                        {checked ? (
                          <span className={styles.due}>
                            {formatDue(row.cells[entry.id]?.nextDueAt) || 'mới'}
                          </span>
                        ) : null}
                      </td>
                    );
                  })}

                  <td>
                    <div className={styles.flow}>
                    <select
                      className={styles.select}
                      value={draft.procedureDefinitionId}
                      disabled={!canManage || busy}
                      onChange={(event) =>
                        mutate(row.asset.code, (current) => ({
                          ...current,
                          procedureDefinitionId: event.target.value,
                        }))
                      }
                    >
                      <option value="">— Chưa gắn —</option>
                      {catalog.map((entry) => (
                        <option key={entry.definitionId} value={entry.definitionId}>
                          {entry.code} — {entry.name}
                        </option>
                      ))}
                    </select>

                    {/* Ba trạng thái khác nhau, không được gộp: chưa đọc được
                        từ Kho, đọc được và rỗng, đọc được và có đầu việc. */}
                    <button
                      type="button"
                      className={
                        row.asset.taskCount === undefined
                          ? styles.taskUnknown
                          : row.asset.taskCount > 0
                            ? styles.taskBadge
                            : styles.taskEmpty
                      }
                      onClick={() => onEditTasks?.(row.asset.code)}
                      disabled={!onEditTasks}
                      title={
                        row.asset.taskCount === undefined
                          ? 'Chưa đọc được danh mục thiết bị từ Kho'
                          : undefined
                      }
                    >
                      {row.asset.taskCount === undefined
                        ? 'Chưa đọc được từ Kho'
                        : row.asset.taskCount > 0
                          ? `${row.asset.taskCount} đầu việc (Kho)`
                          : 'Chưa có đầu việc'}
                    </button>
                    </div>
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.runNow}
                        disabled={!canManage || busy || !onRunNow}
                        title="Tạo phiếu bảo trì ngay, không chờ tới hạn"
                        onClick={() => onRunNow?.(row.asset.code)}
                      >
                        Bảo trì ngay
                      </button>
                      <button
                        type="button"
                        className={styles.removeAsset}
                        disabled={!canManage || busy || !onRemoveAsset}
                        title="Gỡ thiết bị khỏi ma trận và xoá mọi lịch của nó"
                        onClick={() => onRemoveAsset?.(row.asset.code)}
                      >
                        Gỡ khỏi ma trận
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {matrix.availableAssets.length > 0 && canManage && onAddAsset ? (
              <tr>
                <td colSpan={frequencies.length + 5} className={styles.addRow}>
                  <label>
                    Thêm thiết bị vào ma trận
                    <select
                      value=""
                      disabled={busy}
                      onChange={(event) => {
                        if (event.target.value) onAddAsset(event.target.value);
                      }}
                    >
                      <option value="">Chọn thiết bị theo tên…</option>
                      {matrix.availableAssets.map((asset) => (
                        <option key={asset.code} value={asset.code}>
                          {asset.name} · {asset.code}
                        </option>
                      ))}
                    </select>
                  </label>
                </td>
              </tr>
            ) : null}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={frequencies.length + 5} className={styles.empty}>
                  Chưa có thiết bị nào trên ma trận. Dùng ô “Thêm thiết bị” bên dưới để chọn từ Kho.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
