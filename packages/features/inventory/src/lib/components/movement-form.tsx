'use client';

import type {
  Material,
  Reservation,
  Lot,
  MovementCounterparty,
} from '@enterprise-platform/contracts-inventory';
import {
  X,
  Paperclip,
  Upload,
  Search,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Barcode,
  Layers,
  Info,
  FileSpreadsheet,
} from 'lucide-react';
import { SearchableSelect, VnNumberInput, formatDate, CloseGuard } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { useMemo, useRef, useState, useEffect, type FormEvent } from 'react';
import type {
  InventoryWorkspace,
  ProcedureOption,
  ProcedureWorkOrder,
} from '../inventory-api';
import { loadLots, loadWarehouseStock } from '../inventory-api';
import { QUALITY_STATUS_LABEL, formatNumber, getUnitQuantityConfig } from '../inventory-labels';
import { ExcelImportDialog } from './excel-import-dialog';
import {
  buildStockLevels,
  checkOutboundLines,
  describeStockProblem,
  type StockLevel,
} from './movement-stock-check';
import { FormError, useFormSubmit } from './form-error';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../ui/table';
import { Textarea } from '../ui/textarea';

/** Khối một nhãn và một ô nhập của phiếu. */
const FIELD_BLOCK = 'flex min-w-0 flex-col gap-1 [&>div]:min-w-0';

export type MovementKind = 'receipt' | 'issue' | 'transfer' | 'adjust';

const KIND_LABEL: Record<MovementKind, string> = {
  receipt: 'Nhập kho',
  issue: 'Xuất kho',
  transfer: 'Chuyển kho',
  adjust: 'Điều chỉnh / Từ chối',
};

/** Dòng vật tư trong phiếu đa đối tượng */
export interface MovementLineItem {
  readonly id: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly materialType?: string;
  readonly unit: string;
  readonly warehouseCode: string;
  readonly toWarehouseCode?: string;
  readonly quantity: number;
  readonly unitCost?: number;
  /** Thuế suất VAT (%) riêng cho từng mặt hàng (mặc định 10%) */
  readonly vatRate?: number;
  readonly serialNumbers?: readonly string[];
  /** Phân bổ số lượng theo từng lô. Bắt buộc khi người dùng đã chọn quản lý theo lô. */
  readonly lotAllocations?: readonly { lotId: string; lotNumber: string; quantity: number }[];
  /** Thông tin lô nhận vào khi nhập kho: lô mới hoặc lô đã có cùng số lô. */
  readonly receiptLot?: {
    readonly lotNumber: string;
    readonly manufactureDate?: string;
    readonly expiryDate?: string;
    readonly supplier?: string;
    readonly coCqNumber?: string;
  };
  readonly lineNote?: string;
  readonly barcode?: string;
  readonly manufacturer?: string;
  readonly locationId?: string;
  readonly minStock?: number;
  readonly maxStock?: number;
  readonly newMaterial?: {
    readonly code: string;
    readonly name: string;
    readonly type?: string;
    readonly unit: string;
    readonly minStock: number;
    readonly maxStock?: number;
    readonly barcode?: string;
    readonly manufacturer?: string;
  };
}
/** Đối tượng nhận khi xuất kho. */
export type IssueTargetType = 'department' | 'asset' | 'customer' | 'project';

export interface MovementInput {
  readonly kind: MovementKind;
  readonly warehouseCode: string;
  readonly toWarehouseCode?: string;
  readonly materialCode?: string;
  readonly quantity?: number;
  readonly unitCost?: number;
  readonly note: string;
  /** Tên Nhà cung cấp / Đơn vị giao hàng (bắt buộc khi nhập kho) */
  readonly supplierName?: string;
  /** Địa chỉ Nhà cung cấp */
  readonly supplierAddress?: string;
  /** Số hoá đơn / Chứng từ gốc (bắt buộc khi nhập kho) */
  readonly invoiceNumber?: string;
  /** Thuế suất VAT (%) áp dụng cho phiếu nhập (ví dụ 0, 5, 8, 10...) */
  readonly vatRate?: number;
  /** Tiền thuế VAT (VNĐ) */
  readonly vatAmount?: number;
  /** Tổng tiền sau thuế (VNĐ) */
  readonly totalWithVat?: number;
  /** Ngày thực tế nhập / xuất / chuyển kho (YYYY-MM-DD) */
  readonly movementDate?: string;
  /** Quy trình sẽ mở work order cho lệnh này. Bỏ trống thì không mở. */
  readonly procedureDefinitionId?: string;
  /** Tệp tài liệu / chứng từ đính kèm (hoá đơn, phiếu giao nhận, biên bản...) */
  readonly attachmentFile?: File;
  /** Số sê-ri khai kèm phiếu nhập đơn lẻ. */
  readonly serialNumbers?: readonly string[];
  /** Nơi nhập đến từ / nơi xuất đi đến, đã chuẩn hoá để ghi vào sổ cái. */
  readonly counterparty?: MovementCounterparty;
  /** Mã thiết bị đích khi xuất lắp đặt/thay thế phụ tùng (cộng vào 'Đang sử dụng' thay vì xuất tiêu hao) */
  readonly targetAssetCode?: string;
  /** Danh sách các dòng vật tư đa đối tượng của phiếu */
  readonly items: readonly MovementLineItem[];
  /** Mã cần tạo trước khi ghi phiếu, khi người dùng chọn "+ Vật tư mới…". */
  readonly newMaterial?: {
    readonly code: string;
    readonly name: string;
    readonly type?: string;
    readonly unit: string;
    readonly minStock: number;
  };
}

/** Nơi nhập/xuất của phiếu theo đúng dữ liệu người dùng đã khai; chưa khai thì không gửi. */
function buildCounterparty(input: {
  kind: MovementKind;
  supplierName: string;
  supplierAddress: string;
  invoiceNumber: string;
  issueTargetType: IssueTargetType;
  issueTargetName: string;
  targetAssetCode: string;
}): MovementCounterparty | undefined {
  if (input.kind === 'receipt') {
    const name = input.supplierName.trim();
    if (!name) return undefined;
    return {
      type: 'SUPPLIER',
      name,
      address: input.supplierAddress.trim() || undefined,
      documentNumber: input.invoiceNumber.trim() || undefined,
    };
  }
  if (input.kind !== 'issue') return undefined;
  if (input.issueTargetType === 'asset') {
    const code = input.targetAssetCode.trim();
    return code ? { type: 'ASSET', name: code } : undefined;
  }
  const name = input.issueTargetName.trim();
  if (!name) return undefined;
  const type = { department: 'DEPARTMENT', customer: 'CUSTOMER', project: 'PROJECT' } as const;
  return { type: type[input.issueTargetType], name };
}

