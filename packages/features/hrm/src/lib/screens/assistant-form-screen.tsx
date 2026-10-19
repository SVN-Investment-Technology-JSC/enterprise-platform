'use client';
import { HRM_ASSISTANT_ACTIONS, type HrmRequestType } from '@enterprise-platform/contracts-hrm';
import {
  AssistantFormHost,
  useAssistantAction,
  type AssistantActionContext,
} from '@enterprise-platform/feature-module-shell';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  assistantRequestPatch,
  type AssistantRequestKind,
  type RequestFormPatch,
} from '../assistant-request-draft';
import { hrmApiUrl } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import {
  leaveBalancesOf,
  selectableLeaveTypesOf,
  type LeaveBalanceRow,
  type LeaveTypeItem,
  type ShiftItem,
} from '../request-form-model';
import {
  CreateRequestForm,
  requestCatalogOf,
  type CatalogCard,
  type RequestFormData,
  type RequestFormProfile,
  type RequestFormUpdate,
} from '../ui/create-request-form';
import { loadLinkableProjects } from '../workspace-projects';

/** Dữ liệu form tạo đơn của người đang đăng nhập; `error` khi không lập được đơn (chưa liên kết nhân viên...). */
interface FormSource {
  readonly status: 'loading' | 'ready' | 'error';
  readonly error: string;
  readonly data: RequestFormData;
  readonly requestTypes: HrmRequestType[];
}

const EMPTY_DATA: RequestFormData = {
  employeeId: '',
  profile: {},
  leaveTypes: [],
  shifts: [],
  projects: [],
  leaveBalances: {},
  loading: false,
};

/** Danh sách `data` của một GET HRM; lỗi thì rỗng, như trang Đơn từ. */
async function listOf<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(hrmApiUrl(path), { credentials: 'same-origin' });
    if (!res.ok) return [];
    const payload = (await res.json()) as { data?: unknown } | null;
    return Array.isArray(payload?.data) ? (payload.data as T[]) : [];
  } catch {
    return [];
  }
}

/** Hồ sơ của người dùng và các danh mục form tạo đơn cần (loại nghỉ, ca, dự án, quỹ phép, loại đơn). */
async function loadFormSource(): Promise<Omit<FormSource, 'status' | 'error'>> {
  const res = await fetch(hrmApiUrl('/my-profile'), { credentials: 'same-origin' });
  const payload = (await res.json().catch(() => null)) as {
    data?: RequestFormProfile;
    message?: string;
  } | null;
  if (!res.ok) throw new Error(payload?.message || 'Không thể tải hồ sơ nhân viên.');
  const profile: RequestFormProfile = payload?.data ?? {};
  const employeeId = typeof profile.employeeId === 'string' ? profile.employeeId : '';
  if (!employeeId) throw new Error('Tài khoản chưa liên kết hồ sơ nhân viên.');
  const [projects, leaveTypes, shifts, balances, requestTypes] = await Promise.all([
    loadLinkableProjects(),
    listOf<LeaveTypeItem>('/leave-types?active=true'),
    listOf<ShiftItem>('/shifts?status=ACTIVE'),
    listOf<LeaveBalanceRow>(`/employees/${employeeId}/leave-balances`),
    listOf<HrmRequestType>('/request-types'),
  ]);
  return {
    data: {
      employeeId,
      profile,
      leaveTypes,
      shifts,
      projects,
      leaveBalances: leaveBalancesOf(balances),
      loading: false,
    },
    requestTypes,
  };
}

