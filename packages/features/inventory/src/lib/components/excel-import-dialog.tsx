'use client';

import type { Material, Warehouse } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileSpreadsheet,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import type { MovementKind, MovementLineItem } from './movement-form';
import styles from '../inventory.module.scss';

export interface ExcelImportDialogProps {
  warehouses: readonly Warehouse[];
  materials: readonly Material[];
  /** Nghiệp vụ nhận danh sách vật tư từ tệp Excel. */
  movementKind: MovementKind;
  defaultWarehouseCode: string;
  onCancel: () => void;
  onImportItems: (importedItems: MovementLineItem[]) => void;
}

/** Chuẩn hoá chuỗi không dấu để tìm kiếm và fuzzy match */
function normalize(str?: string): string {
  return (str ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** Chuyển giá trị chuỗi hoặc số từ Excel thành number chuẩn */
function parseNumericValue(val: unknown): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'number') return isNaN(val) ? undefined : val;
  const str = String(val).trim();
  // Loại bỏ các ký tự tiền tệ và khoảng trắng
  const cleaned = str.replace(/[₫$€¥\s]/g, '');
  // Nếu dùng dấu chấm phân tách ngàn và phẩy thập phân kiểu VN (ví dụ 1.250,50)
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  // Nếu kiểu US (ví dụ 1,250.50)
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/,/g, ''));
  }
  // Nếu chỉ có dấu phẩy thay dấu chấm thập phân (ví dụ 12,5)
  if (/^\d+,\d+$/.test(cleaned)) {
    return parseFloat(cleaned.replace(',', '.'));
  }
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? undefined : parsed;
}

// Từ điển đồng nghĩa nhận diện cột
const FIELD_KEYWORDS: Record<string, string[]> = {
  materialCode: ['ma vat tu', 'ma vt', 'ma hang', 'sku', 'part number', 'part no', 'item code', 'ma', 'code', 'material code'],
  materialName: ['ten vat tu', 'ten vt', 'ten hang', 'ten san pham', 'dien giai', 'description', 'material name', 'item name', 'ten'],
  unit: ['dvt', 'don vi tinh', 'don vi', 'unit', 'uom'],
  quantity: ['so luong', 'sl', 'thuc nhan', 'quantity', 'qty', 'so luong nhap', 'amount'],
  unitCost: ['don gia', 'gia', 'gia nhap', 'unit cost', 'price', 'unit price', 'don gia nhap', 'gia mua'],
  warehouseCode: ['kho', 'kho nhan', 'ma kho', 'warehouse', 'warehouse code'],
  lotNumber: ['so lo', 'lo', 'lot', 'lot number', 'batch', 'batch no', 'so lo sx'],
  expiryDate: ['han dung', 'han su dung', 'hsd', 'expiry', 'exp date', 'expiry date'],
  vatRate: ['thue suat', 'vat', 'thue vat', '% vat', 'thue', 'vat rate', 'tax rate'],
  lineNote: ['ghi chu', 'note', 'dien giai dong', 'remark', 'comments'],
};

interface ColumnMapping {
  materialCode: string; // Tên cột trong file Excel
  materialName: string;
  unit: string;
  quantity: string;
  unitCost: string;
  vatRate: string;
  warehouseCode: string;
  lotNumber: string;
  expiryDate: string;
  lineNote: string;
}

const DEFAULT_MAPPING: ColumnMapping = {
  materialCode: '',
  materialName: '',
  unit: '',
  quantity: '',
  unitCost: '',
  vatRate: '',
  warehouseCode: '',
  lotNumber: '',
  expiryDate: '',
  lineNote: '',
};

interface ColumnMappingSelectProps {
  readonly headers: readonly string[];
  readonly value: string;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
}

/** Combobox chuẩn cho các cột được ánh xạ từ tệp Excel. */
function ColumnMappingSelect({ headers, value, placeholder, onChange }: ColumnMappingSelectProps) {
  return (
    <SearchableSelect
      options={headers.map((header) => ({ value: header, label: header }))}
      value={value}
      placeholder={placeholder}
      searchPlaceholder="Nhập tên cột Excel để lọc…"
      emptyText="Không tìm thấy cột Excel phù hợp"
      onChange={onChange}
      clearable
      style={{ width: '100%', maxWidth: '320px', fontSize: '13px' }}
    />
  );
}

interface ParsedRowResult {
  rowIndex: number;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  unitCost?: number;
  vatRate?: number;
  warehouseCode: string;
  lotNumber?: string;
  expiryDate?: string;
  lineNote?: string;
  status: 'valid' | 'warning' | 'error';
  isNew: boolean;
  errors: string[];
}

const SAVED_PROFILES_STORAGE_KEY = 'inventory.excel_import_profiles.v1';

