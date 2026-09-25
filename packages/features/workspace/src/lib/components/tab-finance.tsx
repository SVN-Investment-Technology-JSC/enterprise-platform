'use client';

import {
  MAX_COST_NOTE_LENGTH,
  type CostEntry,
  type ProjectFinance,
  type UpdateProjectFinanceRequest,
  type WorkItemCost,
} from '@enterprise-platform/contracts-workspace';
import { Pencil } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  formatPercent,
  formatVnd,
  formatVndCompact,
  parseVndInput,
  toVndInput,
} from '../money';
import * as api from '../workspace-api';
import { formatDateTime, WORK_ITEM_STATUS_LABELS } from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Dialog, Field } from './dialog';
import { useDirectory } from './use-directory';

export interface TabFinanceProps {
  readonly projectId: string;
  /** Số liệu có sẵn trong payload chi tiết dự án; tab không phải gọi lại. */
  readonly initial: ProjectFinance;
  /** Gọi sau khi ghi, để phần còn lại của màn Dự án tải lại. */
  readonly onChanged: () => void;
}

/**
 * Tab Tài chính.
 *
 * **Component này chỉ được dựng khi người dùng được xem tài chính.** Với
 * `member` và `viewer`, tab bị gỡ khỏi thanh tab ngay từ đầu — không làm mờ,
 * không để trống — vì server đã không gửi số liệu xuống cho họ.
 */
