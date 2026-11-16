'use client';

import {
  ICON_SLOTS,
  SLOT_GROUP_LABELS,
  type BrandSlotAssignment,
  type IconDocument,
  type IconSlotGroup,
  type IconSlotId,
} from '@enterprise-platform/shared-brand-icon';
import { SearchableSelect, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import {
  AlertTriangle,
  LayoutGrid,
  RefreshCw,
  RotateCcw,
  Search,
  SearchX,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Hint } from '../components/hint';
import { Panel, RAISED } from '../components/panel';
import { IconSvg } from '../icon-svg';
import { foldText } from '../library/library-filters';
import { IconButton } from '../library/library-ui';
import { useBrandSettings, useIconLibrary } from '../store';
import { assignSlot, clearSlot, errorMessage, listSlots } from '../store/brand-api';

type SlotMeta = (typeof ICON_SLOTS)[number];
type GroupFilter = 'all' | IconSlotGroup;
type StatusFilter = 'all' | 'assigned' | 'default';

interface Notice {
  readonly tone: 'ok' | 'error';
  readonly text: string;
}

const GROUP_OPTIONS: readonly SearchableSelectOption[] = [
  { value: 'all', label: 'Tất cả nhóm' },
  { value: 'brand', label: SLOT_GROUP_LABELS.brand },
  { value: 'module', label: SLOT_GROUP_LABELS.module },
  { value: 'nav', label: SLOT_GROUP_LABELS.nav },
];

const STATUS_OPTIONS: readonly SearchableSelectOption[] = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'assigned', label: 'Đã gán' },
  { value: 'default', label: 'Mặc định' },
];

function indexAssignments(slots: readonly BrandSlotAssignment[]): Record<string, BrandSlotAssignment> {
  const map: Record<string, BrandSlotAssignment> = {};
  for (const item of slots) map[item.slot] = item;
  return map;
}

function matchesSlot(slot: SlotMeta, assignment: BrandSlotAssignment | undefined, query: string, group: GroupFilter, status: StatusFilter): boolean {
  if (group !== 'all' && slot.group !== group) return false;
  if (status === 'assigned' && !assignment) return false;
  if (status === 'default' && assignment) return false;
  const tokens = foldText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = foldText([slot.label, slot.id, slot.description, SLOT_GROUP_LABELS[slot.group]].join(' '));
  return tokens.every((token) => haystack.includes(token));
}

