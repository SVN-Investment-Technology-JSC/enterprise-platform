'use client';

/**
 * Trình thiết kế bố cục in của mẫu báo giá (phase 3, plan mục 9.3; task P3C3-02 đến P3C3-08).
 *
 * Màn phủ toàn màn hình, không thêm route: thanh trên (khổ, hướng, font, cỡ chữ, lề, dữ liệu mẫu, hoàn tác, xuất, menu "…",
 * Đóng, Lưu); trái là thư viện khối; giữa là trang `QuoteLayoutView mode="design"` kéo thả được; phải là thuộc tính.
 * Lưu: kiểm bằng `validateQuoteLayout` ở web trước, gửi `expectedUpdatedAt` để chống ghi đè (409). Server kiểm quyền
 * `crm.manage` lại; nút mở trình thiết kế chỉ hiện với quyền đó.
 */
import {
  QUOTE_LAYOUT_CONFLICT_CODE,
  defaultQuoteLayout,
  validateQuoteLayout,
  type CustomFieldDefinition,
  type QuoteLayout,
  type QuoteLayoutBlock,
  type QuoteLayoutBlockType,
  type QuoteLayoutError,
  type QuoteTemplate,
  type QuoteTemplateLayout,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Copy,
  Ellipsis,
  FileDown,
  FileUp,
  Loader2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  Redo2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { CrmDialog } from '../components/crm-ui';
import { errorMessage, getQuoteTemplateLayout, listQuoteCustomFields, saveQuoteTemplateLayout, type CrmApiError } from '../crm-api';
import { clearTemplateLayoutCache } from './use-template-layout';
import {
  LAYOUT_IMPORT_MAX_BYTES,
  LAYOUT_IMPORT_TOO_LARGE_MESSAGE,
  addBlock,
  blockIndex,
  blockIndexFromPath,
  canRedo,
  canUndo,
  commitLayout,
  createBlock,
  createLayoutHistory,
  duplicateBlock,
  endTyping,
  errorsByBlock,
  insertBlockAt,
  layoutExportFileName,
  layoutJsonFileName,
  moveBlockBy,
  moveBlockToGap,
  parseLayoutJson,
  redoLayout,
  removeBlock,
  undoLayout,
  updateBlock,
  updatePage,
  type BlockPatch,
  type LayoutHistory,
  type PagePatch,
} from './layout-designer.model';
import styles from './layout-designer.module.scss';
import { FONT_OPTIONS, FONT_SIZE_OPTIONS, LayoutInspector, ORIENTATION_OPTIONS, PAPER_OPTIONS } from './layout-inspector';
import { NumberField } from './layout-fields';
import { LayoutPalette } from './layout-palette';
import { ExportMenu } from './export-menu';
import { emptyQuoteLayoutData, sampleQuoteLayoutData } from './quote-layout.data';
import { QuoteLayoutView, quoteLayoutPageSize } from './quote-layout-view';

const BLOCK_DRAG_TYPE = 'application/x-quote-layout-block-id';
const MM_TO_PX = 96 / 25.4;
export const DISCARD_CHANGES_QUESTION = 'Bỏ các thay đổi chưa lưu?';
export const CONFLICT_MESSAGE = 'Mẫu vừa được người khác sửa. Tải lại để xem bản mới.';
export const LAYOUT_TOO_LARGE_MESSAGE = 'Bố cục quá lớn.';

export interface LayoutDesignerProps {
  readonly template: Pick<QuoteTemplate, 'id' | 'name'>;
  readonly onClose: () => void;
  /** Sau khi lưu hoặc xoá bố cục: màn gọi tải lại danh sách mẫu để cột "Bố cục" đúng. */
  readonly onSaved?: (result: QuoteTemplateLayout) => void;
}

type DragItem = { readonly kind: 'new'; readonly type: QuoteLayoutBlockType } | { readonly kind: 'move'; readonly id: string };
type Dialog = 'close' | 'delete' | 'conflict';
interface ImportProblem {
  readonly message: string;
  readonly errors: readonly QuoteLayoutError[];
}

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

/** Phím tắt bỏ qua khi con trỏ đang ở ô nhập chữ: `Delete`, `Ctrl+Z` là của ô đó. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  const tag = element.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes((element as HTMLInputElement).type);
  return Boolean(element.closest?.('[role="combobox"], [role="listbox"]'));
}

function readFileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file, 'utf-8');
  });
}

function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Đóng khi bấm ra ngoài phần tử hoặc bấm Esc. */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref, close]);
}

