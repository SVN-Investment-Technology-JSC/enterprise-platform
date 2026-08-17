'use client';

import type {
  MaintenanceAsset,
  MaintenanceFrequency,
  MaintenanceSchedule,
  MaintenanceWorkspace,
} from '@enterprise-platform/contracts-maintenance';
import { SessionLogoutButton } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createMaintenanceAsset, createMaintenanceSchedule, loadMaintenanceWorkspace, updateMaintenanceSchedule } from './maintenance-api';
import styles from './maintenance.module.scss';
import sessionStyles from './session-actions.module.scss';

type View = 'asset-tree' | 'maintenance-matrix' | 'maintenance-dashboard';
const views: View[] = ['asset-tree', 'maintenance-matrix', 'maintenance-dashboard'];
const frequencyLabels: Record<MaintenanceFrequency, string> = { day: 'Ngày', week: 'Tuần', month: 'Tháng', quarter: 'Quý', year: 'Năm' };

function initialView(): View {
  if (typeof window === 'undefined') return 'asset-tree';
  const hash = window.location.hash.slice(1) as View;
  return views.includes(hash) ? hash : 'asset-tree';
}

export function MaintenanceScreen() {
  const [view, setView] = useState<View>('asset-tree');
  const [workspace, setWorkspace] = useState<MaintenanceWorkspace>();
  const [selectedAssetId, setSelectedAssetId] = useState<string>();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'asset' | 'schedule'>();

  const reload = useCallback(async () => {
    try {
      setError(undefined);
      const data = await loadMaintenanceWorkspace();
      setWorkspace(data);
      setSelectedAssetId((current) => current ?? data.assets[0]?.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải Maintenance.'); }
  }, []);

  useEffect(() => {
    const sync = () => setView(initialView());
    sync(); window.addEventListener('hashchange', sync);
    void reload();
    return () => window.removeEventListener('hashchange', sync);
  }, [reload]);

  const navigate = (next: View) => { window.location.hash = next; setView(next); };
  const perform = async (operation: () => Promise<unknown>) => {
    try { setBusy(true); setError(undefined); await operation(); setDialog(undefined); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Thao tác không thành công.'); }
    finally { setBusy(false); }
  };

  const selectedAsset = workspace?.assets.find((asset) => asset.id === selectedAssetId);
  const title = view === 'asset-tree' ? 'Sơ đồ thiết bị' : view === 'maintenance-matrix' ? 'Ma trận bảo trì' : 'Dashboard bảo trì';

  return <div className={styles.shell}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><span className={styles.brandMark}>M</span><div><strong>Maintenance</strong><span>Enterprise Platform</span></div></div>
      <nav className={styles.navigation} aria-label="Điều hướng Maintenance">
        <p>Dữ liệu tài sản</p>
        <button className={view === 'asset-tree' ? styles.activeNav : ''} onClick={() => navigate('asset-tree')}><span>01</span>Sơ đồ thiết bị</button>
        <p>Lập kế hoạch</p>
        <button className={view === 'maintenance-matrix' ? styles.activeNav : ''} onClick={() => navigate('maintenance-matrix')}><span>02</span>Ma trận bảo trì</button>
        <p>Điều hành</p>
        <button className={view === 'maintenance-dashboard' ? styles.activeNav : ''} onClick={() => navigate('maintenance-dashboard')}><span>03</span>Dashboard bảo trì</button>
      </nav>
      <div className={styles.tenantCard}><span>Dedicated tenant DB</span><strong>{workspace?.tenantId ?? 'Đang kết nối…'}</strong><small>maintenance_schema · isolated plugin</small></div>
    </aside>
    <main className={styles.main}>
      <header className={styles.header}><div><span className={styles.eyebrow}>Maintenance plugin</span><h1>{title}</h1></div><div className={sessionStyles.sessionActions}><div className={styles.actor}><span>{workspace?.actor.name.slice(0,1).toUpperCase() ?? '…'}</span><div><strong>{workspace?.actor.name ?? 'Đang tải'}</strong><small>Quyền do Platform Core cấp</small></div></div><SessionLogoutButton portal="tenant" /></div></header>
      {error ? <div className={styles.error} role="alert"><strong>Không thể hoàn tất yêu cầu</strong><span>{error}</span><button onClick={() => void reload()}>Thử lại</button></div> : null}
      {!workspace ? <div className={styles.loading}><i/><p>Đang nạp dữ liệu bảo trì…</p></div> :
        view === 'asset-tree' ? <AssetTree workspace={workspace} query={query} setQuery={setQuery} selected={selectedAsset} onSelect={setSelectedAssetId} onCreate={() => setDialog('asset')} /> :
        view === 'maintenance-matrix' ? <MaintenanceMatrix workspace={workspace} onCreate={() => setDialog('schedule')} onToggle={(schedule) => void perform(() => updateMaintenanceSchedule(schedule.id, { status: schedule.status === 'active' ? 'paused' : 'active' }))} /> :
        <MaintenanceDashboard workspace={workspace} />}
    </main>
    {dialog === 'asset' && workspace ? <AssetDialog assets={workspace.assets} busy={busy} onClose={() => setDialog(undefined)} onSubmit={(input) => void perform(() => createMaintenanceAsset(input))} /> : null}
    {dialog === 'schedule' && workspace ? <ScheduleDialog workspace={workspace} busy={busy} onClose={() => setDialog(undefined)} onSubmit={(input) => void perform(() => createMaintenanceSchedule(input))} /> : null}
  </div>;
}

function AssetTree({ workspace, query, setQuery, selected, onSelect, onCreate }: {
  workspace: MaintenanceWorkspace; query: string; setQuery(value: string): void; selected?: MaintenanceAsset; onSelect(id: string): void; onCreate(): void;
}) {
  const filtered = useMemo(() => workspace.assets.filter((asset) => `${asset.code} ${asset.name}`.toLowerCase().includes(query.toLowerCase())), [workspace.assets, query]);
  const roots = filtered.filter((asset) => !asset.parentId || !filtered.some((candidate) => candidate.id === asset.parentId));
  return <section className={styles.content}>
    <div className={styles.toolbar}><div><span className={styles.eyebrow}>Equipment hierarchy</span><h2>Cây thiết bị – bộ phận</h2></div><button className={styles.primary} onClick={onCreate}>+ Thêm thiết bị</button></div>
    <div className={styles.assetLayout}>
      <article className={styles.panel}><label className={styles.search}>⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo mã hoặc tên thiết bị" /></label><div className={styles.tree}>{roots.map((asset) => <AssetNode key={asset.id} asset={asset} all={filtered} selectedId={selected?.id} onSelect={onSelect} depth={0} />)}</div></article>
      <article className={styles.detailPanel}>{selected ? <><div className={styles.assetHero}><span>⚙</span><div><small>{selected.code}</small><h3>{selected.name}</h3><em className={`${styles.badge} ${styles[selected.health]}`}>{selected.health === 'good' ? 'Tốt' : selected.health === 'warning' ? 'Cảnh báo' : selected.health === 'critical' ? 'Nguy cấp' : 'Chưa đánh giá'}</em></div></div><dl><div><dt>Loại tài sản</dt><dd>{selected.type}</dd></div><div><dt>Trạng thái</dt><dd>{selected.status}</dd></div><div><dt>Vị trí</dt><dd>{selected.location ?? 'Chưa cập nhật'}</dd></div><div><dt>Nhà sản xuất</dt><dd>{selected.manufacturer ?? 'Chưa cập nhật'}</dd></div><div><dt>Đơn vị quản lý</dt><dd>{selected.organizationUnitName ?? 'Chưa gán'}</dd></div></dl></> : <div className={styles.empty}>Chọn một thiết bị để xem chi tiết.</div>}</article>
    </div>
  </section>;
}

function AssetNode({ asset, all, selectedId, onSelect, depth }: { asset: MaintenanceAsset; all: readonly MaintenanceAsset[]; selectedId?: string; onSelect(id:string):void; depth:number }) {
  const children = all.filter((item) => item.parentId === asset.id);
  return <div><button className={asset.id === selectedId ? styles.selectedNode : ''} style={{ paddingLeft: 12 + depth * 24 }} onClick={() => onSelect(asset.id)}><span>{children.length ? '▾' : '·'}</span><i>{asset.type === 'part' ? '◫' : '⚙'}</i><div><strong>{asset.name}</strong><small>{asset.code} · {children.length} bộ phận</small></div><em className={styles[asset.health]}/></button>{children.map((child) => <AssetNode key={child.id} asset={child} all={all} selectedId={selectedId} onSelect={onSelect} depth={depth+1}/>)}</div>;
}

function MaintenanceMatrix({ workspace, onCreate, onToggle }: { workspace: MaintenanceWorkspace; onCreate(): void; onToggle(schedule: MaintenanceSchedule): void }) {
  return <section className={styles.content}>
    <div className={styles.toolbar}><div><span className={styles.eyebrow}>Preventive maintenance</span><h2>Lịch bảo trì theo chu kỳ</h2><p>Quản lý job plan, thiết bị và quy trình thực thi trên một ma trận.</p></div><button className={styles.primary} onClick={onCreate}>+ Tạo lịch bảo trì</button></div>
    <article className={`${styles.panel} ${styles.tablePanel}`}><table><thead><tr><th>Thiết bị / Job plan</th>{Object.values(frequencyLabels).map((label) => <th key={label}>{label}</th>)}<th>Trạng thái</th><th/></tr></thead><tbody>{workspace.schedules.map((schedule) => { const asset=workspace.assets.find((item)=>item.id===schedule.assetId); const plan=workspace.jobPlans.find((item)=>item.id===schedule.jobPlanId); return <tr key={schedule.id}><td><strong>{asset?.name}</strong><small>{plan?.name}<br/>{schedule.procedureDefinitionName ? `Procedure: ${schedule.procedureDefinitionName}` : 'Không dùng Procedure'}</small></td>{(['day','week','month','quarter','year'] as MaintenanceFrequency[]).map((frequency)=><td key={frequency}>{schedule.frequency===frequency?<span className={styles.cycle}>●</span>:<span className={styles.dash}>—</span>}</td>)}<td><span className={`${styles.badge} ${schedule.status === 'active' ? styles.active : styles.draft}`}>{schedule.status === 'active' ? 'Đang chạy' : schedule.status === 'paused' ? 'Tạm dừng' : 'Bản nháp'}</span>{schedule.pausedReason ? <small>{schedule.pausedReason}</small> : null}</td><td><button className={styles.iconButton} onClick={()=>onToggle(schedule)}>{schedule.status==='active'?'Ⅱ':'▶'}</button></td></tr>; })}</tbody></table>{workspace.schedules.length===0?<div className={styles.empty}>Chưa có lịch bảo trì.</div>:null}</article>
  </section>;
}

function MaintenanceDashboard({ workspace }: { workspace: MaintenanceWorkspace }) {
  const cards = [['Lịch đang hoạt động', workspace.metrics.activeSchedules, 'calendar'], ['Sắp đến hạn', workspace.metrics.upcomingOccurrences, 'clock'], ['Đã tạo quy trình', workspace.metrics.generatedOccurrences, 'flow'], ['Đã hoàn thành', workspace.metrics.completedOccurrences, 'check']] as const;
  return <section className={styles.content}><div className={styles.toolbar}><div><span className={styles.eyebrow}>Operations overview</span><h2>Tổng quan vận hành bảo trì</h2><p>Theo dõi lịch, occurrence và Procedure instance đã được phát sinh.</p></div><span className={styles.live}>● Dữ liệu thời gian thực</span></div><div className={styles.metrics}>{cards.map(([label,value,icon])=><article key={label}><span>{icon==='calendar'?'▦':icon==='clock'?'◷':icon==='flow'?'⇄':'✓'}</span><div><strong>{value}</strong><small>{label}</small></div></article>)}</div><div className={styles.dashboardGrid}><article className={`${styles.panel} ${styles.tablePanel}`}><header><h3>Occurrence gần nhất</h3><span>{workspace.occurrences.length} bản ghi</span></header><table><thead><tr><th>Thiết bị</th><th>Đến hạn</th><th>Trạng thái</th><th>Procedure</th></tr></thead><tbody>{workspace.occurrences.map((item)=><tr key={item.id}><td><strong>{item.assetName}</strong><small>{item.assetCode}</small></td><td>{new Intl.DateTimeFormat('vi-VN',{dateStyle:'medium'}).format(new Date(item.dueAt))}</td><td><span className={`${styles.badge} ${styles[item.status]}`}>{occurrenceLabel(item.status)}</span></td><td>{item.procedureInstanceCode ?? '—'}</td></tr>)}</tbody></table></article><article className={styles.panel}><header><h3>Tình trạng tích hợp</h3></header><div className={styles.integration}><span>PE</span><div><strong>Procedure catalog</strong><small>{workspace.procedureCatalog.length} quy trình đã đồng bộ</small></div><em>Healthy</em></div><div className={styles.integration}><span>DB</span><div><strong>Tenant Database</strong><small>maintenance_schema</small></div><em>Isolated</em></div></article></div></section>;
}

function AssetDialog({ assets, busy, onClose, onSubmit }: { assets: readonly MaintenanceAsset[]; busy: boolean; onClose():void; onSubmit(input:{code:string;name:string;type:'equipment'|'part';parentId?:string;location?:string}):void }) {
  const submit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const data=new FormData(event.currentTarget);onSubmit({code:String(data.get('code')),name:String(data.get('name')),type:data.get('type') as 'equipment'|'part',parentId:String(data.get('parentId')||'')||undefined,location:String(data.get('location')||'')||undefined});};
  return <div className={styles.backdrop}><form className={styles.dialog} onSubmit={submit}><header><div><span className={styles.eyebrow}>Equipment master</span><h2>Thêm thiết bị mới</h2></div><button type="button" onClick={onClose}>×</button></header><label>Mã thiết bị<input name="code" required placeholder="VD: MBA-T1"/></label><label>Tên thiết bị<input name="name" required placeholder="Máy biến áp T1"/></label><div className={styles.formGrid}><label>Loại<select name="type"><option value="equipment">Thiết bị</option><option value="part">Bộ phận</option></select></label><label>Thiết bị cha<select name="parentId"><option value="">Không có</option>{assets.map((asset)=><option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label></div><label>Vị trí<input name="location" placeholder="Nhà máy / phân xưởng"/></label><footer><button type="button" className={styles.secondary} onClick={onClose}>Hủy</button><button className={styles.primary} disabled={busy}>{busy?'Đang lưu…':'Tạo thiết bị'}</button></footer></form></div>;
}

function ScheduleDialog({ workspace, busy, onClose, onSubmit }: { workspace: MaintenanceWorkspace; busy:boolean; onClose():void; onSubmit(input:{assetId:string;jobPlanId:string;procedureDefinitionId?:string;frequency:MaintenanceFrequency;startDate:string;timezone:string;activate:boolean}):void }) {
  const submit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const data=new FormData(event.currentTarget);onSubmit({assetId:String(data.get('assetId')),jobPlanId:String(data.get('jobPlanId')),procedureDefinitionId:String(data.get('procedureDefinitionId')||'')||undefined,frequency:data.get('frequency') as MaintenanceFrequency,startDate:String(data.get('startDate')),timezone:'Asia/Ho_Chi_Minh',activate:data.get('activate')==='on'});};
  return <div className={styles.backdrop}><form className={styles.dialog} onSubmit={submit}><header><div><span className={styles.eyebrow}>Preventive schedule</span><h2>Tạo lịch bảo trì</h2></div><button type="button" onClick={onClose}>×</button></header><label>Thiết bị<select name="assetId" required>{workspace.assets.filter((asset)=>asset.type==='equipment').map((asset)=><option key={asset.id} value={asset.id}>{asset.code} · {asset.name}</option>)}</select></label><label>Job plan<select name="jobPlanId" required>{workspace.jobPlans.map((plan)=><option key={plan.id} value={plan.id}>{plan.code} · {plan.name}</option>)}</select></label><label>Procedure liên kết<select name="procedureDefinitionId"><option value="">Không dùng Procedure</option>{workspace.procedureCatalog.filter((item)=>item.status==='published').map((item)=><option key={item.definitionId} value={item.definitionId}>{item.code} · {item.name}</option>)}</select></label><div className={styles.formGrid}><label>Chu kỳ<select name="frequency">{Object.entries(frequencyLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Ngày bắt đầu<input name="startDate" required type="date" defaultValue={new Date().toISOString().slice(0,10)}/></label></div><label className={styles.check}><input type="checkbox" name="activate" defaultChecked/>Kích hoạt lịch ngay sau khi tạo</label><footer><button type="button" className={styles.secondary} onClick={onClose}>Hủy</button><button className={styles.primary} disabled={busy}>{busy?'Đang lưu…':'Tạo lịch'}</button></footer></form></div>;
}

function occurrenceLabel(status: string): string { return ({planned:'Đã lên lịch',dispatch_pending:'Chờ khởi tạo',generated:'Đã tạo Procedure',completed:'Hoàn thành',failed:'Thất bại',blocked:'Bị chặn'} as Record<string,string>)[status] ?? status; }
