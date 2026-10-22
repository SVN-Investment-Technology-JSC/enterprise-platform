'use client';

import { CATEGORY_LABELS, type IconDocument, type IconStatus } from '@enterprise-platform/shared-brand-icon';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  Check,
  Download,
  FileJson,
  FilePen,
  Images,
  LayoutGrid,
  List,
  ListFilter,
  Plus,
  Search,
  SearchX,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Panel, RAISED, RAISED_PRIMARY } from '../components/panel';
import { ExportDialog } from '../export/export-dialog';
import { isPresetId, useBrandSettings, useIconLibrary } from '../store';
import { errorMessage } from '../store/brand-api';
import { IconList } from './icon-list';
import { IconTile } from './icon-tile';
import {
  CATEGORY_FILTERS,
  DEFAULT_VIEW,
  SORT_LABELS,
  STATUS_LABELS,
  STATUSES,
  applyView,
  facetCounts,
  isViewFiltered,
  type CategoryFilter,
  type LibraryView,
  type SortKey,
  type StatusFilter,
  type ViewMode,
} from './library-filters';
import {
  backupFileName,
  describeImport,
  planImport,
  readImportFiles,
  serializeLibrary,
  type ImportFileInput,
  type NoticeTone,
} from './library-io';
import { FilterChip, IconButton, SelectBox } from './library-ui';
import { downloadTextFile, readFileText } from './file-download';
import { NEW_ICON_ID, asRoute, editorPath } from './routes';
import { SyncBanner } from './sync-banner';

const PREFS_KEY = 'svndts-brand-library-prefs-v1';
const SORT_OPTIONS = (Object.keys(SORT_LABELS) as SortKey[]).map((value) => ({ value, label: SORT_LABELS[value] }));

interface Prefs {
  readonly mode?: ViewMode;
  readonly sort?: SortKey;
}

function readPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return {
      mode: data.mode === 'list' || data.mode === 'grid' ? data.mode : undefined,
      sort: data.sort === 'name' || data.sort === 'updated' ? data.sort : undefined,
    };
  } catch {
    return {};
  }
}

function writePrefs(prefs: Prefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...prefs }));
  } catch {
    // Trình duyệt chặn localStorage: bỏ qua, chỉ mất thói quen hiển thị.
  }
}

interface Notice {
  readonly tone: NoticeTone;
  readonly text: string;
  readonly details?: readonly string[];
}

const NOTICE_STYLE: Record<NoticeTone, string> = {
  ok: 'border-emerald-500 bg-emerald-50/60 text-emerald-800',
  warn: 'border-amber-500 bg-amber-50/60 text-amber-800',
  error: 'border-red-500 bg-red-50/60 text-red-800',
};

const SKELETON_COUNT = 12;
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3';

