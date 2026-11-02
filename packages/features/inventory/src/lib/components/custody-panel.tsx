'use client';

import type { Asset, Material } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadAuditorCandidates, loadCustody, type AuditorCandidate } from '../inventory-api';
import styles from '../inventory.module.scss';

const ASSET_CATEGORY_LABEL: Readonly<Record<string, string>> = {
  INDUSTRIAL: 'Thiết bị công nghiệp',
  IT_OFFICE: 'Thiết bị CNTT, văn phòng',
  TOOL_PPE: 'Dụng cụ, bảo hộ',
  VEHICLE: 'Phương tiện',
};

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('vi-VN');
}

/**
 * Sổ tài sản đã cấp phát cho nhân viên: mỗi dòng là một tài sản đang có người
 * nhận. Dữ liệu lấy từ `assignedEmployeeId` của chính bản ghi tài sản nên không
 * có bảng thứ hai để lệch với màn hồ sơ nhân sự.
 */
export function CustodyPanel({
  candidates,
  canManage,
  busy,
  onAssign,
}: {
  /** Tài sản có thể cấp phát (cây tài sản); cái đã có người nhận được lọc ra. */
  candidates: readonly Asset[];
  canManage: boolean;
  busy?: boolean;
  /** `employeeId = null` là thu hồi. */
  onAssign: (asset: Pick<Asset, 'code' | 'name'>, employeeId: string | null) => Promise<void> | void;
}) {
  const [assigned, setAssigned] = useState<readonly Material[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [employees, setEmployees] = useState<readonly AuditorCandidate[]>([]);
  const [search, setSearch] = useState('');
  const [assetCode, setAssetCode] = useState('');
  const [employeeId, setEmployeeId] = useState('');

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
      setAssigned(await loadCustody());
      setLoadError(undefined);
    } catch {
      setLoadError('Không tải được danh sách tài sản đã cấp phát.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const free = useMemo(() => {
    const taken = new Set(assigned.map((a) => a.code));
    return candidates.filter((a) => !taken.has(a.code));
  }, [candidates, assigned]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return assigned
      .filter((a) => {
        if (!term) return true;
        const owner = employeeById.get(a.assignedEmployeeId ?? '');
        return [a.code, a.name, owner?.name, owner?.code].some((v) => v?.toLowerCase().includes(term));
      })
      .sort((a, b) => (b.assignedAt ?? '').localeCompare(a.assignedAt ?? ''));
  }, [assigned, employeeById, search]);

  const assetOptions = useMemo(
    () => free.map((a) => ({ value: a.code, label: a.name, badge: a.code })),
    [free],
  );
  const employeeOptions = useMemo(
    () => employees.map((e) => ({ value: e.id, label: e.name, badge: e.code })),
    [employees],
  );

  const target = free.find((a) => a.code === assetCode);
  const ready = Boolean(target) && employeeId !== '';

  const submit = async () => {
    if (!target || !employeeId) return;
    await onAssign(target, employeeId);
    await reload();
    setAssetCode('');
    setEmployeeId('');
  };

  return (
    <section>
      {canManage ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', marginBottom: '16px' }}>
          <div style={{ flex: '1 1 280px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
              Tài sản chưa cấp phát
            </label>
            <SearchableSelect
              options={assetOptions}
              value={assetCode}
              placeholder="— Chọn tài sản —"
              searchPlaceholder="Tìm mã hoặc tên tài sản…"
              emptyText="Không còn tài sản chưa cấp phát"
              onChange={setAssetCode}
              clearable
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ flex: '1 1 280px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
              Nhân viên nhận
            </label>
            <SearchableSelect
              options={employeeOptions}
              value={employeeId}
              placeholder="— Chọn nhân viên —"
              searchPlaceholder="Tìm tên hoặc mã nhân viên…"
              emptyText="Không tìm thấy nhân viên"
              onChange={setEmployeeId}
              clearable
              style={{ width: '100%' }}
            />
          </div>
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={busy || !ready}
            onClick={() => void submit()}
          >
            Cấp phát
          </button>
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
        <span style={{ fontSize: '14px', color: '#475569' }}>
          {assigned.length} tài sản đang cấp phát, {free.length} chưa cấp phát
        </span>
        <div className={styles.tableSearchBox}>
          <input
            value={search}
            placeholder="Tìm tài sản hoặc nhân viên…"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty} role={loadError ? 'alert' : undefined}>
          {loadError ??
            (assigned.length === 0 ? 'Chưa có tài sản nào được cấp phát.' : 'Không có dòng phù hợp.')}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.left}>Mã tài sản</th>
                <th className={styles.left}>Tên tài sản</th>
                <th className={styles.left}>Nhóm</th>
                <th className={styles.left}>Người nhận</th>
                <th className={styles.left}>Ngày cấp</th>
                {canManage ? <th className={styles.right}>Thao tác</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((asset) => {
                const owner = employeeById.get(asset.assignedEmployeeId ?? '');
                return (
                  <tr key={asset.id}>
                    <td>{asset.code}</td>
                    <td>{asset.name}</td>
                    <td>{(asset.assetCategory && ASSET_CATEGORY_LABEL[asset.assetCategory]) || '—'}</td>
                    <td>
                      {owner ? `${owner.name}${owner.code ? ` (${owner.code})` : ''}` : asset.assignedEmployeeId}
                    </td>
                    <td>{formatDate(asset.assignedAt)}</td>
                    {canManage ? (
                      <td className={styles.right}>
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          disabled={busy}
                          onClick={() => void Promise.resolve(onAssign(asset, null)).then(reload)}
                        >
                          Thu hồi
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
