'use client';

import type { BrandSlotGroup } from '@enterprise-platform/shared-brand-icon';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Hint } from '../components/hint';
import { RAISED } from '../components/panel';
import { createSlotGroup, deleteSlotGroup, errorMessage, updateSlotGroup } from '../store/brand-api';
import { SlotDialogFrame, SlotField } from './slot-dialog-frame';

export interface SlotGroupsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly groups: readonly BrandSlotGroup[];
  readonly onCreated: (group: BrandSlotGroup) => void;
  readonly onUpdated: (group: BrandSlotGroup) => void;
  readonly onDeleted: (key: string) => void;
}

function GroupRow({
  group,
  onUpdated,
  onDeleted,
}: {
  group: BrandSlotGroup;
  onUpdated: (group: BrandSlotGroup) => void;
  onDeleted: (key: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [label, setLabel] = useState(group.label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setLabel(group.label);
    setError(null);
    setConfirming(false);
    setEditing(true);
  };

  const save = async () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setError('Tên nhóm không được để trống.');
      return;
    }
    if (trimmed === group.label) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await updateSlotGroup(group.key, trimmed);
      onUpdated(updated);
      setEditing(false);
      toast.success(`Đã đổi tên nhóm thành "${updated.label}".`);
    } catch (cause) {
      setError(errorMessage(cause, 'Không thể đổi tên nhóm.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteSlotGroup(group.key);
      onDeleted(group.key);
      toast.success(`Đã xoá nhóm "${group.label}".`);
    } catch (cause) {
      setConfirming(false);
      setError(errorMessage(cause, 'Không thể xoá nhóm.'));
    } finally {
      setBusy(false);
    }
  };

  const onEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!busy) void save();
    } else if (event.key === 'Escape') {
      // Esc chỉ huỷ việc đổi tên, không đóng hộp thoại.
      event.preventDefault();
      event.stopPropagation();
      setEditing(false);
      setError(null);
    }
  };

  const inUse = group.slotCount > 0;

  return (
    <li className="flex flex-col gap-1.5 px-4 py-3" data-testid={`slot-group-row-${group.key}`}>
      {editing ? (
        <div className="flex items-center gap-2">
          <Input
            aria-label={`Tên nhóm ${group.key}`}
            autoFocus
            className="h-8 min-w-0 flex-1 bg-white"
            maxLength={60}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={onEditKeyDown}
            value={label}
          />
          <Button
            className="bg-blue-600 text-white hover:bg-blue-700"
            disabled={busy}
            onClick={() => void save()}
            type="button"
          >
            Lưu
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            type="button"
            variant="outline"
          >
            Huỷ
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-semibold text-slate-900">{group.label}</span>
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{group.key}</code>
            {group.isBuiltIn ? (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                Có sẵn
              </span>
            ) : null}
            <span className="text-[11px] tabular-nums text-slate-500">{group.slotCount} vị trí</span>
          </div>

          {group.isBuiltIn ? (
            <span className="shrink-0 text-[11px] font-medium text-slate-400">Cố định</span>
          ) : confirming ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-slate-600">Xoá nhóm này?</span>
              <Button
                className="bg-red-600 text-white hover:bg-red-700"
                data-testid={`slot-group-confirm-delete-${group.key}`}
                disabled={busy}
                onClick={() => void remove()}
                type="button"
              >
                {busy ? 'Đang xoá...' : 'Xoá'}
              </Button>
              <Button disabled={busy} onClick={() => setConfirming(false)} type="button" variant="outline">
                Huỷ
              </Button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-1">
              <Hint label="Đổi tên nhóm">
                <Button
                  aria-label={`Sửa nhóm ${group.label}`}
                  className={RAISED}
                  data-testid={`slot-group-edit-${group.key}`}
                  onClick={startEdit}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <Pencil aria-hidden className="size-4" />
                </Button>
              </Hint>
              <Hint
                label={inUse ? `Nhóm đang có ${group.slotCount} vị trí, hãy chuyển vị trí sang nhóm khác trước` : 'Xoá nhóm'}
                wrapperClassName="size-8"
              >
                <Button
                  aria-label={`Xoá nhóm ${group.label}`}
                  className={cn(RAISED, !inUse && 'text-red-600 hover:bg-red-50 hover:text-red-700')}
                  data-testid={`slot-group-delete-${group.key}`}
                  disabled={inUse}
                  onClick={() => {
                    setError(null);
                    setConfirming(true);
                  }}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  {inUse ? <Lock aria-hidden className="size-4" /> : <Trash2 aria-hidden className="size-4" />}
                </Button>
              </Hint>
            </div>
          )}
        </div>
      )}
      {error ? (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** Popup quản lý nhóm vị trí: thêm, đổi tên, xoá nhóm tùy chỉnh và xem các nhóm có sẵn. */
export function SlotGroupsDialog({ open, onOpenChange, groups, onCreated, onUpdated, onDeleted }: SlotGroupsDialogProps) {
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const add = async () => {
    const trimmed = newLabel.trim();
    if (!trimmed) {
      setAddError('Tên nhóm không được để trống.');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const group = await createSlotGroup(trimmed);
      onCreated(group);
      setNewLabel('');
      toast.success(`Đã thêm nhóm "${group.label}".`);
    } catch (cause) {
      setAddError(errorMessage(cause, 'Không thể thêm nhóm.'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0" data-testid="slot-groups-dialog">
        <SlotDialogFrame
          description="Nhóm có sẵn là cố định; nhóm tùy chỉnh chỉ xoá được khi không còn vị trí nào."
          error={addError}
          footer={
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              Đóng
            </Button>
          }
          title="Nhóm vị trí"
        >
          <SlotField htmlFor="new-slot-group-label" label="Tên nhóm mới">
            <div className="flex items-center gap-2">
              <Input
                className="h-8 min-w-0 flex-1"
                id="new-slot-group-label"
                maxLength={60}
                onChange={(event) => setNewLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (!adding) void add();
                  }
                }}
                placeholder="Trung tâm trợ giúp"
                value={newLabel}
              />
              <Button
                className="bg-blue-600 text-white hover:bg-blue-700"
                data-testid="slot-group-add-btn"
                disabled={adding}
                onClick={() => void add()}
                type="button"
              >
                <Plus aria-hidden className="size-4" />
                <span>{adding ? 'Đang thêm...' : 'Thêm'}</span>
              </Button>
            </div>
          </SlotField>

          <ul className="max-h-[calc(100vh-26rem)] min-h-24 divide-y divide-slate-200 overflow-y-auto rounded-md border border-slate-200">
            {groups.map((group) => (
              <GroupRow group={group} key={group.key} onDeleted={onDeleted} onUpdated={onUpdated} />
            ))}
          </ul>
        </SlotDialogFrame>
      </DialogContent>
    </Dialog>
  );
}
