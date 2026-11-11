'use client';

import type {
  MaintenanceFrequency,
  MaintenanceHistoryPage,
  MaintenanceMatrix,
  MaintenanceMatrixAsset,
  MaintenanceMatrixRow,
  MaintenancePriority,
} from '@enterprise-platform/contracts-maintenance';
import { MinimalPopupForm, SearchableSelect, formatDate } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import {
  Download,
  FileText,
  History,
  ListFilter,
  Search,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { excelSerialToIsoDate } from './matrix-import';
import { loadAssetTasks, loadMaintenanceHistory, type AssetTaskList } from '../maintenance-api';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Tip } from '../ui/tooltip';
import { cn } from '../utils';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { SELECT_CLASS } from '../ui/select-class';
import styles from './maintenance-matrix.module.scss';

/**
 * SearchableSelect cao 36px (h-9), chữ 14px, bo md. Module CSS của shared-ui dùng `!important` nên cần biến thể
 * `!` của Tailwind (layer có `!important` thắng khi không có layer).
 */
const CONTROL_36 = 'h-9 rounded-md px-3 text-sm';


const PRIORITY_FILTER_OPTIONS = [
  { value: 'High', label: 'Cao' },
  { value: 'Normal', label: 'Thường' },
  { value: 'Low', label: 'Thấp' },
] as const;

const PAGE_SIZE_OPTIONS = [15, 30, 45, 60].map((n) => ({ value: String(n), label: `${n} / trang` }));

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
  /** Trống nghĩa là file không nêu ưu tiên: giữ nguyên ưu tiên hiện có của thiết bị. */
  priority?: MaintenancePriority;
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
  /** Người phụ trách (id người dùng); rỗng là chưa giao. Phiếu định kỳ sinh ra được giao cho người này. */
  assigneeId: string;
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
    assigneeId: row.assigneeId ?? '',
  };
}

/** Hai bản nháp giống nhau về những thứ người dùng chỉnh được (ngày bắt đầu chỉ có nghĩa kèm ô vừa tick). */
function sameDraft(left: Draft, right: Draft): boolean {
  if (left.procedureDefinitionId !== right.procedureDefinitionId) return false;
  if (left.priority !== right.priority) return false;
  if (left.assigneeId !== right.assigneeId) return false;
  if (left.frequencies.size !== right.frequencies.size) return false;
  return [...left.frequencies].every((frequency) => right.frequencies.has(frequency));
}

function formatDue(value?: string): string {
  if (!value) return '';
  return formatDate(value);
}

