'use client';

import type { IconDocument, IconStatus } from '@enterprise-platform/shared-brand-icon';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import {
  Check,
  Download,
  FileJson,
  FilePen,
  Images,
  ListChecks,
  Plus,
  SearchX,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Hint } from '../components/hint';
import { Panel, RAISED, RAISED_PRIMARY } from '../components/panel';
import { useFillViewportHeight } from '../components/use-fill-viewport';
import { useMediaQuery } from '../components/use-media-query';
import { ExportDialog } from '../export/export-dialog';
import { isPresetId, useBrandSettings, useIconLibrary } from '../store';
import { errorMessage } from '../store/brand-api';
import { IconList } from './icon-list';
import { IconTile } from './icon-tile';
import {
  DEFAULT_VIEW,
  STATUS_LABELS,
  applyView,
  facetCounts,
  isViewFiltered,
  type LibraryView,
  type SortKey,
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
import { LibraryPagerBar } from './library-pager-bar';
import {
  DEFAULT_PAGE_SIZE,
  normalizePageSize,
  pageAfterSizeChange,
  pageKey,
  paginate,
  readMemory,
  rememberPage,
  writeMemory,
  type LibraryMemory,
} from './library-pager';
import { LibraryToolbar } from './library-toolbar';
import { IconButton, SelectBox } from './library-ui';
import { downloadTextFile, readFileText } from './file-download';
import { NEW_ICON_ID, asRoute, editorPath } from './routes';
import { SyncBanner } from './sync-banner';

const PREFS_KEY = 'svndts-brand-library-prefs-v1';

interface Prefs {
  readonly mode?: ViewMode;
  readonly sort?: SortKey;
  readonly pageSize?: number;
}

function readPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return {
      mode: data.mode === 'list' || data.mode === 'grid' ? data.mode : undefined,
      sort: data.sort === 'name' || data.sort === 'updated' ? data.sort : undefined,
      pageSize: typeof data.pageSize === 'number' ? normalizePageSize(data.pageSize) : undefined,
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
/** Khoảng trống (px) giữa đáy khối icon và đáy màn hình; nhỏ hơn phần đệm của khung trang nên khối cao gần hết màn hình. */
const CARD_BOTTOM_GAP = 12;
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3';

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

  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  /** Trang đang xem của từng tổ hợp bộ lọc: đổi bộ lọc rồi quay lại thì về đúng trang cũ. */
  const [pages, setPages] = useState<Readonly<Record<string, number>>>({});
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Vị trí cuộn đã lưu, áp dụng một lần khi dữ liệu đã có. */
  const pendingScroll = useRef(0);
  const scrollTopRef = useRef(0);
  const memoryRef = useRef<Pick<LibraryMemory, 'filters' | 'pages'> | null>(null);
  // Đã nạp xong chỗ đang xem từ lần trước; trước đó chưa được ghi đè bộ nhớ bằng giá trị mặc định.
  const [restored, setRestored] = useState(false);
  const restoredRef = useRef(false);
  useEffect(() => {
    restoredRef.current = restored;
  }, [restored]);

  // Thói quen hiển thị (lưu lâu dài) và chỗ đang xem trong phiên (bộ lọc, trang, vị trí cuộn) chỉ đọc sau khi hydrate,
  // để HTML dựng trên máy chủ và lần vẽ đầu ở trình duyệt giống nhau.
  useEffect(() => {
    const prefs = readPrefs();
    const memory = readMemory();
    if (prefs.mode) setMode(prefs.mode);
    if (prefs.pageSize) setPageSize(prefs.pageSize);
    setView((current) => ({ ...current, ...memory.filters, sort: prefs.sort ?? current.sort }));
    setPages(memory.pages);
    pendingScroll.current = memory.scrollTop;
    scrollTopRef.current = memory.scrollTop;
    setRestored(true);
  }, []);

  const visible = useMemo(() => applyView(library.docs, view), [library.docs, view]);
  const currentKey = pageKey(view, pageSize);
  const slice = useMemo(() => paginate(visible, pages[currentKey] ?? 1, pageSize), [visible, pages, currentKey, pageSize]);
  const counts = useMemo(() => facetCounts(library.docs, view), [library.docs, view]);
  const filtered = isViewFiltered(view);

  // Chỉ tính các icon vừa được chọn vừa đang hiện: lọc lại thì tự bỏ phần bị ẩn, không thao tác nhầm icon không thấy.
  const picked = useMemo(() => visible.filter((doc) => selected.has(doc.id)), [visible, selected]);
  const pickedPresets = picked.filter((doc) => isPresetId(doc.id)).length;

  const patchView = useCallback((patch: Partial<LibraryView>) => setView((current) => ({ ...current, ...patch })), []);

  const goToPage = (page: number) => setPages((current) => rememberPage(current, currentKey, page));
  const changePageSize = (size: number) => {
    const nextPage = pageAfterSizeChange(slice.page, pageSize, size);
    setPageSize(size);
    setPages((current) => rememberPage(current, pageKey(view, size), nextPage));
    writePrefs({ pageSize: size });
  };

  // Nhớ chỗ đang xem để quay lại từ trình thiết kế vẫn đúng bộ lọc, trang và vị trí cuộn.
  memoryRef.current = { filters: { query: view.query, category: view.category, status: view.status }, pages };
  const persistMemory = useCallback(() => {
    if (restoredRef.current && memoryRef.current) writeMemory({ ...memoryRef.current, scrollTop: scrollTopRef.current });
  }, []);
  useEffect(persistMemory, [persistMemory, restored, view.query, view.category, view.status, pages]);
  useEffect(() => persistMemory, [persistMemory]);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return undefined;
    let frame = 0;
    const onScroll = () => {
      scrollTopRef.current = body.scrollTop;
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          persistMemory();
        });
      }
    };
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      body.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [persistMemory]);

  // Khối icon cao vừa phần màn hình còn lại; nội dung dài chỉ cuộn trong khối, không cuộn cả trang.
  // Màn hình hẹp (điện thoại) để khối cao tự nhiên và trang cuộn như thường: khung cuộn nhỏ lồng trong trang khó thao tác bằng tay.
  const wide = useMediaQuery('(min-width: 768px)');
  useFillViewportHeight(panelRef, 360, undefined, wide, CARD_BOTTOM_GAP);

  // Chuyển trang hoặc đổi bộ lọc thì về đầu khối; lần đầu thì khôi phục vị trí cuộn đã lưu khi dữ liệu đã có.
  const shownPage = useRef('');
  useEffect(() => {
    const body = bodyRef.current;
    if (!library.ready || !restored || !body) return;
    const token = `${currentKey}#${slice.page}`;
    if (pendingScroll.current > 0) {
      body.scrollTop = pendingScroll.current;
      pendingScroll.current = 0;
    } else if (shownPage.current && shownPage.current !== token) {
      body.scrollTop = 0;
    }
    shownPage.current = token;
  }, [library.ready, restored, currentKey, slice.page]);
  const say = useCallback((tone: NoticeTone, text: string, details?: readonly string[]) => setNotice({ tone, text, details }), []);

  const changeMode = (next: ViewMode) => {
    setMode(next);
    writePrefs({ mode: next });
  };
  const changeSort = (sort: SortKey) => {
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

  /** Ô tick đầu khối chọn hoặc bỏ chọn các icon của trang đang xem; chọn cả danh sách đã lọc dùng nút ở thanh chọn. */
  const toggleAll = (checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const doc of slice.items) {
        if (checked) next.add(doc.id);
        else next.delete(doc.id);
      }
      return next;
    });

  const selectAllVisible = () =>
    setSelected((current) => {
      const next = new Set(current);
      for (const doc of visible) next.add(doc.id);
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

  // Thao tác hàng loạt nằm ngay trong thanh tiêu đề của khối icon (chỗ trống giữa tiêu đề và bộ đếm): hiện ra khi có icon được
  // chọn mà không đẩy nội dung xuống, nên chọn icon không làm trang nhảy. Màn hình hẹp chỉ còn biểu tượng (nhãn vẫn là tên nút).
  const bulkToolbar =
    picked.length > 0 ? (
      <div className="flex min-w-0 items-center gap-0.5 rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-xs" data-testid="bulk-bar">
        <span className="shrink-0 whitespace-nowrap px-1 font-medium text-blue-900">Đã chọn {picked.length}</span>
        {slice.pages > 1 && picked.length < visible.length ? (
          <Hint label={`Chọn cả ${visible.length} icon`}>
            <Button aria-label={`Chọn cả ${visible.length} icon`} className="rounded-md" onClick={selectAllVisible} size="sm" variant="ghost">
              <ListChecks aria-hidden />
              <span className="max-xl:hidden">Chọn cả {visible.length} icon</span>
            </Button>
          </Hint>
        ) : null}
        <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-blue-200" />
        <Hint label="Xuất">
          <Button aria-label="Xuất" className="rounded-md" onClick={() => setExportDocs(picked)} size="sm" variant="ghost">
            <Download aria-hidden />
            <span className="max-xl:hidden">Xuất</span>
          </Button>
        </Hint>
        <Hint label="Phát hành">
          <Button aria-label="Phát hành" className="rounded-md" onClick={() => setStatusForPicked('published')} size="sm" variant="ghost">
            <Check aria-hidden />
            <span className="max-xl:hidden">Phát hành</span>
          </Button>
        </Hint>
        <Hint label="Chuyển nháp">
          <Button aria-label="Chuyển nháp" className="rounded-md" onClick={() => setStatusForPicked('draft')} size="sm" variant="ghost">
            <FilePen aria-hidden />
            <span className="max-xl:hidden">Chuyển nháp</span>
          </Button>
        </Hint>
        <Popconfirm
          cancelText="Hủy"
          description={removeDescription}
          okText={archiving ? 'Lưu trữ' : 'Xoá'}
          onConfirm={removePicked}
          placement="bottom-end"
          title={`${archiving ? 'Lưu trữ' : 'Xoá'} ${picked.length} icon đã chọn?`}
        >
          <Hint label={archiving ? 'Lưu trữ' : 'Xoá'}>
            <Button aria-label={archiving ? 'Lưu trữ' : 'Xoá'} className="rounded-md text-red-600 hover:bg-red-50 hover:text-red-700" size="sm" variant="ghost">
              <Trash2 aria-hidden />
              <span className="max-xl:hidden">{archiving ? 'Lưu trữ' : 'Xoá'}</span>
            </Button>
          </Hint>
        </Popconfirm>
        <IconButton label="Bỏ chọn" onClick={() => setSelected(new Set())}>
          <X aria-hidden className="size-4" />
        </IconButton>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
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
          <Hint label="Nhập tệp SVG (nhiều tệp) hoặc JSON sao lưu">
            <Button
              aria-label="Nhập tệp"
              className={actionBtn}
              disabled={importing}
              onClick={() => fileInput.current?.click()}
              variant="outline"
            >
              <Upload aria-hidden className="size-4" />
              <span className="hidden lg:inline">Nhập tệp</span>
            </Button>
          </Hint>
          <Hint label="Sao lưu toàn bộ thư viện ra tệp JSON">
            <Button
              aria-label="Sao lưu"
              className={actionBtn}
              disabled={total === 0}
              onClick={backup}
              variant="outline"
            >
              <FileJson aria-hidden className="size-4" />
              <span className="hidden lg:inline">Sao lưu</span>
            </Button>
          </Hint>
          <Hint label={picked.length > 0 ? `Xuất ${picked.length} icon đã chọn` : `Xuất tất cả ${total} icon`}>
            <Button
              aria-label={picked.length > 0 ? `Xuất ${picked.length} icon đã chọn` : `Xuất tất cả ${total} icon`}
              className={actionBtn}
              disabled={total === 0}
              onClick={exportCurrent}
              variant="outline"
            >
              <Download aria-hidden className="size-4" />
              <span className="hidden lg:inline">Xuất</span>
            </Button>
          </Hint>
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

      <LibraryToolbar
        counts={counts}
        mode={mode}
        onChange={patchView}
        onMode={changeMode}
        onSort={changeSort}
        view={view}
      />

      <Panel
        toolbar={bulkToolbar}
        actions={
          library.ready && visible.length > 0 ? (
            <>
              {mode === 'grid' ? (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                  <SelectBox
                    checked={slice.items.length > 0 && slice.items.every((doc) => selected.has(doc.id))}
                    indeterminate={slice.items.some((doc) => selected.has(doc.id))}
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
        bodyRef={bodyRef}
        fill={wide}
        flush={mode === 'list' && library.ready && visible.length > 0}
        footer={library.ready && visible.length > 0 ? <LibraryPagerBar onPage={goToPage} onPageSize={changePageSize} slice={slice} /> : null}
        hint="Bấm vào icon để mở trình thiết kế"
        icon={Images}
        id="icons-title"
        sectionRef={panelRef}
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
            {slice.items.map((doc) => (
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
            docs={slice.items}
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
