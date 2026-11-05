'use client';

import type {
  AssetStatus,
  InstalledMaterial,
  InventoryItem,
  Material,
  MaterialInventory,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { formatNumber } from '../inventory-labels';
import {
  loadMaintenanceSchedulesForAsset,
  loadMaterialHistory,
  type InventoryLedgerRow,
  type MaintenanceScheduleSummary,
  type InventoryWorkspace,
} from '../inventory-api';
import { MaterialHistory } from './material-history';
import { exportCatalogToExcel } from '../inventory-export';
import type { MovementLineItem } from './movement-form';
import {
  Search,
  X,
  MapPin,
  Clock,
  ClipboardCheck,
  Printer,
  Boxes,
  Ban,
  Download,
  Upload,
  ArrowLeftRight,
  Pencil,
  CheckCircle2,
} from 'lucide-react';
import { Popconfirm, formatDate, SearchableSelect } from '@enterprise-platform/shared-ui';
import styles from '../inventory.module.scss';

/**
 * Nhãn phân loại nói theo TRẠNG THÁI, không theo "loại vật tư".
 *
 * Thiết bị và phụ tùng đều là vật tư — cùng một bảng, cùng một khái niệm. Khác
 * nhau ở chỗ nó đang nằm trong kho hay đã lắp vào một vị trí. Gọi tên theo trạng
 * thái thì người đọc không phải học thêm hai từ mới cho cùng một thứ.
 */


/**
 * Giải thích bốn con số tồn (INV-07, mục 10 BRD). Không có cột "đang vận chuyển"
 * ở MVP (quyết định Q2).
 */
const STOCK_COLUMN_TIP = {
  onHand: 'Tồn thực tế: số hàng đang nằm trong kho theo sổ, gồm cả phần đã giữ và hàng chưa Đạt.',
  reserved: 'Đã giữ: phần tồn đã giữ cho đơn bán hoặc lệnh công tác, chưa xuất kho.',
  blocked:
    'Chờ kiểm định/không đạt: hàng ở trạng thái Cách ly, Lỗi hoặc Chờ kiểm định; vẫn trong kho nhưng không được xuất.',
  available: 'Khả dụng = tồn thực tế − đã giữ − chờ kiểm định/không đạt; là số còn bán hoặc xuất được.',
} as const;

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
  onOpenBulkImport,
  onOpenMovement,
  onOpenStocktake,
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
  /** Mở hộp thoại import Excel bổ sung dữ liệu đa kho */
  onOpenBulkImport?: () => void;
  /** Mở nhanh form tác nghiệp kho (xuất kho, chuyển kho...) */
  onOpenMovement?: (init: {
    kind?: 'receipt' | 'issue' | 'transfer' | 'adjust';
    materialCode?: string;
    openExcelImport?: boolean;
    initialItems?: readonly MovementLineItem[];
  }) => void;
  /** Chuyển sang sub-tab kiểm đếm kho hoặc mở form kiểm đếm */
  onOpenStocktake?: (init?: {
    warehouseCode?: string;
    selectedMaterials?: readonly InventoryItem[];
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

  const handleStartEdit = (item: InventoryItem, event?: React.MouseEvent) => {
    event?.stopPropagation();
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

  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [query, setQuery] = useState(initialQuery ?? '');

  // Đồng bộ khi bên ngoài đổi mã cần tìm — bấm một mã khác trên dải cảnh báo
  // phải đổi bộ lọc, không phải giữ nguyên mã cũ.
  useEffect(() => {
    if (initialQuery !== undefined) setQuery(initialQuery);
  }, [initialQuery]);

  const warehouseOptions = useMemo(() => {
    return [
      { value: 'all', label: 'Tất cả vị trí kho' },
      ...warehouses.map((wh) => ({
        value: wh.code,
        label: wh.name ? `${wh.name} (${wh.code})` : wh.code,
      })),
    ];
  }, [warehouses]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>(types);
    for (const item of items) {
      if (item.type) set.add(item.type);
    }
    return [
      { value: 'all', label: 'Tất cả nhóm vật tư' },
      ...Array.from(set).map((t) => ({ value: t, label: t })),
    ];
  }, [types, items]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      // 1. Lọc theo vị trí kho
      if (warehouseFilter !== 'all') {
        const matchingStock = stockByCode.get(item.code);
        const hasStockInWh = matchingStock?.some(
          (s) => s.warehouseCode === warehouseFilter && s.quantity > 0,
        );
        const matchesUsage = item.usageState === warehouseFilter;
        const matchesInstalled = (item.installedAtName ?? '').toLowerCase().includes(warehouseFilter.toLowerCase());
        if (!hasStockInWh && !matchesUsage && !matchesInstalled) {
          return false;
        }
      }

      // 2. Lọc theo nhóm vật tư
      if (typeFilter !== 'all') {
        if (item.type !== typeFilter) {
          return false;
        }
      }

      // 3. Tìm kiếm theo mã hoặc tên hàng hoặc vị trí
      if (!needle) return true;
      return (
        item.code.toLowerCase().includes(needle) ||
        item.name.toLowerCase().includes(needle) ||
        (item.installedAtName ?? '').toLowerCase().includes(needle) ||
        (item.usageState ?? '').toLowerCase().includes(needle)
      );
    });
  }, [items, warehouseFilter, typeFilter, query, stockByCode]);

  /** Tồn thực cộng qua mọi kho của một mã. */
  const onHand = (item: InventoryItem) =>
    (stockByCode.get(item.code) ?? []).reduce((sum, row) => sum + row.quantity, 0);
  const reserved = (item: InventoryItem) =>
    (stockByCode.get(item.code) ?? []).reduce((sum, row) => sum + row.quantityReserved, 0);
  /** Phần tồn không Đạt (Cách ly, Lỗi, Chờ kiểm định): có trong kho nhưng không được xuất. */
  const blocked = (item: InventoryItem) =>
    (stockByCode.get(item.code) ?? []).reduce((sum, row) => sum + (row.quantityBlocked ?? 0), 0);
  /** Khả dụng = thực tế − đã giữ − không Đạt; lấy cột `available` server tính sẵn. */
  const available = (item: InventoryItem) =>
    (stockByCode.get(item.code) ?? []).reduce((sum, row) => sum + row.available, 0);

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

  // Checkbox multi-select state
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());

  const totalRecords = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, safeCurrentPage, pageSize]);

  const allRowsSelected = useMemo(() => {
    if (rows.length === 0) return false;
    return rows.every((r) => selectedCodes.has(r.code));
  }, [rows, selectedCodes]);

  const someRowsSelected = useMemo(() => {
    return rows.some((r) => selectedCodes.has(r.code));
  }, [rows, selectedCodes]);

  const toggleSelectAll = () => {
    if (allRowsSelected) {
      setSelectedCodes(new Set());
    } else {
      setSelectedCodes(new Set(rows.map((r) => r.code)));
    }
  };

  const toggleSelectItem = (code: string) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const getSelectedLineItems = (targetKind: 'receipt' | 'issue'): MovementLineItem[] => {
    const selectedList = items.filter((i) => selectedCodes.has(i.code));
    const whCode =
      warehouseFilter !== 'all'
        ? warehouseFilter
        : warehouses[0]?.code || '';

    return selectedList.map((item, idx) => {
      const onHandQty = onHand(item);
      const defaultQty = targetKind === 'issue' ? (onHandQty > 0 ? 1 : 0) : 1;
      return {
        id: `item-${Date.now()}-${idx}`,
        materialCode: item.code,
        materialName: item.name,
        materialType: item.type,
        unit: item.unit || 'Cái',
        warehouseCode: whCode,
        quantity: defaultQty,
        unitCost: undefined,
        serialNumbers: [],
        lineNote: '',
      };
    });
  };

  const handleOpenMovementWithSelected = (targetKind: 'receipt' | 'issue') => {
    if (!onOpenMovement) return;
    const lineItems = getSelectedLineItems(targetKind);
    onOpenMovement({
      kind: targetKind,
      initialItems: lineItems,
    });
  };

  const handleOpenStocktakeWithSelected = () => {
    if (!onOpenStocktake) return;
    const selectedList = items.filter((i) => selectedCodes.has(i.code));
    const whCode = warehouseFilter !== 'all' ? warehouseFilter : warehouses[0]?.code;
    onOpenStocktake({
      warehouseCode: whCode,
      selectedMaterials: selectedList,
    });
  };

  const activeItem = useMemo(
    () => (openCode ? items.find((i) => i.code === openCode) : undefined),
    [items, openCode],
  );
  const activeMaterial = useMemo(
    () => (activeItem ? materialByCode?.get(activeItem.code) : undefined),
    [activeItem, materialByCode],
  );

  /** 2 Sub-Tabs cho Actionable Drawer: 1. Số lượng ở từng kho, 2. Lịch sử xuất nhập kho */
  type DrawerTab = 'storage' | 'ledger';
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('storage');

  const [maintenanceSchedules, setMaintenanceSchedules] = useState<
    Record<string, MaintenanceScheduleSummary[] | 'loading' | 'error'>
  >({});

  /** Modal in tem QR code khổ 50x30mm */
  const [showQrPrintModal, setShowQrPrintModal] = useState(false);

  // Reset tab và nạp thông tin phụ trợ khi đổi mã vật tư được chọn
  useEffect(() => {
    if (!openCode) return;
    setDrawerTab('storage');

    setMaintenanceSchedules((current) => {
      if (openCode in current) return current;
      loadMaintenanceSchedulesForAsset(openCode)
        .then((rows) =>
          setMaintenanceSchedules((prev) => ({
            ...prev,
            [openCode]: rows ?? [],
          })),
        )
        .catch(() => setMaintenanceSchedules((prev) => ({ ...prev, [openCode]: 'error' })));
      return { ...current, [openCode]: 'loading' };
    });
  }, [openCode]);

  const activeStockRows = activeItem ? stockByCode.get(activeItem.code) ?? [] : [];
  const activeLocationIds = activeStockRows
    .map((row) => row.locationId)
    .filter((locationId): locationId is string => Boolean(locationId));
  const rawMaintenance = activeItem ? maintenanceSchedules[activeItem.code] : undefined;
  const activeMaintenance: MaintenanceScheduleSummary[] | undefined =
    Array.isArray(rawMaintenance) ? rawMaintenance : undefined;

  const handleExport = () => {
    exportCatalogToExcel({
      items: rows,
      materialByCode,
      stockByCode,
      installed,
      warehouses,
      warehouseFilter,
    });
  };

  return (
    <section id="inventory-item-catalog" className={styles.standardTableCard}>
      {/* VÙNG 1: HEADER CONTROLS (TÌM KIẾM -> BỘ LỌC VỊ TRÍ KHO, NHÓM VẬT TƯ -> CÁC NÚT THAO TÁC) */}
      <div className={styles.tableControlsBar}>
        <div className={styles.tableControlsLeft} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* 1. Ô Tìm kiếm */}
          <div className={styles.tableSearchBox}>
            <span className={styles.tableSearchIcon}>
              <Search size={14} strokeWidth={2} />
            </span>
            <input
              type="search"
              placeholder="Tìm theo mã hoặc tên hàng…"
              value={query}
              aria-label="Tìm vật tư"
              onChange={(event) => {
                setQuery(event.target.value);
                setCurrentPage(1);
              }}
            />
          </div>

          {/* 2. Bộ lọc theo vị trí kho */}
          <div style={{ minWidth: '180px' }}>
            <SearchableSelect
              value={warehouseFilter}
              onChange={(val) => {
                setWarehouseFilter(val);
                setCurrentPage(1);
              }}
              options={warehouseOptions}
              clearable={false}
              placeholder="Vị trí kho"
            />
          </div>

          {/* 3. Bộ lọc theo nhóm vật tư */}
          {typeOptions.length > 1 ? (
            <div style={{ minWidth: '180px' }}>
              <SearchableSelect
                value={typeFilter}
                onChange={(val) => {
                  setTypeFilter(val);
                  setCurrentPage(1);
                }}
                options={typeOptions}
                clearable={false}
                placeholder="Nhóm vật tư"
              />
            </div>
          ) : null}

          {/* Nút Xoá lọc */}
          {query || warehouseFilter !== 'all' || typeFilter !== 'all' ? (
            <button
              type="button"
              className={styles.tableResetBtn}
              title="Xóa bộ lọc"
              onClick={() => {
                setQuery('');
                setWarehouseFilter('all');
                setTypeFilter('all');
                setCurrentPage(1);
              }}
            >
              Xoá lọc
            </button>
          ) : null}
        </div>

        {/* Cụm nút Thao tác bên phải: Xuất file, Import file, Xuất nhập kho, Kiểm đếm */}
        <div className={styles.tableControlsRight} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={styles.btnSecondary}
            style={{
              padding: '7px 12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              fontSize: '13px',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
            }}
            onClick={handleExport}
            title="Xuất dữ liệu tồn kho chuẩn ra tệp Excel (phục vụ quản kho, sao lưu và chuyển giao hệ thống)"
            disabled={busy}
          >
            <Download size={14} />
            <span>Xuất file</span>
          </button>

          {onOpenBulkImport || onOpenMovement ? (
            <button
              type="button"
              className={styles.btnSecondary}
              style={{
                padding: '7px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#334155',
                fontSize: '13px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              }}
              onClick={() => {
                if (onOpenBulkImport) {
                  onOpenBulkImport();
                } else if (onOpenMovement) {
                  onOpenMovement({ kind: 'receipt', openExcelImport: true });
                }
              }}
              title="Nhập danh sách vật tư bổ sung từ tệp Excel (hỗ trợ nhiều kho)"
              disabled={busy}
            >
              <Upload size={14} />
              <span>Import file</span>
            </button>
          ) : null}

          {onOpenMovement ? (
            <button
              type="button"
              className={styles.btnSecondary}
              style={{
                padding: '7px 14px',
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
                boxShadow: '0 1px 2px rgba(37, 99, 235, 0.2)',
              }}
              onClick={() => {
                if (selectedCodes.size > 0) {
                  handleOpenMovementWithSelected('receipt');
                } else {
                  onOpenMovement({ kind: 'receipt' });
                }
              }}
              title={
                selectedCodes.size > 0
                  ? `Mở form xuất nhập kho với ${selectedCodes.size} vật tư đã chọn`
                  : 'Mở form tạo phiếu xuất hoặc nhập kho'
              }
              disabled={busy}
            >
              <ArrowLeftRight size={14} />
              <span>
                {selectedCodes.size > 0
                  ? `Xuất nhập kho (${selectedCodes.size})`
                  : 'Xuất nhập kho'}
              </span>
            </button>
          ) : null}

          {onOpenStocktake ? (
            <button
              type="button"
              className={styles.btnSecondary}
              style={{
                padding: '7px 12px',
                borderRadius: '6px',
                border: selectedCodes.size > 0 ? '1px solid #c4b5fd' : '1px solid #cbd5e1',
                background: selectedCodes.size > 0 ? '#faf5ff' : '#ffffff',
                color: selectedCodes.size > 0 ? '#6b21a8' : '#0f172a',
                fontSize: '13px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              }}
              onClick={handleOpenStocktakeWithSelected}
              title={
                selectedCodes.size > 0
                  ? `Tạo đợt kiểm đếm cho ${selectedCodes.size} vật tư đã chọn`
                  : 'Khởi tạo đợt kiểm kê kho và đối soát sổ sách'
              }
              disabled={busy}
            >
              <ClipboardCheck size={14} />
              <span>
                {selectedCodes.size > 0 ? `Kiểm đếm (${selectedCodes.size})` : 'Kiểm đếm'}
              </span>
            </button>
          ) : null}
        </div>
      </div>

      {/* THANH TÁC VỤ KHI CÓ DÒNG ĐƯỢC CHỌN (SELECTION ACTION BAR) */}
      {selectedCodes.size > 0 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '9px 14px',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '6px',
            margin: '0 0 10px 0',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#1e40af', fontSize: '13px', fontWeight: 600, flexWrap: 'wrap' }}>
            <CheckCircle2 size={16} color="#2563eb" />
            <span>
              Đã chọn <strong>{selectedCodes.size}</strong> {selectedCodes.size === rows.length ? '(toàn bộ danh sách)' : `/ ${rows.length}`} vật tư
            </span>
            {selectedCodes.size < rows.length ? (
              <button
                type="button"
                onClick={() => setSelectedCodes(new Set(rows.map((r) => r.code)))}
                style={{
                  border: 'none',
                  background: 'none',
                  color: '#2563eb',
                  fontSize: '13px',
                  fontWeight: 600,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  padding: 0,
                  marginLeft: '4px',
                }}
              >
                Chọn toàn bộ {rows.length} vật tư
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setSelectedCodes(new Set())}
              style={{
                border: 'none',
                background: 'none',
                color: '#64748b',
                fontSize: '13px',
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: 0,
                marginLeft: '4px',
              }}
            >
              Bỏ chọn tất cả
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid #93c5fd',
                background: '#ffffff',
                color: '#1d4ed8',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              onClick={() => handleOpenMovementWithSelected('issue')}
              title="Điền các vật tư đã chọn vào phiếu Xuất kho"
            >
              <span>Xuất kho ({selectedCodes.size})</span>
            </button>

            <button
              type="button"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid #86efac',
                background: '#f0fdf4',
                color: '#15803d',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              onClick={() => handleOpenMovementWithSelected('receipt')}
              title="Điền các vật tư đã chọn vào phiếu Nhập kho"
            >
              <span>Nhập kho ({selectedCodes.size})</span>
            </button>

            <button
              type="button"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid #c4b5fd',
                background: '#faf5ff',
                color: '#6b21a8',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              onClick={handleOpenStocktakeWithSelected}
              title="Khởi tạo đợt kiểm đếm với các vật tư đã chọn"
            >
              <ClipboardCheck size={14} />
              <span>Kiểm đếm ({selectedCodes.size})</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* VÙNG 2: THÂN BẢNG DỮ LIỆU CÓ CHECKBOX + 6 CỘT: MÃ - TÊN HÀNG - VỊ TRÍ - ĐƠN VỊ TÍNH - SỐ LƯỢNG - THUỘC NHÓM */}
      <div className={styles.tableResponsiveWrap}>
        <table className={styles.standardTable}>
          <thead>
            <tr>
              <th style={{ width: '44px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={allRowsSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someRowsSelected && !allRowsSelected;
                  }}
                  onChange={toggleSelectAll}
                  style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: '#2563eb' }}
                  title={allRowsSelected ? 'Bỏ chọn toàn bộ' : `Chọn toàn bộ ${rows.length} vật tư trong bảng`}
                />
              </th>
              <th style={{ width: '220px' }}>Mã</th>
              <th style={{ minWidth: '240px' }}>Tên hàng</th>
              <th style={{ width: '170px' }}>Vị trí</th>
              <th style={{ width: '100px' }} className={styles.center}>Đơn vị tính</th>
              <th style={{ width: '110px' }} className={styles.center}>Số lượng</th>
              <th style={{ width: '150px' }}>Thuộc nhóm</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((item) => {
              const expanded = openCode === item.code;
              const isSelected = selectedCodes.has(item.code);
              const locationText =
                item.installedAtName ||
                item.usageState ||
                (stockByCode
                  .get(item.code)
                  ?.filter((s) => s.quantity > 0)
                  .map((s) => s.warehouseCode)
                  .filter(Boolean)
                  .join(', ') || '—');

              return (
                <Fragment key={item.code}>
                  <tr
                    className={`${styles.clickable} ${expanded ? styles.tableRowActive : ''}`}
                    style={{
                      background: isSelected ? '#eff6ff' : undefined,
                    }}
                    onClick={busy ? undefined : () => open(item.code)}
                    title="Bấm để xem chi tiết vật tư"
                  >
                    <td
                      style={{ textAlign: 'center', width: '44px' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectItem(item.code)}
                        style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: '#2563eb' }}
                      />
                    </td>
                    <td className={styles.code} title={item.code}>
                      <strong className={styles.codeLabel}>{item.code}</strong>
                    </td>
                    <td title={item.name} style={{ wordBreak: 'break-word' }}>
                      <span style={{ fontWeight: 600, color: '#1e293b' }}>{item.name}</span>
                    </td>
                    <td>
                      {locationText !== '—' ? (
                        <span className={styles.locationTag} title={locationText}>{locationText}</span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={styles.center} style={{ color: '#475569', fontWeight: 500 }}>
                      {item.unit || '—'}
                    </td>
                    <td
                      className={`${styles.numeric} ${styles.center}`}
                      title={`${STOCK_COLUMN_TIP.onHand}
${STOCK_COLUMN_TIP.reserved} (${formatNumber(reserved(item))})
${STOCK_COLUMN_TIP.blocked} (${formatNumber(blocked(item))})
${STOCK_COLUMN_TIP.available} (${formatNumber(available(item))})`}
                    >
                      <strong style={{ color: onHand(item) > 0 ? '#0f172a' : '#94a3b8' }}>
                        {formatNumber(onHand(item))}
                      </strong>
                      {available(item) !== onHand(item) ? (
                        <span className={styles.sub}>khả dụng {formatNumber(available(item))}</span>
                      ) : null}
                    </td>
                    <td>
                      {item.type ? (
                        <span className={styles.typeBadge} title={item.type}>{item.type}</span>
                      ) : (
                        <span className={styles.muted}>
                          {item.kind === 'ASSET' ? 'Thiết bị' : 'Vật tư'}
                        </span>
                      )}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={7} className={styles.empty}>
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
          <div className={styles.tablePageSizeLabel} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span>Hiển thị:</span>
            <div style={{ width: '135px' }}>
              <SearchableSelect
                value={String(pageSize)}
                onChange={(val) => {
                  if (val) {
                    setPageSize(Number(val) || 15);
                    setCurrentPage(1);
                  }
                }}
                options={[
                  { label: '15 / trang', value: '15' },
                  { label: '30 / trang', value: '30' },
                  { label: '45 / trang', value: '45' },
                  { label: '60 / trang', value: '60' },
                ]}
                searchInDropdown={true}
                clearable={false}
                height={32}
              />
            </div>
          </div>
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
                    fontSize: '14px',
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
                    fontSize: '16px',
                    color: '#333333',
                    outline: 'none',
                  }}
                  onChange={(e) => setEditDraft((d) => ({ ...d, code: e.target.value }))}
                />
                <span style={{ fontSize: '13px', color: '#64748b' }}>
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
                    fontSize: '16px',
                    color: '#333333',
                    outline: 'none',
                  }}
                  onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                />
                <span style={{ fontSize: '13px', color: '#64748b' }}>
                  Tên gọi hiển thị trên danh mục và các biểu mẫu tác nghiệp.
                </span>
              </div>

              {/* Trường Loại danh mục */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '14px', fontWeight: 600, color: '#333333' }}>
                  Loại danh mục
                </label>
                <SearchableSelect
                  value={editDraft.type}
                  onChange={(val) => setEditDraft((d) => ({ ...d, type: val }))}
                  placeholder="— Chưa phân loại —"
                  options={[
                    { label: '— Chưa phân loại —', value: '' },
                    ...withCurrent(types, editDraft.type).map((val) => ({
                      label: val,
                      value: val,
                    })),
                  ]}
                />
                <span style={{ fontSize: '13px', color: '#64748b' }}>
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
                    <SearchableSelect
                      value={editDraft.status}
                      onChange={(val) =>
                        setEditDraft((d) => ({ ...d, status: val as AssetStatus }))
                      }
                      placeholder="— Chưa xác định —"
                      options={[
                        { label: '— Chưa xác định —', value: '' },
                        ...withCurrent(statuses, editDraft.status).map((st) => ({
                          label: st,
                          value: st,
                        })),
                      ]}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#333333' }}>
                      Vị trí / Trạng thái kho
                    </label>
                    <SearchableSelect
                      value={editDraft.usageState}
                      onChange={(val) => setEditDraft((d) => ({ ...d, usageState: val }))}
                      placeholder="— Chưa xác định —"
                      options={[
                        { label: '— Chưa xác định —', value: '' },
                        ...withCurrent(whereOptions, editDraft.usageState).map((wh) => ({
                          label: wh,
                          value: wh,
                        })),
                      ]}
                    />
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
                    fontSize: '14px',
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

              {/* Nút đóng trên Header Drawer */}
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

            {/* Hệ thống Sub-Tabs: 1. Số lượng ở từng kho, 2. Lịch sử xuất nhập kho */}
            <div className={styles.drawerTabs} role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={drawerTab === 'storage'}
                className={`${styles.drawerTabBtn} ${drawerTab === 'storage' ? styles.drawerTabBtnActive : ''}`}
                onClick={() => setDrawerTab('storage')}
              >
                <Boxes size={14} />
                <span>1. Số lượng ở từng kho</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={drawerTab === 'ledger'}
                className={`${styles.drawerTabBtn} ${drawerTab === 'ledger' ? styles.drawerTabBtnActive : ''}`}
                onClick={() => setDrawerTab('ledger')}
              >
                <Clock size={14} />
                <span>2. Lịch sử xuất nhập kho</span>
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
                      <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#1e40af' }}>
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
                      <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 400 }}>
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
                              <span title={STOCK_COLUMN_TIP.reserved}>Đã giữ: {formatNumber(row.quantityReserved)}</span>
                              {row.quantityBlocked ? (
                                <span title={STOCK_COLUMN_TIP.blocked}>
                                  Chờ kiểm định/không đạt: {formatNumber(row.quantityBlocked)}
                                </span>
                              ) : null}
                              <span title={STOCK_COLUMN_TIP.available}>
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
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>NGƯỠNG TỒN AN TOÀN (MIN/MAX)</span>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                          <span style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                            {activeMaterial ? formatNumber(activeMaterial.minStock) : 'Chưa có dữ liệu'} {activeItem.unit ?? ''}
                          </span>
                          {activeMaterial ? (
                            <span style={{ fontSize: '12px', color: onHand(activeItem) < activeMaterial.minStock ? '#dc2626' : '#16a34a' }}>
                              ({onHand(activeItem) < activeMaterial.minStock ? 'Dưới ngưỡng' : 'Đạt mức an toàn'})
                            </span>
                          ) : null}
                        </div>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>
                          Ngưỡng được lấy từ cấu hình vật tư và đối chiếu với tồn thực tế.
                        </span>
                      </div>
                      <div className={styles.drawerStockCard}>
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>LỊCH BẢO QUẢN ĐỊNH KỲ</span>
                        {activeMaintenance?.length ? activeMaintenance.map((schedule) => (
                          <div key={schedule.id} style={{ fontSize: '13px', color: '#334155' }}>
                            <strong>{schedule.title}</strong>
                            <span> · {schedule.frequency}</span>
                            {schedule.nextDueAt ? (
                              <span> · Kỳ tiếp theo: {formatDate(schedule.nextDueAt)}</span>
                            ) : null}
                          </div>
                        )) : (
                          <span style={{ fontSize: '12px', color: '#64748b' }}>
                            Chưa có lịch bảo trì từ API.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              {/* TAB 2: LỊCH SỬ XUẤT NHẬP KHO (SỔ CÁI & THẺ KHO) */}
              {drawerTab === 'ledger' ? (
                <div className={styles.drawerSection}>
                  <MaterialHistory
                    state={history[activeItem.code]}
                    unit={activeItem.unit}
                    warehouseCodeById={warehouseCodeById}
                  />
                </div>
              ) : null}
            </div>

            {/* STICKY ACTION FOOTER (CỐ ĐỊNH DƯỚI ĐÁY DRAWER CHUẨN THỦ KHO) */}
            <div className={styles.drawerFooter}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {onPatch ? (
                  <button
                    type="button"
                    style={{
                      padding: '8px 14px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontSize: '13px',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      cursor: 'pointer',
                    }}
                    onClick={() => handleStartEdit(activeItem)}
                    disabled={busy}
                    title="Sửa thông tin vật tư"
                  >
                    <Pencil size={14} />
                    <span>Sửa</span>
                  </button>
                ) : null}

                {activeMaterial && activeMaterial.isActive !== false && onRetire ? (
                  <Popconfirm
                    title="Ngừng sử dụng vật tư?"
                    description={`Vật tư "${activeMaterial.name}" (${activeMaterial.code}) sẽ chuyển sang trạng thái ngừng dùng. Lịch sử giao dịch và dữ liệu kho vẫn được lưu trữ đầy đủ.`}
                    okText="Ngừng dùng"
                    cancelText="Huỷ"
                    okType="danger"
                    placement="top-start"
                    disabled={busy}
                    onConfirm={() => {
                      setOpenCode(undefined);
                      onRetire(activeMaterial);
                    }}
                  >
                    <button
                      type="button"
                      style={{
                        padding: '8px 14px',
                        borderRadius: '6px',
                        border: '1px solid #fecaca',
                        background: '#fef2f2',
                        color: '#dc2626',
                        fontSize: '13px',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        cursor: 'pointer',
                      }}
                      disabled={busy}
                      title="Ngừng sử dụng mã vật tư này"
                    >
                      <Ban size={14} />
                      <span>Ngừng sử dụng</span>
                    </button>
                  </Popconfirm>
                ) : null}
              </div>

              <button
                type="button"
                className={styles.modalCancelBtn}
                onClick={() => setOpenCode(undefined)}
              >
                Đóng
              </button>
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
                <span style={{ fontSize: '12px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>
                  ENTERPRISE PLATFORM · KHO
                </span>
                <strong style={{ fontSize: '14px', color: '#0f172a' }}>{activeItem.code}</strong>
                <span style={{ fontSize: '12px', color: '#334155', fontWeight: 600, lineHeight: 1.2 }}>
                  {activeItem.name}
                </span>
                <span style={{ fontSize: '12px', color: '#2563eb', fontWeight: 600 }}>
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
