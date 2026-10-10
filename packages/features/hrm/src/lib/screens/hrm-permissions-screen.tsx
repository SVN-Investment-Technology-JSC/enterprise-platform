'use client';
import { useEffect, useState } from 'react';
import { Table } from 'antd';
import { Shield, Search, ExternalLink, CheckCircle2, Lock, Loader2 } from 'lucide-react';
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
import { Badge } from '../ui/badge';
import { Button, buttonVariants } from '../ui/button';
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

  const normalize = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .toLowerCase();

  const rows = HRM_PERMISSION_ACTIONS.filter(
    (a) =>
      (!group || a.group === group) &&
      normalize(a.key + ' ' + a.label).includes(normalize(search)),
  );

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Shield className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Quyền và vai trò
            </h1>
            <p className="text-xs text-slate-500 max-w-[85ch]">
              Quản trị tenant ghép hành động thành bộ quyền, gán bộ quyền vào vai trò và cấp module HRM cho vai trò người dùng.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {tenantAdmin.checked && tenantAdmin.admin !== false ? (
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
                className="h-9 text-xs gap-1.5 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 shadow-xs"
              >
                {seeding ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {seeding ? 'Đang tạo...' : 'Tạo vai trò mẫu HRM'}
              </Button>
            </Popconfirm>
          ) : null}
          {tenantAdmin.checked && tenantAdmin.admin !== false ? (
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
                className="h-9 text-xs gap-1.5 border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 shadow-xs"
              >
                Đồng bộ vai trò mẫu
              </Button>
            </Popconfirm>
          ) : null}
          <a
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'h-9 text-xs gap-1.5 text-slate-700 shadow-xs',
            )}
            href="/authorization"
          >
            <span>Mở phân quyền ERP</span>
            <ExternalLink className="size-3.5 text-slate-500" />
          </a>
        </div>
      </div>

      {seedMessage ? (
        <div
          role={seedError ? 'alert' : 'status'}
          className={cn(
            'rounded-lg border bg-white px-4 py-2 text-xs',
            seedError ? 'border-red-200 text-red-700' : 'border-slate-200 text-slate-700',
          )}
        >
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
        </div>
      ) : null}

      {/* 2. Filter Bar */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <Input
            aria-label="Tìm quyền"
            placeholder="Tìm theo mã hoặc tên hành động..."
            className="pl-9 text-xs h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-64">
          <SearchableSelect
            value={group}
            onChange={(v) => setGroup(v || '')}
            placeholder="Tất cả nhóm quyền"
            clearable
            options={[
              ...new Set(HRM_PERMISSION_ACTIONS.map((a) => a.group)),
            ].map((value) => ({ value, label: value }))}
          />
        </div>
      </div>

      {/* 3. Permissions Table Card */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-xs p-5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Danh sách hành động bảo mật ({rows.length})
          </span>
        </div>
        <Table
          size="small"
          rowKey="key"
          dataSource={rows}
          pagination={{
            pageSize: 25,
            showSizeChanger: true,
            showTotal: (total, range) => `Hiển thị ${range[0]}–${range[1]} / ${total} hành động`,
          }}
          scroll={{ x: 1200, y: 560 }}
          columns={[
            {
              title: 'Nhóm chức năng',
              dataIndex: 'group',
              width: 160,
              render: (v) => <span className="font-semibold text-slate-900">{v}</span>,
            },
            {
              title: 'Mã hành động bảo mật',
              dataIndex: 'key',
              width: 220,
              render: (v) => (
                <code className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded text-blue-700 border border-slate-200">
                  {v}
                </code>
              ),
            },
            {
              title: 'Đầu ra & Hành động được phép',
              width: 320,
              dataIndex: 'label',
              render: (v) => <span className="text-xs text-slate-700">{v}</span>,
            },
            {
              title: 'Vai trò mẫu chứa hành động này',
              width: 260,
              render: (_, r) => {
                const names = TEMPLATES_BY_ACTION.get(r.key) ?? [];
                return names.length ? (
                  <span className="text-xs text-slate-700">{names.join(', ')}</span>
                ) : (
                  <span className="text-xs text-slate-400">Không có</span>
                );
              },
            },
            {
              title: 'Tài khoản của bạn',
              width: 170,
              render: (_, r) =>
                can(r.key) ? (
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs flex items-center gap-1">
                    <CheckCircle2 className="size-3 text-emerald-600" />
                    <span>Đã cấp quyền</span>
                  </Badge>
                ) : (
                  <Badge className="bg-slate-100 text-slate-500 border-slate-200 text-xs flex items-center gap-1">
                    <Lock className="size-3 text-slate-400" />
                    <span>Chưa cấp</span>
                  </Badge>
                ),
            },
          ]}
        />
      </section>
    </div>
  );
}