export function IconLibraryPage() {
  const library = useIconLibrary();
  const { palette } = useBrandSettings();

  const [view, setView] = useState<LibraryView>(DEFAULT_VIEW);
  const [mode, setMode] = useState<ViewMode>('grid');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [exportDocs, setExportDocs] = useState<IconDocument[] | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const prefs = readPrefs();
    if (prefs.mode) setMode(prefs.mode);
    if (prefs.sort) setView((current) => ({ ...current, sort: prefs.sort ?? current.sort }));
  }, []);

  const visible = useMemo(() => applyView(library.docs, view), [library.docs, view]);
  const counts = useMemo(() => facetCounts(library.docs, view), [library.docs, view]);
  const filtered = isViewFiltered(view);

  // Chỉ tính các icon vừa được chọn vừa đang hiện: lọc lại thì tự bỏ phần bị ẩn, không thao tác nhầm icon không thấy.
  const picked = useMemo(() => visible.filter((doc) => selected.has(doc.id)), [visible, selected]);
  const pickedPresets = picked.filter((doc) => isPresetId(doc.id)).length;

  const patchView = useCallback((patch: Partial<LibraryView>) => setView((current) => ({ ...current, ...patch })), []);
  const say = useCallback((tone: NoticeTone, text: string, details?: readonly string[]) => setNotice({ tone, text, details }), []);

  const changeMode = (next: ViewMode) => {
    setMode(next);
    writePrefs({ mode: next });
  };
  const changeSort = (value: string) => {
    const sort: SortKey = value === 'name' ? 'name' : 'updated';
    patchView({ sort });
    writePrefs({ sort });
  };

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleAll = (checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const doc of visible) {
        if (checked) next.add(doc.id);
        else next.delete(doc.id);
      }
      return next;
    });

  /** Thao tác có thể lỗi (ghi lên máy chủ): lỗi hiện thành thông báo thay vì bị bỏ qua. */
  const attempt = async (task: () => Promise<void>) => {
    try {
      await task();
    } catch (error) {
      say('error', errorMessage(error));
    }
  };

  // Trên máy chủ "xoá" là lưu trữ: dữ liệu vẫn còn, chỉ không hiện trong thư viện.
  const archiving = library.mode === 'server';

  const handlers = {
    onDuplicate: (doc: IconDocument) =>
      attempt(async () => {
        const copy = await library.duplicate(doc.id);
        if (copy) say('ok', `Đã nhân bản thành "${copy.name}".`);
      }),
    onExport: (doc: IconDocument) => setExportDocs([doc]),
    onRemove: (doc: IconDocument) =>
      attempt(async () => {
        await library.remove(doc.id);
        toggle(doc.id, false);
        say('ok', archiving ? `Đã lưu trữ "${doc.name}".` : `Đã xoá "${doc.name}".`);
      }),
    onReset: (doc: IconDocument) =>
      attempt(async () => {
        await library.resetPreset(doc.id);
        say('ok', `Đã đặt lại "${doc.name}" về bản gốc.`);
      }),
  };

  const resetFilters = () => setView((current) => ({ ...DEFAULT_VIEW, sort: current.sort }));

  const exportCurrent = () => setExportDocs(picked.length > 0 ? picked : [...library.docs]);

  const backup = () => {
    downloadTextFile(backupFileName(), serializeLibrary(library.docs));
    say('ok', `Đã sao lưu ${library.docs.length} icon.`);
  };

  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setImporting(true);
    try {
      const inputs: ImportFileInput[] = [];
      const unreadable: Array<{ file: string; reason: string }> = [];
      for (const file of files) {
        try {
          inputs.push({ name: file.name, text: await readFileText(file) });
        } catch {
          unreadable.push({ file: file.name, reason: 'không đọc được tệp' });
        }
      }
      const report = readImportFiles(inputs);
      const plan = planImport(library.docs, report.docs);
      if (plan.fresh.length > 0) await library.importDocs(plan.fresh);
      const result = describeImport({ ...report, failures: [...unreadable, ...report.failures] }, plan);
      say(result.tone, result.text, result.details);
    } catch (error) {
      say('error', errorMessage(error));
    } finally {
      setImporting(false);
    }
  };

  const setStatusForPicked = (status: IconStatus) =>
    attempt(async () => {
      const changed = picked.filter((doc) => doc.status !== status).map((doc) => ({ ...doc, status }));
      if (changed.length === 0) {
        say('ok', `Các icon đã chọn đều đang ở trạng thái "${STATUS_LABELS[status]}".`);
        return;
      }
      await library.saveMany(changed);
      say('ok', `Đã chuyển ${changed.length} icon sang "${STATUS_LABELS[status]}".`);
    });

  const removePicked = () =>
    attempt(async () => {
      const removed = await library.removeMany(picked.map((doc) => doc.id));
      setSelected(new Set());
      const verb = archiving ? 'lưu trữ' : 'xoá';
      say('ok', pickedPresets > 0 ? `Đã ${verb} ${removed} icon, giữ lại ${pickedPresets} icon mẫu.` : `Đã ${verb} ${removed} icon.`);
    });

  const removeDescription = [
    archiving ? 'Icon không còn hiện trong thư viện, dữ liệu vẫn được giữ trên máy chủ.' : 'Không thể hoàn tác.',
    pickedPresets > 0 ? `${pickedPresets} icon mẫu sẽ được giữ lại.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const actionBtn = cn(RAISED, 'px-2.5');
  const total = library.docs.length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Thư viện icon</h1>
          {library.ready ? <span className="text-sm text-slate-500 tabular-nums">{total} icon</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            className={cn(buttonVariants(), RAISED_PRIMARY)}
            href={asRoute(editorPath(NEW_ICON_ID))}
          >
            <Plus aria-hidden className="size-4" />
            Tạo icon mới
          </Link>
          <Button
            className={actionBtn}
            disabled={importing}
            onClick={() => fileInput.current?.click()}
            title="Nhập tệp SVG (nhiều tệp) hoặc JSON sao lưu"
            variant="outline"
          >
            <Upload aria-hidden className="size-4" />
            <span className="hidden lg:inline">Nhập tệp</span>
          </Button>
          <Button
            className={actionBtn}
            disabled={total === 0}
            onClick={backup}
            title="Sao lưu toàn bộ thư viện ra tệp JSON"
            variant="outline"
          >
            <FileJson aria-hidden className="size-4" />
            <span className="hidden lg:inline">Sao lưu</span>
          </Button>
          <Button
            className={actionBtn}
            disabled={total === 0}
            onClick={exportCurrent}
            title={picked.length > 0 ? `Xuất ${picked.length} icon đã chọn` : `Xuất tất cả ${total} icon`}
            variant="outline"
          >
            <Download aria-hidden className="size-4" />
            <span className="hidden lg:inline">Xuất</span>
          </Button>
          <input
            accept=".svg,.json,image/svg+xml,application/json"
            aria-hidden
            className="sr-only"
            data-testid="import-input"
            multiple
            onChange={importFiles}
            ref={fileInput}
            tabIndex={-1}
            type="file"
          />
        </div>
      </header>

      <SyncBanner library={library} />

      {notice ? (
        <div
          className={cn('flex items-start gap-2 border-l-2 py-1.5 pl-3 pr-1 text-sm', NOTICE_STYLE[notice.tone])}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          <div className="min-w-0 flex-1">
            <p>{notice.text}</p>
            {notice.details && notice.details.length > 0 ? (
              <ul className="mt-0.5 list-inside list-disc text-xs opacity-80">
                {notice.details.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>
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

      <div
        aria-label="Bộ lọc"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm"
        role="search"
      >
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <ListFilter aria-hidden className="size-4 text-blue-600" />
          Bộ lọc
        </span>
        <div className="relative w-full min-w-48 sm:w-64">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            aria-label="Tìm icon"
            className="h-8 rounded-md border-slate-300 bg-white pl-8 pr-8 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
            onChange={(event) => patchView({ query: event.target.value })}
            placeholder="Tìm theo tên, mô tả, nhãn"
            type="search"
            value={view.query}
          />
          {view.query ? (
            <button
              aria-label="Xoá từ khoá"
              className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-slate-400 hover:text-slate-700"
              onClick={() => patchView({ query: '' })}
              title="Xoá từ khoá"
              type="button"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          ) : null}
        </div>

        <div aria-label="Lọc theo danh mục" className="flex flex-wrap items-center gap-1" role="group">
          {CATEGORY_FILTERS.map((category: CategoryFilter) => (
            <FilterChip
              active={view.category === category}
              count={counts.category[category]}
              key={category}
              onClick={() => patchView({ category })}
            >
              {category === 'all' ? 'Tất cả' : CATEGORY_LABELS[category]}
            </FilterChip>
          ))}
        </div>

        <span aria-hidden className="hidden h-5 w-px bg-slate-200 xl:block" />

        <div aria-label="Lọc theo trạng thái" className="flex flex-wrap items-center gap-1" role="group">
          {(['all', ...STATUSES] as StatusFilter[]).map((status) => (
            <FilterChip active={view.status === status} count={counts.status[status]} key={status} onClick={() => patchView({ status })}>
              {status === 'all' ? 'Mọi trạng thái' : STATUS_LABELS[status]}
            </FilterChip>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="w-36" title="Sắp xếp">
            <SearchableSelect
              clearable={false}
              height={32}
              onChange={changeSort}
              options={SORT_OPTIONS}
              placeholder="Sắp xếp"
              searchInDropdown
              value={view.sort}
            />
          </div>
          <div aria-label="Kiểu hiển thị" className="flex rounded-md border border-slate-300 bg-white p-0.5 shadow-[0_1px_2px_rgba(15,23,42,0.06)]" role="group">
            <IconButton
              aria-pressed={mode === 'grid'}
              className={cn('size-7', mode === 'grid' && 'bg-blue-50 text-blue-700')}
              label="Dạng lưới"
              onClick={() => changeMode('grid')}
            >
              <LayoutGrid aria-hidden className="size-4" />
            </IconButton>
            <IconButton
              aria-pressed={mode === 'list'}
              className={cn('size-7', mode === 'list' && 'bg-blue-50 text-blue-700')}
              label="Dạng danh sách"
              onClick={() => changeMode('list')}
            >
              <List aria-hidden className="size-4" />
            </IconButton>
          </div>
        </div>
      </div>

      {picked.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm shadow-sm" data-testid="bulk-bar">
          <span className="font-medium text-blue-900">Đã chọn {picked.length}</span>
          <span aria-hidden className="h-4 w-px bg-blue-200" />
          <Button className="rounded-md" onClick={() => setExportDocs(picked)} size="sm" variant="ghost">
            <Download aria-hidden />
            Xuất
          </Button>
          <Button className="rounded-md" onClick={() => setStatusForPicked('published')} size="sm" variant="ghost">
            <Check aria-hidden />
            Phát hành
          </Button>
          <Button className="rounded-md" onClick={() => setStatusForPicked('draft')} size="sm" variant="ghost">
            <FilePen aria-hidden />
            Chuyển nháp
          </Button>
          <Popconfirm
            cancelText="Hủy"
            description={removeDescription}
            okText={archiving ? 'Lưu trữ' : 'Xoá'}
            onConfirm={removePicked}
            placement="bottom-start"
            title={`${archiving ? 'Lưu trữ' : 'Xoá'} ${picked.length} icon đã chọn?`}
          >
            <Button className="rounded-md text-red-600 hover:bg-red-50 hover:text-red-700" size="sm" variant="ghost">
              <Trash2 aria-hidden />
              {archiving ? 'Lưu trữ' : 'Xoá'}
            </Button>
          </Popconfirm>
          <IconButton className="ml-auto" label="Bỏ chọn" onClick={() => setSelected(new Set())}>
            <X aria-hidden className="size-4" />
          </IconButton>
        </div>
      ) : null}

      <Panel
        actions={
          library.ready && visible.length > 0 ? (
            <>
              {mode === 'grid' ? (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                  <SelectBox
                    checked={picked.length === visible.length}
                    indeterminate={picked.length > 0}
                    label="Chọn tất cả icon đang hiện"
                    onChange={toggleAll}
                  />
                  <span className="hidden sm:inline">Chọn tất cả</span>
                </label>
              ) : null}
              {filtered ? (
                <button
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                  onClick={resetFilters}
                  type="button"
                >
                  Xoá bộ lọc
                </button>
              ) : null}
              <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium tabular-nums text-slate-600 ring-1 ring-inset ring-slate-200">
                {filtered ? `${visible.length} / ${total} icon` : `${visible.length} icon`}
              </span>
            </>
          ) : null
        }
        flush={mode === 'list' && library.ready && visible.length > 0}
        hint="Bấm vào icon để mở trình thiết kế"
        icon={Images}
        id="icons-title"
        title="Icon"
      >
        {!library.ready ? (
          <ul aria-busy="true" aria-label="Đang tải thư viện" className={GRID}>
            {Array.from({ length: SKELETON_COUNT }, (_, index) => (
              <li className="animate-pulse rounded-md border border-slate-100 p-2" key={index}>
                <div className="aspect-square rounded bg-slate-100" />
                <div className="mt-2 h-3.5 w-3/4 rounded bg-slate-100" />
                <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
              </li>
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-slate-500" data-testid="empty-state">
            <span className="grid size-14 place-items-center rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200">
              <SearchX aria-hidden className="size-7 text-slate-400" />
            </span>
            <p className="text-sm">{filtered ? 'Không có icon phù hợp.' : 'Thư viện chưa có icon.'}</p>
            {filtered ? (
              <Button className={RAISED} onClick={resetFilters} size="sm" variant="outline">
                Xoá bộ lọc
              </Button>
            ) : (
              <Link className={cn(buttonVariants({ size: 'sm' }), RAISED_PRIMARY)} href={asRoute(editorPath(NEW_ICON_ID))}>
                <Plus aria-hidden />
                Tạo icon mới
              </Link>
            )}
          </div>
        ) : mode === 'grid' ? (
          <ul className={GRID} data-testid="icon-grid">
            {visible.map((doc) => (
              <IconTile
                doc={doc}
                key={doc.id}
                onSelect={(checked) => toggle(doc.id, checked)}
                palette={palette}
                preset={isPresetId(doc.id)}
                selected={selected.has(doc.id)}
                {...handlers}
              />
            ))}
          </ul>
        ) : (
          <IconList
            docs={visible}
            isPreset={isPresetId}
            onSelect={toggle}
            onSelectAll={toggleAll}
            palette={palette}
            selected={selected}
            {...handlers}
          />
        )}
      </Panel>

      <ExportDialog docs={exportDocs ?? []} onClose={() => setExportDocs(null)} open={exportDocs !== null} palette={palette} />
    </div>
  );
}
