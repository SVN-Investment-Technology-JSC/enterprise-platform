import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type { ProcedureDefinition, ProcedureRaciRole } from '@enterprise-platform/contracts-procedure-engine';
import { useState } from 'react';
import styles from './procedure-engine.module.scss';

const roleDescription: Record<ProcedureRaciRole,string> = { R:'Thực hiện',S:'Khởi tạo',C:'Kiểm soát',A:'Phê duyệt',I:'Nhận thông tin',E:'Công việc con' };

export function RcsiBoard({ definitions, organization }: { definitions: readonly ProcedureDefinition[]; organization?: TenantOrganizationSnapshot }) {
  const [expanded,setExpanded]=useState<string[]>(definitions.map((item)=>item.id));
  const columns=(organization?.units ?? []).slice(0,6);
  const toggle=(id:string)=>setExpanded((current)=>current.includes(id)?current.filter((item)=>item!==id):[...current,id]);
  return <section className={styles.content}>
    <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>R/S/C/A/I/E responsibility map</span><h2>Ma trận RCSI theo cơ cấu tổ chức</h2><p>Mỗi bước chỉ tham chiếu subject từ Platform Organization; Procedure không lưu bản sao cơ cấu.</p></div><div className={styles.roleLegend}>{Object.entries(roleDescription).map(([role,label])=><span key={role}><i className={`${styles.role} ${styles[`role${role}`]}`}>{role}</i>{label}</span>)}</div></div>
    <article className={styles.matrixCard}><div className={styles.matrixScroll}><table className={styles.rcsiTable}><thead><tr><th>Quy trình / bước</th>{columns.map((unit)=><th key={unit.id}><span>{unit.typeName}</span>{unit.name}</th>)}<th>Người dùng trực tiếp</th></tr></thead><tbody>{definitions.map((definition)=><MatrixDefinition key={definition.id} definition={definition} columns={columns} open={expanded.includes(definition.id)} onToggle={()=>toggle(definition.id)}/>)}</tbody></table></div></article>
  </section>;
}

function MatrixDefinition({ definition, columns, open, onToggle }: { definition:ProcedureDefinition; columns:readonly {id:string;name:string}[];open:boolean;onToggle():void }) {
  return <><tr className={styles.matrixDefinition}><td colSpan={columns.length+2}><button onClick={onToggle}><span>{open?'▾':'▸'}</span><strong>{definition.name}</strong><small>{definition.code} · {definition.steps.length} bước · v{definition.versionNumber}</small><em className={`${styles.status} ${styles[definition.status]}`}>{definition.status}</em></button></td></tr>{open?definition.steps.map((step)=><tr key={step.id} className={styles.matrixStep}><td><span>{step.order}</span><div><strong>{step.name}</strong><small>{step.key}</small></div></td>{columns.map((unit)=><td key={unit.id}><div className={styles.matrixRoles}>{step.assignments.filter((item)=>item.subjectType==='organization_unit'&&item.subjectId===unit.id).map((item)=><i key={item.id} title={`${item.role} · ${item.subjectLabel ?? unit.name}`} className={`${styles.role} ${styles[`role${item.role}`]}`}>{item.role}</i>)}</div></td>)}<td><div className={styles.matrixRoles}>{step.assignments.filter((item)=>item.subjectType==='user').map((item)=><i key={item.id} title={item.subjectLabel} className={`${styles.role} ${styles[`role${item.role}`]}`}>{item.role}</i>)}</div></td></tr>):null}</>;
}