function useFormSource(): FormSource {
  const [source, setSource] = useState<FormSource>({
    status: 'loading',
    error: '',
    data: EMPTY_DATA,
    requestTypes: [],
  });
  useEffect(() => {
    let active = true;
    loadFormSource().then(
      (loaded) => {
        if (active) setSource({ status: 'ready', error: '', ...loaded });
      },
      (error: unknown) => {
        if (active)
          setSource({
            status: 'error',
            error:
              error instanceof Error && error.message
                ? error.message
                : 'Không thể tải hồ sơ nhân viên.',
            data: EMPTY_DATA,
            requestTypes: [],
          });
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return source;
}

/** Bản nháp của Trợ lý đến khi quyền, hồ sơ, danh mục chưa tải xong. */
interface PendingDraft {
  kind: AssistantRequestKind;
  draft: Record<string, unknown>;
  context: AssistantActionContext;
}

/** Form đang mở trong card: loại đơn đã chọn và giá trị điền sẵn từ bản nháp. */
interface OpenForm {
  readonly kind: AssistantRequestKind;
  readonly card: CatalogCard;
  readonly initial: RequestFormPatch;
  readonly context: AssistantActionContext;
}

/**
 * Bốn thao tác Trợ lý của HRM (nghỉ phép, làm thêm giờ, công tác, loại đơn của công ty) mở chính form tạo đơn của trang
 * Đơn từ ngay trong card, điền sẵn từ bản nháp. Người nộp đơn luôn là người đang đăng nhập.
 */
function AssistantRequestForms() {
  const { can, loading: permissionsLoading, error: permissionsError } = useHrmPermissions();
  const source = useFormSource();
  const pending = useRef<PendingDraft | null>(null);
  const [pendingTick, setPendingTick] = useState(0);
  const openRef = useRef<OpenForm | null>(null);
  const [open, setOpen] = useState<OpenForm | null>(null);
  const [update, setUpdate] = useState<RequestFormUpdate>();
  // Đã báo kết quả về card (card đóng form): bỏ qua bản nháp đến sau; còn lời báo thì hiện lại tại chỗ.
  const [finished, setFinished] = useState<{ message: string } | null>(null);
  const finishedRef = useRef(false);

  const draftContext = (customType: HrmRequestType | null) => ({
    leaveTypeIds: selectableLeaveTypesOf(source.data.leaveTypes).map((t) => t.id),
    projects: source.data.projects,
    customType,
  });

  const finish = (message = '') => {
    finishedRef.current = true;
    openRef.current = null;
    setOpen(null);
    setFinished({ message });
  };

  const receive =
    (kind: AssistantRequestKind) =>
    (draft: Partial<Record<string, unknown>>, context: AssistantActionContext) => {
      if (finishedRef.current) return;
      const current = openRef.current;
      // Trợ lý sửa tiếp đúng yêu cầu đang mở: form chỉ cập nhật các ô có trong bản nháp mới.
      if (current?.context.requestId === context.requestId) {
        const customType = current.card.customType;
        setUpdate((prev) => ({
          seq: (prev?.seq ?? 0) + 1,
          patch: (values) =>
            assistantRequestPatch(current.kind, draft, {
              current: values,
              ...draftContext(customType),
            }),
        }));
        return;
      }
      const queued = pending.current;
      if (queued?.context.requestId === context.requestId) {
        queued.draft = { ...queued.draft, ...draft };
      } else {
        queued?.context.report('cancelled');
        pending.current = { kind, draft, context };
      }
      setPendingTick((tick) => tick + 1);
    };
  useAssistantAction(HRM_ASSISTANT_ACTIONS.createLeaveRequest.key, receive('leave'));
  useAssistantAction(HRM_ASSISTANT_ACTIONS.createOtRequest.key, receive('ot'));
  useAssistantAction(HRM_ASSISTANT_ACTIONS.createBusinessTripRequest.key, receive('business_trip'));
  useAssistantAction(HRM_ASSISTANT_ACTIONS.createCustomRequest.key, receive('custom'));

  useEffect(() => {
    const job = pending.current;
    if (!job || permissionsLoading || source.status === 'loading') return;
    pending.current = null;
    const unavailable = (message: string) => {
      finish(message);
      job.context.report('unavailable', { message });
    };
    if (permissionsError) {
      unavailable(permissionsError);
      return;
    }
    if (!can('hrm.self.request')) {
      unavailable('Tài khoản không có quyền tạo đơn từ.');
      return;
    }
    if (source.status === 'error') {
      unavailable(source.error);
      return;
    }
    const catalog = requestCatalogOf(source.requestTypes);
    const card =
      job.kind === 'custom'
        ? catalog.find((c) => c.customType && c.customType.id === job.context.variant)
        : catalog.find((c) => c.id === job.kind && !c.customType);
    if (!card) {
      unavailable(
        job.kind === 'custom'
          ? 'Không tìm thấy loại đơn này hoặc loại đơn đã ngừng sử dụng.'
          : 'Loại đơn này đang tắt trong cấu hình của công ty.',
      );
      return;
    }
    openRef.current?.context.report('cancelled');
    const next: OpenForm = {
      kind: job.kind,
      card,
      initial: assistantRequestPatch(job.kind, job.draft, {
        current: null,
        ...draftContext(card.customType),
      }),
      context: job.context,
    };
    openRef.current = next;
    setUpdate(undefined);
    setOpen(next);
    // Chạy khi có bản nháp mới hoặc quyền, dữ liệu vừa tải xong; hàm đọc state của lần render này.
  }, [pendingTick, permissionsLoading, source.status]);

  if (open) {
    const { card, context } = open;
    return (
      <CreateRequestForm
        key={context.requestId}
        kind={card.id}
        title={card.title}
        customType={card.customType}
        data={source.data}
        initial={open.initial}
        update={update}
        onCancel={() => {
          finish();
          context.report('cancelled');
        }}
        onSubmitted={({ id, label }) => {
          finish();
          context.report('saved', {
            ...(id ? { id, href: `/modules/hrm/requests?request=${encodeURIComponent(id)}` } : {}),
            label,
          });
        }}
        onAbandoned={(message) => {
          finish(message);
          context.report('failed', { message });
        }}
      />
    );
  }
  if (finished)
    return finished.message ? (
      <p
        role="alert"
        className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
      >
        {finished.message}
      </p>
    ) : null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Đang tải
    </div>
  );
}

/**
 * Trang form nhúng của HRM (`/modules/hrm/assistant/form?key=<thao tác>&rid=<requestId>`) mà card trong khung chat
 * Trợ lý đặt trong iframe cùng tên miền: chỉ có form tạo đơn, hiện ngay tại chỗ, không có khung điều hướng HRM.
 */
export function HrmAssistantFormPage() {
  return (
    <AssistantFormHost>
      <AssistantRequestForms />
    </AssistantFormHost>
  );
}
