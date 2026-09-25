'use client';

import type { WorkItem } from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import { loadProcedureOptions, type ProcedureOption } from '../procedure-api';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';

/**
 * Chọn lại quy trình để thử mở hồ sơ cho một công việc.
 *
 * Chỉ cần tới khi lựa chọn ban đầu đã mất — sau khi tải lại trang chẳng hạn.
 * CSDL không lưu quy trình đã chọn: công việc chưa có con trỏ thì chưa có gì
 * trỏ tới quy trình nào. Còn trong cùng phiên thì Thử lại chạy thẳng, không
 * qua hộp thoại này.
 */
export function ProcedureRetryDialog({
  item,
  onClose,
  onPick,
}: {
  item?: WorkItem;
  onClose: () => void;
  onPick: (definitionId: string) => Promise<void>;
}) {
  const [options, setOptions] = useState<readonly ProcedureOption[]>();
  const [definitionId, setDefinitionId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!item) return;
    setOptions(undefined);
    setDefinitionId('');
    setSubmitting(false);
    setError(undefined);
    void loadProcedureOptions().then(setOptions);
  }, [item]);

  const submit = async () => {
    if (!definitionId) {
      setError('Hãy chọn quy trình.');
      return;
    }
    setSubmitting(true);
    await onPick(definitionId);
    setSubmitting(false);
  };

  return (
    <Dialog
      open={Boolean(item)}
      title="Thử mở lại quy trình"
      subtitle={item ? `${item.code} · ${item.title}` : undefined}
      submitLabel="Mở quy trình"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field
        label="Quy trình"
        hint="Thử lại bao nhiêu lần cũng chỉ sinh một hồ sơ: khoá chống trùng gắn với chính công việc này."
      >
        {options === undefined ? (
          <span className={styles.muted}>Đang tải danh sách quy trình…</span>
        ) : options.length === 0 ? (
          <span className={styles.muted}>
            Không đọc được quy trình nào. Module Quy trình có thể đang tạm ngưng.
          </span>
        ) : (
          <Choice
            label="Quy trình"
            value={definitionId}
            placeholder="Chọn quy trình…"
            options={options.map((option) => ({
              value: option.id,
              label: `${option.code} · ${option.name}`,
            }))}
            onChange={setDefinitionId}
          />
        )}
      </Field>
    </Dialog>
  );
}
