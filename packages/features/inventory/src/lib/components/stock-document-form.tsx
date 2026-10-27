'use client';

import type {
  Material,
  StockDocument,
  StockDocumentLineDirection,
  StockDocumentType,
  Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { SearchableSelect, formatDate } from '@enterprise-platform/shared-ui';
import { Drawer, Table, type TableColumnsType } from 'antd';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  createStockDocument,
  postStockDocument,
  submitStockDocument,
  updateStockDocument,
} from '../inventory-api';
import { formatNumber } from '../inventory-labels';
import {
  MANUAL_DOCUMENT_TYPES,
  STOCK_DOCUMENT_TYPE_LABEL,
  draftLineToInput,
  draftToCreateRequest,
  emptyLine,
  lineDirection,
  requiresApproval,
  splitLineByLots,
  validateDraft,
  validationMessages,
  type DocumentDraft,
  type DraftLine,
} from '../stock-document.model';
import { LotPickerDrawer, SerialPickerDrawer, errorMessage } from './stock-document-parts';
import styles from '../inventory.module.scss';

const DIRECTION_OPTIONS = [
  { value: 'IN', label: 'Tăng tồn' },
  { value: 'OUT', label: 'Giảm tồn' },
];

/**
 * Form chứng từ kho nhiều dòng (T1-28): phần đầu (loại, kho, kho đến khi điều
 * chuyển, ngày, ghi chú, nguồn) và lưới dòng antd. Dòng xuất chọn lô theo FEFO
 * và serial trong Drawer; dòng nhập ghi số lô, hạn dùng, đơn giá. Lưu ra chứng
 * từ Nháp; "Lưu và gửi duyệt" hoặc "Lưu và ghi sổ" tuỳ loại chứng từ.
 */
