'use client';

import {
  CRM_LIST_PAGE_SIZE,
  PRICE_LIST_RATIO_DEFAULT,
  PRICE_MODE_LABELS,
  PRICING_STATUS_LABELS,
  type PriceListDetail,
  type PriceListItem,
  type PriceListSummary,
  type PriceMode,
  type PricingStatus,
  type SavePriceListRequest,
} from '@enterprise-platform/contracts-crm';
import { Popconfirm, SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ClipboardPaste, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CrmDialog, Field, StatusPill } from '../components/crm-ui';
import {
  clearManualPrice,
  clearPriceListVatRate,
  createPriceList,
  deletePriceList,
  deletePriceListItem,
  errorMessage,
  getPriceList,
  listPriceLists,
  updatePriceList,
  upsertPriceListItems,
  type CrmApiError,
} from '../crm-api';
import { labelOptions, useCrm } from '../crm-context';
import styles from '../sales.module.scss';
import { AddPriceItemsDialog, EditPriceItemDialog, ManualPriceDialog, VatRateDialog } from './price-list-item-dialogs';
import { usePriceListsChanged } from './price-list-sync-banner';
import local from './pricing.module.scss';
import {
  formatPercent,
  parsePastedItems,
  parseRatioPercent,
  priceListTypeLabel,
  priceText,
  sortPriceLists,
  validityLabel,
} from './pricing.model';

/** Lời nhắc khi chưa có bảng giá mặc định (nút "Thêm bảng giá" khoá). */
export const NO_DEFAULT_LIST_HINT = 'Chưa có bảng giá mặc định. Bấm "Đồng bộ" ở thông báo trên cùng để tạo từ danh mục Kho, rồi mới thêm bảng giá.';
/** Nhãn cạnh thuế suất của dòng nhập thuế suất tay (bảng theo tỷ lệ). */
export const VAT_MANUAL_TAG = 'Thuế suất tay';
/** Hỏi lại khi đổi tỷ lệ của bảng theo tỷ lệ. */
export const RATIO_CHANGE_CONFIRM = 'Giá theo tỷ lệ sẽ được tính lại; giá tay giữ nguyên.';

/**
 * Bảng giá (PRC-01). Bảng mặc định (một bảng) lấy mặt hàng, đơn vị, giá, thuế suất từ Kho qua "Đồng bộ", không sửa trong
 * CRM. Bảng mới luôn theo tỷ lệ của bảng mặc định, từng dòng nhập được giá tay và thuế suất tay. Bảng tự nhập cũ giữ thao tác như trước (thêm,
 * sửa, xoá dòng, dán từ bảng tính). Chỉ quản trị bán hàng có nút ghi; server kiểm `crm.manage` cho mọi thao tác ghi.
 */
