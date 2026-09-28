'use client';

import type { WorkItem } from '@enterprise-platform/contracts-workspace';
import { useEffect, useMemo, useState } from 'react';
import { buildWorkItemTree, moveTargets } from '../project-tree.model';
import { ITEM_TYPE_LABELS } from '../workspace-labels';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';

export interface MoveDialogProps {
  /** Công việc cần chuyển; vắng thì hộp thoại đóng. */
  readonly item?: WorkItem;
  readonly items: readonly WorkItem[];
  readonly onClose: () => void;
  /** `null` là đưa lên cấp gốc. */
  readonly onMove: (parentId: string | null) => Promise<void>;
}

const ROOT = '__root__';

/**
 * Chuyển một công việc (kèm cả nhánh con) sang cha khác.
 *
 * Danh sách đích xếp đúng thứ tự cây và thụt lề theo cấp, đã loại những đích
 * chắc chắn bị server từ chối (chính nhánh của nó, đích làm cây quá 10 cấp).
 */
export function MoveDialog({ item, items, onClose, onMove }: MoveDialogProps) {
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!item) return;
    setTarget('');
    setError(undefined);
    setSubmitting(false);
  }, [item]);

  const options = useMemo(() => {
    if (!item) return [];
    const allowed = new Set(moveTargets(items, item.id).map((node) => node.id));
    // Dựng cây đầy đủ để giữ thứ tự hiển thị, rồi chỉ giữ các đích hợp lệ.
    return buildWorkItemTree(items, new Set(items.map((node) => node.id)))
      .filter((row) => allowed.has(row.item.id))
      .map((row) => ({
        id: row.item.id,
        label: `${'\u00a0\u00a0'.repeat(row.depth)}${row.item.code} · ${row.item.title} (${ITEM_TYPE_LABELS[row.item.itemType]})`,
      }));
  }, [item, items]);

  const submit = async () => {
    if (!target) {
      setError('Hãy chọn nơi chuyển tới.');
      return;
    }
    setSubmitting(true);
    try {
      await onMove(target === ROOT ? null : target);
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không di chuyển được công việc.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(item)}
      title={item ? `Chuyển ${item.code}` : 'Chuyển công việc'}
      subtitle={item ? `${item.title} — cả nhánh con đi theo.` : undefined}
      submitLabel="Chuyển"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Chuyển vào dưới" hint="Công việc được xếp cuối danh sách con của nơi chuyển tới.">
        <Choice
          label="Chuyển vào dưới"
          value={target}
          emptyOption="— Chọn —"
          options={[
            ...(item?.parentId ? [{ value: ROOT, label: 'Cấp gốc của dự án' }] : []),
            ...options.map((option) => ({ value: option.id, label: option.label })),
          ]}
          onChange={setTarget}
        />
      </Field>
    </Dialog>
  );
}
