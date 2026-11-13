'use client';

import type { FlowNode } from '@enterprise-platform/contracts-correspondence';
import { formatDateTime } from '@enterprise-platform/shared-ui';
import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { formatDay } from '../correspondence.model';
import styles from '../correspondence.module.scss';

/**
 * Thanh tiến trình của công văn, dựng đúng theo quy trình cấu hình: các bước cố định của luồng
 * xen các bước duyệt. Mỗi ô ghi người đã làm / đang được giao / sẽ làm, và lúc xong. Nhiều
 * bước thì cuộn ngang, ô đang làm luôn được cuộn tới cho thấy.
 */
export function FlowStepper({
  nodes,
  workflowName,
  cancelled = false,
}: {
  readonly nodes: readonly FlowNode[];
  readonly workflowName?: string;
  readonly cancelled?: boolean;
}) {
  const current = useRef<HTMLLIElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [nodes]);

  const approvals = nodes.filter((node) => node.approval).length;
  return (
    <section className={styles.flowCard} aria-label="Tiến trình xử lý">
      <div className={styles.flowCardHead}>
        <span>Tiến trình xử lý</span>
        <span className={styles.muted}>
          {workflowName ? `Quy trình: ${workflowName}` : 'Theo cấu hình'}
          {approvals === 0 ? ' · không có bước duyệt' : ` · ${approvals} bước duyệt`}
        </span>
      </div>
      <ol className={styles.flowTrack}>
        {nodes.map((node, index) => {
          const state = cancelled && node.state !== 'done' ? 'todo' : node.state;
          return (
            <li
              key={node.key}
              ref={state === 'current' ? current : undefined}
              className={[
                styles.flowNode,
                state === 'done' ? styles.flowNodeDone : '',
                state === 'current' ? styles.flowNodeCurrent : '',
                node.approval ? styles.flowNodeApproval : '',
              ].join(' ')}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className={styles.flowDot} aria-hidden>
                {state === 'done' ? <Check size={13} strokeWidth={3} /> : index + 1}
              </span>
              <span className={styles.flowLabel}>{node.label}</span>
              {node.people ? (
                <span className={styles.flowPeople} title={node.people}>
                  {node.people}
                </span>
              ) : null}
              <span className={styles.flowWhen}>
                {state === 'current'
                  ? 'Đang xử lý'
                  : state === 'done' && node.at
                    ? node.at.length > 10
                      ? formatDateTime(node.at)
                      : formatDay(node.at)
                    : state === 'done'
                      ? 'Đã xong'
                      : node.approval
                        ? 'Bước duyệt'
                        : ' '}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
