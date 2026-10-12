'use client';
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, KeyRound, Loader2, Lock, Search, ShieldCheck, UsersRound } from 'lucide-react';
import {
  HRM_PERMISSION_ACTIONS,
  HRM_ROLE_TEMPLATES,
  expandTenantActions,
} from '@enterprise-platform/contracts-identity';
import { Popconfirm, SearchableSelect, authFetch } from '@enterprise-platform/shared-ui';
import { useHrmPermissions } from '../hrm-permissions';
import { platformAuthApiUrl } from '../hrm-api';
import {
  ROLE_TEMPLATE_SYNC_URL,
  ROLE_TEMPLATE_URL,
  normalizeSeedResult,
  summarizeSeedResult,
  type RoleTemplateSeedResult,
} from '../hrm-role-template-sync';
import { Input } from '../ui/input';
import { Button, buttonVariants } from '../ui/button';
import { PageTitle } from '../ui/page-title';
import { DataList, type DataColumn } from '../ui/payroll-settings/data-rows';
import { EmptyPanel, InfoNote, SettingsSection, StatusPill } from '../ui/settings-kit';
import { cn } from '../utils';

/**
 * Vai trò mẫu chứa từng hành động theo quyền hiệu lực, cùng phép mở rộng backend dùng
 * khi cấp quyền (hrm.manage gồm mọi hành động HRM, quyền thao tác kéo theo quyền xem).
 */
const TEMPLATES_BY_ACTION: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const template of HRM_ROLE_TEMPLATES)
    for (const action of expandTenantActions(template.actions))
      map.set(action, [...(map.get(action) ?? []), template.name]);
  return map;
})();

type PermissionAction = (typeof HRM_PERMISSION_ACTIONS)[number];

