'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Calculator,
  History,
  Layers,
  Plane,
  ShieldCheck,
  UserCog,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { hrmFetch, hrmEmployeeOptions } from '../hrm-api';
import { toast } from '../ui/toast';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import { PageTitle } from '../ui/page-title';
import { ConfigHistoryDrawer } from '../ui/config-history-drawer';
import { InfoNote, SectionTabs, kitPanelProps, type KitTab } from '../ui/settings-kit';
import { PayrollOtDialog } from '../ui/payroll-ot-dialog';
import { PayrollInputsPanel } from '../ui/payroll-inputs-panel';
import { PayrollSodCard } from '../ui/payroll-sod-card';
import { TripAllowancePanel } from '../ui/trip-allowance-panel';
import { SalaryGradesPanel } from '../ui/salary-grades-panel';
import { SalaryProfilesPanel } from '../ui/salary-profiles-panel';
import { FormulaTab } from '../ui/payroll-settings/formula-tab';
import { FormulaEditorDialog, type FormulaEditorMode } from '../ui/payroll-settings/formula-editor-dialog';
import { parameters, type Version } from '../ui/payroll-settings/types';
import { useHrmPermissions } from '../hrm-permissions';
import {
  PAYROLL_SETTINGS_TABS,
  resolvePayrollSettingsTab,
  type PayrollSettingsTabId,
} from '../hrm-navigation';

/** Liên kết cũ ?tab=policies|inputs được chuyển sang id tab mới. */
const LEGACY_TAB_IDS: Record<string, string> = {
  policies: 'formula',
  inputs: 'employee-params',
};

const TAB_ICONS: Record<PayrollSettingsTabId, LucideIcon> = {
  formula: Calculator,
  'employee-params': UserCog,
  grades: Layers,
  profiles: Wallet,
  'trip-allowance': Plane,
  sod: ShieldCheck,
};

const TAB_PREFIX = 'payroll-settings';

/** Mã hành động nhật ký của các chức năng trong màn này (hrm-audit-trail, hrm-salary, hrm-trip-allowance, payroll-sod). */
const HISTORY_PREFIXES = [
  'PAYROLL_CONFIGURATION_',
  'PAYROLL_INPUT_',
  'PAYROLL_SOD_',
  'SALARY_',
  'TRIP_ALLOWANCE_',
  'POLICY_VERSION_',
] as const;

/**
 * Lương & OT: công thức và quy định OT theo mốc hiệu lực, tham số từng nhân viên, ngạch bậc, hồ sơ lương, công tác phí và
 * tách nhiệm vụ. Mỗi tab là một nhóm chức năng (SectionTabs); `?tab=<id>` đồng bộ với địa chỉ trang.
 */
