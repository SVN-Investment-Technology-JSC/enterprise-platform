'use client';

import {
  PRICING_STATUS_LABELS,
  type PriceListDetail,
  type PriceListItem,
  type PriceListSummary,
  type PricingStatus,
} from '@enterprise-platform/contracts-crm';
import { Popconfirm, SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ClipboardPaste, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CrmDialog, Field, StatusPill } from '../components/crm-ui';
import {
  addPriceListItem,
  createPriceList,
  deletePriceList,
  deletePriceListItem,
  errorMessage,
  getPriceList,
  listPriceLists,
  updatePriceList,
  updatePriceListItem,
  upsertPriceListItems,
} from '../crm-api';
import { groupOptions, labelOptions, useCrm } from '../crm-context';
import styles from '../sales.module.scss';
import { formatMoney, formatPercent, parseNumber, parsePastedItems, priceListScopeLabel, validityLabel } from './pricing.model';

const KIND_OPTIONS = [
  { value: 'group', label: 'Theo nhóm khách hàng' },
  { value: 'standard', label: 'Bảng giá chuẩn (mọi khách)' },
];

/**
 * Bảng giá (PRC-01): danh sách bảng, hiệu lực, nhóm khách áp dụng; dòng giá
 * theo mặt hàng và đơn vị. Chỉ quản trị bán hàng thấy trang này; server kiểm
 * `crm.manage` cho mọi thao tác ghi.
 *
 * Danh mục Kho chưa có API nội bộ (T1-24) nên mặt hàng nhập bằng id, mã, tên,
 * hoặc dán nhiều dòng từ bảng tính.
 */