/** Chuẩn hoá chuỗi tiếng Việt không dấu phục vụ tìm kiếm thông minh */
function removeVietnameseTones(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Nhận cả xuống dòng, dấu phẩy và chấm phẩy khi dán sê-ri */
function parseSerials(draft: string): string[] {
  return [
    ...new Set(
      draft
        .split(/[\n,;]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

/** Mỗi vật tư chỉ có một cách định danh: sê-ri, lô, hoặc theo dõi số lượng thuần. */
/**
 * Lô chọn được tại một kho, theo hạn dùng gần nhất trước (FEFO). Phiếu xuất chỉ
 * lấy lô Đạt còn hạn; phiếu chuyển mang được cả lô không Đạt (sang kho lỗi).
 */
function lotChoices(lots: readonly Lot[], warehouseCode: string, kind: string): { lot: Lot; available: number }[] {
  const today = new Date().toISOString().slice(0, 10);
  return lots
    .map((lot) => {
      const balance = lot.balances.find((candidate) => candidate.warehouseCode === warehouseCode);
      const available = kind === 'transfer' ? (balance?.quantity ?? 0) : (balance?.available ?? 0);
      return { lot, available };
    })
    .filter(({ lot, available }) =>
      available > 0 &&
      (kind === 'transfer' || (lot.qualityStatus === 'PASSED' && !(lot.expiresOn && lot.expiresOn < today))),
    )
    .sort((left, right) => (left.lot.expiresOn ?? '9999-12-31').localeCompare(right.lot.expiresOn ?? '9999-12-31'));
}

function getTrackingMode(material?: Material): 'SERIAL' | 'LOT' | 'NONE' {
  if (!material) return 'NONE';
  if (material.isSerialized) return 'SERIAL';
  return material.category === 'CONSUMABLE' || material.code.includes('DAU') || material.code.includes('CAP') || material.code === 'VT-001'
    ? 'LOT'
    : 'NONE';
}

/**
 * Component Searchable Combobox hỗ trợ tìm kiếm theo Mã hoặc Tên vật tư (tiếng Việt không dấu)
 */
function SearchableMaterialCombobox({
  materials,
  excludedCodes = [],
  onSelectMaterial,
  onOpenNewMaterial,
}: {
  materials: readonly Material[];
  stock?: InventoryWorkspace['stock'];
  excludedCodes?: readonly string[];
  onSelectMaterial: (m: Material) => void;
  onOpenNewMaterial?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const availableMaterials = useMemo(() => {
    const active = materials.filter((m) => m.isActive !== false);
    if (!excludedCodes || excludedCodes.length === 0) return active;
    const excludedSet = new Set(excludedCodes);
    return active.filter((m) => !excludedSet.has(m.code));
  }, [materials, excludedCodes]);

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return availableMaterials.slice(0, 10);
    }
    const q = removeVietnameseTones(query.trim());
    return availableMaterials
      .filter((m) => {
        const codeMatch = removeVietnameseTones(m.code).includes(q);
        const nameMatch = removeVietnameseTones(m.name).includes(q);
        return codeMatch || nameMatch;
      })
      .slice(0, 20);
  }, [availableMaterials, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [filtered]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const handleSelect = (m: Material) => {
    onSelectMaterial(m);
    setQuery('');
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % (filtered.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[activeIndex]) {
        handleSelect(filtered[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div className="flex items-center relative">
        <Search size={15} className="absolute left-2.5 text-slate-400 pointer-events-none" />
        <Input
          type="text"
          className="pl-[34px] pr-8"
          placeholder="Tìm theo tên hoặc mã vật tư..."
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        {query ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              setQuery('');
              setOpen(false);
            }}
            className="absolute right-1.5 text-slate-400"
          >
            <X size={14} />
          </Button>
        ) : null}
      </div>

      {open ? (
        <ul className="absolute top-[calc(100%_+_4px)] left-0 right-0 max-h-60 overflow-y-auto bg-white border border-slate-300 rounded-md shadow-[0_10px_25px_-5px_rgba(0,_0,_0,_0.1),_0_8px_10px_-6px_rgba(0,_0,_0,_0.1)] z-[50] py-1 px-0 m-0 list-none">
          {filtered.map((item, idx) => (
            <li
              key={item.code}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 px-3 py-[9px] text-[13px] transition-colors hover:bg-slate-100',
                idx === activeIndex && 'bg-slate-100',
              )}
              onMouseDown={() => handleSelect(item)}
              onMouseEnter={() => setActiveIndex(idx)}
              
            >
              <span
                className="font-semibold text-slate-900 text-[13.5px] overflow-hidden text-ellipsis whitespace-nowrap"
              >
                {item.name}
              </span>
              <span
                className="font-bold text-blue-600 font-mono text-[12px] text-blue-600 bg-slate-100 py-0.5 px-2 rounded-sm shrink-0 tracking-[0.02em]"
                
              >
                {item.code}
              </span>
            </li>
          ))}

          {filtered.length === 0 ? (
            <li
              className="p-3 text-center text-slate-500 text-[13px]"
            >
              {query
                ? `Không tìm thấy vật tư nào khớp với từ khoá "${query}" (hoặc đã có trên phiếu)`
                : 'Tất cả vật tư phù hợp đã được thêm vào phiếu'}
            </li>
          ) : null}

          {onOpenNewMaterial ? (
            <li
              className="border-t border-t-slate-100 py-2 px-3 bg-slate-50 cursor-pointer flex items-center gap-1.5 text-blue-600 font-semibold text-[13px]"
              onMouseDown={() => {
                setOpen(false);
                onOpenNewMaterial();
              }}
            >
              <Plus size={14} />
              <span>+ Tạo mã vật tư mới vào danh mục…</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

export function MovementForm({
  workspace,
  initialKind = 'receipt',
  initialMaterialCode,
  initialQuantity,
  initialNote,
  initialWarehouseCode,
  initialItems,
  title,
  description,
  procedures = [],
  units = [],
  types = [],
  reservations = [],
  workOrders = [],
  busy,
  isDialog = false,
  initialOpenExcelImport = false,
  onCancel,
  onSubmit,
}: {
  workspace: InventoryWorkspace;
  initialKind?: MovementKind;
  initialMaterialCode?: string;
  initialQuantity?: number | string;
  initialNote?: string;
  initialWarehouseCode?: string;
  initialItems?: readonly MovementLineItem[];
  title?: string;
  description?: string;
  /** Quy trình đã công bố, để mở work order kèm lệnh kho. */
  procedures?: readonly ProcedureOption[];
  /** Danh mục đơn vị tính, cho ô tạo mã mới. */
  units?: readonly string[];
  /** Danh mục nhóm vật tư, cho ô tạo mã mới. */
  types?: readonly string[];
  /** Phiếu giữ chỗ, để hiện mã nào đang có người chờ. */
  reservations?: readonly Reservation[];
  /** Hồ sơ bên Quy trình, để gọi tên work order thay vì hiện id. */
  workOrders?: readonly ProcedureWorkOrder[];
  busy: boolean;
  isDialog?: boolean;
  initialOpenExcelImport?: boolean;
  onCancel: () => void;
  /** Từ chối (reject) khi Kho báo lỗi để phiếu hiện lý do và giữ dữ liệu đã nhập. */
  onSubmit: (input: MovementInput) => Promise<void> | void;
}) {
  const { error, submit: send } = useFormSubmit('Không ghi sổ được phiếu.');
  const [kind, setKind] = useState<MovementKind>(initialKind);
  // Một phiếu một kho: kho này là kho của MỌI dòng. Phiếu mở sẵn từ danh mục có thể mang
  // dòng khác kho, khi đó lấy kho của dòng đầu làm kho phiếu rồi gom các dòng về đó.
  const [warehouseCode, setWarehouseCode] = useState<string>(() => {
    if (initialWarehouseCode) return initialWarehouseCode;
    return initialItems?.[0]?.warehouseCode || workspace.warehouses[0]?.code || '';
  });
  const [toWarehouseCode, setToWarehouseCode] = useState<string>('');
  const [issueTargetType, setIssueTargetType] = useState<IssueTargetType>('department');
  const [issueTargetName, setIssueTargetName] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierAddress, setSupplierAddress] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [targetAssetCode, setTargetAssetCode] = useState<string>('');
  const [procedureDefinitionId, setProcedureDefinitionId] = useState('');
  const [note, setNote] = useState(initialNote ?? '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showExcelImport, setShowExcelImport] = useState(Boolean(initialOpenExcelImport));

  // Danh mục nhóm vật tư cho ô tạo mới
  const typeOptions = useMemo(() => {
    const set = new Set<string>(types);
    for (const m of workspace.materials) {
      if (m.type) set.add(m.type);
    }
    return Array.from(set).map((t) => ({ value: t, label: t }));
  }, [types, workspace.materials]);

  // Danh sách các dòng vật tư trong phiếu
  const [items, setItems] = useState<MovementLineItem[]>(() => {
    if (initialItems && initialItems.length > 0) {
      const voucherWarehouse =
        initialWarehouseCode || initialItems[0].warehouseCode || workspace.warehouses[0]?.code || '';
      return initialItems.map((item) => ({ ...item, warehouseCode: voucherWarehouse }));
    }
    if (initialMaterialCode) {
      const mat = workspace.materials.find((m) => m.code === initialMaterialCode);
      return [
        {
          id: `item-${Date.now()}-0`,
          materialCode: initialMaterialCode,
          materialName: mat?.name || initialMaterialCode,
          materialType: mat?.type,
          unit: mat?.unit || 'Cái',
          warehouseCode: initialWarehouseCode || workspace.warehouses[0]?.code || '',
          quantity: Number(initialQuantity) || 1,
          unitCost: undefined,
          serialNumbers: [],
          lineNote: initialNote || '',
        },
      ];
    }
    return [];
  });

  // Modal quản lý Sê-ri
  const [serialModalIndex, setSerialModalIndex] = useState<number | null>(null);
  const [serialDraft, setSerialDraft] = useState('');
  const [lotModalIndex, setLotModalIndex] = useState<number | null>(null);
  const [lotsByMaterial, setLotsByMaterial] = useState<Record<string, Lot[]>>({});
  const [lotDraft, setLotDraft] = useState<Record<string, number>>({});
  const [newLotDraft, setNewLotDraft] = useState({ lotNumber: '', manufactureDate: '', expiryDate: '', supplier: '', coCqNumber: '' });

  // Modal tạo nhanh mã vật tư mới
  const [showNewMaterialModal, setShowNewMaterialModal] = useState(false);
  const [draftMaterial, setDraftMaterial] = useState({
    code: '',
    name: '',
    type: '',
    unit: units[0] || 'Cái',
    minStock: '0',
  });

  const outbound = kind === 'issue' || kind === 'transfer';

  /**
   * Tồn thực của kho phiếu, đọc từ server mỗi khi đổi kho hoặc loại phiếu xuất.
   * Gắn kèm `code` để bỏ kết quả của một kho đã bị đổi đi trong lúc đang tải.
   */
  const [liveStock, setLiveStock] = useState<
    | { readonly code: string; readonly status: 'loading' }
    | { readonly code: string; readonly status: 'error' }
    | { readonly code: string; readonly status: 'ready'; readonly levels: ReadonlyMap<string, StockLevel> }
  >();
  const [stockReloadKey, setStockReloadKey] = useState(0);
  const [warehouseNotice, setWarehouseNotice] = useState<string>();

  useEffect(() => {
    if (!outbound || !warehouseCode) {
      setLiveStock(undefined);
      return;
    }
    let cancelled = false;
    const codeByMaterialId = new Map(workspace.materials.map((material) => [material.id, material.code]));
    setLiveStock({ code: warehouseCode, status: 'loading' });
    loadWarehouseStock(warehouseCode)
      .then((rows) => {
        if (cancelled) return;
        setLiveStock({ code: warehouseCode, status: 'ready', levels: buildStockLevels(rows, codeByMaterialId) });
      })
      .catch(() => {
        if (!cancelled) setLiveStock({ code: warehouseCode, status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [outbound, warehouseCode, stockReloadKey, workspace.materials]);

  useEffect(() => {
    const codes = [...new Set(items.map((item) => item.materialCode).filter(Boolean))];
    // Lô đọc từ server; lỗi tải thì coi như chưa có lô, server vẫn kiểm lại khi ghi phiếu.
    void Promise.all(
      codes.map(async (code) => [code, await loadLots(code).catch(() => [] as Lot[])] as const),
    ).then((entries) => setLotsByMaterial((current) => ({ ...current, ...Object.fromEntries(entries) })));
  }, [items]);

  // Một phiếu một kho: đổi kho của phiếu thì mọi dòng đổi theo.
  const handleChangeDefaultWarehouse = (newWh: string) => {
    if (newWh === warehouseCode) return;
    setWarehouseCode(newWh);
    // Phân bổ lô và sê-ri xuất được chọn từ tồn của kho cũ: giữ lại thì phiếu xuất từ kho mới
    // vẫn trừ lô của kho cũ. Xoá để người dùng chọn lại; nút xác nhận bị chặn tới khi chọn đủ.
    const clearsAllocation = outbound;
    const cleared = clearsAllocation
      ? items.filter((it) => (it.lotAllocations?.length ?? 0) > 0 || (it.serialNumbers?.length ?? 0) > 0).length
      : 0;
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        warehouseCode: newWh,
        ...(clearsAllocation ? { lotAllocations: undefined, serialNumbers: [] } : {}),
      })),
    );
    setWarehouseNotice(
      items.length === 0
        ? undefined
        : `Đã chuyển ${items.length} dòng sang kho ${newWh}.${
            cleared > 0 ? ` ${cleared} dòng đã chọn lô hoặc sê-ri của kho cũ, hãy chọn lại.` : ''
          }`,
    );
  };

  // Thêm vật tư từ Combobox (Chốt chặn 1 kho - 1 phiếu: cố định theo warehouseCode của phiếu)
  const handleSelectMaterial = (m: Material) => {
    const existingIndex = items.findIndex((it) => it.materialCode === m.code);
    if (existingIndex >= 0) {
      setItems((prev) =>
        prev.map((it, idx) => (idx === existingIndex ? { ...it, quantity: it.quantity + 1 } : it)),
      );
    } else {
      setItems((prev) => [
        ...prev,
        {
          id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          materialCode: m.code,
          materialName: m.name,
          materialType: m.type,
          unit: m.unit || 'Cái',
          warehouseCode: warehouseCode || workspace.warehouses[0]?.code || '',
          quantity: 1,
          unitCost: undefined,
          serialNumbers: [],
          lineNote: '',
        },
      ]);
    }
  };

  const handleUpdateQuantity = (index: number, quantity: number) => {
    setItems((prev) =>
      prev.map((it, idx) => (idx === index ? { ...it, quantity: Math.max(0, quantity) } : it)),
    );
  };

  const handleUpdateUnitCost = (index: number, unitCost: number | undefined) => {
    setItems((prev) =>
      prev.map((it, idx) => (idx === index ? { ...it, unitCost } : it)),
    );
  };

  const handleUpdateLineNote = (index: number, lineNote: string) => {
    setItems((prev) =>
      prev.map((it, idx) => (idx === index ? { ...it, lineNote } : it)),
    );
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleImportItems = (importedItems: MovementLineItem[]) => {
    setItems((prev) => [...prev, ...importedItems]);
    setShowExcelImport(false);
  };

  // Quản lý Sê-ri
  const handleOpenSerialModal = (index: number) => {
    setSerialModalIndex(index);
    const it = items[index];
    setSerialDraft(it?.serialNumbers?.join('\n') ?? '');
  };

  const handleSaveSerials = () => {
    if (serialModalIndex === null) return;
    const serials = parseSerials(serialDraft);
    setItems((prev) =>
      prev.map((it, idx) => {
        if (idx === serialModalIndex) {
          return {
            ...it,
            serialNumbers: serials,
            quantity: serials.length > it.quantity ? serials.length : it.quantity,
          };
        }
        return it;
      }),
    );
    setSerialModalIndex(null);
    setSerialDraft('');
  };

  const handleOpenLotModal = (index: number) => {
    const item = items[index];
    if (!item) return;
    setLotModalIndex(index);
    setLotDraft(Object.fromEntries((item.lotAllocations ?? []).map((lot) => [lot.lotId, lot.quantity])));
    setNewLotDraft({
      lotNumber: item.receiptLot?.lotNumber ?? '',
      manufactureDate: item.receiptLot?.manufactureDate ?? '',
      expiryDate: item.receiptLot?.expiryDate ?? '',
      supplier: item.receiptLot?.supplier ?? '',
      coCqNumber: item.receiptLot?.coCqNumber ?? '',
    });
  };

  const handleSaveLots = () => {
    if (lotModalIndex === null) return;
    const item = items[lotModalIndex];
    if (!item) return;
    const existingLots = lotsByMaterial[item.materialCode] ?? [];
    const allocations = existingLots
      .map((lot) => ({ lotId: lot.id, lotNumber: lot.lotNo, quantity: Number(lotDraft[lot.id]) || 0 }))
      .filter((lot) => lot.quantity > 0);
    const receiptLot = kind === 'receipt' && newLotDraft.lotNumber.trim()
      ? { lotNumber: newLotDraft.lotNumber.trim().toUpperCase(), manufactureDate: newLotDraft.manufactureDate || undefined, expiryDate: newLotDraft.expiryDate || undefined, supplier: newLotDraft.supplier.trim() || undefined, coCqNumber: newLotDraft.coCqNumber.trim() || undefined }
      : undefined;
    setItems((previous) => previous.map((line, index) => index === lotModalIndex ? { ...line, lotAllocations: allocations, receiptLot } : line));
    setLotModalIndex(null);
  };

  // Tạo nhanh vật tư mới
  const handleCreateNewMaterial = () => {
    if (!draftMaterial.code.trim() || !draftMaterial.name.trim()) return;
    const newCode = draftMaterial.code.trim().toUpperCase();
    const newName = draftMaterial.name.trim();
    // Không có nhóm mặc định: để trống nếu người dùng không chọn.
    const newType = draftMaterial.type.trim() || undefined;
    const newUnit = draftMaterial.unit || 'Cái';
    const minStock = Number(draftMaterial.minStock) || 0;

    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-new`,
        materialCode: newCode,
        materialName: newName,
        materialType: newType,
        unit: newUnit,
        warehouseCode: warehouseCode || workspace.warehouses[0]?.code || '',
        quantity: 1,
        unitCost: undefined,
        serialNumbers: [],
        lineNote: 'Vật tư mới tạo',
        newMaterial: {
          code: newCode,
          name: newName,
          type: newType,
          unit: newUnit,
          minStock,
        },
      },
    ]);

    setDraftMaterial({ code: '', name: '', type: '', unit: units[0] || 'Cái', minStock: '0' });
    setShowNewMaterialModal(false);
  };

  // Phân tích trạng thái tồn kho của từng dòng
  const liveLevels = liveStock?.status === 'ready' && liveStock.code === warehouseCode ? liveStock.levels : undefined;
  const lineStockAnalysis = useMemo(() => {
    return items.map((item) => {
      const wh = warehouseCode;
      // Phiếu xuất/chuyển dùng tồn đọc trực tiếp; workspace chỉ là số tham khảo khi chưa tải xong.
      const stockItem = liveLevels
        ? liveLevels.get(item.materialCode)
        : workspace.stock.find((s) => s.materialCode === item.materialCode && s.warehouseCode === wh);
      const onHandInWh = stockItem?.quantity ?? 0;
      const availInWh = stockItem?.available ?? onHandInWh;

      const totalAllWarehouses = workspace.stock
        .filter((s) => s.materialCode === item.materialCode)
        .reduce((sum, s) => sum + s.quantity, 0);

      // Quá tồn khả dụng là chặn (server từ chối đúng điều kiện này); giữ chỗ vẫn nằm trong tồn thực.
      const isOverdraw = outbound && (item.quantity > availInWh || onHandInWh === 0);

      let badgeType: 'ok' | 'shared' | 'empty' = 'ok';
      let badgeLabel = `Tồn kho: ${formatNumber(onHandInWh)}`;

      if (outbound) {
        if (onHandInWh >= item.quantity && item.quantity > 0) {
          badgeType = 'ok';
          badgeLabel = `Đủ kho này (${formatNumber(onHandInWh)})`;
        } else if (totalAllWarehouses >= item.quantity && item.quantity > 0) {
          badgeType = 'shared';
          badgeLabel = `Gom liên kho (${formatNumber(totalAllWarehouses)})`;
        } else {
          badgeType = 'empty';
          badgeLabel = `Thiếu hàng (còn ${formatNumber(totalAllWarehouses)})`;
        }
      } else {
        badgeLabel = `Hiện có: ${formatNumber(totalAllWarehouses)}`;
      }

      return {
        onHandInWh,
        availInWh,
        totalAllWarehouses,
        isOverdraw,
        badgeType,
        badgeLabel,
      };
    });
  }, [items, warehouseCode, workspace.stock, outbound, liveLevels]);

  /**
   * Kiểm tồn của phiếu xuất/chuyển. Ba trường hợp đều chặn xác nhận và nói rõ lý do:
   * không tải được tồn của kho, vật tư không có trong kho, tồn khả dụng không đủ.
   */
  const stockStatus = outbound && warehouseCode && items.length > 0 ? liveStock : undefined;
  const stockProblems = useMemo(
    () => (outbound && liveLevels ? checkOutboundLines(items, liveLevels) : []),
    [outbound, liveLevels, items],
  );
  const firstStockProblem = stockProblems.find((problem) => problem !== undefined);
  const stockBlockReason = !outbound || items.length === 0
    ? undefined
    : !stockStatus || stockStatus.code !== warehouseCode || stockStatus.status === 'loading'
      ? `Đang kiểm tra tồn kho ${warehouseCode}…`
      : stockStatus.status === 'error'
        ? `Không tải được tồn của kho ${warehouseCode}, chưa thể kiểm tra số lượng xuất.`
        : firstStockProblem
          ? describeStockProblem(firstStockProblem, warehouseCode, formatNumber)
          : undefined;
  const permissionError = !workspace.permissions?.canWriteTransactions
    ? 'Bạn không có quyền ghi giao dịch kho.'
    : !workspace.permissions.canManage && (
        (kind === 'issue' && issueTargetType === 'asset') ||
        items.some((item) => item.newMaterial || (kind === 'receipt' && item.serialNumbers?.length))
      )
      ? 'Tạo mã vật tư, khai sê-ri và xuất lắp đặt cần quyền quản lý kho.'
      : undefined;
  const hasInvalidSerialSelection = items.some((item) =>
    getTrackingMode(workspace.materials.find((candidate) => candidate.code === item.materialCode)) === 'SERIAL' &&
    (item.serialNumbers?.length ?? 0) !== item.quantity,
  );
  const hasInvalidLotAllocation = items.some((item) => {
    if (getTrackingMode(workspace.materials.find((candidate) => candidate.code === item.materialCode)) !== 'LOT') return false;
    if (kind === 'receipt') return !item.receiptLot?.lotNumber;
    // Phần không phân bổ xuất từ tồn không theo lô; server từ chối nếu phần đó không đủ.
    return (item.lotAllocations?.reduce((sum, lot) => sum + lot.quantity, 0) ?? 0) > item.quantity;
  });

  // Tổng hợp thống kê số lượng và số tiền
  const totalItemCount = items.length;
  const totalQuantity = useMemo(
    () => items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0),
    [items],
  );
  const totalCost = useMemo(
    () =>
      items.reduce(
        (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitCost) || 0),
        0,
      ),
    [items],
  );

  // Kiểm tra cảnh báo giữ chỗ cho các vật tư trong phiếu
  const reservedAlerts = useMemo(() => {
    if (!outbound || reservations.length === 0) return [];
    const itemCodes = new Set(items.map((i) => i.materialCode));
    const alerts: { code: string; name: string; reserved: number; orderCode?: string }[] = [];

    for (const r of reservations) {
      if (r.status !== 'PENDING' && r.status !== 'RESERVED' && r.status !== 'PARTIALLY_ISSUED') continue;
      for (const it of r.items ?? []) {
        const mat = workspace.materials.find((m) => m.id === it.materialId);
        if (mat && itemCodes.has(mat.code)) {
          const outstanding = it.quantityReserved - it.quantityIssued;
          if (outstanding > 0) {
            const wo = workOrders.find((w) => w.id === r.referenceId);
            alerts.push({
              code: mat.code,
              name: mat.name,
              reserved: outstanding,
              orderCode: wo?.code || r.reservationCode,
            });
          }
        }
      }
    }
    return alerts;
  }, [outbound, reservations, items, workspace.materials, workOrders]);

  const submitBlockReason = permissionError
    ? undefined
    : !warehouseCode
      ? 'Chưa chọn kho.'
      : kind === 'transfer' && (!toWarehouseCode || toWarehouseCode === warehouseCode)
        ? 'Chưa chọn kho đích khác kho nguồn.'
        : !note.trim()
          ? 'Cần nhập "Lý do thực hiện / Số hoá đơn / Số lệnh" ở phần đầu phiếu.'
          : stockBlockReason
            ? stockBlockReason
            : hasInvalidLotAllocation
              ? 'Có dòng chưa khai báo lô hoặc phân bổ lô vượt số lượng.'
              : hasInvalidSerialSelection
                ? 'Có dòng chưa chọn đủ số sê-ri.'
                : undefined;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (items.length === 0 || busy || submitBlockReason || permissionError) return;

    const firstItem = items[0];

    void send(() => onSubmit({
      kind,
      warehouseCode,
      toWarehouseCode: kind === 'transfer' ? toWarehouseCode : undefined,
      note: note.trim(),
      procedureDefinitionId: procedureDefinitionId || undefined,
      attachmentFile: selectedFile || undefined,
      targetAssetCode: kind === 'issue' && issueTargetType === 'asset' ? targetAssetCode : undefined,
      supplierName: kind === 'receipt' ? supplierName.trim() || undefined : undefined,
      supplierAddress: kind === 'receipt' ? supplierAddress.trim() || undefined : undefined,
      invoiceNumber: kind === 'receipt' ? invoiceNumber.trim() || undefined : undefined,
      counterparty: buildCounterparty({
        kind,
        supplierName,
        supplierAddress,
        invoiceNumber,
        issueTargetType,
        issueTargetName,
        targetAssetCode,
      }),
      // Chốt lần cuối: dù dòng nào mang kho khác thì phiếu vẫn chỉ ghi vào kho của phiếu.
      items: items.map((item) => ({ ...item, warehouseCode })),
      // Dữ liệu tương thích ngược cho single-item consumers
      materialCode: firstItem?.materialCode,
      quantity: firstItem?.quantity,
      unitCost: firstItem?.unitCost,
      serialNumbers: firstItem?.serialNumbers,
      newMaterial: firstItem?.newMaterial,
    }));
  };

  // Danh sách options cho SearchableSelect
  const warehouseOptions = useMemo(
    () =>
      workspace.warehouses.map((w) => ({
        value: w.code,
        label: w.name,
        badge: w.code,
      })),
    [workspace.warehouses],
  );

  const toWarehouseOptions = useMemo(
    () =>
      workspace.warehouses
        .filter((w) => w.code !== warehouseCode)
        .map((w) => ({
          value: w.code,
          label: w.name,
          badge: w.code,
        })),
    [workspace.warehouses, warehouseCode],
  );

  const assetOptions = useMemo(
    () =>
      workspace.assets.map((ast) => ({
        value: ast.code,
        label: ast.name,
        badge: ast.code,
      })),
    [workspace.assets],
  );

  const procedureOptions = useMemo(
    () =>
      procedures.map((p) => ({
        value: p.id,
        label: p.name,
        badge: p.code,
      })),
    [procedures],
  );

  const unitOptions = useMemo(() => {
    const list = units.length > 0 ? units : ['Cái'];
    return list.map((u) => ({
      value: u,
      label: u,
    }));
  }, [units]);

  const issueTargetTypeOptions = useMemo(
    () => [
      { value: 'department', label: 'Phòng ban' },
      { value: 'asset', label: 'Lắp vào Tài sản' },
      { value: 'customer', label: 'Khách hàng' },
      { value: 'project', label: 'Dự án / Công trình' },
    ],
    [],
  );

  const resolvedTitle =
    title ??
    (kind === 'receipt'
      ? 'Phiếu Nhập Kho Vật Tư'
      : kind === 'transfer'
        ? 'Lệnh Điều Chuyển Kho Nội Bộ'
        : 'Phiếu Xuất Kho Sử Dụng');

  const resolvedDescription =
    description ??
    (kind === 'receipt'
      ? 'Ghi nhận lô hàng mới, thiết bị mua sắm hoặc hoàn kho đa vật tư kèm đơn giá và danh sách sê-ri.'
      : kind === 'transfer'
        ? 'Điều chuyển nhiều mã vật tư, thiết bị dự phòng giữa các kho trực thuộc trong hệ thống.'
        : 'Xuất kho đa vật tư phục vụ sửa chữa, bảo dưỡng hoặc thay thế cho phòng ban / tài sản thiết bị.');

  const lotBaseItem = lotModalIndex !== null ? items[lotModalIndex] : undefined;
  const lotDirty =
    lotBaseItem !== undefined &&
    JSON.stringify([lotDraft, newLotDraft]) !==
      JSON.stringify([
        Object.fromEntries((lotBaseItem.lotAllocations ?? []).map((lot) => [lot.lotId, lot.quantity])),
        {
          lotNumber: lotBaseItem.receiptLot?.lotNumber ?? '',
          manufactureDate: lotBaseItem.receiptLot?.manufactureDate ?? '',
          expiryDate: lotBaseItem.receiptLot?.expiryDate ?? '',
          supplier: lotBaseItem.receiptLot?.supplier ?? '',
          coCqNumber: lotBaseItem.receiptLot?.coCqNumber ?? '',
        },
      ]);

  const dirtySnapshot = JSON.stringify([
    kind,
    warehouseCode,
    toWarehouseCode,
    issueTargetType,
    issueTargetName,
    supplierName,
    supplierAddress,
    invoiceNumber,
    targetAssetCode,
    procedureDefinitionId,
    note,
    selectedFile?.name ?? '',
    items,
  ]);
  const [initialSnapshot] = useState(dirtySnapshot);
  const isDirty = dirtySnapshot !== initialSnapshot;

  const FooterTag = isDialog ? DialogFooter : 'div';
  const BodyTag = isDialog ? DialogBody : 'div';

  const formContent = (
    <>
      {/* Header Form / Dialog */}
      {isDialog ? (
        <DialogHeader>
          <div>
            <DialogTitle>{resolvedTitle}</DialogTitle>
            <p className="mt-1 text-xs text-slate-500">{resolvedDescription}</p>
          </div>
          <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
            <DialogCloseButton />
          </CloseGuard>
        </DialogHeader>
      ) : (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-[20px] font-bold text-slate-900">
              {resolvedTitle}
            </h2>
            <p className="mt-1 mx-0 mb-0 text-[14px] text-slate-500">
              {resolvedDescription}
            </p>
          </div>
        </div>
      )}

      <BodyTag className={isDialog ? 'flex flex-col gap-4' : 'flex flex-col gap-4 overflow-y-auto p-0'}
      >
        {/* Thanh chuyển đổi nhanh Loại Phiếu */}
        <div className="flex items-center justify-between flex-wrap gap-2.5">
          <div
            className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-lg w-[fit-content]"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-auto rounded-md px-3.5 py-1.5 text-[13px] font-semibold',
                kind === 'receipt' ? 'bg-white text-green-800 shadow-sm hover:bg-white' : 'bg-transparent text-slate-500',
              )}
              onClick={() => setKind('receipt')}
            >
              Nhập kho
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-auto rounded-md px-3.5 py-1.5 text-[13px] font-semibold',
                kind === 'issue' ? 'bg-white text-blue-700 shadow-sm hover:bg-white' : 'bg-transparent text-slate-500',
              )}
              onClick={() => setKind('issue')}
            >
              Xuất kho
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-auto rounded-md px-3.5 py-1.5 text-[13px] font-semibold',
                kind === 'transfer' ? 'bg-white text-orange-900 shadow-sm hover:bg-white' : 'bg-transparent text-slate-500',
              )}
              onClick={() => setKind('transfer')}
            >
              Điều chuyển kho
            </Button>
          </div>

          <div className="flex items-center gap-2 text-[13px] text-slate-500">
            <FileText size={14} />
            <span>Mẫu phiếu đa đối tượng chuẩn ISO / ERP</span>
          </div>
        </div>

        {/* Khối Thông tin chung & Kho hàng (Header Grid) */}
        <div className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 max-[720px]:grid-cols-1 max-[720px]:gap-3">
          {/* Cột 1: Kho nguồn / Kho nhập mặc định */}
          <div className={FIELD_BLOCK}>
            <Label required>
              {kind === 'transfer' ? 'Kho nguồn xuất hàng' : kind === 'receipt' ? 'Kho tiếp nhận của phiếu' : 'Kho xuất của phiếu'}</Label>
            <SearchableSelect
              options={warehouseOptions}
              value={warehouseCode}
              placeholder="Tìm mã hoặc tên kho tiếp nhận..."
              emptyText="Không tìm thấy kho phù hợp"
              onChange={(val) => handleChangeDefaultWarehouse(val)}
              clearable={false}
              disabled={busy}
            />
          </div>

          {/* Cột 2: Kho đích (khi Chuyển kho) HOẶC Đối tượng nhận (khi Xuất kho) HOẶC Quy trình (khi Nhập kho) */}
          {kind === 'transfer' ? (
            <div className={FIELD_BLOCK}>
              <Label required>
                Kho đích tiếp nhận điều chuyển</Label>
              <SearchableSelect
                options={toWarehouseOptions}
                value={toWarehouseCode}
                placeholder="Tìm mã hoặc tên kho đích..."
                emptyText="Không tìm thấy kho đích phù hợp"
                onChange={(val) => setToWarehouseCode(val)}
                clearable={false}
                disabled={busy}
              />
            </div>
          ) : kind === 'issue' ? (
            <div className={FIELD_BLOCK}>
              <Label>Mục đích & Đối tượng xuất</Label>
              <div className="flex gap-2">
                <div className="w-37.5 shrink-0">
                  <SearchableSelect
                    options={issueTargetTypeOptions}
                    value={issueTargetType}
                    placeholder="Mục đích xuất..."
                    emptyText="Không tìm thấy"
                    onChange={(val) => setIssueTargetType((val as IssueTargetType) || 'department')}
                    clearable={false}
                    disabled={busy}
                  />
                </div>

                {issueTargetType === 'asset' ? (
                  <div className="flex-1 min-w-0">
                    <SearchableSelect
                      options={assetOptions}
                      value={targetAssetCode}
                      placeholder="Tìm mã hoặc tên thiết bị / tài sản đích..."
                      emptyText="Không tìm thấy tài sản đích phù hợp"
                      onChange={(val) => setTargetAssetCode(val)}
                      clearable
                      disabled={busy}
                    />
                  </div>
                ) : (
                  <Input
                    type="text"
                    className="flex-1"
                    value={issueTargetName}
                    onChange={(e) => setIssueTargetName(e.target.value)}
                    disabled={busy}
                    maxLength={255}
                    placeholder={
                      issueTargetType === 'department'
                        ? 'Tên phòng ban / đội thi công…'
                        : issueTargetType === 'customer'
                          ? 'Tên khách hàng…'
                          : 'Tên dự án / công trình…'
                    }
                  />
                )}
              </div>
            </div>
          ) : (
            <div className={FIELD_BLOCK}>
              <Label>Quy trình liên kết mở Work Order</Label>
              <SearchableSelect
                options={procedureOptions}
                value={procedureDefinitionId}
                placeholder={procedures.length === 0 ? '— Không có quy trình —' : '— Không mở Work Order (tự chọn) —'}
                emptyText="Không tìm thấy quy trình phù hợp"
                onChange={(val) => setProcedureDefinitionId(val)}
                clearable
                disabled={busy || procedures.length === 0}
              />
            </div>
          )}

          {/* Nơi nhập đến từ (chỉ phiếu nhập): lưu thành cột riêng của sổ cái */}
          {kind === 'receipt' ? (
            <>
              <div className={FIELD_BLOCK}>
                <Label>Nhà cung cấp / Đơn vị giao hàng</Label>
                <Input
                  type="text"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  disabled={busy}
                  maxLength={255}
                  placeholder="Tên nhà cung cấp…"
                />
              </div>
              <div className={FIELD_BLOCK}>
                <Label>Số hoá đơn / Chứng từ gốc</Label>
                <Input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  disabled={busy}
                  maxLength={100}
                  placeholder="VD: HD-2026-118"
                />
              </div>
              <div className={cn(FIELD_BLOCK, 'col-span-2 max-[720px]:col-auto')}>
                <Label>Địa chỉ nhà cung cấp</Label>
                <Input
                  type="text"
                  value={supplierAddress}
                  onChange={(e) => setSupplierAddress(e.target.value)}
                  disabled={busy}
                  placeholder="Địa chỉ giao hàng / xuất hoá đơn…"
                />
              </div>
            </>
          ) : null}

          {/* Cột 3: Lý do nghiệp vụ / Số hóa đơn */}
          <div className={cn(FIELD_BLOCK, 'col-span-2 max-[720px]:col-auto')}>
            <Label required>
              Lý do thực hiện / Số hoá đơn / Số lệnh</Label>
            <Input
              required
              type="text"
              placeholder="VD: Nhập theo Hóa đơn HD-2026-118, hoặc Xuất thay thế theo Lệnh PR-082…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {/* Cột 4: Khu vực đính kèm chứng từ */}
          <div className={cn(FIELD_BLOCK, 'col-span-2 max-[720px]:col-auto')}>
            <Label>Tệp chứng từ đính kèm (Biên bản giao nhận, Hoá đơn đỏ, Ảnh chụp...)</Label>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setSelectedFile(file);
              }}
            />
            <div
              className="flex min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 bg-white px-3.5 py-2.5 transition-colors hover:border-blue-600 hover:bg-slate-50 [&>div]:min-w-0 [&>div]:flex-wrap"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files?.[0]) {
                  setSelectedFile(e.dataTransfer.files[0]);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              {selectedFile ? (
                <div
                  className="flex items-center justify-between py-1.5 px-3 bg-blue-50 border border-blue-200 rounded-md text-[13px] text-blue-700"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Paperclip size={15} color="#2563eb" />
                  <span className="font-semibold text-slate-800">{selectedFile.name}</span>
                  <span className="text-slate-500 text-[12px]">
                    ({Math.round(selectedFile.size / 1024)} KB)
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-slate-500 hover:bg-red-100 hover:text-red-600"
                    onClick={() => {
                      setSelectedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    title="Xoá tệp đính kèm"
                  >
                    <X size={14} />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-slate-500 text-[13px]">
                  <Upload size={16} color="#64748b" />
                  <span>Kéo thả tệp chứng từ vào đây hoặc </span>
                  <Button type="button" variant="link" size="xs" className="h-auto p-0 font-semibold">
                    chọn từ máy tính
                  </Button>
                  <span className="text-slate-400 text-[12px]">(Hỗ trợ PDF, Excel, JPG, PNG tối đa 25MB)</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Khối Danh mục vật tư đa đối tượng */}
        <div className="flex flex-col gap-2.5">
          {/* Tiêu đề danh sách vật tư */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="m-0 text-[14px] font-bold text-slate-800">
                Danh sách vật tư / hàng hoá trên phiếu
              </h3>
              <Badge variant="secondary" className="h-auto bg-sky-100 px-2 py-0.5 text-[13px] font-semibold text-sky-700">
                {items.length} vật tư
              </Badge>
            </div>
          </div>

          {/* Thanh công cụ: Filter + Thêm từ Excel + Thêm vật tư mới (cùng 1 hàng) */}
          <div className="flex items-center gap-2 w-full">
            <div className="flex-1 min-w-0">
              <SearchableMaterialCombobox
                materials={workspace.materials}
                excludedCodes={items.map((i) => i.materialCode)}
                onSelectMaterial={handleSelectMaterial}
                onOpenNewMaterial={() => setShowNewMaterialModal(true)}
              />
            </div>

            <Button
              type="button"
              variant="outline"
              className="h-9 shrink-0 gap-1.5 border-green-200 bg-green-50 px-3.5 text-[13px] font-semibold text-green-700 hover:border-green-300 hover:bg-green-100 hover:text-green-800"

              onClick={() => setShowExcelImport(true)}
              title="Import danh sách vật tư từ file Excel"
            >
              <FileSpreadsheet size={15} />
              <span>Thêm từ Excel</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              className="h-9 shrink-0 gap-1.5 border-blue-200 bg-blue-50 px-3.5 text-[13px] font-semibold text-blue-700 hover:border-blue-300 hover:bg-blue-100 hover:text-blue-800"

              onClick={() => setShowNewMaterialModal(true)}
              title="Tạo nhanh mã vật tư mới vào danh mục"
            >
              <Plus size={15} />
              <span>Thêm vật tư mới</span>
            </Button>
          </div>

          {/* Cảnh báo nếu có mặt hàng đang bị giữ chỗ cho Work Order */}
          {reservedAlerts.length > 0 ? (
            <div
              className="flex items-center gap-2 py-2 px-3 rounded-md bg-amber-50 border border-amber-200 text-amber-700 text-[13px]"
            >
              <AlertTriangle size={16} color="#d97706" className="shrink-0" />
              <span>
                <strong>Lưu ý giữ chỗ:</strong> Có {reservedAlerts.length} vật tư đang được giữ chỗ cho Lệnh công tác ({reservedAlerts.map((a) => `${a.name}: ${a.reserved} cái`).join(', ')}). Vui lòng kiểm tra tồn khả dụng trước khi xuất.
              </span>
            </div>
          ) : null}

          {warehouseNotice ? (
            <p role="status" className="m-0 py-2 px-3 rounded-md bg-blue-50 border border-blue-200 text-blue-700 text-[13px]">
              {warehouseNotice}
            </p>
          ) : null}

          {/* Bảng Danh sách vật tư (Multi-item Grid Table) */}
          <div className="relative max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white [scrollbar-color:#cbd5e1_#f8fafc] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:rounded [&::-webkit-scrollbar-track]:bg-slate-50">
            <Table className="min-w-[980px] border-separate border-spacing-0 text-[13px]">
              <TableHead>
                <TableRow className="group/row hover:bg-transparent">
                  <TableHeaderCell className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-[9px] text-[12px] font-bold uppercase tracking-[0.04em] text-slate-600 w-10 text-center">STT</TableHeaderCell>
                  <TableHeaderCell className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-[9px] text-[12px] font-bold uppercase tracking-[0.04em] text-slate-600 min-w-50">Mã &amp; Tên vật tư</TableHeaderCell>
                  <TableHeaderCell className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-[9px] text-[12px] font-bold uppercase tracking-[0.04em] text-slate-600 w-[65px] text-center">ĐVT</TableHeaderCell>
                  <TableHeaderCell className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-[9px] text-[12px] font-bold uppercase tracking-[0.04em] text-slate-600 w-22.5 text-right">Số lượng</TableHeaderCell>
                  <TableHeaderCell className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-[9px] text-[12px] font-bold uppercase tracking-[0.04em] text-slate-600 min-w-32.5">Thuộc nhóm</TableHeaderCell>
                  <TableHeaderCell className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-[9px] text-[12px] font-bold uppercase tracking-[0.04em] text-slate-600 w-35">Tình trạng kho</TableHeaderCell>
                  {kind === 'receipt' ? (
                    <>
                      <TableHeaderCell className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-[9px] text-[12px] font-bold uppercase tracking-[0.04em] text-slate-600 w-27.5 text-right">Đơn giá (VNĐ)</TableHeaderCell>
                      <TableHeaderCell className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-[9px] text-[12px] font-bold uppercase tracking-[0.04em] text-slate-600 w-30 text-right">Thành tiền</TableHeaderCell>
                    </>
                  ) : null}
                  <TableHeaderCell className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-[9px] text-[12px] font-bold uppercase tracking-[0.04em] text-slate-600 w-29.5 text-center">Theo dõi định danh</TableHeaderCell>
                  <TableHeaderCell className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-[9px] text-[12px] font-bold uppercase tracking-[0.04em] text-slate-600 min-w-32.5">Ghi chú dòng</TableHeaderCell>
                  <TableHeaderCell className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-[9px] text-[12px] font-bold uppercase tracking-[0.04em] text-slate-600 w-12.5 text-center">Xoá</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item, index) => {
                  const analysis = lineStockAnalysis[index];
                  const lineTotal = (Number(item.quantity) || 0) * (Number(item.unitCost) || 0);
                  const serialCount = item.serialNumbers?.length || 0;
                  const lotCount = item.lotAllocations?.length || (item.receiptLot ? 1 : 0);
                  const allocatedLotQuantity = item.lotAllocations?.reduce((sum, lot) => sum + lot.quantity, 0) ?? 0;
                  const trackingMode = getTrackingMode(workspace.materials.find((material) => material.code === item.materialCode));
                  const itemUnitConfig = getUnitQuantityConfig(item.unit);
                  const itemMaterial = workspace.materials.find((m) => m.code === item.materialCode);
                  const itemType = item.materialType || itemMaterial?.type || '—';

                  return (
                    <TableRow
                      key={item.id}
                      className={cn('group/row hover:bg-transparent', analysis?.isOverdraw && 'bg-red-50')}
                    >
                      <TableCell className="border-b border-slate-100 bg-white px-2.5 py-2 align-middle group-hover/row:bg-[#fafafa] text-center text-slate-500 font-semibold text-[13px]">
                        {index + 1}
                      </TableCell>
                      <TableCell className="border-b border-slate-100 bg-white px-2.5 py-2 align-middle group-hover/row:bg-[#fafafa]">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-900 text-[14px]">
                              {item.materialCode}
                            </span>
                            {item.newMaterial ? (
                              <span className="text-[12px] bg-green-100 text-green-700 py-[1px] px-[5px] rounded-sm font-semibold">
                                MỚI
                              </span>
                            ) : null}
                          </div>
                          <span className="text-[13px] text-slate-600">
                            {item.materialName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="border-b border-slate-100 bg-white px-2.5 py-2 align-middle group-hover/row:bg-[#fafafa] text-center text-slate-600 text-[13px]">
                        {item.unit}
                      </TableCell>
                      <TableCell className="border-b border-slate-100 bg-white px-2.5 py-2 align-middle group-hover/row:bg-[#fafafa]">
                        <VnNumberInput
                          maxDecimals={itemUnitConfig.step === '1' ? 0 : 2}
                          className={cn('h-8 px-2 text-[13px] text-right', analysis?.isOverdraw && 'border-red-500 bg-white')}
                          value={item.quantity === 0 ? '' : String(item.quantity)}
                          onChange={(value) => handleUpdateQuantity(index, Number(value))}
                        />
                      </TableCell>
                      <TableCell className="border-b border-slate-100 bg-white px-2.5 py-2 align-middle group-hover/row:bg-[#fafafa] min-w-32.5">
                        <span className="text-[12px] text-slate-600 bg-slate-100 py-0.5 px-2 rounded-sm inline-block">
                          {itemType}
                        </span>
                      </TableCell>
                      <TableCell className="border-b border-slate-100 bg-white px-2.5 py-2 align-middle group-hover/row:bg-[#fafafa]">
                        <Badge
                          variant="outline"
                          className={cn(
                            'h-auto px-[7px] py-0.5 text-[12px] font-semibold',
                            analysis?.badgeType === 'ok'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                              : analysis?.badgeType === 'shared'
                                ? 'border-amber-200 bg-amber-50 text-amber-600'
                                : 'border-red-200 bg-red-50 text-red-600',
                          )}
                          title={analysis?.badgeLabel}
                        >
                          {analysis?.badgeLabel}
                        </Badge>
                      </TableCell>
                      {kind === 'receipt' ? (
                        <>
                          <TableCell className="border-b border-slate-100 bg-white px-2.5 py-2 align-middle group-hover/row:bg-[#fafafa]">
                            <VnNumberInput
                              placeholder="0"
                              className="h-8 px-2 text-[13px]"
                              value={item.unitCost === undefined ? '' : String(item.unitCost)}
                              onChange={(value) => handleUpdateUnitCost(index, value ? Number(value) : undefined)}
                            />
                          </TableCell>
                          <TableCell className="border-b border-slate-100 bg-white px-2.5 py-2 align-middle group-hover/row:bg-[#fafafa] text-right font-semibold text-slate-800 text-[13px]">
                            {formatNumber(lineTotal)} đ
                          </TableCell>
                        </>
                      ) : null}
                      <TableCell className="border-b border-slate-100 bg-white px-2.5 py-2 align-middle group-hover/row:bg-[#fafafa] text-center">
                        {trackingMode === 'LOT' ? (
                          <>
                            <Button
                              type="button"
                              onClick={() => handleOpenLotModal(index)}
                              variant="outline"
                              size="xs"
                              className={cn(
                                'h-auto gap-1 rounded-sm px-2 py-[3px] text-[12px] font-semibold',
                                lotCount > 0 ? 'border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100' : 'bg-slate-50 text-slate-500',
                              )}
                              title={kind === 'receipt' ? 'Khai báo lô hàng nhận vào' : 'Chọn lô hàng để xuất / điều chuyển'}
                            >
                              <Layers size={13} />
                              <span>{lotCount > 0 ? `${lotCount} lô` : 'Lô hàng'}</span>
                            </Button>
                            {outbound && lotCount > 0 && allocatedLotQuantity !== item.quantity ? <div className="mt-[3px] text-[12px] text-amber-700">Theo lô {formatNumber(allocatedLotQuantity)}/{formatNumber(item.quantity)}</div> : null}
                          </>
                        ) : trackingMode === 'SERIAL' ? (
                          <Button
                            type="button"
                            onClick={() => handleOpenSerialModal(index)}
                            variant="outline"
                            size="xs"
                            className={cn(
                              'h-auto gap-1 rounded-sm px-2 py-[3px] text-[12px] font-semibold',
                              serialCount > 0 ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-slate-50 text-slate-500',
                            )}
                            title="Nhập danh sách số sê-ri / barcode cho dòng này"
                          >
                            <Barcode size={13} />
                            <span>{serialCount > 0 ? `${serialCount} Sê-ri` : 'Sê-ri'}</span>
                          </Button>
                        ) : (
                          <span className="text-[12px] text-slate-400">Không theo dõi</span>
                        )}
                      </TableCell>
                      <TableCell className="border-b border-slate-100 bg-white px-2.5 py-2 align-middle group-hover/row:bg-[#fafafa]">
                        <Input
                          type="text"
                          placeholder="Ghi chú dòng…"
                          className="h-8 px-2 text-[13px]"
                          value={item.lineNote ?? ''}
                          onChange={(e) => handleUpdateLineNote(index, e.target.value)}
                        />
                      </TableCell>
                      <TableCell className="border-b border-slate-100 bg-white px-2.5 py-2 align-middle group-hover/row:bg-[#fafafa] text-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-slate-400 hover:bg-red-100 hover:text-red-600"
                          onClick={() => handleRemoveItem(index)}
                          title="Xoá dòng này khỏi phiếu"
                        >
                          <Trash2 size={15} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}

                {items.length === 0 ? (
                  <TableRow className="group/row hover:bg-transparent">
                    <TableCell
                      colSpan={kind === 'receipt' ? 10 : 8}
                      className="px-4 py-8 text-center text-[14px] text-slate-500"
                    >
                      <Layers size={28} color="#94a3b8" className="mb-1.5 inline-block" />
                      <div>Chưa có vật tư nào trên phiếu.</div>
                      <div className="text-[13px] text-slate-400 mt-0.5">
                        Sử dụng thanh tìm kiếm phía trên để thêm các mặt hàng cần tác nghiệp vào phiếu.
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>

            {/* Bảng tổng kết số liệu (Grid Footer Summary) */}
            {items.length > 0 ? (
              <div className="flex items-center justify-between py-2.5 px-4 bg-slate-50 border-t border-t-slate-200 text-[13px] text-slate-600 flex-wrap gap-2">
                <div className="flex flex-wrap items-center gap-4 text-[13px] [&_strong]:font-bold [&_strong]:text-slate-900">
                  <span>Số loại vật tư: <strong>{totalItemCount}</strong></span>
                  <span>Tổng số lượng xuất/nhập: <strong>{formatNumber(totalQuantity)}</strong></span>
                  {kind === 'receipt' ? (
                    <span className="text-green-800">
                      Tổng giá trị nhập: <strong>{formatNumber(totalCost)} VNĐ</strong>
                    </span>
                  ) : null}
                </div>

                {stockBlockReason ? (
                  <div className={cn('flex items-center gap-1.5 text-[13px] font-semibold', stockStatus?.status === 'loading' || !stockStatus ? 'text-amber-700' : 'text-red-600')}>
                    <AlertTriangle size={15} />
                    <span>{stockBlockReason}</span>
                  </div>
                ) : hasInvalidLotAllocation ? (
                  <div className="flex items-center gap-1.5 text-amber-700 text-[13px] font-semibold">
                    <AlertTriangle size={15} />
                    <span>Phiếu nhập phải khai báo lô; phiếu xuất không được phân bổ lô vượt số lượng.</span>
                  </div>
                ) : hasInvalidSerialSelection ? (
                  <div className="flex items-center gap-1.5 text-amber-700 text-[13px] font-semibold">
                    <AlertTriangle size={15} />
                    <span>Vật tư quản lý theo sê-ri phải khai đủ một số sê-ri cho mỗi đơn vị trên phiếu.</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-green-800 text-[13px] font-semibold">
                    <CheckCircle2 size={15} />
                    <span>Dữ liệu hợp lệ, sẵn sàng ghi sổ kho</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </BodyTag>

      {/* Modal Con: Phân bổ Lô hàng */}
      {lotModalIndex !== null && items[lotModalIndex] ? (
        <Dialog onEscape={lotDirty ? undefined : () => setLotModalIndex(null)}>
          <DialogContent
            className="z-1100 max-w-155"
            backdropClassName="z-1100"
            aria-label={kind === 'receipt' ? 'Khai báo lô hàng nhập' : 'Phân bổ lô hàng xuất'}
          >
            <DialogHeader>
              <div className="min-w-0">
                <DialogTitle>{kind === 'receipt' ? 'Khai báo lô hàng nhập' : 'Phân bổ lô hàng xuất'}</DialogTitle>
                <p className="mt-1 text-xs text-slate-500 [overflow-wrap:anywhere]">{items[lotModalIndex].materialCode} — {items[lotModalIndex].materialName} · Số lượng phiếu: {formatNumber(items[lotModalIndex].quantity)} {items[lotModalIndex].unit}</p>
              </div>
              <CloseGuard dirty={lotDirty} onClose={() => setLotModalIndex(null)}>
                <DialogCloseButton />
              </CloseGuard>
            </DialogHeader>
            <DialogBody>
            {kind === 'receipt' ? (
              <div className="grid grid-cols-[repeat(2,_minmax(0,_1fr))] gap-4">
                <div className={FIELD_BLOCK}>
                  <Label required>
                    Mã lô</Label>
                  <Input
                    autoFocus
                    value={newLotDraft.lotNumber}
                    placeholder="VD: LOT-2026-001"
                    onChange={(event) =>
                      setNewLotDraft((draft) => ({ ...draft, lotNumber: event.target.value }))
                    }
                  />
                </div>
                <div className={FIELD_BLOCK}>
                  <Label>Số CO/CQ</Label>
                  <Input
                    value={newLotDraft.coCqNumber}
                    placeholder="VD: CO-2026-01"
                    onChange={(event) =>
                      setNewLotDraft((draft) => ({ ...draft, coCqNumber: event.target.value }))
                    }
                  />
                </div>
                <div className={FIELD_BLOCK}>
                  <Label>Ngày sản xuất</Label>
                  <DatePickerInput
                    value={newLotDraft.manufactureDate}
                    onChange={(value) =>
                      setNewLotDraft((draft) => ({ ...draft, manufactureDate: value }))
                    }
                    height={36}
                  />
                </div>
                <div className={FIELD_BLOCK}>
                  <Label>Hạn sử dụng</Label>
                  <DatePickerInput
                    value={newLotDraft.expiryDate}
                    onChange={(value) =>
                      setNewLotDraft((draft) => ({ ...draft, expiryDate: value }))
                    }
                    height={36}
                  />
                </div>
                <div className={`flex min-w-0 flex-col gap-1 [&>div]:min-w-0 col-span-full`}>
                  <Label>Nhà cung cấp</Label>
                  <Input
                    value={newLotDraft.supplier}
                    placeholder="VD: Schneider Electric, ABB…"
                    onChange={(event) =>
                      setNewLotDraft((draft) => ({ ...draft, supplier: event.target.value }))
                    }
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-82.5 overflow-y-auto">
                {lotChoices(lotsByMaterial[items[lotModalIndex].materialCode] ?? [], items[lotModalIndex].warehouseCode || warehouseCode, kind).map(({ lot, available }) => (
                  <div key={lot.id} className="grid grid-cols-[1fr_110px] gap-3 items-center p-2.5 border border-slate-200 rounded-md bg-slate-50">
                    <div><strong className="text-violet-800">{lot.lotNo}</strong><div className="text-slate-500 text-[12px] mt-0.5">Khả dụng: {formatNumber(available)} {items[lotModalIndex].unit}{lot.expiresOn ? ` · HSD ${formatDate(lot.expiresOn)}` : ''}{lot.qualityStatus !== 'PASSED' ? ` · ${QUALITY_STATUS_LABEL[lot.qualityStatus]}` : ''}</div></div>
                    <Input type="number" min={0} max={available} className="h-8 px-2 text-[13px] text-right"  value={lotDraft[lot.id] ?? ''} placeholder="0" onChange={(event) => setLotDraft((draft) => ({ ...draft, [lot.id]: Math.min(available, Math.max(0, Number(event.target.value) || 0)) }))} />
                  </div>
                ))}
                {lotChoices(lotsByMaterial[items[lotModalIndex].materialCode] ?? [], items[lotModalIndex].warehouseCode || warehouseCode, kind).length === 0 ? <p className="my-2 mx-0 text-slate-500 text-[14px]">Chưa có lô dùng được tại kho này. Phần không chọn lô sẽ lấy từ tồn không theo lô.</p> : null}
              </div>
            )}
            </DialogBody>
            <DialogFooter>
              <CloseGuard dirty={lotDirty} onClose={() => setLotModalIndex(null)}>
                <Button type="button" variant="outline">Huỷ</Button>
              </CloseGuard>
              <Button type="button" disabled={kind === 'receipt' && !newLotDraft.lotNumber.trim()} onClick={handleSaveLots}>Lưu phân bổ lô</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Modal Con: Nhập Danh Sách Sê-ri */}
      {serialModalIndex !== null && items[serialModalIndex] ? (
        <Dialog onEscape={() => setSerialModalIndex(null)}>
          <DialogContent className="z-1100 max-w-130" backdropClassName="z-1100" aria-label="Khai báo Sê-ri / Barcode">
            <DialogHeader>
              <div>
                <DialogTitle>Khai báo Sê-ri / Barcode</DialogTitle>
                <p className="mt-0.5 text-xs text-slate-500">
                  {items[serialModalIndex].materialCode} — {items[serialModalIndex].materialName}
                </p>
              </div>
              <DialogCloseButton onClick={() => setSerialModalIndex(null)} />
            </DialogHeader>

            <DialogBody className="flex flex-col gap-2">
              <Label>
                Danh sách số Sê-ri (mỗi dòng một số, hoặc ngăn cách bằng dấu phẩy):
              </Label>
              <Textarea
                rows={6}
                className="font-mono"
                placeholder="VD:\nSN-2026-001\nSN-2026-002\nSN-2026-003"
                value={serialDraft}
                onChange={(e) => setSerialDraft(e.target.value)}
              />
              <div className="flex justify-between items-center text-[13px] text-slate-500">
                <span>
                  Đã nhận diện: <strong>{parseSerials(serialDraft).length}</strong> sê-ri / Cần: <strong>{items[serialModalIndex].quantity}</strong> cái
                </span>
                {parseSerials(serialDraft).length !== items[serialModalIndex].quantity ? (
                  <span className="text-amber-600 text-[12px]">
                    ℹ Lưu sẽ tự động đồng bộ số lượng dòng
                  </span>
                ) : null}
              </div>
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSerialModalIndex(null)}>
                Huỷ
              </Button>
              <Button type="button" onClick={handleSaveSerials}>
                Xác nhận lưu sê-ri
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Modal Con: Tạo Nhanh Vật Tư Mới */}
      {showNewMaterialModal ? (
        <Dialog onEscape={() => setShowNewMaterialModal(false)}>
          <DialogContent className="z-1100 max-w-140" backdropClassName="z-1100" aria-label="Khai báo vật tư mới vào danh mục">
            <DialogHeader>
              <div>
                <DialogTitle>Khai báo vật tư mới vào danh mục</DialogTitle>
                <p className="mt-0.5 text-xs text-slate-500">
                  Vật tư này sẽ được tạo trong danh mục và tự động thêm vào phiếu hiện tại.
                </p>
              </div>
              <DialogCloseButton onClick={() => setShowNewMaterialModal(false)} />
            </DialogHeader>

            <DialogBody className="grid grid-cols-[1fr_1fr] gap-3 [align-content:start]">
              <div className={FIELD_BLOCK}>
                <Label required>
                  Mã SKU vật tư</Label>
                <Input
                  type="text"
                  required
                  placeholder="VD: VT-BIEN-AP-01"
                  value={draftMaterial.code}
                  onChange={(e) =>
                    setDraftMaterial((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))
                  }
                />
              </div>

              <div className={FIELD_BLOCK}>
                <Label required>
                  Đơn vị tính</Label>
                <SearchableSelect
                  options={unitOptions}
                  value={draftMaterial.unit}
                  placeholder="Tìm hoặc chọn ĐVT..."
                  emptyText="Không tìm thấy đơn vị"
                  onChange={(val) => setDraftMaterial((prev) => ({ ...prev, unit: val }))}
                  clearable={false}
                />
              </div>

              <div className={cn(FIELD_BLOCK, 'col-span-2')}>
                <Label required>
                  Tên đầy đủ của vật tư</Label>
                <Input
                  type="text"
                  required
                  placeholder="VD: Dầu làm mát máy biến áp tiêu chuẩn IEC"
                  value={draftMaterial.name}
                  onChange={(e) =>
                    setDraftMaterial((prev) => ({ ...prev, name: e.target.value }))
                  }
                />
              </div>

              <div className={cn(FIELD_BLOCK, 'col-span-2')}>
                <Label>Thuộc nhóm vật tư</Label>
                <SearchableSelect
                  options={typeOptions}
                  value={draftMaterial.type}
                  placeholder="Tìm hoặc chọn nhóm vật tư..."
                  emptyText="Không tìm thấy nhóm"
                  onChange={(val) => setDraftMaterial((prev) => ({ ...prev, type: val }))}
                  clearable={false}
                />
              </div>

              <div className={cn(FIELD_BLOCK, 'col-span-2')}>
                <Label>Mức tồn kho an toàn tối thiểu</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={draftMaterial.minStock}
                  onChange={(e) =>
                    setDraftMaterial((prev) => ({ ...prev, minStock: e.target.value }))
                  }
                />
              </div>
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowNewMaterialModal(false)}>
                Huỷ
              </Button>
              <Button
                type="button"
                disabled={!draftMaterial.code.trim() || !draftMaterial.name.trim()}
                onClick={handleCreateNewMaterial}
              >
                + Thêm vào phiếu
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {showExcelImport ? (
        <ExcelImportDialog
          warehouses={workspace.warehouses}
          materials={workspace.materials}
          movementKind={kind}
          defaultWarehouseCode={warehouseCode}
          isSingleWarehouseOnly={true}
          onCancel={() => setShowExcelImport(false)}
          onImportItems={handleImportItems}
        />
      ) : null}

      {/* Footer Actions của Phiếu */}
      {permissionError || submitBlockReason ? (
        <p role="alert" className="mb-4 rounded-[0.65rem] border border-red-200 bg-red-50 px-4 py-[0.8rem] text-red-800">
          {permissionError ?? submitBlockReason}
          {!permissionError && stockStatus?.status === 'error' ? (
            <>
              {' '}
              <Button
                type="button"
                variant="link"
                size="xs"
                className="h-auto p-0 text-sm font-bold text-blue-700"
                onClick={() => setStockReloadKey((key) => key + 1)}
              >
                Thử lại
              </Button>
            </>
          ) : null}
        </p>
      ) : null}
      <FormError error={error} style={{ margin: '0 0 1rem' }} />
      <FooterTag className={isDialog ? 'justify-between' : 'mt-2 flex items-center justify-between border-t border-slate-200 pt-4'}
      >
        <div className="flex items-center gap-2">
          <Info size={15} color="#64748b" />
          <span className="text-[13px] text-slate-500">
            Phiếu có <strong>{items.length}</strong> vật tư · Tổng <strong>{formatNumber(totalQuantity)}</strong> đơn vị.
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <CloseGuard dirty={isDirty} busy={busy} onClose={onCancel}>
            <Button type="button" variant="outline">
              Huỷ
            </Button>
          </CloseGuard>
          <Button
            type="submit"
            disabled={
              Boolean(permissionError) ||
              busy ||
              Boolean(stockBlockReason) ||
              hasInvalidLotAllocation ||
              hasInvalidSerialSelection ||
              items.length === 0 ||
              !warehouseCode ||
              !note.trim() ||
              (kind === 'transfer' && (!toWarehouseCode || toWarehouseCode === warehouseCode))
            }
          >
            {busy
              ? 'Đang ghi sổ…'
              : `Xác nhận ${KIND_LABEL[kind]} (${items.length} mặt hàng)`}
          </Button>
        </div>
      </FooterTag>
    </>
  );

  if (isDialog) {
    return (
      <Dialog>
        <DialogContent className="w-[95vw] max-w-265" aria-label={resolvedTitle}>
          <form onSubmit={submit} className="flex min-h-0 flex-col">
            {formContent}
          </form>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <form
      className="rounded-2xl border border-slate-200 bg-white px-[clamp(1rem,2vw,1.5rem)] py-[1.2rem] shadow-sm flex flex-col gap-4"
      onSubmit={submit}
      
    >
      {formContent}
    </form>
  );
}
