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
import { Popconfirm, formatDate, SearchableSelect, CloseGuard } from '@enterprise-platform/shared-ui';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableRow, TableWrap } from '../ui/table';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Sheet, SheetContent, SheetFooter, SheetHeader } from '../ui/sheet';

const TAB_BTN =
  'inline-flex cursor-pointer items-center gap-[0.4rem] whitespace-nowrap border-0 border-b-2 border-transparent bg-transparent px-[0.85rem] py-3 text-sm font-semibold text-slate-500 transition-all hover:text-slate-800';
const TAB_BTN_ACTIVE = 'border-primary text-slate-900 hover:text-slate-900';
const STOCK_CARD = 'flex flex-col gap-[0.35rem] rounded-lg border border-slate-200 bg-slate-50 px-4 py-[0.85rem]';

/** Màu chip tình trạng thiết bị (OPERATING, STOPPED, MAINTENANCE, DISPOSED). */
const ASSET_STATUS_BADGE: Readonly<Record<string, string>> = {
  OPERATING: 'border-green-200 bg-green-50 text-green-800',
  STOPPED: 'border-red-200 bg-red-50 text-red-800',
  MAINTENANCE: 'border-amber-200 bg-amber-50 text-amber-700',
  DISPOSED: 'border-slate-300 bg-slate-100 text-slate-500',
};

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

  const editIsDirty =
    editingItem !== null &&
    JSON.stringify(editDraft) !==
      JSON.stringify({
        code: editingItem.code,
        name: editingItem.name,
        type: editingItem.type ?? '',
        status: editingItem.status ?? '',
        usageState: editingItem.usageState ?? '',
      });

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
    <section
      id="inventory-item-catalog"
      className="flex w-full flex-col overflow-hidden rounded-[10px] border border-slate-200 bg-white"
    >
      {/* VÙNG 1: HEADER CONTROLS (TÌM KIẾM -> BỘ LỌC VỊ TRÍ KHO, NHÓM VẬT TƯ -> CÁC NÚT THAO TÁC) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* 1. Ô Tìm kiếm */}
          <div className="relative flex min-w-[180px] flex-[1_1_240px] items-center">
            <span className="pointer-events-none absolute left-[0.65rem] text-slate-400">
              <Search size={14} strokeWidth={2} />
            </span>
            <Input
              type="search"
              className="pl-8"
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
          <div className="min-w-[180px]">
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
            <div className="min-w-[180px]">
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
            <Button
              type="button"
              variant="outline"
              title="Xóa bộ lọc"
              onClick={() => {
                setQuery('');
                setWarehouseFilter('all');
                setTypeFilter('all');
                setCurrentPage(1);
              }}
            >
              Xoá lọc
            </Button>
          ) : null}
        </div>

        {/* Cụm nút Thao tác bên phải: Xuất file, Import file, Xuất nhập kho, Kiểm đếm */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleExport}
            title="Xuất dữ liệu tồn kho chuẩn ra tệp Excel (phục vụ quản kho, sao lưu và chuyển giao hệ thống)"
            disabled={busy}
          >
            <Download size={14} />
            <span>Xuất file</span>
          </Button>

          {onOpenBulkImport || onOpenMovement ? (
            <Button
              type="button"
              variant="outline"
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
            </Button>
          ) : null}

          {onOpenMovement ? (
            <Button
              type="button"
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
            </Button>
          ) : null}

          {onOpenStocktake ? (
            <Button
              type="button"
              variant="outline"
              className={cn(selectedCodes.size > 0 && 'border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100')}
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
            </Button>
          ) : null}
        </div>
      </div>

      {/* THANH TÁC VỤ KHI CÓ DÒNG ĐƯỢC CHỌN (SELECTION ACTION BAR) */}
      {selectedCodes.size > 0 ? (
        <div className="m-0 mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-3.5 py-[9px]">
          <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-blue-800">
            <CheckCircle2 size={16} className="text-blue-600" />
            <span>
              Đã chọn <strong>{selectedCodes.size}</strong> {selectedCodes.size === rows.length ? '(toàn bộ danh sách)' : `/ ${rows.length}`} vật tư
            </span>
            {selectedCodes.size < rows.length ? (
              <button
                type="button"
                onClick={() => setSelectedCodes(new Set(rows.map((r) => r.code)))}
                className="ml-1 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-blue-600 underline"
              >
                Chọn toàn bộ {rows.length} vật tư
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setSelectedCodes(new Set())}
              className="ml-1 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-normal text-slate-500 underline"
            >
              Bỏ chọn tất cả
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-blue-300 text-blue-700"
              onClick={() => handleOpenMovementWithSelected('issue')}
              title="Điền các vật tư đã chọn vào phiếu Xuất kho"
            >
              <span>Xuất kho ({selectedCodes.size})</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
              onClick={() => handleOpenMovementWithSelected('receipt')}
              title="Điền các vật tư đã chọn vào phiếu Nhập kho"
            >
              <span>Nhập kho ({selectedCodes.size})</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100"
              onClick={handleOpenStocktakeWithSelected}
              title="Khởi tạo đợt kiểm đếm với các vật tư đã chọn"
            >
              <ClipboardCheck size={14} />
              <span>Kiểm đếm ({selectedCodes.size})</span>
            </Button>
          </div>
        </div>
      ) : null}

      {/* VÙNG 2: THÂN BẢNG DỮ LIỆU CÓ CHECKBOX + 6 CỘT: MÃ - TÊN HÀNG - VỊ TRÍ - ĐƠN VỊ TÍNH - SỐ LƯỢNG - THUỘC NHÓM */}
      <TableWrap className="w-full">
        <Table className="min-w-[1100px] table-fixed">
          <TableHead>
            <TableRow className="hover:bg-slate-50">
              <TableHeaderCell className="w-[44px] text-center">
                <input
                  type="checkbox"
                  checked={allRowsSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someRowsSelected && !allRowsSelected;
                  }}
                  onChange={toggleSelectAll}
                  className="size-4 cursor-pointer accent-primary"
                  title={allRowsSelected ? 'Bỏ chọn toàn bộ' : `Chọn toàn bộ ${rows.length} vật tư trong bảng`}
                />
              </TableHeaderCell>
              <TableHeaderCell className="w-[220px]">Mã</TableHeaderCell>
              <TableHeaderCell className="min-w-[240px]">Tên hàng</TableHeaderCell>
              <TableHeaderCell className="w-[170px]">Vị trí</TableHeaderCell>
              <TableHeaderCell className="w-[100px] text-center">Đơn vị tính</TableHeaderCell>
              <TableHeaderCell className="w-[110px] text-center">Số lượng</TableHeaderCell>
              <TableHeaderCell className="w-[150px]">Thuộc nhóm</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
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
                  <TableRow
                    className={cn('cursor-pointer', (expanded || isSelected) && 'bg-primary/10 hover:bg-primary/10')}
                    onClick={busy ? undefined : () => open(item.code)}
                    title="Bấm để xem chi tiết vật tư"
                  >
                    <TableCell className="w-[44px] text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectItem(item.code)}
                        className="size-4 cursor-pointer accent-primary"
                      />
                    </TableCell>
                    <TableCell className="overflow-hidden text-ellipsis whitespace-nowrap" title={item.code}>
                      <strong className="inline-block max-w-full overflow-hidden align-middle font-mono text-sm font-bold text-ellipsis whitespace-nowrap text-slate-900">
                        {item.code}
                      </strong>
                    </TableCell>
                    <TableCell title={item.name} className="[word-break:break-word]">
                      <span className="font-semibold text-slate-800">{item.name}</span>
                    </TableCell>
                    <TableCell>
                      {locationText !== '—' ? (
                        <span className="inline-flex items-center gap-1 text-[0.8125rem] text-slate-600" title={locationText}>
                          {locationText}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-medium text-slate-600">{item.unit || '—'}</TableCell>
                    <TableCell
                      className="text-center tabular-nums"
                      title={`${STOCK_COLUMN_TIP.onHand}
${STOCK_COLUMN_TIP.reserved} (${formatNumber(reserved(item))})
${STOCK_COLUMN_TIP.blocked} (${formatNumber(blocked(item))})
${STOCK_COLUMN_TIP.available} (${formatNumber(available(item))})`}
                    >
                      <strong className={onHand(item) > 0 ? 'text-slate-900' : 'text-slate-400'}>
                        {formatNumber(onHand(item))}
                      </strong>
                      {available(item) !== onHand(item) ? (
                        <span className="mt-[0.2rem] block text-[0.8125rem] font-normal text-slate-500">
                          khả dụng {formatNumber(available(item))}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {item.type ? (
                        <span
                          className="inline-block rounded border border-slate-200 bg-slate-100 px-2 py-[0.15rem] text-[0.8125rem] font-semibold text-slate-700"
                          title={item.type}
                        >
                          {item.type}
                        </span>
                      ) : (
                        <span className="text-slate-500">{item.kind === 'ASSET' ? 'Thiết bị' : 'Vật tư'}</span>
                      )}
                    </TableCell>
                  </TableRow>
                </Fragment>
              );
            })}
            {paginatedRows.length === 0 ? (
              <TableEmpty colSpan={7}>Không có mục nào khớp bộ lọc tìm kiếm.</TableEmpty>
            ) : null}
          </TableBody>
        </Table>
      </TableWrap>

      {/* VÙNG 3: FOOTER CHÂN BẢNG (ĐỒNG BỘ CHUẨN WORKSPACE) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-500">
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-slate-500 [&_strong]:text-slate-900">
            Hiển thị <strong>{totalRecords > 0 ? (safeCurrentPage - 1) * pageSize + 1 : 0}–{Math.min(safeCurrentPage * pageSize, totalRecords)}</strong> / <strong>{totalRecords}</strong> mục
          </span>
          <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <span>Hiển thị:</span>
            <div className="w-[135px]">
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

        <div className="flex items-center">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safeCurrentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              title="Trang trước"
            >
              ← Trước
            </Button>
            <span className="px-1 text-[13px] font-bold text-slate-900">
              {safeCurrentPage} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safeCurrentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              title="Trang sau"
            >
              Sau →
            </Button>
          </div>
        </div>
      </div>

      {/* POPUP MODAL CHỈNH SỬA THÔNG TIN RECORD (CHUẨN MINIMAL POPUP FORM THEO SKILL UI-DESIGN) */}
      {editingItem ? (
        <Dialog onEscape={editIsDirty ? undefined : () => setEditingItem(null)}>
          <DialogContent className="max-w-[520px]" aria-label="Cập nhật vật tư">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveEdit();
              }}
              className="flex min-h-0 flex-col"
            >
              <DialogHeader>
                <div>
                  <DialogTitle>Cập nhật vật tư</DialogTitle>
                  <DialogDescription>
                    Điều chỉnh mã SKU, tên hiển thị, loại danh mục và trạng thái kho bãi.
                  </DialogDescription>
                </div>
                <CloseGuard dirty={editIsDirty} busy={busy} onClose={() => setEditingItem(null)}>
                  <DialogCloseButton />
                </CloseGuard>
              </DialogHeader>

              <DialogBody className="flex flex-col gap-4">
              {/* Trường Mã vật tư */}
              <div className="flex flex-col gap-1.5">
                <Label required>Mã vật tư</Label>
                <Input
                  type="text"
                  required
                  placeholder="VD: VT-001, MBA-01…"
                  value={editDraft.code}
                  onChange={(e) => setEditDraft((d) => ({ ...d, code: e.target.value }))}
                />
                <span className="text-[13px] text-slate-500">
                  Mã định danh duy nhất của vật tư trong hệ thống.
                </span>
              </div>

              {/* Trường Tên vật tư */}
              <div className="flex flex-col gap-1.5">
                <Label required>Tên vật tư</Label>
                <Input
                  type="text"
                  required
                  placeholder="VD: Dầu biến áp, Máy cắt không khí…"
                  value={editDraft.name}
                  onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                />
                <span className="text-[13px] text-slate-500">
                  Tên gọi hiển thị trên danh mục và các biểu mẫu tác nghiệp.
                </span>
              </div>

              {/* Trường Loại danh mục */}
              <div className="flex flex-col gap-1.5">
                <Label>Loại danh mục</Label>
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
                <span className="text-[13px] text-slate-500">
                  Phân nhóm nghiệp vụ theo cấu hình danh mục của hệ thống.
                </span>
              </div>

              {/* Trạng thái vận hành & Vị trí kho (nếu không phải quản lý cá thể theo sê-ri) */}
              {!materialByCode?.get(editingItem.code)?.isSerialized ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Tình trạng vận hành</Label>
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

                  <div className="flex flex-col gap-1.5">
                    <Label>Vị trí / Trạng thái kho</Label>
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
                <div className="rounded-md border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm leading-[1.45] text-blue-800">
                  Vật tư này được quản lý theo số sê-ri cá thể. Tình trạng và vị trí được cập nhật trực tiếp theo từng số sê-ri trong chi tiết dòng.
                </div>
              )}

              </DialogBody>

              <DialogFooter>
                <CloseGuard dirty={editIsDirty} busy={busy} onClose={() => setEditingItem(null)}>
                  <Button type="button" variant="outline" disabled={busy}>
                    Huỷ
                  </Button>
                </CloseGuard>
                <Button type="submit" disabled={busy || !editDraft.code.trim() || !editDraft.name.trim()}>
                  {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* DRAWER CHI TIẾT VẬT TƯ / THIẾT BỊ (ACTIONABLE DRAWER CONSOLE 680px CHUẨN THỦ KHO) */}
      {activeItem ? (
        <Sheet onEscape={() => setOpenCode(undefined)} onBackdropClick={() => setOpenCode(undefined)}>
          <SheetContent aria-label="Chi tiết vật tư và hành động thủ kho">
            {/* Header Drawer */}
            <SheetHeader>
              <div className="flex min-w-0 flex-1 flex-col gap-[0.3rem]">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.04em] text-slate-500">
                  <Boxes size={13} strokeWidth={2.2} />
                  <span>Hồ sơ vận hành thiết bị · Thủ kho</span>
                </div>
                <h3 className="m-0 text-xl font-bold leading-[1.3] text-slate-900">{activeItem.name}</h3>
                <div className="m-0 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <span>
                    Mã: <code className="rounded bg-slate-100 px-[0.35rem] py-[0.1rem] font-mono font-bold text-slate-700">{activeItem.code}</code>
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
                      <span
                        className={cn(
                          'inline-flex items-center gap-[0.35rem] rounded-full border px-[0.55rem] py-[0.15rem] text-xs font-bold whitespace-nowrap',
                          ASSET_STATUS_BADGE[activeItem.status] ?? '',
                        )}
                      >
                        {activeItem.status}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>

              {/* Nút đóng trên Header Drawer */}
              <DialogCloseButton onClick={() => setOpenCode(undefined)} title="Đóng (ESC)" />
            </SheetHeader>

            {/* Dải thông tin vị trí lưu kho & định vị nhanh */}
            <div className="flex items-center gap-[0.45rem] border-b border-slate-200 bg-slate-100 px-[1.6rem] py-[0.65rem] text-sm font-medium text-slate-700">
              <MapPin size={15} className="shrink-0 text-slate-500" />
              <div className="flex flex-1 flex-wrap items-center gap-1.5">
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
            <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-5" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={drawerTab === 'storage'}
                className={cn(TAB_BTN, drawerTab === 'storage' && TAB_BTN_ACTIVE)}
                onClick={() => setDrawerTab('storage')}
              >
                <Boxes size={14} />
                <span>1. Số lượng ở từng kho</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={drawerTab === 'ledger'}
                className={cn(TAB_BTN, drawerTab === 'ledger' && TAB_BTN_ACTIVE)}
                onClick={() => setDrawerTab('ledger')}
              >
                <Clock size={14} />
                <span>2. Lịch sử xuất nhập kho</span>
              </button>
            </div>

            {/* Nội dung theo Tab đang chọn */}
            <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-[1.6rem] py-5">
              {/* TAB 1: TỔNG QUAN & VỊ TRÍ LƯU TRỮ */}
              {drawerTab === 'storage' ? (
                <>
                  {/* Vị trí lưu trữ từ tồn kho API */}
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-[0.85rem]">
                    <div className="flex flex-col gap-[0.2rem]">
                      <span className="text-xs font-bold uppercase text-blue-800">
                        Định vị ngăn lưu trữ (Bin Location)
                      </span>
                      <div className="text-sm font-bold text-blue-800">
                        {activeItem.installedAtName
                          ? `Lắp tại: ${activeItem.installedAtName}`
                          : activeLocationIds.length > 0
                            ? activeLocationIds.join(', ')
                            : 'Chưa có dữ liệu vị trí từ API'}
                      </div>
                    </div>
                  </div>

                  {/* Phân bố tồn kho thực tế */}
                  <div className="flex flex-col gap-3">
                    <h4 className="m-0 flex items-center justify-between gap-2 text-sm font-bold text-slate-800">
                      <span>Tồn kho theo từng kho vật lý</span>
                      <span className="text-[13px] font-normal text-slate-500">
                        Tổng sở hữu: <strong>{formatNumber(onHand(activeItem) + inUse(activeItem))}</strong> {activeItem.unit ?? ''}
                      </span>
                    </h4>
                    {(stockByCode.get(activeItem.code) ?? []).length > 0 ? (
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
                        {(stockByCode.get(activeItem.code) ?? []).map((row) => (
                          <div key={row.id} className={STOCK_CARD}>
                            <span className="text-sm font-bold text-slate-700">{row.warehouseCode}</span>
                            <span className="text-xl font-bold text-slate-900">
                              {formatNumber(row.quantity)} {activeItem.unit ?? ''}
                            </span>
                            <div className="flex items-center justify-between text-[0.8125rem] text-slate-500">
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
                      <p className="text-slate-500">Chưa ghi nhận tồn kho ở kho nào.</p>
                    )}
                  </div>

                  {/* Tình trạng bảo quản & Quy chuẩn an toàn */}
                  <div className="flex flex-col gap-3">
                    <h4 className="m-0 flex items-center justify-between gap-2 text-sm font-bold text-slate-800">Tình trạng bảo quản & Dự phòng</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className={STOCK_CARD}>
                        <span className="text-xs font-semibold text-slate-500">NGƯỠNG TỒN AN TOÀN (MIN/MAX)</span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-base font-bold text-slate-900">
                            {activeMaterial ? formatNumber(activeMaterial.minStock) : 'Chưa có dữ liệu'} {activeItem.unit ?? ''}
                          </span>
                          {activeMaterial ? (
                            <span className={cn('text-xs', onHand(activeItem) < activeMaterial.minStock ? 'text-red-600' : 'text-green-600')}>
                              ({onHand(activeItem) < activeMaterial.minStock ? 'Dưới ngưỡng' : 'Đạt mức an toàn'})
                            </span>
                          ) : null}
                        </div>
                        <span className="text-xs text-slate-500">
                          Ngưỡng được lấy từ cấu hình vật tư và đối chiếu với tồn thực tế.
                        </span>
                      </div>
                      <div className={STOCK_CARD}>
                        <span className="text-xs font-semibold text-slate-500">LỊCH BẢO QUẢN ĐỊNH KỲ</span>
                        {activeMaintenance?.length ? activeMaintenance.map((schedule) => (
                          <div key={schedule.id} className="text-[13px] text-slate-700">
                            <strong>{schedule.title}</strong>
                            <span> · {schedule.frequency}</span>
                            {schedule.nextDueAt ? (
                              <span> · Kỳ tiếp theo: {formatDate(schedule.nextDueAt)}</span>
                            ) : null}
                          </div>
                        )) : (
                          <span className="text-xs text-slate-500">
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
                <div className="flex flex-col gap-3">
                  <MaterialHistory
                    state={history[activeItem.code]}
                    unit={activeItem.unit}
                    warehouseCodeById={warehouseCodeById}
                  />
                </div>
              ) : null}
            </div>

            {/* STICKY ACTION FOOTER (CỐ ĐỊNH DƯỚI ĐÁY DRAWER CHUẨN THỦ KHO) */}
            <SheetFooter className="justify-between">
              <div className="flex items-center gap-2">
                {onPatch ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleStartEdit(activeItem)}
                    disabled={busy}
                    title="Sửa thông tin vật tư"
                  >
                    <Pencil size={14} />
                    <span>Sửa</span>
                  </Button>
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
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={busy}
                      title="Ngừng sử dụng mã vật tư này"
                    >
                      <Ban size={14} />
                      <span>Ngừng sử dụng</span>
                    </Button>
                  </Popconfirm>
                ) : null}
              </div>

              <Button type="button" variant="outline" onClick={() => setOpenCode(undefined)}>
                Đóng
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : null}

      {/* MODAL IN TEM NHÃN QR CODE KHỔ 50x30MM */}
      {showQrPrintModal && activeItem ? (
        <Dialog onEscape={() => setShowQrPrintModal(false)}>
          <DialogContent className="max-w-[460px]" aria-label="Xem trước tem nhãn dán thiết bị (50×30mm)">
            <DialogHeader>
              <DialogTitle>Xem trước tem nhãn dán thiết bị (50×30mm)</DialogTitle>
              <DialogCloseButton onClick={() => setShowQrPrintModal(false)} />
            </DialogHeader>

            <DialogBody>
            {/* Tem mẫu chuẩn in ấn */}
            <div className="mb-4 flex items-center gap-3.5 rounded-md border-2 border-dashed border-slate-400 bg-neutral-50 p-3.5">
              <div className="size-20 border border-slate-300 bg-white p-1">
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
              <div className="flex flex-1 flex-col gap-[3px]">
                <span className="text-xs font-bold uppercase text-slate-500">
                  ENTERPRISE PLATFORM · KHO
                </span>
                <strong className="text-sm text-slate-900">{activeItem.code}</strong>
                <span className="text-xs font-semibold leading-[1.2] text-slate-700">
                  {activeItem.name}
                </span>
                <span className="text-xs font-semibold text-slate-700">
                  Vị trí: {activeItem.installedAtName
                    ? `Lắp tại: ${activeItem.installedAtName}`
                    : activeLocationIds.length > 0
                      ? activeLocationIds.join(', ')
                      : 'Chưa có dữ liệu vị trí'}
                </span>
              </div>
            </div>

          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowQrPrintModal(false)}>
              Đóng
            </Button>
            <Button
              type="button"
              onClick={() => {
                window.print();
                setShowQrPrintModal(false);
              }}
            >
              <Printer size={15} />
              <span>In ra máy in tem</span>
            </Button>
          </DialogFooter>
        </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
