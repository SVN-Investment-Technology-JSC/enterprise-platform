'use client';

import type {
  Material,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import {
  SearchableSelect,
  formatCurrencyVn,
  formatQuantityVn,
  parseVnNumber,
  CloseGuard,
} from '@enterprise-platform/shared-ui';
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Building2,
  Check,
  Download,
  FileSpreadsheet,
  Layers,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import type { MovementKind, MovementLineItem } from './movement-form';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

export interface ExcelImportDialogProps {
  warehouses: readonly Warehouse[];
  materials: readonly Material[];
  /** Nghiệp vụ nhận danh sách vật tư từ tệp Excel. */
  movementKind?: MovementKind;
  defaultWarehouseCode: string;
  /** Chốt chặn chỉ xuất nhập 1 kho - 1 phiếu: cố định mọi dòng theo kho của phiếu */
  isSingleWarehouseOnly?: boolean;
  onCancel: () => void;
  onImportItems: (importedItems: MovementLineItem[]) => void;
}

/** Chuẩn hoá chuỗi không dấu để so khớp từ khóa thông minh */
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

/**
 * Chuyển giá trị từ Excel thành số. Ô kiểu số dùng thẳng; chuỗi đọc theo chuẩn Việt Nam
 * (`500.000.000,01`, `500000000,01`, `500000000.01`). Không đọc được thì trả `undefined` để báo lỗi dòng.
 */
function parseNumericValue(val: unknown): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'number') return Number.isFinite(val) ? val : undefined;
  return parseVnNumber(String(val).replace(/[$€¥]/g, '')) ?? undefined;
}

export interface ColumnMapping {
  materialCode: string; // Mã hàng hóa / SKU
  barcode: string; // Mã vạch
  materialName: string; // Tên hàng hóa
  materialType: string; // Nhóm hàng hóa
  manufacturer: string; // Thương hiệu / Hãng SX
  unit: string; // Đơn vị tính
  warehouseCode: string; // Kho lưu trữ
  locationId: string; // Vị trí kệ / ô
  quantity: string; // Số lượng tồn / nhập
  unitCost: string; // Đơn giá vốn
  vatRate: string; // Thuế suất VAT
  minStock: string; // Tồn tối thiểu
  maxStock: string; // Tồn tối đa
  lotNumber: string; // Số lô
  expiryDate: string; // Hạn sử dụng
  lineNote: string; // Ghi chú
}

const DEFAULT_MAPPING: ColumnMapping = {
  materialCode: '',
  barcode: '',
  materialName: '',
  materialType: '',
  manufacturer: '',
  unit: '',
  warehouseCode: '',
  locationId: '',
  quantity: '',
  unitCost: '',
  vatRate: '',
  minStock: '',
  maxStock: '',
  lotNumber: '',
  expiryDate: '',
  lineNote: '',
};

type ConfidenceLevel = 'exact' | 'high' | 'auto' | 'none';

interface FieldRule {
  key: keyof ColumnMapping;
  label: string;
  required: boolean;
  category: 'identity' | 'stock' | 'cost';
  positiveKeywords: string[];
  negativeKeywords?: string[];
}

const FIELD_RULES: FieldRule[] = [
  // 1. NHÓM ĐỊNH DANH HÀNG HÓA
  {
    key: 'materialCode',
    label: 'Mã hàng hóa (SKU)',
    required: true,
    category: 'identity',
    positiveKeywords: [
      'ma vat tu',
      'ma vt',
      'ma hang hoa',
      'ma hang',
      'sku',
      'part number',
      'part no',
      'item code',
      'ma sp',
      'ma san pham',
      'ma vthh',
      'internal reference',
      'item no',
      'code',
      'material code',
    ],
    negativeKeywords: [
      'kho',
      'nhom',
      'loai',
      'dvt',
      'don vi',
      'vach',
      'barcode',
      'gia',
      'cost',
      'tien',
      'so luong',
      'sl',
      'ten',
      'name',
    ],
  },
  {
    key: 'barcode',
    label: 'Mã vạch (Barcode)',
    required: false,
    category: 'identity',
    positiveKeywords: [
      'ma vach',
      'barcode',
      'bar code',
      'qr code',
      'ma vach/barcode',
      'ma vach (barcode)',
      'qr',
      'upc',
      'ean',
    ],
    negativeKeywords: ['kho', 'nhom', 'don vi', 'so luong', 'gia', 'tien'],
  },
  {
    key: 'materialName',
    label: 'Tên hàng hóa / Quy cách',
    required: false,
    category: 'identity',
    positiveKeywords: [
      'ten vat tu',
      'ten vt',
      'ten hang hoa',
      'ten hang',
      'ten san pham',
      'ten sp',
      'ten vthh',
      'dien giai',
      'description',
      'product name',
      'item description',
      'quy cach',
      'ten mat hang',
      'material name',
      'item name',
    ],
    negativeKeywords: [
      'nhom',
      'kho',
      'loai',
      'dvt',
      'don vi',
      'gia',
      'cost',
      'ma',
      'sku',
      'code',
    ],
  },
  {
    key: 'materialType',
    label: 'Nhóm hàng hóa (Category)',
    required: false,
    category: 'identity',
    positiveKeywords: [
      'nhom vat tu',
      'nhom hang hoa',
      'nhom hang',
      'nhom hh/dv',
      'nhom vthh',
      'ten nhom',
      'thuoc nhom',
      'loai vat tu',
      'loai hang',
      'phan loai',
      'category',
      'product category',
      'item group',
      'material type',
      'type',
      'nhom',
    ],
    negativeKeywords: ['kho', 'gia', 'tien', 'dvt', 'don vi', 'ten hang'],
  },
  {
    key: 'manufacturer',
    label: 'Thương hiệu / Hãng SX',
    required: false,
    category: 'identity',
    positiveKeywords: [
      'nha san xuat',
      'hang san xuat',
      'thuong hieu',
      'nha sx',
      'hang sx',
      'brand',
      'manufacturer',
      'hang',
    ],
    negativeKeywords: ['kho', 'gia', 'nhom', 'ten hang'],
  },
  {
    key: 'unit',
    label: 'Đơn vị tính (ĐVT)',
    required: false,
    category: 'identity',
    positiveKeywords: [
      'don vi tinh',
      'dvt',
      'don vi',
      'dvt chinh',
      'unit',
      'uom',
      'unit of measure',
      'uom name',
    ],
    negativeKeywords: ['gia', 'cost', 'tien', 'don gia', 'gia von'],
  },

  // 2. NHÓM KHO BÃI & SỐ LƯỢNG
  {
    key: 'quantity',
    label: 'Số lượng tồn / nhập',
    required: true,
    category: 'stock',
    positiveKeywords: [
      'so luong',
      'sl',
      'ton kho',
      'so luong ton',
      'ton thuc te',
      'thuc te',
      'thuc nhan',
      'thuc xuat',
      'quantity',
      'qty',
      'on-hand',
      'on hand',
      'on hand quantity',
      'in stock',
      'amount',
      'so luong nhap',
    ],
    negativeKeywords: ['gia', 'cost', 'don gia', 'dvt', 'don vi', 'tien'],
  },
  {
    key: 'warehouseCode',
    label: 'Kho lưu trữ (Mã / Tên kho)',
    required: false,
    category: 'stock',
    positiveKeywords: [
      'kho',
      'kho nhan',
      'kho xuat',
      'ma kho',
      'ten kho',
      'kho hang',
      'warehouse',
      'warehouse code',
      'whse',
      'vi tri kho',
      'location',
    ],
    negativeKeywords: ['ke', 'o ke', 'bin', 'rack', 'gia', 'cost'],
  },
  {
    key: 'locationId',
    label: 'Vị trí kệ / ô (Bin Rack)',
    required: false,
    category: 'stock',
    positiveKeywords: [
      'vi tri ke',
      'ke',
      'o ke',
      'bin',
      'rack',
      'bin rack',
      'vi tri luu kho',
      'bin location',
      'ngan chua',
      'vi tri',
    ],
    negativeKeywords: ['ma kho', 'ten kho', 'kho hang'],
  },
  {
    key: 'minStock',
    label: 'Định mức tồn tối thiểu (Min)',
    required: false,
    category: 'stock',
    positiveKeywords: [
      'ton toi thieu',
      'dinh muc ton toi thieu',
      'min stock',
      'min',
    ],
    negativeKeywords: ['toi da', 'max'],
  },
  {
    key: 'maxStock',
    label: 'Định mức tồn tối đa (Max)',
    required: false,
    category: 'stock',
    positiveKeywords: ['ton toi da', 'dinh muc ton toi da', 'max stock', 'max'],
    negativeKeywords: ['toi thieu', 'min'],
  },

  // 3. NHÓM GIÁ VỐN & LÔ / HẠN DÙNG
  {
    key: 'unitCost',
    label: 'Đơn giá vốn / Đơn giá nhập',
    required: false,
    category: 'cost',
    positiveKeywords: [
      'don gia',
      'don gia nhap',
      'don gia von',
      'gia von',
      'gia nhap',
      'gia mua',
      'don gia binh quan',
      'unit cost',
      'cost',
      'price',
      'unit price',
      'avg price',
      'purchase price',
      'gia',
    ],
    negativeKeywords: ['so luong', 'sl', 'thue', 'vat', 'don vi tinh', 'dvt'],
  },
  {
    key: 'vatRate',
    label: 'Thuế suất VAT (%)',
    required: false,
    category: 'cost',
    positiveKeywords: [
      'thue suat',
      'thue vat',
      'vat',
      '% vat',
      'thue',
      'vat rate',
      'tax rate',
      '% thue',
    ],
    negativeKeywords: ['don gia', 'gia', 'tien'],
  },
  {
    key: 'lotNumber',
    label: 'Số lô (Lot / Batch)',
    required: false,
    category: 'cost',
    positiveKeywords: [
      'so lo',
      'lo',
      'lot',
      'lot number',
      'batch',
      'batch no',
      'so lo sx',
      'ma lo',
    ],
    negativeKeywords: ['loai', 'nhom'],
  },
  {
    key: 'expiryDate',
    label: 'Hạn sử dụng (Exp Date)',
    required: false,
    category: 'cost',
    positiveKeywords: [
      'han su dung',
      'han dung',
      'hsd',
      'expiry',
      'exp date',
      'expiry date',
      'ngay het han',
    ],
    negativeKeywords: ['ngay sx', 'ngay tao'],
  },
  {
    key: 'lineNote',
    label: 'Ghi chú dòng',
    required: false,
    category: 'cost',
    positiveKeywords: [
      'ghi chu',
      'note',
      'dien giai dong',
      'dien giai',
      'remark',
      'comments',
    ],
    negativeKeywords: ['ten hang', 'ma hang'],
  },
];