export function PriceListsPage() {
  const { capabilities } = useCrm();
  const canManage = capabilities.isTenantAdmin || capabilities.canManage;
  const [lists, setLists] = useState<PriceListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState<PriceListSummary | 'new' | null>(null);
  /** Tăng sau khi đồng bộ Kho để dòng giá đang mở tải lại. */
  const [itemsVersion, setItemsVersion] = useState(0);

  const reload = useCallback(() => {
    setLoading(true);
    listPriceLists()
      .then((next) => {
        setLists(sortPriceLists(next));
        setError(undefined);
        setLoaded(true);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được bảng giá.')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(reload, [reload]);
  usePriceListsChanged(() => {
    reload();
    setItemsVersion((value) => value + 1);
  });

  const hasDefault = lists.some((list) => list.listType === 'DEFAULT');
  const addDisabled = loaded && !hasDefault;

  const columns = useMemo<ColumnsType<PriceListSummary>>(() => {
    const base: ColumnsType<PriceListSummary> = [
      { title: 'Mã', dataIndex: 'code', width: 130, render: (value: string) => <span className={styles.mono}>{value}</span> },
      { title: 'Tên bảng giá', dataIndex: 'name' },
      { title: 'Loại', key: 'type', width: 160, render: (_: unknown, row) => priceListTypeLabel(row) },
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
        title: 'Đang dùng',
        dataIndex: 'usageCount',
        width: 110,
        align: 'right',
        render: (value: number) => (value ? `${value} báo giá, đơn` : <span className={styles.muted}>Chưa dùng</span>),
      },
    ];
    if (!canManage) return base;
    return [
      ...base,
      {
        title: '',
        key: 'actions',
        width: 120,
        render: (_: unknown, row) =>
          row.listType === 'DEFAULT' ? null : (
            <span className={styles.rowActions} onClick={(event) => event.stopPropagation()}>
              <button type="button" className={styles.rowAction} aria-label={`Sửa bảng giá ${row.code}`} onClick={() => setEditing(row)}>
                Sửa
              </button>
              <Popconfirm
                placement="left"
                title="Xoá bảng giá?"
                description={
                  row.usageCount
                    ? 'Bảng giá đang được báo giá hoặc đơn bán dùng nên sẽ không xoá được; hãy chuyển "Ngừng áp dụng".'
                    : 'Mọi dòng giá của bảng cũng bị xoá. Không hoàn tác được.'
                }
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
                <button type="button" className={styles.rowActionDanger} aria-label={`Xoá bảng giá ${row.code}`}>
                  Xoá
                </button>
              </Popconfirm>
            </span>
          ),
      },
    ];
  }, [canManage, reload, selectedId]);

  return (
    <div className={styles.page}>
      <section className={styles.tableCard} aria-label="Bảng giá">
        <div className={styles.toolbar}>
          <h2 className={styles.title}>Bảng giá</h2>
          {canManage ? (
            <button
              type="button"
              className={styles.buttonPrimary}
              disabled={addDisabled}
              title={addDisabled ? NO_DEFAULT_LIST_HINT : undefined}
              aria-describedby={addDisabled ? 'price-list-add-hint' : undefined}
              onClick={() => setEditing('new')}
            >
              <Plus size={14} /> Thêm bảng giá
            </button>
          ) : null}
        </div>
        {canManage && addDisabled ? (
          <p id="price-list-add-hint" className={styles.warning} role="note">
            {NO_DEFAULT_LIST_HINT}
          </p>
        ) : null}
        <p className={styles.muted}>
          Giá gốc khi báo giá lấy theo thứ tự: giá hợp đồng, bảng giá người lập chọn ở báo giá hoặc đơn. Bảng giá mặc định
          lấy mặt hàng, đơn vị tính, giá bán, thuế suất từ Kho; bảng giá mới tính theo tỷ lệ của bảng mặc định, nhập được giá
          tay và thuế suất tay từng dòng.
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
      {selectedId ? (
        <PriceListItems key={`${selectedId}:${itemsVersion}`} priceListId={selectedId} canManage={canManage} onChanged={reload} />
      ) : null}
      {editing ? (
        <PriceListDialog
          list={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setSelectedId(saved.id);
            setItemsVersion((value) => value + 1);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

/** Mã lỗi trùng mã bảng giá (409): hiện tại ô mã. */
const CODE_EXISTS = 'PRICE_LIST_CODE_EXISTS';

type DialogField = 'code' | 'name' | 'ratio' | 'validFrom' | 'validTo';

/**
 * Tạo, sửa bảng giá. Tạo mới luôn là bảng theo tỷ lệ (cần có bảng mặc định); sửa tỷ lệ của bảng theo tỷ lệ thì hỏi lại
 * vì các dòng theo tỷ lệ được tính lại. Bảng tự nhập cũ không có ô tỷ lệ.
 */
export function PriceListDialog({
  list,
  onClose,
  onSaved,
}: {
  list?: PriceListSummary;
  onClose: () => void;
  onSaved: (saved: PriceListDetail) => void;
}) {
  const showRatio = !list || list.listType === 'DERIVED';
  const initialRatio = String(list?.ratioPercent ?? PRICE_LIST_RATIO_DEFAULT).replace('.', ',');
  const [code, setCode] = useState(list?.code ?? '');
  const [name, setName] = useState(list?.name ?? '');
  const [ratio, setRatio] = useState(initialRatio);
  const [validFrom, setValidFrom] = useState(list?.validFrom ?? '');
  const [validTo, setValidTo] = useState(list?.validTo ?? '');
  const [status, setStatus] = useState<string>(list?.status ?? 'ACTIVE');
  const [note, setNote] = useState(list?.note ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<DialogField, string>>>({});
  const [confirming, setConfirming] = useState<SavePriceListRequest | null>(null);

  function validate(): SavePriceListRequest | undefined {
    const errors: Partial<Record<DialogField, string>> = {};
    if (!code.trim()) errors.code = 'Vui lòng nhập mã bảng giá.';
    if (!name.trim()) errors.name = 'Vui lòng nhập tên bảng giá.';
    if (!validFrom) errors.validFrom = 'Vui lòng chọn ngày bắt đầu hiệu lực.';
    if (validFrom && validTo && validTo < validFrom) errors.validTo = 'Ngày kết thúc phải từ ngày bắt đầu trở đi.';
    let ratioPercent: number | undefined;
    if (showRatio) {
      const parsed = parseRatioPercent(ratio);
      if (parsed.ok) ratioPercent = parsed.value;
      else errors.ratio = parsed.error;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return undefined;
    return {
      code: code.trim(),
      name: name.trim(),
      ...(showRatio ? { ratioPercent } : {}),
      validFrom,
      validTo: validTo || null,
      status: status as PricingStatus,
      note: note.trim() || null,
    };
  }

  async function save(body: SavePriceListRequest) {
    setSubmitting(true);
    setError(undefined);
    try {
      const saved = list ? await updatePriceList(list.id, body) : await createPriceList(body);
      toast.success('Đã lưu bảng giá.');
      onSaved(saved);
    } catch (cause) {
      if ((cause as CrmApiError | undefined)?.code === CODE_EXISTS) {
        setFieldErrors((current) => ({ ...current, code: errorMessage(cause, 'Mã bảng giá đã có.') }));
      } else {
        setError(errorMessage(cause, 'Không lưu được bảng giá.'));
      }
      setSubmitting(false);
    }
  }

  function submit() {
    const body = validate();
    if (!body) return;
    const ratioChanged = list?.listType === 'DERIVED' && body.ratioPercent !== list.ratioPercent;
    if (ratioChanged) return setConfirming(body);
    void save(body);
  }

  return (
    <>
      <CrmDialog
        open
        wide
        title={list ? 'Sửa bảng giá' : 'Thêm bảng giá'}
        subtitle={list ? `Loại: ${priceListTypeLabel(list)}` : 'Bảng giá mới tính theo tỷ lệ của bảng giá mặc định; nhập giá tay từng dòng sau khi tạo.'}
        submitting={submitting}
        error={error}
        onClose={onClose}
        onSubmit={submit}
      >
        <div className={styles.fieldGrid}>
          <Field label="Mã bảng giá" required error={fieldErrors.code} hint="Chữ không dấu, số, dấu chấm, gạch ngang">
            <input
              className={styles.input}
              value={code}
              maxLength={50}
              autoFocus
              aria-invalid={fieldErrors.code ? true : undefined}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
          <Field label="Tên bảng giá" required error={fieldErrors.name}>
            <input
              className={styles.input}
              value={name}
              maxLength={200}
              aria-invalid={fieldErrors.name ? true : undefined}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {showRatio ? (
            <Field label="Tỷ lệ giá so với bảng mặc định (%)" required error={fieldErrors.ratio} hint="Từ 0,01 đến 1000, tối đa 2 chữ số thập phân; 100 là bằng giá mặc định">
              <input
                className={styles.input}
                inputMode="decimal"
                value={ratio}
                aria-invalid={fieldErrors.ratio ? true : undefined}
                onChange={(event) => setRatio(event.target.value)}
              />
            </Field>
          ) : null}
          <Field label="Trạng thái" required>
            <SearchableSelect
              options={labelOptions(PRICING_STATUS_LABELS)}
              value={status}
              onChange={(value) => setStatus(value || 'ACTIVE')}
            />
          </Field>
          <Field label="Hiệu lực từ ngày" required error={fieldErrors.validFrom}>
            <DatePickerInput value={validFrom || undefined} onChange={setValidFrom} height={38} aria-label="Hiệu lực từ ngày" />
          </Field>
          <Field label="Đến ngày" error={fieldErrors.validTo} hint="Bỏ trống là không hết hạn">
            <DatePickerInput value={validTo || undefined} onChange={setValidTo} min={validFrom || undefined} height={38} aria-label="Hiệu lực đến ngày" />
          </Field>
          <Field label="Ghi chú" wide>
            <textarea className={styles.textarea} rows={2} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
      </CrmDialog>
      {confirming ? (
        <CrmDialog
          open
          title="Đổi tỷ lệ bảng giá?"
          submitLabel="Đồng ý"
          submitting={submitting}
          onClose={() => setConfirming(null)}
          onSubmit={() => {
            const body = confirming;
            setConfirming(null);
            void save(body);
          }}
        >
          <p className={styles.muted}>{RATIO_CHANGE_CONFIRM}</p>
        </CrmDialog>
      ) : null}
    </>
  );
}

type ItemDialog = { readonly kind: 'add' } | { readonly kind: 'edit' | 'manual' | 'vat'; readonly item: PriceListItem };

function PriceListItems({ priceListId, canManage, onChanged }: { priceListId: string; canManage: boolean; onChanged: () => void }) {
  const [detail, setDetail] = useState<PriceListDetail>();
  const [error, setError] = useState<string>();
  const [dialog, setDialog] = useState<ItemDialog | null>(null);
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

  const listType = detail?.listType;

  const columns = useMemo<ColumnsType<PriceListItem>>(() => {
    const columns: ColumnsType<PriceListItem> = [
      { title: 'Mã mặt hàng', dataIndex: 'materialCode', width: 150, render: (value: string) => <span className={styles.mono}>{value}</span> },
      {
        title: 'Tên mặt hàng',
        dataIndex: 'materialName',
        render: (value: string, row) => (
          <span className={styles.cellWithPill}>
            {value}
            {row.sourceActive === false ? <StatusPill tone="neutral">Ngừng dùng ở Kho</StatusPill> : null}
          </span>
        ),
      },
      { title: 'Đơn vị tính', dataIndex: 'unit', width: 110 },
      {
        title: 'Đơn giá',
        dataIndex: 'price',
        width: 160,
        align: 'right',
        render: (value: number | null) => (value === null ? <span className={styles.muted}>{priceText(value)}</span> : priceText(value)),
      },
    ];
    if (listType === 'DERIVED') {
      columns.push({
        title: 'Cách tính',
        dataIndex: 'priceMode',
        width: 120,
        render: (value: PriceMode) => <StatusPill tone={value === 'MANUAL' ? 'info' : 'neutral'}>{PRICE_MODE_LABELS[value]}</StatusPill>,
      });
    }
    columns.push({
      title: 'Thuế suất',
      dataIndex: 'vatRate',
      width: listType === 'DERIVED' ? 170 : 100,
      align: 'right',
      render: (value: number, row) =>
        listType === 'DERIVED' && row.vatManual ? (
          <span className={styles.cellWithPill}>
            <StatusPill tone="info">{VAT_MANUAL_TAG}</StatusPill>
            {formatPercent(value)}
          </span>
        ) : (
          formatPercent(value)
        ),
    });
    // Bảng mặc định lấy hết từ Kho, không có thao tác ghi trên dòng.
    if (!canManage || !listType || listType === 'DEFAULT') return columns;
    columns.push({
      title: '',
      key: 'actions',
      width: listType === 'DERIVED' ? 360 : 130,
      render: (_: unknown, row) =>
        listType === 'DERIVED' ? (
          <span className={styles.rowActions}>
            <button type="button" className={styles.rowAction} aria-label={`Nhập giá tay ${row.materialCode}`} onClick={() => setDialog({ kind: 'manual', item: row })}>
              Nhập giá tay
            </button>
            {row.priceMode === 'MANUAL' ? (
              <Popconfirm
                placement="left"
                title="Bỏ giá tay?"
                description="Dòng quay về giá theo tỷ lệ của bảng mặc định."
                okText="Bỏ giá tay"
                cancelText="Huỷ"
                onConfirm={async () => {
                  try {
                    applyChange(await clearManualPrice(priceListId, row.id));
                    toast.success('Đã bỏ giá tay.');
                  } catch (cause) {
                    toast.error(errorMessage(cause, 'Không bỏ được giá tay.'));
                  }
                }}
              >
                <button type="button" className={styles.rowAction} aria-label={`Bỏ giá tay ${row.materialCode}`}>
                  Bỏ giá tay
                </button>
              </Popconfirm>
            ) : null}
            <button type="button" className={styles.rowAction} aria-label={`Nhập thuế suất tay ${row.materialCode}`} onClick={() => setDialog({ kind: 'vat', item: row })}>
              Nhập thuế suất tay
            </button>
            {row.vatManual ? (
              <Popconfirm
                placement="left"
                title="Bỏ thuế suất tay?"
                description="Dòng quay về thuế suất của bảng giá mặc định (theo Kho)."
                okText="Bỏ thuế suất tay"
                cancelText="Huỷ"
                onConfirm={async () => {
                  try {
                    applyChange(await clearPriceListVatRate(priceListId, row.id));
                    toast.success('Đã bỏ thuế suất tay.');
                  } catch (cause) {
                    toast.error(errorMessage(cause, 'Không bỏ được thuế suất tay.'));
                  }
                }}
              >
                <button type="button" className={styles.rowAction} aria-label={`Bỏ thuế suất tay ${row.materialCode}`}>
                  Bỏ thuế suất tay
                </button>
              </Popconfirm>
            ) : null}
          </span>
        ) : (
          <span className={styles.rowActions}>
            <button type="button" className={styles.rowAction} onClick={() => setDialog({ kind: 'edit', item: row })}>
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
    });
    return columns;
  }, [applyChange, canManage, listType, priceListId]);

  const closeAndApply = (next: PriceListDetail) => {
    setDialog(null);
    applyChange(next);
  };

  return (
    <section className={styles.tableCard} aria-label="Dòng giá">
      <div className={styles.toolbar}>
        <h2 className={styles.title}>{detail ? `Dòng giá: ${detail.code} · ${detail.name}` : 'Dòng giá'}</h2>
        {canManage && listType === 'MANUAL' ? (
          <>
            <button type="button" className={styles.buttonGhost} onClick={() => setPasting(true)}>
              <ClipboardPaste size={14} /> Dán từ bảng tính
            </button>
            <button type="button" className={styles.buttonPrimary} onClick={() => setDialog({ kind: 'add' })}>
              <Plus size={14} /> Thêm dòng giá
            </button>
          </>
        ) : null}
      </div>
      {listType === 'DEFAULT' ? (
        <p className={local.typeHint}>
          Mặt hàng, đơn vị tính, giá bán và thuế suất lấy từ Kho qua "Đồng bộ"; không sửa trong CRM. Muốn đổi thuế suất, sửa
          ở danh mục hàng hóa của Kho rồi đồng bộ lại.
        </p>
      ) : listType === 'DERIVED' ? (
        <p className={local.typeHint}>
          Giá theo tỷ lệ {formatPercent(detail?.ratioPercent)} của bảng giá mặc định, làm tròn đến đồng. Dòng nhập giá tay giữ giá khi
          đồng bộ hoặc đổi tỷ lệ. Thuế suất theo bảng mặc định (Kho), trừ dòng nhập thuế suất tay.
        </p>
      ) : null}
      {error ? <p className={styles.alert}>{error}</p> : null}
      <Table<PriceListItem>
        size="small"
        rowKey="id"
        loading={!detail && !error}
        columns={columns}
        dataSource={[...(detail?.items ?? [])]}
        pagination={{ pageSize: CRM_LIST_PAGE_SIZE, hideOnSinglePage: true }}
        locale={{ emptyText: 'Bảng giá chưa có dòng nào.' }}
      />
      {dialog?.kind === 'add' ? (
        <AddPriceItemsDialog priceListId={priceListId} onClose={() => setDialog(null)} onSaved={closeAndApply} />
      ) : dialog?.kind === 'edit' ? (
        <EditPriceItemDialog priceListId={priceListId} item={dialog.item} onClose={() => setDialog(null)} onSaved={closeAndApply} />
      ) : dialog?.kind === 'manual' ? (
        <ManualPriceDialog priceListId={priceListId} item={dialog.item} onClose={() => setDialog(null)} onSaved={closeAndApply} />
      ) : dialog?.kind === 'vat' ? (
        <VatRateDialog priceListId={priceListId} item={dialog.item} onClose={() => setDialog(null)} onSaved={closeAndApply} />
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
