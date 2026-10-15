'use client';

import type { ProcedureWorkspace } from '@enterprise-platform/contracts-procedure-engine';
import {
  BarChart,
  DonutChart,
  type DashboardCardCatalog,
} from '@enterprise-platform/feature-module-shell';
import { formatDate } from '@enterprise-platform/shared-ui';
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  FileCheck,
  FileEdit,
  GitBranch,
  PlayCircle,
  XCircle,
} from 'lucide-react';
import { evaluateInstanceSla } from '@enterprise-platform/contracts-procedure-engine';
import { useState, type ReactNode } from 'react';
import { SlaBadge } from './components/sla-badge';
import styles from './components/procedure-engine.module.scss';

/**
 * Dữ liệu chung cho mọi thẻ.
 *
 * Một object cho tất cả: module nạp một lần rồi mọi thẻ đọc từ đó, nên bật thêm
 * thẻ không sinh thêm request.
 */
export interface ProcedureDashboardData {
  readonly workspace: ProcedureWorkspace;
}

/** Các trạng thái hồ sơ, thứ tự và màu cố định để chú giải không đổi chỗ khi số đổi. */
const STATUS_SLICES = [
  { status: 'running', label: 'Đang xử lý', color: '#2f6fed' },
  { status: 'completed', label: 'Hoàn thành', color: '#16845e' },
  { status: 'rejected', label: 'Từ chối', color: '#b23b3b' },
  { status: 'cancelled', label: 'Đã huỷ', color: '#8494a8' },
  { status: 'reversed', label: 'Đã huỷ hiệu lực', color: '#8a5a1f' },
] as const;

const SLA_SLICES = [
  { state: 'ok', label: 'Còn hạn', color: '#16845e' },
  { state: 'warning', label: 'Sắp hết hạn', color: '#e0a83a' },
  { state: 'breached', label: 'Quá hạn', color: '#b23b3b' },
  { state: 'none', label: 'Không cài SLA', color: '#8494a8' },
] as const;

const STAGE_LABEL: Record<string, string> = {
  S: 'S · Khởi tạo',
  R: 'R · Xem xét',
  E: 'E · Thực thi',
  C: 'C · Kiểm soát',
  A: 'A · Phê duyệt',
  I: 'I · Thông tin',
};

/**
 * Thẻ "Hồ sơ theo trạng thái".
 *
 * Thẻ này đứng cạnh "Việc cần làm" nên bị kéo cao theo danh sách đó; thay vì để
 * trống, phần dưới vòng tròn trả lời hai câu hỏi đi liền với "bao nhiêu đang
 * chạy": bao nhiêu đang quá hạn, và đang kẹt ở vai nào. Mọi số đều tính từ
 * danh sách hồ sơ đã nạp, không gọi thêm API.
 */
