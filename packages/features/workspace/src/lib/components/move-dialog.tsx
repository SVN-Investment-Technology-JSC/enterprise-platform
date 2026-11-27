'use client';

import type { WorkItem } from '@enterprise-platform/contracts-workspace';
import { useEffect, useMemo, useState } from 'react';
import { CornerDownRight, Info } from 'lucide-react';
import { buildWorkItemTree, moveTargets, reopenChainForMove } from '../project-tree.model';
import { ITEM_TYPE_LABELS, workItemStatusLabel, workItemStatusTone } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Checkbox } from '../ui/checkbox';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';

export interface MoveDialogProps {
  /** Công việc cần chuyển; vắng thì hộp thoại đóng. */
  readonly item?: WorkItem;
  readonly items: readonly WorkItem[];
  readonly onClose: () => void;
  /**
   * `null` là đưa lên cấp gốc. `reopenParent` là người dùng đã đồng ý mở lại các cha đã hoàn thành của đích
   * (hộp thoại chỉ đặt `true` khi đích thật sự cần mở lại).
   */
  readonly onMove: (parentId: string | null, reopenParent: boolean) => Promise<void>;
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
  const [confirmedReopen, setConfirmedReopen] = useState(false);

  useEffect(() => {
    if (!item) return;
    setTarget('');
    setConfirmedReopen(false);
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
        label: `${row.item.code} · ${row.item.title} (${ITEM_TYPE_LABELS[row.item.itemType]})`,
        depth: row.depth,
        childCount: items.filter((node) => node.parentId === row.item.id).length,
      }));
  }, [item, items]);
  // Cấp và số việc con của từng đích, để dòng trong danh sách nói rõ đâu là việc cha, đâu là việc con.
  const layoutOf = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);

  // Đích đã hoàn thành mà việc chuyển chưa xong: chuyển vào là mở lại cha, nên phải có xác nhận rõ ràng.
  const reopenChain = useMemo(
    () => (item && target && target !== ROOT ? reopenChainForMove(items, item, target) : []),
    [item, items, target],
  );
  const needsReopen = reopenChain.length > 0;

  const submit = async () => {
    if (!target) {
      setError('Hãy chọn nơi chuyển tới.');
      return;
    }
    if (needsReopen && !confirmedReopen) {
      setError('Hãy tích xác nhận mở lại công việc cha đã hoàn thành.');
      return;
    }
    setSubmitting(true);
    try {
      await onMove(target === ROOT ? null : target, needsReopen);
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không di chuyển được công việc.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(item)}
      title={item ? `Di chuyển ${item.code}` : 'Di chuyển công việc'}
      subtitle={item ? `${item.title} — cả nhánh con đi theo.` : undefined}
      submitLabel={needsReopen ? 'Mở lại cha và di chuyển' : 'Di chuyển'}
      submitDisabled={needsReopen && !confirmedReopen}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field
        label="Chuyển vào dưới"
        hint="Gõ mã hoặc tên để lọc."
      >
        <Choice
          label="Chuyển vào dưới"
          value={target}
          placeholder="Tìm nhóm hoặc công việc đích theo mã, tên"
          options={[
            ...(item?.parentId
              ? [{ value: ROOT, label: 'Cấp gốc của dự án (không thuộc nhóm nào)' }]
              : []),
            ...options.map((option) => ({ value: option.id, label: option.label })),
          ]}
          // Mỗi đích kèm trạng thái, để biết trước đích nào đã hoàn thành (chuyển vào sẽ phải mở lại).
          renderOption={(option) => {
            const node = items.find((entry) => entry.id === option.value);
            const layout = layoutOf.get(option.value);
            if (!node || !layout) return option.label;
            const tone = workItemStatusTone(node);
            const isChild = layout.depth > 0;
            const isParent = layout.childCount > 0;
            return (
              <span className={styles.moveOptionRow} style={{ paddingLeft: layout.depth * 18 }}>
                {isChild ? <CornerDownRight className={styles.moveOptionBranch} aria-hidden /> : null}
                <span className={isParent ? styles.moveOptionParent : styles.moveOptionLabel}>{option.label}</span>
                <span className={styles.moveOptionTags}>
                  <span className={styles.moveOptionRole}>
                    {isParent ? `Việc cha · ${layout.childCount} con` : isChild ? 'Việc con' : 'Việc gốc'}
                  </span>
                  <span className={styles.moveOptionStatus} style={{ background: tone.bg, color: tone.fg }}>
                    {workItemStatusLabel(node)}
                  </span>
                </span>
              </span>
            );
          }}
          onChange={(value) => {
            setTarget(value);
            setConfirmedReopen(false);
            setError(undefined);
          }}
        />
      </Field>
      {needsReopen ? (
        <div className={styles.parentDoneNotice} role="group" aria-label="Xác nhận mở lại công việc cha đã hoàn thành">
          <span className={styles.parentDoneIcon} aria-hidden="true">
            <Info size={16} />
          </span>
          <div className={styles.parentDoneText}>
            <strong>
              {reopenChain.length === 1
                ? `Công việc ${reopenChain[0].code} đã hoàn thành`
                : `${reopenChain.length} công việc cha đã hoàn thành`}
            </strong>
            <p>
              Chuyển {item?.code} vào đây sẽ đưa{' '}
              {reopenChain.map((node) => node.code).join(', ')} về "Đang làm" và tính lại tiến độ từ các việc con. Người giao,
              người phụ trách và người cùng thực hiện của {reopenChain.length === 1 ? 'công việc' : 'các công việc'} này sẽ
              nhận thông báo kèm lý do.
            </p>
            <label className={styles.checkbox}>
              <Checkbox checked={confirmedReopen} onCheckedChange={(checked) => setConfirmedReopen(Boolean(checked))} />
              Tôi hiểu và đồng ý mở lại
            </label>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
