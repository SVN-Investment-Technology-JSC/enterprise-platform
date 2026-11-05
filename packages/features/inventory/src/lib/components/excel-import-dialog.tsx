'use client';

import type { Material, Warehouse } from '@enterprise-platform/contracts-inventory';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
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

/** Chuyển giá trị chuỗi hoặc số từ Excel thành number chuẩn (hỗ trợ cả định dạng VN và US) */
function parseNumericValue(val: unknown): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'number') return isNaN(val) ? undefined : val;
  const str = String(val).trim();
  // Loại bỏ các ký tự tiền tệ và khoảng trắng thừa
  const cleaned = str.replace(/[₫$€¥\s]/g, '');
  // Nếu dùng dấu chấm phân tách ngàn và phẩy thập phân kiểu VN (ví dụ: 1.250,50)
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  // Nếu kiểu US (ví dụ: 1,250.50)
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/,/g, ''));
  }
  // Nếu chỉ có dấu phẩy thay dấu chấm thập phân (ví dụ: 12,5)
  if (/^\d+,\d+$/.test(cleaned)) {
    return parseFloat(cleaned.replace(',', '.'));
  }
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? undefined : parsed;
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
    positiveKeywords: [
      'ton toi da',
      'dinh muc ton toi da',
      'max stock',
      'max',
    ],
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
  const [confidences, setConfidences] = useState<Record<keyof ColumnMapping, ConfidenceLevel>>({
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
  const [savedProfiles, setSavedProfiles] = useState<Record<string, ColumnMapping>>({});
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
        row.filter((cell) => typeof cell === 'string' && cell.trim().length > 1).length >= 2
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
      const newConf: Record<keyof ColumnMapping, ConfidenceLevel> = { ...confidences };

      for (const [fieldKey, expectedHeader] of Object.entries(builtIn.mapping) as [
        keyof ColumnMapping,
        string,
      ][]) {
        if (!expectedHeader) continue;
        const normExpected = normalize(expectedHeader);
        const match = fileHeaders.find((h) => normalize(h) === normExpected || normalize(h).includes(normExpected));
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
      const newConf: Record<keyof ColumnMapping, ConfidenceLevel> = { ...confidences };
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
    if (rawRows.length <= headerRowIdx + 1 || !mapping.materialCode || !mapping.quantity) {
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
        colIndices.materialCode >= 0 ? String(row[colIndices.materialCode] ?? '').trim() : '';
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
        errors.push('Mã vật tư chưa có trong danh mục nên không thể xuất hoặc chuyển kho');
      }

      // 2. Mã vạch Barcode
      const barcode =
        colIndices.barcode >= 0 && row[colIndices.barcode]
          ? String(row[colIndices.barcode]).trim()
          : existingMaterial?.barcode || normalizedCode;

      // 3. Tên vật tư
      let name =
        colIndices.materialName >= 0 ? String(row[colIndices.materialName] ?? '').trim() : '';
      if (!name && existingMaterial) {
        name = existingMaterial.name;
      }
      if (!name && !existingMaterial) {
        name = rawCode; // Tạm dùng mã nếu chưa có tên
      }

      // 4. Nhóm vật tư
      let materialType =
        colIndices.materialType >= 0 ? String(row[colIndices.materialType] ?? '').trim() : '';
      if (!materialType && existingMaterial?.type) {
        materialType = existingMaterial.type;
      }

      // 5. Thương hiệu / Hãng sản xuất
      let manufacturer =
        colIndices.manufacturer >= 0 ? String(row[colIndices.manufacturer] ?? '').trim() : '';
      if (!manufacturer && existingMaterial?.manufacturer) {
        manufacturer = existingMaterial.manufacturer;
      }

      // 6. Đơn vị tính
      let unit = colIndices.unit >= 0 ? String(row[colIndices.unit] ?? '').trim() : '';
      if (!unit && existingMaterial?.unit) {
        unit = existingMaterial.unit;
      }
      if (!unit) {
        unit = 'Cái';
      }

      // 7. Số lượng
      const rawQty = colIndices.quantity >= 0 ? row[colIndices.quantity] : undefined;
      const parsedQty = parseNumericValue(rawQty);
      if (parsedQty === undefined) {
        errors.push('Số lượng không hợp lệ hoặc để trống');
      } else if (parsedQty <= 0) {
        errors.push('Số lượng phải lớn hơn 0');
      }

      // 8. Đơn giá
      const rawCost = colIndices.unitCost >= 0 ? row[colIndices.unitCost] : undefined;
      const parsedCost = parseNumericValue(rawCost);

      // 9. Thuế suất VAT
      const rawVat = colIndices.vatRate >= 0 ? row[colIndices.vatRate] : undefined;
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
            warehouseMap.get(rawWh.toUpperCase()) || warehouseMap.get(normalize(rawWh));
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
        colIndices.locationId >= 0 ? String(row[colIndices.locationId] ?? '').trim() : undefined;

      // 12. Định mức Min / Max
      const rawMin = colIndices.minStock >= 0 ? row[colIndices.minStock] : undefined;
      const parsedMin = parseNumericValue(rawMin);
      const rawMax = colIndices.maxStock >= 0 ? row[colIndices.maxStock] : undefined;
      const parsedMax = parseNumericValue(rawMax);

      // 13. Số lô & Hạn dùng & Ghi chú
      const lotNumber =
        colIndices.lotNumber >= 0
          ? String(row[colIndices.lotNumber] ?? '').trim().toUpperCase()
          : undefined;
      const expiryDate =
        colIndices.expiryDate >= 0 ? String(row[colIndices.expiryDate] ?? '').trim() : undefined;
      const lineNote =
        colIndices.lineNote >= 0 ? String(row[colIndices.lineNote] ?? '').trim() : undefined;

      const status: 'valid' | 'warning' | 'error' =
        errors.length > 0 ? 'error' : isNew ? 'warning' : 'valid';

      results.push({
        rowIndex: r + 1,
        materialCode: existingMaterial ? existingMaterial.code : (normalizedCode || rawCode),
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
    const warning = parsedDataResults.filter((r) => r.status === 'warning').length;
    const error = parsedDataResults.filter((r) => r.status === 'error').length;
    const readyToImport = valid + warning;
    const totalQty = parsedDataResults
      .filter((r) => r.status !== 'error')
      .reduce((sum, r) => sum + r.quantity, 0);
    // Nạp dữ liệu cả kho là tất cả hoặc không: còn dòng lỗi thì không cho nạp,
    // để người dùng sửa file rồi nạp lại một lần, không nạp trùng phần đã vào sổ.
    const blockedByErrors = !isSingleWarehouseOnly && error > 0;
    return { total, valid, warning, error, readyToImport, totalQty, blockedByErrors };
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
      warehouseCode: isSingleWarehouseOnly ? defaultWarehouseCode : r.warehouseCode,
      locationId: r.locationId,
      quantity: r.quantity,
      unitCost: r.unitCost,
      vatRate: r.vatRate,
      minStock: r.minStock,
      maxStock: r.maxStock,
      serialNumbers: [],
      lineNote: r.lineNote || (r.isNew ? 'Vật tư mới nạp từ file Excel' : undefined),
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

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div
        className={`${styles.modalDialog} ${styles.movementDialog}`}
        style={{
          maxWidth: '1120px',
          width: '95vw',
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '92vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Dialog */}
        <div className={styles.modalHead}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: '#dcfce7',
                  color: '#15803d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <FileSpreadsheet size={20} />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                  {dialogTitle}
                </h2>
                <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b' }}>
                  {dialogSubtitle}
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
                fontSize: '13px',
                fontWeight: 700,
              }}
            >
              1
            </div>
            <span
              style={{
                fontSize: '14px',
                fontWeight: step === 1 ? 700 : 500,
                color: step === 1 ? '#0f172a' : '#64748b',
              }}
            >
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
                fontSize: '13px',
                fontWeight: 700,
              }}
            >
              2
            </div>
            <span
              style={{
                fontSize: '14px',
                fontWeight: step === 2 ? 700 : 500,
                color: step === 2 ? '#0f172a' : '#64748b',
              }}
            >
              Liên kết cột thông minh
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
                fontSize: '13px',
                fontWeight: 700,
              }}
            >
              3
            </div>
            <span
              style={{
                fontSize: '14px',
                fontWeight: step === 3 ? 700 : 500,
                color: step === 3 ? '#0f172a' : '#64748b',
              }}
            >
              Kiểm tra &amp; Xác nhận nạp
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
                    width: '54px',
                    height: '54px',
                    borderRadius: '50%',
                    background: '#eff6ff',
                    color: '#2563eb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 12px',
                  }}
                >
                  <Upload size={26} />
                </div>
                <h3
                  style={{
                    margin: '0 0 6px',
                    fontSize: '16px',
                    fontWeight: 600,
                    color: '#1e293b',
                  }}
                >
                  {fileName
                    ? `Đã chọn: ${fileName} (${fileSize})`
                    : 'Kéo thả tệp Excel vào đây hoặc bấm để chọn tệp'}
                </h3>
                <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>
                  Hỗ trợ định dạng .xlsx, .xls hoặc .csv (dung lượng tối đa 20MB)
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
                      fontSize: '13px',
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
                  <div
                    style={{
                      marginTop: '14px',
                      display: 'flex',
                      justifyContent: 'center',
                      gap: '10px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <button
                      type="button"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 14px',
                        borderRadius: '6px',
                        border: '1px solid #2563eb',
                        background: '#2563eb',
                        color: '#ffffff',
                        fontSize: '13px',
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
                      <span>Chọn file từ máy tính</span>
                    </button>
                    <button
                      type="button"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 14px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#334155',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadTemplate();
                      }}
                    >
                      <Download size={14} />
                      <span>Tải file Excel mẫu chuẩn</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Tùy chọn Sheet & Cấu hình Header */}
              {rawRows.length > 0 ? (
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
                      <label
                        style={{
                          display: 'block',
                          fontSize: '14px',
                          fontWeight: 600,
                          color: '#334155',
                          marginBottom: '6px',
                        }}
                      >
                        Trang tính (Sheet) cần đọc:
                      </label>
                      <SearchableSelect
                        options={sheets.map((sheet) => ({ value: sheet, label: sheet }))}
                        value={selectedSheet}
                        placeholder="Tìm trang tính…"
                        emptyText="Không tìm thấy trang tính"
                        clearable={false}
                        onChange={setSelectedSheet}
                        style={{ width: '100%', fontSize: '14px' }}
                      />
                    </div>

                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '14px',
                          fontWeight: 600,
                          color: '#334155',
                          marginBottom: '6px',
                        }}
                      >
                        Kho lưu trữ mặc định (khi file không có cột kho):
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
                        style={{ width: '100%', fontSize: '14px' }}
                      />
                    </div>
                  </div>

                  {/* Chọn dòng Tiêu đề (Header Row) */}
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '6px',
                      }}
                    >
                      <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>
                        Dòng tiêu đề (Chứa tên các cột dữ liệu):
                      </label>
                      <span style={{ fontSize: '13px', color: '#64748b' }}>
                        Hệ thống tự động phát hiện dòng số <strong>{headerRowIdx + 1}</strong>
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', color: '#475569' }}>Dòng số:</span>
                      <input
                        type="number"
                        min={1}
                        max={Math.min(rawRows.length, 50)}
                        style={{
                          width: '70px',
                          padding: '6px 8px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          fontSize: '14px',
                          textAlign: 'center',
                        }}
                        value={headerRowIdx + 1}
                        onChange={(e) => handleChangeHeaderRow(Number(e.target.value) - 1)}
                      />
                      <span style={{ fontSize: '13px', color: '#64748b' }}>
                        (Bỏ qua các dòng tên công ty / tiêu đề hóa đơn ở các dòng trên)
                      </span>
                    </div>
                  </div>

                  {/* Xem trước 3 dòng đầu tiên của file */}
                  {rawRows.length > 0 ? (
                    <div>
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: '#475569',
                          display: 'block',
                          marginBottom: '6px',
                        }}
                      >
                        Xem trước cấu trúc file (3 dòng đầu):
                      </span>
                      <div
                        style={{
                          overflowX: 'auto',
                          border: '1px solid #f1f5f9',
                          borderRadius: '6px',
                        }}
                      >
                        <table
                          style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}
                        >
                          <tbody>
                            {rawRows.slice(0, 4).map((r, rIdx) => (
                              <tr
                                key={rIdx}
                                style={{
                                  background:
                                    rIdx === headerRowIdx
                                      ? '#eff6ff'
                                      : rIdx % 2 === 0
                                      ? '#fff'
                                      : '#f8fafc',
                                  fontWeight: rIdx === headerRowIdx ? 700 : 400,
                                  borderBottom: '1px solid #e2e8f0',
                                }}
                              >
                                <td
                                  style={{
                                    padding: '6px 10px',
                                    color: '#94a3b8',
                                    width: '60px',
                                  }}
                                >
                                  #{rIdx + 1}
                                  {rIdx === headerRowIdx ? ' (Header)' : ''}
                                </td>
                                {r.slice(0, 8).map((cell: any, cIdx: number) => (
                                  <td
                                    key={cIdx}
                                    style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Profile & Preset Bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '8px',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                  <Sparkles size={18} color="#16a34a" />
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#166534' }}>
                    Mẫu liên kết cột (Preset):
                  </span>
                  <div style={{ minWidth: '320px', maxWidth: '420px' }}>
                    <SearchableSelect
                      options={presetOptions}
                      value={selectedPresetId}
                      placeholder="Chọn mẫu ứng dụng..."
                      searchPlaceholder="Tìm kiếm mẫu ứng dụng..."
                      onChange={handleSelectPreset}
                      clearable={false}
                      style={{ width: '100%', fontSize: '13px' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
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
                  </button>

                  {savedProfiles[selectedPresetId] ? (
                    <button
                      type="button"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#dc2626',
                        fontSize: '13px',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                      onClick={() => handleDeleteProfile(selectedPresetId)}
                    >
                      Xóa mẫu này
                    </button>
                  ) : null}

                  <button
                    type="button"
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: '1px solid #86efac',
                      background: '#ffffff',
                      color: '#15803d',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    onClick={() => setShowSaveProfileModal(true)}
                  >
                    + Lưu mẫu khớp cột này
                  </button>
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
                    key={cat}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      background: '#ffffff',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 14px',
                        background: '#f8fafc',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: '14px',
                        fontWeight: 700,
                        color: '#1e293b',
                      }}
                    >
                      {catIcon}
                      <span>{catTitle}</span>
                    </div>

                    <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                      <thead style={{ background: '#ffffff', borderBottom: '1px solid #f1f5f9' }}>
                        <tr>
                          <th
                            style={{
                              padding: '8px 14px',
                              textAlign: 'left',
                              width: '240px',
                              color: '#64748b',
                            }}
                          >
                            Trường hệ thống
                          </th>
                          <th
                            style={{
                              padding: '8px 14px',
                              textAlign: 'left',
                              width: '100px',
                              color: '#64748b',
                            }}
                          >
                            Bắt buộc?
                          </th>
                          <th
                            style={{
                              padding: '8px 14px',
                              textAlign: 'left',
                              minWidth: '280px',
                              color: '#64748b',
                            }}
                          >
                            Cột tương ứng trong tệp Excel
                          </th>
                          <th
                            style={{
                              padding: '8px 14px',
                              textAlign: 'left',
                              width: '180px',
                              color: '#64748b',
                            }}
                          >
                            Độ tin cậy khớp
                          </th>
                          <th
                            style={{
                              padding: '8px 14px',
                              textAlign: 'left',
                              width: '200px',
                              color: '#64748b',
                            }}
                          >
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
                            colIdx >= 0 ? rawRows[headerRowIdx + 1]?.[colIdx] : undefined;

                          return (
                            <tr key={rule.key} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '9px 14px', fontWeight: 600, color: '#0f172a' }}>
                                {rule.label}
                              </td>
                              <td style={{ padding: '9px 14px' }}>
                                {rule.required ? (
                                  <span
                                    style={{
                                      fontSize: '11px',
                                      background: '#fee2e2',
                                      color: '#b91c1c',
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      fontWeight: 600,
                                    }}
                                  >
                                    Bắt buộc
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                                    Tùy chọn
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '9px 14px' }}>
                                {rule.key === 'warehouseCode' && isSingleWarehouseOnly ? (
                                  <span
                                    style={{
                                      fontSize: '13px',
                                      fontWeight: 600,
                                      color: '#1e293b',
                                      background: '#f1f5f9',
                                      padding: '5px 10px',
                                      borderRadius: '6px',
                                      border: '1px solid #cbd5e1',
                                      display: 'inline-block',
                                    }}
                                  >
                                    Cố định: {defaultWarehouseCode} (Chốt chặn 1 kho - 1 phiếu)
                                  </span>
                                ) : (
                                  <SearchableSelect
                                    options={fileHeaders.map((h) => ({ value: h, label: h }))}
                                    value={val}
                                    placeholder={`Chọn cột cho ${rule.label}…`}
                                    searchPlaceholder="Tìm tên cột trong file..."
                                    emptyText="Không tìm thấy cột"
                                    onChange={(newVal) => {
                                      setMapping((m) => ({ ...m, [rule.key]: newVal }));
                                      setConfidences((c) => ({
                                        ...c,
                                        [rule.key]: newVal ? 'exact' : 'none',
                                      }));
                                    }}
                                    clearable
                                    style={{ width: '100%', maxWidth: '340px', fontSize: '13px' }}
                                  />
                                )}
                              </td>
                              <td style={{ padding: '9px 14px' }}>
                                {val ? (
                                  conf === 'exact' ? (
                                    <span
                                      style={{
                                        fontSize: '11px',
                                        background: '#dcfce7',
                                        color: '#15803d',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        fontWeight: 600,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                      }}
                                    >
                                      ✓ Khớp chuẩn 100%
                                    </span>
                                  ) : conf === 'high' ? (
                                    <span
                                      style={{
                                        fontSize: '11px',
                                        background: '#e0f2fe',
                                        color: '#0369a1',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        fontWeight: 600,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                      }}
                                    >
                                      ✦ Gợi ý chuẩn cao
                                    </span>
                                  ) : (
                                    <span
                                      style={{
                                        fontSize: '11px',
                                        background: '#f1f5f9',
                                        color: '#475569',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                      }}
                                    >
                                      Người dùng chọn
                                    </span>
                                  )
                                ) : (
                                  <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
                                    — Bỏ qua —
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '9px 14px', color: '#64748b' }}>
                                {rule.key === 'warehouseCode' && isSingleWarehouseOnly
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
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '14px',
                  }}
                >
                  <span style={{ color: '#64748b' }}>Tổng số dòng đọc được:</span>
                  <strong style={{ color: '#0f172a' }}>{stats.total}</strong>
                </div>

                <div style={{ width: '1px', height: '16px', background: '#cbd5e1' }} />

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '14px',
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#16a34a',
                    }}
                  />
                  <span style={{ color: '#166534', fontWeight: 600 }}>Hợp lệ: {stats.valid}</span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '14px',
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#eab308',
                    }}
                  />
                  <span style={{ color: '#854d0e', fontWeight: 600 }}>
                    Mã mới (tự tạo danh mục): {stats.warning}
                  </span>
                </div>

                {stats.error > 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '14px',
                    }}
                  >
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: '#dc2626',
                      }}
                    />
                    <span style={{ color: '#991b1b', fontWeight: 600 }}>
                      Lỗi (bỏ qua): {stats.error}
                    </span>
                  </div>
                ) : null}

                <div
                  style={{
                    marginLeft: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span style={{ fontSize: '13px', color: '#475569' }}>
                    Tổng số lượng dự kiến nạp:{' '}
                    <strong>{new Intl.NumberFormat('vi-VN').format(stats.totalQty)}</strong>
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
                <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                  <thead
                    style={{
                      background: '#f8fafc',
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                      borderBottom: '1px solid #e2e8f0',
                    }}
                  >
                    <tr>
                      <th style={{ padding: '8px 10px', textAlign: 'center', width: '45px' }}>#</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center', width: '90px' }}>
                        Trạng thái
                      </th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: '110px' }}>
                        Mã SKU
                      </th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: '110px' }}>
                        Mã vạch
                      </th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: '180px' }}>
                        Tên hàng hóa
                      </th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', width: '100px' }}>
                        Kho nạp
                      </th>
                      <th style={{ padding: '8px 10px', textAlign: 'center', width: '65px' }}>
                        ĐVT
                      </th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', width: '85px' }}>
                        Số lượng
                      </th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: '130px' }}>
                        Thuộc nhóm
                      </th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: '120px' }}>
                        Hãng SX
                      </th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', width: '110px' }}>
                        Đơn giá vốn
                      </th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: '140px' }}>
                        Ghi chú / Lỗi
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedDataResults.map((r) => (
                      <tr
                        key={r.rowIndex}
                        style={{
                          background:
                            r.status === 'error'
                              ? '#fef2f2'
                              : r.isNew
                              ? '#fefce8'
                              : '#ffffff',
                          borderBottom: '1px solid #f1f5f9',
                        }}
                      >
                        <td
                          style={{
                            padding: '8px 10px',
                            textAlign: 'center',
                            color: '#94a3b8',
                          }}
                        >
                          {r.rowIndex}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          {r.status === 'valid' ? (
                            <span
                              style={{
                                fontSize: '11px',
                                background: '#dcfce7',
                                color: '#15803d',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontWeight: 600,
                              }}
                            >
                              Hợp lệ
                            </span>
                          ) : r.status === 'warning' ? (
                            <span
                              style={{
                                fontSize: '11px',
                                background: '#fef08a',
                                color: '#854d0e',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontWeight: 600,
                              }}
                            >
                              Mã mới
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: '11px',
                                background: '#fee2e2',
                                color: '#b91c1c',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontWeight: 600,
                              }}
                            >
                              Lỗi
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0f172a' }}>
                          {r.materialCode}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#475569', fontSize: '12px' }}>
                          {r.barcode || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#334155' }}>{r.materialName}</td>
                        <td style={{ padding: '8px 10px', color: '#334155', fontWeight: 600 }}>
                          {r.warehouseCode}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', color: '#475569' }}>
                          {r.unit}
                        </td>
                        <td
                          style={{
                            padding: '8px 10px',
                            textAlign: 'right',
                            fontWeight: 600,
                            color: '#0f172a',
                          }}
                        >
                          {r.quantity > 0
                            ? new Intl.NumberFormat('vi-VN').format(r.quantity)
                            : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#475569' }}>
                          <span
                            style={{
                              background: '#f1f5f9',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                            }}
                          >
                            {r.materialType || '—'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', color: '#475569', fontSize: '12px' }}>
                          {r.manufacturer || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#475569' }}>
                          {r.unitCost !== undefined
                            ? new Intl.NumberFormat('vi-VN').format(r.unitCost)
                            : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: '13px' }}>
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
              <h4
                style={{
                  margin: '0 0 8px',
                  fontSize: '16px',
                  fontWeight: 700,
                  color: '#0f172a',
                }}
              >
                Lưu cấu hình khớp cột
              </h4>
              <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#64748b' }}>
                Đặt tên cho mẫu để sử dụng lại cho các file có cấu trúc tương tự (ví dụ: &ldquo;File KiotViet chi nhánh&rdquo;, &ldquo;File MISA Kho Tổng&rdquo;).
              </p>
              <input
                type="text"
                placeholder="Nhập tên mẫu cấu hình..."
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
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
                    fontSize: '13px',
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
                    fontSize: '13px',
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
                <span>
                  Tiếp tục: Kiểm tra dữ liệu (
                  {rawRows.length > headerRowIdx + 1
                    ? `${rawRows.length - headerRowIdx - 1} dòng`
                    : '0 dòng'}
                  )
                </span>
                <ArrowRight size={15} />
              </button>
            ) : null}

            {step === 3 && stats.blockedByErrors ? (
              <span role="alert" style={{ color: '#b91c1c', fontSize: '13px', fontWeight: 600 }}>
                Còn {stats.error} dòng lỗi. Sửa file rồi chọn lại để nạp.
              </span>
            ) : null}

            {step === 3 ? (
              <button
                type="button"
                className={`${styles.action} ${styles.actionPrimary}`}
                disabled={stats.readyToImport === 0 || stats.blockedByErrors}
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
                <span>
                  Đồng ý nạp {stats.readyToImport} vật tư vào{' '}
                  {isDirectMovement ? 'phiếu' : 'hệ thống kho'}
                </span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