function StatusCard({ workspace }: { workspace: ProcedureWorkspace }) {
  const byStatus = new Map<string, number>();
  const bySla = new Map<string, number>();
  const byStage = new Map<string, number>();
  for (const instance of workspace.instances) {
    byStatus.set(instance.status, (byStatus.get(instance.status) ?? 0) + 1);
    if (instance.status !== 'running') continue;
    const sla = evaluateInstanceSla(instance).state;
    bySla.set(sla, (bySla.get(sla) ?? 0) + 1);
    const stage = instance.authorization?.currentRoleStage ?? '—';
    byStage.set(stage, (byStage.get(stage) ?? 0) + 1);
  }
  const running = byStatus.get('running') ?? 0;
  const slaSlices = SLA_SLICES.map((slice) => ({ ...slice, value: bySla.get(slice.state) ?? 0 })).filter(
    (slice) => slice.value > 0,
  );

  return (
    <div className={styles.dashStatus}>
      <DonutChart
        unit="hồ sơ"
        emptyHint="Chưa có hồ sơ nào."
        showEmpty
        slices={STATUS_SLICES.map((slice) => ({
          label: slice.label,
          color: slice.color,
          value: byStatus.get(slice.status) ?? 0,
        }))}
      />
      {running > 0 ? (
        <>
          <section className={styles.dashStatusSection}>
            <h3>{running} hồ sơ đang xử lý · theo hạn SLA</h3>
            <div className={styles.dashStatusBar} role="img" aria-label="Hồ sơ đang xử lý theo hạn SLA">
              {slaSlices.map((slice) => (
                <span
                  key={slice.state}
                  style={{ width: `${(slice.value / running) * 100}%`, background: slice.color }}
                  title={`${slice.label}: ${slice.value}`}
                />
              ))}
            </div>
            <ul className={styles.dashStatusKeys}>
              {slaSlices.map((slice) => (
                <li key={slice.state}>
                  <i style={{ background: slice.color }} aria-hidden="true" />
                  {slice.label} <b>{slice.value}</b>
                </li>
              ))}
            </ul>
          </section>
          <section className={styles.dashStatusSection}>
            <h3>Đang chờ vai nào</h3>
            <BarChart
              emptyHint="Không có hồ sơ nào đang chạy."
              slices={[...byStage.entries()].map(([stage, value]) => ({
                label: STAGE_LABEL[stage] ?? stage,
                value,
              }))}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}

function Metric(props: {
  value: number | string;
  icon: ReactNode;
  tone?: 'amber' | 'blue' | 'green' | 'red' | 'indigo' | 'slate';
  hint?: string;
}) {
  const tone = props.tone ?? 'blue';
  const toneClass =
    tone === 'amber'
      ? styles.dashToneAmber
      : tone === 'green'
      ? styles.dashToneGreen
      : tone === 'red'
      ? styles.dashToneRed
      : tone === 'indigo'
      ? styles.dashToneIndigo
      : tone === 'slate'
      ? styles.dashToneSlate
      : styles.dashToneBlue;

  return (
    <div className={`${styles.dashMetricBox} ${toneClass}`}>
      <div className={styles.dashMetricMain}>
        <p className={styles.dashValue}>
          <strong>{props.value}</strong>
        </p>
        {props.hint ? <p className={styles.dashMetricHint}>{props.hint}</p> : null}
      </div>
      <div className={styles.dashIconWrapper}>
        {props.icon}
      </div>
    </div>
  );
}

/** Đường mở thẳng một hồ sơ ở trang Hồ sơ xử lý của module. */
function caseHref(instanceId: string): string {
  return `#workspace/${encodeURIComponent(instanceId)}`;
}

/** Hồ sơ đang chờ chính người đang đăng nhập xử lý. */
function actionableInstances(data: ProcedureDashboardData) {
  return data.workspace.instances.filter(
    (instance) =>
      instance.status === 'running' &&
      (instance.authorization?.availableActions ?? []).some((action) => action !== 'comment'),
  );
}

/**
 * Mười thẻ dựng sẵn; admin bật một tập con trong mục Cài đặt.
 *
 * `id` được lưu vào cấu hình của tenant nên không bao giờ đổi tên — chỉ ngừng
 * dùng. Bốn thẻ `defaultEnabled` là những con số một người xử lý hồ sơ cần thấy
 * đầu tiên khi mở module.
 */
export const PROCEDURE_DASHBOARD_CARDS: DashboardCardCatalog<ProcedureDashboardData> = [
  {
    id: 'metric.actionable',
    title: 'Chờ tôi xử lý',
    description: 'Hồ sơ đang chạy mà bạn có quyền thao tác ở bước hiện tại.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => {
      const count = actionableInstances(data).length;
      return (
        <Metric
          value={count}
          icon={<Clock size={20} strokeWidth={2.2} />}
          tone={count > 0 ? 'amber' : 'slate'}
        />
      );
    },
  },
  {
    id: 'metric.running',
    title: 'Hồ sơ đang chạy',
    description: 'Tổng số hồ sơ chưa kết thúc mà bạn tham gia.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => (
      <Metric
        value={data.workspace.instances.filter((item) => item.status === 'running').length}
        icon={<PlayCircle size={20} strokeWidth={2.2} />}
        tone="blue"
      />
    ),
  },
  {
    id: 'metric.completed',
    title: 'Đã hoàn thành',
    description: 'Hồ sơ đã đóng thành công.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => (
      <Metric
        value={data.workspace.instances.filter((item) => item.status === 'completed').length}
        icon={<CheckCircle2 size={20} strokeWidth={2.2} />}
        tone="green"
      />
    ),
  },
  {
    id: 'metric.publishedDefinitions',
    title: 'Quy trình đã công bố',
    description: 'Số quy trình sẵn sàng mở hồ sơ. Chỉ người thiết kế mới thấy con số này.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => (
      <Metric
        value={data.workspace.definitions.filter((item) => item.status === 'published').length}
        icon={<FileCheck size={20} strokeWidth={2.2} />}
        tone="indigo"
      />
    ),
  },
  {
    id: 'metric.draftDefinitions',
    title: 'Quy trình còn nháp',
    description: 'Bản nháp chưa công bố nên chưa mở được hồ sơ.',
    size: 'sm',
    render: (data) => {
      const drafts = data.workspace.definitions.filter((item) => item.status === 'draft').length;
      return (
        <Metric
          value={drafts}
          icon={<FileEdit size={20} strokeWidth={2.2} />}
          tone={drafts > 0 ? 'amber' : 'slate'}
        />
      );
    },
  },
  {
    id: 'metric.rejected',
    title: 'Hồ sơ bị từ chối',
    description: 'Hồ sơ kết thúc ở trạng thái từ chối.',
    size: 'sm',
    render: (data) => (
      <Metric
        value={data.workspace.instances.filter((item) => item.status === 'rejected').length}
        icon={<XCircle size={20} strokeWidth={2.2} />}
        tone="red"
      />
    ),
  },
  {
    id: 'list.actionable',
    title: 'Việc cần làm',
    description: 'Năm hồ sơ đang chờ bạn thao tác, kèm bước hiện tại.',
    size: 'md',
    defaultEnabled: true,
    render: (data) => {
      const rows = actionableInstances(data).slice(0, 5);
      if (rows.length === 0) {
        return <p className={styles.dashEmpty}>Không có hồ sơ nào chờ bạn.</p>;
      }
      return (
        <ul className={styles.dashList}>
          {rows.map((instance) => {
            const current = instance.steps.find((step) => step.id === instance.currentStepId);
            return (
              <li key={instance.id} className={styles.dashLinkRow}>
                <a className={styles.dashTodo} href={caseHref(instance.id)} title="Mở hồ sơ để xử lý">
                  <span className={styles.dashTodoTitle}>{instance.title}</span>
                  <SlaBadge view={evaluateInstanceSla(instance)} />
                  <span className={styles.dashTodoMeta}>
                    <span className={styles.dashMono}>{instance.code}</span>
                    {current ? ` · Bước ${current.order}: ${current.name}` : ''}
                  </span>
                  <small className={styles.dashListRole}>
                    {instance.authorization?.currentRoleStage ? `Vai ${instance.authorization.currentRoleStage}` : '—'}
                  </small>
                </a>
              </li>
            );
          })}
        </ul>
      );
    },
  },
  {
    id: 'list.recent',
    title: 'Hồ sơ gần đây',
    description: 'Năm hồ sơ mới mở gần nhất.',
    size: 'md',
    render: (data) => {
      const rows = data.workspace.instances.slice(0, 5);
      if (rows.length === 0) return <p className={styles.dashEmpty}>Chưa có hồ sơ nào.</p>;
      return (
        <ul className={styles.dashList}>
          {rows.map((instance) => (
            <li key={instance.id} className={styles.dashLinkRow}>
              <a className={styles.dashRecent} href={caseHref(instance.id)} title="Mở hồ sơ">
                <span>{instance.title}</span>
                <small>{formatDate(instance.startedAt)}</small>
              </a>
            </li>
          ))}
        </ul>
      );
    },
  },
  {
    id: 'list.bySource',
    title: 'Hồ sơ theo nguồn mở',
    description: 'Phân bố hồ sơ: mở tay, sinh từ Bảo trì, hay tự mở từ quy trình cha.',
    size: 'md',
    render: (data) => {
      const label: Record<string, string> = {
        manual: 'Mở tay',
        maintenance_occurrence: 'Từ Bảo trì',
        hrm_request: 'Từ HRM',
        finance_voucher: 'Từ Tài chính',
        auto_from_parent: 'Từ quy trình cha',
      };
      const counts = new Map<string, number>();
      for (const instance of data.workspace.instances) {
        const key = instance.sourceType ?? 'manual';
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      if (counts.size === 0) return <p className={styles.dashEmpty}>Chưa có hồ sơ nào.</p>;
      return (
        <ul className={styles.dashList}>
          {[...counts.entries()].map(([source, count]) => (
            <li key={source}>
              <span>{label[source] ?? source}</span>
              <small>{count}</small>
            </li>
          ))}
        </ul>
      );
    },
  },
  {
    id: 'chart.status',
    title: 'Hồ sơ theo trạng thái',
    description: 'Biểu đồ tròn: tỉ lệ hồ sơ đang chạy, hoàn thành, từ chối, đã huỷ.',
    size: 'md',
    defaultEnabled: true,
    render: (data) => <StatusCard workspace={data.workspace} />,
  },
  {
    id: 'chart.byDefinition',
    title: 'Hồ sơ theo quy trình',
    description: 'Biểu đồ cột: quy trình nào đang sinh nhiều hồ sơ nhất.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => {
      const counts = new Map<string, number>();
      for (const instance of data.workspace.instances) {
        counts.set(instance.definitionName, (counts.get(instance.definitionName) ?? 0) + 1);
      }
      return (
        <BarChart
          emptyHint="Chưa có hồ sơ nào."
          labelPlacement="top"
          slices={[...counts.entries()].map(([label, value]) => ({ label, value }))}
        />
      );
    },
  },
  {
    id: 'chart.stage',
    title: 'Hồ sơ đang chờ vai nào',
    description: 'Biểu đồ cột: hồ sơ đang chạy đứng ở giai đoạn S, R, E, C hay A.',
    size: 'md',
    render: (data) => {
      const counts = new Map<string, number>();
      for (const instance of data.workspace.instances) {
        if (instance.status !== 'running') continue;
        const stage = instance.authorization?.currentRoleStage ?? '—';
        counts.set(stage, (counts.get(stage) ?? 0) + 1);
      }
      return (
        <BarChart
          emptyHint="Không có hồ sơ nào đang chạy."
          slices={[...counts.entries()].map(([label, value]) => ({ label: `Vai ${label}`, value }))}
        />
      );
    },
  },
  {
    id: 'diagram.flow',
    title: 'Sơ đồ luồng các bước quy trình',
    description: 'Biểu diễn trực quan chuỗi các bước (S -> R -> E -> C -> A) của quy trình đã công bố.',
    size: 'lg',
    defaultEnabled: true,
    render: (data) => <ProcedureFlowDiagramCard workspace={data.workspace} />,
  },
  {
    id: 'notice.tenant',
    title: 'Dữ liệu tenant',
    description: 'Mã tenant đang kết nối; mỗi tenant có database riêng.',
    size: 'md',
    render: (data) => (
      <>
        <p className={styles.dashValue}>
          <strong className={styles.dashMono}>{data.workspace.tenantId}</strong>
        </p>
        <p className={styles.dashEmpty}>Dedicated database boundary</p>
      </>
    ),
  },
];

