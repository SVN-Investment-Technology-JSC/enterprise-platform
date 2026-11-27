'use client';

import type { ProjectFinance, UpdateProjectFinanceRequest } from '@enterprise-platform/contracts-workspace';
import { authFetch } from '@enterprise-platform/shared-ui';
import { ExternalLink, ListFilter, Pencil } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { explicitTableStyle, useColumnOrder, useColumnWidths } from '../column-order';
import { formatPercent, formatVnd, formatVndCompact, parseVndInput, toVndInput } from '../money';
import {
  NO_VOUCHER_FILTER,
  PROJECT_VOUCHER_KIND_LABELS,
  PROJECT_VOUCHER_LINK_LABELS,
  PROJECT_VOUCHER_STATUS_LABELS,
  PROJECT_VOUCHER_STATUS_TONE,
  classifyProjectVoucherResponse,
  filterProjectVouchers,
  projectVoucherHref,
  actualProfit,
  type ProjectVoucherFilter,
  type ProjectVoucherList,
  type ProjectVoucherResult,
} from '../project-vouchers.model';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog, Field } from './dialog';
import { ReorderableTh, ResetColumnLayoutButton } from './reorderable-th';
import { useFillViewportHeight } from './use-fill-viewport';
import { Tooltip } from './tooltip';

export interface TabFinanceProps {
  readonly projectId: string;
  /** Số liệu có sẵn trong payload chi tiết dự án; tab không phải gọi lại. */
  readonly initial: ProjectFinance;
  /** Gọi sau khi ghi, để phần còn lại của màn Dự án tải lại. */
  readonly onChanged: () => void;
}

type LedgerColumn =
  | 'index'
  | 'content'
  | 'code'
  | 'creator'
  | 'createdAt'
  | 'postingDate'
  | 'received'
  | 'paid'
  | 'balance'
  | 'status';

/** Thứ tự cột mặc định của sổ chứng từ; người dùng kéo tiêu đề để đổi. */
const LEDGER_COLUMNS: readonly LedgerColumn[] = [
  'index',
  'content',
  'code',
  'creator',
  'createdAt',
  'postingDate',
  'received',
  'paid',
  'balance',
  'status',
];
const LEDGER_ALL_IDS: readonly string[] = LEDGER_COLUMNS;
const LEDGER_PINNED: readonly string[] = ['index'];

const LEDGER_HEADS: Record<LedgerColumn, { readonly label: string; readonly numeric?: boolean }> = {
  index: { label: 'STT' },
  content: { label: 'Nội dung' },
  code: { label: 'Mã chứng từ' },
  creator: { label: 'Người tạo' },
  createdAt: { label: 'Ngày tạo' },
  postingDate: { label: 'Ngày hạch toán' },
  received: { label: 'Phát sinh thu', numeric: true },
  paid: { label: 'Phát sinh chi', numeric: true },
  balance: { label: 'Dòng tiền', numeric: true },
  status: { label: 'Trạng thái' },
};