/** Thuật toán liên kết cột thông minh đa tầng (Smart Multi-tiered Matcher) */
function detectSmartColumnMapping(headers: readonly string[]): {
  mapping: ColumnMapping;
  confidences: Record<keyof ColumnMapping, ConfidenceLevel>;
} {
  const mapping: ColumnMapping = { ...DEFAULT_MAPPING };
  const confidences: Record<keyof ColumnMapping, ConfidenceLevel> = {
    materialCode: 'none',
    barcode: 'none',
    materialName: 'none',
    materialType: 'none',
    manufacturer: 'none',
    unit: 'none',
    warehouseCode: 'none',
    locationId: 'none',
    quantity: 'none',
    unitCost: 'none',
    vatRate: 'none',
    minStock: 'none',
    maxStock: 'none',
    lotNumber: 'none',
    expiryDate: 'none',
    lineNote: 'none',
  };

  const assignedHeaders = new Set<string>();

  // TẦNG 1: Khớp chính xác 100% (Exact Match)
  for (const rule of FIELD_RULES) {
    for (const h of headers) {
      if (assignedHeaders.has(h)) continue;
      const normH = normalize(h);
      const exactMatch = rule.positiveKeywords.some((k) => normH === k);
      if (exactMatch) {
        mapping[rule.key] = h;
        confidences[rule.key] = 'exact';
        assignedHeaders.add(h);
        break;
      }
    }
  }

  // TẦNG 2: Khớp cụm từ có trọng số và loại trừ xung đột (Negative Keywords)
  for (const rule of FIELD_RULES) {
    if (mapping[rule.key]) continue; // Đã khớp ở tầng 1

    let bestScore = 0;
    let bestHeader = '';

    for (const h of headers) {
      if (assignedHeaders.has(h)) continue;
      const normH = normalize(h);

      // Kiểm tra có chứa từ khóa loại trừ không
      const hasNegative = rule.negativeKeywords?.some((neg) => {
        // Chỉ coi là negative nếu normH chứa từ loại trừ độc lập
        return (
          normH === neg ||
          normH.startsWith(`${neg} `) ||
          normH.endsWith(` ${neg}`) ||
          normH.includes(` ${neg} `)
        );
      });
      if (hasNegative) continue;

      for (const kw of rule.positiveKeywords) {
        let score = 0;
        if (normH === kw) {
          score = 100;
        } else if (normH.startsWith(kw) || normH.endsWith(kw)) {
          score = 85 + (kw.length / normH.length) * 10;
        } else if (normH.includes(kw)) {
          score = 70 + (kw.length / normH.length) * 10;
        }

        if (score > bestScore) {
          bestScore = score;
          bestHeader = h;
        }
      }
    }

    if (bestScore >= 70 && bestHeader) {
      mapping[rule.key] = bestHeader;
      confidences[rule.key] = bestScore >= 85 ? 'high' : 'auto';
      assignedHeaders.add(bestHeader);
    }
  }

  return { mapping, confidences };
}

/** Danh sách các Preset cấu hình chuẩn tích hợp sẵn cho các phần mềm phổ biến */
interface BuiltInPreset {
  id: string;
  name: string;
  software: string;
  description: string;
  mapping: ColumnMapping;
}

const BUILT_IN_PRESETS: BuiltInPreset[] = [
  {
    id: 'kiotviet',
    name: 'KiotViet (Xuất kho & Tồn kho)',
    software: 'KiotViet',
    description: 'Tương thích cấu hình xuất Excel chuẩn từ KiotViet',
    mapping: {
      ...DEFAULT_MAPPING,
      materialCode: 'Mã hàng',
      barcode: 'Mã vạch',
      materialName: 'Tên hàng',
      materialType: 'Tên nhóm',
      manufacturer: 'Thương hiệu',
      unit: 'ĐVT',
      quantity: 'Tồn kho',
      unitCost: 'Giá vốn',
      locationId: 'Vị trí',
    },
  },
  {
    id: 'misa',
    name: 'MISA SME / AMIS (VTHH & Sổ kho)',
    software: 'MISA',
    description: 'Tương thích Báo cáo tồn kho & Danh mục vật tư từ MISA',
    mapping: {
      ...DEFAULT_MAPPING,
      materialCode: 'Mã hàng',
      materialName: 'Tên hàng',
      materialType: 'Nhóm VTHH',
      unit: 'ĐVT chính',
      warehouseCode: 'Mã kho',
      quantity: 'Số lượng tồn',
      unitCost: 'Đơn giá bình quân',
      lotNumber: 'Số lô',
      expiryDate: 'Hạn sử dụng',
    },
  },
  {
    id: 'odoo',
    name: 'Odoo ERP (Stock & Inventory Valuation)',
    software: 'Odoo',
    description: 'Tương thích báo cáo Stock on hand và Valuation từ Odoo',
    mapping: {
      ...DEFAULT_MAPPING,
      materialCode: 'Internal Reference',
      barcode: 'Barcode',
      materialName: 'Product Name',
      materialType: 'Product Category',
      unit: 'Unit of Measure',
      warehouseCode: 'Location',
      quantity: 'On Hand Quantity',
      unitCost: 'Cost',
    },
  },
  {
    id: 'sap',
    name: 'SAP Business One (Item Master Data)',
    software: 'SAP',
    description: 'Tương thích file Item Master và Warehouse Stock từ SAP',
    mapping: {
      ...DEFAULT_MAPPING,
      materialCode: 'Item No.',
      barcode: 'Bar Code',
      materialName: 'Item Description',
      materialType: 'Item Group',
      unit: 'UoM Name',
      warehouseCode: 'Whse',
      quantity: 'In Stock',
      unitCost: 'Avg. Price',
    },
  },
  {
    id: 'universal',
    name: 'Chuẩn Bảng phẳng ERP nội bộ (Phương án A)',
    software: 'Hệ thống ERP',
    description: 'Khớp 100% tệp xuất Phương án A của chính hệ thống',
    mapping: {
      ...DEFAULT_MAPPING,
      materialCode: 'Mã hàng hóa (SKU)',
      barcode: 'Mã vạch (Barcode)',
      materialName: 'Tên hàng hóa',
      materialType: 'Nhóm hàng hóa (Category)',
      manufacturer: 'Hãng sản xuất',
      unit: 'Đơn vị tính (UoM)',
      warehouseCode: 'Mã kho',
      locationId: 'Vị trí kệ / ô (Bin Rack)',
      quantity: 'Tồn thực tế (On-hand)',
      unitCost: 'Đơn giá vốn (VNĐ)',
      minStock: 'Định mức tồn tối thiểu (Min)',
      maxStock: 'Định mức tồn tối đa (Max)',
      lineNote: 'Ghi chú / Nơi lắp đặt',
    },
  },
];

