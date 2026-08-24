import type { OrganizationUnit, TenantOrganizationContext } from '@enterprise-platform/contracts-organization';
import { useState } from 'react';
import styles from './procedure-engine.module.scss';

/** Tenant Core owns this data; Procedure may only render the published context. */
export function OrganizationBoard({ organization }: { organization: TenantOrganizationContext }) {
  const units = organization.units ?? [];
  const members = organization.members ?? [];
  const unitTypes = organization.unitTypes ?? [];
  const [selectedId, setSelectedId] = useState(units[0]?.id);
  const selected = units.find((unit) => unit.id === selectedId) ?? units[0];
  const roots = units.filter((unit) => !unit.parentId);

  return <section className={styles.content}>
    <div className={styles.sectionHeading}>
      <div>
        <span className={styles.eyebrow}>Tenant Core · read-only contract</span>
        <h2>Sơ đồ tổ chức</h2>
        <p>{unitTypes.length} loại đơn vị · {units.length} đơn vị · quản lý tại Tenant Portal.</p>
      </div>
    </div>
    <div className={styles.orgLayout}>
      <article className={styles.orgTree}>
        <header><h3>Cơ cấu doanh nghiệp</h3><span>{units.length} đơn vị</span></header>
        {roots.map((unit) => <OrganizationNode key={unit.id} unit={unit} all={units} selectedId={selected?.id} onSelect={setSelectedId} depth={0} />)}
      </article>
      <article className={styles.orgDetail}>
        {selected ? <>
          <div className={styles.orgHero}><span>{selected.name.slice(0, 2).toUpperCase()}</span><div><small>{selected.typeName} · {selected.code}</small><h3>{selected.name}</h3></div></div>
          <dl><div><dt>Trưởng đơn vị</dt><dd>{selected.headName ?? 'Chưa bổ nhiệm'}</dd></div><div><dt>Thành viên</dt><dd>{selected.memberCount} người</dd></div><div><dt>Đơn vị cấp trên</dt><dd>{units.find((item) => item.id === selected.parentId)?.name ?? 'Cấp cao nhất'}</dd></div></dl>
          <h4>Thành viên trong đơn vị</h4>
          <div className={styles.memberList}>{members.filter((member) => member.unitId === selected.id).map((member) => <div key={member.membershipId}><span>{member.displayName.slice(0, 1)}</span><div><strong>{member.displayName}</strong><small>{member.positionName ?? member.email}</small></div>{member.isHead ? <em>Trưởng đơn vị</em> : null}</div>)}{members.every((member) => member.unitId !== selected.id) ? <p>Chưa có thành viên.</p> : null}</div>
        </> : null}
      </article>
    </div>
  </section>;
}

function OrganizationNode({ unit, all, selectedId, onSelect, depth }: { unit: OrganizationUnit; all: readonly OrganizationUnit[]; selectedId?: string; onSelect(id: string): void; depth: number }) {
  const children = all.filter((item) => item.parentId === unit.id);
  return <div><button className={selectedId === unit.id ? styles.selectedOrg : ''} style={{ paddingLeft: 14 + depth * 22 }} onClick={() => onSelect(unit.id)}><span>{children.length ? '▾' : '·'}</span><i>{unit.typeName.slice(0, 1)}</i><div><strong>{unit.name}</strong><small>{unit.typeName} · {unit.memberCount} thành viên</small></div></button>{children.map((child) => <OrganizationNode key={child.id} unit={child} all={all} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />)}</div>;
}
