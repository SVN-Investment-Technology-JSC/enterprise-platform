'use client';

import {
  BUILT_IN_SLOT_GROUPS,
  SLOT_OVERRIDE_FIELDS,
  type SlotOverrideField,
  ICON_SLOTS,
  isValidSlotId,
  isBuiltInSlotId,
  type BrandSlotAssignment,
  type BrandSlotGroup,
  type BrandSvgMode,
  type IconDocument,
  type IconSlotId,
  type IconSlotMeta,
  type UpdateBrandSlotRequest,
} from '@enterprise-platform/shared-brand-icon';
import {
  SearchableSelect,
  notifyBrandSlotsChanged,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import {
  AlertTriangle,
  LayoutGrid,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SearchX,
  SlidersHorizontal,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Hint } from '../components/hint';
import { Panel, RAISED } from '../components/panel';
import { useFillViewportHeight } from '../components/use-fill-viewport';
import { useMediaQuery } from '../components/use-media-query';
import { IconSvg } from '../icon-svg';
import { foldText } from '../library/library-filters';
import { IconButton } from '../library/library-ui';
import { LibraryPagerBar } from '../library/library-pager-bar';
import { pageAfterSizeChange, paginate } from '../library/library-pager';
import { useBrandSettings, useIconLibrary } from '../store';
import { SlotDialogFrame, SlotField } from './slot-dialog-frame';
import { SlotGroupSelect } from './slot-group-select';
import { SlotGroupsDialog } from './slot-groups-dialog';
import {
  assignSlot,
  clearSlot,
  createCustomSlot,
  deleteCustomSlot,
  errorMessage,
  listSlotGroups,
  listSlots,
  resetSlotOverride,
  updateCustomSlot,
} from '../store/brand-api';

/** Danh sách dạng dòng nên dùng cỡ trang tròn chục (lưới icon dùng bội của 12 cho khớp số cột). */
const SLOT_PAGE_SIZES: readonly number[] = [10, 20, 50];

type GroupFilter = string;
type StatusFilter = 'all' | 'assigned' | 'default';

const DEFAULT_GROUPS: readonly BrandSlotGroup[] = BUILT_IN_SLOT_GROUPS.map((group) => ({
  ...group,
  isBuiltIn: true,
  slotCount: 0,
}));

const STATUS_OPTIONS: readonly SearchableSelectOption[] = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'assigned', label: 'Đã gán' },
  { value: 'default', label: 'Mặc định' },
];

const COLOR_MODE_OPTIONS: readonly SearchableSelectOption[] = [
  { value: 'brand', label: 'Màu thương hiệu / Gradient' },
  { value: 'mono', label: 'Theo ngữ cảnh (currentColor)' },
];

function indexAssignments(slots: readonly BrandSlotAssignment[]): Record<string, BrandSlotAssignment> {
  const map: Record<string, BrandSlotAssignment> = {};
  for (const item of slots) map[item.slot] = item;
  return map;
}

function matchesSlot(
  slot: IconSlotMeta,
  assignment: BrandSlotAssignment | undefined,
  query: string,
  group: GroupFilter,
  status: StatusFilter,
  groupLabels: Readonly<Record<string, string>>,
): boolean {
  if (group !== 'all' && slot.group !== group) return false;
  if (status === 'assigned' && !assignment) return false;
  if (status === 'default' && assignment) return false;
  const tokens = foldText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const groupLabel = groupLabels[slot.group] || slot.group;
  const haystack = foldText([slot.label, slot.id, slot.description, groupLabel].join(' '));
  return tokens.every((token) => haystack.includes(token));
}

const COLOR_MODE_HINT = 'Giữ màu thương hiệu, hoặc lấy theo màu chữ xung quanh (hợp icon nhỏ trong menu).';

/** Dòng chữ một dòng; chỉ khi bị cắt bằng dấu "…" thì rê chuột hay focus mới hiện tooltip đủ nội dung. */
function TruncatedText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [truncated, setTruncated] = useState(false);
  const measure = () => {
    const el = ref.current;
    if (el) setTruncated(el.scrollWidth > el.clientWidth + 1);
  };
  return (
    <Tooltip disabled={!truncated}>
      <TooltipTrigger
        render={
          <p className={cn('truncate', className)} onFocus={measure} onMouseEnter={measure} ref={ref} tabIndex={truncated ? 0 : undefined}>
            {text}
          </p>
        }
      />
      <TooltipContent positionerClassName="z-[10050]">{text}</TooltipContent>
    </Tooltip>
  );
}

