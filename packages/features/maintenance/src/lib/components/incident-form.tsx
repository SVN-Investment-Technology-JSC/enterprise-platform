'use client';

import type {
  CreateMaintenanceIncidentRequest,
  MaintenanceMatrixRow,
  MaintenancePriority,
  MaintenanceProcedureCatalogEntry,
} from '@enterprise-platform/contracts-maintenance';
import { useAssistantEmbed } from '@enterprise-platform/feature-module-shell';
import {
  EMPTY_TRANSPORT,
  MinimalPopupForm,
  SearchableSelect,
  TransportField,
  toTransportPayload,
  transportError,
  type TransportFieldValue,
  type TransportRange,
} from '@enterprise-platform/shared-ui';
import { Paperclip, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { IncidentFormValues } from '../assistant-incident-draft';
import { loadFleetAvailability } from '../maintenance-api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { SELECT_CLASS } from '../ui/select-class';
import { Tip } from '../ui/tooltip';
import { cn } from '../utils';

/** Chờ người dùng gõ xong giờ rồi mới hỏi xe trống, tránh gọi API sau mỗi phím. */
const DEBOUNCE_MS = 300;

const PRIORITY_OPTIONS = [
  { value: 'High', label: 'Cao' },
  { value: 'Normal', label: 'Thường' },
  { value: 'Low', label: 'Thấp' },
];

/** Chiều cao chuẩn của mọi ô trong form: 36px, chữ 14px, bo md. */
const CONTROL_HEIGHT = 36;
const FIELD_CLASS = 'flex flex-col gap-1.5';
const LABEL_CLASS = 'text-sm font-semibold text-slate-700';
const TEXTAREA_CLASS =
  'min-h-20 w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm! text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-100';

const FORM_TITLE = 'Tạo sự cố bảo trì';

/**
 * Khung của form: popup trên màn Bảo trì; trong card Trợ lý (`useAssistantEmbed`) thì hiện ngay tại chỗ, hết bề ngang
 * card, không lớp phủ.
 */
function IncidentFrame({
  embedded,
  onClose,
  children,
}: {
  embedded: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (embedded) {
    return (
      <section className="flex w-full min-w-0 flex-col gap-1" aria-labelledby="incident-form-title">
        <h2 id="incident-form-title" className="m-0 text-base font-bold leading-snug text-zinc-900">
          {FORM_TITLE}
        </h2>
        {children}
      </section>
    );
  }
  return (
    <MinimalPopupForm
      isOpen
      title={FORM_TITLE}
      subtitle="Ghi nhận hỏng hóc đột xuất và tạo phiếu xử lý ngay khi cần."
      onClose={onClose}
      maxWidth="680px"
      // Chiều cao cố định; màn thấp hơn thì popup tự co theo `max-height: 100%` của lớp nền. Phần dư cuộn dọc trong form.
      popupClassName="h-[760px]"
    >
      {children}
    </MinimalPopupForm>
  );
}

export function IncidentForm({
  assets,
  catalog,
  members,
  busy,
  onCancel,
  onSubmit,
  initialValues,
  initialValuesRevision = 0,
  error,
}: {
  assets: readonly MaintenanceMatrixRow[];
  catalog: readonly MaintenanceProcedureCatalogEntry[];
  members: readonly { userId: string; displayName: string }[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateMaintenanceIncidentRequest, files?: File[]) => Promise<void> | void;
  /** Bản nháp điền sẵn (Trợ lý); chỉ ô có mặt mới được điền. */
  initialValues?: IncidentFormValues;
  /** Tăng khi có bản nháp mới cho form đang mở: các ô có trong `initialValues` được ghi đè, ô khác giữ nguyên. */
  initialValuesRevision?: number;
  /** Lỗi khi lưu (trang form nhúng của Trợ lý), hiện ngay trên hàng nút. */
  error?: string;
}) {
  // Trong card Trợ lý: bỏ các dòng gợi ý để card gọn, chỉ giữ nhãn, giá trị và lỗi.
  const embedded = useAssistantEmbed();
  const [assetCode, setAssetCode] = useState(initialValues?.assetCode ?? '');
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [priority, setPriority] = useState<MaintenancePriority>(initialValues?.priority ?? 'High');
  const [procedureDefinitionId, setProcedureDefinitionId] = useState(initialValues?.procedureDefinitionId ?? '');
  const [assigneeId, setAssigneeId] = useState(initialValues?.assigneeId ?? '');
  const appliedRevision = useRef(initialValuesRevision);
  useEffect(() => {
    if (!initialValues || appliedRevision.current === initialValuesRevision) return;
    appliedRevision.current = initialValuesRevision;
    if (initialValues.assetCode !== undefined) setAssetCode(initialValues.assetCode);
    if (initialValues.title !== undefined) setTitle(initialValues.title);
    if (initialValues.description !== undefined) setDescription(initialValues.description);
    if (initialValues.priority !== undefined) setPriority(initialValues.priority);
    if (initialValues.procedureDefinitionId !== undefined) setProcedureDefinitionId(initialValues.procedureDefinitionId);
    if (initialValues.assigneeId !== undefined) setAssigneeId(initialValues.assigneeId);
  }, [initialValues, initialValuesRevision]);
  const [attachments, setAttachments] = useState<{ file: File; name: string; size: string }[]>([]);
  const [formError, setFormError] = useState<string>();

  // Phương tiện đi hiện trường: xe công ty được giữ trên Lịch xe của HRM, tài xế và xe chọn trong danh sách còn trống.
  const [transport, setTransport] = useState<TransportFieldValue>(EMPTY_TRANSPORT);
  const [transportRange, setTransportRange] = useState<TransportRange>({ startAt: '', endAt: '' });
  const [transportDestination, setTransportDestination] = useState('');
  const [availability, setAvailability] = useState<Awaited<ReturnType<typeof loadFleetAvailability>> | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const rangeReady =
    Boolean(transportRange.startAt && transportRange.endAt) &&
    Date.parse(transportRange.endAt) > Date.parse(transportRange.startAt);
  const needsAvailability = transport.mode === 'COMPANY_VEHICLE' && rangeReady;
  useEffect(() => {
    if (!needsAvailability) return;
    let cancelled = false;
    setAvailabilityLoading(true);
    const timer = setTimeout(() => {
      loadFleetAvailability(transportRange.startAt, transportRange.endAt)
        .then((data) => {
          if (cancelled) return;
          setAvailability(data);
          setAvailabilityError(null);
        })
        .catch((cause: unknown) => {
          if (!cancelled) setAvailabilityError(cause instanceof Error ? cause.message : 'Không tải được danh sách xe.');
        })
        .finally(() => {
          if (!cancelled) setAvailabilityLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [needsAvailability, transportRange.startAt, transportRange.endAt]);

  // Tra tên thiết bị ngay khi chọn hoặc gõ mã
  const asset = useMemo(
    () => assets.find((row) => row.asset.code.toLowerCase() === assetCode.trim().toLowerCase()),
    [assets, assetCode],
  );

  // Danh mục thiết bị dạng SearchableSelectOption
  const assetOptions = useMemo(() => {
    return assets.map((row) => ({
      value: row.asset.code,
      label: `${row.asset.name} (${row.asset.code})`,
      description: row.asset.orgUnitId ? `Đơn vị: ${row.asset.orgUnitId}` : 'Kho thiết bị',
      badge: row.asset.code,
    }));
  }, [assets]);

  // Danh mục thành viên phụ trách dạng SearchableSelectOption
  const memberOptions = useMemo(() => {
    return members.map((member) => ({
      value: member.userId,
      label: member.displayName,
      description: member.userId,
    }));
  }, [members]);

  // Danh mục quy trình dạng SearchableSelectOption
  const procedureOptions = useMemo(() => {
    return catalog.map((entry) => ({
      value: entry.definitionId,
      label: `${entry.code} — ${entry.name}`,
      description: entry.code,
    }));
  }, [catalog]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assetCode.trim()) {
      setFormError('Vui lòng chọn thiết bị phát sinh sự cố');
      return;
    }
    if (!title.trim()) {
      setFormError('Vui lòng nhập tiêu đề sự cố');
      return;
    }
    const transportProblem = transport.mode ? transportError(transport, transportRange) : null;
    if (transportProblem) {
      setFormError(transportProblem);
      return;
    }
    setFormError(undefined);
    const member = members.find((item) => item.userId === assigneeId);
    onSubmit(
      {
        assetCode: assetCode.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        procedureDefinitionId: procedureDefinitionId || undefined,
        assigneeId: member?.userId,
        assigneeName: member?.displayName,
        transport: toTransportPayload(transport, transportRange, transportDestination.trim() || null) ?? undefined,
      },
      attachments.map((a) => a.file),
    );
  };

  return (
    <IncidentFrame embedded={embedded} onClose={onCancel}>
      <form className="flex min-h-0 flex-1 flex-col pt-2" onSubmit={submit} noValidate>
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col gap-4',
            embedded ? '' : 'overflow-y-auto overscroll-contain pb-2 pr-1.5',
          )}
        >
        {embedded ? null : (
          <div>
            <span className="inline-flex w-fit items-center rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">
              Phát sinh ngoài kế hoạch
            </span>
          </div>
        )}

        {formError ? (
          <p role="alert" className="m-0 text-sm text-red-600">
            {formError}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className={FIELD_CLASS}>
            <label htmlFor="incident-asset" className={LABEL_CLASS}>
              Thiết bị gặp sự cố *
            </label>
            <SearchableSelect className={SELECT_CLASS}
              height={CONTROL_HEIGHT}
              options={assetOptions}
              value={assetCode}
              placeholder="Tìm mã hoặc tên thiết bị…"
              clearable
              onChange={(val) => {
                setAssetCode(val);
                if (formError) setFormError(undefined);
              }}
            />
            {assetCode.trim() ? (
              <p
                className={cn(
                  'm-0 text-[0.8125rem] leading-snug',
                  asset ? 'font-semibold text-emerald-600' : 'font-medium text-amber-600',
                )}
              >
                {asset ? asset.asset.name : 'Mã thiết bị chưa có trong danh mục'}
              </p>
            ) : embedded ? null : (
              <p className="m-0 text-[0.8125rem] font-medium leading-snug text-amber-600">
                Gõ mã hoặc tên để chọn nhanh thiết bị
              </p>
            )}
          </div>

          <div className={FIELD_CLASS}>
            <label htmlFor="incident-priority" className={LABEL_CLASS}>
              Mức ưu tiên *
            </label>
            <SearchableSelect className={SELECT_CLASS}
              height={CONTROL_HEIGHT}
              options={PRIORITY_OPTIONS}
              value={priority}
              clearable={false}
              placeholder="Chọn mức ưu tiên…"
              onChange={(val) => setPriority((val || 'High') as MaintenancePriority)}
            />
          </div>
        </div>

        <div className={FIELD_CLASS}>
          <label htmlFor="incident-title" className={LABEL_CLASS}>
            Tiêu đề sự cố *
          </label>
          <Input
            id="incident-title"
            className="h-9 rounded-md text-sm!"
            required
            placeholder="VD: Van AP-003 bị rò rỉ khí nén, động cơ quá nhiệt…"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (formError) setFormError(undefined);
            }}
          />
        </div>

        <div className={FIELD_CLASS}>
          <label htmlFor="incident-desc" className={LABEL_CLASS}>
            Mô tả chi tiết
          </label>
          <textarea
            id="incident-desc"
            className={TEXTAREA_CLASS}
            rows={3}
            placeholder="Hiện tượng, thông số đo được, vị trí cụm máy, thời điểm phát hiện…"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        {/* Tệp đính kèm hiện trường sự cố */}
        <div className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Tệp đính kèm hiện trường (Ảnh, tài liệu sự cố)</span>
          <div className="flex flex-col gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor="incident-file-upload"
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 shadow-xs transition-colors hover:bg-slate-100"
              >
                <Upload size={14} />
                <span>Tải tệp lên</span>
              </label>
              <input
                id="incident-file-upload"
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.webp,.mp4,.mov"
                className="hidden"
                onChange={(event) => {
                  const files = event.target.files;
                  if (!files || files.length === 0) return;
                  const ALLOWED_EXTENSIONS = new Set([
                    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov'
                  ]);
                  const MAX_BYTES = 25 * 1024 * 1024;
                  const validFiles: { file: File; name: string; size: string }[] = [];
                  const rejectedNames: string[] = [];

                  Array.from(files).forEach((file) => {
                    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
                    if (!ALLOWED_EXTENSIONS.has(ext)) {
                      rejectedNames.push(`${file.name} (định dạng không được hỗ trợ)`);
                      return;
                    }
                    if (file.size > MAX_BYTES) {
                      rejectedNames.push(`${file.name} (vượt quá 25MB)`);
                      return;
                    }
                    validFiles.push({
                      file,
                      name: file.name,
                      size:
                        file.size < 1024 * 1024
                          ? `${(file.size / 1024).toFixed(1)} KB`
                          : `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
                    });
                  });

                  if (rejectedNames.length > 0) {
                    alert(`Không thể tải lên các tệp sau:\n- ${rejectedNames.join('\n- ')}\n\nChỉ chấp nhận các tệp hình ảnh, tài liệu và video ngắn (.jpg, .png, .pdf, .doc, .xlsx, .mp4) dung lượng tối đa 25MB.`);
                  }

                  if (validFiles.length > 0) {
                    setAttachments((prev) => [...prev, ...validFiles]);
                  }
                  event.target.value = '';
                }}
              />
              {embedded ? null : (
                <span className="text-xs text-slate-500">
                  (Ảnh chụp hiện trường, biên bản, video ngắn - Tối đa 25MB)
                </span>
              )}
            </div>

            {/* Danh sách tệp đã thêm */}
            {attachments.length > 0 ? (
              <div className="mt-1 flex flex-col gap-1">
                {attachments.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1 text-[13px]"
                  >
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <Paperclip size={13} className="shrink-0 text-blue-600" />
                      <span className="truncate font-medium text-blue-600">{file.name}</span>
                      <small className="text-slate-400">({file.size})</small>
                    </div>
                    <Tip content="Gỡ tệp">
                      <button
                        type="button"
                        className="flex cursor-pointer items-center border-0 bg-transparent px-1 py-0.5 text-red-500 hover:text-red-700"
                        onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                        aria-label={`Gỡ tệp ${file.name}`}
                      >
                        <X size={13} />
                      </button>
                    </Tip>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className={FIELD_CLASS}>
            <label htmlFor="incident-assignee" className={LABEL_CLASS}>
              Người chịu trách nhiệm
            </label>
            <SearchableSelect className={SELECT_CLASS}
              height={CONTROL_HEIGHT}
              options={memberOptions}
              value={assigneeId}
              clearable
              placeholder="Tìm và giao nhân sự xử lý…"
              onChange={(val) => setAssigneeId(val)}
            />
          </div>

          <div className={FIELD_CLASS}>
            <label htmlFor="incident-procedure" className={LABEL_CLASS}>
              Quy trình xử lý
            </label>
            <SearchableSelect className={SELECT_CLASS}
              height={CONTROL_HEIGHT}
              options={procedureOptions}
              value={procedureDefinitionId}
              clearable
              placeholder="Chọn quy trình (hoặc bỏ trống để chỉ ghi nhận)…"
              onChange={(val) => setProcedureDefinitionId(val)}
            />
          </div>
        </div>

        {/* TransportField của shared-ui có CSS riêng (13.5px): ép về cùng 14px với các ô còn lại trong hộp thoại. */}
        <div className="[&_input]:text-sm! [&_select]:text-sm!">
        <TransportField
          idPrefix="incident-transport"
          value={transport}
          onChange={setTransport}
          range={transportRange}
          onRangeChange={setTransportRange}
          availability={availability}
          loading={availabilityLoading}
          error={needsAvailability ? availabilityError : null}
          disabled={busy}
          note={
            embedded
              ? undefined
              : 'Xe được giữ trên Lịch xe của HRM ngay khi tạo sự cố; nếu xe vừa có người đặt trước, phiếu báo lại để chọn xe khác.'
          }
        />
        </div>
        {transport.mode === 'COMPANY_VEHICLE' ? (
          <div className={FIELD_CLASS}>
            <label htmlFor="incident-destination" className={LABEL_CLASS}>
              Điểm đến
            </label>
            <Input
              id="incident-destination"
              className="h-9 rounded-md"
              maxLength={255}
              placeholder="VD: Trạm biến áp 500kV Phố Nối"
              value={transportDestination}
              onChange={(event) => setTransportDestination(event.target.value)}
            />
          </div>
        ) : null}

        </div>

        {error ? (
          <p role="alert" className="m-0 mt-2 text-sm font-semibold leading-snug text-red-600">
            {error}
          </p>
        ) : null}

        <div className="mt-2 flex shrink-0 flex-col-reverse items-stretch gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-md px-4"
            onClick={onCancel}
            disabled={busy}
          >
            Huỷ
          </Button>
          <Button
            type="submit"
            className="h-9 rounded-md border-blue-600 bg-blue-600 px-5 font-bold text-white hover:bg-blue-700"
            disabled={busy}
          >
            {busy ? 'Đang ghi nhận…' : 'Tạo sự cố'}
          </Button>
        </div>
      </form>
    </IncidentFrame>
  );
}
