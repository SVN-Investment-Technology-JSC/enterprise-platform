'use client';

import {
  completionSatisfied,
  requiredConfirmations,
  type WorkItemCompletionPolicy,
} from '@enterprise-platform/contracts-workspace';
import { useEffect, useState } from 'react';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { ConfirmBox } from './confirm-box';

export interface CompleteWorkItemTarget {
  readonly id: string;
  readonly code: string;
  readonly title: string;
}

export interface CompleteWorkItemDialogProps {
  /** Việc đang được hoàn thành; vắng thì hộp đóng. */
  readonly target?: CompleteWorkItemTarget;
  /** Gửi lên server; ném lỗi thì hộp giữ mở và hiện lỗi. Thành công thì nơi gọi đóng hộp (đặt `target` về rỗng). */
  readonly onConfirm: (confirmedConditionIds: string[]) => Promise<void>;
  readonly onClose: () => void;
}

const errorMessage = (cause: unknown, fallback: string) =>
  (cause as { message?: string })?.message ?? fallback;

/**
 * Hộp xác nhận khi bấm Hoàn thành công việc. Việc không đặt điều kiện: chỉ hỏi xác nhận. Việc có điều kiện: người
 * thực hiện phải tích các mục theo luật của việc (đủ tất cả, đủ ít nhất N, hoặc không bắt buộc) thì nút mới bấm được.
 *
 * Danh sách điều kiện đọc lại từ server mỗi lần mở, nên luôn là bản mới nhất dù cây công việc đang hiện đã cũ. Server
 * vẫn kiểm lại; nút khoá ở đây chỉ để không mời người dùng làm việc chắc chắn bị từ chối.
 */
export function CompleteWorkItemDialog({ target, onConfirm, onClose }: CompleteWorkItemDialogProps) {
  const [policy, setPolicy] = useState<WorkItemCompletionPolicy>();
  const [loaded, setLoaded] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const targetId = target?.id;

  useEffect(() => {
    setPolicy(undefined);
    setLoaded(false);
    setChecked(new Set());
    setBusy(false);
    setError(undefined);
    if (!targetId) return;
    let live = true;
    api
      .getWorkItem(targetId)
      .then((item) => {
        if (!live) return;
        setPolicy(item.completion);
        setLoaded(true);
      })
      .catch((cause) => {
        if (live) setError(errorMessage(cause, 'Không tải được điều kiện hoàn thành.'));
      });
    return () => {
      live = false;
    };
  }, [targetId]);

  if (!target) return null;

  const conditions = policy?.conditions ?? [];
  const required = requiredConfirmations(policy);
  const confirmedCount = conditions.filter((condition) => checked.has(condition.id)).length;
  const satisfied = completionSatisfied(policy, checked);

  const toggle = (id: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm([...checked]);
    } catch (cause) {
      setError(errorMessage(cause, 'Không hoàn thành được công việc.'));
    } finally {
      setBusy(false);
    }
  };

  const intro =
    conditions.length === 0
      ? `${target.code} · ${target.title}`
      : policy?.rule === 'at_least'
        ? `Tích xác nhận ít nhất ${required} trong ${conditions.length} điều kiện đã có đủ minh chứng, chứng từ.`
        : policy?.rule === 'none'
          ? 'Các điều kiện dưới đây không bắt buộc. Tích những mục đã có minh chứng, chứng từ để được ghi lại.'
          : 'Tích xác nhận đã có đủ minh chứng, chứng từ cho tất cả điều kiện dưới đây.';

  return (
    <ConfirmBox
      open
      title={
        conditions.length === 0
          ? 'Bạn có chắc chắn muốn hoàn thành công việc này?'
          : `Xác nhận hoàn thành ${target.code}`
      }
      message={
        conditions.length === 0 ? (
          intro
        ) : (
          <>
            <strong>{target.title}</strong>
            <br />
            {intro}
          </>
        )
      }
      confirmLabel="Hoàn thành công việc"
      tone="primary"
      busy={busy}
      confirmDisabled={!loaded || !satisfied}
      error={error}
      onConfirm={() => void submit()}
      onCancel={onClose}
    >
      {!loaded && !error ? <p className={styles.completeProgress}>Đang tải điều kiện hoàn thành…</p> : null}

      {conditions.length > 0 ? (
        <>
          <ul className={styles.completeList}>
            {conditions.map((condition) => (
              <li key={condition.id}>
                <label
                  className={styles.completeItem}
                  data-checked={checked.has(condition.id) || undefined}
                >
                  <input
                    type="checkbox"
                    checked={checked.has(condition.id)}
                    disabled={busy}
                    onChange={() => toggle(condition.id)}
                  />
                  <span>{condition.label}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className={styles.completeProgress} data-ready={satisfied || undefined}>
            {required === 0
              ? `Đã xác nhận ${confirmedCount}/${conditions.length} điều kiện (không bắt buộc).`
              : `Đã xác nhận ${confirmedCount}/${conditions.length} điều kiện, cần ít nhất ${required}.`}
          </p>
        </>
      ) : null}
    </ConfirmBox>
  );
}
