'use client';

import type { CreateAssetRequest, Material } from '@enterprise-platform/contracts-inventory';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadAuditorCandidates, loadCustodyAssets, type AuditorCandidate } from '../inventory-api';
import styles from '../inventory.module.scss';
import { CustodyAssignDialog } from './custody-assign-dialog';
import { ASSET_CATEGORY_LABEL, CustodyDeclareDialog } from './custody-declare-dialog';

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('vi-VN');
}

/**
 * Tạm ẩn nút thu hồi ở Kho: việc thu hồi dự kiến do HRM thực hiện, chưa chốt có giữ lại ở Kho hay không.
 * Bật lại bằng cách đổi thành `true`.
 */
const REVOKE_ENABLED = false;

type CustodyState = 'IN_USE' | 'MAINTENANCE' | 'IN_STOCK' | 'STOPPED' | 'DISPOSED';

/**
 * Tình trạng của tài sản trong sổ: có người giữ là đang sử dụng; không có người giữ thì theo trạng thái của tài sản,
 * hoạt động bình thường là tồn kho.
 */
export function custodyStateOf(asset: Pick<Material, 'assignedEmployeeId' | 'status'>): CustodyState {
  if (asset.assignedEmployeeId) return 'IN_USE';
  if (asset.status === 'MAINTENANCE') return 'MAINTENANCE';
  if (asset.status === 'STOPPED') return 'STOPPED';
  if (asset.status === 'DISPOSED') return 'DISPOSED';
  return 'IN_STOCK';
}

const STATE_LABEL: Readonly<Record<CustodyState, string>> = {
  IN_USE: 'Đang sử dụng',
  MAINTENANCE: 'Bảo trì',
  IN_STOCK: 'Tồn kho',
  STOPPED: 'Ngừng hoạt động',
  DISPOSED: 'Đã thanh lý',
};

const STATE_TONE: Readonly<Record<CustodyState, { color: string; background: string; border: string }>> = {
  IN_USE: { color: '#15803d', background: '#f0fdf4', border: '#bbf7d0' },
  MAINTENANCE: { color: '#b45309', background: '#fffbeb', border: '#fde68a' },
  IN_STOCK: { color: '#1d4ed8', background: '#eff6ff', border: '#bfdbfe' },
  STOPPED: { color: '#475569', background: '#f1f5f9', border: '#cbd5e1' },
  DISPOSED: { color: '#991b1b', background: '#fef2f2', border: '#fecaca' },
};

/** Ba tình trạng có ô lọc riêng; tình trạng còn lại chỉ thấy ở "Tất cả". */
const FILTERS: readonly { id: 'ALL' | 'IN_USE' | 'MAINTENANCE' | 'IN_STOCK'; label: string }[] = [
  { id: 'ALL', label: 'Tất cả' },
  { id: 'IN_USE', label: STATE_LABEL.IN_USE },
  { id: 'MAINTENANCE', label: STATE_LABEL.MAINTENANCE },
  { id: 'IN_STOCK', label: STATE_LABEL.IN_STOCK },
];

