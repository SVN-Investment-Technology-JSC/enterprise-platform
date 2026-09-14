'use client';

import type {
  MaintenanceFrequency,
  MaintenanceHistoryPage,
  MaintenanceMatrix,
  MaintenanceMatrixAsset,
  MaintenanceMatrixRow,
  MaintenancePriority,
} from '@enterprise-platform/contracts-maintenance';
import { MinimalPopupForm, Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  Download,
  FileText,
  History,
  Search,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
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

const MATRIX_IMPORT_HEADERS = [
  'Mã thiết bị',
  'Tần suất',
  'Ngày bắt đầu',
  'Mã quy trình',
  'Mức ưu tiên',
] as const;

function normalize(str?: string): string {
  return (str ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export interface MatrixImportRow {
  rowNumber: number;
  assetCode: string;
  assetName?: string;
  frequencies: MaintenanceFrequency[];
  rawFrequency?: string;
  startDate?: string;
  rawStartDate?: string;
  procedureCode?: string;
  procedureDefinitionId?: string;
  priority: MaintenancePriority;
  rawPriority?: string;
  errors: string[];
}

export interface MatrixImportReview {
  rows: MatrixImportRow[];
  totalRows: number;
  validRows: MatrixImportRow[];
  invalidRows: MatrixImportRow[];
}

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
  const [newlyAddedAssetCode, setNewlyAddedAssetCode] = useState<string>();

  // Tự động xoá trạng thái nháy highlight sau 3.5s
  useEffect(() => {
    if (!newlyAddedAssetCode) return;
    const timer = setTimeout(() => {
      setNewlyAddedAssetCode(undefined);
    }, 3500);
    return () => clearTimeout(timer);
  }, [newlyAddedAssetCode]);

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

  /**
   * Danh sách thiết bị từ Kho để chọn thêm vào ma trận.
   * Ưu tiên matrix.availableAssets (thiết bị trong Kho chưa có lịch).
   * Nếu availableAssets rỗng, lấy từ toàn bộ danh mục thiết bị đã có trong matrix.rows.
   * Logic: Nếu thiết bị ĐÃ CÓ lịch bảo trì (đang có ít nhất 1 ô chu kỳ bật trong draft hoặc cells)
   * thì loại bỏ khỏi danh sách lựa chọn để không hiển thị trong ô chọn thêm nữa.
   */
  const candidateAvailableAssets = useMemo(() => {
    // Tập hợp mã các thiết bị đang có ít nhất một chu kỳ bảo trì
    const scheduledCodes = new Set<string>();
    for (const r of rows) {
      const draft = drafts.get(r.asset.code);
      const hasDraftFreq = draft && draft.frequencies.size > 0;
      const hasCellFreq = Object.values(r.cells).some((c) => Boolean(c));
      if (hasDraftFreq || hasCellFreq) {
        scheduledCodes.add(r.asset.code);
      }
    }

    const source =
      matrix.availableAssets && matrix.availableAssets.length > 0
        ? matrix.availableAssets
        : rows.map((r) => r.asset);

    return source.filter((asset) => !scheduledCodes.has(asset.code));
  }, [matrix.availableAssets, rows, drafts]);

  /** Danh sách thiết bị chuyển thành options chuẩn cho SearchableSelect */
  const addAssetOptions = useMemo(() => {
    return candidateAvailableAssets.map((asset) => {
      const isOperating = Boolean(asset.orgUnitId || asset.parentCode);
      const statusLabel = isOperating ? 'Đang vận hành' : 'Tồn kho - Dự trữ';
      const unitName = asset.orgUnitId && unitNames?.get(asset.orgUnitId) ? ` · ${unitNames.get(asset.orgUnitId)}` : '';
      return {
        value: asset.code,
        label: `${asset.code} - ${asset.name}`,
        description: `${statusLabel}${unitName}`,
        badge: statusLabel,
      };
    });
  }, [candidateAvailableAssets, unitNames]);

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
   * Nếu có thiết bị vừa được thêm (newlyAddedAssetCode), ưu tiên đưa lên đầu bảng.
   */
  const orderedRows = useMemo(() => {
    const list = [...filteredRows];
    if (newlyAddedAssetCode) {
      list.sort((a, b) => {
        if (a.asset.code === newlyAddedAssetCode) return -1;
        if (b.asset.code === newlyAddedAssetCode) return 1;
        return 0;
      });
    }
    return list.map((row) => ({ row, depth: 0 }));
  }, [filteredRows, newlyAddedAssetCode]);
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

  const importInputRef = useRef<HTMLInputElement>(null);
  const [importReview, setImportReview] = useState<MatrixImportReview | null>(null);

  /** Options danh sách thiết bị dùng cho SearchableSelect trong Modal Import */
  const assetImportOptions = useMemo(() => {
    const map = new Map<string, { code: string; name: string }>();
    for (const r of rows) {
      map.set(r.asset.code, { code: r.asset.code, name: r.asset.name });
    }
    for (const a of matrix.availableAssets) {
      map.set(a.code, { code: a.code, name: a.name });
    }
    return Array.from(map.values()).map((a) => ({
      value: a.code,
      label: `${a.code} - ${a.name}`,
      description: a.name,
    }));
  }, [rows, matrix.availableAssets]);

  /** Options tần suất cho SearchableSelect trong Modal Import */
  const frequencyImportOptions = useMemo(() => {
    return frequencies.map((f) => ({
      value: f.id,
      label: f.label,
      description: `Chu kỳ ${f.label}`,
    }));
  }, [frequencies]);

  /** Options quy trình cho SearchableSelect trong Modal Import */
  const procedureImportOptions = useMemo(() => {
    return (matrix.procedureCatalog ?? []).map((proc) => ({
      value: proc.code,
      label: `${proc.code} - ${proc.name}`,
      description: proc.name,
    }));
  }, [matrix.procedureCatalog]);

  const priorityImportOptions = useMemo(() => {
    return (Object.entries(PRIORITY_LABEL) as [MaintenancePriority, string][]).map(([val, lbl]) => ({
      value: val,
      label: lbl,
    }));
  }, []);

  const downloadImportTemplate = () => {
    const sampleRows = [
      {
        'Mã thiết bị': rows[0]?.asset.code ?? 'MBA-01',
        'Tần suất': frequencies.map((f) => f.label).slice(0, 2).join(', '),
        'Ngày bắt đầu': defaultStartDate(),
        'Mã quy trình': matrix.procedureCatalog?.[0]?.code ?? '',
        'Mức ưu tiên': 'Cao',
      },
      {
        'Mã thiết bị': rows[1]?.asset.code ?? 'MC-901',
        'Tần suất': frequencies[0]?.label ?? 'Tháng',
        'Ngày bắt đầu': defaultStartDate(),
        'Mã quy trình': '',
        'Mức ưu tiên': 'Thường',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(sampleRows, { header: [...MATRIX_IMPORT_HEADERS] });
    const guideSheet = XLSX.utils.aoa_to_sheet([
      ['HƯỚNG DẪN NHẬP EXCEL MA TRẬN BẢO TRÌ'],
      [''],
      ['Cột', 'Bắt buộc', 'Định dạng / Giá trị hợp lệ'],
      ['Mã thiết bị', 'Có', 'Mã thiết bị có trong Ma trận hoặc trong Kho thiết bị'],
      [
        'Tần suất',
        'Có',
        `Một hoặc nhiều tần suất, cách nhau bằng dấu phẩy. Danh sách: ${frequencies.map((f) => f.label).join(', ')}`,
      ],
      ['Ngày bắt đầu', 'Không', 'Định dạng YYYY-MM-DD hoặc DD/MM/YYYY. Bỏ trống sẽ dùng mặc định +7 ngày'],
      ['Mã quy trình', 'Không', 'Mã quy trình đã công bố trong danh mục quy trình'],
      ['Mức ưu tiên', 'Không', 'Thấp, Thường, Cao (mặc định Thường)'],
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Mau_Nhap_Ma_Tran');
    XLSX.utils.book_append_sheet(wb, guideSheet, 'Huong_Dan');
    XLSX.writeFile(wb, 'Mau_Nhap_Ma_Tran_Bao_Tri.xlsx');
  };

  const importMatrix = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const buffer = loadEvent.target?.result;
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          alert('Tệp Excel rỗng hoặc không đúng cấu trúc.');
          return;
        }

        const sheet = workbook.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: '',
        });

        if (!rawData.length) {
          alert('Không tìm thấy dữ liệu dòng nào trong tệp Excel.');
          return;
        }

        const knownAssets = new Map<string, { code: string; name: string }>();
        for (const r of rows) {
          knownAssets.set(normalize(r.asset.code), { code: r.asset.code, name: r.asset.name });
        }
        for (const a of matrix.availableAssets) {
          knownAssets.set(normalize(a.code), { code: a.code, name: a.name });
        }

        const freqMap = new Map<string, MaintenanceFrequency>();
        for (const f of frequencies) {
          freqMap.set(normalize(f.id), f.id);
          freqMap.set(normalize(f.label), f.id);
        }

        const procMap = new Map<string, { definitionId: string; code: string }>();
        for (const p of matrix.procedureCatalog ?? []) {
          procMap.set(normalize(p.code), { definitionId: p.definitionId, code: p.code });
        }

        const parsedRows: MatrixImportRow[] = rawData.map((item, idx) => {
          const rowNumber = idx + 2;
          const errors: string[] = [];

          // 1. Mã thiết bị
          const rawCode = String(
            item['Mã thiết bị'] || item['Ma thiet bi'] || item['Thiết bị'] || item['Thiet bi'] || '',
          ).trim();
          const normCode = normalize(rawCode);
          const matchedAsset = normCode ? knownAssets.get(normCode) : undefined;
          if (!rawCode) {
            errors.push('Thiếu mã thiết bị');
          } else if (!matchedAsset) {
            errors.push(`Mã thiết bị "${rawCode}" không tồn tại trong hệ thống`);
          }

          // 2. Tần suất
          const rawFreq = String(
            item['Tần suất'] || item['Tan suat'] || item['Chu kỳ'] || item['Chu ky'] || '',
          ).trim();
          const freqParts = rawFreq.split(/[,;/+]+/).map((s) => s.trim()).filter(Boolean);
          const matchedFreqs: MaintenanceFrequency[] = [];
          for (const p of freqParts) {
            const found = freqMap.get(normalize(p));
            if (found && !matchedFreqs.includes(found)) {
              matchedFreqs.push(found);
            }
          }
          if (!matchedFreqs.length) {
            errors.push(rawFreq ? `Tần suất "${rawFreq}" không hợp lệ` : 'Thiếu tần suất');
          }

          // 3. Ngày bắt đầu
          const rawStart = String(
            item['Ngày bắt đầu'] || item['Ngay bat dau'] || item['Bắt đầu'] || item['Bat dau'] || '',
          ).trim();
          let startDate: string | undefined = undefined;
          if (rawStart) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(rawStart)) {
              startDate = rawStart;
            } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawStart)) {
              const [d, m, y] = rawStart.split('/');
              startDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
            } else {
              const parsedDate = new Date(rawStart);
              if (!isNaN(parsedDate.getTime())) {
                startDate = parsedDate.toISOString().slice(0, 10);
              } else {
                errors.push(`Ngày bắt đầu "${rawStart}" không đúng định dạng`);
              }
            }
          } else {
            startDate = defaultStartDate();
          }

          // 4. Mã quy trình
          const rawProc = String(
            item['Mã quy trình'] || item['Ma quy trinh'] || item['Quy trình'] || item['Quy trinh'] || '',
          ).trim();
          let procDefId: string | undefined = undefined;
          let procCode: string | undefined = undefined;
          if (rawProc) {
            const matchedProc = procMap.get(normalize(rawProc));
            if (matchedProc) {
              procDefId = matchedProc.definitionId;
              procCode = matchedProc.code;
            } else {
              errors.push(`Mã quy trình "${rawProc}" không tồn tại`);
              procCode = rawProc;
            }
          }

          // 5. Mức ưu tiên
          const rawPriority = String(
            item['Mức ưu tiên'] || item['Muc uu tien'] || item['Ưu tiên'] || item['Uu tien'] || '',
          ).trim();
          let priority: MaintenancePriority = 'Normal';
          const normPri = normalize(rawPriority);
          if (normPri === 'cao' || normPri === 'high') priority = 'High';
          else if (normPri === 'thap' || normPri === 'low') priority = 'Low';
          else if (normPri === 'thuong' || normPri === 'normal' || normPri === 'trung binh') priority = 'Normal';

          return {
            rowNumber,
            assetCode: matchedAsset ? matchedAsset.code : rawCode,
            assetName: matchedAsset ? matchedAsset.name : undefined,
            frequencies: matchedFreqs,
            rawFrequency: rawFreq,
            startDate,
            rawStartDate: rawStart,
            procedureCode: procCode,
            procedureDefinitionId: procDefId,
            priority,
            rawPriority,
            errors,
          };
        });

        const validRows = parsedRows.filter((r) => r.errors.length === 0);
        const invalidRows = parsedRows.filter((r) => r.errors.length > 0);

        setImportReview({
          rows: parsedRows,
          totalRows: parsedRows.length,
          validRows,
          invalidRows,
        });
      } catch (err: unknown) {
        alert('Lỗi khi đọc file Excel: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        if (event.target) event.target.value = '';
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const updateImportCell = (index: number, field: keyof MatrixImportRow, value: unknown) => {
    if (!importReview) return;
    const updatedRows = [...importReview.rows];
    const currentRow = { ...updatedRows[index], [field]: value };
    updatedRows[index] = currentRow;

    revalidateImport(updatedRows);
  };

  const revalidateImport = (sourceRows?: MatrixImportRow[]) => {
    const baseRows = sourceRows ?? importReview?.rows ?? [];
    const knownAssets = new Map<string, { code: string; name: string }>();
    for (const r of rows) {
      knownAssets.set(normalize(r.asset.code), { code: r.asset.code, name: r.asset.name });
    }
    for (const a of matrix.availableAssets) {
      knownAssets.set(normalize(a.code), { code: a.code, name: a.name });
    }

    const procMap = new Map<string, { definitionId: string; code: string }>();
    for (const p of matrix.procedureCatalog ?? []) {
      procMap.set(normalize(p.code), { definitionId: p.definitionId, code: p.code });
    }

    const revalidated = baseRows.map((r) => {
      const errors: string[] = [];
      const code = r.assetCode.trim();
      const assetInfo = code ? knownAssets.get(normalize(code)) : undefined;

      if (!code) {
        errors.push('Thiếu mã thiết bị');
      } else if (!assetInfo) {
        errors.push(`Mã thiết bị "${code}" không tồn tại trong hệ thống`);
      }

      const assetName = assetInfo ? assetInfo.name : r.assetName;

      if (!r.frequencies.length) {
        errors.push('Thiếu tần suất');
      }

      if (r.rawStartDate && !r.startDate) {
        errors.push(`Ngày bắt đầu "${r.rawStartDate}" không đúng định dạng`);
      }

      let procDefId = r.procedureDefinitionId;
      if (r.procedureCode) {
        const proc = procMap.get(normalize(r.procedureCode));
        if (proc) {
          procDefId = proc.definitionId;
        } else {
          errors.push(`Mã quy trình "${r.procedureCode}" không tồn tại`);
        }
      } else {
        procDefId = undefined;
      }

      return {
        ...r,
        assetCode: assetInfo ? assetInfo.code : code,
        assetName,
        procedureDefinitionId: procDefId,
        errors,
      };
    });

    const validRows = revalidated.filter((r) => r.errors.length === 0);
    const invalidRows = revalidated.filter((r) => r.errors.length > 0);

    setImportReview({
      rows: revalidated,
      totalRows: revalidated.length,
      validRows,
      invalidRows,
    });
  };

  const confirmImport = () => {
    if (!importReview || importReview.validRows.length === 0) return;

    for (const vr of importReview.validRows) {
      // Nếu thiết bị chưa có trên ma trận thì thêm vào
      const existsOnMatrix = rows.some((r) => r.asset.code === vr.assetCode);
      if (!existsOnMatrix && onAddAsset) {
        onAddAsset(vr.assetCode);
      }

      mutate(vr.assetCode, (prevDraft) => {
        const nextFreqs = new Set(prevDraft.frequencies);
        const nextDates = new Map(prevDraft.startDates);

        for (const f of vr.frequencies) {
          nextFreqs.add(f);
          if (vr.startDate) {
            nextDates.set(f, vr.startDate);
          } else if (!nextDates.has(f)) {
            nextDates.set(f, defaultStartDate());
          }
        }

        return {
          ...prevDraft,
          frequencies: nextFreqs,
          startDates: nextDates,
          priority: vr.priority,
          procedureDefinitionId: vr.procedureDefinitionId ?? prevDraft.procedureDefinitionId,
        };
      });
    }

    alert(
      `Đã nạp thành công dữ liệu của ${importReview.validRows.length} thiết bị vào ma trận nháp. Hãy kiểm tra lại và nhấn "Lưu thay đổi" để áp dụng lên máy chủ.`,
    );
    setImportReview(null);
  };

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
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.templateButton}
            onClick={downloadImportTemplate}
            title="Tải tệp Excel mẫu để chuẩn bị dữ liệu nhập ma trận"
          >
            <Download size={15} strokeWidth={2} /> Tải mẫu Excel
          </button>
          {canManage ? (
            <>
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,.xls"
                className={styles.hiddenInput}
                onChange={importMatrix}
              />
              <button
                type="button"
                className={styles.importButton}
                onClick={() => importInputRef.current?.click()}
                disabled={busy}
                title="Nhập dữ liệu ma trận bảo trì từ tệp Excel"
              >
                <Upload size={15} strokeWidth={2} /> Nhập Excel
              </button>
              <button
                type="button"
                className={styles.save}
                onClick={save}
                disabled={busy || !dirty}
                title={dirty ? undefined : 'Chưa có thay đổi nào để lưu.'}
              >
                Lưu thay đổi
              </button>
            </>
          ) : null}
        </div>
      </header>

      {/* MODAL KIỂM TRA DỮ LIỆU NHẬP EXCEL */}
      {importReview ? (
        <MinimalPopupForm
          title="Kiểm tra dữ liệu nhập Excel"
          isOpen={true}
          maxWidth="92vw"
          popupClassName={styles.importReviewWrapper}
          onClose={() => setImportReview(null)}
        >
          <div className={styles.importReview}>
            <p className={styles.importNotice}>
              Vui lòng rà soát lại các dòng dữ liệu bên dưới. Nếu có ô thông tin trống hoặc bị lỗi, bạn có thể chọn trực tiếp từ danh sách chọn (Select box) trước khi xác nhận nạp vào ma trận.
            </p>

            <div className={styles.importTableWrap}>
              <table className={styles.importTable}>
                <thead>
                  <tr>
                    <th style={{ width: '50px' }}>Dòng</th>
                    <th style={{ width: '220px' }}>Thiết bị</th>
                    <th style={{ width: '150px' }}>Chu kỳ</th>
                    <th style={{ width: '130px' }}>Ngày bắt đầu</th>
                    <th style={{ width: '210px' }}>Quy trình</th>
                    <th style={{ width: '120px' }}>Ưu tiên</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {importReview.rows.map((r, idx) => {
                    const isErr = r.errors.length > 0;
                    return (
                      <tr key={idx} className={isErr ? styles.importRowError : undefined}>
                        <td><strong>#{r.rowNumber}</strong></td>
                        <td className={styles.importSelectCell}>
                          <SearchableSelect
                            options={assetImportOptions}
                            value={r.assetCode}
                            placeholder="Chọn thiết bị…"
                            onChange={(val) => {
                              const found = assetImportOptions.find((o) => o.value === val);
                              updateImportCell(idx, 'assetCode', val);
                              if (found) updateImportCell(idx, 'assetName', found.description);
                            }}
                          />
                        </td>
                        <td className={styles.importSelectCell}>
                          <SearchableSelect
                            options={frequencyImportOptions}
                            value={r.frequencies[0] ?? ''}
                            placeholder="Chọn chu kỳ…"
                            onChange={(val) => {
                              if (val) {
                                updateImportCell(idx, 'frequencies', [val as MaintenanceFrequency]);
                              }
                            }}
                          />
                        </td>
                        <td>
                          <input
                            type="date"
                            className={styles.importInput}
                            value={r.startDate ?? ''}
                            onChange={(e) => updateImportCell(idx, 'startDate', e.target.value)}
                          />
                        </td>
                        <td className={styles.importSelectCell}>
                          <SearchableSelect
                            options={procedureImportOptions}
                            value={r.procedureCode ?? ''}
                            placeholder="Chọn quy trình…"
                            onChange={(val) => {
                              updateImportCell(idx, 'procedureCode', val);
                              const match = matrix.procedureCatalog?.find((p) => p.code === val);
                              updateImportCell(idx, 'procedureDefinitionId', match?.definitionId);
                            }}
                          />
                        </td>
                        <td className={styles.importSelectCell}>
                          <SearchableSelect
                            options={priorityImportOptions}
                            value={r.priority}
                            clearable={false}
                            onChange={(val) => {
                              updateImportCell(idx, 'priority', (val as MaintenancePriority) || 'Normal');
                            }}
                          />
                        </td>
                        <td>
                          {isErr ? (
                            <span className={styles.importErrorBadge} title={r.errors.join('; ')}>
                              Lỗi: {r.errors.join(', ')}
                            </span>
                          ) : (
                            <span className={styles.importReadyBadge}>Hợp lệ</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className={styles.importActions}>
              <button
                type="button"
                className={styles.cancelActionBtn}
                onClick={() => setImportReview(null)}
              >
                Đóng
              </button>
              <button
                type="button"
                className={styles.confirmActionBtn}
                onClick={confirmImport}
                disabled={importReview.validRows.length === 0}
              >
                Xác nhận ({importReview.validRows.length}/{importReview.totalRows} dòng)
              </button>
            </div>
          </div>
        </MinimalPopupForm>
      ) : null}

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

            {/* 1.2. Thêm thiết bị từ Kho (SearchableSelect Combobox chuẩn) */}
            {canManage && onAddAsset ? (
              <div className={styles.suggestWrapper}>
                <SearchableSelect
                  options={addAssetOptions}
                  value=""
                  placeholder="Thêm thiết bị từ Kho…"
                  emptyText="Không tìm thấy thiết bị phù hợp"
                  clearable={false}
                  disabled={busy || addAssetOptions.length === 0}
                  onChange={(val: string) => {
                    if (val) {
                      setNewlyAddedAssetCode(val);
                      setCurrentPage(1);
                      onAddAsset(val);
                    }
                  }}
                />
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
              const isNewlyAdded = newlyAddedAssetCode === row.asset.code;
              const rowClassName = [
                isDrawerActive ? styles.rowActive : undefined,
                isNewlyAdded ? styles.rowHighlighted : undefined,
              ]
                .filter(Boolean)
                .join(' ') || undefined;

              return (
                <tr
                  key={row.asset.code}
                  className={rowClassName}
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
                        placement="top"
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
