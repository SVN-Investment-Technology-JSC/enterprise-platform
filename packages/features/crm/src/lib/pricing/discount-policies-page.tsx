'use client';

import {
  DISCOUNT_CRITERION_LABELS,
  DISCOUNT_STACKING_LABELS,
  PRICING_STATUS_LABELS,
  type CustomerSummary,
  type DiscountCriterion,
  type DiscountPolicy,
  type DiscountPolicyRule,
  type DiscountStacking,
  type PricingStatus,
} from '@enterprise-platform/contracts-crm';
import { Popconfirm, SearchableSelect, toast, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CrmDialog, Field, StatusPill } from '../components/crm-ui';
import {
  createDiscountPolicy,
  deleteDiscountPolicy,
  errorMessage,
  listCustomers,
  listDiscountPolicies,
  loadPricingSettings,
  savePricingSettings,
  updateDiscountPolicy,
} from '../crm-api';
import { groupOptions, labelOptions, useCrm } from '../crm-context';
import styles from '../sales.module.scss';
import local from './pricing.module.scss';
import { parseNumber, policyConditionLabel, policyPercentLabel, validityLabel } from './pricing.model';

/**
 * Chính sách chiết khấu (PRC-02, PRC-03) và trần tổng chiết khấu. Chỉ quản trị
 * bán hàng thấy trang này; server kiểm `crm.manage` cho mọi thao tác ghi.
 */