function ProcedureFlowDiagramCard({ workspace }: { workspace: ProcedureWorkspace }) {
  const definitions = workspace.definitions.filter((d) => d.steps && d.steps.length > 0);
  const [selectedId, setSelectedId] = useState<string>(definitions[0]?.id ?? '');

  if (definitions.length === 0) {
    return <p className={styles.dashEmpty}>Chưa có quy trình nào có bước thiết lập.</p>;
  }

  const currentDef = definitions.find((d) => d.id === selectedId) ?? definitions[0];
  const sortedSteps = [...(currentDef?.steps ?? [])].sort((a, b) => a.order - b.order);

  return (
    <div className={styles.dashFlowCard}>
      <div className={styles.dashFlowPicker}>
        <GitBranch size={16} strokeWidth={2.2} style={{ color: '#0284c7', flexShrink: 0 }} />
        <select
          className={styles.dashFlowSelect}
          value={currentDef?.id}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="Chọn quy trình để xem sơ đồ luồng"
        >
          {definitions.map((def) => (
            <option key={def.id} value={def.id}>
              {def.name} ({def.steps.length} bước · {def.status === 'published' ? 'Đã công bố' : 'Bản nháp'})
            </option>
          ))}
        </select>
      </div>

      <div className={styles.dashFlowStepsTrack}>
        {sortedSteps.map((step, idx) => {
          // Tập hợp các vai RACI được phân công trong bước này
          const roles = Array.from(new Set((step.assignments ?? []).map((a) => a.role)));
          return (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <div className={styles.dashFlowStepItem}>
                <span className={styles.dashFlowStepNumber}>{idx + 1}</span>
                <span className={styles.dashFlowStepName} title={step.name}>
                  {step.name}
                </span>
                <div className={styles.dashFlowRoles}>
                  {roles.length > 0 ? (
                    roles.map((r) => (
                      <span
                        key={r}
                        className={`${styles.dashFlowRoleTag} ${
                          styles[`dashFlowRoleTag${r}`] ?? ''
                        }`}
                        title={`Vai ${r}`}
                      >
                        {r}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>—</span>
                  )}
                </div>
              </div>
              {idx < sortedSteps.length - 1 ? (
                <div className={styles.dashFlowArrow}>
                  <ChevronRight size={16} strokeWidth={2.2} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