/** Chỉ quản trị viên tenant được tạo vai trò mẫu (backend: tenantManager). */
function useIsTenantAdmin() {
  // null: chưa xác định được; khi không đọc được phiên vẫn hiện nút, backend chặn và báo lỗi 403.
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let active = true;
    authFetch(platformAuthApiUrl('/me'), { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        const me = (await response.json()) as {
          roles?: string[];
          systemRole?: string;
        };
        return (
          me.systemRole === 'tenant-admin' ||
          (me.roles ?? []).includes('tenant-admin')
        );
      })
      .catch(() => null)
      .then((value) => {
        if (!active) return;
        setAdmin(value);
        setChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return { admin, checked };
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase();

/**
 * Quyền và vai trò: vai trò mẫu HRM (tạo, đồng bộ) và danh mục hành động bảo mật của module, kèm vai trò mẫu chứa hành động
 * đó và việc tài khoản hiện tại đã được cấp hay chưa. Phân quyền chi tiết cho người dùng làm ở màn Phân quyền của ERP.
 */
export default function HrmPermissionsScreen() {
  const { can } = useHrmPermissions();
  const tenantAdmin = useIsTenantAdmin();
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState('');
  const [seedError, setSeedError] = useState(false);
  const [seedResult, setSeedResult] = useState<RoleTemplateSeedResult | null>(null);

  /** sync=false: chỉ tạo vai trò chưa có. sync=true: đồng bộ cả vai trò đã có theo bản mẫu hiện hành. */
  async function seedTemplates(sync: boolean) {
    setSeeding(true);
    setSeedMessage('');
    setSeedError(false);
    setSeedResult(null);
    try {
      const response = await authFetch(sync ? ROLE_TEMPLATE_SYNC_URL : ROLE_TEMPLATE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? 'Chỉ quản trị viên tenant được tạo hoặc đồng bộ vai trò mẫu HRM. Liên hệ quản trị viên tenant để thực hiện.'
            : (body.message ?? 'Không thực hiện được thao tác với vai trò mẫu.'),
        );
      const result = normalizeSeedResult(body);
      setSeedResult(result);
      setSeedMessage(summarizeSeedResult(result));
    } catch (error) {
      setSeedError(true);
      setSeedMessage(error instanceof Error ? error.message : 'Không thực hiện được thao tác với vai trò mẫu.');
    } finally {
      setSeeding(false);
    }
  }

  const groups = useMemo(
    () => [...new Set(HRM_PERMISSION_ACTIONS.map((a) => a.group))].map((value) => ({ value, label: value })),
    [],
  );
  const rows = useMemo(
    () =>
      HRM_PERMISSION_ACTIONS.filter(
        (a) => (!group || a.group === group) && normalize(`${a.key} ${a.label}`).includes(normalize(search)),
      ),
    [group, search],
  );
  const granted = HRM_PERMISSION_ACTIONS.filter((a) => can(a.key)).length;

  const columns: DataColumn<PermissionAction>[] = [
    {
      key: 'group',
      header: 'Nhóm chức năng',
      width: 'minmax(0,0.9fr)',
      cardGrow: true,
      cardOrder: -1,
      cell: (r) => <span className="font-semibold text-slate-900">{r.group}</span>,
    },
    {
      key: 'key',
      header: 'Mã hành động bảo mật',
      width: 'minmax(0,1.3fr)',
      cardFull: true,
      cell: (r) => (
        <code className="inline-block max-w-full break-all rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-blue-700">
          {r.key}
        </code>
      ),
    },
    {
      key: 'label',
      header: 'Hành động được phép',
      width: 'minmax(0,1.6fr)',
      cardFull: true,
      cell: (r) => <span className="text-slate-700">{r.label}</span>,
    },
    {
      key: 'templates',
      header: 'Vai trò mẫu chứa hành động này',
      width: 'minmax(0,1.4fr)',
      cardFull: true,
      cardLabel: true,
      cell: (r) => {
        const names = TEMPLATES_BY_ACTION.get(r.key) ?? [];
        return names.length ? (
          <span className="text-slate-700">{names.join(', ')}</span>
        ) : (
          <span className="text-slate-400">Không có</span>
        );
      },
    },
    {
      key: 'mine',
      header: 'Tài khoản của bạn',
      width: '8.5rem',
      cardEnd: true,
      cardOrder: -1,
      cell: (r) =>
        can(r.key) ? (
          <StatusPill tone="green">Đã cấp quyền</StatusPill>
        ) : (
          <span className="inline-flex items-center gap-1">
            <StatusPill tone="slate">
              <Lock className="mr-1 size-3 text-slate-400" aria-hidden />
              Chưa cấp
            </StatusPill>
          </span>
        ),
    },
  ];

  const showTemplates = tenantAdmin.checked && tenantAdmin.admin !== false;

  return (
    <div className="@container mx-auto max-w-[1600px] space-y-4">
      <PageTitle
        title="Quyền và vai trò"
        description="Quản trị tenant ghép hành động thành bộ quyền, gán bộ quyền vào vai trò và cấp module HRM cho vai trò người dùng."
        actions={
          <a
            className={cn(buttonVariants({ variant: 'outline' }), 'h-9 gap-1.5 px-3 text-xs font-semibold text-slate-700')}
            href="/authorization"
          >
            <span>Mở phân quyền ERP</span>
            <ExternalLink className="size-3.5 text-slate-500" aria-hidden />
          </a>
        }
      />

      {showTemplates ? (
        <SettingsSection
          icon={UsersRound}
          tone="violet"
          title="Vai trò mẫu HRM"
          description="Bộ quyền và vai trò dựng sẵn cho module HRM (nhân viên, trưởng bộ phận, chấm công, nhân sự, lương...)."
          actions={
            <>
              <Popconfirm
                title="Tạo vai trò mẫu HRM"
                description="Tạo bộ quyền và vai trò mẫu HRM. Vai trò đã có sẽ được giữ nguyên, không bị ghi đè."
                okText="Tạo"
                cancelText="Hủy"
                okType="primary"
                placement="bottom-end"
                disabled={seeding}
                onConfirm={() => seedTemplates(false)}
              >
                <Button
                  type="button"
                  variant="outline"
                  disabled={seeding}
                  className="h-9 gap-1.5 border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  {seeding ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                  {seeding ? 'Đang tạo...' : 'Tạo vai trò mẫu HRM'}
                </Button>
              </Popconfirm>
              <Popconfirm
                title="Đồng bộ vai trò mẫu HRM"
                description="Cập nhật các vai trò mẫu ĐÃ CÓ theo bản mẫu hiện hành: quyền mới được thêm và quyền không còn trong mẫu bị GỠ khỏi vai trò, ảnh hưởng ngay tới người đang giữ vai trò đó. Các vai trò bạn đã chỉnh tay cũng bị ghi đè."
                okText="Đồng bộ"
                cancelText="Hủy"
                okType="danger"
                placement="bottom-end"
                disabled={seeding}
                onConfirm={() => seedTemplates(true)}
              >
                <Button
                  type="button"
                  variant="outline"
                  disabled={seeding}
                  className="h-9 gap-1.5 border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                >
                  Đồng bộ vai trò mẫu
                </Button>
              </Popconfirm>
            </>
          }
          bodyClassName="space-y-3"
        >
          <InfoNote tone="slate">
            Tạo chỉ thêm vai trò chưa có. Đồng bộ cập nhật cả vai trò đã có theo bản mẫu hiện hành (thêm quyền mới, gỡ quyền không còn
            trong mẫu) nên ảnh hưởng ngay tới người đang giữ vai trò.
          </InfoNote>
          {seedMessage ? (
            <InfoNote tone={seedError ? 'red' : 'green'} role={seedError ? 'alert' : 'status'}>
              <div>{seedMessage}</div>
              {seedResult && seedResult.updated.length > 0 ? (
                <ul className="mt-2 space-y-1" aria-label="Vai trò mẫu đã cập nhật">
                  {seedResult.updated.map((role) => (
                    <li key={role.name}>
                      <span className="font-semibold">{role.name}</span>
                      {role.added.length ? <span className="text-emerald-700">: thêm {role.added.join(', ')}</span> : null}
                      {role.removed.length ? <span className="text-red-700">; gỡ {role.removed.join(', ')}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </InfoNote>
          ) : null}
        </SettingsSection>
      ) : seedMessage ? (
        <InfoNote tone={seedError ? 'red' : 'green'} role={seedError ? 'alert' : 'status'}>
          {seedMessage}
        </InfoNote>
      ) : null}

      <SettingsSection
        icon={ShieldCheck}
        tone="blue"
        title="Danh sách hành động bảo mật"
        description={`${HRM_PERMISSION_ACTIONS.length} hành động của module HRM; tài khoản của bạn đang được cấp ${granted}.`}
        bodyClassName="space-y-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-56 @2xl:max-w-sm">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              aria-label="Tìm quyền"
              placeholder="Tìm theo mã hoặc tên hành động..."
              className="h-9 pl-9 text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="min-w-0 flex-1 basis-48 @2xl:w-64 @2xl:flex-none">
            <SearchableSelect
              value={group}
              onChange={(v) => setGroup(v || '')}
              placeholder="Tất cả nhóm quyền"
              clearable
              options={groups}
            />
          </div>
          <span className="text-xs text-slate-500" aria-live="polite">
            {rows.length} hành động
          </span>
        </div>
        <DataList
          label="Danh sách hành động bảo mật"
          rows={rows}
          columns={columns}
          rowKey={(r) => r.key}
          pageSize={20}
          empty={
            <EmptyPanel icon={KeyRound} title="Không có hành động nào khớp" description="Thử đổi từ khóa hoặc nhóm quyền." />
          }
        />
      </SettingsSection>
    </div>
  );
}
