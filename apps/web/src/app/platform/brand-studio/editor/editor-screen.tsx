'use client';

import {
  checkCompliance,
  createEditorState,
  editorReducer,
  type BrandPalette,
  type BrandRules,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';
import { toast } from '@enterprise-platform/shared-ui';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { ExportDialog } from '../export/export-dialog';
import { LIBRARY_PATH, NEW_ICON_ID, asRoute, editorPath } from '../library/routes';
import { copyText } from '../export/download';
import { newBlankIcon, useBrandSettings, useIconLibrary, type IconLibrary } from '../store';
import { errorMessage, isBrandApiError } from '../store/brand-api';
import { makeCopy } from '../store/doc-utils';
import { ConflictDialog } from './conflict-dialog';
import { EditorCanvas } from './editor-canvas';
import { EditorToolbar } from './editor-toolbar';
import { EditorTopbar } from './editor-topbar';
import { CompliancePanel } from './panels/compliance-panel';
import { InsertPanel } from './panels/insert-panel';
import { LayersPanel } from './panels/layers-panel';
import { PreviewPanel } from './panels/preview-panel';
import { PropertiesPanel } from './panels/properties-panel';
import type { EditorTool } from './tool';
import { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR, useCanvasViewport } from './use-canvas-viewport';
import { useEditorPrefs } from './use-editor-prefs';

/** Chiều cao vùng làm việc: vừa phần còn lại của màn hình dưới khung chung của Platform Admin. */
const WORKSPACE_HEIGHT = 'h-[calc(100dvh-7.5rem)] min-h-[560px]';

/** Khung chờ khi kho icon đang đọc (tránh nháy giao diện lúc hydrate). */
function EditorSkeleton() {
  return (
    <div aria-busy="true" aria-label="Đang tải trình thiết kế" className={`flex flex-col overflow-hidden rounded-md border border-slate-200 bg-white ${WORKSPACE_HEIGHT}`}>
      <div className="h-12 shrink-0 animate-pulse border-b border-slate-200 bg-slate-50" />
      <div className="flex min-h-0 flex-1">
        <div className="w-11 shrink-0 animate-pulse border-r border-slate-200 bg-slate-50" />
        <div className="flex-1 animate-pulse bg-slate-100" />
        <div className="w-80 shrink-0 animate-pulse border-l border-slate-200 bg-slate-50" />
      </div>
    </div>
  );
}

function EditorNotFound() {
  return (
    <div className="flex flex-col items-start gap-3 py-10">
      <p className="text-sm text-slate-700">Không tìm thấy icon này. Có thể icon đã bị xoá.</p>
      <Link
        className="inline-flex h-8 items-center rounded-md bg-blue-600 px-3 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        href={asRoute(LIBRARY_PATH)}
      >
        Về thư viện
      </Link>
    </div>
  );
}

function PanelSection({
  id,
  title,
  open,
  onToggle,
  badge,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="border-b border-slate-200 last:border-b-0">
      <button
        aria-controls={`editor-section-${id}`}
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-1.5 px-3 text-left text-xs font-semibold text-slate-600 outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/60"
        onClick={onToggle}
        type="button"
      >
        <Chevron aria-hidden="true" className="size-3.5 text-slate-400" />
        <span className="flex-1">{title}</span>
        {badge}
      </button>
      {open ? (
        <div className="px-3 pb-3 pt-1" id={`editor-section-${id}`}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** Số vấn đề quy chuẩn ở tiêu đề mục: đỏ nếu có lỗi, vàng nếu có cảnh báo, dấu tích nếu đạt. */
function ComplianceBadge({ doc, palette, rules }: { doc: IconDocument; palette: BrandPalette; rules: BrandRules }) {
  const issues = useMemo(() => checkCompliance(doc, palette, rules), [doc, palette, rules]);
  if (issues.length === 0) return <Check aria-label="Đạt quy chuẩn" className="size-3.5 text-emerald-600" />;
  const hasError = issues.some((issue) => issue.severity === 'error');
  const hasWarning = issues.some((issue) => issue.severity === 'warning');
  const tone = hasError ? 'bg-red-50 text-red-700' : hasWarning ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600';
  return (
    <span aria-label={`${issues.length} điểm cần xem`} className={`rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${tone}`}>
      {issues.length}
    </span>
  );
}

interface EditorWorkspaceProps {
  readonly initialDoc: IconDocument;
  /** Đang ở đường dẫn vẽ icon mới: lần lưu đầu tiên chuyển sang đường dẫn của icon vừa lưu. */
  readonly routeIsNew: boolean;
  readonly library: IconLibrary;
  readonly palette: BrandPalette;
  readonly rules: BrandRules;
  /** Đã nạp lại bản mới nhất từ máy chủ: màn hình ngoài dựng lại trình thiết kế từ bản đó. */
  readonly onReloaded: () => void;
}

function EditorWorkspace({ initialDoc, routeIsNew, library, palette, rules, onReloaded }: EditorWorkspaceProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(editorReducer, initialDoc, createEditorState);
  const [tool, setTool] = useState<EditorTool>('select');
  const [prefs, updatePrefs] = useEditorPrefs();
  const viewport = useCanvasViewport(state.doc.size);
  const [exportOpen, setExportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [conflict, setConflict] = useState<{ readonly currentVersion: number | null } | null>(null);
  const [resolving, setResolving] = useState(false);

  const stateRef = useRef(state);
  const libraryRef = useRef(library);
  const savingRef = useRef(false);
  /** Trạng thái (nháp/phát hành) của icon lúc mở hoặc lúc lưu gần nhất: để biết người dùng có chủ ý đổi trạng thái hay không. */
  const baseStatusRef = useRef(initialDoc.status);
  useEffect(() => {
    stateRef.current = state;
    libraryRef.current = library;
  });

  const isNew = !library.docs.some((item) => item.id === state.doc.id);
  const info = library.serverInfo(state.doc.id);

  const save = async () => {
    const current = stateRef.current;
    const stored = libraryRef.current;
    if (savingRef.current || (!current.dirty && stored.get(current.doc.id))) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Người dùng không đụng tới trạng thái thì giữ trạng thái mới nhất trong kho, để lưu nội dung không vô tình
      // gỡ phát hành một icon mà người khác vừa phát hành.
      const latest = stored.get(current.doc.id);
      const untouched = latest !== undefined && current.doc.status === baseStatusRef.current;
      const saved = await stored.save(untouched ? { ...current.doc, status: latest.status } : current.doc);
      baseStatusRef.current = saved.status;
      if (saved.status !== current.doc.status) dispatch({ type: 'setMeta', patch: { status: saved.status } });
      dispatch({ type: 'markSaved' });
      if (routeIsNew) router.replace(asRoute(editorPath(saved.id)));
    } catch (error) {
      if (isBrandApiError(error) && error.isVersionConflict) setConflict({ currentVersion: error.currentVersion ?? null });
      else toast.error(errorMessage(error, 'Không lưu được icon. Thử lại sau.'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const publish = async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      const published = await libraryRef.current.publish(stateRef.current.doc.id);
      if (published) {
        baseStatusRef.current = published.status;
        if (stateRef.current.doc.status !== published.status) dispatch({ type: 'setMeta', patch: { status: published.status } });
        dispatch({ type: 'markSaved' });
        toast.success('Đã phát hành.');
      }
    } catch (error) {
      toast.error(errorMessage(error, 'Không phát hành được icon. Thử lại sau.'));
    } finally {
      setPublishing(false);
    }
  };

  const copyPublicLink = async () => {
    if (!info?.publicSvgUrl) return;
    const copied = await copyText(new URL(info.publicSvgUrl, window.location.origin).toString());
    if (copied) toast.success('Đã chép đường dẫn SVG.');
    else toast.error('Không chép được đường dẫn.');
  };

  const reloadLatest = async () => {
    setResolving(true);
    try {
      await libraryRef.current.reloadFromServer(stateRef.current.doc.id);
      setConflict(null);
      onReloaded();
    } catch (error) {
      toast.error(errorMessage(error, 'Không tải được bản mới nhất.'));
    } finally {
      setResolving(false);
    }
  };

  const keepMine = async () => {
    setResolving(true);
    try {
      const saved = await libraryRef.current.save(makeCopy(stateRef.current.doc, 'bản của tôi'));
      setConflict(null);
      toast.success(`Đã lưu thành icon mới "${saved.name}".`);
      router.replace(asRoute(editorPath(saved.id)));
    } catch (error) {
      toast.error(errorMessage(error, 'Không lưu được icon. Thử lại sau.'));
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    if (!state.dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state.dirty]);

  const toggleSection = (id: string) => updatePrefs({ collapsed: { ...prefs.collapsed, [id]: !prefs.collapsed[id] } });
  const isOpen = (id: string) => !prefs.collapsed[id];

  // Bảng xem trước và quy chuẩn không cần theo kịp từng khung hình khi kéo.
  const deferredDoc = useDeferredValue(state.doc);
  const exportDocs = useMemo(() => [state.doc], [state.doc]);
  const panelProps = { state, dispatch, palette, rules };

  return (
    <div className={`flex flex-col overflow-hidden rounded-md border border-slate-200 bg-white ${WORKSPACE_HEIGHT}`}>
      <EditorTopbar
        canRedo={state.future.length > 0 && !state.gesture}
        canUndo={state.past.length > 0 && !state.gesture}
        dirty={state.dirty}
        displayMode={prefs.displayMode}
        doc={state.doc}
        isNew={isNew}
        onDisplayModeChange={(displayMode) => updatePrefs({ displayMode })}
        onExport={() => setExportOpen(true)}
        onFit={viewport.fit}
        onRedo={() => dispatch({ type: 'redo' })}
        onRename={(name) => dispatch({ type: 'setMeta', patch: { name } })}
        onCopyLink={() => void copyPublicLink()}
        onPublish={() => void publish()}
        onSave={() => void save()}
        onShowGridChange={(showGrid) => updatePrefs({ showGrid })}
        onSnapGridChange={(snapGrid) => updatePrefs({ snapGrid })}
        onSnapObjectsChange={(snapObjects) => updatePrefs({ snapObjects })}
        onUndo={() => dispatch({ type: 'undo' })}
        onZoomIn={() => viewport.zoomBy(ZOOM_IN_FACTOR)}
        onZoomOut={() => viewport.zoomBy(ZOOM_OUT_FACTOR)}
        publishing={publishing}
        saving={saving}
        serverInfo={info}
        showGrid={prefs.showGrid}
        snapGrid={prefs.snapGrid}
        snapObjects={prefs.snapObjects}
        zoomPercent={viewport.percent}
      />

      <div className="flex min-h-0 flex-1">
        <EditorToolbar onToolChange={setTool} tool={tool} />

        <div className="min-w-0 flex-1">
          <EditorCanvas
            dispatch={dispatch}
            displayMode={prefs.displayMode}
            keyboardEnabled={!exportOpen}
            onPolygonSidesChange={(polygonSides) => updatePrefs({ polygonSides })}
            onSave={() => void save()}
            onToolChange={setTool}
            palette={palette}
            polygonSides={prefs.polygonSides}
            rules={rules}
            showGrid={prefs.showGrid}
            snapGrid={prefs.snapGrid}
            snapObjects={prefs.snapObjects}
            state={state}
            tool={tool}
            viewport={viewport}
          />
        </div>

        <aside aria-label="Bảng thiết kế" className="w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white">
          <PanelSection id="properties" onToggle={() => toggleSection('properties')} open={isOpen('properties')} title="Thuộc tính">
            <PropertiesPanel {...panelProps} />
          </PanelSection>
          <PanelSection id="insert" onToggle={() => toggleSection('insert')} open={isOpen('insert')} title="Chèn hình">
            <InsertPanel {...panelProps} />
          </PanelSection>
          <PanelSection id="layers" onToggle={() => toggleSection('layers')} open={isOpen('layers')} title="Lớp">
            <LayersPanel {...panelProps} />
          </PanelSection>
          <PanelSection id="preview" onToggle={() => toggleSection('preview')} open={isOpen('preview')} title="Xem trước">
            <PreviewPanel doc={deferredDoc} palette={palette} />
          </PanelSection>
          <PanelSection
            badge={<ComplianceBadge doc={deferredDoc} palette={palette} rules={rules} />}
            id="compliance"
            onToggle={() => toggleSection('compliance')}
            open={isOpen('compliance')}
            title="Quy chuẩn"
          >
            <CompliancePanel
              doc={deferredDoc}
              onSelectShape={(id) => dispatch({ type: 'select', ids: [id] })}
              palette={palette}
              rules={rules}
            />
          </PanelSection>
        </aside>
      </div>

      <ExportDialog docs={exportDocs} onClose={() => setExportOpen(false)} open={exportOpen} palette={palette} />
      <ConflictDialog
        busy={resolving}
        currentVersion={conflict?.currentVersion ?? null}
        onClose={() => setConflict(null)}
        onKeepMine={() => void keepMine()}
        onReload={() => void reloadLatest()}
        open={conflict !== null}
      />
    </div>
  );
}

/**
 * Màn hình trình thiết kế icon. `iconId` là mã icon trong thư viện hoặc `new` để vẽ icon mới (lưu lần đầu sẽ chuyển sang
 * đường dẫn của icon vừa lưu). Phần làm việc chỉ dựng khi kho icon đã sẵn sàng, và dựng lại từ đầu khi đổi sang icon khác.
 */
export function EditorScreen({ iconId }: { iconId: string }) {
  const library = useIconLibrary();
  const settings = useBrandSettings();
  const blank = useRef<IconDocument | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  if (iconId !== NEW_ICON_ID) blank.current = null;
  else if (blank.current === null) blank.current = newBlankIcon();

  if (!library.ready || !settings.ready) return <EditorSkeleton />;
  const doc = iconId === NEW_ICON_ID ? blank.current : library.get(iconId);
  if (!doc) return <EditorNotFound />;

  return (
    <EditorWorkspace
      key={`${doc.id}:${reloadToken}`}
      initialDoc={doc}
      library={library}
      onReloaded={() => setReloadToken((token) => token + 1)}
      palette={settings.palette}
      routeIsNew={iconId === NEW_ICON_ID}
      rules={settings.rules}
    />
  );
}