function ToolButton({ label, onClick, disabled, children, showLabel = false }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; showLabel?: boolean }) {
  return (
    <button type="button" className={styles.toolButton} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
      {showLabel ? <span>{label}</span> : null}
    </button>
  );
}

export function LayoutDesigner({ template, onClose, onSaved }: LayoutDesignerProps) {
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadError, setLoadError] = useState<string>();
  const [history, setHistory] = useState<LayoutHistory>(() => createLayoutHistory(defaultQuoteLayout()));
  const [saved, setSaved] = useState<QuoteLayout>(history.present);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [hasStored, setHasStored] = useState(false);
  const [customFields, setCustomFields] = useState<readonly CustomFieldDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSample, setShowSample] = useState(true);
  const [checked, setChecked] = useState<{ layout: QuoteLayout; errors: readonly QuoteLayoutError[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [importProblem, setImportProblem] = useState<ImportProblem | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [marginsOpen, setMarginsOpen] = useState(false);
  const [dropGap, setDropGap] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const dragItem = useRef<DragItem | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const importInput = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const marginsRef = useRef<HTMLDivElement | null>(null);

  const present = history.present;
  const dirty = status === 'ready' && present !== saved;
  const selectedIndex = blockIndex(present, selectedId);
  const selectedBlock: QuoteLayoutBlock | null = selectedIndex >= 0 ? present.blocks[selectedIndex] : null;
  const activeFields = useMemo(() => customFields.filter((field) => field.active), [customFields]);
  const sampleData = useMemo(() => sampleQuoteLayoutData(customFields), [customFields]);
  const viewData = useMemo(() => (showSample ? sampleData : emptyQuoteLayoutData()), [showSample, sampleData]);

  const errors = useMemo<readonly QuoteLayoutError[]>(() => {
    if (!checked) return [];
    if (checked.layout === present) return checked.errors;
    const result = validateQuoteLayout(present);
    return result.ok ? [] : result.errors;
  }, [checked, present]);
  const blockErrors = useMemo(() => errorsByBlock(present, errors), [present, errors]);
  const pageErrors = useMemo(() => errors.filter((error) => blockIndexFromPath(error.path) === null), [errors]);

  useEffect(() => {
    if (checked && errors.length === 0) setChecked(null);
  }, [checked, errors]);

  // ---------------------------------------------------------------------------
  // Tải, khung
  // ---------------------------------------------------------------------------

  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError(undefined);
    try {
      const [stored, fields] = await Promise.all([
        getQuoteTemplateLayout(template.id),
        listQuoteCustomFields().catch(() => [] as CustomFieldDefinition[]),
      ]);
      const layout = stored.layout ?? defaultQuoteLayout();
      setHistory(createLayoutHistory(layout));
      setSaved(layout);
      setUpdatedAt(stored.updatedAt);
      setHasStored(Boolean(stored.layout));
      setCustomFields(fields);
      setSelectedId(null);
      setChecked(null);
      setImportProblem(null);
      setStatus('ready');
    } catch (cause) {
      setLoadError(errorMessage(cause, 'Không tải được bố cục của mẫu.'));
      setStatus('error');
    }
  }, [template.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setMounted(true);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Trình duyệt cũ cần gán returnValue mới hiện hộp hỏi.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeMargins = useCallback(() => setMarginsOpen(false), []);
  useDismiss(menuOpen, menuRef, closeMenu);
  useDismiss(marginsOpen, marginsRef, closeMargins);

  // ---------------------------------------------------------------------------
  // Sửa bố cục
  // ---------------------------------------------------------------------------

  const apply = useCallback((change: (layout: QuoteLayout) => QuoteLayout, typingKey?: string) => {
    setHistory((current) => commitLayout(current, change(current.present), typingKey ?? null));
  }, []);
  const undo = useCallback(() => setHistory(undoLayout), []);
  const redo = useCallback(() => setHistory(redoLayout), []);
  const stopTyping = useCallback(() => setHistory(endTyping), []);

  const addNew = (type: QuoteLayoutBlockType, gap?: number) => {
    const block = createBlock(
      type,
      present.blocks.map((item) => item.id),
    );
    apply((layout) => (gap === undefined ? addBlock(layout, block, selectedBlock?.id) : insertBlockAt(layout, block, gap)));
    setSelectedId(block.id);
  };
  const remove = useCallback(
    (id: string) => {
      apply((layout) => removeBlock(layout, id));
      setSelectedId(null);
    },
    [apply],
  );
  const moveBy = useCallback((id: string, delta: number) => apply((layout) => moveBlockBy(layout, id, delta)), [apply]);
  const duplicate = (id: string) => {
    const result = duplicateBlock(present, id);
    if (!result.id) return;
    apply(() => result.layout);
    setSelectedId(result.id);
  };
  const changeBlock = (patch: BlockPatch, typingKey?: string) => {
    if (!selectedBlock) return;
    const id = selectedBlock.id;
    apply((layout) => updateBlock(layout, id, patch), typingKey);
  };
  const changePage = (patch: PagePatch, typingKey?: string) => apply((layout) => updatePage(layout, patch), typingKey);

  // Phím tắt: đọc trạng thái mới nhất qua ref để chỉ gắn một lần.
  const latest = useRef({ ready: false, blocked: false, selectedId: null as string | null });
  latest.current = { ready: status === 'ready', blocked: dialog !== null, selectedId: selectedBlock?.id ?? null };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = latest.current;
      if (!state.ready || state.blocked || event.defaultPrevented || isEditableTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (!state.selectedId) return;
      if (event.key === 'Delete' && !mod && !event.altKey) {
        event.preventDefault();
        remove(state.selectedId);
      } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        moveBy(state.selectedId, event.key === 'ArrowUp' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, remove, moveBy]);

  // ---------------------------------------------------------------------------
  // Kéo thả
  // ---------------------------------------------------------------------------

  const clearDrag = () => {
    dragItem.current = null;
    setDropGap(null);
    setDraggingId(null);
  };

  /** Khe thả theo vị trí chuột: trước khối đầu tiên có nửa trên nằm dưới con trỏ; không có thì cuối trang. */
  const gapAt = (clientY: number): number => {
    const nodes = Array.from(pageRef.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? []);
    const index = nodes.findIndex((node) => {
      const rect = node.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    return index < 0 ? nodes.length : index;
  };

  const onPageDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dragItem.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = dragItem.current.kind === 'new' ? 'copy' : 'move';
    const gap = gapAt(event.clientY);
    if (gap !== dropGap) setDropGap(gap);
  };
  const onPageDrop = (event: DragEvent<HTMLDivElement>) => {
    const item = dragItem.current;
    if (!item) return;
    event.preventDefault();
    const gap = gapAt(event.clientY);
    if (item.kind === 'new') addNew(item.type, gap);
    else {
      apply((layout) => moveBlockToGap(layout, item.id, gap));
      setSelectedId(item.id);
    }
    clearDrag();
  };
  const onPageDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (!next || !pageRef.current?.contains(next)) setDropGap(null);
  };

  const blockProps = (block: QuoteLayoutBlock, index: number): HTMLAttributes<HTMLDivElement> => {
    const problems = blockErrors.get(block.id);
    const last = index === present.blocks.length - 1;
    return {
      draggable: true,
      title: problems?.[0]?.message,
      className: cx(
        dropGap === index && styles.dropBefore,
        last && dropGap === present.blocks.length && styles.dropAfter,
        problems && styles.blockInvalid,
        draggingId === block.id && styles.blockDragging,
      ),
      onDragStart: (event) => {
        event.stopPropagation();
        dragItem.current = { kind: 'move', id: block.id };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(BLOCK_DRAG_TYPE, block.id);
        event.dataTransfer.setData('text/plain', block.id);
        setDraggingId(block.id);
      },
      onDragEnd: clearDrag,
    };
  };

  const renderBlockChrome = (block: QuoteLayoutBlock, info: { index: number; selected: boolean }) => {
    if (!info.selected) return null;
    const last = info.index === present.blocks.length - 1;
    return (
      <div
        className={styles.blockToolbar}
        role="toolbar"
        aria-label="Thao tác khối"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <button type="button" aria-label="Đưa khối lên" title="Lên (Alt+↑)" disabled={info.index === 0} onClick={() => moveBy(block.id, -1)}>
          <ArrowUp size={14} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Đưa khối xuống" title="Xuống (Alt+↓)" disabled={last} onClick={() => moveBy(block.id, 1)}>
          <ArrowDown size={14} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Nhân đôi khối" title="Nhân đôi" onClick={() => duplicate(block.id)}>
          <Copy size={14} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Xoá khối" title="Xoá (Delete)" className={styles.blockToolbarDanger} onClick={() => remove(block.id)}>
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Lưu, xoá, đóng
  // ---------------------------------------------------------------------------

  const handleSaveError = (cause: unknown, sent: QuoteLayout) => {
    const error = (cause ?? {}) as CrmApiError;
    if (error.code === QUOTE_LAYOUT_CONFLICT_CODE || error.statusCode === 409) {
      setDialog('conflict');
      return;
    }
    if (error.errors?.length) setChecked({ layout: sent, errors: error.errors });
    if (error.statusCode === 413) toast.error(LAYOUT_TOO_LARGE_MESSAGE);
    else toast.error(errorMessage(cause, 'Không lưu được bố cục mẫu.'));
  };

  const save = async () => {
    if (saving || status !== 'ready') return;
    const sending = present;
    const result = validateQuoteLayout(sending);
    if (!result.ok) {
      setChecked({ layout: sending, errors: result.errors });
      toast.error('Bố cục còn lỗi nên chưa lưu. Xem danh sách lỗi phía trên trang.');
      return;
    }
    setSaving(true);
    try {
      const response = await saveQuoteTemplateLayout(template.id, { layout: result.layout, expectedUpdatedAt: updatedAt });
      // Màn báo giá trong cùng phiên phải thấy bố cục mới, không dùng bản đã cache.
      clearTemplateLayoutCache(template.id);
      setSaved(sending);
      setUpdatedAt(response.updatedAt);
      setHasStored(true);
      setChecked(null);
      toast.success(`Đã lưu bố cục mẫu "${template.name}".`);
      onSaved?.(response);
    } catch (cause) {
      handleSaveError(cause, sending);
    } finally {
      setSaving(false);
    }
  };

  const deleteLayout = async () => {
    setSaving(true);
    try {
      const response = await saveQuoteTemplateLayout(template.id, { layout: null, expectedUpdatedAt: updatedAt });
      // Màn báo giá trong cùng phiên phải thấy bố cục mới, không dùng bản đã cache.
      clearTemplateLayoutCache(template.id);
      const fresh = defaultQuoteLayout();
      setHistory(createLayoutHistory(fresh));
      setSaved(fresh);
      setUpdatedAt(response.updatedAt);
      setHasStored(false);
      setSelectedId(null);
      setChecked(null);
      setDialog(null);
      toast.success(`Đã xoá bố cục mẫu "${template.name}". Mẫu dùng bố cục mặc định.`);
      onSaved?.(response);
    } catch (cause) {
      setDialog(null);
      handleSaveError(cause, present);
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (saving) return;
    if (dirty) setDialog('close');
    else onClose();
  };

  // ---------------------------------------------------------------------------
  // Nhập, xuất JSON
  // ---------------------------------------------------------------------------

  const exportJson = () => {
    setMenuOpen(false);
    downloadText(layoutJsonFileName(template.name), JSON.stringify(present, null, 2));
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > LAYOUT_IMPORT_MAX_BYTES) {
      setImportProblem({ message: LAYOUT_IMPORT_TOO_LARGE_MESSAGE, errors: [] });
      return;
    }
    let text: string;
    try {
      text = await readFileText(file);
    } catch {
      setImportProblem({ message: 'Không đọc được file. Thử lại.', errors: [] });
      return;
    }
    const result = parseLayoutJson(text);
    if (!result.ok) {
      setImportProblem({ message: result.message, errors: result.errors });
      return;
    }
    setImportProblem(null);
    apply(() => result.layout);
    setSelectedId(null);
    setChecked(null);
    toast.success('Đã nhập bố cục từ file. Bấm Lưu để lưu vào mẫu; bấm Hoàn tác để quay lại.');
  };

  /** Thay bố cục đang sửa bằng bố cục mặc định; chưa lưu, hoàn tác được. */
  const restoreDefault = () => {
    setMenuOpen(false);
    apply(() => defaultQuoteLayout());
    setSelectedId(null);
    toast.success('Đã khôi phục bố cục mặc định (chưa lưu). Bấm Hoàn tác để quay lại.');
  };

  const selectError = (error: QuoteLayoutError) => {
    const index = blockIndexFromPath(error.path);
    setSelectedId(index === null ? null : (present.blocks[index]?.id ?? null));
  };

  // ---------------------------------------------------------------------------
  // Giao diện
  // ---------------------------------------------------------------------------

  const ready = status === 'ready';
  const pageWidthPx = Math.ceil(quoteLayoutPageSize(present).width * MM_TO_PX);
  const selectProps = { clearable: false, searchInDropdown: true, hideDropdownSearch: true, height: 32, disabled: !ready } as const;

  const topBar = (
    <header className={styles.topBar}>
      <div className={styles.topTitle}>
        <span className={styles.topKicker}>Thiết kế bố cục</span>
        <strong title={template.name}>{template.name}</strong>
        {dirty ? <span className={styles.dirtyBadge}>Chưa lưu</span> : null}
      </div>
      <div className={styles.topTools}>
        <div className={styles.toolGroup} title="Khổ giấy">
          <span className={styles.toolCaption}>Khổ</span>
          <SearchableSelect
            {...selectProps}
            name="paper"
            className={styles.toolSelectNarrow}
            options={PAPER_OPTIONS}
            value={present.paper}
            onChange={(value) => value && changePage({ paper: value as QuoteLayout['paper'] })}
          />
        </div>
        <div className={styles.toolGroup} title="Hướng giấy">
          <span className={styles.toolCaption}>Hướng</span>
          <SearchableSelect
            {...selectProps}
            name="orientation"
            className={styles.toolSelect}
            options={ORIENTATION_OPTIONS}
            value={present.orientation}
            onChange={(value) => value && changePage({ orientation: value as QuoteLayout['orientation'] })}
          />
        </div>
        <div className={styles.toolGroup} title="Font chữ">
          <span className={styles.toolCaption}>Font</span>
          <SearchableSelect
            {...selectProps}
            name="fontFamily"
            className={styles.toolSelectWide}
            options={FONT_OPTIONS}
            value={present.fontFamily}
            onChange={(value) => value && changePage({ fontFamily: value as QuoteLayout['fontFamily'] })}
          />
        </div>
        <div className={styles.toolGroup} title="Cỡ chữ">
          <span className={styles.toolCaption}>Cỡ</span>
          <SearchableSelect
            {...selectProps}
            name="fontSizePt"
            className={styles.toolSelect}
            options={FONT_SIZE_OPTIONS}
            value={String(present.fontSizePt)}
            onChange={(value) => value && changePage({ fontSizePt: Number(value) })}
          />
        </div>
        <div className={styles.popoverAnchor} ref={marginsRef}>
          <button
            type="button"
            className={styles.toolButton}
            aria-haspopup="dialog"
            aria-expanded={marginsOpen}
            disabled={!ready}
            onClick={() => setMarginsOpen((open) => !open)}
          >
            Lề
          </button>
          {marginsOpen ? (
            <div className={styles.popover} role="dialog" aria-label="Lề trang (mm)">
              <p className={styles.popoverTitle}>Lề trang (mm)</p>
              <div className={styles.marginGrid}>
                {(
                  [
                    ['top', 'Trên'],
                    ['right', 'Phải'],
                    ['bottom', 'Dưới'],
                    ['left', 'Trái'],
                  ] as const
                ).map(([side, label]) => (
                  <NumberField
                    key={side}
                    compact
                    label={`Lề ${label.toLowerCase()}`}
                    value={present.marginsMm[side]}
                    min={5}
                    max={40}
                    unit="mm"
                    onChange={(value) => value !== undefined && changePage({ marginsMm: { ...present.marginsMm, [side]: value } })}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <span className={styles.toolDivider} aria-hidden="true" />
        <button
          type="button"
          role="switch"
          aria-checked={showSample}
          className={showSample ? styles.switchOn : styles.switchOff}
          disabled={!ready}
          onClick={() => setShowSample((value) => !value)}
        >
          <span className={styles.switchTrack} aria-hidden="true">
            <span className={styles.switchThumb} />
          </span>
          Dữ liệu mẫu
        </button>
        <span className={styles.toolDivider} aria-hidden="true" />
        <ToolButton label="Hoàn tác" disabled={!ready || !canUndo(history)} onClick={undo}>
          <Undo2 size={16} aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Làm lại" disabled={!ready || !canRedo(history)} onClick={redo}>
          <Redo2 size={16} aria-hidden="true" />
        </ToolButton>
        <ExportMenu layout={present} data={sampleData} fileName={layoutExportFileName(template.name)} disabled={!ready} />
        <div className={styles.popoverAnchor} ref={menuRef}>
          <ToolButton label="Thêm thao tác" disabled={!ready} onClick={() => setMenuOpen((open) => !open)}>
            <Ellipsis size={16} aria-hidden="true" />
          </ToolButton>
          {menuOpen ? (
            <ul className={styles.menu} role="menu" aria-label="Thêm thao tác">
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    importInput.current?.click();
                  }}
                >
                  <FileUp size={15} aria-hidden="true" /> Nhập JSON
                </button>
              </li>
              <li role="none">
                <button type="button" role="menuitem" onClick={exportJson}>
                  <FileDown size={15} aria-hidden="true" /> Xuất JSON
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={restoreDefault}
                >
                  <RotateCcw size={15} aria-hidden="true" /> Khôi phục bố cục mặc định
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuDanger}
                  disabled={!hasStored}
                  title={hasStored ? undefined : 'Mẫu chưa có bố cục đã lưu'}
                  onClick={() => {
                    setMenuOpen(false);
                    setDialog('delete');
                  }}
                >
                  <Trash2 size={15} aria-hidden="true" /> Xoá bố cục
                </button>
              </li>
            </ul>
          ) : null}
        </div>
        <span className={styles.toolDivider} aria-hidden="true" />
        <button type="button" className={styles.buttonGhost} onClick={requestClose} disabled={saving}>
          <X size={15} aria-hidden="true" /> Đóng
        </button>
        <button type="button" className={styles.buttonPrimary} onClick={() => void save()} disabled={!ready || saving}>
          {saving ? <Loader2 size={15} className={styles.spin} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
          {saving ? 'Đang lưu…' : 'Lưu'}
        </button>
      </div>
      <input
        ref={importInput}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Chọn file bố cục .json"
        data-testid="layout-import-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void importJson(file);
        }}
      />
    </header>
  );

  const errorPanel =
    errors.length > 0 ? (
      <div className={styles.errorPanel} role="alert">
        <p className={styles.errorPanelTitle}>
          <AlertTriangle size={15} aria-hidden="true" /> Bố cục còn {errors.length} lỗi, chưa lưu được. Bấm vào lỗi để chọn khối.
        </p>
        <ul>
          {errors.map((error, index) => (
            <li key={`${error.path}-${index}`}>
              <button
                type="button"
                className={styles.errorLink}
                onClick={(event) => {
                  // Không để vùng nền của khung bỏ chọn khối vừa chọn.
                  event.stopPropagation();
                  selectError(error);
                }}
              >
                {error.message}
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  const importPanel = importProblem ? (
    <div className={styles.errorPanel} role="alert" aria-label="Lỗi nhập bố cục">
      <p className={styles.errorPanelTitle}>
        <AlertTriangle size={15} aria-hidden="true" /> {importProblem.message}
      </p>
      {importProblem.errors.length ? (
        <ul>
          {importProblem.errors.map((error, index) => (
            <li key={`${error.path}-${index}`}>{error.message}</li>
          ))}
        </ul>
      ) : null}
      <button type="button" className={styles.linkButton} onClick={() => setImportProblem(null)}>
        Đóng thông báo
      </button>
    </div>
  ) : null;

  const body =
    status === 'loading' ? (
      <div className={styles.stateBox}>
        <Loader2 size={18} className={styles.spin} aria-hidden="true" /> Đang tải bố cục…
      </div>
    ) : status === 'error' ? (
      <div className={styles.stateBox} role="alert">
        <p>{loadError}</p>
        <button type="button" className={styles.buttonGhost} onClick={() => void load()}>
          Thử lại
        </button>
      </div>
    ) : (
      <div className={styles.body}>
        <aside className={styles.leftPane}>
          <LayoutPalette
            onAdd={(type) => addNew(type)}
            onDragStart={(type) => {
              dragItem.current = { kind: 'new', type };
            }}
            onDragEnd={clearDrag}
          />
        </aside>
        <main className={styles.canvas} onClick={() => setSelectedId(null)}>
          {importPanel}
          {errorPanel}
          <div
            ref={pageRef}
            className={styles.pageWrap}
            style={{ maxWidth: `${pageWidthPx}px` }}
            data-testid="layout-page"
            onDragOver={onPageDragOver}
            onDrop={onPageDrop}
            onDragLeave={onPageDragLeave}
            onClick={(event) => event.stopPropagation()}
          >
            <QuoteLayoutView
              layout={present}
              data={viewData}
              mode="design"
              selectedId={selectedBlock?.id ?? null}
              onSelect={setSelectedId}
              renderBlockChrome={renderBlockChrome}
              blockProps={blockProps}
            />
            {present.blocks.length === 0 ? (
              <div className={cx(styles.emptyHint, dropGap !== null && styles.emptyHintActive)}>Kéo khối vào đây, hoặc bấm một khối trong thư viện.</div>
            ) : null}
          </div>
        </main>
        <aside className={styles.rightPane}>
          <LayoutInspector
            layout={present}
            block={selectedBlock}
            blockNumber={selectedIndex + 1}
            errors={selectedBlock ? (blockErrors.get(selectedBlock.id) ?? []) : pageErrors}
            customFields={activeFields}
            onBlockChange={changeBlock}
            onPageChange={changePage}
            onEndTyping={stopTyping}
          />
        </aside>
      </div>
    );

  const overlay = (
    <div className={styles.root} role="dialog" aria-modal="true" aria-label={`Thiết kế bố cục mẫu ${template.name}`}>
      {topBar}
      {body}
      <CrmDialog
        open={dialog === 'close'}
        title={DISCARD_CHANGES_QUESTION}
        subtitle="Các thay đổi trên bố cục chưa được lưu vào mẫu."
        submitLabel="Bỏ thay đổi"
        cancelLabel="Huỷ"
        danger
        onClose={() => setDialog(null)}
        onSubmit={() => {
          setDialog(null);
          onClose();
        }}
      >
        <p className={styles.dialogText}>Đóng trình thiết kế sẽ bỏ mọi thay đổi chưa lưu.</p>
      </CrmDialog>
      <CrmDialog
        open={dialog === 'delete'}
        title="Xoá bố cục của mẫu?"
        submitLabel="Xoá bố cục"
        cancelLabel="Huỷ"
        danger
        submitting={saving}
        onClose={() => setDialog(null)}
        onSubmit={() => void deleteLayout()}
      >
        <p className={styles.dialogText}>
          Mẫu &quot;{template.name}&quot; sẽ quay về bố cục mặc định. Báo giá đã gửi vẫn giữ bố cục đã chụp lúc gửi. Thay đổi chưa lưu cũng bị bỏ.
        </p>
      </CrmDialog>
      <CrmDialog
        open={dialog === 'conflict'}
        title="Mẫu vừa được người khác sửa"
        submitLabel="Tải lại"
        cancelLabel="Để sau"
        onClose={() => setDialog(null)}
        onSubmit={() => {
          setDialog(null);
          void load();
        }}
        notice={
          <button type="button" className={styles.linkButton} onClick={exportJson}>
            <FileDown size={14} aria-hidden="true" /> Xuất JSON bản đang sửa trước khi tải lại
          </button>
        }
      >
        <p className={styles.dialogText}>{CONFLICT_MESSAGE} Tải lại sẽ bỏ các thay đổi đang sửa ở đây.</p>
      </CrmDialog>
    </div>
  );

  if (!mounted) return null;
  return createPortal(overlay, document.body);
}
