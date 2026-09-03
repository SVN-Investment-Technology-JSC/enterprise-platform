'use client';

import type {
  MaintenanceFrequency,
  MaintenanceHistoryPage,
  MaintenanceMatrix,
  MaintenanceMatrixAsset,
  MaintenanceMatrixRow,
  MaintenancePriority,
} from '@enterprise-platform/contracts-maintenance';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import {
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  History,
  Plus,
  Search,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { loadAssetTasks, loadMaintenanceHistory, type AssetTaskList } from '../maintenance-api';
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
  /**
   * Ngày bảo trì kế tiếp cho từng tần suất VỪA BẬT, dạng `YYYY-MM-DD`.
   *
   * Chỉ giữ cho ô mới bật. Ô đã có lịch chạy thì hạn thuộc về lịch đó, sửa ở
   * đây sẽ đẩy lịch đang chạy về ngày khác — không phải thứ người dùng chờ đợi
   * khi họ chỉ đang tick vài ô trên ma trận.
   */
  startDates: Map<MaintenanceFrequency, string>;
  procedureDefinitionId: string;
  priority: MaintenancePriority;
}

/** Mặc định gợi ý: một tuần nữa, không phải hôm nay. */
function defaultStartDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

function toDraft(
  row: MaintenanceMatrixRow,
  frequencies: ReadonlyArray<{ id: MaintenanceFrequency; label: string }>,
): Draft {
  return {
    frequencies: new Set(
      frequencies.filter((entry) => row.cells[entry.id]).map((entry) => entry.id),
    ),
    startDates: new Map(),
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
  onOpenHistory,
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
  /** Mở lịch sử bảo trì của riêng thiết bị này. */
  onOpenHistory?: (assetCode: string) => void;
}) {
  const frequencies = frequencyCatalog?.length ? frequencyCatalog : FALLBACK_FREQUENCIES;
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const [filterText, setFilterText] = useState('');
  const [filterUnit, setFilterUnit] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [pageSize, setPageSize] = useState<number>(15);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [addSearch, setAddSearch] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);

  // State cho Drawer chi tiết thiết bị khi click
  const [activeDrawer, setActiveDrawer] = useState<{
    asset: MaintenanceMatrixAsset;
    tab: 'tasks' | 'history';
  }>();
  const [drawerTasks, setDrawerTasks] = useState<{ loading: boolean; list?: AssetTaskList; error?: string }>({
    loading: false,
  });
  const [drawerHistory, setDrawerHistory] = useState<{
    loading: boolean;
    page?: MaintenanceHistoryPage;
    error?: string;
  }>({ loading: false });

  // Khi mở Drawer hoặc chuyển tab, tự động nạp dữ liệu tương ứng
  useEffect(() => {
    if (!activeDrawer) {
      setDrawerTasks({ loading: false });
      setDrawerHistory({ loading: false });
      return;
    }

    const assetCode = activeDrawer.asset.code;
    let cancelled = false;

    if (activeDrawer.tab === 'tasks') {
      setDrawerTasks({ loading: true });
      loadAssetTasks(assetCode)
        .then((list) => {
          if (!cancelled) setDrawerTasks({ loading: false, list });
        })
        .catch((err: unknown) => {
          if (!cancelled)
            setDrawerTasks({
              loading: false,
              error: err instanceof Error ? err.message : 'Không đọc được đầu việc từ Kho.',
            });
        });
    } else if (activeDrawer.tab === 'history') {
      setDrawerHistory({ loading: true });
      loadMaintenanceHistory({ assetCode, limit: 30 })
        .then((page) => {
          if (!cancelled) setDrawerHistory({ loading: false, page });
        })
        .catch((err: unknown) => {
          if (!cancelled)
            setDrawerHistory({
              loading: false,
              error: err instanceof Error ? err.message : 'Không đọc được lịch sử bảo trì.',
            });
        });
    }

    return () => {
      cancelled = true;
    };
  }, [activeDrawer?.asset.code, activeDrawer?.tab]);

  // Đọc phòng thủ: một phản hồi thiếu trường không được phép làm hỏng cả trang.
  const rows = useMemo(() => matrix.rows ?? [], [matrix]);

  /** Danh sách thiết bị khả dụng từ Kho có gắn nhãn phân loại 'Đang vận hành' và 'Tồn kho - dự trữ' */
  const classifiedAvailableAssets = useMemo(() => {
    return matrix.availableAssets.map((asset) => {
      // Thiết bị đã được gán đơn vị orgUnitId hoặc có thiết bị cha/cụm -> Đang vận hành tại vị trí
      // Thiết bị chưa gán vị trí vận hành -> Thiết bị đang lưu kho / dự trữ
      const isOperating = Boolean(asset.orgUnitId || asset.parentCode);
      return {
        ...asset,
        statusGroup: isOperating ? 'operating' : 'inventory',
        statusLabel: isOperating ? 'Đang vận hành' : 'Tồn kho - Dự trữ',
        statusBadgeClass: isOperating ? styles.assetOperating : styles.assetInventory,
      };
    });
  }, [matrix.availableAssets]);

  /** Lọc gợi ý thiết bị thêm mới theo từ khoá tìm kiếm */
  const filteredAddSuggestions = useMemo(() => {
    if (!addSearch.trim()) return classifiedAvailableAssets;
    const q = addSearch.toLowerCase().trim();
    return classifiedAvailableAssets.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.code.toLowerCase().includes(q) ||
        a.statusLabel.toLowerCase().includes(q)
    );
  }, [classifiedAvailableAssets, addSearch]);

  /** Lọc dữ liệu theo từ khoá, đơn vị phụ trách và mức ưu tiên */
  const filteredRows = useMemo(() => {
    let result = rows;
    if (filterText.trim()) {
      const q = filterText.toLowerCase().trim();
      result = result.filter(
        (r) =>
          r.asset.name.toLowerCase().includes(q) ||
          r.asset.code.toLowerCase().includes(q)
      );
    }
    if (filterUnit) {
      result = result.filter((r) => r.asset.orgUnitId === filterUnit);
    }
    if (filterPriority) {
      const draftOrRowPriority = (r: MaintenanceMatrixRow) =>
        drafts.get(r.asset.code)?.priority ?? r.priority;
      result = result.filter((r) => draftOrRowPriority(r) === filterPriority);
    }
    return result;
  }, [rows, filterText, filterUnit, filterPriority, drafts]);

  /** Danh sách các đơn vị phụ trách xuất hiện trong bảng để nạp vào dropdown lọc */
  const availableUnits = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.asset.orgUnitId) {
        const name = unitNames?.get(r.asset.orgUnitId) ?? r.asset.orgUnitId;
        map.set(r.asset.orgUnitId, name);
      }
    }
    return Array.from(map.entries());
  }, [rows, unitNames]);

  /**
   * Danh sách thiết bị phẳng (Flat Table): hiển thị trực tiếp các dòng thiết bị
   * theo kết quả lọc, không phân cấp cây cha-con.
   */
  const orderedRows = useMemo(() => {
    return filteredRows.map((row) => ({ row, depth: 0 }));
  }, [filteredRows]);
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
      const row = rows.find((entry) => entry.asset.code === assetCode);
      const existing = current.get(assetCode) ?? (row ? toDraft(row, frequencies) : undefined);
      if (!existing) return current;
      next.set(assetCode, change(existing));
      return next;
    });

  const toggle = (assetCode: string, frequency: MaintenanceFrequency) =>
    mutate(assetCode, (draft) => {
      const frequencies = new Set(draft.frequencies);
      const startDates = new Map(draft.startDates);
      if (frequencies.has(frequency)) {
        frequencies.delete(frequency);
        startDates.delete(frequency);
      } else {
        frequencies.add(frequency);
        startDates.set(frequency, defaultStartDate());
      }
      return { ...draft, frequencies, startDates };
    });

  const setStartDate = (assetCode: string, frequency: MaintenanceFrequency, value: string) =>
    mutate(assetCode, (draft) => {
      const startDates = new Map(draft.startDates);
      startDates.set(frequency, value);
      return { ...draft, startDates };
    });

  const save = () =>
    onSave(
      rows.map((row) => {
        const draft = drafts.get(row.asset.code) ?? toDraft(row, frequencies);
        return {
          assetCode: row.asset.code,
          frequencies: [...draft.frequencies],
          startDates: Object.fromEntries(draft.startDates),
          procedureDefinitionId: draft.procedureDefinitionId || undefined,
          priority: draft.priority,
        };
      }),
    );

  /** Tính toán phân trang */
  const totalRecords = orderedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return orderedRows.slice(start, start + pageSize);
  }, [orderedRows, safeCurrentPage, pageSize]);

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
            Lưu thay đổi
          </button>
        ) : null}
      </header>

      {!matrix.assetDirectoryAvailable ? (
        <p className={styles.warning}>
          Chưa đọc được danh mục thiết bị từ Kho — bảng chỉ hiện các thiết bị đã có lịch bảo trì.
        </p>
      ) : null}

      {/* 2. BẢNG DỮ LIỆU CHUẨN 3 PHẦN */}
      <div className={styles.scroll}>
        {/* VÙNG 1: HEADER CONTROLS (TÌM KIẾM + BỘ LỌC + THÊM THIẾT BỊ SUGGEST + XOÁ LỌC) */}
        <div className={styles.controlsBar}>
          <div className={styles.tableControls}>
            {/* 1.1. Tìm kiếm trên ma trận */}
            <div className={styles.searchBox}>
              <span className={styles.searchIcon}>
                <Search size={14} strokeWidth={2} />
              </span>
              <input
                placeholder="Tìm trên ma trận (MBA-01, MC-901)..."
                value={filterText}
                onChange={(e) => {
                  setFilterText(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>

            {/* 1.2. Thêm thiết bị từ Kho dạng Input Suggestion */}
            {canManage && onAddAsset && matrix.availableAssets.length > 0 ? (
              <div className={styles.suggestWrapper}>
                <div className={styles.suggestInputBox}>
                  <span className={styles.suggestIcon}>
                    <Plus size={14} strokeWidth={2.2} />
                  </span>
                  <input
                    placeholder="Thêm thiết bị từ Kho (Gõ tên / mã)..."
                    value={addSearch}
                    onFocus={() => setIsAddOpen(true)}
                    onChange={(e) => {
                      setAddSearch(e.target.value);
                      setIsAddOpen(true);
                    }}
                    disabled={busy}
                  />
                  {addSearch ? (
                    <button
                      type="button"
                      className={styles.clearSuggestBtn}
                      onClick={() => {
                        setAddSearch('');
                        setIsAddOpen(false);
                      }}
                      title="Xóa tìm kiếm"
                    >
                      <X size={13} strokeWidth={2.2} />
                    </button>
                  ) : null}
                </div>

                {isAddOpen ? (
                  <>
                    <div
                      className={styles.suggestOverlay}
                      onClick={() => setIsAddOpen(false)}
                    />
                    <div className={styles.suggestDropdown}>
                      <div className={styles.suggestHead}>
                        <span>Chọn thiết bị từ Kho ({filteredAddSuggestions.length})</span>
                        <small>Phân loại: Đang vận hành · Tồn kho - Dự trữ</small>
                      </div>
                      <div className={styles.suggestList}>
                        {filteredAddSuggestions.length === 0 ? (
                          <div className={styles.suggestEmpty}>
                            Không tìm thấy thiết bị nào khớp với "{addSearch}"
                          </div>
                        ) : (
                          filteredAddSuggestions.map((asset) => (
                            <button
                              key={asset.code}
                              type="button"
                              className={styles.suggestItem}
                              onClick={() => {
                                onAddAsset(asset.code);
                                setAddSearch('');
                                setIsAddOpen(false);
                              }}
                            >
                              <div className={styles.suggestItemLeft}>
                                <strong className={styles.suggestItemName}>
                                  {asset.name}
                                </strong>
                                <span className={styles.suggestItemCode}>
                                  {asset.code}
                                  {asset.orgUnitId && unitNames?.get(asset.orgUnitId) ? (
                                    <> · {unitNames.get(asset.orgUnitId)}</>
                                  ) : null}
                                </span>
                              </div>
                              <span
                                className={`${styles.suggestStatusBadge} ${asset.statusBadgeClass}`}
                              >
                                {asset.statusLabel}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {/* 1.3. Lọc Đơn vị */}
            <select
              className={styles.selectFilter}
              value={filterUnit}
              onChange={(e) => {
                setFilterUnit(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="">Tất cả đơn vị</option>
              {availableUnits.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>

            {/* 1.4. Lọc Mức ưu tiên */}
            <select
              className={styles.selectFilter}
              value={filterPriority}
              onChange={(e) => {
                setFilterPriority(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="">Mức ưu tiên</option>
              <option value="High">Cao</option>
              <option value="Normal">Thường</option>
              <option value="Low">Thấp</option>
            </select>

            {/* 1.5. Xoá bộ lọc */}
            {filterText || filterUnit || filterPriority ? (
              <button
                type="button"
                className={styles.resetBtn}
                title="Xóa toàn bộ bộ lọc và đặt lại mặc định"
                onClick={() => {
                  setFilterText('');
                  setFilterUnit('');
                  setFilterPriority('');
                  setCurrentPage(1);
                }}
              >
                Xoá bộ lọc
              </button>
            ) : null}
          </div>
        </div>

        <div className={styles.tableResponsive}>
          <table className={styles.table}>
            <thead>
              {/* HÀNG TIÊU ĐỀ CỘT */}
              <tr>
                <th className={styles.assetHead}>Thiết bị</th>
                <th className={styles.unitHead}>Đơn vị phụ trách</th>
                <th className={styles.priorityHead}>Ưu tiên</th>
                {frequencies.map((entry) => (
                  <th key={entry.id} className={styles.freqHead}>
                    {entry.label}
                  </th>
                ))}
                <th className={styles.flowHead}>Luồng thực thi khi tạo lệnh</th>
                <th className={styles.actionHead}>Thao tác</th>
              </tr>
            </thead>

          {/* VÙNG 2: THÂN BẢNG (BODY LIST + ROW ACTIONS) */}
          <tbody>
            {paginatedRows.map(({ row }) => {
              const draft = drafts.get(row.asset.code) ?? toDraft(row, frequencies);
              const isDrawerActive = activeDrawer?.asset.code === row.asset.code;
              return (
                <tr
                  key={row.asset.code}
                  className={isDrawerActive ? styles.rowActive : undefined}
                >
                  {/* Cột 1: Tên thiết bị - Click để mở Drawer chi tiết */}
                  <td>
                    <button
                      type="button"
                      className={styles.assetBtn}
                      onClick={() =>
                        setActiveDrawer({
                          asset: row.asset,
                          tab: 'tasks',
                        })
                      }
                      title="Nhấn để xem chi tiết Đầu việc (Kho) và Lịch sử bảo trì"
                    >
                      <div className={styles.asset}>
                        <span>
                          <strong>{row.asset.name}</strong>
                          <small>{row.asset.code}</small>
                        </span>
                      </div>
                    </button>
                  </td>
                  <td className={styles.unit}>
                    {row.asset.orgUnitId
                      ? unitNames?.get(row.asset.orgUnitId) ?? '—'
                      : '—'}
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
                        {checked && row.cells[entry.id]?.nextDueAt ? (
                          <span className={styles.due}>{formatDue(row.cells[entry.id]?.nextDueAt)}</span>
                        ) : checked ? (
                          <input
                            type="date"
                            className={styles.dueInput}
                            value={draft.startDates.get(entry.id) ?? defaultStartDate()}
                            disabled={!canManage || busy}
                            aria-label={`Ngày bảo trì kế tiếp — ${row.asset.name} — ${entry.label}`}
                            title="Ngày bảo trì kế tiếp. Mặc định gợi ý một tuần nữa, không phải hôm nay."
                            onChange={(event) =>
                              setStartDate(row.asset.code, entry.id, event.target.value)
                            }
                          />
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
                      <Popconfirm
                        title={`Gỡ ${row.asset.name}?`}
                        description={`Hành động này sẽ gỡ thiết bị (${row.asset.code}) khỏi ma trận bảo trì và xoá toàn bộ lịch định kỳ liên quan.`}
                        okText="Gỡ thiết bị"
                        okType="danger"
                        placement="left"
                        onConfirm={() => onRemoveAsset?.(row.asset.code)}
                      >
                        <button
                          type="button"
                          className={styles.removeAsset}
                          disabled={!canManage || busy || !onRemoveAsset}
                          title="Gỡ thiết bị khỏi ma trận và xoá mọi lịch của nó"
                        >
                          Gỡ
                        </button>
                      </Popconfirm>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={frequencies.length + 5} className={styles.empty}>
                  {rows.length === 0
                    ? 'Chưa có thiết bị nào trên ma trận. Dùng ô “Thêm thiết bị từ Kho” ở thanh công cụ phía trên để đưa vào.'
                    : 'Không có thiết bị nào khớp với bộ lọc tìm kiếm.'}
                </td>
              </tr>
            ) : null}
          </tbody>
          </table>
        </div>

        {/* VÙNG 3: FOOTER CHÂN BẢNG CHUẨN ĐỒNG BỘ VỚI WORKSPACE BOARD */}
        <div className={styles.tableFooter}>
          <div className={styles.footerLeft}>
            <span className={styles.totalRecords}>
              Hiển thị <strong>{totalRecords > 0 ? (safeCurrentPage - 1) * pageSize + 1 : 0}–{Math.min(safeCurrentPage * pageSize, totalRecords)}</strong> / <strong>{totalRecords}</strong> thiết bị
            </span>
            <label className={styles.pageSizeLabel}>
              <span>Hiển thị:</span>
              <select
                className={styles.pageSizeSelect}
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value) || 15);
                  setCurrentPage(1);
                }}
              >
                <option value={15}>15 / trang</option>
                <option value={30}>30 / trang</option>
                <option value={45}>45 / trang</option>
                <option value={60}>60 / trang</option>
              </select>
            </label>
          </div>

          <div className={styles.footerRight}>
            <div className={styles.paginationGroup}>
              <button
                type="button"
                className={styles.pageBtn}
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                title="Trang trước"
              >
                ← Trước
              </button>
              <span className={styles.pageIndicator}>
                {safeCurrentPage} / {totalPages}
              </span>
              <button
                type="button"
                className={styles.pageBtn}
                disabled={safeCurrentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                title="Trang sau"
              >
                Sau →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* DRAWER CHI TIẾT THIẾT BỊ (2 TAB: 1. ĐẦU VIỆC (KHO) | 2. LỊCH SỬ BẢO TRÌ) */}
      {activeDrawer ? (
        <>
          <div className={styles.drawerBackdrop} onClick={() => setActiveDrawer(undefined)} />
          <aside className={styles.drawerPanel}>
            <header className={styles.drawerHead}>
              <div className={styles.drawerHeadInfo}>
                <span className={styles.drawerEyebrow}>Chi tiết thiết bị</span>
                <h3 className={styles.drawerTitle}>{activeDrawer.asset.name}</h3>
                <p className={styles.drawerSubtitle}>
                  Mã: <code>{activeDrawer.asset.code}</code>
                  {activeDrawer.asset.orgUnitId && unitNames?.get(activeDrawer.asset.orgUnitId) ? (
                    <> · Đơn vị: {unitNames.get(activeDrawer.asset.orgUnitId)}</>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                className={styles.drawerCloseBtn}
                onClick={() => setActiveDrawer(undefined)}
                aria-label="Đóng ngăn kéo"
              >
                ✕
              </button>
            </header>

            {/* TAB SELECTOR: 1. ĐẦU VIỆC KHO · 2. LỊCH SỬ BẢO TRÌ */}
            <div className={styles.drawerTabs}>
              <button
                type="button"
                className={`${styles.drawerTabBtn} ${activeDrawer.tab === 'tasks' ? styles.drawerTabBtnActive : ''}`}
                onClick={() => setActiveDrawer({ ...activeDrawer, tab: 'tasks' })}
              >
                <FileText size={14} strokeWidth={2} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                1. Đầu việc (Kho){' '}
                {drawerTasks.list ? `(${drawerTasks.list.tasks.length})` : ''}
              </button>
              <button
                type="button"
                className={`${styles.drawerTabBtn} ${activeDrawer.tab === 'history' ? styles.drawerTabBtnActive : ''}`}
                onClick={() => setActiveDrawer({ ...activeDrawer, tab: 'history' })}
              >
                <History size={14} strokeWidth={2} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                2. Lịch sử bảo trì{' '}
                {drawerHistory.page ? `(${drawerHistory.page.items.length})` : ''}
              </button>
            </div>

            {/* TAB BODY CONTENT */}
            <div className={styles.drawerBody}>
              {activeDrawer.tab === 'tasks' ? (
                <div className={styles.drawerTasksTab}>
                  {drawerTasks.loading ? (
                    <div className={styles.drawerLoading}>Đang đọc đầu việc từ Kho…</div>
                  ) : drawerTasks.error ? (
                    <div className={styles.drawerError}>{drawerTasks.error}</div>
                  ) : !drawerTasks.list || drawerTasks.list.tasks.length === 0 ? (
                    <div className={styles.drawerEmpty}>
                      <p>Thiết bị này chưa khai báo đầu việc nào trong hồ sơ Kho.</p>
                      <a
                        href={`/modules/inventory#assets/${encodeURIComponent(activeDrawer.asset.code)}`}
                        className={styles.inventoryLink}
                      >
                        Khởi tạo đầu việc bên Kho →
                      </a>
                    </div>
                  ) : (
                    <>
                      <div className={styles.tasksSummary}>
                        <span>
                          Tổng cộng: <strong>{drawerTasks.list.tasks.length}</strong> đầu việc tiêu chuẩn.
                        </span>
                        <a
                          href={`/modules/inventory#assets/${encodeURIComponent(activeDrawer.asset.code)}`}
                          className={styles.inventoryLink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Sửa trong Kho ↗
                        </a>
                      </div>
                      <ol className={styles.taskList}>
                        {drawerTasks.list.tasks.map((task, idx) => {
                          const name = String(task['name'] ?? task['title'] ?? `Đầu việc ${idx + 1}`);
                          const key = task['key'] ? String(task['key']) : undefined;
                          const mins = typeof task['durationMinutes'] === 'number' ? task['durationMinutes'] : undefined;
                          return (
                            <li key={idx} className={styles.taskListItem}>
                              <div className={styles.taskItemHeader}>
                                <span className={styles.taskIndex}>{idx + 1}.</span>
                                <strong className={styles.taskName}>{name}</strong>
                                {mins ? <span className={styles.taskDuration}>{mins} phút</span> : null}
                              </div>
                              {key ? <div className={styles.taskKey}>Mã: {key}</div> : null}
                            </li>
                          );
                        })}
                      </ol>
                    </>
                  )}
                </div>
              ) : (
                <div className={styles.drawerHistoryTab}>
                  {drawerHistory.loading ? (
                    <div className={styles.drawerLoading}>Đang tải lịch sử bảo trì…</div>
                  ) : drawerHistory.error ? (
                    <div className={styles.drawerError}>{drawerHistory.error}</div>
                  ) : !drawerHistory.page || drawerHistory.page.items.length === 0 ? (
                    <div className={styles.drawerEmpty}>
                      <p>Chưa có lịch sử bảo trì nào được ghi nhận cho thiết bị này.</p>
                    </div>
                  ) : (
                    <div className={styles.historyList}>
                      {drawerHistory.page.items.map((occ) => (
                        <div key={occ.id} className={styles.historyItemCard}>
                          <div className={styles.historyCardTop}>
                            <span className={styles.historyCardCode}>{occ.code ?? occ.id.slice(0, 8).toUpperCase()}</span>
                            <span className={`${styles.historyStatusBadge} ${styles[`status_${occ.status}`]}`}>
                              {occ.status === 'completed'
                                ? 'Hoàn thành'
                                : occ.status === 'in_progress'
                                  ? 'Đang xử lý'
                                  : occ.status === 'planned'
                                    ? 'Đã lên lịch'
                                    : occ.status}
                            </span>
                          </div>
                          <h4 className={styles.historyCardTitle}>{occ.title}</h4>
                          <div className={styles.historyCardMeta}>
                            <span>
                              Loại: <strong>{occ.kind === 'preventive' ? 'Định kỳ' : 'Sự cố'}</strong>
                            </span>
                            <span>
                              {occ.completedAt
                                ? `Hoàn tất: ${new Date(occ.completedAt).toLocaleDateString('vi-VN')}`
                                : `Hạn xử lý: ${new Date(occ.dueAt).toLocaleDateString('vi-VN')}`}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        </>
      ) : null}
    </section>
  );
}