function SlotPreview({
  slot,
  assignment,
  doc,
  palette,
}: {
  slot: IconSlotMeta;
  assignment: BrandSlotAssignment | undefined;
  doc: IconDocument | undefined;
  palette: ReturnType<typeof useBrandSettings>['palette'];
}) {
  if (!assignment) {
    return (
      <div
        className="flex h-16 w-[120px] shrink-0 flex-col items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/70 px-2 text-center"
        data-testid={`slot-preview-default-${slot.id}`}
      >
        <span className="text-[11px] font-medium text-slate-400">Mặc định</span>
      </div>
    );
  }

  if (!doc) {
    return (
      <div
        className="flex h-16 w-[120px] shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-amber-200 bg-amber-50/70 px-2 text-center text-amber-700"
        data-testid={`slot-preview-missing-${slot.id}`}
      >
        <AlertTriangle aria-hidden className="size-4" />
        <span className="text-[10px] leading-tight">Không có hình</span>
      </div>
    );
  }

  if (slot.colorMode === 'mono') {
    return (
      <div className="flex w-[120px] shrink-0 items-center gap-2" data-testid={`slot-preview-mono-${slot.id}`}>
        <div className="flex h-16 w-14 flex-col items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-50 text-slate-700">
          <IconSvg className="size-6" colorMode="currentColor" doc={doc} palette={palette} title={`${slot.label} - thường`} />
          <span className="text-[10px] leading-none text-slate-500">Thường</span>
        </div>
        <div className="flex h-16 w-14 flex-col items-center justify-center gap-1 rounded-md border border-blue-600 bg-blue-600 text-white">
          <IconSvg className="size-6" colorMode="currentColor" doc={doc} palette={palette} title={`${slot.label} - nền xanh`} />
          <span className="text-[10px] leading-none text-blue-100">Nền xanh</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-16 w-[120px] shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50"
      data-testid={`slot-preview-brand-${slot.id}`}
    >
      <IconSvg className="size-8" colorMode="brand" doc={doc} palette={palette} title={slot.label} />
    </div>
  );
}

export function SlotsPage() {
  const settings = useBrandSettings();
  const library = useIconLibrary();

  const [definitions, setDefinitions] = useState<readonly IconSlotMeta[]>([...ICON_SLOTS]);
  const [assignments, setAssignments] = useState<Readonly<Record<string, BrandSlotAssignment>>>({});
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [groups, setGroups] = useState<readonly BrandSlotGroup[]>(DEFAULT_GROUPS);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [busySlot, setBusySlot] = useState<IconSlotId | null>(null);

  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Modal tạo vị trí mới
  const [createOpen, setCreateOpen] = useState(false);
  const [createId, setCreateId] = useState('');
  const [createLabel, setCreateLabel] = useState('');
  const [createGroup, setCreateGroup] = useState('custom');
  const [createColorMode, setCreateColorMode] = useState<BrandSvgMode>('brand');
  const [createRecommendedSize, setCreateRecommendedSize] = useState(24);
  const [createDescription, setCreateDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // Modal chỉnh sửa vị trí
  const [editTarget, setEditTarget] = useState<IconSlotMeta | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editGroup, setEditGroup] = useState('custom');
  const [editColorMode, setEditColorMode] = useState<BrandSvgMode>('brand');
  const [editRecommendedSize, setEditRecommendedSize] = useState(24);
  const [editDescription, setEditDescription] = useState('');
  const [editResetting, setEditResetting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Modal xoá vị trí
  const [deleteTarget, setDeleteTarget] = useState<IconSlotMeta | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const loadSlots = useCallback(async () => {
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const response = await listSlots();
      setAssignments(indexAssignments(response.slots));
      if (response.definitions && response.definitions.length > 0) {
        setDefinitions(response.definitions);
      }
      setGroups(response.groups && response.groups.length > 0 ? response.groups : DEFAULT_GROUPS);
    } catch (error) {
      setSlotsError(errorMessage(error, 'Không tải được danh sách vị trí sử dụng.'));
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  const groupLabels = useMemo(() => Object.fromEntries(groups.map((group) => [group.key, group.label])), [groups]);

  const groupFilterOptions = useMemo<readonly SearchableSelectOption[]>(
    () => [{ value: 'all', label: 'Tất cả nhóm' }, ...groups.map((group) => ({ value: group.key, label: group.label }))],
    [groups],
  );

  /** Lấy lại danh sách nhóm (kèm số vị trí) sau khi thêm, sửa, xoá nhóm hoặc vị trí. */
  const refreshGroups = useCallback(async () => {
    try {
      const response = await listSlotGroups();
      setGroups(response.groups);
    } catch {
      // Giữ danh sách nhóm hiện có; lần tải lại sau sẽ cập nhật.
    }
  }, []);

  const handleGroupCreated = useCallback(
    (group: BrandSlotGroup) => {
      setGroups((prev) => (prev.some((item) => item.key === group.key) ? prev : [...prev, group]));
      void refreshGroups();
    },
    [refreshGroups],
  );

  const handleGroupUpdated = useCallback((group: BrandSlotGroup) => {
    setGroups((prev) => prev.map((item) => (item.key === group.key ? group : item)));
  }, []);

  const handleGroupDeleted = useCallback((key: string) => {
    setGroups((prev) => prev.filter((item) => item.key !== key));
    setGroupFilter((current) => (current === key ? 'all' : current));
  }, []);

  const publishedDocs = useMemo(
    () => library.docs.filter((doc) => doc.status === 'published'),
    [library.docs],
  );

  const iconOptions = useMemo<readonly SearchableSelectOption[]>(
    () =>
      publishedDocs.map((doc) => ({
        value: doc.id,
        label: doc.name,
        description: doc.id,
      })),
    [publishedDocs],
  );

  const filteredSlots = useMemo(
    () => definitions.filter((slot) => matchesSlot(slot, assignments[slot.id], query, groupFilter, statusFilter, groupLabels)),
    [definitions, assignments, query, groupFilter, statusFilter, groupLabels],
  );

  // Phân trang: đổi từ khoá hoặc bộ lọc thì về trang 1; trang vượt cuối (xoá bớt vị trí) được paginate kẹp về trang cuối.
  const [pageSize, setPageSize] = useState(SLOT_PAGE_SIZES[0]);
  const [pageNumber, setPageNumber] = useState(1);
  useEffect(() => {
    setPageNumber(1);
  }, [query, groupFilter, statusFilter]);
  const slice = useMemo(() => paginate(filteredSlots, pageNumber, pageSize, SLOT_PAGE_SIZES), [filteredSlots, pageNumber, pageSize]);
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [slice.page, pageSize]);

  const assignedCount = useMemo(
    () => definitions.filter((slot) => Boolean(assignments[slot.id])).length,
    [definitions, assignments],
  );

  const handleAssign = async (slot: IconSlotMeta, iconId: string) => {
    if (!iconId) return;
    setBusySlot(slot.id);
    try {
      if (library.mode === 'server' && !library.serverInfo(iconId)) {
        const doc = library.get(iconId);
        if (doc) await library.save({ ...doc, status: 'published' });
      }
      const updated = await assignSlot(slot.id, iconId);
      setAssignments((prev) => ({ ...prev, [slot.id]: updated }));
      notifyBrandSlotsChanged();
      toast.success(`Đã gán icon "${updated.iconName}" cho vị trí "${slot.label}".`);
    } catch (error) {
      toast.error(errorMessage(error, 'Không gán được icon vào vị trí.'));
    } finally {
      setBusySlot(null);
    }
  };

  const handleClear = async (slot: IconSlotMeta) => {
    setBusySlot(slot.id);
    try {
      await clearSlot(slot.id);
      setAssignments((prev) => {
        const next = { ...prev };
        delete next[slot.id];
        return next;
      });
      notifyBrandSlotsChanged();
      toast.success(`Đã đưa vị trí "${slot.label}" về mặc định.`);
    } catch (error) {
      toast.error(errorMessage(error, 'Không đưa được vị trí về mặc định.'));
    } finally {
      setBusySlot(null);
    }
  };

  const openCreateDialog = () => {
    setCreateId('custom.');
    setCreateLabel('');
    setCreateGroup('custom');
    setCreateColorMode('brand');
    setCreateRecommendedSize(24);
    setCreateDescription('');
    setCreateError(null);
    setCreateOpen(true);
  };

  const handleCreateSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const id = createId.trim();
    const label = createLabel.trim();
    if (!isValidSlotId(id)) {
      setCreateError('Mã vị trí không hợp lệ. Phải bắt đầu bằng chữ thường, gồm chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới, từ 2-64 ký tự.');
      return;
    }
    if (isBuiltInSlotId(id)) {
      setCreateError('Mã vị trí này trùng với vị trí hệ thống cố định. Hãy chọn mã khác.');
      return;
    }
    if (definitions.some((d) => d.id === id)) {
      setCreateError('Mã vị trí này đã tồn tại.');
      return;
    }
    if (!label) {
      setCreateError('Tên vị trí không được để trống.');
      return;
    }

    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const created = await createCustomSlot({
        id,
        label,
        group: createGroup,
        colorMode: createColorMode,
        recommendedSize: createRecommendedSize,
        description: createDescription.trim(),
      });
      setDefinitions((prev) => [...prev, created]);
      void refreshGroups();
      notifyBrandSlotsChanged();
      setCreateOpen(false);
      toast.success(`Đã tạo vị trí mới "${created.label}" (${created.id}).`);
    } catch (error) {
      setCreateError(errorMessage(error, 'Không thể tạo vị trí mới.'));
    } finally {
      setCreateSubmitting(false);
    }
  };

  const openEditDialog = (slot: IconSlotMeta) => {
    setEditTarget(slot);
    setEditLabel(slot.label);
    setEditGroup(slot.group);
    setEditColorMode(slot.colorMode);
    setEditRecommendedSize(slot.recommendedSize);
    setEditDescription(slot.description || '');
    setEditError(null);
  };

  const applyUpdatedSlot = (updated: IconSlotMeta) => {
    setDefinitions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    void refreshGroups();
    notifyBrandSlotsChanged();
  };

  /** Vị trí có sẵn: chỉ gửi trường đổi so với giá trị hiện tại; trường về đúng mặc định trong code gửi null (khôi phục). */
  const buildBuiltInPatch = (target: IconSlotMeta, values: Required<UpdateBrandSlotRequest>): UpdateBrandSlotRequest => {
    const patch: Record<string, string | number | null> = {};
    for (const field of SLOT_OVERRIDE_FIELDS) {
      const next = values[field];
      if (next === target[field]) continue;
      const fallback = target.defaults?.[field];
      patch[field] = fallback !== undefined && next === fallback ? null : next;
    }
    return patch as UpdateBrandSlotRequest;
  };

  const handleEditSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editTarget) return;
    const label = editLabel.trim();
    if (!label) {
      setEditError('Tên vị trí không được để trống.');
      return;
    }
    const values = {
      label,
      group: editGroup,
      colorMode: editColorMode,
      recommendedSize: editRecommendedSize,
      description: editDescription.trim(),
    };
    const builtIn = !editTarget.isCustom;
    const patch = builtIn ? buildBuiltInPatch(editTarget, values) : values;
    if (builtIn && Object.keys(patch).length === 0) {
      setEditTarget(null);
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    try {
      const updated = await updateCustomSlot(editTarget.id, patch);
      applyUpdatedSlot(updated);
      setEditTarget(null);
      toast.success(`Đã cập nhật vị trí "${updated.label}".`);
    } catch (error) {
      setEditError(errorMessage(error, 'Không thể cập nhật vị trí.'));
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleResetOverride = async () => {
    if (!editTarget) return;
    setEditResetting(true);
    setEditError(null);
    try {
      const restored = await resetSlotOverride(editTarget.id);
      applyUpdatedSlot(restored);
      setEditTarget(null);
      toast.success(`Đã khôi phục mặc định cho vị trí "${restored.label}".`);
    } catch (error) {
      setEditError(errorMessage(error, 'Không thể khôi phục mặc định cho vị trí.'));
    } finally {
      setEditResetting(false);
    }
  };

  const handleDeleteSubmit = async () => {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      await deleteCustomSlot(deleteTarget.id);
      setDefinitions((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      void refreshGroups();
      setAssignments((prev) => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
      notifyBrandSlotsChanged();
      const targetLabel = deleteTarget.label;
      setDeleteTarget(null);
      toast.success(`Đã xoá vị trí "${targetLabel}".`);
    } catch (error) {
      setDeleteError(errorMessage(error, 'Không thể xoá vị trí.'));
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const editBuiltIn = Boolean(editTarget && !editTarget.isCustom);
  const colorModeChanged = Boolean(editTarget && editColorMode !== editTarget.colorMode);
  const editValueOf = (field: SlotOverrideField): string | number => {
    switch (field) {
      case 'label':
        return editLabel.trim();
      case 'group':
        return editGroup;
      case 'colorMode':
        return editColorMode;
      case 'recommendedSize':
        return editRecommendedSize;
      default:
        return editDescription.trim();
    }
  };

  /** Trường của vị trí có sẵn đã được sửa và giá trị trong ô chưa về mặc định: hiện nút Khôi phục nhỏ (đưa ô về mặc định, chỉ lưu khi bấm Lưu thay đổi). */
  const renderFieldReset = (field: SlotOverrideField, onReset: () => void) => {
    if (!editBuiltIn || !editTarget?.overriddenFields?.includes(field)) return null;
    if (editValueOf(field) === editTarget.defaults?.[field]) return null;
    return (
      <Button
        className="h-6 px-1.5 text-[11px]"
        data-testid={`slot-reset-field-${field}`}
        onClick={onReset}
        type="button"
        variant="ghost"
      >
        Khôi phục
      </Button>
    );
  };

  /** Hiện mặc định trong code dưới trường đã sửa. */
  const renderFieldDefault = <T extends string | number>(field: SlotOverrideField, value: T | undefined, format?: (value: T) => string) => {
    if (!editBuiltIn || value === undefined || !editTarget?.overriddenFields?.includes(field)) return null;
    return (
      <span className="text-[11px] text-slate-500" data-testid={`slot-default-${field}`}>
        Mặc định: {format ? format(value) : String(value)}
      </span>
    );
  };

  const renderIconOption = useCallback(
    (option: SearchableSelectOption) => {
      const doc = library.get(option.value);
      return (
        <div className="flex min-w-0 items-center gap-2.5">
          {doc ? (
            <span className="grid size-6 shrink-0 place-items-center rounded border border-slate-200 bg-slate-50">
              <IconSvg className="size-4" colorMode="brand" doc={doc} palette={settings.palette} />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-900">{option.label}</div>
            {option.description ? <div className="truncate font-mono text-xs text-slate-500">{option.description}</div> : null}
          </div>
        </div>
      );
    },
    [library, settings.palette],
  );

  const activeFilterCount = (groupFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!filterOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFilterOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [filterOpen]);
  const isFiltered = query.trim() !== '' || groupFilter !== 'all' || statusFilter !== 'all';
  const ready = settings.ready && library.ready && !slotsLoading;

  // Khối danh sách cao vừa phần màn hình còn lại, nội dung dài chỉ cuộn trong khối; màn hình hẹp để trang cuộn như thường.
  const wide = useMediaQuery('(min-width: 768px)');
  useFillViewportHeight(panelRef, 360, ready, wide, 12);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Vị trí sử dụng</h1>
          {ready ? (
            <span className="text-xs text-slate-500">
              {assignedCount}/{definitions.length} vị trí đã gán icon riêng
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            aria-label="Nhóm vị trí"
            className={RAISED}
            data-testid="manage-slot-groups-btn"
            onClick={() => setGroupsOpen(true)}
            variant="outline"
          >
            <Tags aria-hidden className="size-4" />
            <span>Nhóm vị trí</span>
          </Button>
          <Button
            aria-label="Thêm vị trí mới"
            className={cn(RAISED, 'bg-blue-600 hover:bg-blue-700 text-white')}
            data-testid="add-custom-slot-btn"
            onClick={openCreateDialog}
          >
            <Plus aria-hidden className="size-4" />
            <span>Thêm vị trí mới</span>
          </Button>
          <Hint label="Tải lại danh sách vị trí từ máy chủ">
            <Button
              aria-label="Tải lại"
              className={RAISED}
              disabled={slotsLoading}
              onClick={() => void loadSlots()}
              variant="outline"
            >
              <RefreshCw aria-hidden className={cn('size-4', slotsLoading && 'animate-spin')} />
              <span className="hidden sm:inline">Tải lại</span>
            </Button>
          </Hint>
        </div>
      </header>

      {library.error ? (
        <p className="border-l-2 border-red-500 bg-red-50/60 py-1.5 pl-3 text-sm text-red-800" role="alert">
          {library.error}
        </p>
      ) : null}

      {slotsError ? (
        <div className="flex items-center justify-between gap-3 border-l-2 border-red-500 bg-red-50/60 py-2 pl-3 pr-3 text-sm text-red-800" role="alert">
          <p>{slotsError}</p>
          <Button onClick={() => void loadSlots()} variant="outline">
            Thử lại
          </Button>
        </div>
      ) : null}

      {!ready ? (
        <div aria-busy="true" aria-label="Đang tải vị trí sử dụng" className="grid animate-pulse gap-3">
          <div className="h-12 rounded bg-slate-100" />
          <div className="h-24 rounded bg-slate-100" />
          <div className="h-24 rounded bg-slate-100" />
        </div>
      ) : (
        <Panel
          bodyRef={bodyRef}
          fill={wide}
          footer={
            filteredSlots.length > 0 ? (
              <LibraryPagerBar
                onPage={setPageNumber}
                onPageSize={(size) => {
                  setPageNumber(pageAfterSizeChange(slice.page, pageSize, size));
                  setPageSize(size);
                }}
                sizeControl="select"
                sizes={SLOT_PAGE_SIZES}
                slice={slice}
                unit="vị trí"
              />
            ) : null
          }
          sectionRef={panelRef}
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="relative w-60">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  aria-label="Tìm theo tên hoặc mã vị trí"
                  className="h-8 bg-white pl-9 pr-8"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Tìm tên hoặc mã..."
                  value={query}
                />
                {query ? (
                  <IconButton
                    className="absolute right-1.5 top-1/2 size-6 -translate-y-1/2"
                    label="Xoá từ khoá tìm kiếm"
                    onClick={() => setQuery('')}
                  >
                    <X aria-hidden className="size-3.5" />
                  </IconButton>
                ) : null}
              </div>

              <div className="relative" ref={filterRef}>
                <Button
                  aria-expanded={filterOpen}
                  aria-haspopup="dialog"
                  className={RAISED}
                  onClick={() => setFilterOpen((open) => !open)}
                  variant="outline"
                >
                  <SlidersHorizontal aria-hidden className="size-3.5" />
                  <span>Bộ lọc</span>
                  {activeFilterCount > 0 ? (
                    <span className="grid size-4 place-items-center rounded-full bg-blue-600 text-[10px] font-semibold text-white">
                      {activeFilterCount}
                    </span>
                  ) : null}
                </Button>
                {filterOpen ? (
                  <div
                    aria-label="Bộ lọc vị trí"
                    className="absolute right-0 top-full z-30 mt-2 flex w-64 flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 shadow-lg"
                    role="dialog"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-slate-600">Nhóm</span>
                      <SearchableSelect
                        height={32}
                        hideDropdownSearch
                        name="group-filter"
                        onChange={(value) => setGroupFilter(value || 'all')}
                        options={groupFilterOptions}
                        searchInDropdown
                        value={groupFilter}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-slate-600">Trạng thái</span>
                      <SearchableSelect
                        height={32}
                        hideDropdownSearch
                        name="status-filter"
                        onChange={(value) => setStatusFilter((value as StatusFilter) || 'all')}
                        options={STATUS_OPTIONS}
                        searchInDropdown
                        value={statusFilter}
                      />
                    </div>
                    {isFiltered ? (
                      <Button
                        onClick={() => {
                          setQuery('');
                          setGroupFilter('all');
                          setStatusFilter('all');
                        }}
                        variant="ghost"
                      >
                        Xoá bộ lọc
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          }
          icon={LayoutGrid}
          id="slots-panel-title"
          title="Danh sách vị trí icon"
        >
          <div className="flex flex-col gap-4">
            {filteredSlots.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-200 py-10 text-center">
                <SearchX aria-hidden className="size-8 text-slate-300" />
                <p className="text-sm font-medium text-slate-700">Không tìm thấy vị trí phù hợp</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 rounded-md border border-slate-200">
                {slice.items.map((slot) => {
                  const assignment = assignments[slot.id];
                  const assignedDoc = assignment ? library.get(assignment.iconId) : undefined;
                  const isBusy = busySlot === slot.id;
                  const isUnpublishedWarning = Boolean(assignment && assignment.iconStatus !== 'published');

                  return (
                    <div
                      className="grid items-center gap-x-5 gap-y-3 px-4 py-3.5 lg:grid-cols-[120px_minmax(0,1fr)_minmax(0,480px)]"
                      data-testid={`slot-row-${slot.id}`}
                      key={slot.id}
                    >
                      <SlotPreview assignment={assignment} doc={assignedDoc} palette={settings.palette} slot={slot} />

                      <div className="min-w-0 space-y-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-slate-900">{slot.label}</h3>
                          {slot.isCustom ? (
                            <span className="inline-flex shrink-0 items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                              Tùy chỉnh
                            </span>
                          ) : null}
                          {slot.overriddenFields && slot.overriddenFields.length > 0 ? (
                            <span
                              className="inline-flex shrink-0 items-center rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200"
                              data-testid={`slot-overridden-${slot.id}`}
                            >
                              Đã chỉnh sửa
                            </span>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{slot.id}</code>
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                            {groupLabels[slot.group] || slot.group}
                          </span>
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                              slot.colorMode === 'brand'
                                ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
                                : 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200',
                            )}
                          >
                            {slot.colorMode === 'brand' ? 'Màu thương hiệu' : 'Theo ngữ cảnh (currentColor)'}
                          </span>
                          <span className="text-[11px] tabular-nums text-slate-400">{slot.recommendedSize}px</span>
                        </div>

                        <TruncatedText className="text-xs text-slate-500" text={slot.description} />

                        {isUnpublishedWarning && assignment ? (
                          <div
                            className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800"
                            data-testid={`slot-warning-${slot.id}`}
                            role="alert"
                          >
                            <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                            <span>
                              {assignment.iconStatus === 'archived'
                                ? `Icon "${assignment.iconName}" đã bị lưu trữ. Hãy chọn icon đã phát hành khác hoặc đưa về mặc định.`
                                : `Icon "${assignment.iconName}" đã bị gỡ phát hành. Hãy phát hành lại hoặc chọn icon khác.`}
                            </span>
                          </div>
                        ) : null}
                      </div>

                      {/* Ô chọn rộng đều ở mọi hàng; ba ô thao tác (về mặc định, sửa, xoá) giữ chỗ cố định nên cột thẳng hàng. */}
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <SearchableSelect
                            disabled={isBusy || publishedDocs.length === 0}
                            emptyText="Chưa có icon nào ở trạng thái phát hành."
                            height={32}
                            name={`slot-select-${slot.id}`}
                            nativeTitle={false}
                            onChange={(value) => void handleAssign(slot, value)}
                            options={iconOptions}
                            placeholder={
                              assignment && assignment.iconStatus !== 'published'
                                ? `${assignment.iconName} (chưa phát hành)`
                                : 'Chọn icon đã phát hành...'
                            }
                            renderOption={renderIconOption}
                            searchInDropdown
                            searchPlaceholder="Tìm icon theo tên..."
                            value={assignment?.iconStatus === 'published' ? assignment.iconId : ''}
                          />
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <div className="size-8">
                            {assignment ? (
                              <Hint label="Về mặc định">
                                <Button
                                  aria-label="Về mặc định"
                                  className={RAISED}
                                  disabled={isBusy}
                                  onClick={() => void handleClear(slot)}
                                  size="icon"
                                  variant="outline"
                                >
                                  <RotateCcw aria-hidden className="size-4" />
                                </Button>
                              </Hint>
                            ) : null}
                          </div>
                          <div className="size-8">
                            <Hint label={slot.isCustom ? 'Sửa vị trí tùy chỉnh' : 'Sửa vị trí'}>
                              <Button
                                aria-label={`Sửa vị trí ${slot.label}`}
                                className={RAISED}
                                data-testid={`slot-edit-btn-${slot.id}`}
                                disabled={isBusy}
                                onClick={() => openEditDialog(slot)}
                                size="icon"
                                variant="outline"
                              >
                                <Pencil aria-hidden className="size-4" />
                              </Button>
                            </Hint>
                          </div>
                          <div className="size-8">
                            {slot.isCustom ? (
                              <Hint label="Xoá vị trí tùy chỉnh">
                                <Button
                                  aria-label={`Xoá vị trí ${slot.label}`}
                                  className={cn(RAISED, 'text-red-600 hover:bg-red-50 hover:text-red-700')}
                                  data-testid={`slot-delete-btn-${slot.id}`}
                                  disabled={isBusy}
                                  onClick={() => {
                                    setDeleteTarget(slot);
                                    setDeleteError(null);
                                  }}
                                  size="icon"
                                  variant="outline"
                                >
                                  <Trash2 aria-hidden className="size-4" />
                                </Button>
                              </Hint>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Panel>
      )}

      <SlotGroupsDialog
        groups={groups}
        onCreated={handleGroupCreated}
        onDeleted={handleGroupDeleted}
        onOpenChange={setGroupsOpen}
        onUpdated={handleGroupUpdated}
        open={groupsOpen}
      />

      {/* Hộp thoại tạo vị trí mới */}
      <Dialog onOpenChange={setCreateOpen} open={createOpen}>
        <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
          <SlotDialogFrame
            error={createError}
            footer={
              <>
                <Button disabled={createSubmitting} onClick={() => setCreateOpen(false)} type="button" variant="outline">
                  Huỷ
                </Button>
                <Button
                  className="bg-blue-600 text-white hover:bg-blue-700"
                  data-testid="create-slot-submit-btn"
                  disabled={createSubmitting}
                  type="submit"
                >
                  {createSubmitting ? 'Đang tạo...' : 'Tạo vị trí'}
                </Button>
              </>
            }
            onSubmit={handleCreateSubmit}
            title="Thêm vị trí icon mới"
          >
            <SlotField hint="Chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới (vd: custom.help-center)" htmlFor="custom-slot-id" label="Mã vị trí (ID)" required>
              <Input
                autoFocus
                className="h-8 font-mono text-xs"
                id="custom-slot-id"
                onChange={(e) => setCreateId(e.target.value)}
                placeholder="custom.ten_vi_tri"
                required
                value={createId}
              />
            </SlotField>

            <SlotField htmlFor="custom-slot-label" label="Tên hiển thị" required>
              <Input
                className="h-8"
                id="custom-slot-label"
                onChange={(e) => setCreateLabel(e.target.value)}
                placeholder="Trung tâm trợ giúp"
                required
                value={createLabel}
              />
            </SlotField>

            <div className="grid gap-4 sm:grid-cols-2">
              <SlotField htmlFor="custom-slot-group" label="Nhóm vị trí">
                <SlotGroupSelect
                  groups={groups}
                  name="custom-slot-group"
                  onChange={setCreateGroup}
                  onGroupCreated={handleGroupCreated}
                  value={createGroup}
                />
              </SlotField>

              <SlotField hint={COLOR_MODE_HINT} htmlFor="custom-slot-mode" label="Chế độ màu">
                <SearchableSelect
                  clearable={false}
                  height={32}
                  hideDropdownSearch
                  name="custom-slot-mode"
                  nativeTitle={false}
                  onChange={(val) => setCreateColorMode((val as BrandSvgMode) || 'brand')}
                  options={COLOR_MODE_OPTIONS}
                  searchInDropdown
                  value={createColorMode}
                />
              </SlotField>
            </div>

            <SlotField htmlFor="custom-slot-size" label="Kích thước khuyến nghị (pixel)">
              <Input
                className="h-8"
                id="custom-slot-size"
                max={512}
                min={8}
                onChange={(e) => setCreateRecommendedSize(Number(e.target.value) || 24)}
                type="number"
                value={createRecommendedSize}
              />
            </SlotField>

            <SlotField htmlFor="custom-slot-desc" label="Mô tả">
              <Textarea
                className="min-h-16 text-xs"
                id="custom-slot-desc"
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="Vị trí hiển thị icon tại trang..."
                rows={2}
                value={createDescription}
              />
            </SlotField>
          </SlotDialogFrame>
        </DialogContent>
      </Dialog>

      {/* Hộp thoại chỉnh sửa vị trí (tùy chỉnh và có sẵn) */}
      <Dialog onOpenChange={(open) => !open && setEditTarget(null)} open={Boolean(editTarget)}>
        <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
          <SlotDialogFrame
            description={
              <>
                <code className="font-mono text-xs">{editTarget?.id}</code>
                {editBuiltIn ? ' · Mã vị trí không đổi được.' : null}
              </>
            }
            error={editError}
            footer={
              <>
                {editBuiltIn && editTarget?.overriddenFields && editTarget.overriddenFields.length > 0 ? (
                  <Button
                    className="mr-auto"
                    data-testid={`slot-reset-btn-${editTarget.id}`}
                    disabled={editSubmitting || editResetting}
                    onClick={() => void handleResetOverride()}
                    type="button"
                    variant="outline"
                  >
                    <RotateCcw aria-hidden className="size-4" />
                    {editResetting ? 'Đang khôi phục...' : 'Khôi phục mặc định'}
                  </Button>
                ) : null}
                <Button disabled={editSubmitting || editResetting} onClick={() => setEditTarget(null)} type="button" variant="outline">
                  Huỷ
                </Button>
                <Button
                  className="bg-blue-600 text-white hover:bg-blue-700"
                  data-testid="edit-slot-submit-btn"
                  disabled={editSubmitting || editResetting}
                  type="submit"
                >
                  {editSubmitting ? 'Đang lưu...' : 'Lưu thay đổi'}
                </Button>
              </>
            }
            onSubmit={handleEditSubmit}
            title={editBuiltIn ? 'Chỉnh sửa vị trí' : 'Chỉnh sửa vị trí tùy chỉnh'}
          >
            <SlotField htmlFor="edit-slot-id" label="Mã vị trí (ID)">
              <Input className="h-8 bg-slate-50 font-mono text-xs text-slate-500" disabled id="edit-slot-id" value={editTarget?.id || ''} />
            </SlotField>

            <SlotField
              action={renderFieldReset('label', () => setEditLabel(editTarget?.defaults?.label ?? ''))}
              footnote={renderFieldDefault('label', editTarget?.defaults?.label)}
              htmlFor="edit-slot-label"
              label="Tên hiển thị"
              required
            >
              <Input
                autoFocus
                className="h-8"
                id="edit-slot-label"
                onChange={(e) => setEditLabel(e.target.value)}
                required
                value={editLabel}
              />
            </SlotField>

            <div className="grid gap-4 sm:grid-cols-2">
              <SlotField
                action={renderFieldReset('group', () => setEditGroup(editTarget?.defaults?.group ?? 'custom'))}
                footnote={renderFieldDefault('group', editTarget?.defaults?.group, (value) => groupLabels[value] || value)}
                htmlFor="edit-slot-group"
                label="Nhóm vị trí"
              >
                <SlotGroupSelect
                  groups={groups}
                  name="edit-slot-group"
                  onChange={setEditGroup}
                  onGroupCreated={handleGroupCreated}
                  value={editGroup}
                />
              </SlotField>

              <SlotField
                action={renderFieldReset('colorMode', () => setEditColorMode(editTarget?.defaults?.colorMode ?? 'brand'))}
                footnote={renderFieldDefault('colorMode', editTarget?.defaults?.colorMode, (value) =>
                  value === 'brand' ? 'Màu thương hiệu / Gradient' : 'Theo ngữ cảnh (currentColor)',
                )}
                hint={COLOR_MODE_HINT}
                htmlFor="edit-slot-mode"
                label="Chế độ màu"
              >
                <SearchableSelect
                  clearable={false}
                  height={32}
                  hideDropdownSearch
                  name="edit-slot-mode"
                  nativeTitle={false}
                  onChange={(val) => setEditColorMode((val as BrandSvgMode) || 'brand')}
                  options={COLOR_MODE_OPTIONS}
                  searchInDropdown
                  value={editColorMode}
                />
              </SlotField>
            </div>

            {colorModeChanged ? (
              <div
                className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800"
                data-testid="slot-color-warning"
                role="alert"
              >
                <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                <span>
                  Đổi chế độ màu sẽ thay đổi cách icon được vẽ ở mọi nơi dùng vị trí này. Vị trí menu và nút nhỏ nên giữ
                  &quot;Theo ngữ cảnh (currentColor)&quot; để icon đổi màu theo trạng thái chọn và giao diện tối; &quot;Màu thương hiệu&quot;
                  giữ nguyên màu và dải màu của icon.
                </span>
              </div>
            ) : null}

            <SlotField
              action={renderFieldReset('recommendedSize', () => setEditRecommendedSize(editTarget?.defaults?.recommendedSize ?? 24))}
              footnote={renderFieldDefault('recommendedSize', editTarget?.defaults?.recommendedSize, (value) => `${value}px`)}
              htmlFor="edit-slot-size"
              label="Kích thước khuyến nghị (pixel)"
            >
              <Input
                className="h-8"
                id="edit-slot-size"
                max={512}
                min={8}
                onChange={(e) => setEditRecommendedSize(Number(e.target.value) || 24)}
                type="number"
                value={editRecommendedSize}
              />
            </SlotField>

            <SlotField
              action={renderFieldReset('description', () => setEditDescription(editTarget?.defaults?.description ?? ''))}
              footnote={renderFieldDefault('description', editTarget?.defaults?.description, (value) => value || '(để trống)')}
              htmlFor="edit-slot-desc"
              label="Mô tả"
            >
              <Textarea
                className="min-h-16 text-xs"
                id="edit-slot-desc"
                onChange={(e) => setEditDescription(e.target.value)}
                rows={2}
                value={editDescription}
              />
            </SlotField>
          </SlotDialogFrame>
        </DialogContent>
      </Dialog>

      {/* Hộp thoại xác nhận xoá vị trí */}
      <Dialog onOpenChange={(open) => !open && setDeleteTarget(null)} open={Boolean(deleteTarget)}>
        <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
          <SlotDialogFrame
            description={
              <>
                Bạn có chắc chắn muốn xoá vị trí <strong className="text-slate-900">{deleteTarget?.label}</strong> (
                <code className="font-mono text-xs">{deleteTarget?.id}</code>)?
              </>
            }
            error={deleteError}
            footer={
              <>
                <Button disabled={deleteSubmitting} onClick={() => setDeleteTarget(null)} type="button" variant="outline">
                  Huỷ
                </Button>
                <Button
                  className="bg-red-600 text-white hover:bg-red-700"
                  data-testid="delete-slot-confirm-btn"
                  disabled={deleteSubmitting}
                  onClick={handleDeleteSubmit}
                  type="button"
                >
                  {deleteSubmitting ? 'Đang xoá...' : 'Xoá vĩnh viễn'}
                </Button>
              </>
            }
            title="Xác nhận xoá vị trí tùy chỉnh"
          >
            <p className="text-xs text-slate-500">
              Hành động này sẽ xoá hoàn toàn cấu hình vị trí và huỷ gán icon hiện tại ở vị trí này. Thao tác không thể hoàn tác.
            </p>
          </SlotDialogFrame>
        </DialogContent>
      </Dialog>
    </div>
  );
}