export function ExcelImportDialog({
  warehouses,
  materials,
  movementKind,
  defaultWarehouseCode,
  onCancel,
  onImportItems,
}: ExcelImportDialogProps) {
  const movementLabel = movementKind === 'receipt' ? 'Nhập kho' : movementKind === 'issue' ? 'Xuất kho' : 'Luân chuyển kho';
  const warehouseLabel = movementKind === 'receipt' ? 'Kho tiếp nhận' : 'Kho nguồn xuất';
  // Trạng thái Wizard: 1: Tải file -> 2: Khớp cột -> 3: Xem trước & Xác nhận
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // File & Excel Workbook state
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [rawRows, setRawRows] = useState<any[][]>([]);
  const [headerRowIdx, setHeaderRowIdx] = useState<number>(0);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);

  // Mapping state
  const [mapping, setMapping] = useState<ColumnMapping>(DEFAULT_MAPPING);
  const [fallbackWarehouse, setFallbackWarehouse] = useState(defaultWarehouseCode || warehouses[0]?.code || '');

  // Profile Mapping state (Lưu mẫu cấu hình)
  const [savedProfiles, setSavedProfiles] = useState<Record<string, ColumnMapping>>({});
  const [selectedProfileName, setSelectedProfileName] = useState<string>('');
  const [newProfileName, setNewProfileName] = useState<string>('');
  const [showSaveProfileModal, setShowSaveProfileModal] = useState(false);

  // Danh mục tra cứu nhanh
  const materialMap = useMemo(() => {
    const map = new Map<string, Material>();
    for (const m of materials) {
      map.set(m.code.toUpperCase(), m);
      map.set(normalize(m.code), m);
    }
    return map;
  }, [materials]);

  const warehouseSet = useMemo(() => {
    return new Set(warehouses.map((w) => w.code.toUpperCase()));
  }, [warehouses]);

  // Load Saved Profiles từ localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SAVED_PROFILES_STORAGE_KEY);
      if (stored) {
        setSavedProfiles(JSON.parse(stored));
      }
    } catch {
      // Bỏ qua lỗi đọc localStorage
    }
  }, []);

  // Đọc file Excel khi người dùng kéo thả hoặc chọn
  const handleFileChange = (file: File) => {
    if (!file) return;
    setFileName(file.name);
    setFileSize(
      file.size > 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
        : `${Math.round(file.size / 1024)} KB`
    );

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetList = workbook.SheetNames;
        setSheets(sheetList);
        if (sheetList.length > 0) {
          const firstSheet = sheetList[0];
          setSelectedSheet(firstSheet);
          parseSheetData(workbook, firstSheet);
        }
      } catch (err) {
        alert('Không thể đọc file Excel. Vui lòng kiểm tra lại định dạng tệp!');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Trích xuất mảng 2 chiều từ Sheet
  const parseSheetData = (workbook: XLSX.WorkBook, sheetName: string) => {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) return;
    const jsonRows = XLSX.utils.sheet_to_json<any[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });
    setRawRows(jsonRows);

    // Tự động tìm dòng Header tốt nhất (dòng đầu tiên có từ 2 cột text có nghĩa)
    let detectedHeaderIdx = 0;
    for (let i = 0; i < Math.min(jsonRows.length, 10); i++) {
      const row = jsonRows[i];
      if (Array.isArray(row) && row.some((cell) => typeof cell === 'string' && cell.trim().length > 1)) {
        detectedHeaderIdx = i;
        break;
      }
    }
    setHeaderRowIdx(detectedHeaderIdx);

    const headerCells = (jsonRows[detectedHeaderIdx] || []).map((c, i) =>
      c !== undefined && c !== null && String(c).trim() !== ''
        ? String(c).trim()
        : `Cột ${i + 1}`
    );
    setFileHeaders(headerCells);

    // Tự động fuzzy mapping dựa trên tên cột
    autoMapHeaders(headerCells);
  };

  // Tự động đoán cột (Fuzzy column matcher)
  const autoMapHeaders = (headers: string[]) => {
    const newMapping: ColumnMapping = { ...DEFAULT_MAPPING };

    const assigned = new Set<string>();

    for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
      for (const h of headers) {
        if (assigned.has(h)) continue;
        const normH = normalize(h);
        const isMatch = keywords.some(
          (k) => normH === k || normH.includes(k) || k.includes(normH)
        );
        if (isMatch) {
          (newMapping as any)[field] = h;
          assigned.add(h);
          break;
        }
      }
    }
    setMapping(newMapping);
  };

  // Thay đổi dòng Header thủ công
  const handleChangeHeaderRow = (newIdx: number) => {
    if (newIdx < 0 || newIdx >= rawRows.length) return;
    setHeaderRowIdx(newIdx);
    const headerCells = (rawRows[newIdx] || []).map((c, i) =>
      c !== undefined && c !== null && String(c).trim() !== ''
        ? String(c).trim()
        : `Cột ${i + 1}`
    );
    setFileHeaders(headerCells);
    autoMapHeaders(headerCells);
  };

  // Áp dụng Profile đã lưu
  const handleApplyProfile = (profileName: string) => {
    setSelectedProfileName(profileName);
    if (!profileName || !savedProfiles[profileName]) return;
    const p = savedProfiles[profileName];
    setMapping({ ...p });
  };

  // Lưu Profile mới
  const handleSaveCurrentProfile = () => {
    const trimmed = newProfileName.trim();
    if (!trimmed) return;
    const updated = { ...savedProfiles, [trimmed]: mapping };
    setSavedProfiles(updated);
    setSelectedProfileName(trimmed);
    localStorage.setItem(SAVED_PROFILES_STORAGE_KEY, JSON.stringify(updated));
    setShowSaveProfileModal(false);
    setNewProfileName('');
  };

  // Xoá Profile
  const handleDeleteProfile = (profileName: string) => {
    const updated = { ...savedProfiles };
    delete updated[profileName];
    setSavedProfiles(updated);
    if (selectedProfileName === profileName) {
      setSelectedProfileName('');
    }
    localStorage.setItem(SAVED_PROFILES_STORAGE_KEY, JSON.stringify(updated));
  };

  // Phân tích & Tiền kiểm tra dữ liệu theo ánh xạ cột (Data Validation)
  const parsedDataResults = useMemo<ParsedRowResult[]>(() => {
    if (rawRows.length <= headerRowIdx + 1 || !mapping.materialCode || !mapping.quantity) {
      return [];
    }

    // Tạo bản đồ vị trí index của từng cột
    const colIndices: Record<keyof ColumnMapping, number> = {
      materialCode: fileHeaders.indexOf(mapping.materialCode),
      materialName: fileHeaders.indexOf(mapping.materialName),
      unit: fileHeaders.indexOf(mapping.unit),
      quantity: fileHeaders.indexOf(mapping.quantity),
      unitCost: fileHeaders.indexOf(mapping.unitCost),
      vatRate: fileHeaders.indexOf(mapping.vatRate),
      warehouseCode: fileHeaders.indexOf(mapping.warehouseCode),
      lotNumber: fileHeaders.indexOf(mapping.lotNumber),
      expiryDate: fileHeaders.indexOf(mapping.expiryDate),
      lineNote: fileHeaders.indexOf(mapping.lineNote),
    };

    const results: ParsedRowResult[] = [];

    // Duyệt qua các dòng dữ liệu sau dòng tiêu đề
    for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
      const row = rawRows[r];
      if (!row || row.length === 0) continue;

      const rawCode = colIndices.materialCode >= 0 ? String(row[colIndices.materialCode] ?? '').trim() : '';
      if (!rawCode) {
        // Bỏ qua dòng trống hoàn toàn
        const hasAnyValue = row.some((c) => c !== undefined && c !== null && String(c).trim() !== '');
        if (!hasAnyValue) continue;
      }

      const errors: string[] = [];

      // 1. Kiểm tra Mã vật tư
      if (!rawCode) {
        errors.push('Thiếu mã vật tư');
      }

      const normalizedCode = rawCode.toUpperCase();
      const existingMaterial = materialMap.get(normalizedCode) || materialMap.get(normalize(rawCode));
      const isNew = !existingMaterial && Boolean(rawCode);
      if (isNew && movementKind !== 'receipt') {
        errors.push('Mã vật tư chưa có trong danh mục nên không thể xuất hoặc luân chuyển');
      }

      // 2. Tên vật tư
      let name = colIndices.materialName >= 0 ? String(row[colIndices.materialName] ?? '').trim() : '';
      if (!name && existingMaterial) {
        name = existingMaterial.name;
      }
      if (!name && !existingMaterial) {
        name = rawCode; // Tạm dùng mã nếu chưa có tên
      }

      // 3. Đơn vị tính
      let unit = colIndices.unit >= 0 ? String(row[colIndices.unit] ?? '').trim() : '';
      if (!unit && existingMaterial?.unit) {
        unit = existingMaterial.unit;
      }
      if (!unit) {
        unit = 'Cái';
      }

      // 4. Số lượng
      const rawQty = colIndices.quantity >= 0 ? row[colIndices.quantity] : undefined;
      const parsedQty = parseNumericValue(rawQty);
      if (parsedQty === undefined) {
        errors.push('Số lượng không hợp lệ hoặc để trống');
      } else if (parsedQty <= 0) {
        errors.push('Số lượng phải lớn hơn 0');
      }

      // 5. Đơn giá
      const rawCost = colIndices.unitCost >= 0 ? row[colIndices.unitCost] : undefined;
      const parsedCost = parseNumericValue(rawCost);

      // 5b. Thuế suất VAT
      const rawVat = colIndices.vatRate >= 0 ? row[colIndices.vatRate] : undefined;
      const parsedVat = parseNumericValue(rawVat);

      // 6. Kho nhận
      let rowWh = colIndices.warehouseCode >= 0 ? String(row[colIndices.warehouseCode] ?? '').trim().toUpperCase() : '';
      if (!rowWh || !warehouseSet.has(rowWh)) {
        rowWh = fallbackWarehouse;
      }

      // 7. Số lô & Hạn dùng & Ghi chú
      const lotNumber = colIndices.lotNumber >= 0 ? String(row[colIndices.lotNumber] ?? '').trim().toUpperCase() : undefined;
      const expiryDate = colIndices.expiryDate >= 0 ? String(row[colIndices.expiryDate] ?? '').trim() : undefined;
      const lineNote = colIndices.lineNote >= 0 ? String(row[colIndices.lineNote] ?? '').trim() : undefined;

      const status: 'valid' | 'warning' | 'error' = errors.length > 0 ? 'error' : isNew ? 'warning' : 'valid';

      results.push({
        rowIndex: r + 1,
        materialCode: normalizedCode || rawCode,
        materialName: name,
        unit,
        quantity: parsedQty || 0,
        unitCost: parsedCost,
        vatRate: parsedVat,
        warehouseCode: rowWh,
        lotNumber: lotNumber || undefined,
        expiryDate: expiryDate || undefined,
        lineNote: lineNote || undefined,
        status,
        isNew,
        errors,
      });
    }

    return results;
  }, [rawRows, headerRowIdx, mapping, fileHeaders, materialMap, warehouseSet, fallbackWarehouse, movementKind]);

  // Thống kê số lượng dòng
  const stats = useMemo(() => {
    const total = parsedDataResults.length;
    const valid = parsedDataResults.filter((r) => r.status === 'valid').length;
    const warning = parsedDataResults.filter((r) => r.status === 'warning').length;
    const error = parsedDataResults.filter((r) => r.status === 'error').length;
    const readyToImport = valid + warning;
    const totalQty = parsedDataResults
      .filter((r) => r.status !== 'error')
      .reduce((sum, r) => sum + r.quantity, 0);
    return { total, valid, warning, error, readyToImport, totalQty };
  }, [parsedDataResults]);

  // Xử lý nạp dữ liệu vào MovementForm
  const handleConfirmImport = () => {
    const validRows = parsedDataResults.filter((r) => r.status !== 'error');
    if (validRows.length === 0) {
      alert('Không có dòng vật tư nào hợp lệ để nhập vào phiếu!');
      return;
    }

    const importedLineItems: MovementLineItem[] = validRows.map((r, idx) => ({
      id: `imported-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
      materialCode: r.materialCode,
      materialName: r.materialName,
      unit: r.unit,
      warehouseCode: r.warehouseCode,
      quantity: r.quantity,
      unitCost: r.unitCost,
      vatRate: r.vatRate,
      serialNumbers: [],
      lineNote: r.lineNote || (r.isNew ? 'Vật tư mới nhập từ file Excel' : undefined),
      receiptLot: movementKind === 'receipt' && r.lotNumber
        ? {
            lotNumber: r.lotNumber,
            expiryDate: r.expiryDate,
            status: 'PASSED' as const,
          }
        : undefined,
      newMaterial: movementKind === 'receipt' && r.isNew
        ? {
            code: r.materialCode,
            name: r.materialName,
            unit: r.unit,
            minStock: 0,
          }
        : undefined,
    }));

    onImportItems(importedLineItems);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div
        className={`${styles.modalDialog} ${styles.movementDialog}`}
        style={{
          maxWidth: '1080px',
          width: '95vw',
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Dialog */}
        <div className={styles.modalHead}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  background: '#dcfce7',
                  color: '#15803d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <FileSpreadsheet size={18} />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
                  Thêm vật tư hàng loạt cho phiếu {movementLabel} từ tệp Excel
                </h2>
                <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                  Tự động nhận diện cấu trúc tệp của mọi phần mềm và hỗ trợ khớp cột linh hoạt.
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onCancel}
            title="Đóng (ESC)"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* Thanh tiến trình 3 bước (Wizard Step Bar) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 24px',
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                background: step >= 1 ? '#2563eb' : '#e2e8f0',
                color: step >= 1 ? '#fff' : '#64748b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              1
            </div>
            <span style={{ fontSize: '13px', fontWeight: step === 1 ? 700 : 500, color: step === 1 ? '#0f172a' : '#64748b' }}>
              Chọn tệp Excel
            </span>
          </div>

          <div style={{ height: '1px', flex: 1, background: '#e2e8f0', margin: '0 16px' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                background: step >= 2 ? '#2563eb' : '#e2e8f0',
                color: step >= 2 ? '#fff' : '#64748b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              2
            </div>
            <span style={{ fontSize: '13px', fontWeight: step === 2 ? 700 : 500, color: step === 2 ? '#0f172a' : '#64748b' }}>
              Ánh xạ cột dữ liệu
            </span>
          </div>

          <div style={{ height: '1px', flex: 1, background: '#e2e8f0', margin: '0 16px' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                background: step >= 3 ? '#2563eb' : '#e2e8f0',
                color: step >= 3 ? '#fff' : '#64748b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              3
            </div>
            <span style={{ fontSize: '13px', fontWeight: step === 3 ? 700 : 500, color: step === 3 ? '#0f172a' : '#64748b' }}>
              Kiểm tra &amp; Nạp vào phiếu
            </span>
          </div>
        </div>

        {/* Thân Hộp Thoại */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {/* ===================== BƯỚC 1: TẢI FILE ===================== */}
          {step === 1 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileChange(file);
                }}
              />

              <div
                style={{
                  border: '2px dashed #cbd5e1',
                  borderRadius: '12px',
                  padding: '40px 20px',
                  textAlign: 'center',
                  background: '#f8fafc',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileChange(file);
                }}
              >
                <div
                  style={{
                    width: '52px',
                    height: '52px',
                    borderRadius: '50%',
                    background: '#eff6ff',
                    color: '#2563eb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 12px',
                  }}
                >
                  <Upload size={24} />
                </div>
                <h3 style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 600, color: '#1e293b' }}>
                  {fileName ? `Đã chọn: ${fileName} (${fileSize})` : 'Kéo thả tệp Excel vào đây hoặc bấm để chọn tệp'}
                </h3>
                <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                  Chấp nhận file định dạng .xlsx, .xls hoặc .csv (dung lượng tối đa 20MB)
                </p>
                {fileName ? (
                  <button
                    type="button"
                    style={{
                      marginTop: '12px',
                      padding: '6px 14px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    Chọn tệp khác
                  </button>
                ) : (
                  <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #2563eb',
                        background: '#2563eb',
                        color: '#ffffff',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        boxShadow: '0 1px 2px rgba(37,99,235,0.2)',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      <Upload size={14} />
                      <span>Tải file từ máy</span>
                    </button>

                    <a
                      href="/mau_nhap_kho_chuan.xlsx"
                      download="mau_nhap_kho_chuan.xlsx"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#2563eb',
                        fontSize: '12px',
                        fontWeight: 600,
                        textDecoration: 'none',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Download size={14} />
                      <span>Tải file Mẫu chuẩn (.xlsx)</span>
                    </a>

                    <a
                      href="/test_anh_xa_cot_khac_mau.xlsx"
                      download="test_anh_xa_cot_khac_mau.xlsx"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#15803d',
                        fontSize: '12px',
                        fontWeight: 600,
                        textDecoration: 'none',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Download size={14} />
                      <span>Tải file Thử nghiệm ánh xạ cột (.xlsx)</span>
                    </a>
                  </div>
                )}
              </div>

              {sheets.length > 0 ? (
                <div
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                        Trang tính (Sheet) cần đọc:
                      </label>
                      <SearchableSelect
                        options={sheets.map((sheet) => ({ value: sheet, label: sheet }))}
                        value={selectedSheet}
                        placeholder="Tìm trang tính…"
                        emptyText="Không tìm thấy trang tính"
                        clearable={false}
                        onChange={setSelectedSheet}
                        style={{ width: '100%', fontSize: '13px' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                        {warehouseLabel} mặc định:
                      </label>
                      <SearchableSelect
                        options={warehouses.map((warehouse) => ({
                          value: warehouse.code,
                          label: `${warehouse.name} (${warehouse.code})`,
                          badge: warehouse.code,
                        }))}
                        value={fallbackWarehouse}
                        placeholder="Tìm mã hoặc tên kho…"
                        emptyText="Không tìm thấy kho phù hợp"
                        clearable={false}
                        onChange={setFallbackWarehouse}
                        style={{ width: '100%', fontSize: '13px' }}
                      />
                    </div>
                  </div>

                  {/* Chọn dòng Tiêu đề (Header Row) */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                        Dòng tiêu đề (Chứa tên các cột):
                      </label>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>
                        Hệ thống tự động phát hiện dòng số <strong>{headerRowIdx + 1}</strong>
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12.5px', color: '#475569' }}>Dòng số:</span>
                      <input
                        type="number"
                        min={1}
                        max={Math.min(rawRows.length, 50)}
                        style={{
                          width: '70px',
                          padding: '6px 8px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          fontSize: '13px',
                          textAlign: 'center',
                        }}
                        value={headerRowIdx + 1}
                        onChange={(e) => handleChangeHeaderRow(Number(e.target.value) - 1)}
                      />
                      <span style={{ fontSize: '12px', color: '#64748b' }}>
                        (Bỏ qua các dòng tên công ty / tiêu đề hóa đơn ở các dòng trên)
                      </span>
                    </div>
                  </div>

                  {/* Xem trước 3 dòng đầu tiên của file */}
                  {rawRows.length > 0 ? (
                    <div>
                      <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '6px' }}>
                        Xem trước cấu trúc file (3 dòng đầu):
                      </span>
                      <div style={{ overflowX: 'auto', border: '1px solid #f1f5f9', borderRadius: '6px' }}>
                        <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                          <tbody>
                            {rawRows.slice(0, 4).map((r, rIdx) => (
                              <tr
                                key={rIdx}
                                style={{
                                  background: rIdx === headerRowIdx ? '#eff6ff' : rIdx % 2 === 0 ? '#fff' : '#f8fafc',
                                  fontWeight: rIdx === headerRowIdx ? 700 : 400,
                                  borderBottom: '1px solid #e2e8f0',
                                }}
                              >
                                <td style={{ padding: '6px 10px', color: '#94a3b8', width: '50px' }}>
                                  #{rIdx + 1}
                                  {rIdx === headerRowIdx ? ' (Header)' : ''}
                                </td>
                                {r.slice(0, 7).map((cell: any, cIdx: number) => (
                                  <td key={cIdx} style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                                    {String(cell ?? '')}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ===================== BƯỚC 2: ÁNH XẠ CỘT ===================== */}
          {step === 2 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Profile Bar: Chọn mẫu đã lưu */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '8px',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={16} color="#16a34a" />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#166534' }}>
                    Mẫu cấu hình khớp cột (Mapping Profiles):
                  </span>
                  <SearchableSelect
                    options={Object.keys(savedProfiles).map((profileName) => ({
                      value: profileName,
                      label: profileName,
                    }))}
                    value={selectedProfileName}
                    placeholder="Chọn cấu hình đã lưu…"
                    searchPlaceholder="Nhập tên cấu hình để lọc…"
                    emptyText="Chưa có cấu hình đã lưu phù hợp"
                    onChange={handleApplyProfile}
                    clearable
                    style={{ width: '260px', fontSize: '12.5px' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {selectedProfileName ? (
                    <button
                      type="button"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#dc2626',
                        fontSize: '12px',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                      onClick={() => handleDeleteProfile(selectedProfileName)}
                    >
                      Xóa mẫu này
                    </button>
                  ) : null}

                  <button
                    type="button"
                    style={{
                      padding: '5px 12px',
                      borderRadius: '6px',
                      border: '1px solid #86efac',
                      background: '#ffffff',
                      color: '#15803d',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    onClick={() => setShowSaveProfileModal(true)}
                  >
                    + Lưu mẫu khớp cột này
                  </button>
                </div>
              </div>

              {/* Bảng Ánh xạ các trường */}
              <div
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}
              >
                <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                  <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ padding: '10px 14px', textAlign: 'left', width: '220px', color: '#475569' }}>
                        Trường hệ thống
                      </th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', width: '110px', color: '#475569' }}>
                        Bắt buộc?
                      </th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', color: '#475569' }}>
                        Chọn cột tương ứng trong tệp Excel của bạn
                      </th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', width: '240px', color: '#475569' }}>
                        Dữ liệu dòng 1 ví dụ
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* 1. Mã vật tư */}
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>
                        Mã vật tư / SKU
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ fontSize: '11px', background: '#fee2e2', color: '#b91c1c', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                          Bắt buộc
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <ColumnMappingSelect
                          headers={fileHeaders}
                          value={mapping.materialCode}
                          placeholder="Chọn cột mã vật tư…"
                          onChange={(value) => setMapping((m) => ({ ...m, materialCode: value }))}
                        />
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {mapping.materialCode && fileHeaders.indexOf(mapping.materialCode) >= 0
                          ? String(rawRows[headerRowIdx + 1]?.[fileHeaders.indexOf(mapping.materialCode)] ?? '—')
                          : '—'}
                      </td>
                    </tr>

                    {/* 2. Tên vật tư */}
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>
                        Tên vật tư / Quy cách
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b', fontSize: '12px' }}>
                        Tùy chọn
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <ColumnMappingSelect
                          headers={fileHeaders}
                          value={mapping.materialName}
                          placeholder="Để trống để lấy từ danh mục…"
                          onChange={(value) => setMapping((m) => ({ ...m, materialName: value }))}
                        />
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {mapping.materialName && fileHeaders.indexOf(mapping.materialName) >= 0
                          ? String(rawRows[headerRowIdx + 1]?.[fileHeaders.indexOf(mapping.materialName)] ?? '—')
                          : '—'}
                      </td>
                    </tr>

                    {/* 3. Đơn vị tính */}
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>
                        Đơn vị tính (ĐVT)
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b', fontSize: '12px' }}>
                        Tùy chọn
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <ColumnMappingSelect
                          headers={fileHeaders}
                          value={mapping.unit}
                          placeholder="Mặc định Cái hoặc theo danh mục…"
                          onChange={(value) => setMapping((m) => ({ ...m, unit: value }))}
                        />
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {mapping.unit && fileHeaders.indexOf(mapping.unit) >= 0
                          ? String(rawRows[headerRowIdx + 1]?.[fileHeaders.indexOf(mapping.unit)] ?? '—')
                          : '—'}
                      </td>
                    </tr>

                    {/* 4. Số lượng */}
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>
                        Số lượng nhập
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ fontSize: '11px', background: '#fee2e2', color: '#b91c1c', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                          Bắt buộc
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <ColumnMappingSelect
                          headers={fileHeaders}
                          value={mapping.quantity}
                          placeholder="Chọn cột số lượng…"
                          onChange={(value) => setMapping((m) => ({ ...m, quantity: value }))}
                        />
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {mapping.quantity && fileHeaders.indexOf(mapping.quantity) >= 0
                          ? String(rawRows[headerRowIdx + 1]?.[fileHeaders.indexOf(mapping.quantity)] ?? '—')
                          : '—'}
                      </td>
                    </tr>

                    {/* 5. Đơn giá */}
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>
                        Đơn giá nhập (VNĐ)
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b', fontSize: '12px' }}>
                        Tùy chọn
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <ColumnMappingSelect
                          headers={fileHeaders}
                          value={mapping.unitCost}
                          placeholder="Bỏ qua đơn giá…"
                          onChange={(value) => setMapping((m) => ({ ...m, unitCost: value }))}
                        />
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {mapping.unitCost && fileHeaders.indexOf(mapping.unitCost) >= 0
                          ? String(rawRows[headerRowIdx + 1]?.[fileHeaders.indexOf(mapping.unitCost)] ?? '—')
                          : '—'}
                      </td>
                    </tr>

                    {/* 5b. Thuế suất VAT */}
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>
                        Thuế suất VAT (%)
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b', fontSize: '12px' }}>
                        Tùy chọn
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <ColumnMappingSelect
                          headers={fileHeaders}
                          value={mapping.vatRate}
                          placeholder="Mặc định theo biểu mẫu nhập kho…"
                          onChange={(value) => setMapping((m) => ({ ...m, vatRate: value }))}
                        />
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {mapping.vatRate && fileHeaders.indexOf(mapping.vatRate) >= 0
                          ? String(rawRows[headerRowIdx + 1]?.[fileHeaders.indexOf(mapping.vatRate)] ?? '—')
                          : '—'}
                      </td>
                    </tr>

                    {/* 6. Kho thực hiện */}
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>
                        {warehouseLabel} riêng từng dòng
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b', fontSize: '12px' }}>
                        Tùy chọn
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <ColumnMappingSelect
                          headers={fileHeaders}
                          value={mapping.warehouseCode}
                          placeholder={`Lấy theo kho mặc định (${fallbackWarehouse})…`}
                          onChange={(value) => setMapping((m) => ({ ...m, warehouseCode: value }))}
                        />
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {mapping.warehouseCode && fileHeaders.indexOf(mapping.warehouseCode) >= 0
                          ? String(rawRows[headerRowIdx + 1]?.[fileHeaders.indexOf(mapping.warehouseCode)] ?? '—')
                          : fallbackWarehouse}
                      </td>
                    </tr>

                    {/* 7. Số lô */}
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>
                        Số lô (Lot / Batch)
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b', fontSize: '12px' }}>
                        Tùy chọn
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <ColumnMappingSelect
                          headers={fileHeaders}
                          value={mapping.lotNumber}
                          placeholder="Bỏ qua số lô…"
                          onChange={(value) => setMapping((m) => ({ ...m, lotNumber: value }))}
                        />
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {mapping.lotNumber && fileHeaders.indexOf(mapping.lotNumber) >= 0
                          ? String(rawRows[headerRowIdx + 1]?.[fileHeaders.indexOf(mapping.lotNumber)] ?? '—')
                          : '—'}
                      </td>
                    </tr>

                    {/* 8. Ghi chú */}
                    <tr>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>
                        Ghi chú dòng
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b', fontSize: '12px' }}>
                        Tùy chọn
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <ColumnMappingSelect
                          headers={fileHeaders}
                          value={mapping.lineNote}
                          placeholder="Bỏ qua ghi chú…"
                          onChange={(value) => setMapping((m) => ({ ...m, lineNote: value }))}
                        />
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {mapping.lineNote && fileHeaders.indexOf(mapping.lineNote) >= 0
                          ? String(rawRows[headerRowIdx + 1]?.[fileHeaders.indexOf(mapping.lineNote)] ?? '—')
                          : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* ===================== BƯỚC 3: KIỂM TRA & XÁC NHẬN ===================== */}
          {step === 3 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Dải tổng quan trạng thái */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                  <span style={{ color: '#64748b' }}>Tổng số dòng đọc được:</span>
                  <strong style={{ color: '#0f172a' }}>{stats.total}</strong>
                </div>

                <div style={{ width: '1px', height: '16px', background: '#cbd5e1' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16a34a' }} />
                  <span style={{ color: '#166534', fontWeight: 600 }}>Hợp lệ: {stats.valid}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#eab308' }} />
                  <span style={{ color: '#854d0e', fontWeight: 600 }}>Mã mới (tự tạo): {stats.warning}</span>
                </div>

                {stats.error > 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#dc2626' }} />
                    <span style={{ color: '#991b1b', fontWeight: 600 }}>Lỗi (bỏ qua): {stats.error}</span>
                  </div>
                ) : null}

                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12.5px', color: '#475569' }}>
                    Tổng số lượng dự kiến nhập: <strong>{new Intl.NumberFormat('vi-VN').format(stats.totalQty)}</strong>
                  </span>
                </div>
              </div>

              {/* Bảng xem trước danh sách chi tiết */}
              <div
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  overflowX: 'auto',
                  maxHeight: '400px',
                }}
              >
                <table style={{ width: '100%', fontSize: '12.5px', borderCollapse: 'collapse' }}>
                  <thead style={{ background: '#f8fafc', position: 'sticky', top: 0, zIndex: 1, borderBottom: '1px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ padding: '8px 10px', textAlign: 'center', width: '45px' }}>#</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center', width: '100px' }}>Trạng thái</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: '130px' }}>Mã vật tư</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: '200px' }}>Tên vật tư</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center', width: '70px' }}>ĐVT</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', width: '85px' }}>Số lượng</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', width: '110px' }}>Đơn giá</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center', width: '70px' }}>% VAT</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', width: '100px' }}>{warehouseLabel}</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', width: '100px' }}>Số lô</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: '130px' }}>Ghi chú / Lỗi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedDataResults.map((r) => (
                      <tr
                        key={r.rowIndex}
                        style={{
                          background: r.status === 'error' ? '#fef2f2' : r.isNew ? '#fefce8' : '#ffffff',
                          borderBottom: '1px solid #f1f5f9',
                        }}
                      >
                        <td style={{ padding: '8px 10px', textAlign: 'center', color: '#94a3b8' }}>
                          {r.rowIndex}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          {r.status === 'valid' ? (
                            <span style={{ fontSize: '11px', background: '#dcfce7', color: '#15803d', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                              Hợp lệ
                            </span>
                          ) : r.status === 'warning' ? (
                            <span style={{ fontSize: '11px', background: '#fef08a', color: '#854d0e', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                              Mã mới
                            </span>
                          ) : (
                            <span style={{ fontSize: '11px', background: '#fee2e2', color: '#b91c1c', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                              Lỗi
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0f172a' }}>
                          {r.materialCode}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#334155' }}>
                          {r.materialName}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', color: '#475569' }}>
                          {r.unit}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                          {r.quantity > 0 ? new Intl.NumberFormat('vi-VN').format(r.quantity) : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#475569' }}>
                          {r.unitCost !== undefined ? new Intl.NumberFormat('vi-VN').format(r.unitCost) : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', color: '#475569', fontWeight: 600 }}>
                          {r.vatRate !== undefined ? `${r.vatRate}%` : 'Mặc định'}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#334155' }}>
                          {r.warehouseCode}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#64748b' }}>
                          {r.lotNumber || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: '12px' }}>
                          {r.errors.length > 0 ? (
                            <span style={{ color: '#dc2626', fontWeight: 500 }}>
                              {r.errors.join(', ')}
                            </span>
                          ) : r.isNew ? (
                            <span style={{ color: '#a16207' }}>
                              Chưa có trong danh mục (sẽ tự động tạo)
                            </span>
                          ) : (
                            <span style={{ color: '#64748b' }}>{r.lineNote || '—'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>

        {/* Modal nhỏ lưu mẫu Profile */}
        {showSaveProfileModal ? (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
            }}
            onClick={() => setShowSaveProfileModal(false)}
          >
            <div
              style={{
                background: '#fff',
                borderRadius: '8px',
                padding: '20px',
                width: '380px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h4 style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                Lưu cấu hình khớp cột
              </h4>
              <p style={{ margin: '0 0 14px', fontSize: '12.5px', color: '#64748b' }}>
                Đặt tên cho mẫu để sử dụng lại cho các file có cấu trúc tương tự (ví dụ: "File NCC Tân Á", "File MISA").
              </p>
              <input
                type="text"
                placeholder="Nhập tên mẫu cấu hình..."
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  marginBottom: '16px',
                }}
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                autoFocus
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    background: '#fff',
                    color: '#475569',
                    fontSize: '12.5px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setShowSaveProfileModal(false)}
                >
                  Huỷ
                </button>
                <button
                  type="button"
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#2563eb',
                    color: '#fff',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  disabled={!newProfileName.trim()}
                  onClick={handleSaveCurrentProfile}
                >
                  Lưu mẫu
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Footer Actions của Wizard */}
        <div
          className={styles.modalFoot}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 24px',
            borderTop: '1px solid #e2e8f0',
            background: '#ffffff',
          }}
        >
          <div>
            {step > 1 ? (
              <button
                type="button"
                className={`${styles.action} ${styles.actionGhost}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                onClick={() => setStep((s) => (s - 1) as any)}
              >
                <ArrowLeft size={15} />
                <span>Quay lại bước trước</span>
              </button>
            ) : (
              <button
                type="button"
                className={`${styles.action} ${styles.actionGhost}`}
                onClick={onCancel}
              >
                Huỷ bỏ
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {step === 1 ? (
              <button
                type="button"
                className={`${styles.action} ${styles.actionPrimary}`}
                disabled={!fileName || rawRows.length === 0}
                onClick={() => setStep(2)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <span>Tiếp tục: Khớp cột dữ liệu</span>
                <ArrowRight size={15} />
              </button>
            ) : null}

            {step === 2 ? (
              <button
                type="button"
                className={`${styles.action} ${styles.actionPrimary}`}
                disabled={!mapping.materialCode || !mapping.quantity}
                onClick={() => setStep(3)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <span>Tiếp tục: Kiểm tra dữ liệu ({rawRows.length > headerRowIdx + 1 ? `${rawRows.length - headerRowIdx - 1} dòng` : '0 dòng'})</span>
                <ArrowRight size={15} />
              </button>
            ) : null}

            {step === 3 ? (
              <button
                type="button"
                className={`${styles.action} ${styles.actionPrimary}`}
                disabled={stats.readyToImport === 0}
                onClick={handleConfirmImport}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: '#16a34a',
                  borderColor: '#16a34a',
                }}
              >
                <Check size={16} />
                <span>Đồng ý nạp {stats.readyToImport} vật tư vào phiếu</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
