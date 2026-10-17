'use client';

import type { ProjectFinance, UpdateProjectFinanceRequest } from '@enterprise-platform/contracts-workspace';
import { authFetch } from '@enterprise-platform/shared-ui';
import { ExternalLink, Pencil } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatPercent, formatVnd, formatVndCompact, parseVndInput, toVndInput } from '../money';
import {
  NO_VOUCHER_FILTER,
  PROJECT_VOUCHER_KIND_LABELS,
  PROJECT_VOUCHER_LINK_LABELS,
  PROJECT_VOUCHER_STATUS_LABELS,
  PROJECT_VOUCHER_STATUS_TONE,
  buildWorkItemMoneyRows,
  classifyProjectVoucherResponse,
  filterProjectVouchers,
  projectLevelMoneyRow,
  projectVoucherHref,
  actualProfit,
  type ProjectVoucherFilter,
  type ProjectVoucherList,
  type ProjectVoucherResult,
} from '../project-vouchers.model';
import * as api from '../workspace-api';
import { WORK_ITEM_STATUS_LABELS } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';

export interface TabFinanceProps {
  readonly projectId: string;
  /** Số liệu có sẵn trong payload chi tiết dự án; tab không phải gọi lại. */
  readonly initial: ProjectFinance;
  /** Gọi sau khi ghi, để phần còn lại của màn Dự án tải lại. */
  readonly onChanged: () => void;
}

/** `2026-10-09` → `09/10/2026`; đọc thẳng chuỗi, không qua Date (lệch múi giờ). */
function formatDay(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
}

/**
 * Tab Tài chính của dự án: giá trị hợp đồng (Workspace) cùng thu chi thực tế (module Tài chính).
 *
 * **Chỉ được dựng khi người dùng được xem tài chính dự án** (chủ nhiệm, quản lý, quản trị tenant). Với thành viên và người xem,
 * tab bị gỡ khỏi thanh tab và server không gửi số liệu xuống. Số thu chi thuộc module Tài chính nên cần thêm quyền xem phiếu
 * ở đó; thiếu quyền hay Tài chính chưa bật thì tab vẫn dựng được phần hợp đồng và nói rõ vì sao chưa có số thu chi.
 *
 * Chi phí thực tế = chi ĐÃ DUYỆT hạch toán cho dự án hoặc cho công việc; phiếu chờ duyệt chưa ghi sổ nên hiện riêng. Không còn
 * ngân sách, dự toán hay chi phí dự kiến: chỉ có tiền đã thu và đã chi thật.
 */
