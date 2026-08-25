'use client';

import type {
  MaintenanceFrequency,
  MaintenanceMatrix,
  MaintenanceMatrixRow,
  MaintenancePriority,
} from '@enterprise-platform/contracts-maintenance';
import { useEffect, useMemo, useState } from 'react';
import styles from './maintenance-matrix.module.scss';

const FREQUENCIES: ReadonlyArray<{ id: MaintenanceFrequency; label: string; short: string }> = [
  { id: 'day', label: 'Ngày', short: 'Day' },
  { id: 'week', label: 'Tuần', short: 'Week' },
  { id: 'month', label: 'Tháng', short: 'Month' },
  { id: 'quarter', label: 'Quý', short: 'Qtr' },
  { id: 'year', label: 'Năm', short: 'Year' },
];

const PRIORITY_LABEL: Record<MaintenancePriority, string> = {
  High: 'Cao',
  Normal: 'Thường',
  Low: 'Thấp',
};

interface Draft {
  frequencies: Set<MaintenanceFrequency>;
  procedureDefinitionId: string;
  priority: MaintenancePriority;
}

function toDraft(row: MaintenanceMatrixRow): Draft {
  return {
    frequencies: new Set(
      FREQUENCIES.filter((entry) => row.cells[entry.id]).map((entry) => entry.id),
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
  onSave,
  onEditTasks,
  onCreateWorkOrder,
}: {
  matrix: MaintenanceMatrix;
  canManage: boolean;
  busy: boolean;
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
  onCreateWorkOrder?: (input: {
    assetCode: string;
    title: string;
    workforce: string;
    tools: string[];
    material: string;
    scheduledDate: string;
  }) => void;
}) {
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAssetCode, setSelectedAssetCode] = useState<string>('');

  // Work Order Trigger form states
  const [woTitle, setWoTitle] = useState('');
  const [woWorkforce, setWoWorkforce] = useState('2 nhân công');
  const [woTools, setWoTools] = useState<string[]>(['Cờ lê lực (150Nm)', 'Thước cặp điện tử']);
  const [newToolInput, setNewToolInput] = useState('');
  const [woMaterial, setWoMaterial] = useState('Main Bearing (10") [Tồn: 1 (KD)]');
  const [woDate, setWoDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [woNotice, setWoNotice] = useState<string>();

  const rows = useMemo(() => matrix.rows ?? [], [matrix]);

  useEffect(() => {
    setDrafts(new Map(rows.map((row) => [row.asset.code, toDraft(row)])));
    if (!selectedAssetCode && rows.length > 0) {
      setSelectedAssetCode(rows[0].asset.code);
      setWoTitle(`Bảo dưỡng định kỳ — ${rows[0].asset.name} (${rows[0].asset.code})`);
    }
  }, [rows, selectedAssetCode]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.asset.code.toLowerCase().includes(q) ||
        r.asset.name.toLowerCase().includes(q) ||
        (r.asset.orgUnitId && (unitNames?.get(r.asset.orgUnitId) ?? '').toLowerCase().includes(q)),
    );
  }, [rows, searchQuery, unitNames]);

  const dirty = useMemo(() => {
    return rows.some((row) => {
      const draft = drafts.get(row.asset.code);
      if (!draft) return false;
      const original = toDraft(row);
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
        const draft = drafts.get(row.asset.code) ?? toDraft(row);
        return {
          assetCode: row.asset.code,
          frequencies: [...draft.frequencies],
          procedureDefinitionId: draft.procedureDefinitionId || undefined,
          priority: draft.priority,
        };
      }),
    );

  const selectAssetForWO = (assetCode: string, assetName: string) => {
    setSelectedAssetCode(assetCode);
    setWoTitle(`Thay thế & Bảo dưỡng — ${assetName} (${assetCode})`);
    setWoNotice(undefined);
  };

  const addToolTag = () => {
    const val = newToolInput.trim();
    if (val && !woTools.includes(val)) {
      setWoTools([...woTools, val]);
      setNewToolInput('');
    }
  };

  const removeToolTag = (tag: string) => {
    setWoTools(woTools.filter((t) => t !== tag));
  };

  const submitWOTrigger = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssetCode) return;
    if (onCreateWorkOrder) {
      onCreateWorkOrder({
        assetCode: selectedAssetCode,
        title: woTitle,
        workforce: woWorkforce,
        tools: woTools,
        material: woMaterial,
        scheduledDate: woDate,
      });
    }
    setWoNotice(`✓ Đã kích hoạt Lệnh làm việc cho ${selectedAssetCode} vào ngày ${woDate}!`);
  };

  return (
    <section className={styles.board}>
      {/* Top Heading */}
      <header className={styles.head}>
        <div>
          <h2>Lịch bảo trì &amp; Điều phối vật tư</h2>
          <p>
            Quản lý ma trận lịch trình bảo trì phòng ngừa (PM Matrix) và tồn kho đệm phụ tùng liên nhà máy.
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
            <span>💾</span> Lưu cấu hình ma trận
          </button>
        ) : null}
      </header>

      {!matrix.assetDirectoryAvailable ? (
        <p className={styles.warning}>
          Chưa đọc được danh mục thiết bị từ Kho — bảng chỉ hiện các thiết bị đã có lịch bảo trì.
        </p>
      ) : null}

      {/* 16:9 Master-Detail Split Grid (8 cột Trái / 4 cột Phải) */}
      <div className={styles.matrixGrid}>
        {/* ================================================================= */}
        {/* CỘT TRÁI (8 CỘT): MA TRẬN & TỒN KHO LIÊN NHÀ MÁY                 */}
        {/* ================================================================= */}
        <div className={styles.leftMatrixCol}>
          {/* Card 1: Preventive Maintenance Schedule Matrix */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h3>Ma trận Lịch bảo trì phòng ngừa</h3>
                <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  {filteredRows.length} thiết bị trong hệ thống
                </span>
              </div>
              <input
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--line)',
                  fontSize: '13px',
                  width: '240px',
                  outline: 'none',
                }}
                placeholder="Tìm mã, tên thiết bị, vị trí…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.assetHead}>Mã &amp; Tên thiết bị</th>
                    <th>Vị trí / Đơn vị</th>
                    {FREQUENCIES.map((entry) => (
                      <th key={entry.id} className={styles.freqHead}>
                        {entry.short}
                      </th>
                    ))}
                    <th className={styles.actionHead}>Trạng thái / H.Động</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, index) => {
                    const draft = drafts.get(row.asset.code) ?? toDraft(row);
                    const isSelected = row.asset.code === selectedAssetCode;

                    // Mock varied statuses for visual rich experience matching design
                    const isOverdue = index === 2;
                    const isUpcoming = index === 0 || index === 1;

                    return (
                      <tr
                        key={row.asset.code}
                        className={isSelected ? styles.rowActive : undefined}
                      >
                        <td>
                          <div
                            className={styles.asset}
                            style={{ cursor: 'pointer' }}
                            onClick={() => selectAssetForWO(row.asset.code, row.asset.name)}
                          >
                            <strong>{row.asset.name}</strong>
                            <small>{row.asset.code} · Cấp {PRIORITY_LABEL[draft.priority]}</small>
                          </div>
                        </td>
                        <td className={styles.unit}>
                          <span>{unitNames?.get(row.asset.orgUnitId ?? '') ?? 'Plant KD - Line 1'}</span>
                          <small>Factory Plant 1</small>
                        </td>

                        {/* Frequency Cells with Status Badges */}
                        {FREQUENCIES.map((entry, freqIndex) => {
                          const checked = draft.frequencies.has(entry.id);
                          const dueStr = formatDue(row.cells[entry.id]?.nextDueAt);

                          // Badge styles according to design: Done, Priority, Warn, Overdue
                          let badgeEl = null;
                          if (checked) {
                            if (isOverdue && entry.id === 'month') {
                              badgeEl = <span className={styles.badgeOverdue}>!</span>;
                            } else if (freqIndex === 3) {
                              badgeEl = <span className={styles.badgePriority}>P</span>;
                            } else if (freqIndex === 2 && isUpcoming) {
                              badgeEl = <span className={styles.badgeWarn}>!</span>;
                            } else {
                              badgeEl = <span className={styles.badgeDone}>1</span>;
                            }
                          } else {
                            badgeEl = <span className={styles.badgeEmpty}>+</span>;
                          }

                          return (
                            <td key={entry.id} className={styles.freqCell}>
                              <div
                                className={styles.badgeWrap}
                                onClick={() => canManage && toggle(row.asset.code, entry.id)}
                                title={
                                  checked
                                    ? `Đang bật chu kỳ ${entry.label} (Hạn: ${dueStr || 'Mới'}). Click để tắt.`
                                    : `Chưa kích hoạt ${entry.label}. Click để bật.`
                                }
                              >
                                {badgeEl}
                                {checked && dueStr ? (
                                  <span className={styles.dueText}>{dueStr}</span>
                                ) : null}
                              </div>
                            </td>
                          );
                        })}

                        {/* Action Column */}
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                color: isOverdue ? '#dc2626' : '#d97706',
                              }}
                            >
                              {isOverdue ? 'Quá hạn' : 'Sắp tới'}
                            </span>
                            <button
                              type="button"
                              className={styles.save}
                              style={{
                                padding: '4px 10px',
                                fontSize: '12px',
                                background: isSelected ? 'var(--blue-dark)' : '#f1f5f9',
                                color: isSelected ? '#ffffff' : 'var(--ink)',
                                border: '1px solid var(--line)',
                                boxShadow: 'none',
                              }}
                              onClick={() => selectAssetForWO(row.asset.code, row.asset.name)}
                            >
                              {isOverdue ? 'Xem WO' : 'Đánh giá'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={FREQUENCIES.length + 3} style={{ textAlign: 'center', padding: '30px', color: 'var(--muted)' }}>
                        Không có thiết bị nào phù hợp với bộ lọc tìm kiếm.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {/* Legend Bar */}
            <div className={styles.legendBar}>
              <span style={{ fontWeight: 700 }}>Chú giải mã màu:</span>
              <div className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: '#10b981' }} />
                <span>Xong / Đúng hạn (1)</span>
              </div>
              <div className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: '#f97316' }} />
                <span>Ưu tiên (P)</span>
              </div>
              <div className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: '#eab308' }} />
                <span>Cảnh báo / Sắp đến hạn (!)</span>
              </div>
              <div className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: '#ef4444' }} />
                <span>Sự cố / Quá hạn (!)</span>
              </div>
            </div>
          </div>

          {/* Card 2: Inter-Plant Stock Buffer & Transfer */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h3>Tồn kho đệm &amp; Điều chuyển liên nhà máy</h3>
                <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--muted)' }}>
                  Theo dõi số lượng tồn kho phụ tùng trọng yếu (Main Bearing 10", Seal Kit...) giữa các phân xưởng.
                </p>
              </div>
              <button
                type="button"
                className={styles.save}
                style={{ fontSize: '12.5px', padding: '6px 14px' }}
                onClick={() => window.alert('Đang mở màn hình tạo yêu cầu điều chuyển phụ tùng liên nhà máy…')}
              >
                <span>⇄</span> Khởi tạo yêu cầu điều chuyển
              </button>
            </div>

            <div style={{ margin: '12px 0 6px', fontWeight: 700, fontSize: '13.5px' }}>
              Main Bearing (10") — Mức tồn kho đệm giữa các nhà máy:
            </div>

            <div className={styles.plantBufferGrid}>
              <div className={`${styles.bufferItem} ${styles.bufferItemDanger}`}>
                <div className={styles.bufferPlantName}>Phân xưởng KD (Plant KD)</div>
                <div className={styles.bufferQty}>
                  1 <small style={{ fontSize: '12px', fontWeight: 'normal', color: 'var(--muted)' }}>đơn vị</small>
                </div>
                <div className={styles.bufferSub} style={{ color: '#dc2626' }}>
                  ⚠️ Min: 2 — Dưới mức an toàn!
                </div>
              </div>

              <div className={`${styles.bufferItem} ${styles.bufferItemSafe}`}>
                <div className={styles.bufferPlantName}>Phân xưởng HN (Plant HN)</div>
                <div className={styles.bufferQty}>
                  5 <small style={{ fontSize: '12px', fontWeight: 'normal', color: 'var(--muted)' }}>đơn vị</small>
                </div>
                <div className={styles.bufferSub} style={{ color: '#15803d' }}>
                  ✓ Min: 3 — Đủ tồn kho
                </div>
              </div>

              <div className={`${styles.bufferItem} ${styles.bufferItemInfo}`}>
                <div className={styles.bufferPlantName}>Phân xưởng SB (Plant SB)</div>
                <div className={styles.bufferQty}>
                  3 <small style={{ fontSize: '12px', fontWeight: 'normal', color: 'var(--muted)' }}>đơn vị</small>
                </div>
                <div className={styles.bufferSub} style={{ color: '#1d4ed8' }}>
                  ✓ Min: 1 — Sẵn sàng điều chuyển
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ================================================================= */}
        {/* CỘT PHẢI (4 CỘT): CONSOLE KÍCH HOẠT WORK ORDER                   */}
        {/* ================================================================= */}
        <div className={styles.rightConsoleCol}>
          <div className={styles.triggerConsole}>
            <div className={styles.triggerHead}>
              <h3>
                <span>⚡</span>
                Kích hoạt Lệnh làm việc (Work Order)
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 600 }}>
                {selectedAssetCode || 'Chưa chọn'}
              </span>
            </div>

            <form onSubmit={submitWOTrigger} className={styles.triggerBody}>
              {woNotice ? (
                <div style={{ padding: '10px 12px', background: '#dcfce7', color: '#15803d', borderRadius: '6px', fontSize: '12.5px', fontWeight: 600 }}>
                  {woNotice}
                </div>
              ) : null}

              <div className={styles.fieldGroup}>
                <label>Tiêu đề Lệnh làm việc (WO Title) *</label>
                <input
                  required
                  value={woTitle}
                  onChange={(e) => setWoTitle(e.target.value)}
                  placeholder="VD: Thay thế Main Bearing - EQ-301"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label>Số lượng nhân công thực hiện</label>
                <select
                  value={woWorkforce}
                  onChange={(e) => setWoWorkforce(e.target.value)}
                >
                  <option value="1 nhân công">1 Kỹ thuật viên</option>
                  <option value="2 nhân công">2 Kỹ thuật viên (Tiêu chuẩn)</option>
                  <option value="3 nhân công">3 Kỹ thuật viên</option>
                  <option value="4 nhân công">Đội bảo dưỡng 4 người</option>
                </select>
              </div>

              <div className={styles.fieldGroup}>
                <label>Công cụ &amp; Đồ nghề cần thiết</label>
                <div className={styles.toolTags}>
                  {woTools.map((tag) => (
                    <span key={tag} className={styles.toolTag}>
                      {tag}
                      <button type="button" onClick={() => removeToolTag(tag)}>✕</button>
                    </span>
                  ))}
                  <input
                    style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '12px', minWidth: '100px', padding: '2px' }}
                    placeholder="+ Thêm công cụ…"
                    value={newToolInput}
                    onChange={(e) => setNewToolInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addToolTag();
                      }
                    }}
                  />
                </div>
              </div>

              <div className={styles.fieldGroup}>
                <label>Vật tư &amp; Phụ tùng thay thế</label>
                <select
                  value={woMaterial}
                  onChange={(e) => setWoMaterial(e.target.value)}
                >
                  <option value={'Main Bearing (10") [Tồn: 1 (KD)]'}>Main Bearing (10") [Tồn: 1 (KD)]</option>
                  <option value="Seal Kit-A [Tồn: 12 (KD)]">Seal Kit-A [Tồn: 12 (KD)]</option>
                  <option value="Dầu bôi trơn ISO VG 46 [Tồn: 150L]">Dầu bôi trơn ISO VG 46 [Tồn: 150L]</option>
                  <option value="Bộ phớt làm kín Sealing Ring [Tồn: 8]">Bộ phớt làm kín Sealing Ring [Tồn: 8]</option>
                </select>
              </div>

              <div className={styles.fieldGroup}>
                <label>Ngày dự kiến thực hiện *</label>
                <input
                  required
                  type="date"
                  value={woDate}
                  onChange={(e) => setWoDate(e.target.value)}
                />
              </div>

              <div style={{ marginTop: '6px' }}>
                <button
                  type="submit"
                  className={styles.btnTrigger}
                  disabled={busy || !selectedAssetCode}
                >
                  {busy ? 'Đang tạo…' : '🚀 Tạo Lệnh làm việc'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
