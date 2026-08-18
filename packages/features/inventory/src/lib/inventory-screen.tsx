'use client';
import type { InventoryWorkspaceDto } from '@enterprise-platform/contract-inventory';
import { useState } from 'react';
import styles from './inventory.module.css';
import { AssetTreeExplorer } from './asset-tree-explorer';
export type InventoryView='dashboard'|'assets'|'items'|'warehouses'|'stock'|'serials'|'reservations'|'transactions';
export function InventoryScreen({data,tenantSlug,view='dashboard'}:{data:InventoryWorkspaceDto;tenantSlug:string;view?:InventoryView}){
 const [showImportModal, setShowImportModal] = useState(false);
 const [showExportModal, setShowExportModal] = useState(false);
 const [importForm, setImportForm] = useState({ receiptNo: `NK-${Date.now().toString().slice(-6)}`, warehouseId: data.warehouses[0]?.id||'', itemId: data.items[0]?.id||'', quantity: 10, unitCost: 150000 });
 const [exportForm, setExportForm] = useState({ issueNo: `XK-${Date.now().toString().slice(-6)}`, warehouseId: data.warehouses[0]?.id||'', itemId: data.items[0]?.id||'', quantity: 2, referenceType: 'WORK_ORDER', referenceId: 'WO-2026-08' });

 const total=data.balances.reduce((s,x)=>s+x.onHand,0),available=data.balances.reduce((s,x)=>s+x.available,0),base=`/t/${tenantSlug}/inventory`;

 const handleImport = async (e: React.FormEvent) => {
   e.preventDefault();
   try {
     const res = await fetch('/api/inventory/v1/receipts', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         receiptNo: importForm.receiptNo,
         warehouseId: importForm.warehouseId,
         lines: [{ itemId: importForm.itemId, quantity: Number(importForm.quantity), unitCost: Number(importForm.unitCost) }]
       })
     });
     if (res.ok) { alert('Tạo phiếu nhập kho thành công!'); window.location.reload(); }
     else { const err = await res.json(); alert(`Lỗi nhập kho: ${err.message || 'Thất bại'}`); }
   } catch { alert('Lỗi kết nối máy chủ'); }
 };

 const handleExport = async (e: React.FormEvent) => {
   e.preventDefault();
   try {
     const res = await fetch('/api/inventory/v1/issues', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         issueNo: exportForm.issueNo,
         warehouseId: exportForm.warehouseId,
         referenceType: exportForm.referenceType,
         referenceId: exportForm.referenceId,
         lines: [{ itemId: exportForm.itemId, quantity: Number(exportForm.quantity) }]
       })
     });
     if (res.ok) { alert('Tạo phiếu xuất kho thành công!'); window.location.reload(); }
     else { const err = await res.json(); alert(`Lỗi xuất kho: ${err.message || 'Không đủ tồn kho khả dụng'}`); }
   } catch { alert('Lỗi kết nối máy chủ'); }
 };

 return <main className={styles.page}><header><div><small>OPERATIONS · INVENTORY</small><h1>Kho & Vật tư</h1><p>Theo dõi tồn thực tế, khả dụng và luân chuyển vật tư theo từng kho.</p></div><div style={{display:'flex',gap:'8px'}}><button style={{padding:'8px 14px',background:'#125b45',color:'#fff',border:0,borderRadius:'6px',cursor:'pointer',fontWeight:600}} onClick={()=>setShowImportModal(true)}>+ Nhập kho</button><button style={{padding:'8px 14px',background:'#e06544',color:'#fff',border:0,borderRadius:'6px',cursor:'pointer',fontWeight:600}} onClick={()=>setShowExportModal(true)}>- Xuất kho</button><a href={`/t/${tenantSlug}`} style={{padding:'8px 14px',background:'#fff',border:'1px solid #c9d9d3',borderRadius:'6px',textDecoration:'none',color:'#333',fontWeight:600}}>← Portal</a></div></header>
 <nav>{[['dashboard','Tổng quan',base],['assets','Tài sản & BOM',`${base}/assets`],['items','Vật tư',`${base}/items`],['warehouses','Kho & vị trí',`${base}/warehouses`],['stock','Tồn kho',`${base}/stock`],['serials','Serial',`${base}/serials`],['reservations','Giữ chỗ',`${base}/reservations`],['transactions','Sổ cái',`${base}/transactions`]].map(([id,label,url])=><a className={view===id?styles.active:''} href={url} key={id}>{label}</a>)}</nav>
 {view==='dashboard'?<><section className={styles.metrics}><Metric label="Tài sản kỹ thuật" value={data.assets.length}/><Metric label="Kho hoạt động" value={data.warehouses.length}/><Metric label="Mã vật tư" value={data.items.length}/><Metric label="Tồn khả dụng" value={available}/><Metric label="Cảnh báo tồn thấp" value={data.lowStock.length} warn/></section><section className={styles.cards}><article><span>ASSET MANAGEMENT</span><h2>{data.assets.filter(x=>x.type==='PLANT').length} nhà máy</h2><p>{data.assets.filter(x=>x.criticality==='CRITICAL').length} tài sản mức Critical</p></article><article><span>INVENTORY OPERATIONS</span><h2>{total.toLocaleString('vi-VN')} tồn vật lý</h2><p>{data.transactions.length} giao dịch gần nhất</p></article><article><span>RESERVATION & SERIAL</span><h2>{data.reservations.length} phiếu giữ chỗ</h2><p>{data.serials.length} serial đang theo dõi</p></article></section><Balances rows={data.balances}/></>:null}
 {view==='assets'?<AssetTreeExplorer assets={data.assets}/>:null}
 {view==='items'?<section className={styles.panel}><h2>Material Master — Danh mục vật tư</h2><table><thead><tr><th>Mã SKU</th><th>Tên vật tư</th><th>Nhóm</th><th>Nhà sản xuất</th><th>ĐVT</th><th>Theo dõi</th><th>Min / ROP / Max</th></tr></thead><tbody>{data.items.map(x=><tr key={x.id}><td><b>{x.code}</b></td><td>{x.name}</td><td>{x.category??'—'}</td><td>{x.manufacturer??'—'}</td><td>{x.uom}</td><td>{x.trackingType}</td><td>{x.minStock} / {x.reorderPoint??0} / {x.maxStock}</td></tr>)}</tbody></table><Empty show={!data.items.length}/></section>:null}
 {view==='warehouses'?<section className={styles.cards}>{data.warehouses.map(x=><article key={x.id}><span>{x.plantCode??'TOÀN CÔNG TY'} · {x.warehouseType??x.type}</span><h2>{x.code}</h2><p>{x.name}</p>{x.address?<small>{x.address}</small>:null}<strong>{x.locationCount} vị trí · {x.itemCount} SKU · {x.totalOnHand.toLocaleString('vi-VN')} đơn vị</strong></article>)}<Empty show={!data.warehouses.length}/></section>:null}
 {view==='stock'?<Balances rows={data.balances}/>:null}
 {view==='serials'?<section className={styles.panel}><h2>Vòng đời Serial / Rotable</h2><table><thead><tr><th>SKU</th><th>Vật tư</th><th>Serial nhà sản xuất</th><th>Mã nội bộ</th><th>Trạng thái</th><th>Vị trí hiện tại</th></tr></thead><tbody>{data.serials.map(x=><tr key={x.id}><td><b>{x.itemCode}</b></td><td>{x.itemName}</td><td>{x.serialNumber}</td><td>{x.internalCode??'—'}</td><td>{x.status}</td><td>{x.assetCode??x.warehouseCode??x.locationType}</td></tr>)}</tbody></table><Empty show={!data.serials.length}/></section>:null}
 {view==='reservations'?<section className={styles.panel}><h2>Phiếu giữ chỗ vật tư</h2><table><thead><tr><th>Mã phiếu</th><th>Tham chiếu</th><th>Trạng thái</th><th>Số dòng</th><th>Tổng giữ chỗ</th><th>Hết hạn</th></tr></thead><tbody>{data.reservations.map(x=><tr key={x.id}><td><b>{x.code}</b></td><td>{x.referenceType}<small>{x.referenceId}</small></td><td>{x.status}</td><td>{x.lineCount}</td><td>{x.totalReserved}</td><td>{x.expiresAt?new Intl.DateTimeFormat('vi-VN',{dateStyle:'short'}).format(new Date(x.expiresAt)):'—'}</td></tr>)}</tbody></table><Empty show={!data.reservations.length}/></section>:null}
 {view==='transactions'?<section className={styles.panel}><h2>Sổ cái giao dịch kho</h2><p>{data.transactions.length} giao dịch gần nhất, sắp xếp theo thời gian phát sinh.</p><table><thead><tr><th>Chứng từ</th><th>Thời gian</th><th>Loại</th><th>Vật tư</th><th>Kho</th><th>Biến động</th><th>Số dư</th><th>Tham chiếu</th></tr></thead><tbody>{data.transactions.map(x=><tr key={x.id}><td><b>{x.code}</b></td><td>{new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short'}).format(new Date(x.date))}</td><td>{x.type}</td><td><b>{x.itemCode}</b><small>{x.itemName}</small></td><td>{x.warehouseCode}</td><td className={x.quantity<0?styles.low:''}>{x.quantity>0?'+':''}{x.quantity}</td><td>{x.balanceBefore} → {x.balanceAfter}</td><td>{x.referenceType}<small>{x.referenceId}</small></td></tr>)}</tbody></table><Empty show={!data.transactions.length}/></section>:null}

 {showImportModal && (
   <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999}}>
     <div style={{background:'#fff',borderRadius:'14px',width:'480px',padding:'24px',boxShadow:'0 10px 30px rgba(0,0,0,0.2)'}}>
       <h3 style={{margin:'0 0 16px',color:'#125b45'}}>+ Lập phiếu Nhập kho (Goods Receipt)</h3>
       <form onSubmit={handleImport}>
         <div style={{marginBottom:'12px'}}><label style={{display:'block',fontSize:'12px',fontWeight:600,color:'#555',marginBottom:'4px'}}>Số chứng từ / Mã phiếu</label><input required style={{width:'100%',boxSizing:'border-box',padding:'8px',border:'1px solid #ccc',borderRadius:'6px'}} value={importForm.receiptNo} onChange={e=>setImportForm({...importForm,receiptNo:e.target.value})}/></div>
         <div style={{marginBottom:'12px'}}><label style={{display:'block',fontSize:'12px',fontWeight:600,color:'#555',marginBottom:'4px'}}>Nhập vào kho</label><select style={{width:'100%',padding:'8px',border:'1px solid #ccc',borderRadius:'6px'}} value={importForm.warehouseId} onChange={e=>setImportForm({...importForm,warehouseId:e.target.value})}>{data.warehouses.map(w=><option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}</select></div>
         <div style={{marginBottom:'12px'}}><label style={{display:'block',fontSize:'12px',fontWeight:600,color:'#555',marginBottom:'4px'}}>Vật tư / SKU</label><select style={{width:'100%',padding:'8px',border:'1px solid #ccc',borderRadius:'6px'}} value={importForm.itemId} onChange={e=>setImportForm({...importForm,itemId:e.target.value})}>{data.items.map(it=><option key={it.id} value={it.id}>{it.code} - {it.name} ({it.uom})</option>)}</select></div>
         <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'16px'}}>
           <div><label style={{display:'block',fontSize:'12px',fontWeight:600,color:'#555',marginBottom:'4px'}}>Số lượng nhập</label><input type="number" min="1" required style={{width:'100%',boxSizing:'border-box',padding:'8px',border:'1px solid #ccc',borderRadius:'6px'}} value={importForm.quantity} onChange={e=>setImportForm({...importForm,quantity:Number(e.target.value)})}/></div>
           <div><label style={{display:'block',fontSize:'12px',fontWeight:600,color:'#555',marginBottom:'4px'}}>Đơn giá (VNĐ)</label><input type="number" min="0" style={{width:'100%',boxSizing:'border-box',padding:'8px',border:'1px solid #ccc',borderRadius:'6px'}} value={importForm.unitCost} onChange={e=>setImportForm({...importForm,unitCost:Number(e.target.value)})}/></div>
         </div>
         <div style={{display:'flex',justifyContent:'flex-end',gap:'10px'}}>
           <button type="button" style={{padding:'8px 14px',background:'#fff',border:'1px solid #ccc',borderRadius:'6px',cursor:'pointer'}} onClick={()=>setShowImportModal(false)}>Hủy</button>
           <button type="submit" style={{padding:'8px 14px',background:'#125b45',color:'#fff',border:0,borderRadius:'6px',cursor:'pointer',fontWeight:600}}>Xác nhận Nhập kho</button>
         </div>
       </form>
     </div>
   </div>
 )}

 {showExportModal && (
   <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999}}>
     <div style={{background:'#fff',borderRadius:'14px',width:'480px',padding:'24px',boxShadow:'0 10px 30px rgba(0,0,0,0.2)'}}>
       <h3 style={{margin:'0 0 16px',color:'#e06544'}}>- Lập phiếu Xuất kho (Goods Issue)</h3>
       <form onSubmit={handleExport}>
         <div style={{marginBottom:'12px'}}><label style={{display:'block',fontSize:'12px',fontWeight:600,color:'#555',marginBottom:'4px'}}>Mã phiếu xuất</label><input required style={{width:'100%',boxSizing:'border-box',padding:'8px',border:'1px solid #ccc',borderRadius:'6px'}} value={exportForm.issueNo} onChange={e=>setExportForm({...exportForm,issueNo:e.target.value})}/></div>
         <div style={{marginBottom:'12px'}}><label style={{display:'block',fontSize:'12px',fontWeight:600,color:'#555',marginBottom:'4px'}}>Xuất từ kho</label><select style={{width:'100%',padding:'8px',border:'1px solid #ccc',borderRadius:'6px'}} value={exportForm.warehouseId} onChange={e=>setExportForm({...exportForm,warehouseId:e.target.value})}>{data.warehouses.map(w=><option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}</select></div>
         <div style={{marginBottom:'12px'}}><label style={{display:'block',fontSize:'12px',fontWeight:600,color:'#555',marginBottom:'4px'}}>Vật tư / SKU cần xuất</label><select style={{width:'100%',padding:'8px',border:'1px solid #ccc',borderRadius:'6px'}} value={exportForm.itemId} onChange={e=>setExportForm({...exportForm,itemId:e.target.value})}>{data.items.map(it=><option key={it.id} value={it.id}>{it.code} - {it.name} ({it.uom})</option>)}</select></div>
         <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'16px'}}>
           <div><label style={{display:'block',fontSize:'12px',fontWeight:600,color:'#555',marginBottom:'4px'}}>Số lượng xuất</label><input type="number" min="1" required style={{width:'100%',boxSizing:'border-box',padding:'8px',border:'1px solid #ccc',borderRadius:'6px'}} value={exportForm.quantity} onChange={e=>setExportForm({...exportForm,quantity:Number(e.target.value)})}/></div>
           <div><label style={{display:'block',fontSize:'12px',fontWeight:600,color:'#555',marginBottom:'4px'}}>Mã Work Order tham chiếu</label><input style={{width:'100%',boxSizing:'border-box',padding:'8px',border:'1px solid #ccc',borderRadius:'6px'}} value={exportForm.referenceId} onChange={e=>setExportForm({...exportForm,referenceId:e.target.value})}/></div>
         </div>
         <div style={{display:'flex',justifyContent:'flex-end',gap:'10px'}}>
           <button type="button" style={{padding:'8px 14px',background:'#fff',border:'1px solid #ccc',borderRadius:'6px',cursor:'pointer'}} onClick={()=>setShowExportModal(false)}>Hủy</button>
           <button type="submit" style={{padding:'8px 14px',background:'#e06544',color:'#fff',border:0,borderRadius:'6px',cursor:'pointer',fontWeight:600}}>Xác nhận Xuất kho</button>
         </div>
       </form>
     </div>
   </div>
 )}
 </main>;
}
function Metric({label,value,warn=false}:{label:string;value:number;warn?:boolean}){return <article className={warn?styles.warn:''}><span>{label}</span><strong>{value.toLocaleString('vi-VN')}</strong></article>}
function Balances({rows}:{rows:InventoryWorkspaceDto['balances']}){return <section className={styles.panel}><h2>Tồn kho theo SKU</h2><table><thead><tr><th>Vật tư</th><th>Kho</th><th>On-hand</th><th>Đã giữ</th><th>Khả dụng</th></tr></thead><tbody>{rows.map(x=><tr key={`${x.warehouseId}-${x.itemId}`}><td><b>{x.itemCode}</b><small>{x.itemName}</small></td><td>{x.warehouseCode}</td><td>{x.onHand} {x.uom}</td><td>{x.reserved}</td><td className={x.available<=x.minStock?styles.low:''}>{x.available}</td></tr>)}</tbody></table><Empty show={!rows.length}/></section>}
function Empty({show}:{show:boolean}){return show?<p className={styles.empty}>Chưa có dữ liệu. Hãy tạo kho, vật tư và phiếu nhập đầu tiên qua API.</p>:null}