export function TabFinance({ projectId, initial, onChanged }: TabFinanceProps) {
  const [finance, setFinance] = useState<ProjectFinance>(initial);
  const [editingProject, setEditingProject] = useState(false);
  const [editingItem, setEditingItem] = useState<WorkItemCost>();
  const [recordingItem, setRecordingItem] = useState<WorkItemCost>();
  const [entries, setEntries] = useState<readonly CostEntry[]>();
  const [entriesError, setEntriesError] = useState<string>();
  const directory = useDirectory();

  const loadEntries = useCallback(async () => {
    setEntriesError(undefined);
    try {
      setEntries((await api.listProjectCostEntries(projectId)).items);
    } catch (cause) {
      setEntriesError((cause as { message?: string })?.message ?? 'Không tải được sổ chi phí.');
    }
  }, [projectId]);

  useEffect(() => {
    setEntries(undefined);
    void loadEntries();
  }, [loadEntries]);

  // Payload chi tiết dự án đổi (tải lại, chuyển dự án) thì lấy số mới.
  useEffect(() => setFinance(initial), [initial]);

  const apply = (next: ProjectFinance) => {
    setFinance(next);
    onChanged();
  };

  return (
    <div className={styles.tabBody}>
      <div className={styles.statRow}>
        <MoneyStat label="Giá trị hợp đồng" value={finance.contractValue} />
        <MoneyStat label="Chi phí thực tế" value={finance.actualCost} />
        <MoneyStat
          label={finance.forecastOverridden ? 'Chi phí dự kiến (ghi đè)' : 'Chi phí dự kiến'}
          value={finance.forecastCost}
        />
        <MoneyStat
          label="Lợi nhuận dự kiến"
          value={finance.profit}
          danger={finance.profit != null && finance.profit < 0}
        />
        <div
          className={
            finance.profitMargin != null && finance.profitMargin < 0
              ? styles.statDanger
              : styles.stat
          }
        >
          <span className={styles.statValue}>{formatPercent(finance.profitMargin)}</span>
          <span className={styles.statLabel}>Biên lợi nhuận</span>
        </div>
      </div>

      <section className={styles.panel}>
        <h3 className={styles.panelHeadRow}>
          Số liệu dự án
          <button
            type="button"
            className={styles.buttonGhost}
            onClick={() => setEditingProject(true)}
          >
            <Pencil size={13} /> Sửa
          </button>
        </h3>
        <dl className={styles.definitionList}>
          <dt>Giá trị hợp đồng</dt>
          <dd>{formatVnd(finance.contractValue)}</dd>
          <dt>Ngân sách được duyệt</dt>
          <dd>{formatVnd(finance.budget)}</dd>
          <dt>Chi phí đã cam kết</dt>
          <dd>{formatVnd(finance.committedCost)}</dd>
          <dt>Chi phí thực tế</dt>
          <dd>{formatVnd(finance.actualCost)}</dd>
          <dt>Dự toán còn lại</dt>
          <dd>{formatVnd(finance.remainingEstimate)}</dd>
          <dt>Chi phí dự kiến</dt>
          <dd>
            {formatVnd(finance.forecastCost)}
            {finance.forecastOverridden ? (
              <span className={styles.muted}> — ghi đè tay, không theo công thức</span>
            ) : null}
          </dd>
          <dt>Chênh lệch ngân sách</dt>
          <dd className={finance.budgetVariance != null && finance.budgetVariance < 0 ? styles.cellDanger : undefined}>
            {formatVnd(finance.budgetVariance)}
            {finance.budgetVariance != null && finance.budgetVariance < 0 ? ' — dự kiến vượt ngân sách' : ''}
          </dd>
        </dl>
        <p className={styles.muted}>
          Chi phí dự kiến = thực tế + đã cam kết + dự toán của các công việc chưa đóng. Đơn vị
          VND; chưa hỗ trợ đa tiền tệ.
        </p>
      </section>

      <section className={styles.panel}>
        <h3>Chi phí theo công việc</h3>
        {finance.items.length === 0 ? (
          <p className={styles.muted}>Dự án chưa có công việc nào.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Mã</th>
                <th>Công việc</th>
                <th>Trạng thái</th>
                <th className={styles.numeric}>Dự toán</th>
                <th className={styles.numeric}>Thực tế</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {finance.items.map((item) => (
                <tr key={item.workItemId}>
                  <td className={styles.treeCode}>{item.code}</td>
                  <td>{item.title}</td>
                  <td>{WORK_ITEM_STATUS_LABELS[item.status]}</td>
                  <td className={styles.numeric}>{formatVnd(item.estimatedCost)}</td>
                  <td className={styles.numeric}>{formatVnd(item.actualCost)}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => setEditingItem(item)}
                      >
                        Dự toán
                      </button>
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => setRecordingItem(item)}
                      >
                        Ghi chi phí
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.panel}>
        <h3>Sổ chi phí thực tế</h3>
        <p className={styles.muted}>
          Mỗi khoản chi ghi một dòng kèm lý do; nhập sai thì ghi một dòng âm để điều chỉnh. Sổ
          chỉ ghi thêm, không sửa hay xoá dòng cũ.
        </p>
        {entriesError ? <p className={styles.alert}>{entriesError}</p> : null}
        {entries === undefined && !entriesError ? <p className={styles.muted}>Đang tải…</p> : null}
        {entries?.length === 0 ? <p className={styles.muted}>Chưa ghi khoản chi nào.</p> : null}
        {entries && entries.length > 0 ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>Công việc</th>
                <th>Lý do</th>
                <th>Người ghi</th>
                <th className={styles.numeric}>Số tiền</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDateTime(entry.createdAt)}</td>
                  <td>
                    <span className={styles.treeCode}>{entry.workItemCode}</span> {entry.workItemTitle}
                  </td>
                  <td>{entry.note}</td>
                  <td>{directory.nameOf(entry.createdBy)}</td>
                  <td className={entry.amount < 0 ? `${styles.numeric} ${styles.cellDanger}` : styles.numeric}>
                    {formatVnd(entry.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <ProjectFinanceDialog
        open={editingProject}
        finance={finance}
        onClose={() => setEditingProject(false)}
        onSave={async (input) => apply(await api.updateProjectFinance(projectId, input))}
      />

      <ItemCostDialog
        item={editingItem}
        onClose={() => setEditingItem(undefined)}
        onSave={async (estimatedCost) => {
          if (!editingItem) return;
          // Lỗi ném ra để hộp thoại tự hiện; không nhân đôi lên đầu trang.
          apply(await api.updateWorkItemCost(editingItem.workItemId, { estimatedCost }));
        }}
      />

      <CostEntryDialog
        item={recordingItem}
        onClose={() => setRecordingItem(undefined)}
        onSave={async (amount, note) => {
          if (!recordingItem) return;
          const result = await api.addCostEntry(recordingItem.workItemId, { amount, note });
          apply(result.finance);
          setEntries((current) => (current ? [result.entry, ...current] : [result.entry]));
        }}
      />
    </div>
  );
}

function MoneyStat({
  label,
  value,
  danger,
}: {
  label: string;
  value: number | null;
  danger?: boolean;
}) {
  return (
    <div className={danger ? styles.statDanger : styles.stat} title={formatVnd(value)}>
      <span className={styles.statValue}>{formatVndCompact(value)}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

/**
 * Một ô nhập tiền.
 *
 * Kiểm số âm và chuỗi không đọc được **ngay ở client** để báo sớm; server vẫn
 * kiểm lại — client chỉ là tiện lợi, không phải hàng rào.
 */
function readMoney(
  text: string,
  label: string,
  nullable: boolean,
): { value?: number | null; error?: string } {
  const parsed = parseVndInput(text);
  if (parsed === undefined) return { error: `${label}: không đọc được số.` };
  if (parsed === null) {
    return nullable ? { value: null } : { error: `${label} không được để trống.` };
  }
  if (parsed < 0) return { error: `${label} không được là số âm.` };
  return { value: parsed };
}

function ProjectFinanceDialog({
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
  const [form, setForm] = useState({ contract: '', budget: '', committed: '', override: '' });
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      contract: toVndInput(finance.contractValue),
      budget: toVndInput(finance.budget),
      committed: toVndInput(finance.committedCost),
      override: toVndInput(finance.forecastCostOverride),
    });
    setError(undefined);
    setSubmitting(false);
  }, [open, finance]);

  const submit = async () => {
    const contract = readMoney(form.contract, 'Giá trị hợp đồng', true);
    const budget = readMoney(form.budget, 'Ngân sách', true);
    const committed = readMoney(form.committed || '0', 'Chi phí đã cam kết', false);
    const override = readMoney(form.override, 'Chi phí dự kiến ghi đè', true);
    const firstError = [contract, budget, committed, override].find((entry) => entry.error)?.error;
    if (firstError) {
      setError(firstError);
      return;
    }

    setSubmitting(true);
    try {
      await onSave({
        contractValue: contract.value,
        budget: budget.value,
        committedCost: committed.value as number,
        forecastCostOverride: override.value,
      });
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được số liệu tài chính.');
      setSubmitting(false);
    }
  };

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <Dialog
      open={open}
      title="Số liệu tài chính dự án"
      subtitle="Đơn vị VND. Gõ 25.500.000.000 hoặc 25500000000 đều được."
      submitLabel="Lưu"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Giá trị hợp đồng" hint="Để trống nếu chưa ký hợp đồng.">
        <input inputMode="decimal" value={form.contract} onChange={(event) => set('contract')(event.target.value)} />
      </Field>
      <Field label="Ngân sách được duyệt">
        <input inputMode="decimal" value={form.budget} onChange={(event) => set('budget')(event.target.value)} />
      </Field>
      <Field label="Chi phí đã cam kết" hint="Đã ký, đã đặt hàng nhưng chưa phát sinh.">
        <input inputMode="decimal" value={form.committed} onChange={(event) => set('committed')(event.target.value)} />
      </Field>
      <Field
        label="Chi phí dự kiến — ghi đè"
        hint="Chỉ điền khi muốn thay con số từ công thức. Để trống để dùng công thức."
      >
        <input inputMode="decimal" value={form.override} onChange={(event) => set('override')(event.target.value)} />
      </Field>
    </Dialog>
  );
}

function ItemCostDialog({
  item,
  onClose,
  onSave,
}: {
  item?: WorkItemCost;
  onClose: () => void;
  onSave: (estimatedCost: number | null) => Promise<void>;
}) {
  const [estimated, setEstimated] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!item) return;
    setEstimated(toVndInput(item.estimatedCost));
    setError(undefined);
    setSubmitting(false);
  }, [item]);

  const submit = async () => {
    const estimatedValue = readMoney(estimated, 'Chi phí dự toán', true);
    if (estimatedValue.error) {
      setError(estimatedValue.error);
      return;
    }
    setSubmitting(true);
    try {
      await onSave(estimatedValue.value ?? null);
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không lưu được chi phí.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(item)}
      title={item ? `Dự toán ${item.code}` : 'Dự toán'}
      subtitle={item?.title}
      submitLabel="Lưu"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Chi phí dự toán" hint="Chỉ tính vào dự kiến khi công việc chưa đóng.">
        <input inputMode="decimal" value={estimated} onChange={(event) => setEstimated(event.target.value)} />
      </Field>
      <p className={styles.muted}>
        Chi phí thực tế hiện tại: {formatVnd(item?.actualCost ?? 0)} — ghi thêm bằng nút “Ghi chi
        phí”.
      </p>
    </Dialog>
  );
}

