import type { OrganizationUnit, TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import { useMemo, useState, type FormEvent } from 'react';
import styles from './procedure-engine.module.scss';

export function OrganizationBoard({ organization, canManage, busy, onCreate, onDelete }: {
  organization:TenantOrganizationSnapshot;canManage:boolean;busy?:string;
  onCreate(input:{code:string;name:string;typeId:string;parentId?:string}):void;onDelete(id:string):void;
}) {
  // Chuẩn hoá một lần: snapshot đến từ Core qua HTTP, phản hồi thiếu trường
  // không được phép làm trắng cả bảng.
  const units=organization.units ?? [];
  const members=organization.members ?? [];
  const unitTypes=organization.unitTypes ?? [];

  const [selectedId,setSelectedId]=useState(units[0]?.id);
  const [showCreate,setShowCreate]=useState(false);
  const selected=units.find((unit)=>unit.id===selectedId) ?? units[0];
  const roots=useMemo(()=>units.filter((unit)=>!unit.parentId),[units]);
  const submit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const data=new FormData(event.currentTarget);onCreate({code:String(data.get('code')),name:String(data.get('name')),typeId:String(data.get('typeId')),parentId:String(data.get('parentId')||'')||undefined});setShowCreate(false);};
  return <section className={styles.content}>
    <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Platform Organization contract</span><h2>Sơ đồ tổ chức</h2><p>{unitTypes.length} loại đơn vị · {units.length} đơn vị · dữ liệu thuộc Platform Core.</p></div>{canManage?<button className={styles.primaryButton} onClick={()=>setShowCreate(true)}>+ Thêm đơn vị</button>:null}</div>
    <div className={styles.orgLayout}><article className={styles.orgTree}><header><h3>Cơ cấu doanh nghiệp</h3><span>{units.length} đơn vị</span></header>{roots.map((unit)=><OrganizationNode key={unit.id} unit={unit} all={units} selectedId={selected?.id} onSelect={setSelectedId} depth={0}/>)}</article><article className={styles.orgDetail}>{selected?<><div className={styles.orgHero}><span>{selected.name.slice(0,2).toUpperCase()}</span><div><small>{selected.typeName} · {selected.code}</small><h3>{selected.name}</h3></div></div><dl><div><dt>Trưởng đơn vị</dt><dd>{selected.headName ?? 'Chưa bổ nhiệm'}</dd></div><div><dt>Thành viên</dt><dd>{selected.memberCount} người</dd></div><div><dt>Đơn vị cấp trên</dt><dd>{units.find((item)=>item.id===selected.parentId)?.name ?? 'Cấp cao nhất'}</dd></div></dl><h4>Thành viên trong đơn vị</h4><div className={styles.memberList}>{members.filter((member)=>member.unitId===selected.id).map((member)=><div key={member.membershipId}><span>{member.displayName.slice(0,1)}</span><div><strong>{member.displayName}</strong><small>{member.positionName ?? member.email}</small></div>{member.isHead?<em>Trưởng đơn vị</em>:null}</div>)}{members.every((member)=>member.unitId!==selected.id)?<p>Chưa có thành viên.</p>:null}</div>{canManage?<button className={styles.dangerButton} disabled={busy===`delete-unit:${selected.id}`} onClick={()=>onDelete(selected.id)}>Xóa đơn vị</button>:null}</>:null}</article></div>
    {showCreate?<div className={styles.modalBackdrop}><form className={styles.orgDialog} onSubmit={submit}><header><div><span className={styles.eyebrow}>Organization unit</span><h2>Thêm đơn vị mới</h2></div><button type="button" onClick={()=>setShowCreate(false)}>×</button></header><div className={styles.formRow}><label>Mã đơn vị<input required name="code" placeholder="VD: OPS"/></label><label>Loại đơn vị<select required name="typeId">{unitTypes.map((type)=><option key={type.id} value={type.id}>{type.name}</option>)}</select></label></div><label>Tên đơn vị<input required name="name" placeholder="Phòng Vận hành"/></label><label>Đơn vị cấp trên<select name="parentId"><option value="">Không có</option>{units.map((unit)=><option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><footer><button type="button" className={styles.secondaryButton} onClick={()=>setShowCreate(false)}>Hủy</button><button className={styles.primaryButton}>Tạo đơn vị</button></footer></form></div>:null}
  </section>;
}

function OrganizationNode({unit,all,selectedId,onSelect,depth}:{unit:OrganizationUnit;all:readonly OrganizationUnit[];selectedId?:string;onSelect(id:string):void;depth:number}){const children=all.filter((item)=>item.parentId===unit.id);return <div><button className={selectedId===unit.id?styles.selectedOrg:''} style={{paddingLeft:14+depth*22}} onClick={()=>onSelect(unit.id)}><span>{children.length?'▾':'·'}</span><i>{unit.typeName.slice(0,1)}</i><div><strong>{unit.name}</strong><small>{unit.typeName} · {unit.memberCount} thành viên</small></div></button>{children.map((child)=><OrganizationNode key={child.id} unit={child} all={all} selectedId={selectedId} onSelect={onSelect} depth={depth+1}/>)}</div>}