export default function PayrollSettingsScreen() {
  const { can, any } = useHrmPermissions();
  const canConfigure = can('hrm.payroll.configure');
  const [versions, setVersions] = useState<Version[]>([]);
  const [employees, setEmployees] = useState<{ value: string; label: string }[]>([]);
  const [error, setError] = useState('');
  const [action, setAction] = useState<HrmAction | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Tab navigation & URL sync (?tab=<id>); chỉ hiện tab người dùng có quyền
  const allowedTabs = PAYROLL_SETTINGS_TABS.filter((tab) => any(tab.permissions));
  const allowedTabIds = allowedTabs.map((tab) => tab.id);
  const [requestedTab, setRequestedTab] = useState<string | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const activeTab = resolvePayrollSettingsTab(requestedTab, allowedTabIds) as PayrollSettingsTabId | '';

  useEffect(() => {
    const sync = () => {
      const raw = new URLSearchParams(window.location.search).get('tab');
      setRequestedTab((raw && LEGACY_TAB_IDS[raw]) || raw);
      setUrlReady(true);
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const selectTab = useCallback((tab: PayrollSettingsTabId) => {
    setRequestedTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url);
  }, []);

  useEffect(() => {
    if (urlReady && activeTab && requestedTab !== activeTab) {
      selectTab(activeTab);
    }
  }, [activeTab, requestedTab, selectTab, urlReady]);

  const [editor, setEditor] = useState<FormulaEditorMode | null>(null);
  const [otDialog, setOtDialog] = useState<{ base?: Version; editing: boolean } | null>(null);

  const load = useCallback(async () => {
    const [v, e] = await Promise.all([
      hrmFetch<{ data: Version[] }>('/payroll-configuration'),
      hrmEmployeeOptions(),
    ]);
    setVersions(v.data);
    setEmployees(e);
  }, []);

  useEffect(() => {
    // Công thức và tham số nhân viên cần hrm.payroll.configure; người chỉ có quyền lương cơ bản không gọi các API này.
    if (!canConfigure) return;
    void load().catch((e) => setError(e.message));
  }, [load, canConfigure]);

  /**
   * Ghi xong là thành công: hộp thoại đóng ngay, danh sách tải lại riêng để lỗi tải lại
   * không giữ hộp thoại mở (bấm lưu lần nữa sẽ tạo trùng phiên bản).
   */
  async function save(path: string, body: unknown, method = 'POST') {
    await hrmFetch(path, { method, body: JSON.stringify(body) });
    toast.success('Đã lưu thay đổi');
    void load().catch((e) =>
      setError(
        `Đã lưu nhưng không tải lại được danh sách: ${e instanceof Error ? e.message : 'lỗi không xác định'}`,
      ),
    );
  }

  function editVersion(v: Version, clone = false) {
    setError('');
    setEditor({ kind: clone ? 'clone' : 'edit', version: v });
  }

  function endVersion(v: Version, remove = false) {
    setAction({
      title: remove ? 'Xóa phiên bản chưa sử dụng' : 'Kết thúc hiệu lực phiên bản',
      confirmTitle: remove ? 'Xóa phiên bản chưa được sử dụng?' : 'Kết thúc hiệu lực theo ngày đã chọn?',
      description: remove
        ? 'Chỉ xóa được phiên bản mới nhất, chưa có hiệu lực và chưa được kỳ lương tham chiếu. Phiên bản liền trước sẽ được mở lại.'
        : 'Phiên bản đã được tính lương hoặc tham chiếu nghiệp vụ được giữ lại để đối soát.',
      fields: [
        ...(!remove ? [{ key: 'effectiveTo', label: 'Ngày hiệu lực cuối', type: 'date' as const }] : []),
        { key: 'reason', label: 'Lý do' },
      ],
      submit: (values) =>
        save(
          `/payroll-configuration/${v.id}${remove ? '' : '/deactivate'}`,
          { ...values, expectedUpdatedAt: v.updated_at },
          remove ? 'DELETE' : 'POST',
        ),
    });
  }

  const tabs: KitTab[] = allowedTabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    icon: TAB_ICONS[tab.id],
  }));

  // Tab chỉ xem: Ngạch và bậc, Hồ sơ lương khi không có quyền quản lý lương cơ bản.
  const readOnly = (activeTab === 'grades' || activeTab === 'profiles') && !can('hrm.salary.manage');

  const panel = (id: PayrollSettingsTabId, content: ReactNode) => (
    <div key={id} {...kitPanelProps(TAB_PREFIX, id)} hidden={activeTab !== id} className="space-y-4">
      {activeTab === id ? content : null}
    </div>
  );

  return (
    <div className="@container mx-auto max-w-[1400px] space-y-4">
      <PageTitle
        title="Lương & OT"
        description="Cấu hình công thức lương, OT, phụ cấp và các khoản chi trả."
        badge={
          readOnly ? (
            <Badge variant="outline" className="h-7 border-slate-200 bg-slate-100 px-3 text-xs text-slate-600">
              Chỉ xem
            </Badge>
          ) : null
        }
        actions={
          can('hrm.audit.read') ? (
            <Button type="button" variant="outline" onClick={() => setHistoryOpen(true)} className="h-9 gap-1.5 px-3 text-xs font-semibold">
              <History className="size-4" />
              Lịch sử thay đổi
            </Button>
          ) : null
        }
      />

      {error && (
        <InfoNote tone="red" role="alert">
          {error}
        </InfoNote>
      )}

      {allowedTabs.length === 0 ? (
        <div role="alert" className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Bạn không có quyền xem cấu hình lương.
        </div>
      ) : (
        <>
          <SectionTabs
            tabs={tabs}
            active={activeTab}
            onChange={(id) => selectTab(id as PayrollSettingsTabId)}
            ariaLabel="Cấu hình lương"
            idPrefix={TAB_PREFIX}
          />

          {panel(
            'formula',
            <FormulaTab
              versions={versions}
              canManage={canConfigure}
              onNewFormula={() => {
                setError('');
                setEditor({ kind: 'new' });
              }}
              onEditFormula={editVersion}
              onEditOt={(v, clone = false) => setOtDialog({ base: v, editing: !!v && !clone })}
              onEnd={endVersion}
            />,
          )}
          {panel('employee-params', <PayrollInputsPanel employees={employees} parse={parameters} />)}
          {panel('grades', <SalaryGradesPanel />)}
          {panel('profiles', <SalaryProfilesPanel />)}
          {panel('trip-allowance', <TripAllowancePanel />)}
          {panel('sod', <PayrollSodCard />)}
        </>
      )}

      {editor && <FormulaEditorDialog mode={editor} onSubmit={(path, body, method) => save(path, body, method)} onClose={() => setEditor(null)} />}

      {otDialog && (
        <PayrollOtDialog
          base={otDialog.base}
          editing={otDialog.editing}
          onSubmit={(path, body, method) => save(path, body, method)}
          onClose={() => setOtDialog(null)}
        />
      )}

      {action && <HrmActionDialog action={action} onClose={() => setAction(null)} />}

      {can('hrm.audit.read') ? (
        <ConfigHistoryDrawer
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          title="Lịch sử thay đổi cấu hình lương"
          description="Phiên bản công thức/OT, tham số nhân viên, ngạch bậc, công tác phí và tách nhiệm vụ (tối đa 100 bản ghi, mới nhất ở trên)."
          actionPrefixes={HISTORY_PREFIXES}
        />
      ) : null}
    </div>
  );
}
