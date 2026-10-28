'use client';

import {
  WARRANTY_CAUSE_LABELS,
  WARRANTY_SOURCE_LABELS,
  WARRANTY_STATUS_LABELS,
  type WarrantyCause,
  type WarrantyCaseSummary,
  type WarrantyLookupItem,
  type WarrantyStatus,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus, Search, Settings } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CrmDialog, Field, KeysetPager, StatusPill } from '../components/crm-ui';
import { useDebounced } from '../components/use-debounced';
import { useKeysetPage } from '../components/use-keyset-page';
import {
  createWarrantyCase,
  errorMessage,
  listWarrantyCases,
  loadWarrantySettings,
  lookupWarranty,
  saveWarrantySettings,
} from '../crm-api';
import { labelOptions, peopleOptions, useCrm } from '../crm-context';
import { formatDay } from '../fulfillment.model';
import { personName } from '../sales.model';
import styles from '../sales.module.scss';
import { WARRANTY_STATUS_TONE, coverageLabel } from './warranty.model';

/** Được tiếp nhận, xử lý bảo hành (`crm.warranty.write`). */
export function useCanWriteWarranty(): boolean {
  const { capabilities } = useCrm();
  return capabilities.isTenantAdmin || capabilities.canWriteWarranty;
}

/**
 * Bảo hành, đổi trả (T6-08): tra cứu hạn bảo hành theo serial, tiếp nhận yêu
 * cầu, danh sách yêu cầu trong phạm vi dữ liệu. Chi tiết (kiểm định, hướng xử
 * lý, chứng từ) ở `WarrantyDetail`.
 */
export function WarrantyPage({ onOpen }: { onOpen: (id: string) => void }) {
  const { people, capabilities } = useCrm();
  const canWrite = useCanWriteWarranty();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [intake, setIntake] = useState<{ serials: string[] } | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const q = useDebounced(search.trim(), 350);
  const list = useKeysetPage(JSON.stringify({ q, status }), (cursor) =>
    listWarrantyCases({ q, status: (status || undefined) as WarrantyStatus | undefined, cursor, limit: 30 }),
  );

  const columns = useMemo<ColumnsType<WarrantyCaseSummary>>(
    () => [
      {
        title: 'Mã',
        dataIndex: 'code',
        width: 160,
        render: (value: string, row) => (
          <span className={styles.cellWithPill}>
            <span className={styles.mono}>{value}</span>
            {row.chargeable ? <StatusPill tone="warning">Có phí</StatusPill> : null}
          </span>
        ),
      },
      { title: 'Khách hàng', key: 'customer', ellipsis: true, render: (_: unknown, row) => `${row.customerCode} - ${row.customerName}` },
      { title: 'Serial', key: 'serials', width: 200, ellipsis: true, render: (_: unknown, row) => row.serials.join(', ') || `${row.lineCount} dòng` },
      { title: 'Đơn', dataIndex: 'orderCode', width: 130, render: (value: string | null) => value ?? '' },
      { title: 'Nguyên nhân', dataIndex: 'cause', width: 160, render: (value: WarrantyCause) => WARRANTY_CAUSE_LABELS[value] },
      {
        title: 'Trạng thái',
        dataIndex: 'status',
        width: 150,
        render: (value: WarrantyStatus) => <StatusPill tone={WARRANTY_STATUS_TONE[value]}>{WARRANTY_STATUS_LABELS[value]}</StatusPill>,
      },
      { title: 'Người xử lý', dataIndex: 'assigneeUserId', width: 160, ellipsis: true, render: (value: string | null) => (value ? personName(people, value) : '') },
      { title: 'Tiếp nhận', dataIndex: 'createdAt', width: 110, render: (value: string) => formatDay(value.slice(0, 10)) },
      {
        title: '',
        key: 'actions',
        width: 70,
        render: (_: unknown, row) => (
          <button type="button" className={styles.rowAction} onClick={() => onOpen(row.id)}>
            Mở
          </button>
        ),
      },
    ],
    [people, onOpen],
  );

  return (
    <div className={styles.page}>
      <SerialLookup canWrite={canWrite} onOpen={onOpen} onIntake={(serials) => setIntake({ serials })} />
      <section className={styles.tableCard} aria-label="Yêu cầu bảo hành">
        <div className={styles.toolbar}>
          {canWrite ? (
            <button type="button" className={styles.buttonPrimary} onClick={() => setIntake({ serials: [] })}>
              <Plus size={14} /> Tiếp nhận yêu cầu
            </button>
          ) : null}
          <input
            className={`${styles.input} ${styles.search}`}
            type="search"
            placeholder="Tìm theo mã yêu cầu, serial, tên khách…"
            value={search}
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
          />
          <SearchableSelect className={styles.filter} options={labelOptions(WARRANTY_STATUS_LABELS)} value={status} placeholder="Mọi trạng thái" clearable onChange={setStatus} />
          {capabilities.isTenantAdmin || capabilities.canManage ? (
            <button type="button" className={styles.buttonGhost} onClick={() => setConfiguring(true)}>
              <Settings size={14} /> Kho bảo hành
            </button>
          ) : null}
        </div>
        {list.error ? <p className={styles.alert}>{list.error}</p> : null}
        <Table<WarrantyCaseSummary>
          size="small"
          rowKey="id"
          loading={list.loading}
          columns={columns}
          dataSource={[...list.items]}
          pagination={false}
          scroll={{ x: 1250 }}
          onRow={(row) => ({ onDoubleClick: () => onOpen(row.id) })}
          locale={{ emptyText: list.loading ? 'Đang tải…' : 'Chưa có yêu cầu bảo hành nào.' }}
        />
        <KeysetPager page={list.page} count={list.items.length} hasNext={list.hasNext} loading={list.loading} noun="yêu cầu" onPrevious={list.previous} onNext={list.next} />
      </section>
      {intake ? (
        <IntakeDialog
          initialSerials={intake.serials}
          onClose={() => setIntake(null)}
          onCreated={(id) => {
            setIntake(null);
            onOpen(id);
          }}
        />
      ) : null}
      {configuring ? <WarrantySettingsDialog onClose={() => setConfiguring(false)} /> : null}
    </div>
  );
}

