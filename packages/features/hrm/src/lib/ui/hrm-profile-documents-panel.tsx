'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table, type TableColumnsType } from 'antd';
import { FileText, ImageIcon, Plus, TriangleAlert } from 'lucide-react';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  HrmProfileDocumentChange,
  HrmProfileDocuments,
  HrmProfileDocumentType,
  HrmProfileFileRef,
  HrmQualification,
  HrmQualificationType,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { uploadHrmAttachment } from '../hrm-attachment-upload';
import { Badge } from './badge';
import { Button } from './button';
import { DatePickerInput } from './date-picker-input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import { Input } from './input';
import { toast } from './toast';

const documentLabels: Record<HrmProfileDocumentType, string> = {
  PHOTO: 'Ảnh thẻ',
  ID_CARD_FRONT: 'CCCD mặt trước',
  ID_CARD_BACK: 'CCCD mặt sau',
};
const qualificationLabels: Record<HrmQualificationType, string> = {
  DEGREE: 'Bằng cấp',
  CERTIFICATE: 'Chứng chỉ',
  LANGUAGE: 'Ngoại ngữ',
  PROFESSIONAL: 'Chứng chỉ nghề nghiệp',
  PASSPORT: 'Hộ chiếu',
  WORK_PERMIT: 'Giấy phép lao động',
  LICENSE: 'Giấy phép hành nghề',
  OTHER: 'Khác',
};
const qualificationOptions = Object.entries(qualificationLabels).map(
  ([value, label]) => ({ value, label }),
);
const EXPIRY_WARNING_DAYS = 60;

const vnDate = (iso?: string | null) => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '----';
};
function expiryState(iso?: string | null): 'expired' | 'soon' | null {
  if (!iso) return null;
  const days = (Date.parse(iso) - Date.now()) / 86_400_000;
  if (days < 0) return 'expired';
  return days <= EXPIRY_WARNING_DAYS ? 'soon' : null;
}
function ExpiryBadge({ iso }: { iso?: string | null }) {
  const state = expiryState(iso);
  if (!state) return null;
  return (
    <Badge
      variant="outline"
      className={
        state === 'expired'
          ? 'ml-1 border-red-200 bg-red-50 text-red-700'
          : 'ml-1 border-amber-200 bg-amber-50 text-amber-700'
      }
    >
      {state === 'expired' ? 'Hết hạn' : 'Sắp hết hạn'}
    </Badge>
  );
}

async function openFile(id: string) {
  try {
    const { data } = await hrmFetch<{ data: { url: string } }>(
      `/attachments/${id}/download`,
    );
    window.open(data.url, '_blank', 'noopener,noreferrer');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Không mở được tệp');
  }
}