/**
 * Ghi một dòng sổ chi phí thực tế.
 *
 * Được nhập số âm để điều chỉnh khoản ghi sai; server chặn khi tổng của công
 * việc sẽ thành âm và báo lỗi ngay trong hộp thoại.
 */
function CostEntryDialog({
  item,
  onClose,
  onSave,
}: {
  item?: WorkItemCost;
  onClose: () => void;
  onSave: (amount: number, note: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!item) return;
    setAmount('');
    setNote('');
    setError(undefined);
    setSubmitting(false);
  }, [item]);

  const submit = async () => {
    const parsed = parseVndInput(amount);
    if (parsed === undefined || parsed === null) {
      setError('Số tiền: không đọc được số.');
      return;
    }
    if (parsed === 0) {
      setError('Số tiền phải khác 0.');
      return;
    }
    if (!note.trim()) {
      setError('Hãy ghi lý do cho khoản chi này.');
      return;
    }
    if ((item?.actualCost ?? 0) + parsed < 0) {
      setError('Điều chỉnh này làm chi phí thực tế của công việc thành số âm.');
      return;
    }
    setSubmitting(true);
    try {
      await onSave(parsed, note.trim());
      onClose();
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Không ghi được chi phí.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(item)}
      title={item ? `Ghi chi phí ${item.code}` : 'Ghi chi phí'}
      subtitle={item ? `${item.title} · thực tế hiện tại ${formatVnd(item.actualCost)}` : undefined}
      submitLabel="Ghi vào sổ"
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Số tiền (VND)" hint="Gõ số âm, ví dụ -1.500.000, để điều chỉnh khoản ghi sai.">
        <input
          inputMode="decimal"
          value={amount}
          placeholder="Ví dụ 12.500.000"
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>
      <Field label="Lý do" hint="Số hoá đơn, nội dung chi, hoặc lý do điều chỉnh.">
        <textarea
          rows={3}
          maxLength={MAX_COST_NOTE_LENGTH}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}