function StatePill({ state }: { state: CustodyState }) {
  const tone = STATE_TONE[state];
  return (
    <span
      data-testid={`custody-state-${state}`}
      style={{
        display: 'inline-block',
        padding: '0.15rem 0.6rem',
        borderRadius: '999px',
        fontSize: '0.75rem',
        fontWeight: 700,
        whiteSpace: 'nowrap',
        color: tone.color,
        background: tone.background,
        border: `1px solid ${tone.border}`,
      }}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

/**
 * Sổ tài sản: mọi tài sản kèm tình trạng đang sử dụng, bảo trì hay tồn kho. Dữ liệu lấy từ chính bản ghi tài sản
 * (`assignedEmployeeId`, `status`) nên không có bảng thứ hai để lệch với màn hồ sơ nhân sự. Khai báo tài sản mới và
 * cấp phát đều mở thành form riêng.
 */
export function CustodyPanel({
  canManage,
  busy,
  onAssign,
  onDeclare,
}: {
  canManage: boolean;
  busy?: boolean;
  /** `employeeId = null` là thu hồi. */
  onAssign: (asset: Pick<Material, 'code' | 'name'>, employeeId: string | null) => Promise<boolean | void> | void;
  onDeclare: (input: CreateAssetRequest) => Promise<boolean | void> | void;
}) {
  const [assets, setAssets] = useState<readonly Material[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [employees, setEmployees] = useState<readonly AuditorCandidate[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('ALL');
  const [dialog, setDialog] = useState<{ kind: 'assign'; code?: string } | { kind: 'declare' }>();

  useEffect(() => {
    let cancelled = false;
    loadAuditorCandidates()
      .then((list) => {
        if (!cancelled) setEmployees(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      setAssets(await loadCustodyAssets());
      setLoadError(undefined);
    } catch {
      setLoadError('Không tải được danh sách tài sản.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const inStock = useMemo(() => assets.filter((a) => custodyStateOf(a) === 'IN_STOCK'), [assets]);

  const counts = useMemo(() => {
    const result: Record<string, number> = { ALL: assets.length, IN_USE: 0, MAINTENANCE: 0, IN_STOCK: 0 };
    for (const asset of assets) {
      const state = custodyStateOf(asset);
      if (state in result) result[state] += 1;
    }
    return result;
  }, [assets]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (filter !== 'ALL' && custodyStateOf(a) !== filter) return false;
      if (!term) return true;
      const owner = employeeById.get(a.assignedEmployeeId ?? '');
      return [a.code, a.name, a.serialNumber, owner?.name, owner?.code].some((v) => v?.toLowerCase().includes(term));
    });
  }, [assets, employeeById, filter, search]);

  const closeDialog = () => setDialog(undefined);

  return (
    <section>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }} role="group" aria-label="Lọc theo tình trạng">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={filter === item.id ? styles.btnPrimary : styles.btnSecondary}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label} ({counts[item.id]})
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className={styles.tableSearchBox} style={{ flex: '0 1 260px', minWidth: '160px' }}>
            <input
              value={search}
              placeholder="Tìm tài sản, số sê-ri hoặc nhân viên…"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {canManage ? (
            <>
              <button
                type="button"
                className={styles.btnSecondary}
                style={{ whiteSpace: 'nowrap' }}
                disabled={busy}
                onClick={() => setDialog({ kind: 'declare' })}
              >
                Khai báo tài sản
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                style={{ whiteSpace: 'nowrap' }}
                disabled={busy}
                onClick={() => setDialog({ kind: 'assign' })}
              >
                Cấp phát
              </button>
            </>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty} role={loadError ? 'alert' : undefined}>
          {loadError ?? (assets.length === 0 ? 'Chưa có tài sản nào được khai báo.' : 'Không có dòng phù hợp.')}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.left}>Mã tài sản</th>
                <th className={styles.left}>Tên tài sản</th>
                <th className={styles.left}>Nhóm</th>
                <th className={styles.left}>Trạng thái</th>
                <th className={styles.left}>Người nhận</th>
                <th className={styles.left}>Ngày cấp</th>
                {canManage ? <th className={styles.right}>Thao tác</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((asset) => {
                const state = custodyStateOf(asset);
                const owner = employeeById.get(asset.assignedEmployeeId ?? '');
                return (
                  <tr key={asset.id}>
                    <td>{asset.code}</td>
                    <td>{asset.name}</td>
                    <td>{(asset.assetCategory && ASSET_CATEGORY_LABEL[asset.assetCategory]) || '—'}</td>
                    <td>
                      <StatePill state={state} />
                    </td>
                    <td>
                      {asset.assignedEmployeeId
                        ? owner
                          ? `${owner.name}${owner.code ? ` (${owner.code})` : ''}`
                          : asset.assignedEmployeeId
                        : '—'}
                    </td>
                    <td>{formatDate(asset.assignedAt)}</td>
                    {canManage ? (
                      <td className={styles.right}>
                        {state === 'IN_STOCK' ? (
                          <button
                            type="button"
                            className={styles.btnSecondary}
                            style={{ whiteSpace: 'nowrap' }}
                            disabled={busy}
                            onClick={() => setDialog({ kind: 'assign', code: asset.code })}
                          >
                            Cấp phát
                          </button>
                        ) : null}
                        {state === 'IN_USE' && REVOKE_ENABLED ? (
                          <button
                            type="button"
                            className={styles.btnSecondary}
                            disabled={busy}
                            onClick={() => void Promise.resolve(onAssign(asset, null)).then(reload)}
                          >
                            Thu hồi
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === 'assign' ? (
        <CustodyAssignDialog
          assets={inStock}
          employees={employees}
          initialCode={dialog.code}
          busy={busy}
          onCancel={closeDialog}
          onSubmit={(asset, employeeId) => {
            void Promise.resolve(onAssign(asset, employeeId)).then(async (ok) => {
              await reload();
              if (ok !== false) closeDialog();
            });
          }}
        />
      ) : null}
      {dialog?.kind === 'declare' ? (
        <CustodyDeclareDialog
          busy={busy}
          onCancel={closeDialog}
          onSubmit={(input) => {
            void Promise.resolve(onDeclare(input)).then(async (ok) => {
              await reload();
              if (ok !== false) closeDialog();
            });
          }}
        />
      ) : null}
    </section>
  );
}
