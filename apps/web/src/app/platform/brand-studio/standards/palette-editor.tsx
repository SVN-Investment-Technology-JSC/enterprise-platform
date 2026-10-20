'use client';

import { normalizeHex, type BrandPalette, type IconDocument } from '@enterprise-platform/shared-brand-icon';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { ChevronDown, ChevronUp, GripVertical, Lock, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { IconButton } from '../library/library-ui';
import { CommitField } from './commit-field';
import {
  LABEL_MAX,
  addToken,
  moveToken,
  removeToken,
  renameToken,
  reorderTokens,
  tokenUsage,
  updateHex,
  type PaletteEdit,
} from './palette-model';

const SWATCH = 'size-8 shrink-0 cursor-pointer rounded border border-slate-200 bg-white p-0.5';

/**
 * Bảng màu thương hiệu: một danh sách phẳng, mỗi dòng gồm ô màu, tên, khoá, mã hex và thao tác.
 * Sửa là lưu ngay (qua `onChange`); mọi thao tác được kiểm tra trong palette-model, lỗi hiện ngắn gọn ở dưới danh sách.
 */
export function PaletteEditor({
  palette,
  docs,
  onChange,
}: {
  palette: BrandPalette;
  docs: readonly IconDocument[];
  onChange: (palette: BrandPalette) => void;
}) {
  const usage = useMemo(() => tokenUsage(docs), [docs]);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newHex, setNewHex] = useState('#2563eb');
  const [armed, setArmed] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const apply = (edit: PaletteEdit): boolean => {
    if (edit.ok) {
      setError(null);
      onChange(edit.palette);
      return true;
    }
    setError(edit.error);
    return false;
  };

  const submitNew = (event: FormEvent) => {
    event.preventDefault();
    if (apply(addToken(palette, { label: newLabel, hex: newHex }))) setNewLabel('');
  };

  const endDrag = () => {
    setArmed(null);
    setDragFrom(null);
    setDragOver(null);
  };

  const drop = (event: DragEvent, to: number) => {
    event.preventDefault();
    if (dragFrom !== null) {
      setError(null);
      onChange(reorderTokens(palette, dragFrom, to));
    }
    endDrag();
  };

  const only = palette.tokens.length <= 1;

  return (
    <div>
      <ul aria-label="Bảng màu thương hiệu">
        {palette.tokens.map((token, index) => {
          const used = usage.get(token.key) ?? 0;
          return (
            <li
              className={cn(
                'flex items-center gap-2.5 border-b border-slate-100 py-2 transition-colors',
                dragOver === index && dragFrom !== index && 'border-t-2 border-t-blue-500',
                dragFrom === index && 'opacity-50',
              )}
              data-testid="palette-row"
              draggable={armed === index}
              key={token.key}
              onDragEnd={endDrag}
              onDragOver={(event) => {
                if (dragFrom === null) return;
                event.preventDefault();
                setDragOver(index);
              }}
              onDragStart={(event) => {
                setDragFrom(index);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', token.key);
              }}
              onDrop={(event) => drop(event, index)}
            >
              <span
                aria-hidden
                className="cursor-grab touch-none text-slate-300 hover:text-slate-500 active:cursor-grabbing"
                onMouseDown={() => setArmed(index)}
                onMouseUp={() => setArmed(null)}
                title="Kéo để đổi thứ tự"
              >
                <GripVertical className="size-4" />
              </span>

              <input
                aria-label={`Màu ${token.label}`}
                className={SWATCH}
                onChange={(event) => apply(updateHex(palette, token.key, event.target.value))}
                type="color"
                value={token.hex}
              />

              <div className="min-w-0 flex-1">
                <CommitField
                  aria-label={`Tên màu ${token.label}`}
                  className="h-7 border-transparent px-1.5 font-medium hover:border-slate-200"
                  maxLength={LABEL_MAX}
                  onCommit={(next) => apply(renameToken(palette, token.key, next, docs))}
                  value={token.label}
                />
                <p className="mt-0.5 flex items-center gap-1 px-1.5 text-[11px] text-slate-400">
                  {used > 0 ? <Lock aria-hidden className="size-3" /> : null}
                  <code className="font-mono" title={used > 0 ? 'Khoá không đổi khi màu đang được icon dùng' : 'Khoá tự đổi theo tên khi chưa có icon dùng'}>
                    {token.key}
                  </code>
                  <span aria-hidden>·</span>
                  <span>{used > 0 ? `${used} icon dùng` : 'chưa dùng'}</span>
                </p>
              </div>

              <CommitField
                aria-label={`Mã hex ${token.label}`}
                className="w-24 font-mono uppercase"
                maxLength={7}
                onCommit={(next) => apply(updateHex(palette, token.key, next))}
                spellCheck={false}
                value={token.hex}
              />

              <div className="flex shrink-0 items-center">
                <IconButton
                  disabled={index === 0}
                  label="Đưa lên"
                  onClick={() => onChange(moveToken(palette, token.key, -1))}
                >
                  <ChevronUp aria-hidden className="size-4" />
                </IconButton>
                <IconButton
                  disabled={index === palette.tokens.length - 1}
                  label="Đưa xuống"
                  onClick={() => onChange(moveToken(palette, token.key, 1))}
                >
                  <ChevronDown aria-hidden className="size-4" />
                </IconButton>
                <Popconfirm
                  cancelText="Hủy"
                  description={
                    used > 0
                      ? `Đang dùng trong ${used} icon; các icon đó sẽ hiện màu đen cho tới khi chọn màu khác.`
                      : 'Chưa có icon nào dùng màu này.'
                  }
                  disabled={only}
                  okText="Xoá"
                  onConfirm={() => {
                    apply(removeToken(palette, token.key));
                  }}
                  placement="left"
                  title={`Xoá màu "${token.label}"?`}
                >
                  <IconButton disabled={only} label="Xoá màu" tone="danger">
                    <Trash2 aria-hidden className="size-4" />
                  </IconButton>
                </Popconfirm>
              </div>
            </li>
          );
        })}
      </ul>

      <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={submitNew}>
        <input
          aria-label="Chọn màu mới"
          className={SWATCH}
          onChange={(event) => setNewHex(event.target.value)}
          type="color"
          value={normalizeHex(newHex) ?? '#000000'}
        />
        <Input
          aria-label="Tên màu mới"
          className="h-8 min-w-36 flex-1 rounded-md text-sm"
          maxLength={LABEL_MAX}
          onChange={(event) => setNewLabel(event.target.value)}
          placeholder="Tên màu mới"
          value={newLabel}
        />
        <Input
          aria-label="Mã hex màu mới"
          className="h-8 w-24 rounded-md font-mono text-sm uppercase"
          maxLength={7}
          onChange={(event) => setNewHex(event.target.value)}
          spellCheck={false}
          value={newHex}
        />
        <Button className="rounded-md bg-blue-600 text-white hover:bg-blue-700" type="submit">
          <Plus aria-hidden className="size-4" />
          Thêm màu
        </Button>
      </form>
      {error ? (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