export function TabFinance({ projectId, initial, onChanged }: TabFinanceProps) {
  const [finance, setFinance] = useState<ProjectFinance>(initial);
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<ProjectVoucherResult>();
  const [filter, setFilter] = useState<ProjectVoucherFilter>(NO_VOUCHER_FILTER);

  // Payload chi tiết dự án đổi (tải lại, chuyển dự án) thì lấy số mới.
  useEffect(() => setFinance(initial), [initial]);

  useEffect(() => {
    let alive = true;
    setResult(undefined);
    setFilter(NO_VOUCHER_FILTER);
    authFetch(`/api/finance/v1/projects/${encodeURIComponent(projectId)}/vouchers`, { cache: 'no-store' })
      .then(classifyProjectVoucherResponse)
      .then((next) => {
        if (alive) setResult(next);
      })
      .catch(() => {
        if (alive) setResult({ state: 'unavailable', message: 'Không kết nối được module Tài chính.' });
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const data: ProjectVoucherList | undefined = result?.state === 'ok' ? result.data : undefined;
  const contract = finance.contractValue;
  const received = data?.totals.received ?? 0;
  const paid = data?.totals.paid ?? 0;
  const { profit, margin } = actualProfit(received, paid);

  const projectRow = useMemo(() => (data ? projectLevelMoneyRow(data) : undefined), [data]);
  const itemRows = useMemo(() => (data ? buildWorkItemMoneyRows(finance.items, data) : []), [data, finance.items]);
  const visibleVouchers = useMemo(() => (data ? filterProjectVouchers(data.items, filter) : []), [data, filter]);
  const filtering = filter.kind !== 'all' || filter.link !== 'all' || filter.status !== 'all';

  return (
    <div className={styles.tabBody}>
      <div className={styles.statRow}>
        <MoneyStat label="Giá trị hợp đồng" value={contract} />
        {data ? (
          <>
            <MoneyStat label="Đã thu" value={data.totals.received} hint={`${data.totals.receiptCount} phiếu thu hạch toán cho dự án`} />
            <MoneyStat label="Đã chi (chi phí thực tế)" value={data.totals.paid} hint={`${data.totals.paymentCount} phiếu chi hạch toán cho dự án`} />
            <MoneyStat
              label={margin == null ? 'Lợi nhuận' : `Lợi nhuận (${formatPercent(margin)})`}
              value={profit}
              danger={profit != null && profit < 0}
              hint="Đã thu trừ đã chi, tính trên phiếu đã ghi sổ; biên lợi nhuận tính trên đã thu"
            />
          </>
        ) : null}
      </div>

      <section className={styles.panel}>
        <h3 className={styles.panelHeadRow}>
          Số liệu dự án
          <button type="button" className={styles.buttonGhost} onClick={() => setEditing(true)}>
            <Pencil size={13} /> Sửa hợp đồng
          </button>
        </h3>
        <dl className={styles.definitionList}>
          <dt>Giá trị hợp đồng</dt>
          <dd>{formatVnd(contract)}</dd>
          {data ? (
            <>
              <dt>Đã thu</dt>
              <dd>{formatVnd(received)}</dd>
              <dt>Đã chi</dt>
              <dd>{formatVnd(paid)}</dd>
              <dt>Chờ duyệt</dt>
              <dd>
                thu {formatVnd(data.totals.pendingReceived)} · chi {formatVnd(data.totals.pendingPaid)}
              </dd>
            </>
          ) : null}
        </dl>
        {finance.actualCost > 0 ? (
          <p className={styles.muted}>
            Dự án còn {formatVnd(finance.actualCost)} chi phí ghi tay theo cách cũ ở Workspace. Khoản này không tính vào số liệu trên; chi phí thực tế nay lấy từ phiếu chi đã duyệt ở module Tài chính.
          </p>
        ) : null}
      </section>

      {!result ? <p className={styles.muted}>Đang tải thu chi của dự án…</p> : null}
      {result && !data ? (
        <section className={styles.panel}>
          <h3>Thu chi</h3>
          <p className={styles.muted} role="status">
            {result.state === 'ok' ? '' : result.message}
          </p>
        </section>
      ) : null}

      {data && projectRow ? (
        <section className={styles.panel}>
          <h3 className={styles.panelHeadRow}>
            Thu chi theo công việc
            <span className={styles.muted}>Chi đã duyệt hạch toán cho công việc là chi phí thực tế của công việc đó. Lập và duyệt phiếu ở module Tài chính.</span>
          </h3>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Công việc</th>
                  <th>Trạng thái</th>
                  <th className={styles.numeric}>Đã thu</th>
                  <th className={styles.numeric}>Đã chi (thực tế)</th>
                  <th className={styles.numeric}>Chờ duyệt (thu / chi)</th>
                </tr>
              </thead>
              <tbody>
                {[projectRow, ...itemRows].map((row) => (
                  <tr key={row.workItemId ?? 'project'}>
                    <td className={styles.treeCode}>{row.code}</td>
                    <td>{row.title}</td>
                    <td>{row.status ? WORK_ITEM_STATUS_LABELS[row.status] : ''}</td>
                    <td className={styles.numeric}>{formatVnd(row.received)}</td>
                    <td className={styles.numeric}>{formatVnd(row.paid)}</td>
                    <td className={styles.numeric}>
                      {row.pendingReceived || row.pendingPaid ? `${formatVnd(row.pendingReceived)} / ${formatVnd(row.pendingPaid)}` : '—'}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td />
                  <td>
                    <strong>Tổng dự án</strong>
                  </td>
                  <td />
                  <td className={styles.numeric}>
                    <strong>{formatVnd(data.totals.received)}</strong>
                  </td>
                  <td className={styles.numeric}>
                    <strong>{formatVnd(data.totals.paid)}</strong>
                  </td>
                  <td className={styles.numeric}>
                    {data.totals.pendingReceived || data.totals.pendingPaid
                      ? `${formatVnd(data.totals.pendingReceived)} / ${formatVnd(data.totals.pendingPaid)}`
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data ? (
        <section className={styles.panel}>
          <h3 className={styles.panelHeadRow}>
            Phiếu thu chi của dự án
            <span className={styles.muted}>Phiếu có dự án này ở mục "Đối tượng liên quan" chỉ để tra cứu, không cộng vào tổng.</span>
          </h3>
          <div className={styles.workFilters}>
            <div className={styles.filterField}>
              <span className={styles.filterLabel}>Loại phiếu</span>
              <Choice
                label="Lọc theo loại phiếu"
                value={filter.kind}
                options={[
                  { value: 'all', label: 'Tất cả' },
                  { value: 'RECEIPT', label: PROJECT_VOUCHER_KIND_LABELS.RECEIPT },
                  { value: 'PAYMENT', label: PROJECT_VOUCHER_KIND_LABELS.PAYMENT },
                ]}
                onChange={(value) => setFilter((current) => ({ ...current, kind: value as ProjectVoucherFilter['kind'] }))}
              />
            </div>
            <div className={styles.filterField}>
              <span className={styles.filterLabel}>Quan hệ với dự án</span>
              <Choice
                label="Lọc theo quan hệ với dự án"
                value={filter.link}
                options={[
                  { value: 'all', label: 'Tất cả' },
                  { value: 'ALLOCATION', label: PROJECT_VOUCHER_LINK_LABELS.ALLOCATION },
                  { value: 'RELATED', label: PROJECT_VOUCHER_LINK_LABELS.RELATED },
                ]}
                onChange={(value) => setFilter((current) => ({ ...current, link: value as ProjectVoucherFilter['link'] }))}
              />
            </div>
            <div className={styles.filterField}>
              <span className={styles.filterLabel}>Trạng thái</span>
              <Choice
                label="Lọc theo trạng thái phiếu"
                value={filter.status}
                options={[
                  { value: 'all', label: 'Tất cả' },
                  { value: 'APPROVED', label: PROJECT_VOUCHER_STATUS_LABELS.APPROVED },
                  { value: 'PENDING', label: PROJECT_VOUCHER_STATUS_LABELS.PENDING },
                ]}
                onChange={(value) => setFilter((current) => ({ ...current, status: value as ProjectVoucherFilter['status'] }))}
              />
            </div>
            {filtering ? (
              <button type="button" className={styles.linkButton} onClick={() => setFilter(NO_VOUCHER_FILTER)}>
                Bỏ lọc
              </button>
            ) : null}
          </div>
          <div className={styles.tableScroll}>
            <table className={`${styles.table} ${styles.wbsTable}`}>
              <thead>
                <tr>
                  <th>Phiếu</th>
                  <th>Loại phiếu</th>
                  <th>Ngày</th>
                  <th>Nội dung</th>
                  <th>Hạch toán</th>
                  <th style={{ textAlign: 'right' }}>Tiền thu</th>
                  <th style={{ textAlign: 'right' }}>Tiền chi</th>
                  <th>Trạng thái</th>
                  <th>Người lập</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className={styles.muted}>
                      Dự án chưa có phiếu thu chi nào. Phiếu hạch toán cho dự án này ở module Tài chính sẽ hiện ở đây.
                    </td>
                  </tr>
                ) : visibleVouchers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className={styles.muted}>
                      Không có phiếu nào khớp bộ lọc.
                    </td>
                  </tr>
                ) : null}
                {visibleVouchers.map((item) => {
                  const tone = PROJECT_VOUCHER_STATUS_TONE[item.status];
                  const amount = item.link === 'RELATED' ? <span className={styles.muted}>{formatVnd(item.totalAmount)}</span> : formatVnd(item.totalAmount);
                  return (
                    <tr key={item.id}>
                      <td>
                        <a className={styles.wbsProcedure} href={projectVoucherHref(item)} title="Mở phiếu ở module Tài chính">
                          <ExternalLink size={12} aria-hidden />
                          {item.code}
                        </a>
                      </td>
                      <td>{PROJECT_VOUCHER_KIND_LABELS[item.kind]}</td>
                      <td>{formatDay(item.voucherDate)}</td>
                      <td>
                        <span className={styles.treeTitle} title={item.content}>
                          {item.content}
                        </span>
                        {item.reasonName ? (
                          <span className={styles.muted} style={{ display: 'block' }}>
                            {item.reasonName}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {item.link === 'RELATED' ? (
                          <span className={styles.muted}>Chỉ liên quan</span>
                        ) : item.workItem ? (
                          <span title={item.workItem.title}>
                            <span className={styles.treeCode}>{item.workItem.code}</span> {item.workItem.title}
                          </span>
                        ) : (
                          'Cả dự án'
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{item.kind === 'RECEIPT' ? amount : '—'}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{item.kind === 'PAYMENT' ? amount : '—'}</td>
                      <td>
                        <span className={styles.pill} style={{ background: tone.bg, color: tone.fg }}>
                          {PROJECT_VOUCHER_STATUS_LABELS[item.status]}
                        </span>
                      </td>
                      <td>{item.createdByName ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.truncated ? (
            <p className={styles.muted}>Chỉ hiển thị 200 phiếu gần nhất; tổng tiền ở trên vẫn tính đủ mọi phiếu hạch toán.</p>
          ) : null}
        </section>
      ) : null}

      <ContractDialog
        open={editing}
        finance={finance}
        onClose={() => setEditing(false)}
        onSave={async (input) => {
          setFinance(await api.updateProjectFinance(projectId, input));
          onChanged();
        }}
      />
    </div>
  );
}

function MoneyStat({ label, value, danger, hint }: { label: string; value: number | null; danger?: boolean; hint?: string }) {
  return (
    <div className={danger ? styles.statDanger : styles.stat} title={hint ?? formatVnd(value)}>
      <span className={styles.statValue}>{formatVndCompact(value)}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

/**
 * Sửa giá trị hợp đồng, số duy nhất của dự án do Workspace giữ. Kiểm số âm và chuỗi không đọc được ngay ở client để báo sớm;
 * server vẫn kiểm lại — client chỉ là tiện lợi, không phải hàng rào.
 */
function ContractDialog({
  open,
  finance,
  onClose,
  onSave,
}: {
  open: boolean;
  finance: ProjectFinance;
  onClose: () => void;
  onSave: (input: UpdateProjectFinanceRequest) => Promise<void>;
}) {
  const [contract, setContract] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setContract(toVndInput(finance.contractValue));
    setError(undefined);
    setSubmitting(false);
  }, [open, finance]);

  const submit = async () => {
    const parsed = parseVndInput(contract);
    if (parsed === undefined) return setError('Giá trị hợp đồng: không đọc được số.');
    if (parsed !== null && parsed < 0) return setError('Giá trị hợp đồng không được là số âm.');
    setSubmitting(true);
    try {
      await onSave({ contractValue: parsed });
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được giá trị hợp đồng.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Giá trị hợp đồng"
      subtitle="Đơn vị VND. Gõ 25.500.000.000 hoặc 25500000000 đều được."
      submitLabel="Lưu"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Giá trị hợp đồng" hint="Để trống nếu chưa ký hợp đồng.">
        <input inputMode="decimal" value={contract} onChange={(event) => setContract(event.target.value)} />
      </Field>
    </Dialog>
  );
}