export function StockDocumentForm({
  open,
  documentId,
  initial,
  warehouses,
  materials,
  onSaved,
  onClose,
}: {
  open: boolean;
  /** Có thì đang sửa chứng từ này (Nháp hoặc Từ chối). */
  documentId?: string;
  initial: DocumentDraft;
  warehouses: readonly Warehouse[];
  materials: readonly Material[];
  onSaved: (document: StockDocument, message: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DocumentDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const [showErrors, setShowErrors] = useState<'save' | 'post' | undefined>();
  const [serialLine, setSerialLine] = useState<string>();
  const [lotLine, setLotLine] = useState<string>();

  const materialByCode = useMemo(() => new Map(materials.map((item) => [item.code, item])), [materials]);
  const materialOptions = useMemo(
    () =>
      materials
        .filter((item) => item.kind !== 'SERVICE' && item.isActive)
        .map((item) => ({
          value: item.code,
          label: `${item.code} - ${item.name}`,
          description: item.isSerialized ? `${item.unit} · theo serial` : item.unit,
        })),
    [materials],
  );
  const warehouseOptions = useMemo(
    () =>
      warehouses
        .filter((item) => item.isActive)
        .map((item) => ({ value: item.code, label: `${item.code} - ${item.name}` })),
    [warehouses],
  );
  const typeOptions = useMemo(() => {
    const types = new Set<StockDocumentType>(MANUAL_DOCUMENT_TYPES);
    types.add(initial.docType);
    return [...types].map((type) => ({
      value: type,
      label: STOCK_DOCUMENT_TYPE_LABEL[type],
      description: requiresApproval(type) ? 'Phải duyệt trước khi ghi sổ' : 'Ghi sổ không cần duyệt',
    }));
  }, [initial.docType]);

  const editing = Boolean(documentId);
  const lockedSource = Boolean(initial.sourceId);
  const warehouse = warehouses.find((item) => item.code === draft.warehouseCode);
  const validation = validateDraft(draft, materialByCode, { forPosting: showErrors === 'post' });
  const messages = showErrors ? validationMessages(validation) : [];
  const approval = requiresApproval(draft.docType);

  const patch = (next: Partial<DocumentDraft>) => setDraft((current) => ({ ...current, ...next }));
  const patchLine = (key: string, next: Partial<DraftLine>) =>
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...next } : line)),
    }));
  const replaceLine = (key: string, replacement: DraftLine[]) =>
    setDraft((current) => ({
      ...current,
      lines: current.lines.flatMap((line) => (line.key === key ? replacement : [line])),
    }));

  const save = async (then?: 'submit' | 'post') => {
    setShowErrors(then === 'post' ? 'post' : 'save');
    const check = validateDraft(draft, materialByCode, { forPosting: then === 'post' });
    if (!check.valid) return;
    setBusy(true);
    setServerError(undefined);
    try {
      let saved = documentId
        ? await updateStockDocument(documentId, {
            warehouseCode: draft.warehouseCode,
            targetWarehouseCode: draft.docType === 'TRANSFER' ? draft.targetWarehouseCode ?? '' : undefined,
            documentDate: draft.documentDate,
            note: draft.note ?? '',
            lines: draft.lines.map((line) => draftLineToInput(draft.docType, line)),
          })
        : await createStockDocument(draftToCreateRequest(draft));
      let message = `Đã lưu nháp chứng từ ${saved.code}.`;
      if (then === 'submit') {
        saved = await submitStockDocument(saved.id);
        message = `Đã gửi duyệt chứng từ ${saved.code}.`;
      } else if (then === 'post') {
        try {
          saved = (await postStockDocument(saved.id)).document;
          message = `Đã ghi sổ chứng từ ${saved.code}.`;
        } catch (cause) {
          // Nháp đã lưu; báo lỗi ghi sổ để người dùng sửa tiếp trên chứng từ đã có.
          onSaved(saved, `Đã lưu nháp ${saved.code} nhưng chưa ghi sổ được: ${errorMessage(cause, 'lỗi không rõ')}`);
          return;
        }
      }
      onSaved(saved, message);
    } catch (cause) {
      setServerError(errorMessage(cause, 'Không lưu được chứng từ.'));
    } finally {
      setBusy(false);
    }
  };

  const serialTarget = draft.lines.find((line) => line.key === serialLine);
  const lotTarget = draft.lines.find((line) => line.key === lotLine);

  const columns: TableColumnsType<DraftLine> = [
    {
      title: '#',
      key: 'no',
      width: 44,
      render: (_value, _line, index) => index + 1,
    },
    {
      title: 'Mặt hàng',
      key: 'material',
      width: 280,
      render: (_value, line) => (
        <SearchableSelect
          options={materialOptions}
          value={line.materialCode}
          height={32}
          placeholder="Chọn mặt hàng"
          disabled={lockedSource && Boolean(line.reservationId)}
          onChange={(code) => patchLine(line.key, { materialCode: code, serials: [], lotNo: undefined })}
        />
      ),
    },
    ...(draft.docType === 'ADJUSTMENT'
      ? [
          {
            title: 'Chiều',
            key: 'direction',
            width: 130,
            render: (_value: unknown, line: DraftLine) => (
              <SearchableSelect
                options={DIRECTION_OPTIONS}
                value={line.direction}
                height={32}
                placeholder="Tăng/giảm"
                onChange={(value) =>
                  patchLine(line.key, { direction: value as StockDocumentLineDirection, serials: [], lotNo: undefined })
                }
              />
            ),
          },
        ]
      : []),
    {
      title: 'Số lượng',
      key: 'quantity',
      width: 110,
      render: (_value, line) => (
        <input
          type="number"
          min={0}
          step="any"
          className={styles.docNumber}
          aria-label="Số lượng"
          value={Number.isFinite(line.quantity) ? line.quantity : ''}
          onChange={(event) => patchLine(line.key, { quantity: Number(event.target.value) })}
        />
      ),
    },
    {
      title: 'Đơn giá',
      key: 'unitCost',
      width: 130,
      render: (_value, line) =>
        lineDirection(draft.docType, line.direction) === 'IN' ? (
          <input
            type="number"
            min={0}
            step="any"
            className={styles.docNumber}
            aria-label="Đơn giá"
            placeholder="Bình quân"
            title="Bỏ trống hoặc 0 là nhập theo giá bình quân hiện tại"
            value={line.unitCost ?? ''}
            onChange={(event) =>
              patchLine(line.key, { unitCost: event.target.value === '' ? undefined : Number(event.target.value) })
            }
          />
        ) : (
          <span className={styles.docHint}>Giá vốn tính khi ghi sổ</span>
        ),
    },
    {
      title: 'Lô',
      key: 'lot',
      width: 240,
      render: (_value, line) => {
        const material = materialByCode.get(line.materialCode);
        if (!material) return <span className={styles.docHint}>—</span>;
        if (material.isSerialized) return <span className={styles.docHint}>Theo serial</span>;
        if (lineDirection(draft.docType, line.direction) === 'IN') {
          return (
            <div className={styles.docLotInputs}>
              <input
                aria-label="Số lô"
                placeholder="Số lô"
                value={line.lotNo ?? ''}
                onChange={(event) => patchLine(line.key, { lotNo: event.target.value.toUpperCase() })}
              />
              <input
                type="date"
                aria-label="Hạn dùng"
                title="Hạn dùng"
                value={line.lotExpiresOn ?? ''}
                onChange={(event) => patchLine(line.key, { lotExpiresOn: event.target.value || undefined })}
              />
            </div>
          );
        }
        return (
          <button
            type="button"
            className={styles.docLinkButton}
            disabled={!draft.warehouseCode}
            onClick={() => setLotLine(line.key)}
          >
            {line.lotNo
              ? `${line.lotNo}${line.lotExpiresOn ? ` · HSD ${formatDate(line.lotExpiresOn)}` : ''}`
              : 'Chọn lô (FEFO)'}
          </button>
        );
      },
    },
    {
      title: 'Serial',
      key: 'serials',
      width: 130,
      render: (_value, line) => {
        const material = materialByCode.get(line.materialCode);
        if (!material?.isSerialized) return <span className={styles.docHint}>—</span>;
        const need = Math.max(Math.trunc(line.quantity) || 0, 0);
        return (
          <button
            type="button"
            className={styles.docLinkButton}
            disabled={!draft.warehouseCode || need === 0}
            onClick={() => setSerialLine(line.key)}
          >
            {line.serials.length}/{need} serial
          </button>
        );
      },
    },
    {
      title: 'Ghi chú',
      key: 'note',
      render: (_value, line) => (
        <input
          className={styles.docText}
          aria-label="Ghi chú dòng"
          value={line.note ?? ''}
          onChange={(event) => patchLine(line.key, { note: event.target.value })}
        />
      ),
    },
    {
      title: '',
      key: 'remove',
      width: 44,
      render: (_value, line) => (
        <button
          type="button"
          className={styles.docIconButton}
          aria-label="Xoá dòng"
          title="Xoá dòng"
          disabled={draft.lines.length <= 1 || (lockedSource && Boolean(line.reservationId))}
          onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((item) => item.key !== line.key) }))}
        >
          <Trash2 size={15} />
        </button>
      ),
    },
  ];

  const totalQuantity = draft.lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);

  return (
    <Drawer
      open={open}
      onClose={busy ? undefined : onClose}
      size="min(1180px, 96vw)"
      destroyOnHidden
      title={editing ? 'Sửa chứng từ kho' : 'Lập chứng từ kho'}
      footer={
        <div className={styles.docFooter}>
          <span className={styles.countHint}>
            {draft.lines.length} dòng · tổng số lượng {formatNumber(totalQuantity)}
          </span>
          <div className={styles.docActions}>
            <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={busy}>
              Đóng
            </button>
            <button type="button" className={styles.btnSecondary} onClick={() => void save()} disabled={busy}>
              Lưu nháp
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => void save(approval ? 'submit' : 'post')}
              disabled={busy}
            >
              {approval ? 'Lưu và gửi duyệt' : 'Lưu và ghi sổ'}
            </button>
          </div>
        </div>
      }
    >
      <div className={styles.docHeaderGrid}>
        <label className={styles.docField}>
          <span>Loại chứng từ</span>
          <SearchableSelect
            options={typeOptions}
            value={draft.docType}
            disabled={editing}
            height={36}
            onChange={(value) => {
              const docType = value as StockDocumentType;
              patch({
                docType,
                lines: draft.lines.map((line) => ({ ...line, direction: undefined, serials: [], lotNo: undefined })),
              });
            }}
          />
        </label>
        <label className={styles.docField}>
          <span>{draft.docType === 'TRANSFER' ? 'Kho đi' : 'Kho'}</span>
          <SearchableSelect
            options={warehouseOptions}
            value={draft.warehouseCode}
            height={36}
            placeholder="Chọn kho"
            disabled={lockedSource}
            onChange={(code) =>
              patch({ warehouseCode: code, lines: draft.lines.map((line) => ({ ...line, serials: [], lotNo: undefined })) })
            }
          />
        </label>
        {draft.docType === 'TRANSFER' ? (
          <label className={styles.docField}>
            <span>Kho đến</span>
            <SearchableSelect
              options={warehouseOptions.filter((option) => option.value !== draft.warehouseCode)}
              value={draft.targetWarehouseCode}
              height={36}
              placeholder="Chọn kho đến"
              onChange={(code) => patch({ targetWarehouseCode: code })}
            />
          </label>
        ) : null}
        <label className={styles.docField}>
          <span>Ngày chứng từ</span>
          <input
            type="date"
            value={draft.documentDate}
            onChange={(event) => patch({ documentDate: event.target.value })}
          />
        </label>
        <label className={styles.docField}>
          <span>Nguồn (loại chứng từ gốc)</span>
          <input
            value={draft.sourceType ?? ''}
            placeholder="Ví dụ: đơn mua PO-001"
            disabled={lockedSource || editing}
            onChange={(event) => patch({ sourceType: event.target.value })}
          />
        </label>
        <label className={`${styles.docField} ${styles.docFieldWide}`}>
          <span>Ghi chú</span>
          <input value={draft.note ?? ''} onChange={(event) => patch({ note: event.target.value })} />
        </label>
      </div>
      {approval ? (
        <p className={styles.docHint}>
          Loại này phải được người có quyền duyệt chứng từ duyệt trước khi ghi sổ; người lập không tự duyệt.
        </p>
      ) : null}

      <div className={styles.docLinesHead}>
        <h4 className={styles.docSubTitle}>Dòng chứng từ</h4>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, emptyLine()] }))}
        >
          <Plus size={15} /> Thêm dòng
        </button>
      </div>
      <Table<DraftLine>
        rowKey="key"
        size="small"
        columns={columns}
        dataSource={[...draft.lines]}
        pagination={false}
        scroll={{ x: 1080 }}
        rowClassName={(line) => (showErrors && validation.lines[line.key] ? styles.docRowError : '')}
      />

      {messages.length || serverError ? (
        <div role="alert" className={styles.alert} style={{ marginTop: 12 }}>
          {serverError ? <div>{serverError}</div> : null}
          {messages.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      ) : null}

      {serialTarget ? (
        <SerialPickerDrawer
          open
          materialCode={serialTarget.materialCode}
          materialName={materialByCode.get(serialTarget.materialCode)?.name}
          warehouse={warehouse}
          quantity={serialTarget.quantity}
          value={serialTarget.serials}
          inbound={lineDirection(draft.docType, serialTarget.direction) === 'IN'}
          onApply={(serials) => {
            patchLine(serialTarget.key, { serials });
            setSerialLine(undefined);
          }}
          onClose={() => setSerialLine(undefined)}
        />
      ) : null}
      {lotTarget ? (
        <LotPickerDrawer
          open
          materialCode={lotTarget.materialCode}
          warehouseCode={draft.warehouseCode}
          quantity={Number(lotTarget.quantity) || 0}
          unit={materialByCode.get(lotTarget.materialCode)?.unit}
          current={lotTarget.lotNo}
          onApply={(allocations) => {
            replaceLine(lotTarget.key, splitLineByLots(lotTarget, allocations));
            setLotLine(undefined);
          }}
          onClose={() => setLotLine(undefined)}
        />
      ) : null}
    </Drawer>
  );
}