export function DiscountPoliciesPage() {
  const [policies, setPolicies] = useState<DiscountPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<DiscountPolicy | 'new' | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    listDiscountPolicies()
      .then((next) => {
        setPolicies(next);
        setError(undefined);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được chính sách chiết khấu.')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(reload, [reload]);

  const columns = useMemo<ColumnsType<DiscountPolicy>>(
    () => [
      { title: 'Mã', dataIndex: 'code', width: 120, render: (value: string) => <span className={styles.mono}>{value}</span> },
      { title: 'Tên chính sách', dataIndex: 'name' },
      { title: 'Ưu tiên', dataIndex: 'priority', width: 80, align: 'right' },
      {
        title: 'Kết hợp',
        key: 'stacking',
        width: 150,
        render: (_: unknown, row) => (row.exclusive ? 'Độc quyền' : DISCOUNT_STACKING_LABELS[row.stacking]),
      },
      { title: 'Chiết khấu', key: 'percent', render: (_: unknown, row) => policyPercentLabel(row) },
      { title: 'Điều kiện', key: 'conditions', ellipsis: true, render: (_: unknown, row) => policyConditionLabel(row) },
      { title: 'Hiệu lực', key: 'validity', width: 190, render: (_: unknown, row) => validityLabel(row.validFrom, row.validTo) },
      {
        title: 'Trạng thái',
        dataIndex: 'status',
        width: 130,
        render: (value: PricingStatus) => (
          <StatusPill tone={value === 'ACTIVE' ? 'success' : 'neutral'}>{PRICING_STATUS_LABELS[value]}</StatusPill>
        ),
      },
      {
        title: '',
        key: 'actions',
        width: 120,
        render: (_: unknown, row) => (
          <span className={styles.rowActions}>
            <button type="button" className={styles.rowAction} onClick={() => setEditing(row)}>
              Sửa
            </button>
            <Popconfirm
              title="Xoá chính sách?"
              description="Báo giá mới sẽ không áp chính sách này nữa."
              okText="Xoá"
              cancelText="Huỷ"
              okType="danger"
              onConfirm={async () => {
                try {
                  await deleteDiscountPolicy(row.id);
                  toast.success('Đã xoá chính sách.');
                  reload();
                } catch (cause) {
                  toast.error(errorMessage(cause, 'Không xoá được chính sách.'));
                }
              }}
            >
              <button type="button" className={styles.rowActionDanger}>
                Xoá
              </button>
            </Popconfirm>
          </span>
        ),
      },
    ],
    [reload],
  );

  return (
    <div className={styles.page}>
      <DiscountCap />
      <section className={styles.tableCard} aria-label="Chính sách chiết khấu">
        <div className={styles.toolbar}>
          <h2 className={styles.title}>Chính sách chiết khấu</h2>
          <button type="button" className={styles.buttonPrimary} onClick={() => setEditing('new')}>
            <Plus size={14} /> Thêm chính sách
          </button>
        </div>
        <p className={styles.muted}>
          Chính sách độc quyền có ưu tiên cao nhất (số nhỏ nhất) loại mọi chính sách khác. Không có độc quyền thì cộng
          các chính sách "Cộng dồn" với mức cao nhất trong các chính sách "Lấy mức cao nhất", tính trên giá gốc rồi cắt
          theo trần.
        </p>
        {error ? <p className={styles.alert}>{error}</p> : null}
        <Table<DiscountPolicy>
          size="small"
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={policies}
          pagination={false}
          locale={{ emptyText: 'Chưa có chính sách nào.' }}
        />
      </section>
      {editing ? (
        <PolicyDialog
          policy={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function DiscountCap() {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadPricingSettings()
      .then((settings) => setValue(String(settings.discountCapPercent)))
      .catch((cause) => setError(errorMessage(cause, 'Không tải được trần chiết khấu.')));
  }, []);

  async function save() {
    const percent = parseNumber(value);
    if (percent === undefined) return setError('Trần chiết khấu phải là số.');
    setSaving(true);
    setError(undefined);
    try {
      const saved = await savePricingSettings({ discountCapPercent: percent });
      setValue(String(saved.discountCapPercent));
      toast.success('Đã lưu trần chiết khấu.');
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được trần chiết khấu.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="Trần chiết khấu">
      <h2 className={styles.title}>Trần tổng chiết khấu</h2>
      <form
        className={local.capForm}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Phần trăm tối đa trên giá gốc" hint="Tổng chiết khấu theo chính sách vượt mức này thì bị cắt">
          <input className={`${styles.input} ${local.capInput}`} inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} />
        </Field>
        <button type="submit" className={styles.buttonPrimary} disabled={saving}>
          {saving ? 'Đang lưu…' : 'Lưu trần'}
        </button>
      </form>
      {error ? <p className={styles.alert}>{error}</p> : null}
    </section>
  );
}

/** Tiêu chí đang sửa: giữ chuỗi người gõ, đổi sang số khi lưu. */
interface RuleDraft {
  readonly key: number;
  criterion: DiscountCriterion | '';
  minQty: string;
  maxQty: string;
  percent: string;
  refId: string;
  refText: string;
  fromDate: string;
  toDate: string;
}

let draftKey = 0;

function toDraft(rule?: DiscountPolicyRule): RuleDraft {
  draftKey += 1;
  const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value));
  return {
    key: draftKey,
    criterion: rule?.criterion ?? '',
    minQty: text(rule?.minQty),
    maxQty: text(rule?.maxQty),
    percent: text(rule?.percent),
    refId: rule?.refId ?? '',
    refText: rule?.refText ?? '',
    fromDate: rule?.fromDate ?? '',
    toDate: rule?.toDate ?? '',
  };
}

function fromDraft(draft: RuleDraft): DiscountPolicyRule {
  const number = (value: string) => (value.trim() ? (parseNumber(value) ?? Number.NaN) : null);
  return {
    criterion: draft.criterion as DiscountCriterion,
    minQty: number(draft.minQty),
    maxQty: number(draft.maxQty),
    percent: number(draft.percent),
    refId: draft.refId || null,
    refText: draft.refText.trim() || null,
    fromDate: draft.fromDate || null,
    toDate: draft.toDate || null,
  };
}

function PolicyDialog({ policy, onClose, onSaved }: { policy?: DiscountPolicy; onClose: () => void; onSaved: () => void }) {
  const { groups } = useCrm();
  const [code, setCode] = useState(policy?.code ?? '');
  const [name, setName] = useState(policy?.name ?? '');
  const [priority, setPriority] = useState(String(policy?.priority ?? 100));
  const [stacking, setStacking] = useState<string>(policy?.stacking ?? 'STACK');
  const [exclusive, setExclusive] = useState(policy?.exclusive ?? false);
  const [percent, setPercent] = useState(policy?.percent === null || policy?.percent === undefined ? '' : String(policy.percent));
  const [validFrom, setValidFrom] = useState(policy?.validFrom ?? '');
  const [validTo, setValidTo] = useState(policy?.validTo ?? '');
  const [status, setStatus] = useState<string>(policy?.status ?? 'ACTIVE');
  const [appliesToAll, setAppliesToAll] = useState(policy?.appliesToAllCustomers ?? true);
  const [note, setNote] = useState(policy?.note ?? '');
  const [rules, setRules] = useState<RuleDraft[]>(() => (policy?.rules ?? []).map(toDraft));
  const [customers, setCustomers] = useState<readonly CustomerSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const hasTiers = rules.some((rule) => rule.criterion === 'QUANTITY');
  const needsCustomers = rules.some((rule) => rule.criterion === 'CUSTOMER');

  useEffect(() => {
    if (!needsCustomers || customers.length) return;
    listCustomers({ limit: 100 })
      .then((page) => setCustomers(page.items))
      .catch(() => undefined);
  }, [needsCustomers, customers.length]);

  const criterionOptions = useMemo(
    () =>
      labelOptions(DISCOUNT_CRITERION_LABELS).map((option) => ({
        ...option,
        disabled: appliesToAll && (option.value === 'CUSTOMER' || option.value === 'CUSTOMER_GROUP'),
      })),
    [appliesToAll],
  );

  const update = (key: number, patch: Partial<RuleDraft>) =>
    setRules((current) => current.map((rule) => (rule.key === key ? { ...rule, ...patch } : rule)));

  async function submit() {
    if (!code.trim() || !name.trim() || !validFrom) return setError('Vui lòng nhập mã, tên và ngày bắt đầu hiệu lực.');
    if (rules.some((rule) => !rule.criterion)) return setError('Vui lòng chọn loại cho mọi tiêu chí.');
    const parsedPriority = Number(priority);
    setSubmitting(true);
    setError(undefined);
    const body = {
      code: code.trim(),
      name: name.trim(),
      priority: Number.isInteger(parsedPriority) ? parsedPriority : Number.NaN,
      stacking: stacking as DiscountStacking,
      exclusive,
      percent: hasTiers || !percent.trim() ? null : (parseNumber(percent) ?? Number.NaN),
      validFrom,
      validTo: validTo || null,
      status: status as PricingStatus,
      appliesToAllCustomers: appliesToAll,
      note: note.trim() || null,
      rules: rules.map(fromDraft),
    };
    try {
      if (policy) await updateDiscountPolicy(policy.id, body);
      else await createDiscountPolicy(body);
      toast.success('Đã lưu chính sách.');
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được chính sách.'));
      setSubmitting(false);
    }
  }

  const customerOptions: SearchableSelectOption[] = customers.map((customer) => ({
    value: customer.id,
    label: customer.name,
    badge: customer.code,
  }));

  return (
    <CrmDialog
      open
      wide
      title={policy ? 'Sửa chính sách chiết khấu' : 'Thêm chính sách chiết khấu'}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Mã chính sách" required>
          <input className={styles.input} value={code} maxLength={50} autoFocus onChange={(event) => setCode(event.target.value)} />
        </Field>
        <Field label="Tên chính sách" required>
          <input className={styles.input} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Kiểu kết hợp" required>
          <SearchableSelect
            options={labelOptions(DISCOUNT_STACKING_LABELS)}
            value={stacking}
            disabled={exclusive}
            onChange={(value) => setStacking(value || 'STACK')}
          />
        </Field>
        <Field label="Độ ưu tiên" required hint="Số nhỏ là ưu tiên cao (1 đến 1000)">
          <input className={styles.input} inputMode="numeric" value={priority} maxLength={4} onChange={(event) => setPriority(event.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <Field label="Hiệu lực từ ngày" required>
          <DatePickerInput value={validFrom || undefined} onChange={setValidFrom} height={38} aria-label="Hiệu lực từ ngày" />
        </Field>
        <Field label="Đến ngày" hint="Bỏ trống là không hết hạn">
          <DatePickerInput value={validTo || undefined} onChange={setValidTo} min={validFrom || undefined} height={38} aria-label="Hiệu lực đến ngày" />
        </Field>
        <Field label="Trạng thái" required>
          <SearchableSelect options={labelOptions(PRICING_STATUS_LABELS)} value={status} onChange={(value) => setStatus(value || 'ACTIVE')} />
        </Field>
        <Field label="Phần trăm chiết khấu" hint={hasTiers ? 'Lấy theo từng bậc số lượng bên dưới' : 'Ví dụ 3 hoặc 2,5'}>
          <input className={styles.input} inputMode="decimal" value={hasTiers ? '' : percent} disabled={hasTiers} onChange={(event) => setPercent(event.target.value)} />
        </Field>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={exclusive} onChange={(event) => setExclusive(event.target.checked)} />
          Độc quyền: khi áp thì loại các chính sách khác
        </label>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={appliesToAll}
            onChange={(event) => {
              setAppliesToAll(event.target.checked);
              if (event.target.checked) {
                setRules((current) => current.filter((rule) => rule.criterion !== 'CUSTOMER' && rule.criterion !== 'CUSTOMER_GROUP'));
              }
            }}
          />
          Áp cho mọi khách hàng
        </label>
      </div>

      <h3 className={styles.sectionTitle}>Tiêu chí</h3>
      <p className={styles.muted}>
        Các loại tiêu chí khác nhau kết hợp với nhau (và); nhiều dòng cùng loại là một trong các giá trị (hoặc). Bậc số
        lượng tính theo số lượng của từng dòng báo giá, các bậc không được chồng nhau.
      </p>
      <div className={local.rules}>
        {rules.map((rule) => (
          <div key={rule.key} className={local.ruleRow}>
            <SearchableSelect
              options={criterionOptions}
              value={rule.criterion}
              placeholder="Loại tiêu chí"
              onChange={(value) => update(rule.key, { ...toDraft(), key: rule.key, criterion: value as DiscountCriterion })}
            />
            <RuleFields
              rule={rule}
              groupOptions={groupOptions(groups)}
              customerOptions={customerOptions}
              onChange={(patch) => update(rule.key, patch)}
            />
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Bỏ tiêu chí"
              onClick={() => setRules((current) => current.filter((entry) => entry.key !== rule.key))}
            >
              <X size={16} />
            </button>
          </div>
        ))}
        <span className={styles.toolbar}>
          <button type="button" className={styles.buttonGhost} onClick={() => setRules((current) => [...current, toDraft()])}>
            <Plus size={14} /> Thêm tiêu chí
          </button>
          <button
            type="button"
            className={styles.buttonGhost}
            onClick={() => setRules((current) => [...current, { ...toDraft(), criterion: 'QUANTITY' }])}
          >
            <Plus size={14} /> Thêm bậc số lượng
          </button>
        </span>
      </div>
      <Field label="Ghi chú" wide>
        <textarea className={styles.textarea} rows={2} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
      </Field>
    </CrmDialog>
  );
}

function RuleFields({
  rule,
  groupOptions: groups,
  customerOptions,
  onChange,
}: {
  rule: RuleDraft;
  groupOptions: SearchableSelectOption[];
  customerOptions: SearchableSelectOption[];
  onChange: (patch: Partial<RuleDraft>) => void;
}) {
  const text = (label: string, value: string, key: keyof RuleDraft, inputMode: 'decimal' | 'text' = 'decimal') => (
    <label className={local.inlineField}>
      {label}
      <input className={styles.input} inputMode={inputMode} value={value} onChange={(event) => onChange({ [key]: event.target.value })} />
    </label>
  );
  // Giữ tên đã chọn trong tuỳ chọn để hiện đúng khi danh sách tải chưa xong.
  const withCurrent = (options: SearchableSelectOption[]) =>
    rule.refId && !options.some((option) => option.value === rule.refId)
      ? [{ value: rule.refId, label: rule.refText || rule.refId }, ...options]
      : options;

  switch (rule.criterion) {
    case 'QUANTITY':
      return (
        <div className={local.ruleFields}>
          {text('Từ số lượng', rule.minQty, 'minQty')}
          {text('Đến số lượng (bỏ trống: không giới hạn)', rule.maxQty, 'maxQty')}
          {text('Chiết khấu (%)', rule.percent, 'percent')}
        </div>
      );
    case 'PERIOD':
      return (
        <div className={local.ruleFields}>
          <label className={local.inlineField}>
            Từ ngày
            <DatePickerInput value={rule.fromDate || undefined} onChange={(value) => onChange({ fromDate: value })} height={38} aria-label="Từ ngày" />
          </label>
          <label className={local.inlineField}>
            Đến ngày
            <DatePickerInput value={rule.toDate || undefined} onChange={(value) => onChange({ toDate: value })} height={38} aria-label="Đến ngày" />
          </label>
        </div>
      );
    case 'CUSTOMER_GROUP':
    case 'CUSTOMER': {
      const options = withCurrent(rule.criterion === 'CUSTOMER' ? customerOptions : groups);
      return (
        <SearchableSelect
          options={options}
          value={rule.refId}
          placeholder={rule.criterion === 'CUSTOMER' ? 'Chọn khách hàng' : 'Chọn nhóm khách'}
          onChange={(value) => onChange({ refId: value, refText: options.find((option) => option.value === value)?.label ?? '' })}
        />
      );
    }
    case 'MATERIAL':
      return (
        <div className={local.ruleFields}>
          {text('Id mặt hàng', rule.refId, 'refId', 'text')}
          {text('Mã hoặc tên để hiển thị', rule.refText, 'refText', 'text')}
        </div>
      );
    case 'MATERIAL_CATEGORY':
      return <div className={local.ruleFields}>{text('Nhóm hàng (loại hàng ở Kho)', rule.refText, 'refText', 'text')}</div>;
    default:
      return <span className={styles.muted}>Chọn loại tiêu chí.</span>;
  }
}