function FileThumb({ file }: { file: HrmProfileFileRef | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const fileId = file?.id;
  const isImage = file?.contentType.startsWith('image/');
  useEffect(() => {
    setUrl(null);
    if (!fileId || !isImage) return;
    let live = true;
    hrmFetch<{ data: { url: string } }>(`/attachments/${fileId}/download`)
      .then((r) => live && setUrl(r.data.url))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [fileId, isImage]);
  if (!file)
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
        Chưa có
      </div>
    );
  if (!isImage)
    return (
      <button
        type="button"
        onClick={() => openFile(file.id)}
        className="flex h-32 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 text-xs text-blue-700"
      >
        <FileText className="size-4" />
        {file.fileName}
      </button>
    );
  return url ? (
    <button
      type="button"
      onClick={() => openFile(file.id)}
      className="block h-32 w-full overflow-hidden rounded-md border border-slate-200 bg-slate-50"
    >
      <img src={url} alt={file.fileName} className="size-full object-contain" />
    </button>
  ) : (
    <div className="flex h-32 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-400">
      <ImageIcon className="size-5" />
    </div>
  );
}

interface QualificationForm {
  type: string;
  name: string;
  level: string;
  major: string;
  institution: string;
  certificateNumber: string;
  issuedDate: string;
  effectiveFrom: string;
  expiryDate: string;
  grade: string;
  note: string;
}
const emptyQualification: QualificationForm = {
  type: 'DEGREE',
  name: '',
  level: '',
  major: '',
  institution: '',
  certificateNumber: '',
  issuedDate: '',
  effectiveFrom: '',
  expiryDate: '',
  grade: '',
  note: '',
};

type Editing =
  | { kind: 'document'; documentType: HrmProfileDocumentType }
  | { kind: 'qualification'; row?: HrmQualification };

/**
 * Ảnh thẻ, CCCD (bắt buộc) và bằng cấp, chứng chỉ (không bắt buộc).
 * Cho phép cả HR (mode "hr") và cá nhân tự cập nhật trực tiếp (mode "self").
 */
export function HrmProfileDocumentsPanel({
  employeeId,
  mode,
  readOnly,
  identityCardNumber,
}: {
  employeeId: string;
  mode: 'hr' | 'self';
  readOnly?: boolean;
  identityCardNumber?: string;
}) {
  const [docs, setDocs] = useState<HrmProfileDocuments | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState('');
  const [form, setForm] = useState<QualificationForm>(emptyQualification);
  const [busy, setBusy] = useState(false);
  const permission = mode === 'hr' ? 'hrm.employee.manage' : undefined;

  const load = useCallback(async () => {
    try {
      const r = await hrmFetch<{ data: HrmProfileDocuments }>(
        `/employees/${employeeId}/profile-documents`,
      );
      setDocs(r.data);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được giấy tờ');
    }
  }, [employeeId]);
  useEffect(() => {
    void load();
  }, [load, identityCardNumber]);

  const close = () => {
    setEditing(null);
    setFile(null);
    setExpiry('');
    setForm(emptyQualification);
  };
  const openDocument = (documentType: HrmProfileDocumentType) => {
    close();
    setEditing({ kind: 'document', documentType });
    setExpiry(docs?.identityCardExpiryDate ?? '');
  };
  const openQualification = (row?: HrmQualification) => {
    close();
    setEditing({ kind: 'qualification', row });
    if (row)
      setForm({
        type: row.type,
        name: row.name,
        level: row.level ?? '',
        major: row.major ?? '',
        institution: row.institution ?? '',
        certificateNumber: row.certificateNumber ?? '',
        issuedDate: row.issuedDate ?? '',
        effectiveFrom: row.effectiveFrom ?? '',
        expiryDate: row.expiryDate ?? '',
        grade: row.grade ?? '',
        note: row.note ?? '',
      });
  };

  /** Cập nhật trực tiếp giấy tờ & bằng cấp vào hồ sơ. */
  async function submit(
    documentChanges: HrmProfileDocumentChange[],
    identityCardExpiryDate?: string,
  ) {
    await hrmFetch(`/employees/${employeeId}/profile-documents`, {
      method: 'POST',
      body: JSON.stringify({
        documentChanges,
        ...(identityCardExpiryDate !== undefined
          ? { identityCardExpiryDate: identityCardExpiryDate || null }
          : {}),
      }),
    });
    toast.success('Đã cập nhật giấy tờ');
    await load();
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      if (editing.kind === 'document') {
        const isId = editing.documentType !== 'PHOTO';
        const expiryChanged =
          isId && expiry !== (docs?.identityCardExpiryDate ?? '');
        if (!file && !expiryChanged) throw new Error('Chọn tệp để tải lên');
        const changes: HrmProfileDocumentChange[] = [];
        if (file) {
          const up = await uploadHrmAttachment(
            employeeId,
            file,
            editing.documentType,
          );
          changes.push({
            op: 'SET_DOCUMENT',
            documentType: editing.documentType,
            attachmentId: up.id,
          });
        }
        await submit(changes, expiryChanged ? expiry : undefined);
      } else {
        if (!form.name.trim()) throw new Error('Nhập tên bằng cấp, chứng chỉ');
        let attachmentId = editing.row?.attachment?.id ?? null;
        if (file)
          attachmentId = (
            await uploadHrmAttachment(employeeId, file, 'QUALIFICATION')
          ).id;
        const q = {
          type: form.type as HrmQualificationType,
          name: form.name.trim(),
          level: form.level.trim() || null,
          major: form.major.trim() || null,
          institution: form.institution.trim() || null,
          certificateNumber: form.certificateNumber.trim() || null,
          issuedDate: form.issuedDate || null,
          effectiveFrom: form.effectiveFrom || null,
          expiryDate: form.expiryDate || null,
          grade: form.grade.trim() || null,
          note: form.note.trim() || null,
          attachmentId,
        };
        await submit([
          editing.row
            ? {
                op: 'UPDATE_QUALIFICATION',
                id: editing.row.id,
                qualification: q,
              }
            : { op: 'ADD_QUALIFICATION', qualification: q },
        ]);
      }
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Không lưu được');
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: HrmQualification) {
    try {
      await hrmFetch(`/employees/${employeeId}/profile-documents`, {
        method: 'POST',
        body: JSON.stringify({
          documentChanges: [{ op: 'REMOVE_QUALIFICATION', id: row.id }],
        }),
      });
      toast.success('Đã gỡ khỏi hồ sơ');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Không thể gỡ');
    }
  }

  const missingText: Record<string, string> = {
    identityCardNumber: 'số CCCD',
    identityCardFront: 'ảnh CCCD mặt trước',
    identityCardBack: 'ảnh CCCD mặt sau',
  };
  const columns: TableColumnsType<HrmQualification> = [
    {
      title: 'Loại',
      width: 130,
      render: (_, r) => qualificationLabels[r.type] ?? r.type,
    },
    { title: 'Tên', dataIndex: 'name', width: 200 },
    { title: 'Nơi cấp', dataIndex: 'institution', width: 160 },
    { title: 'Số hiệu', dataIndex: 'certificateNumber', width: 120 },
    {
      title: 'Hiệu lực từ',
      width: 100,
      render: (_, r) => vnDate(r.effectiveFrom ?? r.issuedDate),
    },
    {
      title: 'Hết hạn',
      width: 150,
      render: (_, r) => (
        <span>
          {r.expiryDate ? vnDate(r.expiryDate) : 'Không thời hạn'}
          <ExpiryBadge iso={r.expiryDate} />
        </span>
      ),
    },
    {
      title: 'Tệp',
      width: 70,
      render: (_, r) =>
        r.attachment ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openFile(r.attachment!.id)}
          >
            Xem
          </Button>
        ) : (
          '----'
        ),
    },
    ...(readOnly
      ? []
      : [
          {
            title: 'Thao tác',
            width: 130,
            fixed: 'right' as const,
            render: (_: unknown, r: HrmQualification) => (
              <span className="inline-flex gap-1">
                <Button
                  permission={permission}
                  variant="outline"
                  size="sm"
                  onClick={() => openQualification(r)}
                >
                  Sửa
                </Button>
                <Popconfirm
                  title="Gỡ bằng cấp, chứng chỉ?"
                  description="Mục này sẽ được gỡ khỏi hồ sơ; lịch sử vẫn được lưu."
                  okText="Gỡ"
                  onConfirm={() => remove(r)}
                >
                  <Button permission={permission} variant="outline" size="sm">
                    Gỡ
                  </Button>
                </Popconfirm>
              </span>
            ),
          },
        ]),
  ];

  const field = (
    label: string,
    key: keyof QualificationForm,
    props: { date?: boolean } = {},
  ) => (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-slate-800">
        {label}
      </label>
      {props.date ? (
        <DatePickerInput
          value={form[key]}
          onChange={(v) => setForm((f) => ({ ...f, [key]: v }))}
          placeholder="dd/mm/yyyy"
        />
      ) : (
        <Input
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          className="text-xs"
        />
      )}
    </div>
  );

  const editingDocumentType =
    editing?.kind === 'document' ? editing.documentType : null;
  const isPhoto = editingDocumentType === 'PHOTO';
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold">Ảnh và giấy tờ</h3>
        <p className="text-xs text-slate-500">
          CCCD là bắt buộc. Bằng cấp, chứng chỉ, hộ chiếu, giấy phép lao động là
          tùy chọn.
        </p>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {docs && docs.missingRequired.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Hồ sơ chưa đủ giấy tờ bắt buộc, còn thiếu:{' '}
            {docs.missingRequired.map((k) => missingText[k]).join(', ')}.
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(
          [
            ['PHOTO', docs?.photo],
            ['ID_CARD_FRONT', docs?.identityCardFront],
            ['ID_CARD_BACK', docs?.identityCardBack],
          ] as const
        ).map(([type, ref]) => (
          <div key={type} className="space-y-2">
            <div className="text-xs font-semibold text-slate-800">
              {documentLabels[type]}
              {type !== 'PHOTO' && (
                <span className="ml-1 text-[10px] font-normal text-red-600">
                  Bắt buộc
                </span>
              )}
            </div>
            <FileThumb file={ref ?? null} />
            {!readOnly && (
              <Button
                permission={permission}
                variant="outline"
                size="sm"
                onClick={() => openDocument(type)}
              >
                {ref ? 'Thay tệp' : 'Tải lên'}
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <div>
          Ngày hết hạn CCCD:{' '}
          <strong>
            {docs?.identityCardExpiryDate
              ? vnDate(docs.identityCardExpiryDate)
              : 'Không ghi nhận'}
          </strong>
          <ExpiryBadge iso={docs?.identityCardExpiryDate} />
        </div>
        {!readOnly && (
          <Button
            permission={permission}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700"
            onClick={() => openDocument('ID_CARD_FRONT')}
          >
            Cập nhật ngày hết hạn
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-900">
          Bằng cấp và chứng chỉ
        </h4>
        {!readOnly && (
          <Button
            permission={permission}
            size="sm"
            onClick={() => openQualification()}
          >
            <Plus className="size-3.5" /> Thêm
          </Button>
        )}
      </div>
      <Table
        size="small"
        rowKey="id"
        dataSource={docs?.qualifications ?? []}
        columns={columns}
        pagination={false}
        scroll={{ x: 960, y: 260 }}
        locale={{ emptyText: 'Chưa có bằng cấp, chứng chỉ' }}
      />

      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !busy) close();
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingDocumentType
                ? documentLabels[editingDocumentType]
                : editing?.kind === 'qualification' && editing.row
                  ? 'Cập nhật bằng cấp, chứng chỉ'
                  : 'Thêm bằng cấp, chứng chỉ'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            {editing?.kind === 'qualification' && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-800">
                    Loại
                  </label>
                  <SearchableSelect
                    options={qualificationOptions}
                    value={form.type}
                    onChange={(v) =>
                      setForm((f) => ({ ...f, type: v || 'OTHER' }))
                    }
                    clearable={false}
                  />
                </div>
                {field('Tên', 'name')}
                {field('Trình độ', 'level')}
                {field('Chuyên ngành', 'major')}
                {field('Nơi cấp', 'institution')}
                {field('Số hiệu', 'certificateNumber')}
                {field('Ngày cấp', 'issuedDate', { date: true })}
                {field('Hiệu lực từ', 'effectiveFrom', { date: true })}
                {field('Ngày hết hạn', 'expiryDate', { date: true })}
                {field('Xếp loại', 'grade')}
              </div>
            )}
            {editingDocumentType && !isPhoto && (
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-800">
                  Ngày hết hạn CCCD
                </label>
                <DatePickerInput
                  value={expiry}
                  onChange={setExpiry}
                  placeholder="dd/mm/yyyy"
                />
              </div>
            )}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-800">
                {editingDocumentType ? 'Tệp' : 'Tệp đính kèm (không bắt buộc)'}
                <span className="ml-1 font-normal text-slate-400">
                  {isPhoto
                    ? 'PNG, JPEG, WEBP, tối đa 10 MB'
                    : 'PDF, PNG, JPEG, WEBP, tối đa 10 MB'}
                </span>
              </label>
              <input
                type="file"
                accept={
                  isPhoto
                    ? 'image/png,image/jpeg,image/webp,.jfif'
                    : 'application/pdf,image/png,image/jpeg,image/webp,.jfif'
                }
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-xs"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={close} disabled={busy}>
              Hủy
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? 'Đang lưu' : 'Lưu'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
