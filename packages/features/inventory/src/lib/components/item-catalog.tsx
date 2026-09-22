'use client';

import type {
  AssetStatus,
  InstalledMaterial,
  InventoryItem,
  Material,
  MaterialInventory,
  StocktakeLine,
  StocktakeSession,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { formatNumber } from '../inventory-labels';
import {
  loadLatestStocktakeForMaterial,
  loadMaintenanceSchedulesForAsset,
  loadMaterialHistory,
  type InventoryLedgerRow,
  type MaintenanceScheduleSummary,
  type InventoryWorkspace,
} from '../inventory-api';
import { MaterialHistory } from './material-history';
import { MaterialStocktakePanel } from './material-stocktake-panel';
import { LotPanel } from './lot-panel';
import { SerialPanel } from './serial-panel';
import {
  Search,
  X,
  MapPin,
  Clock,
  ClipboardCheck,
  Printer,
  QrCode,
  Boxes,
  Ban,
  Layers,
} from 'lucide-react';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import styles from '../inventory.module.scss';

/**
 * Nhãn phân loại nói theo TRẠNG THÁI, không theo "loại vật tư".
 *
 * Thiết bị và phụ tùng đều là vật tư — cùng một bảng, cùng một khái niệm. Khác
 * nhau ở chỗ nó đang nằm trong kho hay đã lắp vào một vị trí. Gọi tên theo trạng
 * thái thì người đọc không phải học thêm hai từ mới cho cùng một thứ.
 */
const KIND_LABEL: Readonly<Record<InventoryItem['kind'], string>> = {
  STOCK: 'Trong kho',
  ASSET: 'Lắp đặt',
};

/**
 * Danh mục HỢP NHẤT — vật tư kho và thiết bị trong một bảng.
 *
 * Từ lượt gộp dữ liệu, cả hai đã là cùng một bảng, chỉ khác `kind`. Một cái máy
 * biến áp cũng là một mã vật tư: nó có đơn vị tính, có giá, có thể tồn trong kho
 * trước khi lắp. Tách làm hai màn hình khiến câu hỏi thường gặp nhất — "cái này
 * là gì, còn bao nhiêu, đang lắp ở đâu" — phải tra hai chỗ.
 *
 * Cột "Đang lắp tại" là thứ danh sách vật tư cũ không trả lời được: nó cho biết
 * một thiết bị đang nằm trong kho hay đã ra hiện trường, và ở trạm nào.
 */
/** Danh mục kèm giá trị đang dùng, để một lần sửa không xoá mất dữ liệu cũ. */
function withCurrent(options: readonly string[], current?: string): string[] {
  if (!current || options.includes(current)) return [...options];
  return [...options, current];
}

export function ItemCatalog({
  items,
  materialByCode,
  statuses = [],
  usageStates = [],
  types = [],
  installed = [],
  warehouses = [],
  stock = [],
  workspace,
  busy,
  initialQuery,
  onPatch,
  onRetire,
  onOpenProfile,
  onAddMaterial,
  onOpenMovement,
}: {
  items: readonly InventoryItem[];
  /** Hồ sơ mã kho, để mở khối sê-ri khi mã theo dõi theo cá thể. */
  materialByCode?: ReadonlyMap<string, Material>;
  statuses?: readonly string[];
  usageStates?: readonly string[];
  /** Danh mục "Loại vật tư", khai trong Cài đặt. */
  types?: readonly string[];
  /** Số đang lắp của từng đơn vị, để cộng ra tổng sở hữu. */
  installed?: readonly InstalledMaterial[];
  /** Danh sách kho — nguồn MẶC ĐỊNH của ô "Vị trí". */
  warehouses?: readonly Warehouse[];
  /** Tồn theo từng kho, để bung chi tiết dưới mỗi mã. */
  stock?: readonly (MaterialInventory & { warehouseCode?: string; materialCode?: string })[];
  workspace?: InventoryWorkspace;
  busy?: boolean;
  /** Mã cần tìm sẵn khi nhảy sang từ cảnh báo thủng sàn tồn. */
  initialQuery?: string;
  /** Thêm vật tư mới vào danh mục kho. */
  onAddMaterial?: () => void;
  /** Mở nhanh form tác nghiệp kho (xuất kho, chuyển kho...) */
  onOpenMovement?: (init: {
    kind?: 'receipt' | 'issue' | 'transfer' | 'adjust';
    materialCode?: string;
  }) => void;
  /** Ngừng dùng một mã — không có đường xoá. */
  onRetire?: (material: Material) => void;
  /** Mở hồ sơ đầy đủ của một mã — dạng hộp thoại. */
  onOpenProfile?: (code: string) => void;
  /** Lưu ngay khi đổi ô chọn trên dòng hoặc lưu form chỉnh sửa. */
  onPatch?: (
    item: InventoryItem,
    patch: {
      name?: string;
      code?: string;
      newCode?: string;
      status?: AssetStatus;
      usageState?: string;
      type?: string;
    },
  ) => void;
}) {
  const [kind, setKind] = useState<'all' | InventoryItem['kind']>('all');
  /** Mã đang mở chi tiết. Một mã một lúc: mở hết thì bảng dài vô tận. */
  const [openCode, setOpenCode] = useState<string>();
  /** Lịch sử nạp theo yêu cầu: kéo hết mọi mã là hàng chục nghìn dòng cho một
      màn chỉ mở một mã một lúc. */
  const [history, setHistory] = useState<
    Record<string, InventoryLedgerRow[] | 'loading' | 'error'>
  >({});

  const open = (code: string) => {
    setOpenCode((current) => (current === code ? undefined : code));
    if (history[code]) return;
    setHistory((current) => ({ ...current, [code]: 'loading' }));
    loadMaterialHistory(code)
      .then((rows) => setHistory((current) => ({ ...current, [code]: rows })))
      .catch(() => setHistory((current) => ({ ...current, [code]: 'error' })));
  };
  const label = (value: InventoryItem['kind']) => KIND_LABEL[value];

  /**
   * Lựa chọn cho ô "Vị trí".
   *
   * MẶC ĐỊNH là danh sách kho — chỗ mặc định của một vật tư là nằm trong một kho
   * nào đó. Các giá trị admin khai thêm ("mượn thí nghiệm", "gửi đi sửa") nối
   * vào sau, vì chúng là ngoại lệ so với mặc định đó.
   */
  const whereOptions = useMemo(() => {
    // Đã khai trong Cài đặt thì danh mục đó là nguồn duy nhất — nếu vẫn nối thêm
    // tên kho thì admin không bỏ được một kho khỏi ô chọn, tức danh mục họ khai
    // không thật sự quyết định gì.
    if (usageStates.length > 0) return [...usageStates];
    return warehouses.map((warehouse) => warehouse.name);
  }, [warehouses, usageStates]);

  /** Tồn theo kho, gom theo mã để bung dưới mỗi dòng. */
  const warehouseCodeById = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.code])),
    [warehouses],
  );

  const stockByCode = useMemo(() => {
    const map = new Map<string, typeof stock>();
    for (const row of stock) {
      if (!row.materialCode) continue;
      map.set(row.materialCode, [...(map.get(row.materialCode) ?? []), row]);
    }
    return map;
  }, [stock]);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editDraft, setEditDraft] = useState<{
    code: string;
    name: string;
    type: string;
    status: AssetStatus | '';
    usageState: string;
  }>({
    code: '',
    name: '',
    type: '',
    status: '',
    usageState: '',
  });

  const handleStartEdit = (item: InventoryItem, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingItem(item);
    setEditDraft({
      code: item.code,
      name: item.name,
      type: item.type ?? '',
      status: item.status ?? '',
      usageState: item.usageState ?? '',
    });
  };

  const handleSaveEdit = () => {
    if (!editingItem || !onPatch) return;
    const trimmedName = editDraft.name.trim();
    const trimmedCode = editDraft.code.trim().toUpperCase();
    onPatch(editingItem, {
      code: trimmedCode || editingItem.code,
      name: trimmedName || editingItem.name,
      type: editDraft.type || undefined,
      status: (editDraft.status as AssetStatus) || undefined,
      usageState: editDraft.usageState || undefined,
    });
    setEditingItem(null);
  };

  const [root, setRoot] = useState('all');
  const [query, setQuery] = useState(initialQuery ?? '');

  // Đồng bộ khi bên ngoài đổi mã cần tìm — bấm một mã khác trên dải cảnh báo
  // phải đổi bộ lọc, không phải giữ nguyên mã cũ.
  useEffect(() => {
    if (initialQuery !== undefined) setQuery(initialQuery);
  }, [initialQuery]);

  /** Các nhánh gốc có mặt trong dữ liệu — để lọc theo trạm/nhà máy. */
  const roots = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (item.rootCode && item.rootName) map.set(item.rootCode, item.rootName);
    }
    return [...map.entries()].sort((left, right) => left[1].localeCompare(right[1], 'vi'));
  }, [items]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (kind !== 'all' && item.kind !== kind) return false;
      if (root !== 'all' && item.rootCode !== root) return false;
      if (!needle) return true;
      return (
        item.code.toLowerCase().includes(needle) ||
        item.name.toLowerCase().includes(needle) ||
        (item.installedAtName ?? '').toLowerCase().includes(needle)
      );
    });
  }, [items, kind, root, query]);

  /** Tồn thực và phần đã giữ, cộng qua mọi kho của một mã. */
  const onHand = (item: InventoryItem) =>
    (stockByCode.get(item.code) ?? []).reduce((sum, row) => sum + row.quantity, 0);
  const reserved = (item: InventoryItem) =>
    (stockByCode.get(item.code) ?? []).reduce((sum, row) => sum + row.quantityReserved, 0);

  /**
   * Số đang nằm ngoài hiện trường — đã lắp lên một vật tư khác.
   *
   * Không nằm trong kho nên không tính vào tồn, nhưng vẫn là tài sản của đơn vị
   * nên phải cộng vào tổng sở hữu. Thiếu cột này thì "lắp 5 cái" và "còn 5 cái
   * trong kho" hiện ra hai số giống nhau mà không phân biệt được.
   */
  const inUse = (item: InventoryItem) =>
    (installed ?? [])
      .filter((line) => line.materialCode === item.code)
      .reduce((sum, line) => sum + line.quantity, 0);

  const [pageSize, setPageSize] = useState<number>(15);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const totalRecords = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, safeCurrentPage, pageSize]);

  const activeItem = useMemo(
    () => (openCode ? items.find((i) => i.code === openCode) : undefined),
    [items, openCode],
  );
  const activeMaterial = useMemo(
    () => (activeItem ? materialByCode?.get(activeItem.code) : undefined),
    [activeItem, materialByCode],
  );

  /**
   * Phương thức theo dõi định danh của vật tư:
   * Nghiệp vụ ERP/WMS chuẩn: Một vật tư chỉ có MỘT loại quản lý duy nhất:
   * - 'SERIAL': Quản lý theo cá thể từng số Sê-ri (isSerialized = true)
   * - 'LOT': Quản lý theo Lô / Mẻ / Bịch / Kiện (hàng tiêu hao, dầu mỡ, cáp điện...)
   * - 'NONE': Vật tư thông thường (theo dõi số lượng thuần túy)
   */
  const getTrackingType = (item?: InventoryItem, mat?: Material): 'SERIAL' | 'LOT' | 'NONE' => {
    if (!item) return 'NONE';
    if (mat?.isSerialized) return 'SERIAL';
    return mat?.category === 'CONSUMABLE' ? 'LOT' : 'NONE';
  };

  const activeTrackingType = useMemo(
    () => getTrackingType(activeItem, activeMaterial),
    [activeItem, activeMaterial],
  );

  /** 4 Sub-Tabs cho Actionable Drawer của Thủ kho: 1. Vị trí & Kho, 2. Sê-ri HOẶC Lô (nếu có), 3. Thẻ kho, 4. Kiểm kê */
  type DrawerTab = 'storage' | 'tracking' | 'ledger' | 'stocktaking';
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('storage');

  const [maintenanceSchedules, setMaintenanceSchedules] = useState<
    Record<string, MaintenanceScheduleSummary[] | 'loading' | 'error'>
  >({});
  const [latestStocktakes, setLatestStocktakes] = useState<
    Record<string, { session: StocktakeSession; line: StocktakeLine } | 'loading' | 'error' | undefined>
  >({});

  /** Modal in tem QR code khổ 50x30mm */
  const [showQrPrintModal, setShowQrPrintModal] = useState(false);

  // Reset tab và form phụ trợ khi đổi mã vật tư được chọn
  useEffect(() => {
    if (openCode) {
      setDrawerTab('storage');
      if (!maintenanceSchedules[openCode]) {
        setMaintenanceSchedules((current) => ({ ...current, [openCode]: 'loading' }));
        loadMaintenanceSchedulesForAsset(openCode)
          .then((rows) =>
            setMaintenanceSchedules((current) => ({
              ...current,
              [openCode]: rows ?? [],
            })),
          )
          .catch(() => setMaintenanceSchedules((current) => ({ ...current, [openCode]: 'error' })));
      }
      if (!latestStocktakes[openCode]) {
        setLatestStocktakes((current) => ({ ...current, [openCode]: 'loading' }));
        loadLatestStocktakeForMaterial(openCode, workspace)
          .then((result) =>
            setLatestStocktakes((current) => ({
              ...current,
              [openCode]: result,
            })),
          )
          .catch(() => setLatestStocktakes((current) => ({ ...current, [openCode]: 'error' })));
      }
    }
  }, [openCode, maintenanceSchedules, latestStocktakes, workspace]);

  const activeStockRows = activeItem ? stockByCode.get(activeItem.code) ?? [] : [];
  const activeLocationIds = activeStockRows
    .map((row) => row.locationId)
    .filter((locationId): locationId is string => Boolean(locationId));
  const rawMaintenance = activeItem ? maintenanceSchedules[activeItem.code] : undefined;
  const activeMaintenance: MaintenanceScheduleSummary[] | undefined =
    Array.isArray(rawMaintenance) ? rawMaintenance : undefined;
  const rawStocktake = activeItem ? latestStocktakes[activeItem.code] : undefined;

  return (
    <section id="inventory-item-catalog" className={styles.standardTableCard}>
      {/* VÙNG 1: HEADER CONTROLS (TÌM KIẾM -> PHÂN LOẠI TAB -> BỘ LỌC -> NÚT THÊM VẬT TƯ) */}
      <div className={styles.tableControlsBar}>
        <div className={styles.tableControlsLeft}>
          {/* 1. Ô Tìm kiếm */}
          <div className={styles.tableSearchBox}>
            <span className={styles.tableSearchIcon}>
              <Search size={14} strokeWidth={2} />
            </span>
            <input
              type="search"
              placeholder="Tìm theo mã, tên hoặc vị trí lắp đặt…"
              value={query}
              aria-label="Tìm vật tư"
              onChange={(event) => {
                setQuery(event.target.value);
                setCurrentPage(1);
              }}
            />
          </div>

          {/* 2. Phân loại Tab */}
          <div className={styles.kindSegmentedTabs}>
            {(['all', 'STOCK', 'ASSET'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`${styles.kindSegmentedBtn} ${kind === value ? styles.kindSegmentedBtnActive : ''}`}
                onClick={() => {
                  setKind(value);
                  setCurrentPage(1);
                }}
              >
                {value === 'all' ? 'Tất cả' : label(value)}
                <span className={styles.kindCount}>
                  {value === 'all'
                    ? items.length
                    : items.filter((item) => item.kind === value).length}
                </span>
              </button>
            ))}
          </div>

          {/* 3. Bộ lọc vị trí */}
          {roots.length > 0 ? (
            <select
              className={styles.tableSelectFilter}
              value={root}
              onChange={(event) => {
                setRoot(event.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="all">Mọi vị trí</option>
              {roots.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}

          {/* Nút Xoá lọc */}
          {query || root !== 'all' || kind !== 'all' ? (
            <button
              type="button"
              className={styles.tableResetBtn}
              title="Xóa bộ lọc"
              onClick={() => {
                setQuery('');
                setRoot('all');
                setKind('all');
                setCurrentPage(1);
              }}
            >
              Xoá bộ lọc
            </button>
          ) : null}
        </div>

        {/* 4. Cụm nút Thao tác bên phải: Nút Xuất/nhập kho và Nút Thêm vật tư */}
        <div className={styles.tableControlsRight}>
          {onOpenMovement ? (
            <button
              type="button"
              className={styles.btnSecondary}
              style={{
                padding: '7px 16px',
                borderRadius: '6px',
                border: '1px solid #2563eb',
                background: '#2563eb',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              }}
              onClick={() => onOpenMovement({ kind: 'receipt' })}
              title="Mở popup form xuất/nhập kho vật tư"
              disabled={busy}
            >
              + Xuất/nhập kho
            </button>
          ) : null}
          {onAddMaterial ? (
            <button
              type="button"
              className={styles.addMaterialBtn}
              onClick={onAddMaterial}
              disabled={busy}
            >
              + Thêm vật tư
            </button>
          ) : null}
        </div>
      </div>

      {/* VÙNG 2: THÂN BẢNG DỮ LIỆU */}
      <div className={styles.tableResponsiveWrap}>
        <table className={styles.standardTable}>
          <thead>
            <tr>
              <th style={{ width: '220px' }}>Mã / Tên vật tư</th>
              <th style={{ width: '130px' }}>Loại danh mục</th>
              <th style={{ width: '130px' }}>Tình trạng</th>
              <th style={{ width: '160px' }}>Vị trí sử dụng</th>
              <th style={{ width: '100px' }} className={styles.center}>Tổng sở hữu</th>
              <th style={{ width: '100px' }} className={styles.center}>Đang sử dụng</th>
              <th style={{ width: '90px' }} className={styles.center}>Đang giữ</th>
              <th style={{ width: '90px' }} className={styles.center}>Khả dụng</th>
              {onPatch ? <th style={{ width: '100px' }} className={styles.center}>Thao tác</th> : null}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((item) => {
              const material = materialByCode?.get(item.code);
              const expanded = openCode === item.code;
              return (
                <Fragment key={item.code}>
                  <tr
                    className={`${styles.clickable} ${expanded ? styles.tableRowActive : ''}`}
                    onClick={busy ? undefined : () => open(item.code)}
                  >
                    <td className={styles.code}>
                      <strong className={styles.codeLabel}>{item.code}</strong>
                      <span className={styles.sub}>{item.name}</span>
                    </td>
                    <td>
                      {item.type ? (
                        <span className={styles.typeBadge}>{item.type}</span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td>
                      {(() => {
                        const trackingType = getTrackingType(item, material);
                        if (trackingType === 'SERIAL') {
                          return (
                            <button
                              type="button"
                              className={styles.statusBadge}
                              style={{
                                background: '#eff6ff',
                                color: '#1d4ed8',
                                border: '1px solid #bfdbfe',
                                cursor: 'pointer',
                                padding: '2px 8px',
                              }}
                              title="Vật tư quản lý theo cá thể: Bấm xem tình trạng từng số Sê-ri"
                              onClick={(e) => {
                                e.stopPropagation();
                                open(item.code);
                                setDrawerTab('tracking');
                              }}
                            >
                              Theo Sê-ri
                            </button>
                          );
                        }
                        if (trackingType === 'LOT') {
                          return (
                            <button
                              type="button"
                              className={styles.statusBadge}
                              style={{
                                background: '#f0fdf4',
                                color: '#15803d',
                                border: '1px solid #bbf7d0',
                                cursor: 'pointer',
                                padding: '2px 8px',
                              }}
                              title="Vật tư quản lý theo mẻ hàng: Bấm xem tình trạng từng Lô"
                              onClick={(e) => {
                                e.stopPropagation();
                                open(item.code);
                                setDrawerTab('tracking');
                              }}
                            >
                              Theo Lô hàng
                            </button>
                          );
                        }
                        return item.status ? (
                          <span className={`${styles.statusBadge} ${styles[`status_${item.status}`]}`}>
                            {item.status}
                          </span>
                        ) : (
                          <span className={styles.muted}>—</span>
                        );
                      })()}
                    </td>
                    <td>
                      {material?.isSerialized ? (
                        <span className={styles.muted}>theo sê-ri</span>
                      ) : item.usageState ? (
                        <span className={styles.locationTag}>{item.usageState}</span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={`${styles.numeric} ${styles.center}`}>
                      <strong>{formatNumber(onHand(item) + inUse(item))}</strong> {item.unit ?? ''}
                    </td>
                    <td className={`${styles.numeric} ${styles.center}`}>
                      {inUse(item) > 0 ? formatNumber(inUse(item)) : <span className={styles.muted}>0</span>}
                    </td>
                    <td className={`${styles.numeric} ${styles.center}`}>
                      {reserved(item) > 0 ? formatNumber(reserved(item)) : <span className={styles.muted}>0</span>}
                    </td>
                    <td className={`${styles.numeric} ${styles.center}`}>
                      {formatNumber(onHand(item) - reserved(item))}
                    </td>
                    {onPatch ? (
                      <td className={styles.center} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className={styles.editRowBtn}
                          disabled={busy}
                          title={`Chỉnh sửa thông tin ${item.code}`}
                          onClick={(e) => handleStartEdit(item, e)}
                        >
                          Sửa
                        </button>
                      </td>
                    ) : null}
                  </tr>
                </Fragment>
              );
            })}
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={8} className={styles.empty}>
                  Không có mục nào khớp bộ lọc tìm kiếm.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* VÙNG 3: FOOTER CHÂN BẢNG (ĐỒNG BỘ CHUẨN WORKSPACE) */}
      <div className={styles.tableFooterBar}>
        <div className={styles.tableFooterLeft}>
          <span className={styles.tableTotalRecords}>
            Hiển thị <strong>{totalRecords > 0 ? (safeCurrentPage - 1) * pageSize + 1 : 0}–{Math.min(safeCurrentPage * pageSize, totalRecords)}</strong> / <strong>{totalRecords}</strong> mục
          </span>
          <label className={styles.tablePageSizeLabel}>
            <span>Hiển thị:</span>
            <select
              className={styles.tablePageSizeSelect}
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

        <div className={styles.tableFooterRight}>
          <div className={styles.tablePaginationGroup}>
            <button
              type="button"
              className={styles.tablePageBtn}
              disabled={safeCurrentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              title="Trang trước"
            >
              ← Trước
            </button>
            <span className={styles.tablePageIndicator}>
              {safeCurrentPage} / {totalPages}
            </span>
            <button
              type="button"
              className={styles.tablePageBtn}
              disabled={safeCurrentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              title="Trang sau"
            >
              Sau →
            </button>
          </div>
        </div>
      </div>

      {/* POPUP MODAL CHỈNH SỬA THÔNG TIN RECORD (CHUẨN MINIMAL POPUP FORM THEO SKILL UI-DESIGN) */}
      {editingItem ? (
        <div className={styles.modalOverlay} onClick={() => setEditingItem(null)}>
          <div
            className={styles.modalDialog}
            style={{
              maxWidth: '520px',
              background: '#f5f5f5',
              border: '1px solid #e0e0e0',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
              padding: '24px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header theo quy chuẩn Typography & Close Button */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                marginBottom: '16px',
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: '24px',
                    fontWeight: 700,
                    color: '#333333',
                    lineHeight: 1.25,
                  }}
                >
                  Cập nhật vật tư
                </h2>
                <p
                  style={{
                    margin: '4px 0 0',
                    fontSize: '13.5px',
                    color: '#666666',
                    lineHeight: 1.4,
                  }}
                >
                  Điều chỉnh mã SKU, tên hiển thị, loại danh mục và trạng thái kho bãi.
                </p>
              </div>
              <button
                type="button"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '32px',
                  height: '32px',
                  padding: 0,
                  border: 'none',
                  borderRadius: '4px',
                  background: 'transparent',
                  color: '#666666',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                }}
                onClick={() => setEditingItem(null)}
                aria-label="Đóng"
                title="Đóng (ESC)"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveEdit();
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
            >
              {/* Trường Mã vật tư */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '14px', fontWeight: 600, color: '#333333' }}>
                  Mã vật tư <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="VD: VT-001, MBA-01…"
                  value={editDraft.code}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '4px',
                    border: '1px solid #e0e0e0',
                    background: '#ffffff',
                    fontSize: '15px',
                    color: '#333333',
                    outline: 'none',
                  }}
                  onChange={(e) => setEditDraft((d) => ({ ...d, code: e.target.value }))}
                />
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Mã định danh duy nhất của vật tư trong hệ thống.
                </span>
              </div>

              {/* Trường Tên vật tư */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '14px', fontWeight: 600, color: '#333333' }}>
                  Tên vật tư <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="VD: Dầu biến áp, Máy cắt không khí…"
                  value={editDraft.name}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '4px',
                    border: '1px solid #e0e0e0',
                    background: '#ffffff',
                    fontSize: '15px',
                    color: '#333333',
                    outline: 'none',
                  }}
                  onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                />
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Tên gọi hiển thị trên danh mục và các biểu mẫu tác nghiệp.
                </span>
              </div>

              {/* Trường Loại danh mục */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '14px', fontWeight: 600, color: '#333333' }}>
                  Loại danh mục
                </label>
                <select
                  value={editDraft.type}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '4px',
                    border: '1px solid #e0e0e0',
                    background: '#ffffff',
                    fontSize: '15px',
                    color: '#333333',
                    outline: 'none',
                  }}
                  onChange={(e) => setEditDraft((d) => ({ ...d, type: e.target.value }))}
                >
                  <option value="">— Chưa phân loại —</option>
                  {withCurrent(types, editDraft.type).map((val) => (
                    <option key={val} value={val}>
                      {val}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Phân nhóm nghiệp vụ theo cấu hình danh mục của hệ thống.
                </span>
              </div>

              {/* Trạng thái vận hành & Vị trí kho (nếu không phải quản lý cá thể theo sê-ri) */}
              {!materialByCode?.get(editingItem.code)?.isSerialized ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#333333' }}>
                      Tình trạng vận hành
                    </label>
                    <select
                      value={editDraft.status}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '4px',
                        border: '1px solid #e0e0e0',
                        background: '#ffffff',
                        fontSize: '14.5px',
                        color: '#333333',
                        outline: 'none',
                      }}
                      onChange={(e) =>
                        setEditDraft((d) => ({ ...d, status: e.target.value as AssetStatus }))
                      }
                    >
                      <option value="">— Chưa xác định —</option>
                      {withCurrent(statuses, editDraft.status).map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#333333' }}>
                      Vị trí / Trạng thái kho
                    </label>
                    <select
                      value={editDraft.usageState}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '4px',
                        border: '1px solid #e0e0e0',
                        background: '#ffffff',
                        fontSize: '14.5px',
                        color: '#333333',
                        outline: 'none',
                      }}
                      onChange={(e) => setEditDraft((d) => ({ ...d, usageState: e.target.value }))}
                    >
                      <option value="">— Chưa xác định —</option>
                      {withCurrent(whereOptions, editDraft.usageState).map((wh) => (
                        <option key={wh} value={wh}>
                          {wh}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    padding: '10px 14px',
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '6px',
                    color: '#1e40af',
                    fontSize: '13px',
                    lineHeight: '1.45',
                  }}
                >
                  Vật tư này được quản lý theo số sê-ri cá thể. Tình trạng và vị trí được cập nhật trực tiếp theo từng số sê-ri trong chi tiết dòng.
                </div>
              )}

              {/* Footer Actions theo đúng Spacing và Màu sắc chuẩn của Minimal Popup Form */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: '12px',
                  marginTop: '8px',
                  paddingTop: '16px',
                  borderTop: '1px solid #e5e7eb',
                }}
              >
                <button
                  type="button"
                  style={{
                    padding: '9px 16px',
                    borderRadius: '4px',
                    border: '1px solid #d1d5db',
                    background: 'transparent',
                    color: '#4b5563',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  disabled={busy}
                  onClick={() => setEditingItem(null)}
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '9px 20px',
                    borderRadius: '4px',
                    border: 'none',
                    background: busy || !editDraft.code.trim() || !editDraft.name.trim() ? '#93c5fd' : '#2563eb',
                    color: '#ffffff',
                    fontSize: '14px',
                    fontWeight: 700,
                    cursor: busy || !editDraft.code.trim() || !editDraft.name.trim() ? 'not-allowed' : 'pointer',
                    transition: 'background 0.15s ease',
                  }}
                  disabled={busy || !editDraft.code.trim() || !editDraft.name.trim()}
                >
                  {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* DRAWER CHI TIẾT VẬT TƯ / THIẾT BỊ (ACTIONABLE DRAWER CONSOLE 680px CHUẨN THỦ KHO) */}
      {activeItem ? (
        <>
          <div
            className={styles.drawerBackdrop}
            onClick={() => setOpenCode(undefined)}
            aria-hidden="true"
          />
          <aside className={styles.drawerPanel} aria-label="Chi tiết vật tư và hành động thủ kho">
            {/* Header Drawer */}
            <div className={styles.drawerHead}>
              <div className={styles.drawerHeadInfo}>
                <div className={styles.drawerEyebrow}>
                  <Boxes size={13} strokeWidth={2.2} />
                  <span>Hồ sơ vận hành thiết bị · Thủ kho</span>
                </div>
                <h3 className={styles.drawerTitle}>{activeItem.name}</h3>
                <div className={styles.drawerSubtitle}>
                  <span>
                    Mã: <code>{activeItem.code}</code>
                  </span>
                  <span>·</span>
                  <span>
                    Loại:{' '}
                    <strong>
                      {activeItem.kind === 'ASSET' ? 'Thiết bị lắp đặt' : 'Vật tư trong kho'}
                    </strong>
                  </span>
                  {activeItem.unit ? (
                    <>
                      <span>·</span>
                      <span>
                        ĐVT: <strong>{activeItem.unit}</strong>
                      </span>
                    </>
                  ) : null}
                  {activeItem.status ? (
                    <>
                      <span>·</span>
                      <span className={`${styles.statusBadge} ${styles[`status_${activeItem.status}`]}`}>
                        {activeItem.status}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className={styles.drawerCloseBtn}
                onClick={() => setOpenCode(undefined)}
                aria-label="Đóng"
                title="Đóng (ESC)"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            {/* Dải thông tin vị trí lưu kho & định vị nhanh */}
            <div className={styles.drawerLocationBanner}>
              <MapPin size={15} color="#2563eb" style={{ flexShrink: 0 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', flex: 1 }}>
                <span>Vị trí lưu kho:</span>
                <strong>
                  {activeItem.installedAtName
                    ? `Lắp tại: ${activeItem.installedAtName}`
                    : activeLocationIds.length > 0
                      ? activeLocationIds.join(', ')
                      : 'Chưa có dữ liệu vị trí từ API'}
                </strong>
              </div>
            </div>

            {/* Hệ thống Sub-Tabs: 1. Vị trí & Kho, 2. Cá thể Sê-ri HOẶC Quản lý theo Lô (nếu có), 3. Thẻ kho & N-X-T, 4. Kiểm kê */}
            <div className={styles.drawerTabs} role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={drawerTab === 'storage'}
                className={`${styles.drawerTabBtn} ${drawerTab === 'storage' ? styles.drawerTabBtnActive : ''}`}
                onClick={() => setDrawerTab('storage')}
              >
                <MapPin size={14} />
                <span>1. Vị trí & Kho</span>
              </button>

              {/* Tab 2: Chỉ hiển thị 1 trong 2 hình thức (HOẶC Sê-ri, HOẶC Lô hàng), ẩn nếu là vật tư thông thường */}
              {activeTrackingType === 'SERIAL' ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={drawerTab === 'tracking'}
                  className={`${styles.drawerTabBtn} ${drawerTab === 'tracking' ? styles.drawerTabBtnActive : ''}`}
                  onClick={() => setDrawerTab('tracking')}
                >
                  <QrCode size={14} />
                  <span>2. Cá thể Sê-ri</span>
                </button>
              ) : activeTrackingType === 'LOT' ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={drawerTab === 'tracking'}
                  className={`${styles.drawerTabBtn} ${drawerTab === 'tracking' ? styles.drawerTabBtnActive : ''}`}
                  onClick={() => setDrawerTab('tracking')}
                >
                  <Layers size={14} />
                  <span>2. Quản lý theo Lô</span>
                </button>
              ) : null}

              <button
                type="button"
                role="tab"
                aria-selected={drawerTab === 'ledger'}
                className={`${styles.drawerTabBtn} ${drawerTab === 'ledger' ? styles.drawerTabBtnActive : ''}`}
                onClick={() => setDrawerTab('ledger')}
              >
                <Clock size={14} />
                <span>{activeTrackingType !== 'NONE' ? '3' : '2'}. Thẻ kho & N-X-T</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={drawerTab === 'stocktaking'}
                className={`${styles.drawerTabBtn} ${drawerTab === 'stocktaking' ? styles.drawerTabBtnActive : ''}`}
                onClick={() => setDrawerTab('stocktaking')}
              >
                <ClipboardCheck size={14} />
                <span>{activeTrackingType !== 'NONE' ? '4' : '3'}. Kiểm kê</span>
              </button>
            </div>

            {/* Nội dung theo Tab đang chọn */}
            <div className={styles.drawerBody}>
              {/* TAB 1: TỔNG QUAN & VỊ TRÍ LƯU TRỮ */}
              {drawerTab === 'storage' ? (
                <>
                  {/* Vị trí lưu trữ từ tồn kho API */}
                  <div className={styles.binCoordinateBox}>
                    <div className={styles.binCoordinateDetail}>
                      <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#1e40af' }}>
                        Định vị ngăn lưu trữ (Bin Location)
                      </span>
                      <div className={styles.binCoordinatePath}>
                        {activeItem.installedAtName
                          ? `Lắp tại: ${activeItem.installedAtName}`
                          : activeLocationIds.length > 0
                            ? activeLocationIds.join(', ')
                            : 'Chưa có dữ liệu vị trí từ API'}
                      </div>
                    </div>
                  </div>

                  {/* Phân bố tồn kho thực tế */}
                  <div className={styles.drawerSection}>
                    <h4 className={styles.drawerSectionTitle}>
                      <span>Tồn kho theo từng kho vật lý</span>
                      <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 400 }}>
                        Tổng sở hữu: <strong>{formatNumber(onHand(activeItem) + inUse(activeItem))}</strong> {activeItem.unit ?? ''}
                      </span>
                    </h4>
                    {(stockByCode.get(activeItem.code) ?? []).length > 0 ? (
                      <div className={styles.drawerStockGrid}>
                        {(stockByCode.get(activeItem.code) ?? []).map((row) => (
                          <div key={row.id} className={styles.drawerStockCard}>
                            <span className={styles.drawerStockWarehouse}>{row.warehouseCode}</span>
                            <span className={styles.drawerStockQty}>
                              {formatNumber(row.quantity)} {activeItem.unit ?? ''}
                            </span>
                            <div className={styles.drawerStockMeta}>
                              <span>Giữ chỗ: {formatNumber(row.quantityReserved)}</span>
                              <span>
                                Khả dụng: <strong>{formatNumber(row.available)}</strong>
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className={styles.muted}>Chưa ghi nhận tồn kho ở kho nào.</p>
                    )}
                  </div>

                  {/* Tình trạng bảo quản & Quy chuẩn an toàn */}
                  <div className={styles.drawerSection}>
                    <h4 className={styles.drawerSectionTitle}>Tình trạng bảo quản & Dự phòng</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                      <div className={styles.drawerStockCard}>
                        <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>NGƯỠNG TỒN AN TOÀN (MIN/MAX)</span>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                          <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                            {activeMaterial ? formatNumber(activeMaterial.minStock) : 'Chưa có dữ liệu'} {activeItem.unit ?? ''}
                          </span>
                          {activeMaterial ? (
                            <span style={{ fontSize: '11px', color: onHand(activeItem) < activeMaterial.minStock ? '#dc2626' : '#16a34a' }}>
                              ({onHand(activeItem) < activeMaterial.minStock ? 'Dưới ngưỡng' : 'Đạt mức an toàn'})
                            </span>
                          ) : null}
                        </div>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>
                          Ngưỡng được lấy từ cấu hình vật tư và đối chiếu với tồn thực tế.
                        </span>
                      </div>
                      <div className={styles.drawerStockCard}>
                        <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>LỊCH BẢO QUẢN ĐỊNH KỲ</span>
                        {activeMaintenance?.length ? activeMaintenance.map((schedule) => (
                          <div key={schedule.id} style={{ fontSize: '12px', color: '#334155' }}>
                            <strong>{schedule.title}</strong>
                            <span> · {schedule.frequency}</span>
                            {schedule.nextDueAt ? (
                              <span> · Kỳ tiếp theo: {new Date(schedule.nextDueAt).toLocaleDateString('vi-VN')}</span>
                            ) : null}
                          </div>
                        )) : (
                          <span style={{ fontSize: '11px', color: '#64748b' }}>
                            Chưa có lịch bảo trì từ API.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              {/* TAB 2: QUẢN LÝ SÊ-RI HOẶC QUẢN LÝ THEO LÔ (CHỈ 1 TRONG 2 TUỲ LOẠI VẬT TƯ) */}
              {drawerTab === 'tracking' && activeTrackingType !== 'NONE' ? (
                <div className={styles.drawerSection}>
                  {activeTrackingType === 'SERIAL' && activeMaterial ? (
                    <SerialPanel
                      material={activeMaterial}
                      statuses={statuses}
                      usageStates={usageStates}
                      busy={busy}
                    />
                  ) : activeTrackingType === 'LOT' ? (
                    <LotPanel
                      materialCode={activeItem.code}
                      materialName={activeItem.name}
                      unit={activeItem.unit}
                      warehouses={warehouses}
                      busy={busy}
                    />
                  ) : (
                    <p className={styles.empty}>Mục này quản lý theo số lượng thông thường, không có Lô hay Sê-ri.</p>
                  )}
                </div>
              ) : null}

              {/* TAB N-X-T & THẺ KHO */}
              {drawerTab === 'ledger' ? (
                <>
                  {/* Lịch sử dòng tiền / sổ cái */}
                  <div className={styles.drawerSection}>
                    <MaterialHistory
                      state={history[activeItem.code]}
                      unit={activeItem.unit}
                      warehouseCodeById={warehouseCodeById}
                    />
                  </div>
                </>
              ) : null}

              {/* TAB 3: KIỂM KÊ & ĐỐI SOÁT GẦN NHẤT (STOCKTAKING & VARIANCE) */}
              {drawerTab === 'stocktaking' ? (
                <div className={styles.drawerSection}>
                  <MaterialStocktakePanel
                    stocktakeState={rawStocktake}
                    unit={activeItem.unit}
                  />
                </div>
              ) : null}


            </div>

            {/* STICKY ACTION FOOTER (CỐ ĐỊNH DƯỚI ĐÁY DRAWER CHUẨN THỦ KHO) */}
            <div className={styles.drawerFooter}>


              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {activeMaterial && activeMaterial.isActive !== false && onRetire ? (
                  <Popconfirm
                    title="Ngừng sử dụng vật tư?"
                    description={`Vật tư "${activeMaterial.name}" (${activeMaterial.code}) sẽ chuyển sang trạng thái ngừng dùng. Lịch sử giao dịch và dữ liệu kho vẫn được lưu trữ đầy đủ.`}
                    okText="Ngừng dùng"
                    cancelText="Huỷ"
                    okType="danger"
                    placement="top-end"
                    disabled={busy}
                    onConfirm={() => {
                      setOpenCode(undefined);
                      onRetire(activeMaterial);
                    }}
                  >
                    <button
                      type="button"
                      className={`${styles.drawerActionBtn} ${styles.drawerActionBtnDanger}`}
                      disabled={busy}
                      title="Ngừng sử dụng mã vật tư này"
                    >
                      <Ban size={14} />
                      <span>Ngừng dùng</span>
                    </button>
                  </Popconfirm>
                ) : null}
                <button
                  type="button"
                  className={styles.modalCancelBtn}
                  onClick={() => setOpenCode(undefined)}
                >
                  Đóng
                </button>
              </div>
            </div>
          </aside>
        </>
      ) : null}

      {/* MODAL IN TEM NHÃN QR CODE KHỔ 50x30MM */}
      {showQrPrintModal && activeItem ? (
        <div className={styles.modalOverlay} onClick={() => setShowQrPrintModal(false)}>
          <div
            className={styles.modalDialog}
            style={{
              maxWidth: '460px',
              background: '#ffffff',
              borderRadius: '10px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              padding: '20px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                Xem trước tem nhãn dán thiết bị (50×30mm)
              </h3>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setShowQrPrintModal(false)}
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            {/* Tem mẫu chuẩn in ấn */}
            <div
              style={{
                border: '2px dashed #94a3b8',
                borderRadius: '6px',
                padding: '14px',
                background: '#fafafa',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                marginBottom: '16px',
              }}
            >
              <div style={{ width: '80px', height: '80px', background: '#fff', border: '1px solid #ccc', padding: '4px' }}>
                <svg viewBox="0 0 100 100" width="70" height="70">
                  <rect width="100" height="100" fill="#ffffff" />
                  <rect x="5" y="5" width="28" height="28" fill="#0f172a" />
                  <rect x="9" y="9" width="20" height="20" fill="#ffffff" />
                  <rect x="13" y="13" width="12" height="12" fill="#0f172a" />
                  <rect x="67" y="5" width="28" height="28" fill="#0f172a" />
                  <rect x="71" y="9" width="20" height="20" fill="#ffffff" />
                  <rect x="75" y="13" width="12" height="12" fill="#0f172a" />
                  <rect x="5" y="67" width="28" height="28" fill="#0f172a" />
                  <rect x="9" y="71" width="20" height="20" fill="#ffffff" />
                  <rect x="13" y="75" width="12" height="12" fill="#0f172a" />
                  <rect x="40" y="40" width="20" height="20" fill="#2563eb" />
                </svg>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1 }}>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>
                  ENTERPRISE PLATFORM · KHO
                </span>
                <strong style={{ fontSize: '14px', color: '#0f172a' }}>{activeItem.code}</strong>
                <span style={{ fontSize: '11.5px', color: '#334155', fontWeight: 600, lineHeight: 1.2 }}>
                  {activeItem.name}
                </span>
                <span style={{ fontSize: '10.5px', color: '#2563eb', fontWeight: 600 }}>
                  Vị trí: {activeItem.installedAtName
                    ? `Lắp tại: ${activeItem.installedAtName}`
                    : activeLocationIds.length > 0
                      ? activeLocationIds.join(', ')
                      : 'Chưa có dữ liệu vị trí'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className={styles.modalCancelBtn}
                onClick={() => setShowQrPrintModal(false)}
              >
                Đóng
              </button>
              <button
                type="button"
                className={`${styles.drawerActionBtn} ${styles.drawerActionBtnPrimary}`}
                onClick={() => {
                  window.print();
                  setShowQrPrintModal(false);
                }}
              >
                <Printer size={15} />
                <span>In ra máy in tem</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
