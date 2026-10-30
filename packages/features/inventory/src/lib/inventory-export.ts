import type {
  InstalledMaterial,
  InventoryItem,
  Material,
  MaterialInventory,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import * as XLSX from 'xlsx';
import type { InventoryLedgerRow } from './inventory-api';
import {
  ASSET_STATUS_LABEL,
  MATERIAL_CATEGORY_LABEL,
  TRANSACTION_TYPE_LABEL,
} from './inventory-labels';

function padZero(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function getTimestamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${padZero(d.getMonth() + 1)}${padZero(d.getDate())}_${padZero(
    d.getHours(),
  )}${padZero(d.getMinutes())}`;
}

function autoFitColumns(ws: XLSX.WorkSheet, data: Record<string, unknown>[]): void {
  if (data.length === 0) return;
  const colWidths = Object.keys(data[0]).map((key) => {
    let maxLen = key.length;
    const sample = data.slice(0, 80);
    for (const row of sample) {
      const val = row[key];
      const strVal = val == null ? '' : String(val);
      if (strVal.length > maxLen) {
        maxLen = strVal.length;
      }
    }
    return { wch: Math.min(Math.max(maxLen + 3, 10), 45) };
  });
  ws['!cols'] = colWidths;
}

/**
 * Xuất dữ liệu bảng Tồn kho ra file Excel (.xlsx).
 */
export function exportStockToExcel(params: {
  rows: readonly (MaterialInventory & { warehouseCode?: string; materialCode?: string })[];
  materialByCode: ReadonlyMap<string, Material>;
  warehouseLabel?: string;
}): void {
  const { rows, materialByCode, warehouseLabel = 'Tat_Ca_Kho' } = params;

  const exportData = rows.map((row, idx) => {
    const mat = row.materialCode ? materialByCode.get(row.materialCode) : undefined;
    const minStock = mat?.minStock ?? 0;
    const isLow = row.available < minStock;

    return {
      STT: idx + 1,
      'Mã vật tư': row.materialCode ?? '',
      'Tên vật tư': mat?.name ?? '',
      'Nhóm vật tư': mat?.category ? MATERIAL_CATEGORY_LABEL[mat.category] ?? mat.category : '',
      'Loại vật tư': mat?.type ?? '',
      'Đơn vị tính': mat?.unit ?? '',
      Kho: row.warehouseCode ?? '',
      'Tồn thực tế': row.quantity,
      'Số lượng giữ': row.quantityReserved,
      'Khả dụng': row.available,
      'Tồn tối thiểu': minStock,
      'Tồn tối đa': mat?.maxStock ?? 0,
      'Cảnh báo tồn': isLow ? 'Thiếu tồn' : 'Bình thường',
    };
  });

  const ws = XLSX.utils.json_to_sheet(exportData);
  autoFitColumns(ws, exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TonKho');

  const cleanLabel = warehouseLabel.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '_');
  XLSX.writeFile(wb, `Ton_Kho_${cleanLabel}_${getTimestamp()}.xlsx`);
}

/**
 * Xuất dữ liệu Tồn kho & Danh mục chi tiết chuẩn hoá (Universal Flat File) ra file Excel (.xlsx).
 * Phục vụ cho:
 * 1. Quản lý kho thực tế và kiểm kê chi tiết từng kho / vị trí.
 * 2. Sao lưu (Backup) toàn vẹn số liệu kho định kỳ.
 * 3. Chuyển giao hệ thống (Data Migration & Handover) sang bất kỳ nền tảng ERP nào khác (Odoo, SAP, MISA...).
 *
 * Cấu trúc bảng phẳng hoàn toàn (Flat Table, không merge cell), số nguyên thủy,
 * tích hợp Mã vạch (Barcode) ánh xạ 1-1 từ SKU để thiết bị ngoại vi (máy quét PDA) đọc trực tiếp.
 */
export function exportCatalogToExcel(params: {
  items: readonly InventoryItem[];
  materialByCode?: ReadonlyMap<string, Material>;
  stockByCode: ReadonlyMap<
    string,
    readonly (MaterialInventory & { warehouseCode?: string; materialCode?: string })[]
  >;
  installed?: readonly InstalledMaterial[];
  warehouses?: readonly Warehouse[];
  warehouseFilter?: string;
}): void {
  const {
    items,
    materialByCode,
    stockByCode,
    installed = [],
    warehouses = [],
    warehouseFilter = 'all',
  } = params;

  // Xây dựng bản đồ tra cứu thông tin kho
  const warehouseCodeById = new Map<string, string>();
  const warehouseNameByCode = new Map<string, string>();
  const warehouseNameById = new Map<string, string>();

  for (const wh of warehouses) {
    warehouseCodeById.set(wh.id, wh.code);
    warehouseNameByCode.set(wh.code, wh.name);
    warehouseNameById.set(wh.id, wh.name);
  }

  const exportRows: Record<string, unknown>[] = [];

  for (const item of items) {
    const mat = materialByCode?.get(item.code);
    const stockRows = stockByCode.get(item.code) ?? [];
    const inUseQty = installed
      .filter((line) => line.materialCode === item.code)
      .reduce((sum, line) => sum + line.quantity, 0);

    const costPrice = mat?.purchasePrice ?? 0;
    // Mã vạch sinh 1-1 chuẩn hóa từ mã SKU (hoặc mat.barcode nếu có khai báo riêng)
    const barcode =
      mat?.barcode && mat.barcode.trim()
        ? mat.barcode.trim()
        : item.code.trim().toUpperCase();

    const categoryLabel =
      item.type ||
      (mat?.category ? MATERIAL_CATEGORY_LABEL[mat.category] ?? mat.category : '') ||
      mat?.type ||
      '—';
    const manufacturer = mat?.manufacturer || '—';
    const unit = mat?.unit || item.unit || 'Cái';
    const minStock = mat?.minStock ?? 0;
    const maxStock = mat?.maxStock ?? 0;

    let trackingMethod = 'Thông thường';
    if (mat?.isSerialized) {
      trackingMethod = 'Theo Sê-ri (SN)';
    } else if (mat?.category === 'CONSUMABLE') {
      trackingMethod = 'Theo Lô (Lot)';
    }

    const statusLabel = item.status
      ? ASSET_STATUS_LABEL[item.status] ?? item.status
      : 'Hoạt động';
    const note = item.installedAtName
      ? `Đang lắp tại: ${item.installedAtName}`
      : item.usageState || '';

    // Trường hợp 1: Đang lọc theo 1 kho cụ thể
    if (warehouseFilter && warehouseFilter !== 'all') {
      const matchingRows = stockRows.filter(
        (r) =>
          r.warehouseCode === warehouseFilter ||
          warehouseCodeById.get(r.warehouseId) === warehouseFilter,
      );
      const whName = warehouseNameByCode.get(warehouseFilter) || warehouseFilter;

      if (matchingRows.length > 0) {
        for (const row of matchingRows) {
          const qty = Number(row.quantity) || 0;
          const reserved = Number(row.quantityReserved) || 0;
          const available = Number(row.available) || 0;
          const location = row.locationId || item.usageState || '—';

          let stockAlert = 'An toàn';
          if (minStock > 0 && available < minStock) {
            stockAlert = 'Dưới định mức (Thiếu hàng)';
          } else if (maxStock > 0 && qty > maxStock) {
            stockAlert = 'Vượt định mức (Dư thừa)';
          }

          exportRows.push({
            STT: exportRows.length + 1,
            'Mã hàng hóa (SKU)': item.code,
            'Mã vạch (Barcode)': barcode,
            'Tên hàng hóa': item.name,
            'Phân loại danh mục': item.kind === 'ASSET' ? 'Tài sản / Thiết bị' : 'Vật tư',
            'Nhóm hàng hóa (Category)': categoryLabel,
            'Hãng sản xuất': manufacturer,
            'Đơn vị tính (UoM)': unit,
            'Mã kho': warehouseFilter,
            'Tên kho': whName,
            'Vị trí kệ / ô (Bin Rack)': location,
            'Tồn thực tế (On-hand)': qty,
            'Đang giữ chỗ (Reserved)': reserved,
            'Tồn khả dụng (Available)': available,
            'Đang sử dụng / Lắp ráp': inUseQty,
            'Tổng sở hữu': qty + inUseQty,
            'Đơn giá vốn (VNĐ)': costPrice,
            'Tổng giá trị tồn kho (VNĐ)': costPrice * qty,
            'Định mức tồn tối thiểu (Min)': minStock,
            'Định mức tồn tối đa (Max)': maxStock,
            'Cảnh báo tồn': stockAlert,
            'Phương thức theo dõi': trackingMethod,
            'Tình trạng kỹ thuật': statusLabel,
            'Ghi chú / Nơi lắp đặt': note,
          });
        }
      } else {
        // Mặt hàng chưa có số lượng tại kho đang lọc
        const stockAlert = minStock > 0 ? 'Dưới định mức (Thiếu hàng)' : 'An toàn';
        exportRows.push({
          STT: exportRows.length + 1,
          'Mã hàng hóa (SKU)': item.code,
          'Mã vạch (Barcode)': barcode,
          'Tên hàng hóa': item.name,
          'Phân loại danh mục': item.kind === 'ASSET' ? 'Tài sản / Thiết bị' : 'Vật tư',
          'Nhóm hàng hóa (Category)': categoryLabel,
          'Hãng sản xuất': manufacturer,
          'Đơn vị tính (UoM)': unit,
          'Mã kho': warehouseFilter,
          'Tên kho': whName,
          'Vị trí kệ / ô (Bin Rack)': item.usageState || '—',
          'Tồn thực tế (On-hand)': 0,
          'Đang giữ chỗ (Reserved)': 0,
          'Tồn khả dụng (Available)': 0,
          'Đang sử dụng / Lắp ráp': inUseQty,
          'Tổng sở hữu': inUseQty,
          'Đơn giá vốn (VNĐ)': costPrice,
          'Tổng giá trị tồn kho (VNĐ)': 0,
          'Định mức tồn tối thiểu (Min)': minStock,
          'Định mức tồn tối đa (Max)': maxStock,
          'Cảnh báo tồn': stockAlert,
          'Phương thức theo dõi': trackingMethod,
          'Tình trạng kỹ thuật': statusLabel,
          'Ghi chú / Nơi lắp đặt': note,
        });
      }
    } else {
      // Trường hợp 2: warehouseFilter === 'all' (Tất cả vị trí kho)
      // Lọc các dòng kho thực tế có tồn hoặc đang giữ chỗ
      const activeStock = stockRows.filter(
        (r) =>
          (Number(r.quantity) || 0) > 0 ||
          (Number(r.quantityReserved) || 0) > 0 ||
          (Number(r.available) || 0) > 0,
      );

      if (activeStock.length > 0) {
        for (const row of activeStock) {
          const whCode =
            row.warehouseCode ||
            (row.warehouseId ? warehouseCodeById.get(row.warehouseId) : '') ||
            '—';
          const whName =
            (whCode !== '—' ? warehouseNameByCode.get(whCode) : undefined) ||
            (row.warehouseId ? warehouseNameById.get(row.warehouseId) : undefined) ||
            whCode;
          const qty = Number(row.quantity) || 0;
          const reserved = Number(row.quantityReserved) || 0;
          const available = Number(row.available) || 0;
          const location = row.locationId || item.usageState || '—';

          let stockAlert = 'An toàn';
          if (minStock > 0 && available < minStock) {
            stockAlert = 'Dưới định mức (Thiếu hàng)';
          } else if (maxStock > 0 && qty > maxStock) {
            stockAlert = 'Vượt định mức (Dư thừa)';
          }

          exportRows.push({
            STT: exportRows.length + 1,
            'Mã hàng hóa (SKU)': item.code,
            'Mã vạch (Barcode)': barcode,
            'Tên hàng hóa': item.name,
            'Phân loại danh mục': item.kind === 'ASSET' ? 'Tài sản / Thiết bị' : 'Vật tư',
            'Nhóm hàng hóa (Category)': categoryLabel,
            'Hãng sản xuất': manufacturer,
            'Đơn vị tính (UoM)': unit,
            'Mã kho': whCode,
            'Tên kho': whName,
            'Vị trí kệ / ô (Bin Rack)': location,
            'Tồn thực tế (On-hand)': qty,
            'Đang giữ chỗ (Reserved)': reserved,
            'Tồn khả dụng (Available)': available,
            'Đang sử dụng / Lắp ráp': inUseQty,
            'Tổng sở hữu': qty + inUseQty,
            'Đơn giá vốn (VNĐ)': costPrice,
            'Tổng giá trị tồn kho (VNĐ)': costPrice * qty,
            'Định mức tồn tối thiểu (Min)': minStock,
            'Định mức tồn tối đa (Max)': maxStock,
            'Cảnh báo tồn': stockAlert,
            'Phương thức theo dõi': trackingMethod,
            'Tình trạng kỹ thuật': statusLabel,
            'Ghi chú / Nơi lắp đặt': note,
          });
        }
      } else {
        // Chưa có số lượng trong kho nào (vật tư mới tạo hoặc chỉ đang lắp ráp ở công trình)
        const whCode =
          item.usageState && warehouseNameByCode.has(item.usageState)
            ? item.usageState
            : '—';
        const whName =
          whCode !== '—'
            ? warehouseNameByCode.get(whCode) || whCode
            : 'Chưa phân kho / Ngoài kho';
        const stockAlert = minStock > 0 ? 'Dưới định mức (Thiếu hàng)' : 'An toàn';

        exportRows.push({
          STT: exportRows.length + 1,
          'Mã hàng hóa (SKU)': item.code,
          'Mã vạch (Barcode)': barcode,
          'Tên hàng hóa': item.name,
          'Phân loại danh mục': item.kind === 'ASSET' ? 'Tài sản / Thiết bị' : 'Vật tư',
          'Nhóm hàng hóa (Category)': categoryLabel,
          'Hãng sản xuất': manufacturer,
          'Đơn vị tính (UoM)': unit,
          'Mã kho': whCode,
          'Tên kho': whName,
          'Vị trí kệ / ô (Bin Rack)': item.usageState || '—',
          'Tồn thực tế (On-hand)': 0,
          'Đang giữ chỗ (Reserved)': 0,
          'Tồn khả dụng (Available)': 0,
          'Đang sử dụng / Lắp ráp': inUseQty,
          'Tổng sở hữu': inUseQty,
          'Đơn giá vốn (VNĐ)': costPrice,
          'Tổng giá trị tồn kho (VNĐ)': 0,
          'Định mức tồn tối thiểu (Min)': minStock,
          'Định mức tồn tối đa (Max)': maxStock,
          'Cảnh báo tồn': stockAlert,
          'Phương thức theo dõi': trackingMethod,
          'Tình trạng kỹ thuật': statusLabel,
          'Ghi chú / Nơi lắp đặt': note,
        });
      }
    }
  }

  const ws = XLSX.utils.json_to_sheet(exportRows);
  autoFitColumns(ws, exportRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TonKho_ChiTiet');

  const timestamp = getTimestamp();
  let fileName = `Ton_Kho_ngay_${timestamp}.xlsx`;
  if (warehouseFilter && warehouseFilter !== 'all') {
    const cleanWh = warehouseFilter.replace(
      /[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g,
      '_',
    );
    fileName = `Ton_Kho_${cleanWh}_ngay_${timestamp}.xlsx`;
  }

  XLSX.writeFile(wb, fileName);
}

/**
 * Xuất dữ liệu Nhật ký sổ cái giao dịch ra file Excel (.xlsx).
 */
export function exportLedgerToExcel(params: {
  rows: readonly InventoryLedgerRow[];
  materialById: ReadonlyMap<string, Material>;
  warehouseById: ReadonlyMap<string, string>;
}): void {
  const { rows, materialById, warehouseById } = params;

  const exportData = rows.map((entry, idx) => {
    const mat = entry.materialId ? materialById.get(entry.materialId) : undefined;
    const warehouseCode = warehouseById.get(entry.warehouseId) ?? entry.warehouseId;
    const totalCost = (entry.quantity || 0) * (entry.unitCost || 0);

    return {
      STT: idx + 1,
      'Thời gian': entry.createdAt ? entry.createdAt.replace('T', ' ').slice(0, 19) : '',
      'Mã giao dịch': entry.transactionCode,
      'Loại giao dịch': TRANSACTION_TYPE_LABEL[entry.type] ?? entry.type,
      'Mã vật tư': mat?.code ?? entry.materialId ?? '',
      'Tên vật tư': mat?.name ?? '',
      'Đơn vị tính': mat?.unit ?? '',
      Kho: warehouseCode,
      'Số lượng': entry.quantity,
      'Đơn giá (VNĐ)': entry.unitCost,
      'Thành tiền (VNĐ)': totalCost,
      'Số sê-ri': entry.serialNumber ?? '',
      'Chứng từ tham chiếu': entry.referenceId ? `${entry.referenceType ?? ''} ${entry.referenceId}`.trim() : '',
      'Người thực hiện': entry.createdBy,
      'Ghi chú': entry.note ?? '',
    };
  });

  const ws = XLSX.utils.json_to_sheet(exportData);
  autoFitColumns(ws, exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SoCaiGiaoDich');

  XLSX.writeFile(wb, `Nhat_Ky_Giao_Dich_${getTimestamp()}.xlsx`);
}
