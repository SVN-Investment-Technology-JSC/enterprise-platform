'use client';

import {
  MAX_EXPORT_ROWS,
  REPORT_NO_GROUP,
  WORK_ITEM_PRIORITIES,
  type ProjectGroup,
  type ProjectSummary,
  type ReportBundle,
  type ReportGroupRow,
  type ReportItemKind,
  type Tag,
  type WorkItemPriority,
  type WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';
import { DatePickerInput } from '@enterprise-platform/shared-ui/date-picker';
import { Download, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatVnd, formatVndCompact } from '../money';
import {
  ExportTooLargeError,
  REPORT_SECTIONS,
  buildExportSheets,
  countExportRows,
  exportFileName,
  groupLabel,
  type ReportSectionId,
} from '../report-export';
import {
  REPORT_PERIOD_LABELS,
  localDay,
  percent,
  presetRange,
  type ReportPeriodPreset,
} from '../report-period';
import { downloadReportXlsx } from '../report-xlsx';
import * as api from '../workspace-api';
import {
  PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONE,
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_STATUS_TONE,
  formatDate,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { Choice } from './choice';
import { Dialog } from './dialog';
import { Pager, usePaged } from './pager';
import { BarList, DonutChart, TREND_SERIES, TrendChart, type TrendSeriesKey } from './report-charts';
import { ReportItemsDialog, type ReportDrill } from './report-items-dialog';
import { useDirectory } from './use-directory';

/** Màu từng trạng thái trên biểu đồ vành khuyên: cùng sắc với huy hiệu trạng thái nhưng đậm, dễ phân biệt. */
const STATUS_ORDER: readonly WorkItemStatus[] = ['todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled'];
const STATUS_COLOR: Record<WorkItemStatus, string> = {
  todo: '#64748b',
  in_progress: '#3b82f6',
  blocked: '#ef4444',
  review: '#f59e0b',
  done: '#10b981',
  cancelled: '#cbd5e1',
};
const PRIORITY_COLOR: Record<WorkItemPriority, string> = {
  urgent: '#dc2626',
  high: '#f97316',
  normal: '#3b82f6',
  low: '#94a3b8',
};

const PRESETS: readonly ReportPeriodPreset[] = ['week', 'month', 'quarter', 'year', 'custom'];

export interface ReportsViewProps {
  /** Mở chi tiết một công việc trong dự án của nó (từ danh sách chi tiết hoặc bảng quá hạn). */
  readonly onOpenItem?: (projectId: string, workItemId: string) => void;
}

/**
 * Trang Báo cáo.
 *
 * Phạm vi do server quyết định theo vai trò; giao diện chỉ hiển thị lại nó
 * để người đọc biết con số đang nói về ai. Các bộ lọc (dự án, nhóm, nhãn,
 * người) chỉ **thu hẹp** phạm vi đó — chọn một dự án không tham gia sẽ nhận
 * `403` từ server. Mọi con số bấm được để xem danh sách việc đứng sau nó.
 */
export function ReportsView({ onOpenItem }: ReportsViewProps = {}) {
  const directory = useDirectory();
  const [bundle, setBundle] = useState<ReportBundle>();
  const [preset, setPreset] = useState<ReportPeriodPreset>('week');
  const [custom, setCustom] = useState(() => presetRange('week'));
  const [projectId, setProjectId] = useState('');
  const [group, setGroup] = useState('');
  const [tagId, setTagId] = useState('');
  const [userId, setUserId] = useState('');
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [groups, setGroups] = useState<readonly ProjectGroup[]>([]);
  const [tags, setTags] = useState<readonly Tag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [drill, setDrill] = useState<ReportDrill>();
  const [exportOpen, setExportOpen] = useState(false);

  const range = preset === 'custom' ? custom : presetRange(preset);
  /** Kỳ và bộ lọc đang chọn, dùng chung cho báo cáo và danh sách chi tiết. */
  const params = useMemo<api.ReportParams>(
    () => ({
      // Ngày tính theo giờ máy người dùng, đầu ngày tới cuối ngày.
      from: range.from ? new Date(`${range.from}T00:00:00`).toISOString() : undefined,
      to: range.to ? new Date(`${range.to}T23:59:59`).toISOString() : undefined,
      projectIds: projectId ? [projectId] : undefined,
      groups: group ? [group] : undefined,
      tagIds: tagId ? [tagId] : undefined,
      userId: userId || undefined,
    }),
    [range.from, range.to, projectId, group, tagId, userId],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setBundle(await api.loadReports(params));
      setError(undefined);
    } catch (cause) {
      setBundle(undefined);
      setError((cause as { message?: string })?.message ?? 'Không tải được báo cáo.');
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Danh mục cho các ô lọc: server chỉ trả dự án người dùng thấy được, nên ô lọc không bao giờ mời chọn một dự án
  // sẽ nhận `403`. Hỏng thì ẩn ô lọc tương ứng.
  useEffect(() => {
    api.listAllProjects().then(setProjects).catch(() => setProjects([]));
    api.listProjectGroups().then((list) => setGroups(list.items)).catch(() => setGroups([]));
    api.listTags().then((list) => setTags(list.items)).catch(() => setTags([]));
  }, []);

  /** Mở danh sách việc đứng sau một con số; `extra` là điều kiện riêng của ô được bấm. */
  const open = (
    title: string,
    kind: ReportItemKind,
    extra: Partial<api.ReportParams> & { assigneeUserId?: string; status?: string; priority?: string } = {},
    subtitle?: string,
  ) => setDrill({ title, subtitle, load: () => api.loadReportItems({ ...params, ...extra, kind }) });

  /** Một con số bấm được; bằng 0 thì chỉ là chữ. */
  const count = (value: number, onClick: () => void, danger = false) =>
    value > 0 ? (
      <button
        type="button"
        className={danger ? styles.reportNumberDanger : styles.reportNumber}
        title="Xem danh sách công việc"
        onClick={onClick}
      >
        {value}
      </button>
    ) : (
      <span className={styles.muted}>0</span>
    );

  const filterNotes = useMemo(() => {
    const notes: string[] = [];
    const project = projects.find((entry) => entry.id === projectId);
    if (project) notes.push(`Dự án ${project.code}`);
    if (group) notes.push(`Nhóm ${group === REPORT_NO_GROUP ? 'Chưa phân nhóm' : group}`);
    const tag = tags.find((entry) => entry.id === tagId);
    if (tag) notes.push(`Nhãn ${tag.name}`);
    if (userId) notes.push(`Người ${directory.nameOf(userId)}`);
    return notes;
  }, [projects, projectId, group, tags, tagId, userId, directory]);

  const runExport = (sections: readonly ReportSectionId[]) => {
    if (!bundle) return;
    setNotice(undefined);
    setError(undefined);
    try {
      const sheets = buildExportSheets(bundle, directory.nameOf, sections, filterNotes);
      const rows = countExportRows(sheets);
      if (rows > MAX_EXPORT_ROWS) throw new ExportTooLargeError(rows);
      // Tệp sinh hoàn toàn ở trình duyệt: dữ liệu cần xuất đã nằm sẵn trên màn hình.
      downloadReportXlsx(exportFileName(bundle), sheets);
      setExportOpen(false);
      setNotice(`Đã xuất ${exportFileName(bundle)}.`);
    } catch (cause) {
      setError(cause instanceof ExportTooLargeError ? cause.message : 'Không xuất được tệp báo cáo.');
    }
  };

  const kpis = bundle?.kpis;
  const previous = bundle?.previous;
  const selfOnly = bundle?.scope.level === 'self';
  const onTimeRate = kpis ? percent(kpis.completedOnTime, kpis.completedItems) : undefined;
  const previousRate = previous ? percent(previous.completedOnTime, previous.completedItems) : undefined;

  /** Thang của thanh tải công việc: người nhiều việc nhất chiếm trọn bề ngang. */
  const workloadMax = Math.max(1, ...(bundle?.workload ?? []).map((row) => row.openItems));
  // Các bảng chia trang ở client: báo cáo đã tải trọn trong một lời gọi.
  const progressPage = usePaged(bundle?.projectProgress);
  const workloadPage = usePaged(bundle?.workload);
  const overduePage = usePaged(bundle?.overdue);
  const performancePage = usePaged(bundle?.performance);

  const statusItems = STATUS_ORDER.map((status) => ({
    key: status,
    label: WORK_ITEM_STATUS_LABELS[status],
    value: bundle?.statusBreakdown.find((row) => row.key === status)?.count ?? 0,
    color: STATUS_COLOR[status],
  })).filter((item) => item.value > 0);
  const priorityItems = [...WORK_ITEM_PRIORITIES].reverse().map((priority) => ({
    key: priority,
    label: PRIORITY_LABELS[priority],
    value: bundle?.priorityBreakdown.find((row) => row.key === priority)?.count ?? 0,
    color: PRIORITY_COLOR[priority],
  }));

  const pickTrend = (bucket: { start: string }, series: TrendSeriesKey) => {
    if (!bundle) return;
    const index = bundle.trend.buckets.findIndex((entry) => entry.start === bucket.start);
    const next = bundle.trend.buckets[index + 1]?.start;
    // Cột đầu / cuối có thể chờm ra ngoài kỳ (tuần, tháng): cắt lại theo kỳ đang xem.
    const startDay = bucket.start < (range.from ?? '') ? range.from : bucket.start;
    const endDay = next ? dayBefore(next) : range.to;
    const end = endDay && range.to && endDay > range.to ? range.to : endDay;
    const label = TREND_SERIES.find((entry) => entry.key === series)?.label ?? '';
    const kind: ReportItemKind =
      series === 'created' ? 'created' : series === 'completed' ? 'completed' : 'missedDeadline';
    open(label, kind, {
      from: new Date(`${startDay}T00:00:00`).toISOString(),
      to: new Date(`${end}T23:59:59`).toISOString(),
    }, `${formatDate(startDay)} – ${formatDate(end)}`);
  };

  const groupTable = (rows: readonly ReportGroupRow[], kind: 'group' | 'tag') =>
    rows.length === 0 ? (
      <p className={styles.muted}>{kind === 'group' ? 'Chưa có dự án nào.' : 'Chưa có dự án nào gắn nhãn.'}</p>
    ) : (
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{kind === 'group' ? 'Nhóm dự án' : 'Nhãn'}</th>
              <th>Dự án</th>
              <th>Tiến độ TB</th>
              <th>Đang mở</th>
              <th>Quá hạn</th>
              <th>Xong trong kỳ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const name = kind === 'group' ? groupLabel(row.key) : row.label;
              const scope =
                kind === 'group'
                  ? { groups: [row.key || REPORT_NO_GROUP] }
                  : { tagIds: [row.key] };
              return (
                <tr key={row.key || '_'}>
                  <td>
                    {kind === 'tag' && row.color ? (
                      <i className={styles.reportSwatch} style={{ background: row.color }} />
                    ) : null}
                    {name}
                  </td>
                  <td>{row.projectCount}</td>
                  <td>
                    <span className={styles.progressCell}>
                      <span className={styles.progressTrack} aria-label={`${row.progressPercent}%`}>
                        <span className={styles.progressFill} style={{ width: `${row.progressPercent}%` }} />
                      </span>
                      {row.progressPercent}%
                    </span>
                  </td>
                  <td>{count(row.openItems, () => open(`Việc đang mở · ${name}`, 'open', scope))}</td>
                  <td>
                    {count(row.overdueItems, () => open(`Việc quá hạn · ${name}`, 'overdue', scope), true)}
                  </td>
                  <td>
                    {count(row.completedInPeriod, () => open(`Hoàn thành trong kỳ · ${name}`, 'completed', scope))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );

  return (
    <div className={styles.tabBody}>
      <div className={styles.filterBar}>
        <div className={styles.reportPeriod} role="group" aria-label="Kỳ báo cáo">
          {PRESETS.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={preset === entry}
              className={preset === entry ? styles.reportPeriodActive : undefined}
              onClick={() => {
                // Chuyển sang "Tuỳ chọn" thì bắt đầu từ kỳ đang xem, khỏi phải chọn lại cả hai ngày.
                if (entry === 'custom') setCustom(range);
                setPreset(entry);
              }}
            >
              {REPORT_PERIOD_LABELS[entry]}
            </button>
          ))}
        </div>
        {preset === 'custom' ? (
          <>
            <label className={styles.checkbox}>
              Từ
              <span style={{ width: 140 }}>
                <DatePickerInput
                  height={32}
                  value={custom.from}
                  onChange={(from) => setCustom((value) => ({ ...value, from }))}
                />
              </span>
            </label>
            <label className={styles.checkbox}>
              Đến
              <span style={{ width: 140 }}>
                <DatePickerInput
                  height={32}
                  value={custom.to}
                  onChange={(to) => setCustom((value) => ({ ...value, to }))}
                />
              </span>
            </label>
          </>
        ) : (
          <span className={styles.muted}>
            {formatDate(range.from)} – {formatDate(range.to)}
          </span>
        )}
        <span className={styles.reportBarSpacer} />
        {loading ? <span className={styles.muted}>Đang tải…</span> : null}
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Tải lại"
          onClick={() => void reload()}
        >
          <RefreshCw size={15} />
        </button>
        <button
          type="button"
          className={styles.buttonGhost}
          disabled={!bundle}
          onClick={() => setExportOpen(true)}
        >
          <Download size={14} /> Xuất Excel
        </button>
      </div>

      <div className={styles.reportFilters}>
        {projects.length > 0 ? (
          <Choice
            label="Lọc theo dự án"
            value={projectId}
            emptyOption="Tất cả dự án"
            options={projects.map((project) => ({
              value: project.id,
              label: `${project.code} · ${project.name}`,
            }))}
            onChange={setProjectId}
          />
        ) : null}
        <Choice
          label="Lọc theo nhóm dự án"
          value={group}
          emptyOption="Mọi nhóm dự án"
          options={[
            ...groups.map((entry) => ({ value: entry.name, label: entry.name })),
            { value: REPORT_NO_GROUP, label: 'Chưa phân nhóm' },
          ]}
          onChange={setGroup}
        />
        {tags.length > 0 ? (
          <Choice
            label="Lọc theo nhãn"
            value={tagId}
            emptyOption="Mọi nhãn"
            options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
            onChange={setTagId}
          />
        ) : null}
        {/* Mức `self` chỉ thấy chính mình: ô chọn người không có nghĩa. */}
        {selfOnly ? null : (
          <Choice
            label="Lọc theo người"
            value={userId}
            emptyOption="Mọi người"
            options={directory.people.map((person) => ({
              value: person.userId,
              label: person.displayName,
              description: [person.positionName, person.unitNames.join(', ')].filter(Boolean).join(' · '),
            }))}
            onChange={setUserId}
          />
        )}
      </div>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}

      {bundle ? (
        <p className={styles.muted}>
          {bundle.scope.level === 'tenant'
            ? 'Toàn bộ tenant'
            : bundle.scope.level === 'managed'
              ? 'Các dự án bạn phụ trách'
              : 'Số liệu của riêng bạn'}{' '}
          · {bundle.scope.projectCount} dự án · so với kỳ trước {formatDate(localDay(bundle.previous.from))} –{' '}
          {formatDate(localDay(bundle.previous.to))}
          {' · '}Của tôi: {bundle.mine.openItems} đang mở, {bundle.mine.overdueItems} quá hạn,{' '}
          {bundle.mine.completedInPeriod} xong trong kỳ
        </p>
      ) : null}

      <div className={styles.kpiGrid}>
        <Kpi
          label="Việc tạo mới"
          value={kpis?.createdItems}
          previous={previous?.createdItems}
          onClick={() => open('Việc tạo mới trong kỳ', 'created')}
        />
        <Kpi
          label="Hoàn thành"
          value={kpis?.completedItems}
          previous={previous?.completedItems}
          goodWhenUp
          onClick={() => open('Việc hoàn thành trong kỳ', 'completed')}
        />
        <Kpi
          label="Tỉ lệ đúng hạn"
          value={onTimeRate}
          suffix="%"
          previous={previousRate}
          goodWhenUp
          hint={kpis ? `${kpis.completedOnTime} đúng hạn · ${kpis.completedLate} trễ` : undefined}
          onClick={kpis?.completedLate ? () => open('Việc hoàn thành trễ hạn', 'completedLate') : undefined}
        />
        <Kpi label="Giờ đã hoàn thành" value={kpis?.completedHours} hint="Theo giờ ước lượng" />
        <Kpi label="Đang mở" value={kpis?.openItems} hint="Tại hôm nay" onClick={() => open('Việc đang mở', 'open')} />
        <Kpi
          label="Quá hạn"
          value={kpis?.overdueItems}
          danger
          hint="Tại hôm nay"
          onClick={() => open('Việc quá hạn', 'overdue')}
        />
      </div>

      <div className={styles.reportGrid}>
        <Panel title="Xu hướng" note="Bấm một cột để xem danh sách việc">
          {bundle ? <TrendChart trend={bundle.trend} onPick={pickTrend} /> : null}
        </Panel>
        <Panel title="Công việc theo trạng thái">
          {statusItems.length > 0 ? (
            <DonutChart
              items={statusItems}
              centerLabel="việc"
              onPick={(status) =>
                open(`Việc ${WORK_ITEM_STATUS_LABELS[status as WorkItemStatus].toLowerCase()}`, 'all', { status })
              }
            />
          ) : (
            <p className={styles.muted}>Chưa có công việc nào.</p>
          )}
          <h4 className={styles.reportSubhead}>Việc đang mở theo độ ưu tiên</h4>
          <BarList
            items={priorityItems}
            onPick={(priority) =>
              open(`Việc đang mở · ưu tiên ${PRIORITY_LABELS[priority as WorkItemPriority].toLowerCase()}`, 'open', {
                priority,
              })
            }
          />
        </Panel>
      </div>

      <Panel title="Hiệu suất theo người" note="Tính theo người phụ trách; bấm số để xem danh sách">
        {bundle?.performance.length ? (
          <>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Người phụ trách</th>
                    <th>Hoàn thành</th>
                    <th>Đúng hạn</th>
                    <th>Trễ hạn</th>
                    <th>Tỉ lệ đúng hạn</th>
                    <th>Trễ TB</th>
                    <th>Giờ đã xong</th>
                    <th>Đang mở</th>
                    <th>Quá hạn</th>
                  </tr>
                </thead>
                <tbody>
                  {performancePage.rows.map((row) => {
                    const name = directory.nameOf(row.userId);
                    const mine = { assigneeUserId: row.userId };
                    const rate = percent(row.completedOnTime, row.completedItems);
                    return (
                      <tr key={row.userId}>
                        <td>{name}</td>
                        <td>{count(row.completedItems, () => open(`Hoàn thành · ${name}`, 'completed', mine))}</td>
                        <td>
                          {count(row.completedOnTime, () =>
                            open(`Hoàn thành đúng hạn · ${name}`, 'completedOnTime', mine),
                          )}
                        </td>
                        <td>
                          {count(
                            row.completedLate,
                            () => open(`Hoàn thành trễ hạn · ${name}`, 'completedLate', mine),
                            true,
                          )}
                        </td>
                        <td>
                          {rate === undefined ? (
                            <span className={styles.muted}>—</span>
                          ) : (
                            <span className={styles.progressCell}>
                              <span className={styles.progressTrack} aria-hidden>
                                <span className={styles.progressFill} style={{ width: `${rate}%` }} />
                              </span>
                              {rate}%
                            </span>
                          )}
                        </td>
                        <td>{row.averageDaysLate > 0 ? `${row.averageDaysLate} ngày` : '—'}</td>
                        <td>{row.completedHours}</td>
                        <td>{count(row.openItems, () => open(`Việc đang mở · ${name}`, 'open', mine))}</td>
                        <td>
                          {count(row.overdueItems, () => open(`Việc quá hạn · ${name}`, 'overdue', mine), true)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager
              page={performancePage.page}
              pages={performancePage.pages}
              total={performancePage.total}
              pageSize={performancePage.pageSize}
              onPage={performancePage.setPage}
            />
          </>
        ) : (
          <p className={styles.muted}>Chưa có ai có việc trong kỳ.</p>
        )}
      </Panel>

      <div className={styles.reportGridEven}>
        <Panel title="Theo nhóm dự án">{bundle ? groupTable(bundle.byGroup, 'group') : null}</Panel>
        <Panel title="Theo nhãn dự án">{bundle ? groupTable(bundle.byTag, 'tag') : null}</Panel>
      </div>

      {/* Chỉ có khi server gửi kèm — mức `self` không nhận khối này, và
          server cũng không hề truy vấn số tiền cho họ. */}
      {bundle?.finance ? (
        <Panel title="Tài chính các dự án trong phạm vi">
          <div className={styles.statRow}>
            <MoneyStat label="Tổng giá trị hợp đồng" value={bundle.finance.contractValue} />
          </div>
          <p className={styles.muted}>
            Thu chi thực tế xem ở tab Tài chính của từng dự án, và báo cáo thu chi theo dự án ở module Tài chính.
          </p>
        </Panel>
      ) : null}

      <Panel title="Tiến độ dự án">
        {bundle?.projectProgress.length ? (
          <>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Dự án</th>
                    <th>Trạng thái</th>
                    <th>Tiến độ</th>
                    <th>Việc</th>
                    <th>Quá hạn</th>
                    <th>Kỳ hạn</th>
                  </tr>
                </thead>
                <tbody>
                  {progressPage.rows.map((row) => (
                    <tr key={row.projectId}>
                      <td className={`${styles.treeCode} ${styles.cellNowrap}`}>{row.projectCode}</td>
                      <td>{row.projectName}</td>
                      <td>
                        <span
                          className={styles.pill}
                          style={{
                            background: PROJECT_STATUS_TONE[row.status].bg,
                            color: PROJECT_STATUS_TONE[row.status].fg,
                          }}
                        >
                          {PROJECT_STATUS_LABELS[row.status]}
                        </span>
                      </td>
                      <td>
                        <span className={styles.progressCell}>
                          <span className={styles.progressTrack} aria-label={`${row.progressPercent}%`}>
                            <span
                              className={styles.progressFill}
                              style={{ width: `${row.progressPercent}%` }}
                            />
                          </span>
                          {row.progressPercent}%
                        </span>
                      </td>
                      <td>
                        {row.closedItems}/{row.totalItems}
                      </td>
                      <td>
                        {count(
                          row.overdueItems,
                          () => open(`Việc quá hạn · ${row.projectCode}`, 'overdue', { projectIds: [row.projectId] }),
                          true,
                        )}
                      </td>
                      <td className={`${styles.muted} ${styles.cellNowrap}`}>
                        {formatDate(row.startDate) || '…'} → {formatDate(row.endDate) || '…'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={progressPage.page}
              pages={progressPage.pages}
              total={progressPage.total}
              pageSize={progressPage.pageSize}
              onPage={progressPage.setPage}
            />
          </>
        ) : (
          <p className={styles.muted}>Chưa có dự án nào trong phạm vi.</p>
        )}
      </Panel>

      <Panel title="Tải công việc">
        {bundle?.workload.length ? (
          <>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Người phụ trách</th>
                    <th>Đang mở</th>
                    <th>Quá hạn</th>
                    <th>Đến hạn trong tuần</th>
                    <th>Giờ ước lượng</th>
                  </tr>
                </thead>
                <tbody>
                  {workloadPage.rows.map((row) => {
                    const name = directory.nameOf(row.userId);
                    const mine = { assigneeUserId: row.userId };
                    return (
                      <tr key={row.userId}>
                        <td>{name}</td>
                        <td>
                          <span className={styles.progressCell}>
                            <span className={styles.loadTrack} aria-hidden>
                              <span
                                className={styles.loadFill}
                                style={{ width: `${(row.openItems / workloadMax) * 100}%` }}
                              />
                            </span>
                            {count(row.openItems, () => open(`Việc đang mở · ${name}`, 'open', mine))}
                          </span>
                        </td>
                        <td>
                          {count(row.overdueItems, () => open(`Việc quá hạn · ${name}`, 'overdue', mine), true)}
                        </td>
                        <td>
                          {count(row.dueThisWeek, () =>
                            open(`Đến hạn trong tuần · ${name}`, 'dueThisWeek', mine),
                          )}
                        </td>
                        <td>{row.estimatedHours}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager
              page={workloadPage.page}
              pages={workloadPage.pages}
              total={workloadPage.total}
              pageSize={workloadPage.pageSize}
              onPage={workloadPage.setPage}
            />
          </>
        ) : (
          <p className={styles.muted}>Không có việc nào đang mở trong phạm vi.</p>
        )}
      </Panel>

      <Panel title="Công việc quá hạn">
        {bundle?.overdue.length ? (
          <>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Công việc</th>
                    <th>Dự án</th>
                    <th>Người phụ trách</th>
                    <th>Hạn</th>
                    <th>Trễ</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {overduePage.rows.map((row) => {
                    const projectOfRow = projects.find((entry) => entry.code === row.projectCode);
                    return (
                      <tr key={row.workItemId}>
                        <td className={`${styles.treeCode} ${styles.cellNowrap}`}>{row.code}</td>
                        <td>
                          {onOpenItem && projectOfRow ? (
                            <button
                              type="button"
                              className={styles.linkButton}
                              onClick={() => onOpenItem(projectOfRow.id, row.workItemId)}
                            >
                              {row.title}
                            </button>
                          ) : (
                            row.title
                          )}
                        </td>
                        <td className={styles.muted}>{row.projectCode}</td>
                        <td>{directory.nameOf(row.assigneeUserId)}</td>
                        <td className={styles.cellNowrap}>{formatDate(row.plannedEnd)}</td>
                        <td className={styles.cellDanger}>{row.daysLate} ngày</td>
                        <td>
                          <span
                            className={styles.pill}
                            style={{
                              background: WORK_ITEM_STATUS_TONE[row.status].bg,
                              color: WORK_ITEM_STATUS_TONE[row.status].fg,
                            }}
                          >
                            {WORK_ITEM_STATUS_LABELS[row.status]}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager
              page={overduePage.page}
              pages={overduePage.pages}
              total={overduePage.total}
              pageSize={overduePage.pageSize}
              onPage={overduePage.setPage}
            />
          </>
        ) : (
          <p className={styles.muted}>Không có công việc nào quá hạn. </p>
        )}
      </Panel>

      <ReportItemsDialog
        drill={drill}
        nameOf={directory.nameOf}
        onOpenItem={
          onOpenItem
            ? (project, item) => {
                setDrill(undefined);
                onOpenItem(project, item);
              }
            : undefined
        }
        onClose={() => setDrill(undefined)}
      />

      {bundle ? (
        <ExportDialog
          open={exportOpen}
          hasFinance={Boolean(bundle.finance)}
          onClose={() => setExportOpen(false)}
          onExport={runExport}
        />
      ) : null}
    </div>
  );
}

/** Ngày liền trước `YYYY-MM-DD`. */
function dayBefore(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const previous = new Date(year, month - 1, date - 1);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${previous.getFullYear()}-${pad(previous.getMonth() + 1)}-${pad(previous.getDate())}`;
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      <h3>
        {title}
        {note ? <span className={styles.reportNote}>{note}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/**
 * Thẻ chỉ số trên dashboard: giá trị, so với kỳ trước (tăng / giảm, xanh khi tốt, đỏ khi xấu), dòng phụ. Bấm thẻ để
 * xem danh sách việc.
 */
function Kpi({
  label,
  value,
  suffix = '',
  previous,
  goodWhenUp,
  danger,
  hint,
  onClick,
}: {
  label: string;
  value?: number;
  suffix?: string;
  previous?: number;
  goodWhenUp?: boolean;
  danger?: boolean;
  hint?: string;
  onClick?: () => void;
}) {
  const delta = value !== undefined && previous !== undefined ? value - previous : undefined;
  const tone =
    delta === undefined || delta === 0 || goodWhenUp === undefined
      ? styles.kpiDeltaFlat
      : (delta > 0) === goodWhenUp
        ? styles.kpiDeltaGood
        : styles.kpiDeltaBad;
  const body = (
    <>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value === undefined ? '—' : `${value}${suffix}`}</span>
      {delta !== undefined ? (
        <span className={tone}>
          {delta > 0 ? '▲' : delta < 0 ? '▼' : '='} {delta > 0 ? '+' : ''}
          {delta}
          {suffix} so với kỳ trước
        </span>
      ) : null}
      {hint ? <span className={styles.kpiHint}>{hint}</span> : null}
    </>
  );
  const className = `${styles.kpiCard} ${danger && value ? styles.kpiCardDanger : ''}`;
  return onClick && value ? (
    <button type="button" className={className} onClick={onClick} title="Xem danh sách công việc">
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

function MoneyStat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className={danger ? styles.statDanger : styles.stat} title={formatVnd(value)}>
      <span className={styles.statValue}>{formatVndCompact(value)}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

/** Chọn phần báo cáo muốn xuất trước khi tải tệp Excel. */
function ExportDialog({
  open,
  hasFinance,
  onClose,
  onExport,
}: {
  open: boolean;
  hasFinance: boolean;
  onClose: () => void;
  onExport: (sections: readonly ReportSectionId[]) => void;
}) {
  const available = REPORT_SECTIONS.filter((section) => section.id !== 'finance' || hasFinance);
  const [picked, setPicked] = useState<ReadonlySet<ReportSectionId>>(
    () => new Set(available.map((section) => section.id)),
  );
  const all = available.every((section) => picked.has(section.id));
  return (
    <Dialog
      open={open}
      title="Xuất báo cáo Excel"
      subtitle="Chọn phần muốn xuất; mỗi phần là một trang tính, Tổng quan là dashboard."
      submitLabel="Xuất Excel"
      submitDisabled={picked.size === 0}
      onClose={onClose}
      onSubmit={() => onExport(available.map((section) => section.id).filter((id) => picked.has(id)))}
    >
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={all}
          onChange={() => setPicked(all ? new Set() : new Set(available.map((section) => section.id)))}
        />
        <strong>Chọn tất cả</strong>
      </label>
      <div className={styles.reportExportList}>
        {available.map((section) => (
          <label key={section.id} className={styles.checkbox}>
            <input
              type="checkbox"
              checked={picked.has(section.id)}
              onChange={() =>
                setPicked((current) => {
                  const next = new Set(current);
                  if (next.has(section.id)) next.delete(section.id);
                  else next.add(section.id);
                  return next;
                })
              }
            />
            {section.label}
          </label>
        ))}
      </div>
    </Dialog>
  );
}