/** Danh sách thiết bị sẽ bị tác động, hiện trong hộp thoại xác nhận (cuộn khi dài). */
function SelectedAssetList({ rows }: { rows: readonly MaintenanceMatrixRow[] }) {
  return (
    <ul className="m-0 max-h-48 list-none overflow-y-auto rounded-md border border-border bg-slate-50 p-0">
      {rows.map((entry) => (
        <li
          key={entry.asset.code}
          className="flex items-baseline gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0"
        >
          <span className="font-mono text-[0.8125rem] font-semibold text-slate-700">{entry.asset.code}</span>
          <span className="min-w-0 truncate text-slate-900">{entry.asset.name}</span>
        </li>
      ))}
    </ul>
  );
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
  members,
  onDirtyChange,
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
  onAddAsset?: (assetCode: string) => void | Promise<void>;
  /** Danh sách người có thể giao phụ trách (thành viên tenant). */
  members?: readonly { userId: string; displayName: string }[];
  /** Báo cho màn hình cha biết đang có thay đổi chưa lưu, để cảnh báo trước khi chuyển màn. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Gỡ thiết bị khỏi ma trận: lưu trữ lịch của nó, giữ lịch sử phiếu. */
  onRemoveAsset?: (assetCodes: readonly string[]) => void | Promise<void>;
  /** Tạo phiếu bảo trì ngay cho thiết bị. */
  onRunNow?: (assetCodes: readonly string[]) => void | Promise<void>;
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

  // Chọn thiết bị trong bảng để thao tác hàng loạt (Bảo trì ngay / Gỡ); mỗi thao tác hỏi lại bằng hộp thoại xác nhận.
  const [selectedCodes, setSelectedCodes] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<'run' | 'remove'>();
  const [bulkRunning, setBulkRunning] = useState(false);

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
  const unitFilterOptions = useMemo(
    () => availableUnits.map(([id, name]) => ({ value: id, label: name })),
    [availableUnits],
  );
  const rowPriorityOptions = useMemo(
    () =>
      (Object.entries(PRIORITY_LABEL) as [MaintenancePriority, string][]).map(([value, label]) => ({
        value,
        label,
      })),
    [],
  );
  const flowOptions = useMemo(
    () => [
      { value: '', label: '— Chưa gắn —' },
      ...(matrix.procedureCatalog ?? []).map((entry) => ({
        value: entry.definitionId,
        label: `${entry.code} — ${entry.name}`,
      })),
    ],
    [matrix.procedureCatalog],
  );

  // Nạp lại ma trận (thêm thiết bị, Bảo trì ngay, Gỡ...) KHÔNG được xoá thay đổi chưa lưu: hàng nào người dùng đã sửa so với
  // bản server trước đó thì giữ nguyên bản nháp; chỉ hàng chưa sửa mới lấy dữ liệu mới.
  const previousRowsRef = useRef<ReadonlyMap<string, MaintenanceMatrixRow>>(new Map());
  useEffect(() => {
    const previous = previousRowsRef.current;
    setDrafts((current) => {
      const next = new Map<string, Draft>();
      for (const row of rows) {
        const code = row.asset.code;
        const draft = current.get(code);
        const before = previous.get(code);
        const edited = draft !== undefined && before !== undefined && !sameDraft(draft, toDraft(before, frequencies));
        next.set(code, edited ? draft : toDraft(row, frequencies));
      }
      return next;
    });
    previousRowsRef.current = new Map(rows.map((row) => [row.asset.code, row]));
  }, [rows]);

  const dirty = useMemo(() => {
    return rows.some((row) => {
      const draft = drafts.get(row.asset.code);
      if (!draft) return false;
      return !sameDraft(draft, toDraft(row, frequencies));
    });
  }, [drafts, rows]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  // Đóng tab, tải lại trang khi còn thay đổi chưa lưu: hỏi lại.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

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
          assigneeId: draft.assigneeId || null,
          assigneeName: members?.find((member) => member.userId === draft.assigneeId)?.displayName ?? null,
        };
      }),
    );

  const importInputRef = useRef<HTMLInputElement>(null);
  const [importReview, setImportReviewState] = useState<MatrixImportReview | null>(null);
  // Ref giữ bản mới nhất: một lần chọn có thể gọi updateImportCell hai lần liên tiếp (thiết bị rồi tên thiết bị), lần hai
  // phải thấy kết quả lần một chứ không phải state cũ của lần render trước.
  const importReviewRef = useRef<MatrixImportReview | null>(null);
  const setImportReview = (review: MatrixImportReview | null) => {
    importReviewRef.current = review;
    setImportReviewState(review);
  };
  /** Thiết bị mới từ file đang được thêm vào ma trận; áp dữ liệu nhập khi hàng của chúng xuất hiện. */
  const [pendingImport, setPendingImport] = useState<MatrixImportRow[]>([]);
  const [importNotice, setImportNotice] = useState<string>();

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

  const assigneeOptions = useMemo(
    () => (members ?? []).map((member) => ({ value: member.userId, label: member.displayName })),
    [members],
  );

  const priorityImportOptions = useMemo(() => {
    return [
      { value: '', label: 'Giữ nguyên' },
      ...(Object.entries(PRIORITY_LABEL) as [MaintenancePriority, string][]).map(([val, lbl]) => ({
        value: val,
        label: lbl,
      })),
    ];
  }, []);

  const downloadImportTemplate = () => {
    const sampleRows = [
      {
        'Mã thiết bị': rows[0]?.asset.code ?? 'MBA-01',
        'Tần suất': frequencies.map((f) => f.label).slice(0, 2).join(', '),
        'Ngày bắt đầu': formatDate(defaultStartDate()),
        'Mã quy trình': matrix.procedureCatalog?.[0]?.code ?? '',
        'Mức ưu tiên': 'Cao',
      },
      {
        'Mã thiết bị': rows[1]?.asset.code ?? 'MC-901',
        'Tần suất': frequencies[0]?.label ?? 'Tháng',
        'Ngày bắt đầu': formatDate(defaultStartDate()),
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
      ['Ngày bắt đầu', 'Không', 'Định dạng DD/MM/YYYY (cũng nhận YYYY-MM-DD). Bỏ trống sẽ dùng mặc định +7 ngày'],
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
          const startCell = item['Ngày bắt đầu'] || item['Ngay bat dau'] || item['Bắt đầu'] || item['Bat dau'] || '';
          // Ô ngày của Excel đọc ra là số serial (ngày kể từ 30/12/1899), không phải chuỗi: đổi thẳng, nếu không
          // new Date('46371') cho ra năm 46370.
          const rawStart = excelSerialToIsoDate(startCell) ?? String(startCell).trim();
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
          // File không nêu ưu tiên thì để trống (giữ nguyên ưu tiên hiện có), không ép về "Thường".
          let priority: MaintenancePriority | undefined = undefined;
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
    const current = importReviewRef.current ?? importReview;
    if (!current) return;
    const updatedRows = [...current.rows];
    const currentRow = { ...updatedRows[index], [field]: value };
    updatedRows[index] = currentRow;

    revalidateImport(updatedRows);
  };

  const revalidateImport = (sourceRows?: MatrixImportRow[]) => {
    const baseRows = sourceRows ?? importReviewRef.current?.rows ?? importReview?.rows ?? [];
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

  /** Áp một dòng nhập vào bản nháp của thiết bị (thiết bị phải đã có hàng trên ma trận). */
  const applyImportRow = (vr: MatrixImportRow) =>
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
        priority: vr.priority ?? prevDraft.priority,
        procedureDefinitionId: vr.procedureDefinitionId ?? prevDraft.procedureDefinitionId,
      };
    });

  // Thiết bị mới từ file: sau khi hàng của chúng xuất hiện (đã thêm vào ma trận và nạp lại) mới áp dữ liệu nhập.
  useEffect(() => {
    if (pendingImport.length === 0) return;
    const present = new Set(rows.map((row) => row.asset.code));
    const ready = pendingImport.filter((vr) => present.has(vr.assetCode));
    if (ready.length === 0) return;
    ready.forEach(applyImportRow);
    setPendingImport((current) => current.filter((vr) => !present.has(vr.assetCode)));
  }, [rows, pendingImport]);

  const confirmImport = async () => {
    if (!importReview || importReview.validRows.length === 0) return;
    const valid = importReview.validRows;
    const onMatrix = new Set(rows.map((row) => row.asset.code));

    // Thiết bị đã có trên ma trận: áp ngay. Thiết bị mới: thêm vào ma trận trước, áp khi hàng của chúng xuất hiện.
    const existing = valid.filter((vr) => onMatrix.has(vr.assetCode));
    const fresh = valid.filter((vr) => !onMatrix.has(vr.assetCode));
    existing.forEach(applyImportRow);
    setImportReview(null);

    if (fresh.length > 0 && onAddAsset) {
      setPendingImport((current) => [...current, ...fresh]);
      await Promise.allSettled([...new Set(fresh.map((vr) => vr.assetCode))].map((code) => onAddAsset(code)));
    }

    const added = fresh.length > 0 && !onAddAsset ? existing.length : valid.length;
    setImportNotice(
      `Đã nạp ${added}/${valid.length} dòng vào ma trận nháp${importReview.invalidRows.length ? `, bỏ qua ${importReview.invalidRows.length} dòng lỗi` : ''}. Kiểm tra lại rồi nhấn "Lưu thay đổi" để áp dụng.`,
    );
  };

  /** Tính toán phân trang */
  const totalRecords = orderedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  /** Các thiết bị đang được chọn mà vẫn còn trên ma trận (sau khi gỡ hoặc lọc lại thì tự bỏ mã không còn). */
  const selectedRows = useMemo(
    () => rows.filter((entry) => selectedCodes.has(entry.asset.code)),
    [rows, selectedCodes],
  );
  const toggleCode = (code: string) =>
    setSelectedCodes((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  const runBulk = async () => {
    const action = confirming;
    if (!action) return;
    const handler = action === 'run' ? onRunNow : onRemoveAsset;
    if (!handler) return;
    setBulkRunning(true);
    try {
      // Một lần gọi cho cả lô: màn hình cha chạy song song có giới hạn rồi nạp lại đúng một lần.
      await handler(selectedRows.map((entry) => entry.asset.code));
      if (action === 'remove') setSelectedCodes(new Set());
    } finally {
      setBulkRunning(false);
      setConfirming(undefined);
    }
  };

  const paginatedRows = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return orderedRows.slice(start, start + pageSize);
  }, [orderedRows, safeCurrentPage, pageSize]);
  const allPageSelected =
    paginatedRows.length > 0 && paginatedRows.every(({ row }) => selectedCodes.has(row.asset.code));
  const somePageSelected =
    !allPageSelected && paginatedRows.some(({ row }) => selectedCodes.has(row.asset.code));
  const activeFilterCount = (filterUnit ? 1 : 0) + (filterPriority ? 1 : 0);

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
          <Tip content="Tải tệp Excel mẫu để chuẩn bị dữ liệu nhập ma trận">
            <Button
              type="button"
              variant="outline"
              className={CONTROL_36}
              onClick={downloadImportTemplate}
            >
              <Download size={15} strokeWidth={2} /> Tải mẫu Excel
            </Button>
          </Tip>
          {canManage ? (
            <>
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={importMatrix}
              />
              <Tip content="Nhập dữ liệu ma trận bảo trì từ tệp Excel">
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="outline"
                    className={CONTROL_36}
                    onClick={() => importInputRef.current?.click()}
                    disabled={busy}
                  >
                    <Upload size={15} strokeWidth={2} /> Nhập Excel
                  </Button>
                </span>
              </Tip>
              <Tip content={dirty ? undefined : 'Chưa có thay đổi nào để lưu.'}>
                <span className="inline-flex">
                  <Button
                    type="button"
                    className={CONTROL_36}
                    onClick={save}
                    disabled={busy || !dirty}
                  >
                    Lưu thay đổi
                  </Button>
                </span>
              </Tip>
            </>
          ) : null}
        </div>
      </header>

      {importNotice ? (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          <span>{importNotice}</span>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-sm font-medium text-emerald-800 underline"
            onClick={() => setImportNotice(undefined)}
          >
            Đóng
          </button>
        </div>
      ) : null}

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
                          <div className={styles.importPicker}>
                            <DatePickerInput
                              value={r.startDate ?? ''}
                              height={30}
                              onChange={(val) => updateImportCell(idx, 'startDate', val)}
                            />
                          </div>
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
                            value={r.priority ?? ''}
                            clearable={false}
                            onChange={(val) => {
                              updateImportCell(idx, 'priority', (val as MaintenancePriority) || undefined);
                            }}
                          />
                        </td>
                        <td>
                          {isErr ? (
                            <Tip content={r.errors.join('; ')}>
                              <span className={styles.importErrorBadge}>
                                Lỗi: {r.errors.join(', ')}
                              </span>
                            </Tip>
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
                onClick={() => void confirmImport()}
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
      <div className="w-full overflow-hidden rounded-lg border border-border bg-white shadow-xs">
        {/* VÙNG 1: HEADER CONTROLS (TÌM KIẾM + BỘ LỌC + THÊM THIẾT BỊ + XOÁ LỌC) */}
        <div className="border-b border-border bg-slate-50 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* 1.1. Tìm kiếm trên ma trận */}
            <div className="relative min-w-[200px] max-w-[360px] flex-[1_1_240px]">
              <Search
                size={14}
                strokeWidth={2}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
              />
              <Input
                className="h-9 rounded-md pr-3 pl-8 text-sm"
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
              <div className="min-w-[200px] max-w-[380px] flex-[1_1_260px]">
                <SearchableSelect
                  className={SELECT_CLASS}
                  height={36}
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

            {/* 1.3. Bộ lọc gom trong một nút: đơn vị phụ trách và mức ưu tiên */}
            <Popover>
              <PopoverTrigger
                render={
                  <Button variant="outline" className={cn(CONTROL_36, 'gap-1.5')} aria-label="Bộ lọc" />
                }
              >
                <ListFilter />
                Bộ lọc
                {activeFilterCount > 0 ? (
                  <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-semibold text-white">
                    {activeFilterCount}
                  </span>
                ) : null}
              </PopoverTrigger>
              <PopoverContent className="w-72">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-slate-700">Đơn vị phụ trách</span>
                    <SearchableSelect
                      className={SELECT_CLASS}
                      height={36}
                      searchInDropdown
                      options={unitFilterOptions}
                      value={filterUnit}
                      placeholder="Tất cả đơn vị"
                      onChange={(val) => {
                        setFilterUnit(val);
                        setCurrentPage(1);
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-slate-700">Mức ưu tiên</span>
                    <SearchableSelect
                      className={SELECT_CLASS}
                      height={36}
                      searchInDropdown
                      hideDropdownSearch
                      options={PRIORITY_FILTER_OPTIONS}
                      value={filterPriority}
                      placeholder="Mọi mức ưu tiên"
                      onChange={(val) => {
                        setFilterPriority(val);
                        setCurrentPage(1);
                      }}
                    />
                  </div>
                  <div className="flex justify-end border-t border-border pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      className={CONTROL_36}
                      disabled={!filterText && activeFilterCount === 0}
                      onClick={() => {
                        setFilterText('');
                        setFilterUnit('');
                        setFilterPriority('');
                        setCurrentPage(1);
                      }}
                    >
                      Xoá bộ lọc
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* 1.4. Thao tác hàng loạt: nằm cùng hàng nhưng dạt sang phải; chỉ dùng được khi đã tick thiết bị */}
            <div className="ml-auto flex items-center gap-2">
              <Tip
                content={
                  selectedRows.length === 0
                    ? 'Tick chọn thiết bị trong bảng trước.'
                    : 'Tạo phiếu bảo trì ngay cho các thiết bị đã chọn, không chờ tới hạn'
                }
              >
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="outline"
                    className={CONTROL_36}
                    disabled={!canManage || busy || !onRunNow || selectedRows.length === 0}
                    onClick={() => setConfirming('run')}
                  >
                    Bảo trì ngay{selectedRows.length > 0 ? ` (${selectedRows.length})` : ''}
                  </Button>
                </span>
              </Tip>
              <Tip
                content={
                  selectedRows.length === 0
                    ? 'Tick chọn thiết bị trong bảng trước.'
                    : 'Gỡ các thiết bị đã chọn khỏi ma trận và xoá mọi lịch của chúng'
                }
              >
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="destructive"
                    className={CONTROL_36}
                    disabled={!canManage || busy || !onRemoveAsset || selectedRows.length === 0}
                    onClick={() => setConfirming('remove')}
                  >
                    Gỡ{selectedRows.length > 0 ? ` (${selectedRows.length})` : ''}
                  </Button>
                </span>
              </Tip>
            </div>
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[1080px] table-fixed border-collapse text-sm">
            <thead>
              {/* HÀNG TIÊU ĐỀ CỘT */}
              <tr className="[&>th]:border-b [&>th]:border-slate-300 [&>th]:bg-[#e9eef5] [&>th]:px-2.5 [&>th]:py-2.5 [&>th]:text-left [&>th]:text-[0.8125rem] [&>th]:font-bold [&>th]:whitespace-nowrap [&>th]:text-slate-700">
                <th className="w-[44px] text-center!">
                  <Checkbox
                    aria-label="Chọn tất cả thiết bị trong trang"
                    checked={allPageSelected}
                    indeterminate={somePageSelected}
                    disabled={!canManage || busy || paginatedRows.length === 0}
                    onCheckedChange={(checked) =>
                      setSelectedCodes((current) => {
                        const next = new Set(current);
                        for (const { row } of paginatedRows) {
                          if (checked) next.add(row.asset.code);
                          else next.delete(row.asset.code);
                        }
                        return next;
                      })
                    }
                  />
                </th>
                <th className="w-[170px]">Thiết bị</th>
                <th className="w-[130px]">Đơn vị phụ trách</th>
                <th className="w-[170px]">Người phụ trách</th>
                <th className="w-[110px]">Ưu tiên</th>
                {frequencies.map((entry) => (
                  <th key={entry.id} className="w-[88px] text-center!">
                    {entry.label}
                  </th>
                ))}
                <th>Luồng thực thi khi tạo lệnh</th>
              </tr>
            </thead>

            {/* VÙNG 2: THÂN BẢNG (BODY LIST + ROW ACTIONS) */}
            <tbody className="[&>tr>td]:border-b [&>tr>td]:border-slate-100 [&>tr>td]:px-2.5 [&>tr>td]:py-2 [&>tr>td]:align-middle">
              {paginatedRows.map(({ row }) => {
                const draft = drafts.get(row.asset.code) ?? toDraft(row, frequencies);
                const isDrawerActive = activeDrawer?.asset.code === row.asset.code;
                const isNewlyAdded = newlyAddedAssetCode === row.asset.code;
                const rowClassName =
                  [
                    isDrawerActive ? styles.rowActive : undefined,
                    isNewlyAdded ? styles.rowHighlighted : undefined,
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined;

                return (
                  <tr
                    key={row.asset.code}
                    className={cn(
                      'hover:bg-slate-50/70',
                      rowClassName,
                      selectedCodes.has(row.asset.code) && 'bg-blue-50/60 hover:bg-blue-50/80',
                    )}
                  >
                    <td className="text-center">
                      <Checkbox
                        aria-label={`Chọn ${row.asset.name}`}
                        checked={selectedCodes.has(row.asset.code)}
                        disabled={!canManage || busy}
                        onCheckedChange={() => toggleCode(row.asset.code)}
                      />
                    </td>
                    {/* Cột 1: Tên thiết bị - Click để mở Drawer chi tiết */}
                    <td>
                      <Tip content="Nhấn để xem chi tiết Đầu việc (Kho) và Lịch sử bảo trì">
                        <button
                          type="button"
                          className="group block w-full cursor-pointer rounded-sm border-0 bg-transparent p-0 text-left"
                          onClick={() =>
                            setActiveDrawer({
                              asset: row.asset,
                              tab: 'tasks',
                            })
                          }
                        >
                          <span className="block min-w-0 overflow-hidden">
                            <strong className="block truncate text-sm leading-tight font-semibold text-slate-900 group-hover:text-primary group-hover:underline">
                              {row.asset.name}
                            </strong>
                            <small className="block truncate font-mono text-xs text-muted-foreground">
                              {row.asset.code}
                            </small>
                          </span>
                        </button>
                      </Tip>
                    </td>
                    <td className="truncate text-sm text-slate-700">
                      {row.asset.orgUnitId ? (unitNames?.get(row.asset.orgUnitId) ?? '—') : '—'}
                    </td>
                    <td>
                      <SearchableSelect
                        className={SELECT_CLASS}
                        height={36}
                        searchInDropdown
                        clearable
                        options={assigneeOptions}
                        value={draft.assigneeId}
                        placeholder="— Chưa giao —"
                        disabled={!canManage || busy}
                        onChange={(val) =>
                          mutate(row.asset.code, (current) => ({
                            ...current,
                            assigneeId: val,
                          }))
                        }
                      />
                    </td>
                    <td>
                      <SearchableSelect
                        className={SELECT_CLASS}
                        height={36}
                        searchInDropdown
                        hideDropdownSearch
                        clearable={false}
                        options={rowPriorityOptions}
                        value={draft.priority}
                        disabled={!canManage || busy}
                        onChange={(val) =>
                          mutate(row.asset.code, (current) => ({
                            ...current,
                            priority: val as MaintenancePriority,
                          }))
                        }
                      />
                    </td>

                    {frequencies.map((entry) => {
                      const checked = draft.frequencies.has(entry.id);
                      return (
                        <td key={entry.id} className={cn('text-center', checked && 'bg-blue-50/70')}>
                          {/* Giữ chiều cao cố định (checkbox + ô ngày) để tích/bỏ tích không làm hàng giật. */}
                          <div className="flex h-12 flex-col items-center gap-1">
                            <Checkbox
                              checked={checked}
                              disabled={!canManage || busy}
                              aria-label={`${row.asset.name} — ${entry.label}`}
                              onCheckedChange={() => toggle(row.asset.code, entry.id)}
                            />
                            {checked && row.cells[entry.id]?.nextDueAt ? (
                              <span className="text-xs font-semibold whitespace-nowrap text-blue-800 tabular-nums">
                                {formatDue(row.cells[entry.id]?.nextDueAt)}
                              </span>
                            ) : checked ? (
                              <Tip content="Ngày bảo trì kế tiếp. Mặc định gợi ý một tuần nữa, không phải hôm nay.">
                                <div
                                  className={styles.duePicker}
                                  role="group"
                                  aria-label={`Ngày bảo trì kế tiếp — ${row.asset.name} — ${entry.label}`}
                                >
                                  <DatePickerInput
                                    value={draft.startDates.get(entry.id) ?? defaultStartDate()}
                                    disabled={!canManage || busy}
                                    height={28}
                                    allowClear={false}
                                    onChange={(val) =>
                                      setStartDate(row.asset.code, entry.id, val || defaultStartDate())
                                    }
                                  />
                                </div>
                              </Tip>
                            ) : null}
                          </div>
                        </td>
                      );
                    })}

                    <td>
                      <SearchableSelect
                        className={SELECT_CLASS}
                        height={36}
                        searchInDropdown
                        clearable={false}
                        options={flowOptions}
                        value={draft.procedureDefinitionId}
                        disabled={!canManage || busy}
                        onChange={(val) =>
                          mutate(row.asset.code, (current) => ({
                            ...current,
                            procedureDefinitionId: val,
                          }))
                        }
                      />
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={frequencies.length + 5} className="px-4 py-12 text-center text-muted-foreground">
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-slate-50 px-3.5 py-2.5 text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Hiển thị{' '}
              <strong className="text-foreground">
                {totalRecords > 0 ? (safeCurrentPage - 1) * pageSize + 1 : 0}–
                {Math.min(safeCurrentPage * pageSize, totalRecords)}
              </strong>{' '}
              / <strong className="text-foreground">{totalRecords}</strong> thiết bị
            </span>
            <div className="flex items-center gap-1.5">
              <span>Hiển thị:</span>
              <div className="w-[120px]">
                <SearchableSelect
                  className={SELECT_CLASS}
                  height={36}
                  searchInDropdown
                  hideDropdownSearch
                  clearable={false}
                  options={PAGE_SIZE_OPTIONS}
                  value={String(pageSize)}
                  onChange={(val) => {
                    setPageSize(Number(val) || 15);
                    setCurrentPage(1);
                  }}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Tip content="Trang trước">
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  ← Trước
                </Button>
              </span>
            </Tip>
            <span className="px-1 text-sm font-bold text-foreground tabular-nums">
              {safeCurrentPage} / {totalPages}
            </span>
            <Tip content="Trang sau">
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  Sau →
                </Button>
              </span>
            </Tip>
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
                                ? `Hoàn tất: ${formatDate(occ.completedAt)}`
                                : `Hạn xử lý: ${formatDate(occ.dueAt)}`}
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
      {/* Hộp thoại xác nhận cho từng thao tác hàng loạt (thay Popconfirm cũ) */}
      <ConfirmDialog
        open={confirming === 'run'}
        onOpenChange={(open) => setConfirming(open ? 'run' : undefined)}
        title={`Tạo phiếu bảo trì ngay cho ${selectedRows.length} thiết bị?`}
        description="Hệ thống sẽ sinh phiếu bảo trì ngay lập tức cho các thiết bị đã chọn, không chờ tới hạn của lịch định kỳ."
        confirmText="Tạo phiếu"
        busy={bulkRunning}
        onConfirm={() => void runBulk()}
      >
        <SelectedAssetList rows={selectedRows} />
      </ConfirmDialog>
      <ConfirmDialog
        open={confirming === 'remove'}
        onOpenChange={(open) => setConfirming(open ? 'remove' : undefined)}
        title={`Gỡ ${selectedRows.length} thiết bị khỏi ma trận?`}
        description="Các thiết bị đã chọn sẽ bị gỡ khỏi ma trận và ngừng sinh phiếu định kỳ. Lịch sử phiếu và tệp đính kèm đã có vẫn được giữ trong mục Lịch sử; thêm lại thiết bị từ Kho khi cần."
        confirmText="Gỡ thiết bị"
        destructive
        busy={bulkRunning}
        onConfirm={() => void runBulk()}
      >
        <SelectedAssetList rows={selectedRows} />
      </ConfirmDialog>
    </section>
  );
}