/** Dòng tiền của nhóm phiếu đã ghi sổ: thu trừ chi. */
function ledgerBalance(totals: { received: number; paid: number }): number {
  return totals.received - totals.paid;
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
 * Chi phí thực tế = chi ĐÃ DUYỆT hạch toán cho dự án; phiếu chờ duyệt/ghi sổ chưa là tiền thật nên hiện riêng. Hạch toán chỉ ở
 * cấp dự án (không xuống công việc), nên tab là sổ chứng từ của dự án như 1Office: thu, chi và dòng tiền luỹ kế. Không còn ngân
 * sách, dự toán hay chi phí dự kiến: chỉ có tiền đã thu và đã chi thật.
 */
export function TabFinance({ projectId, initial, onChanged }: TabFinanceProps) {
  const [finance, setFinance] = useState<ProjectFinance>(initial);
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<ProjectVoucherResult>();
  const [filter, setFilter] = useState<ProjectVoucherFilter>(NO_VOUCHER_FILTER);
  const ledger = useRef<HTMLDivElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelBox = useRef<HTMLDivElement>(null);
  const columns = useColumnOrder('project-finance', undefined, LEDGER_COLUMNS, LEDGER_PINNED);
  const sizing = useColumnWidths('project-finance', undefined, LEDGER_ALL_IDS);

  // Bấm ra ngoài bảng lọc thì đóng; bấm vào danh sách xổ của ô chọn (nằm trong bảng) thì không.
  useEffect(() => {
    if (!panelOpen) return undefined;
    const close = (event: MouseEvent) => {
      if (!panelBox.current?.contains(event.target as Node)) setPanelOpen(false);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [panelOpen]);

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

  const visibleVouchers = useMemo(() => (data ? filterProjectVouchers(data.items, filter) : []), [data, filter]);
  const filtering = filter.kind !== 'all' || filter.link !== 'all' || filter.status !== 'all';
  const facets = [filter.kind, filter.link, filter.status].filter((value) => value !== 'all').length;
  // Sổ chi tiết chiếm đúng phần cao còn lại và cuộn bên trong, nên trang không bị cuộn thêm.
  useFillViewportHeight(ledger, undefined, data ? 'ok' : 'wait');
  const contractPositive = contract != null && contract > 0;
  const percentOfContract = (amount: number) =>
    contractPositive ? formatPercent((amount / (contract as number)) * 100) : undefined;
  const collected = contractPositive ? Math.min(100, Math.max(0, (received / (contract as number)) * 100)) : 0;


  return (
    <div className={styles.tabBody}>
      <section className={styles.finSummary} aria-label="Tổng quan tài chính dự án">
        <div className={styles.finKpis}>
          <Tooltip content={formatVnd(contract)}>
            <div className={styles.finKpi}>
              <span className={styles.finKpiLabel}>Giá trị hợp đồng (trước VAT)</span>
              <span className={styles.finKpiValue}>{formatVndCompact(contract)}</span>
              <span className={styles.finKpiSub}>{contract == null ? 'Chưa nhập hợp đồng' : formatVnd(contract)}</span>
              <button type="button" className={styles.finKpiEdit} onClick={() => setEditing(true)}>
                <Pencil size={12} aria-hidden /> Sửa
              </button>
            </div>
          </Tooltip>
          {data ? (
            <>
              <Tooltip content={`${data.totals.receiptCount} phiếu thu hạch toán cho dự án`}>
                <div className={styles.finKpi}>
                  <span className={styles.finKpiLabel}>Đã thu</span>
                  <span className={styles.finKpiValue}>{formatVndCompact(data.totals.received)}</span>
                  <span className={styles.finKpiSub}>
                    {percentOfContract(data.totals.received)
                      ? `${percentOfContract(data.totals.received)} giá trị hợp đồng`
                      : `${data.totals.receiptCount} phiếu thu`}
                  </span>
                </div>
              </Tooltip>
              <Tooltip content={`${data.totals.paymentCount} phiếu chi hạch toán cho dự án`}>
                <div className={styles.finKpi}>
                  <span className={styles.finKpiLabel}>Đã chi (chi phí thực tế)</span>
                  <span className={styles.finKpiValue}>{formatVndCompact(data.totals.paid)}</span>
                  <span className={styles.finKpiSub}>
                    {percentOfContract(data.totals.paid)
                      ? `${percentOfContract(data.totals.paid)} giá trị hợp đồng`
                      : `${data.totals.paymentCount} phiếu chi`}
                  </span>
                </div>
              </Tooltip>
              <Tooltip content="Đã thu trừ đã chi, tính trên phiếu đã ghi sổ; biên lợi nhuận tính trên đã thu">
                <div
                  className={styles.finKpi}
                >
                  <span className={styles.finKpiLabel}>Lợi nhuận</span>
                  <span
                    className={`${styles.finKpiValue} ${profit != null && profit < 0 ? styles.finNegative : profit ? styles.finPositive : ''}`}
                  >
                    {formatVndCompact(profit)}
                  </span>
                  <span className={styles.finKpiSub}>{margin == null ? 'Chưa có doanh thu' : `Biên ${formatPercent(margin)} trên đã thu`}</span>
                </div>
              </Tooltip>
            </>
          ) : null}
        </div>
        {data ? (
          <div className={styles.finFoot}>
            {contractPositive ? (
              <Tooltip content={`Đã thu ${formatVnd(received)} / ${formatVnd(contract)}`}>
                <div className={styles.finCollect}>
                  <span className={styles.finFootLabel}>Tiến độ thu tiền</span>
                  <span className={styles.finTrack} role="img" aria-label={`Đã thu ${formatPercent(collected)} giá trị hợp đồng`}>
                    <span className={styles.finFill} style={{ width: `${collected}%` }} />
                  </span>
                  <b>{formatPercent(collected)}</b>
                </div>
              </Tooltip>
            ) : (
              <span className={styles.finFootLabel}>Nhập giá trị hợp đồng để theo dõi tiến độ thu tiền.</span>
            )}
            <Tooltip content="Gồm phiếu chờ duyệt và phiếu từ hồ sơ Quy trình đã duyệt đang chờ kế toán ghi sổ. Chưa ghi sổ nên chưa tính vào số liệu trên">
              <span className={styles.finPending}>
                Nháp (chưa ghi sổ): thu <b>{formatVnd(data.totals.pendingReceived)}</b> · chi <b>{formatVnd(data.totals.pendingPaid)}</b>
              </span>
            </Tooltip>
          </div>
        ) : null}
        {finance.actualCost > 0 ? (
          <p className={styles.finLegacy}>
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

      {data ? (
        <section ref={ledger} className={styles.ledgerCard}>
          <header className={styles.ledgerHead}>
            <div className={styles.finSwitch} role="tablist" aria-label="Sổ thu chi">
              <button type="button" role="tab" aria-selected className={styles.finSwitchActive}>
                Sổ chứng từ <span className={styles.finSwitchCount}>{data.items.length}</span>
              </button>
            </div>
            {(
              <div ref={panelBox} className={styles.timelinePanelBox}>
                <button
                  type="button"
                  className={facets > 0 || panelOpen ? styles.timelineToggleOn : styles.timelineToggle}
                  aria-haspopup="dialog"
                  aria-expanded={panelOpen}
                  onClick={() => setPanelOpen((value) => !value)}
                >
                  <ListFilter size={13} aria-hidden />
                  Bộ lọc
                  {facets > 0 ? <span className={styles.countBadge}>{facets}</span> : null}
                </button>
                {panelOpen ? (
                  <div
                    className={`${styles.timelinePanel} ${styles.finPanel}`}
                    role="dialog"
                    aria-label="Bộ lọc phiếu thu chi"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.stopPropagation();
                        setPanelOpen(false);
                      }
                    }}
                  >
                    <div className={styles.timelinePanelField}>
                      <span>Loại phiếu</span>
                      <Choice
                        label="Lọc theo loại phiếu"
                        selectOnly
                        value={filter.kind}
                        options={[
                          { value: 'all', label: 'Mọi loại phiếu' },
                          { value: 'RECEIPT', label: PROJECT_VOUCHER_KIND_LABELS.RECEIPT },
                          { value: 'PAYMENT', label: PROJECT_VOUCHER_KIND_LABELS.PAYMENT },
                        ]}
                        onChange={(value) => setFilter((current) => ({ ...current, kind: value as ProjectVoucherFilter['kind'] }))}
                      />
                    </div>
                    <div className={styles.timelinePanelField}>
                      <span>Quan hệ với dự án</span>
                      <Choice
                        label="Lọc theo quan hệ với dự án"
                        selectOnly
                        value={filter.link}
                        options={[
                          { value: 'all', label: 'Mọi quan hệ' },
                          { value: 'ALLOCATION', label: PROJECT_VOUCHER_LINK_LABELS.ALLOCATION },
                          { value: 'RELATED', label: PROJECT_VOUCHER_LINK_LABELS.RELATED },
                        ]}
                        onChange={(value) => setFilter((current) => ({ ...current, link: value as ProjectVoucherFilter['link'] }))}
                      />
                    </div>
                    <div className={styles.timelinePanelField}>
                      <span>Trạng thái</span>
                      <Choice
                        label="Lọc theo trạng thái phiếu"
                        selectOnly
                        value={filter.status}
                        options={[
                          { value: 'all', label: 'Mọi trạng thái' },
                          { value: 'APPROVED', label: PROJECT_VOUCHER_STATUS_LABELS.APPROVED },
                          { value: 'DRAFT', label: PROJECT_VOUCHER_STATUS_LABELS.DRAFT },
                        ]}
                        onChange={(value) => setFilter((current) => ({ ...current, status: value as ProjectVoucherFilter['status'] }))}
                      />
                    </div>
                    <button
                      type="button"
                      className={styles.linkButton}
                      disabled={!filtering}
                      onClick={() => setFilter(NO_VOUCHER_FILTER)}
                    >
                      Bỏ lọc
                    </button>
                  </div>
                ) : null}
              </div>
            )}
            <ResetColumnLayoutButton order={columns} sizing={sizing} />
          </header>

          <div className={styles.ledgerScroll}>
              <table
                className={`${styles.table} ${styles.ledgerTable} ${sizing.customized ? styles.columnsResized : ''}`}
                style={explicitTableStyle(columns.order, sizing.widths)}
              >
                <thead>
                  <tr>
                    {columns.order.map((id) => {
                      const head = LEDGER_HEADS[id as LedgerColumn];
                      return (
                        <ReorderableTh
                          key={id}
                          tableKey="project-finance"
                          id={id}
                          order={columns.order}
                          pinned={LEDGER_PINNED}
                          onMove={columns.move}
                          sizing={sizing}
                          label={head.label}
                          className={head.numeric ? styles.numeric : undefined}
                        >
                          {head.label}
                        </ReorderableTh>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {data.items.length > 0 ? (
                    // Dòng tổng ở đầu như sổ chứng từ: chỉ phiếu đã ghi sổ hạch toán cho dự án; dòng tiền = thu trừ chi.
                    <tr className={styles.ledgerTotal}>
                      {columns.order.map((id) => {
                        switch (id as LedgerColumn) {
                          case 'content':
                            return (
                              <td key={id}>
                                <strong>Tổng</strong>
                              </td>
                            );
                          case 'received':
                            return (
                              <td key={id} className={styles.numeric}>
                                <strong>{formatVnd(data.totals.received)}</strong>
                              </td>
                            );
                          case 'paid':
                            return (
                              <td key={id} className={styles.numeric}>
                                <strong>{formatVnd(data.totals.paid)}</strong>
                              </td>
                            );
                          case 'balance':
                            return (
                              <td key={id} className={`${styles.numeric} ${ledgerBalance(data.totals) < 0 ? styles.finNegative : ''}`}>
                                <strong>{formatVnd(ledgerBalance(data.totals))}</strong>
                              </td>
                            );
                          default:
                            return <td key={id} />;
                        }
                      })}
                    </tr>
                  ) : null}
                  {data.items.length === 0 ? (
                    <tr>
                      <td colSpan={10} className={styles.muted}>
                        Dự án chưa có phiếu thu chi nào. Phiếu hạch toán cho dự án này ở module Tài chính sẽ hiện ở đây.
                      </td>
                    </tr>
                  ) : visibleVouchers.length === 0 ? (
                    <tr>
                      <td colSpan={10} className={styles.muted}>
                        Không có phiếu nào khớp bộ lọc.
                      </td>
                    </tr>
                  ) : null}
                  {visibleVouchers.map((item, index) => {
                    const tone = PROJECT_VOUCHER_STATUS_TONE[item.status];
                    // Phiếu chờ/chỉ liên quan chưa phải tiền của dự án: số mờ đi và không có dòng tiền.
                    const settled = item.link === 'ALLOCATION' && item.status === 'APPROVED';
                    const amount = settled ? formatVnd(item.totalAmount) : <span className={styles.muted}>{formatVnd(item.totalAmount)}</span>;
                    const cells: Record<LedgerColumn, ReactNode> = {
                      index: <td key="index">{index + 1}</td>,
                      content: (
                        <td key="content">
                          <Tooltip content={item.content}>
                            <span className={styles.treeTitle}>{item.content}</span>
                          </Tooltip>
                          {item.reasonName || item.link === 'RELATED' ? (
                            <span className={styles.muted} style={{ display: 'block' }}>
                              {[item.reasonName, item.link === 'RELATED' ? 'Chỉ liên quan' : null].filter(Boolean).join(' · ')}
                            </span>
                          ) : null}
                        </td>
                      ),
                      code: (
                        <td key="code">
                          <Tooltip content="Mở phiếu ở module Tài chính">
                            <a className={styles.wbsProcedure} href={projectVoucherHref(item)}>
                              <ExternalLink size={12} aria-hidden />
                              {item.code}
                            </a>
                          </Tooltip>
                          <span className={styles.muted} style={{ display: 'block' }}>
                            {PROJECT_VOUCHER_KIND_LABELS[item.kind]}
                          </span>
                        </td>
                      ),
                      creator: <td key="creator">{item.createdByName ?? '—'}</td>,
                      createdAt: <td key="createdAt">{formatDay(item.createdAt.slice(0, 10))}</td>,
                      postingDate: <td key="postingDate">{formatDay(item.postingDate)}</td>,
                      received: (
                        <td key="received" className={styles.numeric}>
                          {item.kind === 'RECEIPT' ? amount : '--'}
                        </td>
                      ),
                      paid: (
                        <td key="paid" className={styles.numeric}>
                          {item.kind === 'PAYMENT' ? amount : '--'}
                        </td>
                      ),
                      balance: (
                        <td key="balance" className={`${styles.numeric} ${item.balance !== null && item.balance < 0 ? styles.finNegative : ''}`}>
                          {item.balance === null ? '--' : formatVnd(item.balance)}
                        </td>
                      ),
                      status: (
                        <td key="status">
                          <span className={styles.pill} style={{ background: tone.bg, color: tone.fg }}>
                            {PROJECT_VOUCHER_STATUS_LABELS[item.status]}
                          </span>
                        </td>
                      ),
                    };
                    return (
                      <tr key={item.id}>
                        {columns.order.map((id) => cells[id as LedgerColumn])}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
          </div>

          <footer className={styles.ledgerFoot}>
            {data.truncated
              ? 'Chỉ hiển thị 200 phiếu gần nhất; tổng tiền và dòng tiền ở trên vẫn tính đủ mọi phiếu hạch toán.'
              : 'Dòng tiền luỹ kế chỉ tính phiếu đã ghi sổ hạch toán cho dự án, theo ngày hạch toán. Phiếu chờ duyệt/ghi sổ và phiếu chỉ liên quan (mục "Đối tượng liên quan") hiện mờ để tra cứu, không cộng vào tổng.'}
          </footer>
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
      subtitle="Đơn vị VND, chưa gồm VAT. Gõ 25.500.000.000 hoặc 25500000000 đều được."
      submitLabel="Lưu"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Giá trị hợp đồng (trước VAT)" hint="Để trống nếu chưa ký hợp đồng.">
        <input inputMode="decimal" value={contract} onChange={(event) => setContract(event.target.value)} />
      </Field>
    </Dialog>
  );
}
