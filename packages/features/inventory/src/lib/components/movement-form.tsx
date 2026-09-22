'use client';

import type {
  Material,
  Reservation,
  LotTracking,
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
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { useMemo, useRef, useState, useEffect, type FormEvent } from 'react';
import type {
  InventoryWorkspace,
  ProcedureOption,
  ProcedureWorkOrder,
} from '../inventory-api';
import { loadLots } from '../inventory-api';
import { formatNumber, getUnitQuantityConfig } from '../inventory-labels';
import { ExcelImportDialog } from './excel-import-dialog';
import styles from '../inventory.module.scss';

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
  /** Thông tin lô mới, dùng khi nhập kho. */
  readonly receiptLot?: Pick<LotTracking, 'lotNumber' | 'manufactureDate' | 'expiryDate' | 'supplier' | 'coCqNumber' | 'status'>;
  readonly lineNote?: string;
  readonly newMaterial?: {
    readonly code: string;
    readonly name: string;
    readonly unit: string;
    readonly minStock: number;
  };
}
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
  /** Mã thiết bị đích khi xuất lắp đặt/thay thế phụ tùng (cộng vào 'Đang sử dụng' thay vì xuất tiêu hao) */
  readonly targetAssetCode?: string;
  /** Danh sách các dòng vật tư đa đối tượng của phiếu */
  readonly items: readonly MovementLineItem[];
  /** Mã cần tạo trước khi ghi phiếu, khi người dùng chọn "+ Vật tư mới…". */
  readonly newMaterial?: {
    readonly code: string;
    readonly name: string;
    readonly unit: string;
    readonly minStock: number;
  };
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
  stock,
  excludedCodes = [],
  onSelectMaterial,
  onOpenNewMaterial,
}: {
  materials: readonly Material[];
  stock: InventoryWorkspace['stock'];
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
    <div className={styles.comboboxWrapper} ref={wrapperRef}>
      <div className={styles.comboboxInputWrapper}>
        <Search size={15} className={styles.comboboxSearchIcon} />
        <input
          type="text"
          className={styles.comboboxInput}
          placeholder="Tìm mã hoặc tên vật tư để thêm vào phiếu (hỗ trợ tiếng Việt không dấu)..."
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setOpen(false);
            }}
            style={{
              position: 'absolute',
              right: '10px',
              border: 'none',
              background: 'transparent',
              color: '#94a3b8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {open ? (
        <ul className={styles.comboboxMenu}>
          {filtered.map((item, idx) => {
            const availTotal = stock
              .filter((s) => s.materialCode === item.code)
              .reduce((sum, s) => sum + s.available, 0);

            return (
              <li
                key={item.code}
                className={`${styles.comboboxItem} ${idx === activeIndex ? styles.comboboxItemActive : ''
                  }`}
                onMouseDown={() => handleSelect(item)}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <div className={styles.comboboxItemContent}>
                  <div>
                    <span className={styles.comboboxItemCode}>{item.code}</span>
                    <span style={{ margin: '0 6px', color: '#cbd5e1' }}>—</span>
                    <span style={{ fontWeight: 600, color: '#1e293b' }}>{item.name}</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                    ĐVT: <strong style={{ color: '#334155' }}>{item.unit || 'Cái'}</strong>
                    {item.isSerialized ? (
                      <span style={{ marginLeft: '8px', color: '#2563eb', fontWeight: 600 }}>
                        • Quản lý sê-ri
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className={styles.comboboxItemStock}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: availTotal > 0 ? '#ecfdf5' : '#fef2f2',
                      color: availTotal > 0 ? '#059669' : '#dc2626',
                      fontWeight: 600,
                      fontSize: '11px',
                    }}
                  >
                    Tồn: {formatNumber(availTotal)} {item.unit}
                  </span>
                </div>
              </li>
            );
          })}

          {filtered.length === 0 ? (
            <li
              style={{
                padding: '12px',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '12.5px',
              }}
            >
              {query
                ? `Không tìm thấy vật tư nào khớp với từ khoá "${query}" (hoặc đã có trên phiếu)`
                : 'Tất cả vật tư phù hợp đã được thêm vào phiếu'}
            </li>
          ) : null}

          {onOpenNewMaterial ? (
            <li
              style={{
                borderTop: '1px solid #f1f5f9',
                padding: '8px 12px',
                background: '#f8fafc',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: '#2563eb',
                fontWeight: 600,
                fontSize: '12.5px',
              }}
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
  title,
  description,
  procedures = [],
  units = [],
  reservations = [],
  workOrders = [],
  busy,
  isDialog = false,
  onCancel,
  onSubmit,
}: {
  workspace: InventoryWorkspace;
  initialKind?: MovementKind;
  initialMaterialCode?: string;
  initialQuantity?: number | string;
  initialNote?: string;
  initialWarehouseCode?: string;
  title?: string;
  description?: string;
  /** Quy trình đã công bố, để mở work order kèm lệnh kho. */
  procedures?: readonly ProcedureOption[];
  /** Danh mục đơn vị tính, cho ô tạo mã mới. */
  units?: readonly string[];
  /** Phiếu giữ chỗ, để hiện mã nào đang có người chờ. */
  reservations?: readonly Reservation[];
  /** Hồ sơ bên Quy trình, để gọi tên work order thay vì hiện id. */
  workOrders?: readonly ProcedureWorkOrder[];
  busy: boolean;
  isDialog?: boolean;
  onCancel: () => void;
  onSubmit: (input: MovementInput) => void;
}) {
  const [kind, setKind] = useState<MovementKind>(initialKind);
  const [warehouseCode, setWarehouseCode] = useState<string>(() => {
    if (initialWarehouseCode) return initialWarehouseCode;
    return workspace.warehouses[0]?.code ?? '';
  });
  const [toWarehouseCode, setToWarehouseCode] = useState<string>('');
  const [issueTargetType, setIssueTargetType] = useState<'department' | 'asset' | 'customer'>('department');
  const [targetAssetCode, setTargetAssetCode] = useState<string>('');
  const [procedureDefinitionId, setProcedureDefinitionId] = useState('');
  const [note, setNote] = useState(initialNote ?? '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showExcelImport, setShowExcelImport] = useState(false);

  // Danh sách các dòng vật tư trong phiếu
  const [items, setItems] = useState<MovementLineItem[]>(() => {
    if (initialMaterialCode) {
      const mat = workspace.materials.find((m) => m.code === initialMaterialCode);
      return [
        {
          id: `item-${Date.now()}-0`,
          materialCode: initialMaterialCode,
          materialName: mat?.name || initialMaterialCode,
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
  const [lotsByMaterial, setLotsByMaterial] = useState<Record<string, LotTracking[]>>({});
  const [lotDraft, setLotDraft] = useState<Record<string, number>>({});
  const [newLotDraft, setNewLotDraft] = useState({ lotNumber: '', manufactureDate: '', expiryDate: '', supplier: '', coCqNumber: '' });

  // Modal tạo nhanh mã vật tư mới
  const [showNewMaterialModal, setShowNewMaterialModal] = useState(false);
  const [draftMaterial, setDraftMaterial] = useState({
    code: '',
    name: '',
    unit: units[0] || 'Cái',
    minStock: '0',
  });

  const outbound = kind === 'issue' || kind === 'transfer';

  useEffect(() => {
    const codes = [...new Set(items.map((item) => item.materialCode).filter(Boolean))];
    void Promise.all(codes.map(async (code) => [code, await loadLots(code)] as const)).then((entries) =>
      setLotsByMaterial((current) => ({ ...current, ...Object.fromEntries(entries) })),
    );
  }, [items]);

  // Khi đổi kho mặc định ở phần đầu phiếu, tự cập nhật cho các dòng chưa thay đổi kho riêng
  const handleChangeDefaultWarehouse = (newWh: string) => {
    setWarehouseCode(newWh);
    setItems((prev) =>
      prev.map((it) =>
        it.warehouseCode === warehouseCode || !it.warehouseCode
          ? { ...it, warehouseCode: newWh }
          : it,
      ),
    );
  };

  // Thêm vật tư từ Combobox
  const handleSelectMaterial = (m: Material) => {
    const existingIndex = items.findIndex((it) => it.materialCode === m.code);
    if (existingIndex >= 0) {
      setItems((prev) =>
        prev.map((it, idx) => (idx === existingIndex ? { ...it, quantity: it.quantity + 1 } : it)),
      );
    } else {
      let chosenWh = warehouseCode;
      if (outbound) {
        const found = workspace.stock.find((s) => s.materialCode === m.code && s.quantity > 0);
        if (found?.warehouseCode) {
          chosenWh = found.warehouseCode;
        }
      }
      setItems((prev) => [
        ...prev,
        {
          id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          materialCode: m.code,
          materialName: m.name,
          unit: m.unit || 'Cái',
          warehouseCode: chosenWh || workspace.warehouses[0]?.code || '',
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

  const handleUpdateWarehouse = (index: number, lineWarehouseCode: string) => {
    setItems((prev) =>
      prev.map((it, idx) => (idx === index ? { ...it, warehouseCode: lineWarehouseCode } : it)),
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
      .map((lot) => ({ lotId: lot.id, lotNumber: lot.lotNumber, quantity: Number(lotDraft[lot.id]) || 0 }))
      .filter((lot) => lot.quantity > 0);
    const receiptLot = kind === 'receipt' && newLotDraft.lotNumber.trim()
      ? { lotNumber: newLotDraft.lotNumber.trim().toUpperCase(), manufactureDate: newLotDraft.manufactureDate || undefined, expiryDate: newLotDraft.expiryDate || undefined, supplier: newLotDraft.supplier.trim() || undefined, coCqNumber: newLotDraft.coCqNumber.trim() || undefined, status: 'PASSED' as const }
      : undefined;
    setItems((previous) => previous.map((line, index) => index === lotModalIndex ? { ...line, lotAllocations: allocations, receiptLot } : line));
    setLotModalIndex(null);
  };

  // Tạo nhanh vật tư mới
  const handleCreateNewMaterial = () => {
    if (!draftMaterial.code.trim() || !draftMaterial.name.trim()) return;
    const newCode = draftMaterial.code.trim().toUpperCase();
    const newName = draftMaterial.name.trim();
    const newUnit = draftMaterial.unit || 'Cái';
    const minStock = Number(draftMaterial.minStock) || 0;

    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-new`,
        materialCode: newCode,
        materialName: newName,
        unit: newUnit,
        warehouseCode: warehouseCode || workspace.warehouses[0]?.code || '',
        quantity: 1,
        unitCost: undefined,
        serialNumbers: [],
        lineNote: 'Vật tư mới tạo',
        newMaterial: {
          code: newCode,
          name: newName,
          unit: newUnit,
          minStock,
        },
      },
    ]);

    setDraftMaterial({ code: '', name: '', unit: units[0] || 'Cái', minStock: '0' });
    setShowNewMaterialModal(false);
  };

  // Phân tích trạng thái tồn kho của từng dòng
  const lineStockAnalysis = useMemo(() => {
    return items.map((item) => {
      const wh = item.warehouseCode || warehouseCode;
      const stockItem = workspace.stock.find(
        (s) => s.materialCode === item.materialCode && s.warehouseCode === wh,
      );
      const onHandInWh = stockItem?.quantity ?? 0;
      const availInWh = stockItem?.available ?? onHandInWh;

      const totalAllWarehouses = workspace.stock
        .filter((s) => s.materialCode === item.materialCode)
        .reduce((sum, s) => sum + s.quantity, 0);

      const isOverdraw = outbound && (item.quantity > onHandInWh || onHandInWh === 0);
      const isEatsReserved = outbound && !isOverdraw && item.quantity > availInWh;

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
        isEatsReserved,
        badgeType,
        badgeLabel,
      };
    });
  }, [items, warehouseCode, workspace.stock, outbound]);

  const hasAnyOverdraw = outbound && lineStockAnalysis.some((a) => a.isOverdraw);
  const hasInvalidSerialSelection = items.some((item) =>
    getTrackingMode(workspace.materials.find((candidate) => candidate.code === item.materialCode)) === 'SERIAL' &&
    (item.serialNumbers?.length ?? 0) !== item.quantity,
  );
  const hasInvalidLotAllocation = items.some((item) => {
    if (getTrackingMode(workspace.materials.find((candidate) => candidate.code === item.materialCode)) !== 'LOT') return false;
    if (kind === 'receipt') return !item.receiptLot?.lotNumber;
    return (item.lotAllocations?.reduce((sum, lot) => sum + lot.quantity, 0) ?? 0) !== item.quantity;
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

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (items.length === 0 || busy || hasAnyOverdraw || hasInvalidLotAllocation || hasInvalidSerialSelection || !warehouseCode) return;
    if (kind === 'transfer' && (!toWarehouseCode || toWarehouseCode === warehouseCode)) return;

    const firstItem = items[0];

    onSubmit({
      kind,
      warehouseCode,
      toWarehouseCode: kind === 'transfer' ? toWarehouseCode : undefined,
      note: note.trim(),
      procedureDefinitionId: procedureDefinitionId || undefined,
      attachmentFile: selectedFile || undefined,
      targetAssetCode: kind === 'issue' && issueTargetType === 'asset' ? targetAssetCode : undefined,
      items,
      // Dữ liệu tương thích ngược cho single-item consumers
      materialCode: firstItem?.materialCode,
      quantity: firstItem?.quantity,
      unitCost: firstItem?.unitCost,
      serialNumbers: firstItem?.serialNumbers,
      newMaterial: firstItem?.newMaterial,
    });
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

  const formContent = (
    <>
      {/* Header Form / Dialog */}
      <div className={isDialog ? styles.modalHead : styles.cardHead}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
            {resolvedTitle}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            {resolvedDescription}
          </p>
        </div>
        {isDialog ? (
          <button
            type="button"
            className={styles.closeButton}
            onClick={onCancel}
            title="Đóng (ESC)"
            aria-label="Đóng"
          >
            <X size={18} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      <div
        className={isDialog ? styles.modalBody : ''}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          overflowY: 'auto',
          maxHeight: isDialog ? 'calc(85vh - 130px)' : 'none',
          padding: isDialog ? '16px 20px' : '0',
        }}
      >
        {/* Thanh chuyển đổi nhanh Loại Phiếu */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px',
              background: '#f1f5f9',
              borderRadius: '8px',
              width: 'fit-content',
            }}
          >
            <button
              type="button"
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                background: kind === 'receipt' ? '#ffffff' : 'transparent',
                color: kind === 'receipt' ? '#166534' : '#64748b',
                boxShadow: kind === 'receipt' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
              onClick={() => setKind('receipt')}
            >
              Nhập kho
            </button>
            <button
              type="button"
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                background: kind === 'issue' ? '#ffffff' : 'transparent',
                color: kind === 'issue' ? '#1d4ed8' : '#64748b',
                boxShadow: kind === 'issue' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
              onClick={() => setKind('issue')}
            >
              Xuất kho
            </button>
            <button
              type="button"
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                background: kind === 'transfer' ? '#ffffff' : 'transparent',
                color: kind === 'transfer' ? '#7c2d12' : '#64748b',
                boxShadow: kind === 'transfer' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
              onClick={() => setKind('transfer')}
            >
              Điều chuyển kho
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#64748b' }}>
            <FileText size={14} />
            <span>Mẫu phiếu đa đối tượng chuẩn ISO / ERP</span>
          </div>
        </div>

        {/* Khối Thông tin chung & Kho hàng (Header Grid) */}
        <div className={styles.movementHeaderGrid}>
          {/* Cột 1: Kho nguồn / Kho nhập mặc định */}
          <div className={styles.formFieldBlock}>
            <label>
              {kind === 'transfer' ? 'Kho nguồn xuất hàng' : kind === 'receipt' ? 'Kho tiếp nhận' : 'Kho xuất mặc định'}
              <span style={{ color: '#dc2626', marginLeft: '3px' }}>*</span>
            </label>
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
            <div className={styles.formFieldBlock}>
              <label>
                Kho đích tiếp nhận điều chuyển <span style={{ color: '#dc2626' }}>*</span>
              </label>
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
            <div className={styles.formFieldBlock}>
              <label>Mục đích & Đối tượng xuất</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ width: '150px', flexShrink: 0 }}>
                  <SearchableSelect
                    options={issueTargetTypeOptions}
                    value={issueTargetType}
                    placeholder="Mục đích xuất..."
                    emptyText="Không tìm thấy"
                    onChange={(val) => setIssueTargetType((val as 'department' | 'asset' | 'customer') || 'department')}
                    clearable={false}
                    disabled={busy}
                  />
                </div>

                {issueTargetType === 'asset' ? (
                  <div style={{ flex: 1, minWidth: 0 }}>
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
                  <input
                    type="text"
                    style={{ flex: 1 }}
                    placeholder={issueTargetType === 'department' ? 'Tên phòng ban / đội thi công…' : 'Tên khách hàng / dự án…'}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className={styles.formFieldBlock}>
              <label>Quy trình liên kết mở Work Order</label>
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

          {/* Cột 3: Lý do nghiệp vụ / Số hóa đơn */}
          <div className={styles.formFieldBlock} style={{ gridColumn: 'span 2' }}>
            <label>
              Lý do thực hiện / Số hoá đơn / Số lệnh <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              required
              type="text"
              placeholder="VD: Nhập theo Hóa đơn HD-2026-118, hoặc Xuất thay thế theo Lệnh PR-082…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {/* Cột 4: Khu vực đính kèm chứng từ */}
          <div className={styles.formFieldBlock} style={{ gridColumn: 'span 2' }}>
            <label>Tệp chứng từ đính kèm (Biên bản giao nhận, Hoá đơn đỏ, Ảnh chụp...)</label>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setSelectedFile(file);
              }}
            />
            <div
              className={styles.fileUploadArea}
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
                  className={styles.fileUploadAttachedCard}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Paperclip size={15} color="#2563eb" />
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>{selectedFile.name}</span>
                  <span style={{ color: '#64748b', fontSize: '11px' }}>
                    ({Math.round(selectedFile.size / 1024)} KB)
                  </span>
                  <button
                    type="button"
                    className={styles.fileUploadRemoveBtn}
                    onClick={() => {
                      setSelectedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    title="Xoá tệp đính kèm"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b', fontSize: '12.5px' }}>
                  <Upload size={16} color="#64748b" />
                  <span>Kéo thả tệp chứng từ vào đây hoặc </span>
                  <button
                    type="button"
                    style={{
                      border: 'none',
                      background: 'none',
                      color: '#2563eb',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: 0,
                      textDecoration: 'underline',
                    }}
                  >
                    chọn từ máy tính
                  </button>
                  <span style={{ color: '#94a3b8', fontSize: '11px' }}>(Hỗ trợ PDF, Excel, JPG, PNG tối đa 25MB)</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Khối Danh mục vật tư đa đối tượng */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '14.5px', fontWeight: 700, color: '#1e293b' }}>
                Danh sách vật tư / hàng hoá trên phiếu
              </h3>
              <span style={{ fontSize: '12px', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                {items.length} vật tư
              </span>
            </div>

            {kind === 'receipt' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowExcelImport(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: '1px solid #bbf7d0',
                    background: '#f0fdf4',
                    color: '#15803d',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <FileSpreadsheet size={14} />
                  <span>Thêm từ Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewMaterialModal(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: '1px solid #bfdbfe',
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={14} />
                  <span>+ Thêm vật tư mới vào danh mục</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowExcelImport(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 10px',
                  borderRadius: '6px',
                  border: '1px solid #bbf7d0',
                  background: '#f0fdf4',
                  color: '#15803d',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <FileSpreadsheet size={14} />
                <span>Thêm từ Excel</span>
              </button>
            )}
          </div>

          {/* Ô Combobox tìm kiếm thông minh */}
          <SearchableMaterialCombobox
            materials={workspace.materials}
            stock={workspace.stock}
            excludedCodes={items.map((i) => i.materialCode)}
            onSelectMaterial={handleSelectMaterial}
            onOpenNewMaterial={kind === 'receipt' ? () => setShowNewMaterialModal(true) : undefined}
          />

          {/* Cảnh báo nếu có mặt hàng đang bị giữ chỗ cho Work Order */}
          {reservedAlerts.length > 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '6px',
                background: '#fffbeb',
                border: '1px solid #fde68a',
                color: '#b45309',
                fontSize: '12.5px',
              }}
            >
              <AlertTriangle size={16} color="#d97706" style={{ flexShrink: 0 }} />
              <span>
                <strong>Lưu ý giữ chỗ:</strong> Có {reservedAlerts.length} vật tư đang được giữ chỗ cho Lệnh công tác ({reservedAlerts.map((a) => `${a.name}: ${a.reserved} cái`).join(', ')}). Vui lòng kiểm tra tồn khả dụng trước khi xuất.
              </span>
            </div>
          ) : null}

          {/* Bảng Danh sách vật tư (Multi-item Grid Table) */}
          <div className={styles.movementGridWrap}>
            <table className={styles.movementGridTable}>
              <thead>
                <tr>
                  <th style={{ width: '40px', textAlign: 'center' }}>STT</th>
                  <th style={{ minWidth: '220px' }}>Mã & Tên vật tư</th>
                  <th style={{ width: '70px', textAlign: 'center' }}>ĐVT</th>
                  <th style={{ minWidth: '160px' }}>Kho nguồn / đích</th>
                  <th style={{ width: '150px' }}>Tình trạng kho</th>
                  <th style={{ width: '95px', textAlign: 'right' }}>Số lượng</th>
                  {kind === 'receipt' ? (
                    <>
                      <th style={{ width: '110px', textAlign: 'right' }}>Đơn giá (VNĐ)</th>
                      <th style={{ width: '120px', textAlign: 'right' }}>Thành tiền</th>
                    </>
                  ) : null}
                  <th style={{ width: '118px', textAlign: 'center' }}>Theo dõi định danh</th>
                  <th style={{ minWidth: '130px' }}>Ghi chú dòng</th>
                  <th style={{ width: '50px', textAlign: 'center' }}>Xoá</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const analysis = lineStockAnalysis[index];
                  const lineTotal = (Number(item.quantity) || 0) * (Number(item.unitCost) || 0);
                  const serialCount = item.serialNumbers?.length || 0;
                  const lotCount = item.lotAllocations?.length || (item.receiptLot ? 1 : 0);
                  const allocatedLotQuantity = item.lotAllocations?.reduce((sum, lot) => sum + lot.quantity, 0) ?? 0;
                  const trackingMode = getTrackingMode(workspace.materials.find((material) => material.code === item.materialCode));
                  const itemUnitConfig = getUnitQuantityConfig(item.unit);

                  return (
                    <tr
                      key={item.id}
                      style={{
                        background: analysis?.isOverdraw ? '#fef2f2' : undefined,
                      }}
                    >
                      <td style={{ textAlign: 'center', color: '#64748b', fontWeight: 600, fontSize: '12px' }}>
                        {index + 1}
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '13px' }}>
                              {item.materialCode}
                            </span>
                            {item.newMaterial ? (
                              <span style={{ fontSize: '10px', background: '#dcfce7', color: '#15803d', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                                MỚI
                              </span>
                            ) : null}
                          </div>
                          <span style={{ fontSize: '12px', color: '#475569' }}>
                            {item.materialName}
                          </span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', color: '#475569', fontSize: '12.5px' }}>
                        {item.unit}
                      </td>
                      <td style={{ minWidth: '150px' }}>
                        <SearchableSelect
                          options={warehouseOptions}
                          value={item.warehouseCode || warehouseCode}
                          placeholder="Chọn kho..."
                          emptyText="Không có kho"
                          onChange={(val) => handleUpdateWarehouse(index, val)}
                          clearable={false}
                        />
                      </td>
                      <td>
                        <span
                          className={
                            analysis?.badgeType === 'ok'
                              ? styles.stockBadgeOk
                              : analysis?.badgeType === 'shared'
                                ? styles.stockBadgeShared
                                : styles.stockBadgeEmpty
                          }
                          title={analysis?.badgeLabel}
                        >
                          {analysis?.badgeLabel}
                        </span>
                      </td>
                      <td>
                        <input
                          type="number"
                          step={itemUnitConfig.step}
                          min={itemUnitConfig.min}
                          className={styles.gridCellInput}
                          style={{
                            textAlign: 'right',
                            borderColor: analysis?.isOverdraw ? '#ef4444' : undefined,
                            background: analysis?.isOverdraw ? '#fff' : undefined,
                          }}
                          value={item.quantity === 0 ? '' : item.quantity}
                          onChange={(e) => handleUpdateQuantity(index, Number(e.target.value))}
                        />
                      </td>
                      {kind === 'receipt' ? (
                        <>
                          <td>
                            <input
                              type="number"
                              step="any"
                              min={0}
                              placeholder="0"
                              className={styles.gridCellInput}
                              style={{ textAlign: 'right' }}
                              value={item.unitCost === undefined ? '' : item.unitCost}
                              onChange={(e) =>
                                handleUpdateUnitCost(
                                  index,
                                  e.target.value ? Number(e.target.value) : undefined,
                                )
                              }
                            />
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: '#1e293b', fontSize: '12.5px' }}>
                            {formatNumber(lineTotal)} đ
                          </td>
                        </>
                      ) : null}
                      <td style={{ textAlign: 'center' }}>
                        {trackingMode === 'LOT' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleOpenLotModal(index)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', borderRadius: '4px', border: lotCount > 0 ? '1px solid #c4b5fd' : '1px solid #e2e8f0', background: lotCount > 0 ? '#f5f3ff' : '#f8fafc', color: lotCount > 0 ? '#6d28d9' : '#64748b', fontSize: '11.5px', fontWeight: 600, cursor: 'pointer' }}
                              title={kind === 'receipt' ? 'Khai báo lô hàng nhận vào' : 'Chọn lô hàng để xuất / điều chuyển'}
                            >
                              <Layers size={13} />
                              <span>{lotCount > 0 ? `${lotCount} lô` : 'Lô hàng'}</span>
                            </button>
                            {outbound && lotCount > 0 && allocatedLotQuantity !== item.quantity ? <div style={{ marginTop: '3px', fontSize: '10px', color: '#b45309' }}>Phân bổ {formatNumber(allocatedLotQuantity)}/{formatNumber(item.quantity)}</div> : null}
                          </>
                        ) : trackingMode === 'SERIAL' ? (
                          <button
                            type="button"
                            onClick={() => handleOpenSerialModal(index)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              border: serialCount > 0 ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
                              background: serialCount > 0 ? '#eff6ff' : '#f8fafc',
                              color: serialCount > 0 ? '#1d4ed8' : '#64748b',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                            title="Nhập danh sách số sê-ri / barcode cho dòng này"
                          >
                            <Barcode size={13} />
                            <span>{serialCount > 0 ? `${serialCount} Sê-ri` : 'Sê-ri'}</span>
                          </button>
                        ) : (
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>Không theo dõi</span>
                        )}
                      </td>
                      <td>
                        <input
                          type="text"
                          placeholder="Ghi chú dòng…"
                          className={styles.gridCellInput}
                          value={item.lineNote ?? ''}
                          onChange={(e) => handleUpdateLineNote(index, e.target.value)}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className={styles.gridDeleteBtn}
                          onClick={() => handleRemoveItem(index)}
                          title="Xoá dòng này khỏi phiếu"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={kind === 'receipt' ? 11 : 9}
                      style={{
                        padding: '32px 16px',
                        textAlign: 'center',
                        color: '#64748b',
                        fontSize: '13px',
                      }}
                    >
                      <Layers size={28} color="#94a3b8" style={{ marginBottom: '6px', display: 'inline-block' }} />
                      <div>Chưa có vật tư nào trên phiếu.</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                        Sử dụng thanh tìm kiếm phía trên để thêm các mặt hàng cần tác nghiệp vào phiếu.
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            {/* Bảng tổng kết số liệu (Grid Footer Summary) */}
            {items.length > 0 ? (
              <div className={styles.movementGridFooter}>
                <div className={styles.movementGridSummaryStats}>
                  <span>Số loại vật tư: <strong>{totalItemCount}</strong></span>
                  <span>Tổng số lượng xuất/nhập: <strong>{formatNumber(totalQuantity)}</strong></span>
                  {kind === 'receipt' ? (
                    <span style={{ color: '#166534' }}>
                      Tổng giá trị nhập: <strong>{formatNumber(totalCost)} VNĐ</strong>
                    </span>
                  ) : null}
                </div>

                {hasAnyOverdraw ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#dc2626', fontSize: '12px', fontWeight: 600 }}>
                    <AlertTriangle size={15} />
                    <span>Có vật tư vượt quá tồn kho thực tế! Vui lòng điều chỉnh lại số lượng hoặc chọn kho khác.</span>
                  </div>
                ) : hasInvalidLotAllocation ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#b45309', fontSize: '12px', fontWeight: 600 }}>
                    <AlertTriangle size={15} />
                    <span>Vật tư quản lý theo lô phải được phân bổ đủ số lượng trước khi ghi phiếu.</span>
                  </div>
                ) : hasInvalidSerialSelection ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#b45309', fontSize: '12px', fontWeight: 600 }}>
                    <AlertTriangle size={15} />
                    <span>Vật tư quản lý theo sê-ri phải khai đủ một số sê-ri cho mỗi đơn vị trên phiếu.</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#166534', fontSize: '12px', fontWeight: 600 }}>
                    <CheckCircle2 size={15} />
                    <span>Dữ liệu hợp lệ, sẵn sàng ghi sổ kho</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Modal Con: Phân bổ Lô hàng */}
      {lotModalIndex !== null && items[lotModalIndex] ? (
        <div className={styles.modalOverlay} style={{ zIndex: 1100 }} onClick={() => setLotModalIndex(null)}>
          <div className={`${styles.modalDialog} ${styles.lotMovementDialog}`} onClick={(event) => event.stopPropagation()}>
            <div className={styles.lotMovementDialogHead}>
              <div className={styles.lotMovementDialogTitle}>
                <h3>{kind === 'receipt' ? 'Khai báo lô hàng nhập' : 'Phân bổ lô hàng xuất'}</h3>
                <p>{items[lotModalIndex].materialCode} — {items[lotModalIndex].materialName} · Số lượng phiếu: {formatNumber(items[lotModalIndex].quantity)} {items[lotModalIndex].unit}</p>
              </div>
              <button type="button" className={styles.closeButton} onClick={() => setLotModalIndex(null)}><X size={16} /></button>
            </div>
            {kind === 'receipt' ? (
              <div className={styles.lotMovementFormGrid}>
                <div className={styles.formFieldBlock}>
                  <label>
                    Mã lô <span className={styles.requiredMark}>*</span>
                  </label>
                  <input
                    autoFocus
                    value={newLotDraft.lotNumber}
                    placeholder="VD: LOT-2026-001"
                    onChange={(event) =>
                      setNewLotDraft((draft) => ({ ...draft, lotNumber: event.target.value }))
                    }
                  />
                </div>
                <div className={styles.formFieldBlock}>
                  <label>Số CO/CQ</label>
                  <input
                    value={newLotDraft.coCqNumber}
                    placeholder="VD: CO-2026-01"
                    onChange={(event) =>
                      setNewLotDraft((draft) => ({ ...draft, coCqNumber: event.target.value }))
                    }
                  />
                </div>
                <div className={styles.formFieldBlock}>
                  <label>Ngày sản xuất</label>
                  <input
                    type="date"
                    value={newLotDraft.manufactureDate}
                    onChange={(event) =>
                      setNewLotDraft((draft) => ({ ...draft, manufactureDate: event.target.value }))
                    }
                  />
                </div>
                <div className={styles.formFieldBlock}>
                  <label>Hạn sử dụng</label>
                  <input
                    type="date"
                    value={newLotDraft.expiryDate}
                    onChange={(event) =>
                      setNewLotDraft((draft) => ({ ...draft, expiryDate: event.target.value }))
                    }
                  />
                </div>
                <div className={`${styles.formFieldBlock} ${styles.lotMovementFullWidth}`}>
                  <label>Nhà cung cấp</label>
                  <input
                    value={newLotDraft.supplier}
                    placeholder="VD: Schneider Electric, ABB…"
                    onChange={(event) =>
                      setNewLotDraft((draft) => ({ ...draft, supplier: event.target.value }))
                    }
                  />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '330px', overflowY: 'auto' }}>
                {(lotsByMaterial[items[lotModalIndex].materialCode] ?? []).filter((lot) => lot.warehouseCode === items[lotModalIndex].warehouseCode && !['BLOCKED', 'EXPIRED', 'QUARANTINE'].includes(lot.status)).sort((a, b) => (a.expiryDate ?? '9999-12-31').localeCompare(b.expiryDate ?? '9999-12-31')).map((lot) => (
                  <div key={lot.id} style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '12px', alignItems: 'center', padding: '10px', border: '1px solid #e2e8f0', borderRadius: '6px', background: '#f8fafc' }}>
                    <div><strong style={{ color: '#5b21b6' }}>{lot.lotNumber}</strong><div style={{ color: '#64748b', fontSize: '11.5px', marginTop: '2px' }}>Khả dụng: {formatNumber(lot.quantity)} {lot.unit ?? items[lotModalIndex].unit}{lot.expiryDate ? ` · HSD ${lot.expiryDate}` : ''}</div></div>
                    <input type="number" min={0} max={lot.quantity} className={styles.gridCellInput} style={{ textAlign: 'right' }} value={lotDraft[lot.id] ?? ''} placeholder="0" onChange={(event) => setLotDraft((draft) => ({ ...draft, [lot.id]: Math.min(lot.quantity, Math.max(0, Number(event.target.value) || 0)) }))} />
                  </div>
                ))}
                {(lotsByMaterial[items[lotModalIndex].materialCode] ?? []).length === 0 ? <p style={{ margin: '8px 0', color: '#64748b', fontSize: '13px' }}>Chưa có lô nào cho vật tư này. Hãy lập phiếu nhập và khai báo lô trước khi xuất.</p> : null}
              </div>
            )}
            <div className={styles.lotMovementDialogFoot}>
              <button type="button" className={`${styles.action} ${styles.actionGhost}`} onClick={() => setLotModalIndex(null)}>Huỷ</button>
              <button type="button" className={`${styles.action} ${styles.actionPrimary}`} disabled={kind === 'receipt' && !newLotDraft.lotNumber.trim()} onClick={handleSaveLots}>Lưu phân bổ lô</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal Con: Nhập Danh Sách Sê-ri */}
      {serialModalIndex !== null && items[serialModalIndex] ? (
        <div
          className={styles.modalOverlay}
          style={{ zIndex: 1100 }}
          onClick={() => setSerialModalIndex(null)}
        >
          <div
            className={styles.modalDialog}
            style={{
              maxWidth: '520px',
              background: '#ffffff',
              borderRadius: '10px',
              padding: '20px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                  Khai báo Sê-ri / Barcode
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                  {items[serialModalIndex].materialCode} — {items[serialModalIndex].materialName}
                </p>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setSerialModalIndex(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                Danh sách số Sê-ri (mỗi dòng một số, hoặc ngăn cách bằng dấu phẩy):
              </label>
              <textarea
                rows={6}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  outline: 'none',
                  fontFamily: 'monospace',
                }}
                placeholder="VD:\nSN-2026-001\nSN-2026-002\nSN-2026-003"
                value={serialDraft}
                onChange={(e) => setSerialDraft(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#64748b' }}>
                <span>
                  Đã nhận diện: <strong>{parseSerials(serialDraft).length}</strong> sê-ri / Cần: <strong>{items[serialModalIndex].quantity}</strong> cái
                </span>
                {parseSerials(serialDraft).length !== items[serialModalIndex].quantity ? (
                  <span style={{ color: '#d97706', fontSize: '11.5px' }}>
                    ℹ Lưu sẽ tự động đồng bộ số lượng dòng
                  </span>
                ) : null}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
              <button
                type="button"
                className={`${styles.action} ${styles.actionGhost}`}
                onClick={() => setSerialModalIndex(null)}
              >
                Huỷ
              </button>
              <button
                type="button"
                className={`${styles.action} ${styles.actionPrimary}`}
                onClick={handleSaveSerials}
              >
                Xác nhận lưu sê-ri
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal Con: Tạo Nhanh Vật Tư Mới */}
      {showNewMaterialModal ? (
        <div
          className={styles.modalOverlay}
          style={{ zIndex: 1100 }}
          onClick={() => setShowNewMaterialModal(false)}
        >
          <div
            className={styles.modalDialog}
            style={{
              maxWidth: '560px',
              background: '#ffffff',
              borderRadius: '10px',
              padding: '20px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                  Khai báo vật tư mới vào danh mục
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                  Vật tư này sẽ được tạo trong danh mục và tự động thêm vào phiếu hiện tại.
                </p>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setShowNewMaterialModal(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className={styles.formFieldBlock}>
                <label>
                  Mã SKU vật tư <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="VD: VT-BIEN-AP-01"
                  value={draftMaterial.code}
                  onChange={(e) =>
                    setDraftMaterial((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))
                  }
                />
              </div>

              <div className={styles.formFieldBlock}>
                <label>
                  Đơn vị tính <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <SearchableSelect
                  options={unitOptions}
                  value={draftMaterial.unit}
                  placeholder="Tìm hoặc chọn ĐVT..."
                  emptyText="Không tìm thấy đơn vị"
                  onChange={(val) => setDraftMaterial((prev) => ({ ...prev, unit: val }))}
                  clearable={false}
                />
              </div>

              <div className={styles.formFieldBlock} style={{ gridColumn: 'span 2' }}>
                <label>
                  Tên đầy đủ của vật tư <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="VD: Dầu làm mát máy biến áp tiêu chuẩn IEC"
                  value={draftMaterial.name}
                  onChange={(e) =>
                    setDraftMaterial((prev) => ({ ...prev, name: e.target.value }))
                  }
                />
              </div>

              <div className={styles.formFieldBlock} style={{ gridColumn: 'span 2' }}>
                <label>Mức tồn kho an toàn tối thiểu</label>
                <input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={draftMaterial.minStock}
                  onChange={(e) =>
                    setDraftMaterial((prev) => ({ ...prev, minStock: e.target.value }))
                  }
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
              <button
                type="button"
                className={`${styles.action} ${styles.actionGhost}`}
                onClick={() => setShowNewMaterialModal(false)}
              >
                Huỷ
              </button>
              <button
                type="button"
                className={`${styles.action} ${styles.actionPrimary}`}
                disabled={!draftMaterial.code.trim() || !draftMaterial.name.trim()}
                onClick={handleCreateNewMaterial}
              >
                + Thêm vào phiếu
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showExcelImport ? (
        <ExcelImportDialog
          warehouses={workspace.warehouses}
          materials={workspace.materials}
          movementKind={kind}
          defaultWarehouseCode={warehouseCode}
          onCancel={() => setShowExcelImport(false)}
          onImportItems={handleImportItems}
        />
      ) : null}

      {/* Footer Actions của Phiếu */}
      <div
        className={isDialog ? styles.modalFoot : styles.editActions}
        style={
          isDialog
            ? { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
            : { marginTop: '8px', paddingTop: '16px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Info size={15} color="#64748b" />
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            Phiếu có <strong>{items.length}</strong> vật tư · Tổng <strong>{formatNumber(totalQuantity)}</strong> đơn vị.
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            className={`${styles.action} ${styles.actionGhost}`}
            onClick={onCancel}
          >
            Huỷ
          </button>
          <button
            type="submit"
            className={`${styles.action} ${styles.actionPrimary}`}
            disabled={
              busy ||
              hasAnyOverdraw ||
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
          </button>
        </div>
      </div>
    </>
  );

  if (isDialog) {
    return (
      <div className={styles.modalOverlay} onClick={onCancel}>
        <div
          className={`${styles.modalDialog} ${styles.movementDialog}`}
          style={{
            maxWidth: '1060px',
            width: '95vw',
            background: '#ffffff',
            borderRadius: '12px',
            boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
            overflow: 'hidden',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <form
            onSubmit={submit}
            style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '90vh' }}
          >
            {formContent}
          </form>
        </div>
      </div>
    );
  }

  return (
    <form
      className={styles.card}
      onSubmit={submit}
      style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      {formContent}
    </form>
  );
}
