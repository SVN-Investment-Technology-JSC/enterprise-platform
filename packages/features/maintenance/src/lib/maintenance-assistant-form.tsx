'use client';

import type {
  CreateMaintenanceIncidentRequest,
  MaintenanceMatrix,
  MaintenanceOccurrence,
} from '@enterprise-platform/contracts-maintenance';
import { MAINTENANCE_ASSISTANT_ACTIONS } from '@enterprise-platform/contracts-maintenance';
import {
  AssistantFormHost,
  useAssistantAction,
  type AssistantActionContext,
} from '@enterprise-platform/feature-module-shell';
import { useEffect, useState } from 'react';
import { incidentDraftToFormValues, type IncidentFormValues } from './assistant-incident-draft';
import { IncidentForm } from './components/incident-form';
import {
  createMaintenanceIncident,
  loadAssistantActionKeys,
  loadMaintenanceMatrix,
  loadTenantMembers,
  uploadOccurrenceAttachment,
} from './maintenance-api';
import styles from './maintenance-assistant-form.module.scss';

const CREATE_INCIDENT = MAINTENANCE_ASSISTANT_ACTIONS.createIncident.key;

/**
 * Trang form nhúng của Bảo trì (`/modules/maintenance/assistant/form`). Card Trợ lý trong khung chat đặt trang này
 * trong iframe: chính form "Tạo sự cố" của màn Phiếu phát sinh hiện ngay trong card, điền sẵn bản nháp, lưu bằng API
 * của Bảo trì. Trang ERP phía sau không chuyển trang.
 */
export function MaintenanceAssistantFormPage() {
  return (
    <AssistantFormHost>
      <IncidentAssistantForm />
    </AssistantFormHost>
  );
}

/** Những gì form "Tạo sự cố" cần: thiết bị và quy trình xử lý (ma trận), người phụ trách, quyền ghi nhận sự cố. */
interface IncidentFormData {
  readonly matrix: MaintenanceMatrix;
  readonly members: readonly { userId: string; displayName: string }[];
  readonly allowed: boolean;
}

type Draft = Readonly<Record<string, unknown>>;

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function IncidentAssistantForm() {
  const [data, setData] = useState<IncidentFormData>();
  const [loadError, setLoadError] = useState<string>();
  const [request, setRequest] = useState<AssistantActionContext>();
  /** Bản nháp nhận từ card, chờ danh mục nạp xong mới đổi thành giá trị form (cần danh mục để kiểm mã). */
  const [drafts, setDrafts] = useState<readonly Draft[]>([]);
  /** Giá trị điền sẵn; `revision` tăng mỗi lần Trợ lý sửa tiếp, form chỉ ghi đè các ô có trong lần sửa đó. */
  const [prefill, setPrefill] = useState<{
    readonly revision: number;
    readonly values: IncidentFormValues;
  }>();
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [savedLabel, setSavedLabel] = useState<string>();
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([loadMaintenanceMatrix(), loadTenantMembers(), loadAssistantActionKeys()])
      .then(([matrix, members, keys]) => {
        if (active) setData({ matrix, members, allowed: keys.has(CREATE_INCIDENT) });
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(messageOf(cause, 'Không tải được dữ liệu bảo trì.'));
      });
    return () => {
      active = false;
    };
  }, []);

  useAssistantAction(CREATE_INCIDENT, (draft, context) => {
    setRequest(context);
    setDrafts((list) => [...list, draft]);
  });

  const problem =
    loadError ?? (data && !data.allowed ? 'Bạn không có quyền tạo sự cố bảo trì.' : undefined);

  // Không mở được form: báo về card (card hiện lý do), không để người dùng nhập rồi mới bị chặn lúc lưu.
  useEffect(() => {
    if (request && problem) request.report('unavailable', { message: problem });
  }, [request, problem]);

  useEffect(() => {
    if (!data?.allowed || drafts.length === 0) return;
    setDrafts([]);
    const options = {
      assetCodes: data.matrix.rows.map((row) => row.asset.code),
      procedureDefinitionIds: data.matrix.procedureCatalog.map((entry) => entry.definitionId),
      memberIds: data.members.map((member) => member.userId),
    };
    const values = drafts.reduce<IncidentFormValues>(
      (merged, draft) => ({ ...merged, ...incidentDraftToFormValues(draft, options) }),
      {},
    );
    setPrefill((current) => ({ revision: current ? current.revision + 1 : 0, values }));
  }, [data, drafts]);

  const cancel = () => {
    request?.report('cancelled');
    setClosed(true);
  };

  const submit = async (input: CreateMaintenanceIncidentRequest, files: File[] = []) => {
    setBusy(true);
    setSaveError(undefined);
    let created: MaintenanceOccurrence;
    try {
      created = await createMaintenanceIncident(input);
    } catch (cause) {
      // Form vẫn mở với những gì đã nhập để sửa rồi lưu lại.
      setSaveError(messageOf(cause, 'Không tạo được sự cố.'));
      setBusy(false);
      return;
    }
    // Tải tệp xong mới báo kết quả: card gỡ trang form ngay khi nhận kết quả, tệp đang tải dở sẽ bị cắt.
    const uploads = await Promise.allSettled(
      files.map((file) => uploadOccurrenceAttachment(created.id, file)),
    );
    const failed = uploads.filter((upload) => upload.status === 'rejected').length;
    const label = created.code ? `${created.code} · ${created.title}` : created.title;
    request?.report('saved', {
      id: created.id,
      label,
      href: `/modules/maintenance#history/${encodeURIComponent(created.id)}`,
      ...(failed > 0
        ? { message: `Đã tạo sự cố nhưng ${failed} tệp đính kèm chưa tải lên được.` }
        : {}),
    });
    setSavedLabel(label);
    setBusy(false);
  };

  if (closed) return null;
  if (savedLabel)
    return (
      <p role="status" className={styles.status}>
        Đã tạo sự cố {savedLabel}.
      </p>
    );
  if (problem)
    return (
      <p role="alert" className={styles.problem}>
        {problem}
      </p>
    );
  if (!data || !prefill)
    return (
      <p role="status" className={styles.status}>
        Đang tải…
      </p>
    );

  return (
    <IncidentForm
      assets={data.matrix.rows}
      catalog={data.matrix.procedureCatalog}
      members={data.members}
      busy={busy}
      error={saveError}
      onCancel={cancel}
      onSubmit={submit}
      initialValues={prefill.values}
      initialValuesRevision={prefill.revision}
    />
  );
}
