'use client';

import type { BrandPalette, IconShape } from '@enterprise-platform/shared-brand-icon';
import { Copy, Eye, EyeOff, Layers, Lock, LockOpen, Trash2 } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { IconButton } from '../../components/controls';
import { IconSvg } from '../../icon-svg';
import {
  displayOrder,
  dropPosition,
  dropTargetIndex,
  layerThumbnailDoc,
  MAX_LAYER_NAME,
  normalizeLayerName,
  rangeIds,
  type DropPosition,
} from './layers-model';
import type { EditorPanelProps } from './types';

const LayerThumb = memo(function LayerThumb({ shape, size, palette }: { shape: IconShape; size: number; palette: BrandPalette }) {
  const doc = useMemo(() => layerThumbnailDoc(size, shape), [size, shape]);
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-white ring-1 ring-slate-200">
      <IconSvg doc={doc} palette={palette} color="#334155" className="size-5" />
    </span>
  );
});

function RenameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(draft);
    else onCancel();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Phím gõ trong ô đổi tên không được lan lên phím tắt của trình thiết kế.
    event.stopPropagation();
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  };

  return (
    <input
      ref={input}
      type="text"
      aria-label="Tên lớp"
      value={draft}
      maxLength={MAX_LAYER_NAME}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
      className="h-6 min-w-0 flex-1 rounded border border-blue-500 bg-white px-1.5 text-xs text-slate-800 outline-none ring-2 ring-blue-500/20"
    />
  );
}

/** Danh sách lớp: trên cùng là lớp nằm trên cùng; chọn, ẩn, khoá, đổi tên (nhấp đôi), kéo thả đổi thứ tự. */
export function LayersPanel({ state, dispatch, palette }: EditorPanelProps) {
  const { doc, selection } = state;
  const rows = useMemo(() => displayOrder(doc.shapes), [doc.shapes]);
  const order = useMemo(() => rows.map((shape) => shape.id), [rows]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const lead = selection[selection.length - 1];

  const anchor = useRef<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; position: DropPosition } | null>(null);

  const select = (id: string, event: Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>) => {
    if (event.shiftKey && anchor.current !== null && anchor.current !== id) {
      dispatch({ type: 'select', ids: rangeIds(order, anchor.current, id) });
      return;
    }
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    dispatch({ type: 'select', ids: [id], additive });
    anchor.current = id;
  };

  const startRename = (id: string) => {
    anchor.current = id;
    setRenamingId(id);
  };

  const rename = (shape: IconShape, text: string) => {
    setRenamingId(null);
    const name = normalizeLayerName(text, shape.name);
    if (name !== shape.name) dispatch({ type: 'replaceShapes', shapes: [{ ...shape, name }] });
  };

  const endDrag = () => {
    setDragId(null);
    setOver(null);
  };

  const onDragOver = (event: DragEvent<HTMLLIElement>, id: string) => {
    if (dragId === null || dragId === id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const position = dropPosition(event.clientY, event.currentTarget.getBoundingClientRect());
    setOver((current) => (current?.id === id && current.position === position ? current : { id, position }));
  };

  const onDrop = (event: DragEvent<HTMLLIElement>, id: string) => {
    event.preventDefault();
    const from = doc.shapes.findIndex((shape) => shape.id === dragId);
    const overIndex = doc.shapes.findIndex((shape) => shape.id === id);
    const position = dropPosition(event.clientY, event.currentTarget.getBoundingClientRect());
    endDrag();
    if (from < 0 || overIndex < 0 || from === overIndex || dragId === null) return;
    dispatch({ type: 'moveShape', id: dragId, toIndex: dropTargetIndex(from, overIndex, position) });
  };

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-slate-400">
        <Layers className="mx-auto mb-2 size-5" aria-hidden="true" />
        Chưa có lớp nào
      </div>
    );
  }

  return (
    <ul aria-label="Danh sách lớp" className="-mx-1.5">
      {rows.map((shape) => {
        const isSelected = selected.has(shape.id);
        const mark = over?.id === shape.id ? over.position : null;
        return (
          <li
            key={shape.id}
            draggable={renamingId !== shape.id}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', shape.id);
              event.dataTransfer.effectAllowed = 'move';
              setDragId(shape.id);
            }}
            onDragOver={(event) => onDragOver(event, shape.id)}
            onDrop={(event) => onDrop(event, shape.id)}
            onDragEnd={endDrag}
            className={cn(
              'group flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors',
              isSelected ? 'bg-blue-50' : 'hover:bg-slate-50',
              dragId === shape.id && 'opacity-40',
              mark === 'above' && 'shadow-[inset_0_2px_0_0_#2563eb]',
              mark === 'below' && 'shadow-[inset_0_-2px_0_0_#2563eb]',
            )}
          >
            {renamingId === shape.id ? (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <LayerThumb shape={shape} size={doc.size} palette={palette} />
                <RenameInput initial={shape.name} onCommit={(name) => rename(shape, name)} onCancel={() => setRenamingId(null)} />
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                title="Bấm để chọn, nhấp đôi (hoặc F2) để đổi tên, kéo để đổi thứ tự"
                onClick={(event) => select(shape.id, event)}
                onDoubleClick={() => startRename(shape.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    select(shape.id, event);
                  } else if (event.key === 'F2') {
                    event.preventDefault();
                    startRename(shape.id);
                  }
                }}
                className={cn(
                  'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
                  shape.hidden && 'opacity-45',
                )}
              >
                <LayerThumb shape={shape} size={doc.size} palette={palette} />
                <span className={cn('min-w-0 flex-1 truncate text-xs', isSelected ? 'font-medium text-slate-900' : 'text-slate-700')}>
                  {shape.name}
                </span>
              </div>
            )}

            {isSelected && shape.id === lead ? (
              <>
                <IconButton label="Nhân đôi lớp đã chọn" className="size-6" onClick={() => dispatch({ type: 'duplicate', ids: selection })}>
                  <Copy />
                </IconButton>
                <IconButton label="Xoá lớp đã chọn" danger className="size-6" onClick={() => dispatch({ type: 'remove', ids: selection })}>
                  <Trash2 />
                </IconButton>
              </>
            ) : null}
            <IconButton
              label={shape.locked ? 'Mở khoá lớp' : 'Khoá lớp'}
              pressed={shape.locked}
              className={cn('size-6', !shape.locked && 'text-slate-300 hover:text-slate-600')}
              onClick={() => dispatch({ type: 'updateShapes', ids: [shape.id], patch: { locked: !shape.locked } })}
            >
              {shape.locked ? <Lock /> : <LockOpen />}
            </IconButton>
            <IconButton
              label={shape.hidden ? 'Hiện lớp' : 'Ẩn lớp'}
              className={cn('size-6', shape.hidden && 'text-slate-400')}
              onClick={() => dispatch({ type: 'updateShapes', ids: [shape.id], patch: { hidden: !shape.hidden } })}
            >
              {shape.hidden ? <EyeOff /> : <Eye />}
            </IconButton>
          </li>
        );
      })}
    </ul>
  );
}