interface ParsedRowResult {
  rowIndex: number;
  materialCode: string;
  barcode?: string;
  materialName: string;
  materialType?: string;
  manufacturer?: string;
  unit: string;
  warehouseCode: string;
  locationId?: string;
  quantity: number;
  unitCost?: number;
  vatRate?: number;
  minStock?: number;
  maxStock?: number;
  lotNumber?: string;
  expiryDate?: string;
  lineNote?: string;
  status: 'valid' | 'warning' | 'error';
  isNew: boolean;
  errors: string[];
}

const SAVED_PROFILES_STORAGE_KEY = 'inventory.smart_excel_import_profiles.v2';

export function ExcelImportDialog({
  warehouses,
  materials,
  movementKind,
  defaultWarehouseCode,
  isSingleWarehouseOnly = false,
  onCancel,
  onImportItems,
}: ExcelImportDialogProps) {
  const isDirectMovement = Boolean(movementKind);
  const movementLabel =
    movementKind === 'receipt'
      ? 'Nhập kho'
      : movementKind === 'issue'
        ? 'Xuất kho'
        : movementKind === 'transfer'
          ? 'Luân chuyển kho'
          : 'Kho hàng';

  const dialogTitle = isDirectMovement
    ? `Thêm vật tư hàng loạt cho phiếu ${movementLabel} từ tệp Excel`
    : 'Nhập dữ liệu vật tư & tồn kho hàng loạt từ tệp Excel (Hỗ trợ mọi phần mềm)';

  const dialogSubtitle = isDirectMovement
    ? 'Tự động nhận diện cấu trúc tệp của mọi phần mềm và hỗ trợ liên kết cột thông minh.'
    : 'Bổ sung tồn kho đa kho và tự động tạo danh mục cho các ứng dụng KiotViet, MISA, Odoo, SAP, Fast...';

  // Trạng thái Wizard: 1: Tải file -> 2: Khớp cột thông minh -> 3: Xem trước & Xác nhận
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // File & Excel Workbook state
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [rawRows, setRawRows] = useState<any[][]>([]);
  const [headerRowIdx, setHeaderRowIdx] = useState<number>(0);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);

  // Mapping state & Confidence
  const [mapping, setMapping] = useState<ColumnMapping>(DEFAULT_MAPPING);
  const [confidences, setConfidences] = useState<
    Record<keyof ColumnMapping, ConfidenceLevel>
  >({
    materialCode: 'none',
    barcode: 'none',
    materialName: 'none',
    materialType: 'none',
    manufacturer: 'none',
    unit: 'none',
    warehouseCode: 'none',
    locationId: 'none',
    quantity: 'none',
    unitCost: 'none',
    vatRate: 'none',
    minStock: 'none',
    maxStock: 'none',
    lotNumber: 'none',
    expiryDate: 'none',
    lineNote: 'none',
  });

  const [fallbackWarehouse, setFallbackWarehouse] = useState(
    defaultWarehouseCode || warehouses[0]?.code || '',
  );

  // Profile Mapping state (Lưu mẫu cấu hình)
  const [savedProfiles, setSavedProfiles] = useState<
    Record<string, ColumnMapping>
  >({});
  const [selectedPresetId, setSelectedPresetId] = useState<string>('auto');
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

  const warehouseMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of warehouses) {
      map.set(w.code.toUpperCase(), w.code);
      map.set(normalize(w.code), w.code);
      map.set(w.name.toUpperCase(), w.code);
      map.set(normalize(w.name), w.code);
    }
    return map;
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
        : `${Math.round(file.size / 1024)} KB`,
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

    // Tự động tìm dòng Header tốt nhất (dòng đầu tiên có ít nhất 2 cột text có nghĩa)
    let detectedHeaderIdx = 0;
    for (let i = 0; i < Math.min(jsonRows.length, 10); i++) {
      const row = jsonRows[i];
      if (
        Array.isArray(row) &&
        row.filter((cell) => typeof cell === 'string' && cell.trim().length > 1)
          .length >= 2
      ) {
        detectedHeaderIdx = i;
        break;
      }
    }
    setHeaderRowIdx(detectedHeaderIdx);

    const headerCells = (jsonRows[detectedHeaderIdx] || []).map((c, i) =>
      c !== undefined && c !== null && String(c).trim() !== ''
        ? String(c).trim()
        : `Cột ${i + 1}`,
    );
    setFileHeaders(headerCells);

    // Tự động liên kết cột thông minh
    const result = detectSmartColumnMapping(headerCells);
    setMapping(result.mapping);
    setConfidences(result.confidences);
    setSelectedPresetId('auto');
  };

  // Thay đổi dòng Header thủ công
  const handleChangeHeaderRow = (newIdx: number) => {
    if (newIdx < 0 || newIdx >= rawRows.length) return;
    setHeaderRowIdx(newIdx);
    const headerCells = (rawRows[newIdx] || []).map((c, i) =>
      c !== undefined && c !== null && String(c).trim() !== ''
        ? String(c).trim()
        : `Cột ${i + 1}`,
    );
    setFileHeaders(headerCells);
    const result = detectSmartColumnMapping(headerCells);
    setMapping(result.mapping);
    setConfidences(result.confidences);
    setSelectedPresetId('auto');
  };

  // Áp dụng Preset tích hợp sẵn hoặc Profile người dùng đã lưu
  const handleSelectPreset = (presetKey: string) => {
    setSelectedPresetId(presetKey);
    if (presetKey === 'auto') {
      const result = detectSmartColumnMapping(fileHeaders);
      setMapping(result.mapping);
      setConfidences(result.confidences);
      return;
    }

    const builtIn = BUILT_IN_PRESETS.find((p) => p.id === presetKey);
    if (builtIn) {
      const newMapping: ColumnMapping = { ...DEFAULT_MAPPING };
      const newConf: Record<keyof ColumnMapping, ConfidenceLevel> = {
        ...confidences,
      };

      for (const [fieldKey, expectedHeader] of Object.entries(
        builtIn.mapping,
      ) as [keyof ColumnMapping, string][]) {
        if (!expectedHeader) continue;
        const normExpected = normalize(expectedHeader);
        const match = fileHeaders.find(
          (h) =>
            normalize(h) === normExpected ||
            normalize(h).includes(normExpected),
        );
        if (match) {
          newMapping[fieldKey] = match;
          newConf[fieldKey] = 'high';
        }
      }
      setMapping(newMapping);
      setConfidences(newConf);
      return;
    }

    // Nếu là Custom Profile từ localStorage
    if (savedProfiles[presetKey]) {
      const p = savedProfiles[presetKey];
      setMapping({ ...p });
      const newConf: Record<keyof ColumnMapping, ConfidenceLevel> = {
        ...confidences,
      };
      for (const k of Object.keys(p) as (keyof ColumnMapping)[]) {
        if (p[k]) newConf[k] = 'exact';
      }
      setConfidences(newConf);
    }
  };

  // Lưu Profile mới
  const handleSaveCurrentProfile = () => {
    const trimmed = newProfileName.trim();
    if (!trimmed) return;
    const updated = { ...savedProfiles, [trimmed]: mapping };
    setSavedProfiles(updated);
    setSelectedPresetId(trimmed);
    localStorage.setItem(SAVED_PROFILES_STORAGE_KEY, JSON.stringify(updated));
    setShowSaveProfileModal(false);
    setNewProfileName('');
  };

  // Xoá Profile
  const handleDeleteProfile = (profileName: string) => {
    const updated = { ...savedProfiles };
    delete updated[profileName];
    setSavedProfiles(updated);
    if (selectedPresetId === profileName) {
      setSelectedPresetId('auto');
    }
    localStorage.setItem(SAVED_PROFILES_STORAGE_KEY, JSON.stringify(updated));
  };

  // Tạo tệp mẫu Excel chuẩn có sẵn đầy đủ 16 cột theo Phương án A
  const handleDownloadTemplate = () => {
    const wsData = [
      [
        'Mã hàng hóa (SKU)',
        'Mã vạch (Barcode)',
        'Tên hàng hóa',
        'Nhóm hàng hóa (Category)',
        'Hãng sản xuất',
        'Đơn vị tính (UoM)',
        'Mã kho',
        'Vị trí kệ / ô (Bin Rack)',
        'Tồn thực tế (On-hand)',
        'Đơn giá vốn (VNĐ)',
        'Thuế suất VAT (%)',
        'Định mức tồn tối thiểu (Min)',
        'Định mức tồn tối đa (Max)',
        'Số lô (Lot / Batch)',
        'Hạn sử dụng',
        'Ghi chú / Nơi lắp đặt',
      ],
      [
        'VT-001',
        'VT-001',
        'Dầu nhớt Castrol Magnatec 5W-30',
        'Dầu mỡ phụ gia',
        'Castrol',
        'Lít',
        defaultWarehouseCode || warehouses[0]?.code || 'KHO-01',
        'Kệ A1-02',
        50,
        185000,
        10,
        10,
        200,
        'LOT-2026-001',
        '2028-12-31',
        'Hàng nhập khẩu chính hãng',
      ],
      [
        'VT-002',
        'VT-002',
        'Lọc dầu nhớt xe nâng Toyota 2.5T',
        'Phụ tùng thay thế',
        'Toyota OEM',
        'Cái',
        defaultWarehouseCode || warehouses[0]?.code || 'KHO-01',
        'Kệ B3-01',
        20,
        95000,
        10,
        5,
        50,
        '',
        '',
        'Phụ tùng định kỳ',
      ],
      [
        'VT-003',
        'VT-003',
        'Găng tay sợi bảo hộ lao động phủ hạt',
        'Bảo hộ lao động',
        'Việt Nam',
        'Đôi',
        defaultWarehouseCode || warehouses[0]?.code || 'KHO-01',
        'Kệ C1-05',
        200,
        8500,
        8,
        50,
        500,
        '',
        '',
        'Vật tư tiêu hao',
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [
      { wch: 18 },
      { wch: 18 },
      { wch: 34 },
      { wch: 24 },
      { wch: 16 },
      { wch: 14 },
      { wch: 14 },
      { wch: 20 },
      { wch: 18 },
      { wch: 18 },
      { wch: 14 },
      { wch: 22 },
      { wch: 22 },
      { wch: 18 },
      { wch: 16 },
      { wch: 28 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Mau_Ton_Kho_Chuan');
    XLSX.writeFile(wb, 'Mau_Nhap_Ton_Kho_Chuan_ERP.xlsx');
  };

  // Phân tích & Tiền kiểm tra dữ liệu theo ánh xạ cột (Data Validation)
  const parsedDataResults = useMemo<ParsedRowResult[]>(() => {
    if (
      rawRows.length <= headerRowIdx + 1 ||
      !mapping.materialCode ||
      !mapping.quantity
    ) {
      return [];
    }

    // Tạo bản đồ vị trí index của từng cột
    const colIndices: Record<keyof ColumnMapping, number> = {
      materialCode: fileHeaders.indexOf(mapping.materialCode),
      barcode: fileHeaders.indexOf(mapping.barcode),
      materialName: fileHeaders.indexOf(mapping.materialName),
      materialType: fileHeaders.indexOf(mapping.materialType),
      manufacturer: fileHeaders.indexOf(mapping.manufacturer),
      unit: fileHeaders.indexOf(mapping.unit),
      warehouseCode: fileHeaders.indexOf(mapping.warehouseCode),
      locationId: fileHeaders.indexOf(mapping.locationId),
      quantity: fileHeaders.indexOf(mapping.quantity),
      unitCost: fileHeaders.indexOf(mapping.unitCost),
      vatRate: fileHeaders.indexOf(mapping.vatRate),
      minStock: fileHeaders.indexOf(mapping.minStock),
      maxStock: fileHeaders.indexOf(mapping.maxStock),
      lotNumber: fileHeaders.indexOf(mapping.lotNumber),
      expiryDate: fileHeaders.indexOf(mapping.expiryDate),
      lineNote: fileHeaders.indexOf(mapping.lineNote),
    };

    const results: ParsedRowResult[] = [];

    // Duyệt qua các dòng dữ liệu sau dòng tiêu đề
    for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
      const row = rawRows[r];
      if (!row || row.length === 0) continue;

      const rawCode =
        colIndices.materialCode >= 0
          ? String(row[colIndices.materialCode] ?? '').trim()
          : '';
      if (!rawCode) {
        // Bỏ qua dòng trống hoàn toàn
        const hasAnyValue = row.some(
          (c) => c !== undefined && c !== null && String(c).trim() !== '',
        );
        if (!hasAnyValue) continue;
      }

      const errors: string[] = [];

      // 1. Kiểm tra Mã vật tư
      if (!rawCode) {
        errors.push('Thiếu mã vật tư / SKU');
      }

      const normalizedCode = rawCode.toUpperCase();
      const existingMaterial =
        materialMap.get(normalizedCode) || materialMap.get(normalize(rawCode));
      const isNew = !existingMaterial && Boolean(rawCode);
      if (isNew && movementKind && movementKind !== 'receipt') {
        errors.push(
          'Mã vật tư chưa có trong danh mục nên không thể xuất hoặc chuyển kho',
        );
      }

      // 2. Mã vạch Barcode
      const barcode =
        colIndices.barcode >= 0 && row[colIndices.barcode]
          ? String(row[colIndices.barcode]).trim()
          : existingMaterial?.barcode || normalizedCode;

      // 3. Tên vật tư
      let name =
        colIndices.materialName >= 0
          ? String(row[colIndices.materialName] ?? '').trim()
          : '';
      if (!name && existingMaterial) {
        name = existingMaterial.name;
      }
      if (!name && !existingMaterial) {
        name = rawCode; // Tạm dùng mã nếu chưa có tên
      }

      // 4. Nhóm vật tư
      let materialType =
        colIndices.materialType >= 0
          ? String(row[colIndices.materialType] ?? '').trim()
          : '';
      if (!materialType && existingMaterial?.type) {
        materialType = existingMaterial.type;
      }

      // 5. Thương hiệu / Hãng sản xuất
      let manufacturer =
        colIndices.manufacturer >= 0
          ? String(row[colIndices.manufacturer] ?? '').trim()
          : '';
      if (!manufacturer && existingMaterial?.manufacturer) {
        manufacturer = existingMaterial.manufacturer;
      }

      // 6. Đơn vị tính
      let unit =
        colIndices.unit >= 0 ? String(row[colIndices.unit] ?? '').trim() : '';
      if (!unit && existingMaterial?.unit) {
        unit = existingMaterial.unit;
      }
      if (!unit) {
        unit = 'Cái';
      }

      // 7. Số lượng
      const rawQty =
        colIndices.quantity >= 0 ? row[colIndices.quantity] : undefined;
      const parsedQty = parseNumericValue(rawQty);
      if (parsedQty === undefined) {
        errors.push('Số lượng không hợp lệ hoặc để trống');
      } else if (parsedQty <= 0) {
        errors.push('Số lượng phải lớn hơn 0');
      }

      // 8. Đơn giá
      const rawCost =
        colIndices.unitCost >= 0 ? row[colIndices.unitCost] : undefined;
      const parsedCost = parseNumericValue(rawCost);

      // 9. Thuế suất VAT
      const rawVat =
        colIndices.vatRate >= 0 ? row[colIndices.vatRate] : undefined;
      const parsedVat = parseNumericValue(rawVat);

      // 10. Kho thực hiện (Hỗ trợ chốt chặn 1 kho hoặc nạp đa kho)
      let rowWh = '';
      if (isSingleWarehouseOnly) {
        rowWh = defaultWarehouseCode || fallbackWarehouse;
      } else {
        if (colIndices.warehouseCode < 0) {
          // File không có cột kho: dùng kho mặc định người dùng đã chọn.
          rowWh = fallbackWarehouse || defaultWarehouseCode;
        } else {
          // File có cột kho thì ô trống hoặc mã sai là lỗi. Không rơi về kho mặc định:
          // hàng nhập nhầm kho làm sai số tồn mà không ai biết.
          const rawWh = String(row[colIndices.warehouseCode] ?? '').trim();
          const resolvedWh =
            warehouseMap.get(rawWh.toUpperCase()) ||
            warehouseMap.get(normalize(rawWh));
          if (!rawWh) {
            errors.push('Thiếu mã kho');
          } else if (!resolvedWh) {
            errors.push(`Không tìm thấy kho "${rawWh}" trong hệ thống`);
          }
          rowWh = resolvedWh ?? '';
        }
      }

      // 11. Vị trí kệ / ô
      const locationId =
        colIndices.locationId >= 0
          ? String(row[colIndices.locationId] ?? '').trim()
          : undefined;

      // 12. Định mức Min / Max
      const rawMin =
        colIndices.minStock >= 0 ? row[colIndices.minStock] : undefined;
      const parsedMin = parseNumericValue(rawMin);
      const rawMax =
        colIndices.maxStock >= 0 ? row[colIndices.maxStock] : undefined;
      const parsedMax = parseNumericValue(rawMax);

      // 13. Số lô & Hạn dùng & Ghi chú
      const lotNumber =
        colIndices.lotNumber >= 0
          ? String(row[colIndices.lotNumber] ?? '')
              .trim()
              .toUpperCase()
          : undefined;
      const expiryDate =
        colIndices.expiryDate >= 0
          ? String(row[colIndices.expiryDate] ?? '').trim()
          : undefined;
      const lineNote =
        colIndices.lineNote >= 0
          ? String(row[colIndices.lineNote] ?? '').trim()
          : undefined;

      const status: 'valid' | 'warning' | 'error' =
        errors.length > 0 ? 'error' : isNew ? 'warning' : 'valid';

      results.push({
        rowIndex: r + 1,
        materialCode: existingMaterial
          ? existingMaterial.code
          : normalizedCode || rawCode,
        barcode,
        materialName: name,
        materialType,
        manufacturer,
        unit,
        warehouseCode: rowWh,
        locationId,
        quantity: parsedQty || 0,
        unitCost: parsedCost,
        vatRate: parsedVat,
        minStock: parsedMin,
        maxStock: parsedMax,
        lotNumber: lotNumber || undefined,
        expiryDate: expiryDate || undefined,
        lineNote: lineNote || undefined,
        status,
        isNew,
        errors,
      });
    }

    return results;
  }, [
    rawRows,
    headerRowIdx,
    mapping,
    fileHeaders,
    materialMap,
    warehouseMap,
    fallbackWarehouse,
    movementKind,
    isSingleWarehouseOnly,
    defaultWarehouseCode,
  ]);

  // Thống kê số lượng dòng
  const stats = useMemo(() => {
    const total = parsedDataResults.length;
    const valid = parsedDataResults.filter((r) => r.status === 'valid').length;
    const warning = parsedDataResults.filter(
      (r) => r.status === 'warning',
    ).length;
    const error = parsedDataResults.filter((r) => r.status === 'error').length;
    const readyToImport = valid + warning;
    const totalQty = parsedDataResults
      .filter((r) => r.status !== 'error')
      .reduce((sum, r) => sum + r.quantity, 0);
    // Nạp dữ liệu cả kho là tất cả hoặc không: còn dòng lỗi thì không cho nạp,
    // để người dùng sửa file rồi nạp lại một lần, không nạp trùng phần đã vào sổ.
    const blockedByErrors = !isSingleWarehouseOnly && error > 0;
    return {
      total,
      valid,
      warning,
      error,
      readyToImport,
      totalQty,
      blockedByErrors,
    };
  }, [parsedDataResults, isSingleWarehouseOnly]);

  // Xử lý nạp danh sách hợp lệ ra bên ngoài
  const handleConfirmImport = () => {
    if (stats.blockedByErrors) return;
    const validRows = parsedDataResults.filter((r) => r.status !== 'error');
    if (validRows.length === 0) {
      alert('Không có dòng vật tư nào hợp lệ để nạp vào hệ thống!');
      return;
    }

    const importedLineItems: MovementLineItem[] = validRows.map((r, idx) => ({
      id: `imported-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
      materialCode: r.materialCode,
      barcode: r.barcode,
      materialName: r.materialName,
      materialType: r.materialType,
      manufacturer: r.manufacturer,
      unit: r.unit,
      warehouseCode: isSingleWarehouseOnly
        ? defaultWarehouseCode
        : r.warehouseCode,
      locationId: r.locationId,
      quantity: r.quantity,
      unitCost: r.unitCost,
      vatRate: r.vatRate,
      minStock: r.minStock,
      maxStock: r.maxStock,
      serialNumbers: [],
      lineNote:
        r.lineNote || (r.isNew ? 'Vật tư mới nạp từ file Excel' : undefined),
      receiptLot:
        (!movementKind || movementKind === 'receipt') && r.lotNumber
          ? {
              lotNumber: r.lotNumber,
              expiryDate: r.expiryDate,
              status: 'PASSED' as const,
            }
          : undefined,
      newMaterial:
        (!movementKind || movementKind === 'receipt') && r.isNew
          ? {
              code: r.materialCode,
              name: r.materialName,
              type: r.materialType,
              unit: r.unit,
              minStock: r.minStock ?? 0,
              maxStock: r.maxStock,
              barcode: r.barcode,
              manufacturer: r.manufacturer,
            }
          : undefined,
    }));

    onImportItems(importedLineItems);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Danh sách các tùy chọn Preset cho combobox
  const presetOptions = useMemo(() => {
    return [
      {
        value: 'auto',
        label: 'Tự động nhận diện thông minh (AI Auto-detect)',
        badge: 'Khuyên dùng',
      },
      ...BUILT_IN_PRESETS.map((p) => ({
        value: p.id,
        label: `${p.name} — [${p.software}]`,
        badge: p.software,
      })),
      ...Object.keys(savedProfiles).map((pName) => ({
        value: pName,
        label: `Mẫu tùy chỉnh: ${pName}`,
        badge: 'Đã lưu',
      })),
    ];
  }, [savedProfiles]);

  const dirtySnapshot = JSON.stringify([fileName]);
  const [initialSnapshot] = useState(dirtySnapshot);
  const isDirty = dirtySnapshot !== initialSnapshot;

  return (
    <Dialog onEscape={isDirty ? undefined : onCancel}>
      <DialogContent
        className="z-1100 w-[95vw] max-w-280"
        backdropClassName="z-1100"
        aria-label={dialogTitle}
      >
        {/* Header Dialog */}
        <DialogHeader>
          <div>
            <div className="flex items-center gap-[10px]">
              <div className="w-[36px] h-[36px] rounded-[8px] bg-[#dcfce7] text-[#15803d] flex items-center justify-center">
                <FileSpreadsheet size={20} />
              </div>
              <div>
                <DialogTitle>{dialogTitle}</DialogTitle>
                <p className="m-[2px_0_0] text-[13px] text-[#64748b]">
                  {dialogSubtitle}
                </p>
              </div>
            </div>
          </div>
          <CloseGuard dirty={isDirty} onClose={onCancel}>
            <DialogCloseButton />
          </CloseGuard>
        </DialogHeader>

        {/* Thanh tiến trình 3 bước (Wizard Step Bar) */}
        <div className="flex items-center justify-between py-[12px] px-[24px] bg-[#f8fafc] border-b border-b-[#e2e8f0]">
          <div className="flex items-center gap-[10px]">
            <div
              className={cn(
                'flex h-[26px] w-[26px] items-center justify-center rounded-full text-[13px] font-bold',
                step >= 1
                  ? 'bg-[#2563eb] text-white'
                  : 'bg-[#e2e8f0] text-[#64748b]',
              )}
            >
              1
            </div>
            <span
              className={cn(
                'text-[14px]',
                step === 1
                  ? 'font-bold text-[#0f172a]'
                  : 'font-medium text-[#64748b]',
              )}
            >
              Chọn tệp Excel
            </span>
          </div>

          <div className="h-[1px] flex-1 bg-[#e2e8f0] mx-[16px]" />

          <div className="flex items-center gap-[10px]">
            <div
              className={cn(
                'flex h-[26px] w-[26px] items-center justify-center rounded-full text-[13px] font-bold',
                step >= 2
                  ? 'bg-[#2563eb] text-white'
                  : 'bg-[#e2e8f0] text-[#64748b]',
              )}
            >
              2
            </div>
            <span
              className={cn(
                'text-[14px]',
                step === 2
                  ? 'font-bold text-[#0f172a]'
                  : 'font-medium text-[#64748b]',
              )}
            >
              Liên kết cột thông minh
            </span>
          </div>

          <div className="h-[1px] flex-1 bg-[#e2e8f0] mx-[16px]" />

          <div className="flex items-center gap-[10px]">
            <div
              className={cn(
                'flex h-[26px] w-[26px] items-center justify-center rounded-full text-[13px] font-bold',
                step >= 3
                  ? 'bg-[#2563eb] text-white'
                  : 'bg-[#e2e8f0] text-[#64748b]',
              )}
            >
              3
            </div>
            <span
              className={cn(
                'text-[14px]',
                step === 3
                  ? 'font-bold text-[#0f172a]'
                  : 'font-medium text-[#64748b]',
              )}
            >
              Kiểm tra &amp; Xác nhận nạp
            </span>
          </div>
        </div>

        {/* Thân Hộp Thoại */}
        <div className="flex-1 overflow-y-auto py-[20px] px-[24px] flex flex-col gap-[16px]">
          {/* ===================== BƯỚC 1: TẢI FILE ===================== */}
          {step === 1 ? (
            <div className="flex flex-col gap-[16px]">
              <input
                className="hidden"
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileChange(file);
                }}
              />

              <div
                className="[border:2px_dashed_#cbd5e1] rounded-[12px] py-[40px] px-[20px] text-center bg-[#f8fafc] cursor-pointer [transition:all_0.2s]"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileChange(file);
                }}
              >
                <div className="w-[54px] h-[54px] rounded-full bg-[#eff6ff] text-[#2563eb] flex items-center justify-center m-[0_auto_12px]">
                  <Upload size={26} />
                </div>
                <h3 className="m-[0_0_6px] text-[16px] font-semibold text-[#1e293b]">
                  {fileName
                    ? `Đã chọn: ${fileName} (${fileSize})`
                    : 'Kéo thả tệp Excel vào đây hoặc bấm để chọn tệp'}
                </h3>
                <p className="m-0 text-[14px] text-[#64748b]">
                  Hỗ trợ định dạng .xlsx, .xls hoặc .csv (dung lượng tối đa
                  20MB)
                </p>
                {fileName ? (
                  <Button
                    variant="outline"
                    className="mt-3"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    Chọn tệp khác
                  </Button>
                ) : (
                  <div className="mt-[14px] flex justify-center gap-[10px] flex-wrap">
                    <Button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      <Upload size={14} />
                      <span>Chọn file từ máy tính</span>
                    </Button>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadTemplate();
                      }}
                    >
                      <Download size={14} />
                      <span>Tải file Excel mẫu chuẩn</span>
                    </Button>
                  </div>
                )}
              </div>

              {/* Tùy chọn Sheet & Cấu hình Header */}
              {rawRows.length > 0 ? (
                <div className="bg-[#ffffff] border border-[#e2e8f0] rounded-[8px] p-[16px] flex flex-col gap-[14px]">
                  <div className="grid grid-cols-[1fr_1fr] gap-[16px]">
                    <div>
                      <Label className="text-[14px] font-semibold text-[#334155] mb-[6px]">
                        Trang tính (Sheet) cần đọc:
                      </Label>
                      <SearchableSelect
                        className="w-full text-[14px]"
                        options={sheets.map((sheet) => ({
                          value: sheet,
                          label: sheet,
                        }))}
                        value={selectedSheet}
                        placeholder="Tìm trang tính…"
                        emptyText="Không tìm thấy trang tính"
                        clearable={false}
                        onChange={setSelectedSheet}
                      />
                    </div>

                    <div>
                      <Label className="text-[14px] font-semibold text-[#334155] mb-[6px]">
                        Kho lưu trữ mặc định (khi file không có cột kho):
                      </Label>
                      <SearchableSelect
                        className="w-full text-[14px]"
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
                      />
                    </div>
                  </div>

                  {/* Chọn dòng Tiêu đề (Header Row) */}
                  <div>
                    <div className="flex items-center justify-between mb-[6px]">
                      <Label className="text-[14px] font-semibold text-[#334155]">
                        Dòng tiêu đề (Chứa tên các cột dữ liệu):
                      </Label>
                      <span className="text-[13px] text-[#64748b]">
                        Hệ thống tự động phát hiện dòng số{' '}
                        <strong>{headerRowIdx + 1}</strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-[8px]">
                      <span className="text-[13px] text-[#475569]">
                        Dòng số:
                      </span>
                      <Input
                        className="w-[70px] h-8 text-center text-[13px]"
                        type="number"
                        min={1}
                        max={Math.min(rawRows.length, 50)}
                        value={headerRowIdx + 1}
                        onChange={(e) =>
                          handleChangeHeaderRow(Number(e.target.value) - 1)
                        }
                      />
                      <span className="text-[13px] text-[#64748b]">
                        (Bỏ qua các dòng tên công ty / tiêu đề hóa đơn ở các
                        dòng trên)
                      </span>
                    </div>
                  </div>

                  {/* Xem trước 3 dòng đầu tiên của file */}
                  {rawRows.length > 0 ? (
                    <div>
                      <span className="text-[13px] font-semibold text-[#475569] block mb-[6px]">
                        Xem trước cấu trúc file (3 dòng đầu):
                      </span>
                      <div className="overflow-x-auto border border-[#f1f5f9] rounded-[6px]">
                        <table className="w-full text-[13px] border-collapse">
                          <tbody>
                            {rawRows.slice(0, 4).map((r, rIdx) => (
                              <tr
                                key={rIdx}
                                className={cn(
                                  'border-b border-b-[#e2e8f0]',
                                  rIdx === headerRowIdx
                                    ? 'bg-[#eff6ff] font-bold'
                                    : rIdx % 2 === 0
                                      ? 'bg-white font-normal'
                                      : 'bg-[#f8fafc] font-normal',
                                )}
                              >
                                <td className="py-[6px] px-[10px] text-[#94a3b8] w-[60px]">
                                  #{rIdx + 1}
                                  {rIdx === headerRowIdx ? ' (Header)' : ''}
                                </td>
                                {r
                                  .slice(0, 8)
                                  .map((cell: any, cIdx: number) => (
                                    <td
                                      className="py-[6px] px-[10px] whitespace-nowrap"
                                      key={cIdx}
                                    >
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

          {/* ===================== BƯỚC 2: LIÊN KẾT CỘT THÔNG MINH ===================== */}
          {step === 2 ? (
            <div className="flex flex-col gap-[16px]">
              {/* Profile & Preset Bar */}
              <div className="flex items-center justify-between py-[12px] px-[16px] bg-[#f0fdf4] border border-[#bbf7d0] rounded-[8px] flex-wrap gap-[12px]">
                <div className="flex items-center gap-[10px] flex-1">
                  <Sparkles size={18} color="#16a34a" />
                  <span className="text-[14px] font-semibold text-[#166534]">
                    Mẫu liên kết cột (Preset):
                  </span>
                  <div className="min-w-[320px] max-w-[420px]">
                    <SearchableSelect
                      className="w-full text-[13px]"
                      options={presetOptions}
                      value={selectedPresetId}
                      placeholder="Chọn mẫu ứng dụng..."
                      searchPlaceholder="Tìm kiếm mẫu ứng dụng..."
                      onChange={handleSelectPreset}
                      clearable={false}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-[8px]">
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => {
                      const result = detectSmartColumnMapping(fileHeaders);
                      setMapping(result.mapping);
                      setConfidences(result.confidences);
                      setSelectedPresetId('auto');
                    }}
                    title="Tự động quét lại và phân tích tên cột bằng AI"
                  >
                    <Sparkles size={13} color="#2563eb" />
                    <span>Quét lại thông minh</span>
                  </Button>

                  {savedProfiles[selectedPresetId] ? (
                    <Button
                      variant="link"
                      className="h-auto p-0 text-[13px] text-red-600"
                      type="button"
                      onClick={() => handleDeleteProfile(selectedPresetId)}
                    >
                      Xóa mẫu này
                    </Button>
                  ) : null}

                  <Button
                    variant="outline"
                    className="border-green-300 text-green-700"
                    type="button"
                    onClick={() => setShowSaveProfileModal(true)}
                  >
                    + Lưu mẫu khớp cột này
                  </Button>
                </div>
              </div>

              {/* Bảng Ánh xạ các trường theo từng nhóm chức năng */}
              {(['identity', 'stock', 'cost'] as const).map((cat) => {
                const catTitle =
                  cat === 'identity'
                    ? '1. Thông tin định danh hàng hóa'
                    : cat === 'stock'
                      ? '2. Kho bãi, Vị trí & Số lượng'
                      : '3. Giá vốn, Lô sản xuất & Hạn sử dụng';

                const catIcon =
                  cat === 'identity' ? (
                    <Boxes size={16} color="#2563eb" />
                  ) : cat === 'stock' ? (
                    <Building2 size={16} color="#0891b2" />
                  ) : (
                    <Layers size={16} color="#d97706" />
                  );

                const catRules = FIELD_RULES.filter((r) => r.category === cat);

                return (
                  <div
                    className="border border-[#e2e8f0] rounded-[8px] overflow-hidden bg-[#ffffff]"
                    key={cat}
                  >
                    <div className="flex items-center gap-[8px] py-[10px] px-[14px] bg-[#f8fafc] border-b border-b-[#e2e8f0] text-[14px] font-bold text-[#1e293b]">
                      {catIcon}
                      <span>{catTitle}</span>
                    </div>

                    <table className="w-full text-[13px] border-collapse">
                      <thead className="bg-[#ffffff] border-b border-b-[#f1f5f9]">
                        <tr>
                          <th className="py-[8px] px-[14px] text-left w-[240px] text-[#64748b]">
                            Trường hệ thống
                          </th>
                          <th className="py-[8px] px-[14px] text-left w-[100px] text-[#64748b]">
                            Bắt buộc?
                          </th>
                          <th className="py-[8px] px-[14px] text-left min-w-[280px] text-[#64748b]">
                            Cột tương ứng trong tệp Excel
                          </th>
                          <th className="py-[8px] px-[14px] text-left w-[180px] text-[#64748b]">
                            Độ tin cậy khớp
                          </th>
                          <th className="py-[8px] px-[14px] text-left w-[200px] text-[#64748b]">
                            Dòng 1 ví dụ
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {catRules.map((rule) => {
                          const val = mapping[rule.key];
                          const conf = confidences[rule.key];
                          const colIdx = val ? fileHeaders.indexOf(val) : -1;
                          const sampleVal =
                            colIdx >= 0
                              ? rawRows[headerRowIdx + 1]?.[colIdx]
                              : undefined;

                          return (
                            <tr
                              className="border-b border-b-[#f1f5f9]"
                              key={rule.key}
                            >
                              <td className="py-[9px] px-[14px] font-semibold text-[#0f172a]">
                                {rule.label}
                              </td>
                              <td className="py-[9px] px-[14px]">
                                {rule.required ? (
                                  <span className="text-[11px] bg-[#fee2e2] text-[#b91c1c] py-[2px] px-[6px] rounded-[4px] font-semibold">
                                    Bắt buộc
                                  </span>
                                ) : (
                                  <span className="text-[12px] text-[#94a3b8]">
                                    Tùy chọn
                                  </span>
                                )}
                              </td>
                              <td className="py-[9px] px-[14px]">
                                {rule.key === 'warehouseCode' &&
                                isSingleWarehouseOnly ? (
                                  <span className="text-[13px] font-semibold text-[#1e293b] bg-[#f1f5f9] py-[5px] px-[10px] rounded-[6px] border border-[#cbd5e1] inline-block">
                                    Cố định: {defaultWarehouseCode} (Chốt chặn 1
                                    kho - 1 phiếu)
                                  </span>
                                ) : (
                                  <SearchableSelect
                                    className="w-full max-w-[340px] text-[13px]"
                                    options={fileHeaders.map((h) => ({
                                      value: h,
                                      label: h,
                                    }))}
                                    value={val}
                                    placeholder={`Chọn cột cho ${rule.label}…`}
                                    searchPlaceholder="Tìm tên cột trong file..."
                                    emptyText="Không tìm thấy cột"
                                    onChange={(newVal) => {
                                      setMapping((m) => ({
                                        ...m,
                                        [rule.key]: newVal,
                                      }));
                                      setConfidences((c) => ({
                                        ...c,
                                        [rule.key]: newVal ? 'exact' : 'none',
                                      }));
                                    }}
                                    clearable
                                  />
                                )}
                              </td>
                              <td className="py-[9px] px-[14px]">
                                {val ? (
                                  conf === 'exact' ? (
                                    <span className="text-[11px] bg-[#dcfce7] text-[#15803d] py-[2px] px-[6px] rounded-[4px] font-semibold inline-flex items-center gap-[4px]">
                                      ✓ Khớp chuẩn 100%
                                    </span>
                                  ) : conf === 'high' ? (
                                    <span className="text-[11px] bg-[#e0f2fe] text-[#0369a1] py-[2px] px-[6px] rounded-[4px] font-semibold inline-flex items-center gap-[4px]">
                                      ✦ Gợi ý chuẩn cao
                                    </span>
                                  ) : (
                                    <span className="text-[11px] bg-[#f1f5f9] text-[#475569] py-[2px] px-[6px] rounded-[4px]">
                                      Người dùng chọn
                                    </span>
                                  )
                                ) : (
                                  <span className="text-[12px] text-[#cbd5e1]">
                                    — Bỏ qua —
                                  </span>
                                )}
                              </td>
                              <td className="py-[9px] px-[14px] text-[#64748b]">
                                {rule.key === 'warehouseCode' &&
                                isSingleWarehouseOnly
                                  ? defaultWarehouseCode
                                  : sampleVal !== undefined && sampleVal !== ''
                                    ? String(sampleVal)
                                    : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* ===================== BƯỚC 3: KIỂM TRA & XÁC NHẬN ===================== */}
          {step === 3 ? (
            <div className="flex flex-col gap-[14px]">
              {/* Dải tổng quan trạng thái */}
              <div className="flex items-center gap-[12px] py-[12px] px-[16px] bg-[#f8fafc] border border-[#e2e8f0] rounded-[8px] flex-wrap">
                <div className="flex items-center gap-[6px] text-[14px]">
                  <span className="text-[#64748b]">Tổng số dòng đọc được:</span>
                  <strong className="text-[#0f172a]">{stats.total}</strong>
                </div>

                <div className="w-[1px] h-[16px] bg-[#cbd5e1]" />

                <div className="flex items-center gap-[6px] text-[14px]">
                  <span className="w-[8px] h-[8px] rounded-full bg-[#16a34a]" />
                  <span className="text-[#166534] font-semibold">
                    Hợp lệ: {stats.valid}
                  </span>
                </div>

                <div className="flex items-center gap-[6px] text-[14px]">
                  <span className="w-[8px] h-[8px] rounded-full bg-[#eab308]" />
                  <span className="text-[#854d0e] font-semibold">
                    Mã mới (tự tạo danh mục): {stats.warning}
                  </span>
                </div>

                {stats.error > 0 ? (
                  <div className="flex items-center gap-[6px] text-[14px]">
                    <span className="w-[8px] h-[8px] rounded-full bg-[#dc2626]" />
                    <span className="text-[#991b1b] font-semibold">
                      Lỗi (bỏ qua): {stats.error}
                    </span>
                  </div>
                ) : null}

                <div className="ml-[auto] flex items-center gap-[8px]">
                  <span className="text-[13px] text-[#475569]">
                    Tổng số lượng dự kiến nạp:{' '}
                    <strong>{formatQuantityVn(stats.totalQty)}</strong>
                  </span>
                </div>
              </div>

              {/* Bảng xem trước danh sách chi tiết */}
              <div className="border border-[#e2e8f0] rounded-[8px] overflow-x-auto max-h-[400px]">
                <table className="w-full text-[13px] border-collapse">
                  <thead className="bg-[#f8fafc] sticky top-[0] z-[1] border-b border-b-[#e2e8f0]">
                    <tr>
                      <th className="py-[8px] px-[10px] text-center w-[45px]">
                        #
                      </th>
                      <th className="py-[8px] px-[10px] text-center w-[90px]">
                        Trạng thái
                      </th>
                      <th className="py-[8px] px-[10px] text-left min-w-[110px]">
                        Mã SKU
                      </th>
                      <th className="py-[8px] px-[10px] text-left min-w-[110px]">
                        Mã vạch
                      </th>
                      <th className="py-[8px] px-[10px] text-left min-w-[180px]">
                        Tên hàng hóa
                      </th>
                      <th className="py-[8px] px-[10px] text-left w-[100px]">
                        Kho nạp
                      </th>
                      <th className="py-[8px] px-[10px] text-center w-[65px]">
                        ĐVT
                      </th>
                      <th className="py-[8px] px-[10px] text-right w-[85px]">
                        Số lượng
                      </th>
                      <th className="py-[8px] px-[10px] text-left min-w-[130px]">
                        Thuộc nhóm
                      </th>
                      <th className="py-[8px] px-[10px] text-left min-w-[120px]">
                        Hãng SX
                      </th>
                      <th className="py-[8px] px-[10px] text-right w-[110px]">
                        Đơn giá vốn
                      </th>
                      <th className="py-[8px] px-[10px] text-left min-w-[140px]">
                        Ghi chú / Lỗi
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedDataResults.map((r) => (
                      <tr
                        key={r.rowIndex}
                        className={cn(
                          'border-b border-b-[#f1f5f9]',
                          r.status === 'error'
                            ? 'bg-[#fef2f2]'
                            : r.isNew
                              ? 'bg-[#fefce8]'
                              : 'bg-white',
                        )}
                      >
                        <td className="py-[8px] px-[10px] text-center text-[#94a3b8]">
                          {r.rowIndex}
                        </td>
                        <td className="py-[8px] px-[10px] text-center">
                          {r.status === 'valid' ? (
                            <span className="text-[11px] bg-[#dcfce7] text-[#15803d] py-[2px] px-[6px] rounded-[4px] font-semibold">
                              Hợp lệ
                            </span>
                          ) : r.status === 'warning' ? (
                            <span className="text-[11px] bg-[#fef08a] text-[#854d0e] py-[2px] px-[6px] rounded-[4px] font-semibold">
                              Mã mới
                            </span>
                          ) : (
                            <span className="text-[11px] bg-[#fee2e2] text-[#b91c1c] py-[2px] px-[6px] rounded-[4px] font-semibold">
                              Lỗi
                            </span>
                          )}
                        </td>
                        <td className="py-[8px] px-[10px] font-bold text-[#0f172a]">
                          {r.materialCode}
                        </td>
                        <td className="py-[8px] px-[10px] text-[#475569] text-[12px]">
                          {r.barcode || '—'}
                        </td>
                        <td className="py-[8px] px-[10px] text-[#334155]">
                          {r.materialName}
                        </td>
                        <td className="py-[8px] px-[10px] text-[#334155] font-semibold">
                          {r.warehouseCode}
                        </td>
                        <td className="py-[8px] px-[10px] text-center text-[#475569]">
                          {r.unit}
                        </td>
                        <td className="py-[8px] px-[10px] text-right font-semibold text-[#0f172a]">
                          {r.quantity > 0 ? formatQuantityVn(r.quantity) : '—'}
                        </td>
                        <td className="py-[8px] px-[10px] text-[#475569]">
                          <span className="bg-[#f1f5f9] py-[2px] px-[8px] rounded-[4px] text-[12px]">
                            {r.materialType || '—'}
                          </span>
                        </td>
                        <td className="py-[8px] px-[10px] text-[#475569] text-[12px]">
                          {r.manufacturer || '—'}
                        </td>
                        <td className="py-[8px] px-[10px] text-right text-[#475569]">
                          {r.unitCost !== undefined
                            ? formatCurrencyVn(r.unitCost)
                            : '—'}
                        </td>
                        <td className="py-[8px] px-[10px] text-[13px]">
                          {r.errors.length > 0 ? (
                            <span className="text-[#dc2626] font-medium">
                              {r.errors.join(', ')}
                            </span>
                          ) : r.isNew ? (
                            <span className="text-[#a16207]">
                              Chưa có trong danh mục (sẽ tự động tạo)
                            </span>
                          ) : (
                            <span className="text-[#64748b]">
                              {r.lineNote || '—'}
                            </span>
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
          <Dialog onEscape={() => setShowSaveProfileModal(false)}>
            <DialogContent
              className="z-1100 max-w-sm"
              backdropClassName="z-1100"
              aria-label="Lưu cấu hình khớp cột"
            >
              <DialogHeader>
                <DialogTitle>Lưu cấu hình khớp cột</DialogTitle>
                <DialogCloseButton
                  onClick={() => setShowSaveProfileModal(false)}
                />
              </DialogHeader>
              <DialogBody>
                <p className="m-[0_0_14px] text-[13px] text-[#64748b]">
                  Đặt tên cho mẫu để sử dụng lại cho các file có cấu trúc tương
                  tự (ví dụ: &ldquo;File KiotViet chi nhánh&rdquo;, &ldquo;File
                  MISA Kho Tổng&rdquo;).
                </p>
                <Input
                  className="h-8 text-[13px]"
                  type="text"
                  placeholder="Nhập tên mẫu cấu hình..."
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  autoFocus
                />
              </DialogBody>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowSaveProfileModal(false)}
                >
                  Huỷ
                </Button>
                <Button
                  type="button"
                  disabled={!newProfileName.trim()}
                  onClick={handleSaveCurrentProfile}
                >
                  Lưu mẫu
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}

        {/* Footer Actions của Wizard */}
        <DialogFooter className="justify-between">
          <div>
            {step > 1 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep((s) => (s - 1) as any)}
              >
                <ArrowLeft size={15} />
                <span>Quay lại bước trước</span>
              </Button>
            ) : (
              <CloseGuard dirty={isDirty} onClose={onCancel}>
                <Button type="button" variant="outline">
                  Huỷ bỏ
                </Button>
              </CloseGuard>
            )}
          </div>

          <div className="flex items-center gap-[10px]">
            {step === 1 ? (
              <Button
                type="button"
                disabled={!fileName || rawRows.length === 0}
                onClick={() => setStep(2)}
              >
                <span>Tiếp tục: Khớp cột dữ liệu</span>
                <ArrowRight size={15} />
              </Button>
            ) : null}

            {step === 2 ? (
              <Button
                type="button"
                disabled={!mapping.materialCode || !mapping.quantity}
                onClick={() => setStep(3)}
              >
                <span>
                  Tiếp tục: Kiểm tra dữ liệu (
                  {rawRows.length > headerRowIdx + 1
                    ? `${rawRows.length - headerRowIdx - 1} dòng`
                    : '0 dòng'}
                  )
                </span>
                <ArrowRight size={15} />
              </Button>
            ) : null}

            {step === 3 && stats.blockedByErrors ? (
              <span
                className="text-[#b91c1c] text-[13px] font-semibold"
                role="alert"
              >
                Còn {stats.error} dòng lỗi. Sửa file rồi chọn lại để nạp.
              </span>
            ) : null}

            {step === 3 ? (
              <Button
                type="button"
                disabled={stats.readyToImport === 0 || stats.blockedByErrors}
                onClick={handleConfirmImport}
              >
                <Check size={16} />
                <span>
                  Đồng ý nạp {stats.readyToImport} vật tư vào{' '}
                  {isDirectMovement ? 'phiếu' : 'hệ thống kho'}
                </span>
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