/** Tra cứu hạn bảo hành theo serial (TC-WAR-01): đơn, khách, ngày giao, hạn còn lại. */
function SerialLookup({
  canWrite,
  onOpen,
  onIntake,
}: {
  canWrite: boolean;
  onOpen: (id: string) => void;
  onIntake: (serials: string[]) => void;
}) {
  const [serial, setSerial] = useState('');
  const [result, setResult] = useState<WarrantyLookupItem>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function lookup() {
    const value = serial.trim();
    if (!value) return setError('Vui lòng nhập số serial.');
    setLoading(true);
    setError(undefined);
    try {
      const [first] = await lookupWarranty({ serial: value });
      setResult(first);
    } catch (cause) {
      setResult(undefined);
      setError(errorMessage(cause, 'Không tra cứu được serial.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="Tra cứu bảo hành theo serial">
      <h3 className={styles.sectionTitle}>Tra cứu hạn bảo hành</h3>
      <form
        className={styles.toolbar}
        onSubmit={(event) => {
          event.preventDefault();
          void lookup();
        }}
      >
        <input
          className={`${styles.input} ${styles.search}`}
          placeholder="Nhập số serial, ví dụ SN031"
          value={serial}
          maxLength={100}
          onChange={(event) => setSerial(event.target.value)}
          aria-label="Số serial"
        />
        <button type="submit" className={styles.buttonGhost} disabled={loading}>
          <Search size={14} /> {loading ? 'Đang tra…' : 'Tra cứu'}
        </button>
      </form>
      {error ? <p className={styles.alert}>{error}</p> : null}
      {result ? (
        <dl className={styles.facts}>
          <dt>Serial</dt>
          <dd>
            <span className={styles.mono}>{result.serial}</span> · {result.materialCode} {result.materialName}
          </dd>
          <dt>Khách hàng</dt>
          <dd>
            {result.customerCode} - {result.customerName}
          </dd>
          <dt>Đơn, đợt giao</dt>
          <dd>
            {result.orderCode ?? ''}
            {result.deliveryCode ? ` · ${result.deliveryCode}` : ''}
            {result.contractCode ? ` · Hợp đồng ${result.contractCode}` : ''}
            {result.replacementOf ? ` · Hàng thay thế của ${result.replacementOf.serial ?? ''} (${result.replacementOf.caseCode})` : ''}
          </dd>
          <dt>Ngày giao</dt>
          <dd>{formatDay(result.coverage.deliveredOn) || 'Chưa rõ'}</dd>
          <dt>Hạn bảo hành</dt>
          <dd>
            <span className={styles.cellWithPill}>
              <StatusPill tone={result.coverage.expired ? 'danger' : 'success'}>{coverageLabel(result.coverage)}</StatusPill>
              <span className={styles.muted}>
                {WARRANTY_SOURCE_LABELS[result.coverage.source]}
                {result.coverage.months ? `, ${result.coverage.months} tháng` : ''}
              </span>
            </span>
          </dd>
          <dt>Yêu cầu</dt>
          <dd>
            {result.openCaseId ? (
              <button type="button" className={styles.linkButton} onClick={() => onOpen(result.openCaseId as string)}>
                Đang có yêu cầu bảo hành mở
              </button>
            ) : canWrite ? (
              <button type="button" className={styles.buttonPrimary} onClick={() => onIntake([result.serial ?? ''])}>
                <Plus size={14} /> {result.coverage.expired ? 'Tiếp nhận (có phí)' : 'Tiếp nhận yêu cầu'}
              </button>
            ) : (
              <span className={styles.muted}>Chưa có yêu cầu mở</span>
            )}
          </dd>
        </dl>
      ) : null}
    </section>
  );
}

/** Phiếu tiếp nhận: nguyên nhân bắt buộc (WAR-02), mỗi dòng một serial cùng một khách. */
function IntakeDialog({
  initialSerials,
  onClose,
  onCreated,
}: {
  initialSerials: readonly string[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { people } = useCrm();
  const [cause, setCause] = useState('');
  const [serials, setSerials] = useState(initialSerials.join('\n'));
  const [description, setDescription] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    const lines = serials
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((serial) => ({ serial }));
    if (!cause) return setError('Vui lòng chọn nguyên nhân bảo hành, đổi trả.');
    if (!lines.length) return setError('Vui lòng nhập ít nhất một serial.');
    setSaving(true);
    setError(undefined);
    try {
      const created = await createWarrantyCase({
        cause: cause as WarrantyCause,
        description: description.trim() || null,
        assigneeUserId: assigneeUserId || null,
        lines,
      });
      toast.success(`Đã tiếp nhận yêu cầu ${created.code}${created.chargeable ? ' (có phí)' : ''}.`);
      onCreated(created.id);
    } catch (cause) {
      setError(errorMessage(cause, 'Không tiếp nhận được yêu cầu.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog open title="Tiếp nhận yêu cầu bảo hành" subtitle="Hạn bảo hành tính từ ngày giao thực tế của serial" submitLabel="Tiếp nhận" submitting={saving} error={error} onClose={onClose} onSubmit={() => void save()}>
      <div className={styles.fieldGrid}>
        <Field label="Nguyên nhân" required>
          <SearchableSelect options={labelOptions(WARRANTY_CAUSE_LABELS)} value={cause} placeholder="Chọn nguyên nhân" onChange={setCause} />
        </Field>
        <Field label="Người xử lý" hint="Bỏ trống: bạn">
          <SearchableSelect options={peopleOptions(people)} value={assigneeUserId} placeholder="Bạn" clearable onChange={setAssigneeUserId} />
        </Field>
        <Field label="Serial" required hint="Mỗi dòng một serial; các serial phải cùng một khách" wide>
          <textarea className={styles.textarea} rows={4} maxLength={5000} value={serials} onChange={(event) => setSerials(event.target.value)} />
        </Field>
        <Field label="Mô tả lỗi, yêu cầu của khách" wide>
          <textarea className={styles.textarea} rows={3} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
      </div>
    </CrmDialog>
  );
}

/** Kho cách ly nhận hàng bảo hành, kho lỗi nhận hàng kiểm định Lỗi, kho nhập lại hàng Đạt (`crm.manage`). */
function WarrantySettingsDialog({ onClose }: { onClose: () => void }) {
  const [quarantine, setQuarantine] = useState('');
  const [defect, setDefect] = useState('');
  const [restock, setRestock] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadWarrantySettings()
      .then((settings) => {
        setQuarantine(settings.quarantineWarehouseCode);
        setDefect(settings.defectWarehouseCode);
        setRestock(settings.restockWarehouseCode);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được cấu hình.')));
  }, []);

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      await saveWarrantySettings({
        quarantineWarehouseCode: quarantine.trim(),
        defectWarehouseCode: defect.trim(),
        restockWarehouseCode: restock.trim(),
      });
      toast.success('Đã lưu kho bảo hành.');
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được cấu hình.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmDialog open title="Kho bảo hành" subtitle="Mã kho của phân hệ Kho" submitting={saving} error={error} onClose={onClose} onSubmit={() => void save()}>
      <div className={styles.fieldGrid}>
        <Field label="Kho cách ly" required hint="Hàng bảo hành nhận về, Chờ kiểm định">
          <input className={styles.input} maxLength={50} value={quarantine} onChange={(event) => setQuarantine(event.target.value.toUpperCase())} />
        </Field>
        <Field label="Kho lỗi" required hint="Hàng kiểm định Lỗi chuyển sang">
          <input className={styles.input} maxLength={50} value={defect} onChange={(event) => setDefect(event.target.value.toUpperCase())} />
        </Field>
        <Field label="Kho nhập lại hàng Đạt" required hint="Dùng khi không biết kho đã xuất serial, dòng hàng">
          <input className={styles.input} maxLength={50} value={restock} onChange={(event) => setRestock(event.target.value.toUpperCase())} />
        </Field>
      </div>
    </CrmDialog>
  );
}