export function PriceListsPage() {
  const [lists, setLists] = useState<PriceListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState<PriceListSummary | 'new' | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    listPriceLists()
      .then((next) => {
        setLists(next);
        setError(undefined);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được bảng giá.')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(reload, [reload]);

  const columns = useMemo<ColumnsType<PriceListSummary>>(
    () => [
      { title: 'Mã', dataIndex: 'code', width: 130, render: (value: string) => <span className={styles.mono}>{value}</span> },
      { title: 'Tên bảng giá', dataIndex: 'name' },
      { title: 'Áp dụng cho', key: 'scope', render: (_: unknown, row) => priceListScopeLabel(row) },
      { title: 'Hiệu lực', key: 'validity', width: 200, render: (_: unknown, row) => validityLabel(row.validFrom, row.validTo) },
      {
        title: 'Trạng thái',
        dataIndex: 'status',
        width: 140,
        render: (value: PricingStatus) => (
          <StatusPill tone={value === 'ACTIVE' ? 'success' : 'neutral'}>{PRICING_STATUS_LABELS[value]}</StatusPill>
        ),
      },
      { title: 'Số dòng', dataIndex: 'itemCount', width: 90, align: 'right' },
      {
        title: '',
        key: 'actions',
        width: 120,
        render: (_: unknown, row) => (
          <span className={styles.rowActions} onClick={(event) => event.stopPropagation()}>
            <button type="button" className={styles.rowAction} onClick={() => setEditing(row)}>
              Sửa
            </button>
            <Popconfirm
              title="Xoá bảng giá?"
              description="Mọi dòng giá của bảng cũng bị xoá. Không hoàn tác được."
              okText="Xoá"
              cancelText="Huỷ"
              okType="danger"
              onConfirm={async () => {
                try {
                  await deletePriceList(row.id);
                  toast.success('Đã xoá bảng giá.');
                  if (selectedId === row.id) setSelectedId(undefined);
                  reload();
                } catch (cause) {
                  toast.error(errorMessage(cause, 'Không xoá được bảng giá.'));
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
    [reload, selectedId],
  );

  return (
    <div className={styles.page}>
      <section className={styles.tableCard} aria-label="Bảng giá">
        <div className={styles.toolbar}>
          <h2 className={styles.title}>Bảng giá</h2>
          <button type="button" className={styles.buttonPrimary} onClick={() => setEditing('new')}>
            <Plus size={14} /> Thêm bảng giá
          </button>
        </div>
        <p className={styles.muted}>
          Giá áp theo thứ tự: giá hợp đồng, bảng giá của nhóm khách, bảng giá chuẩn. Hai bảng đang áp dụng cho cùng một
          nhóm (hoặc hai bảng chuẩn) không được trùng thời gian hiệu lực.
        </p>
        {error ? <p className={styles.alert}>{error}</p> : null}
        <Table<PriceListSummary>
          size="small"
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={lists}
          pagination={false}
          rowClassName={(row) => (row.id === selectedId ? 'ant-table-row-selected' : '')}
          onRow={(row) => ({ onClick: () => setSelectedId(row.id), style: { cursor: 'pointer' } })}
          locale={{ emptyText: 'Chưa có bảng giá nào.' }}
        />
      </section>
      {selectedId ? <PriceListItems key={selectedId} priceListId={selectedId} onChanged={reload} /> : null}
      {editing ? (
        <PriceListDialog
          list={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setSelectedId(saved.id);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function PriceListDialog({
  list,
  onClose,
  onSaved,
}: {
  list?: PriceListSummary;
  onClose: () => void;
  onSaved: (saved: PriceListDetail) => void;
}) {
  const { groups } = useCrm();
  const [code, setCode] = useState(list?.code ?? '');
  const [name, setName] = useState(list?.name ?? '');
  const [kind, setKind] = useState(list?.isStandard ? 'standard' : 'group');
  const [validFrom, setValidFrom] = useState(list?.validFrom ?? '');
  const [validTo, setValidTo] = useState(list?.validTo ?? '');
  const [status, setStatus] = useState<string>(list?.status ?? 'ACTIVE');
  const [note, setNote] = useState(list?.note ?? '');
  const [groupIds, setGroupIds] = useState<string[]>(list?.customerGroups.map((group) => group.id) ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const isStandard = kind === 'standard';
  const remaining = groupOptions(groups).filter((option) => !groupIds.includes(option.value));

  async function submit() {
    if (!code.trim() || !name.trim() || !validFrom) return setError('Vui lòng nhập mã, tên và ngày bắt đầu hiệu lực.');
    setSubmitting(true);
    setError(undefined);
    const body = {
      code: code.trim(),
      name: name.trim(),
      isStandard,
      validFrom,
      validTo: validTo || null,
      status: status as PricingStatus,
      note: note.trim() || null,
      customerGroupIds: isStandard ? [] : groupIds,
    };
    try {
      const saved = list ? await updatePriceList(list.id, body) : await createPriceList(body);
      toast.success('Đã lưu bảng giá.');
      onSaved(saved);
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được bảng giá.'));
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog
      open
      wide
      title={list ? 'Sửa bảng giá' : 'Thêm bảng giá'}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Mã bảng giá" required hint="Chữ không dấu, số, dấu chấm, gạch ngang">
          <input className={styles.input} value={code} maxLength={50} autoFocus onChange={(event) => setCode(event.target.value)} />
        </Field>
        <Field label="Tên bảng giá" required>
          <input className={styles.input} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Loại bảng giá" required>
          <SearchableSelect options={KIND_OPTIONS} value={kind} onChange={setKind} />
        </Field>
        <Field label="Trạng thái" required>
          <SearchableSelect
            options={labelOptions(PRICING_STATUS_LABELS)}
            value={status}
            onChange={(value) => setStatus(value || 'ACTIVE')}
          />
        </Field>
        <Field label="Hiệu lực từ ngày" required>
          <DatePickerInput value={validFrom || undefined} onChange={setValidFrom} height={38} aria-label="Hiệu lực từ ngày" />
        </Field>
        <Field label="Đến ngày" hint="Bỏ trống là không hết hạn">
          <DatePickerInput value={validTo || undefined} onChange={setValidTo} min={validFrom || undefined} height={38} aria-label="Hiệu lực đến ngày" />
        </Field>
        {isStandard ? null : (
          <Field label="Nhóm khách hàng áp dụng" wide hint="Một nhóm chỉ có một bảng giá đang áp dụng tại một thời điểm">
            <div className={styles.toolbar}>
              {groupIds.map((id) => {
                const group = groups.find((entry) => entry.id === id);
                return (
                  <span key={id} className={`${styles.pill} ${styles.pill_info}`}>
                    {group?.name ?? id}
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`Bỏ nhóm ${group?.name ?? ''}`}
                      onClick={() => setGroupIds((current) => current.filter((entry) => entry !== id))}
                    >
                      <X size={12} />
                    </button>
                  </span>
                );
              })}
              <SearchableSelect
                className={styles.filter}
                options={remaining}
                value=""
                placeholder="Thêm nhóm khách"
                emptyText="Không còn nhóm nào"
                onChange={(value) => value && setGroupIds((current) => [...current, value])}
              />
            </div>
          </Field>
        )}
        <Field label="Ghi chú" wide>
          <textarea className={styles.textarea} rows={2} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}

function PriceListItems({ priceListId, onChanged }: { priceListId: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<PriceListDetail>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<PriceListItem | 'new' | null>(null);
  const [pasting, setPasting] = useState(false);

  useEffect(() => {
    getPriceList(priceListId)
      .then(setDetail)
      .catch((cause) => setError(errorMessage(cause, 'Không tải được dòng giá.')));
  }, [priceListId]);

  const applyChange = useCallback(
    (next: PriceListDetail) => {
      setDetail(next);
      onChanged();
    },
    [onChanged],
  );

  const columns = useMemo<ColumnsType<PriceListItem>>(
    () => [
      { title: 'Mã mặt hàng', dataIndex: 'materialCode', width: 150, render: (value: string) => <span className={styles.mono}>{value}</span> },
      { title: 'Tên mặt hàng', dataIndex: 'materialName' },
      { title: 'Đơn vị tính', dataIndex: 'unit', width: 110 },
      { title: 'Đơn giá (VND)', dataIndex: 'price', width: 150, align: 'right', render: (value: number) => formatMoney(value) },
      { title: 'Thuế suất', dataIndex: 'vatRate', width: 100, align: 'right', render: (value: number) => formatPercent(value) },
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
              title="Xoá dòng giá?"
              okText="Xoá"
              cancelText="Huỷ"
              okType="danger"
              onConfirm={async () => {
                try {
                  applyChange(await deletePriceListItem(priceListId, row.id));
                  toast.success('Đã xoá dòng giá.');
                } catch (cause) {
                  toast.error(errorMessage(cause, 'Không xoá được dòng giá.'));
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
    [applyChange, priceListId],
  );

  return (
    <section className={styles.tableCard} aria-label="Dòng giá">
      <div className={styles.toolbar}>
        <h2 className={styles.title}>{detail ? `Dòng giá: ${detail.code} · ${detail.name}` : 'Dòng giá'}</h2>
        <button type="button" className={styles.buttonGhost} onClick={() => setPasting(true)}>
          <ClipboardPaste size={14} /> Dán từ bảng tính
        </button>
        <button type="button" className={styles.buttonPrimary} onClick={() => setEditing('new')}>
          <Plus size={14} /> Thêm dòng giá
        </button>
      </div>
      {error ? <p className={styles.alert}>{error}</p> : null}
      <Table<PriceListItem>
        size="small"
        rowKey="id"
        loading={!detail && !error}
        columns={columns}
        dataSource={[...(detail?.items ?? [])]}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        locale={{ emptyText: 'Bảng giá chưa có dòng nào.' }}
      />
      {editing ? (
        <ItemDialog
          priceListId={priceListId}
          item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setEditing(null);
            applyChange(next);
          }}
        />
      ) : null}
      {pasting ? (
        <PasteDialog
          priceListId={priceListId}
          onClose={() => setPasting(false)}
          onSaved={(next) => {
            setPasting(false);
            applyChange(next);
          }}
        />
      ) : null}
    </section>
  );
}

function ItemDialog({
  priceListId,
  item,
  onClose,
  onSaved,
}: {
  priceListId: string;
  item?: PriceListItem;
  onClose: () => void;
  onSaved: (detail: PriceListDetail) => void;
}) {
  const [materialId, setMaterialId] = useState(item?.materialId ?? '');
  const [materialCode, setMaterialCode] = useState(item?.materialCode ?? '');
  const [materialName, setMaterialName] = useState(item?.materialName ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [price, setPrice] = useState(item ? String(item.price) : '');
  const [vatRate, setVatRate] = useState(item ? String(item.vatRate) : '10');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    const parsedPrice = parseNumber(price);
    const parsedVat = parseNumber(vatRate);
    if (!materialId.trim() || !materialCode.trim() || !materialName.trim() || !unit.trim()) {
      return setError('Vui lòng nhập id, mã, tên mặt hàng và đơn vị tính.');
    }
    if (parsedPrice === undefined || parsedVat === undefined) return setError('Đơn giá và thuế suất phải là số.');
    setSubmitting(true);
    setError(undefined);
    const body = {
      materialId: materialId.trim(),
      materialCode: materialCode.trim(),
      materialName: materialName.trim(),
      unit: unit.trim(),
      price: parsedPrice,
      vatRate: parsedVat,
    };
    try {
      onSaved(item ? await updatePriceListItem(priceListId, item.id, body) : await addPriceListItem(priceListId, body));
      toast.success('Đã lưu dòng giá.');
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được dòng giá.'));
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog
      open
      title={item ? 'Sửa dòng giá' : 'Thêm dòng giá'}
      subtitle="Id, mã, tên lấy từ danh mục mặt hàng của Kho."
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <div className={styles.fieldGrid}>
        <Field label="Id mặt hàng" required wide>
          <input className={`${styles.input} ${styles.mono}`} value={materialId} maxLength={36} autoFocus onChange={(event) => setMaterialId(event.target.value)} />
        </Field>
        <Field label="Mã mặt hàng" required>
          <input className={styles.input} value={materialCode} maxLength={100} onChange={(event) => setMaterialCode(event.target.value)} />
        </Field>
        <Field label="Tên mặt hàng" required>
          <input className={styles.input} value={materialName} maxLength={300} onChange={(event) => setMaterialName(event.target.value)} />
        </Field>
        <Field label="Đơn vị tính" required>
          <input className={styles.input} value={unit} maxLength={50} onChange={(event) => setUnit(event.target.value)} />
        </Field>
        <Field label="Đơn giá (VND)" required>
          <input className={styles.input} inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
        </Field>
        <Field label="Thuế suất (%)" required hint="0, 5, 8 hoặc 10">
          <input className={styles.input} inputMode="decimal" value={vatRate} onChange={(event) => setVatRate(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}

function PasteDialog({
  priceListId,
  onClose,
  onSaved,
}: {
  priceListId: string;
  onClose: () => void;
  onSaved: (detail: PriceListDetail) => void;
}) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const parsed = useMemo(() => parsePastedItems(text), [text]);

  async function submit() {
    if (parsed.errors.length) return setError(parsed.errors.slice(0, 5).join(' '));
    if (!parsed.items.length) return setError('Chưa có dòng giá nào để nhập.');
    setSubmitting(true);
    setError(undefined);
    try {
      onSaved(await upsertPriceListItems(priceListId, { items: parsed.items }));
      toast.success(`Đã nhập ${parsed.items.length} dòng giá.`);
    } catch (cause) {
      setError(errorMessage(cause, 'Không nhập được dòng giá.'));
      setSubmitting(false);
    }
  }

  return (
    <CrmDialog
      open
      wide
      title="Dán dòng giá từ bảng tính"
      subtitle="Mỗi dòng: Id mặt hàng, Mã, Tên, Đơn vị tính, Đơn giá, Thuế suất (không bắt buộc, mặc định 10). Dòng đã có cùng mặt hàng và đơn vị sẽ được cập nhật giá."
      submitLabel={parsed.items.length ? `Nhập ${parsed.items.length} dòng` : 'Nhập'}
      submitting={submitting}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      <Field label="Dữ liệu dán" wide hint={parsed.errors.length ? parsed.errors[0] : `${parsed.items.length} dòng hợp lệ`}>
        <textarea
          className={`${styles.textarea} ${styles.mono}`}
          rows={10}
          value={text}
          autoFocus
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
    </CrmDialog>
  );
}