function SlotPreview({
  slot,
  assignment,
  doc,
  palette,
}: {
  slot: SlotMeta;
  assignment: BrandSlotAssignment | undefined;
  doc: IconDocument | undefined;
  palette: ReturnType<typeof useBrandSettings>['palette'];
}) {
  if (!assignment) {
    return (
      <div
        className="flex h-16 w-28 shrink-0 flex-col items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/70 px-2 text-center"
        data-testid={`slot-preview-default-${slot.id}`}
      >
        <span className="text-[11px] font-medium text-slate-400">Mặc định</span>
      </div>
    );
  }

  if (!doc) {
    return (
      <div
        className="flex h-16 w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-amber-200 bg-amber-50/70 px-2 text-center text-amber-700"
        data-testid={`slot-preview-missing-${slot.id}`}
      >
        <AlertTriangle aria-hidden className="size-4" />
        <span className="text-[10px] leading-tight">Không có hình</span>
      </div>
    );
  }

  if (slot.colorMode === 'mono') {
    return (
      <div className="flex shrink-0 items-center gap-2" data-testid={`slot-preview-mono-${slot.id}`}>
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
      className="flex h-16 w-28 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50"
      data-testid={`slot-preview-brand-${slot.id}`}
    >
      <IconSvg className="size-8" colorMode="brand" doc={doc} palette={palette} title={slot.label} />
    </div>
  );
}

export function SlotsPage() {
  const settings = useBrandSettings();
  const library = useIconLibrary();

  const [assignments, setAssignments] = useState<Readonly<Record<string, BrandSlotAssignment>>>({});
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<IconSlotId | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const loadSlots = useCallback(async () => {
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const response = await listSlots();
      setAssignments(indexAssignments(response.slots));
    } catch (error) {
      setSlotsError(errorMessage(error, 'Không tải được danh sách vị trí sử dụng.'));
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

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
    () => ICON_SLOTS.filter((slot) => matchesSlot(slot, assignments[slot.id], query, groupFilter, statusFilter)),
    [assignments, query, groupFilter, statusFilter],
  );

  const assignedCount = useMemo(
    () => ICON_SLOTS.filter((slot) => Boolean(assignments[slot.id])).length,
    [assignments],
  );

  const handleAssign = async (slot: SlotMeta, iconId: string) => {
    if (!iconId) return;
    setBusySlot(slot.id);
    setNotice(null);
    try {
      const updated = await assignSlot(slot.id, iconId);
      setAssignments((prev) => ({ ...prev, [slot.id]: updated }));
      setNotice({ tone: 'ok', text: `Đã gán icon "${updated.iconName}" cho vị trí "${slot.label}".` });
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error, 'Không gán được icon vào vị trí.') });
    } finally {
      setBusySlot(null);
    }
  };

  const handleClear = async (slot: SlotMeta) => {
    setBusySlot(slot.id);
    setNotice(null);
    try {
      await clearSlot(slot.id);
      setAssignments((prev) => {
        const next = { ...prev };
        delete next[slot.id];
        return next;
      });
      setNotice({ tone: 'ok', text: `Đã đưa vị trí "${slot.label}" về mặc định.` });
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error, 'Không đưa được vị trí về mặc định.') });
    } finally {
      setBusySlot(null);
    }
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

  const isFiltered = query.trim() !== '' || groupFilter !== 'all' || statusFilter !== 'all';
  const ready = settings.ready && library.ready && !slotsLoading;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Vị trí sử dụng</h1>
          {ready ? (
            <span className="text-xs text-slate-500">
              {assignedCount}/{ICON_SLOTS.length} vị trí đã gán icon riêng
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
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

      {notice ? (
        <div
          className={cn(
            'flex items-start gap-2 border-l-2 py-1.5 pl-3 pr-1 text-sm',
            notice.tone === 'ok' ? 'border-emerald-500 bg-emerald-50/60 text-emerald-800' : 'border-red-500 bg-red-50/60 text-red-800',
          )}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          <p className="min-w-0 flex-1">{notice.text}</p>
          <IconButton className="size-6" label="Đóng thông báo" onClick={() => setNotice(null)}>
            <X aria-hidden className="size-3.5" />
          </IconButton>
        </div>
      ) : null}

      {library.error ? (
        <p className="border-l-2 border-red-500 bg-red-50/60 py-1.5 pl-3 text-sm text-red-800" role="alert">
          {library.error}
        </p>
      ) : null}

      {slotsError ? (
        <div className="flex items-center justify-between gap-3 border-l-2 border-red-500 bg-red-50/60 py-2 pl-3 pr-3 text-sm text-red-800" role="alert">
          <p>{slotsError}</p>
          <Button onClick={() => void loadSlots()} size="sm" variant="outline">
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
          hint="Gán icon đã phát hành vào từng vị trí hiển thị trong ứng dụng"
          icon={LayoutGrid}
          id="slots-panel-title"
          title="Danh sách vị trí icon"
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[220px] flex-1">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  aria-label="Tìm theo tên hoặc mã vị trí"
                  className="h-9 pl-9 pr-8"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Tìm theo tên hoặc mã vị trí..."
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

              <div className="w-48">
                <SearchableSelect
                  height={36}
                  hideDropdownSearch
                  name="group-filter"
                  onChange={(value) => setGroupFilter((value as GroupFilter) || 'all')}
                  options={GROUP_OPTIONS}
                  searchInDropdown
                  value={groupFilter}
                />
              </div>

              <div className="w-44">
                <SearchableSelect
                  height={36}
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
                  size="sm"
                  variant="ghost"
                >
                  Xoá bộ lọc
                </Button>
              ) : null}
            </div>

            {filteredSlots.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-200 py-10 text-center">
                <SearchX aria-hidden className="size-8 text-slate-300" />
                <p className="text-sm font-medium text-slate-700">Không tìm thấy vị trí phù hợp</p>
                <p className="text-xs text-slate-500">Thử đổi từ khoá hoặc bỏ bộ lọc nhóm, trạng thái.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 rounded-md border border-slate-200">
                {filteredSlots.map((slot) => {
                  const assignment = assignments[slot.id];
                  const assignedDoc = assignment ? library.get(assignment.iconId) : undefined;
                  const isBusy = busySlot === slot.id;
                  const isUnpublishedWarning = Boolean(assignment && assignment.iconStatus !== 'published');

                  return (
                    <div
                      className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between"
                      data-testid={`slot-row-${slot.id}`}
                      key={slot.id}
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-4">
                        <SlotPreview assignment={assignment} doc={assignedDoc} palette={settings.palette} slot={slot} />

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-slate-900">{slot.label}</h3>
                            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">{slot.id}</code>
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                              {SLOT_GROUP_LABELS[slot.group]}
                            </span>
                            <span
                              className={cn(
                                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                                slot.colorMode === 'brand'
                                  ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
                                  : 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200',
                              )}
                            >
                              {slot.colorMode === 'brand' ? 'Màu thương hiệu' : 'Theo ngữ cảnh (currentColor)'}
                            </span>
                            <span className="text-xs text-slate-400">{slot.recommendedSize}px</span>
                          </div>

                          <p className="text-xs text-slate-500">{slot.description}</p>

                          {isUnpublishedWarning && assignment ? (
                            <div
                              className="mt-1.5 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800"
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
                      </div>

                      <div className="flex flex-wrap items-center gap-2 lg:w-[360px] lg:shrink-0 lg:justify-end">
                        <div className="min-w-[210px] flex-1">
                          <SearchableSelect
                            disabled={isBusy || publishedDocs.length === 0}
                            emptyText="Chưa có icon nào ở trạng thái phát hành."
                            height={36}
                            name={`slot-select-${slot.id}`}
                            onChange={(value) => void handleAssign(slot, value)}
                            options={iconOptions}
                            placeholder={
                              assignment && assignment.iconStatus !== 'published'
                                ? `${assignment.iconName} (chưa phát hành)`
                                : 'Chọn icon đã phát hành...'
                            }
                            renderOption={renderIconOption}
                            searchPlaceholder="Tìm icon theo tên..."
                            value={assignment?.iconStatus === 'published' ? assignment.iconId : ''}
                          />
                        </div>

                        {assignment ? (
                          <Button
                            className={RAISED}
                            disabled={isBusy}
                            onClick={() => void handleClear(slot)}
                            size="sm"
                            variant="outline"
                          >
                            <RotateCcw aria-hidden className="size-3.5" />
                            <span>Về mặc định</span>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
