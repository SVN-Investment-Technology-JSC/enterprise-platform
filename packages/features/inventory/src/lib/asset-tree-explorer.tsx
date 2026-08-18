'use client';
import type { AssetSummaryDto } from '@enterprise-platform/contract-inventory';
import { useMemo, useState } from 'react';
import styles from './asset-tree-explorer.module.css';

const typeLabel = { PLANT: 'Nhà máy', SYSTEM: 'Hệ thống', EQUIPMENT: 'Thiết bị', COMPONENT: 'Chi tiết' };

export function AssetTreeExplorer({ assets: initialAssets }: { assets: AssetSummaryDto[] }) {
  const [assets, setAssets] = useState<AssetSummaryDto[]>(initialAssets);
  const [selectedId, setSelectedId] = useState(assets[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'timeline' | 'procedures'>('overview');
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditSpecsModal, setShowEditSpecsModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const selected = assets.find(x => x.id === selectedId) ?? assets[0];

  // Forms
  const [newAsset, setNewAsset] = useState({
    code: '',
    name: '',
    type: 'EQUIPMENT' as 'PLANT' | 'SYSTEM' | 'EQUIPMENT' | 'COMPONENT',
    criticality: 'MEDIUM' as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
    serialNumber: '',
    specs: '{\n  "CongSuat": "50MW",\n  "HangSanXuat": "Andritz"\n}'
  });

  const [editSpecs, setEditSpecs] = useState({
    status: selected?.status ?? 'OPERATING',
    criticality: selected?.criticality ?? 'MEDIUM',
    specsJson: JSON.stringify(selected?.specs ?? {}, null, 2)
  });

  const [newDoc, setNewDoc] = useState({
    title: '',
    docType: 'manual' as 'manual' | 'cocq' | 'test_report' | 'drawing' | 'procedure',
    fileName: '',
    fileUrl: '',
    fileSize: '2.5 MB'
  });

  const visible = useMemo(() => {
    if (!query.trim()) return new Set(assets.map(x => x.id));
    const found = new Set<string>();
    for (const item of assets) {
      if (`${item.code} ${item.name}`.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi'))) {
        let current: AssetSummaryDto | undefined = item;
        while (current) {
          found.add(current.id);
          current = assets.find(x => x.id === current?.parentId);
        }
      }
    }
    return found;
  }, [assets, query]);

  const roots = assets.filter(x => !x.parentId);

  // Handlers
  const handleOpenAdd = (parent?: AssetSummaryDto) => {
    const parentCode = parent ? parent.code : 'DKR';
    const childType = parent ? (parent.type === 'PLANT' ? 'SYSTEM' : parent.type === 'SYSTEM' ? 'EQUIPMENT' : 'COMPONENT') : 'PLANT';
    const seq = String(assets.filter(a => a.parentId === parent?.id).length + 1).padStart(2, '0');
    setNewAsset({
      code: `${parentCode}-${childType.slice(0, 3)}-${seq}`,
      name: '',
      type: childType,
      criticality: 'MEDIUM',
      serialNumber: `SN-${parentCode}-${seq}`,
      specs: '{\n  "CongSuat": "50MW",\n  "HangSanXuat": "Andritz"\n}'
    });
    setShowAddModal(true);
  };

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const parsedSpecs = JSON.parse(newAsset.specs || '{}');
      
      const res = await fetch('/api/inventory/v1/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: newAsset.code,
          name: newAsset.name,
          parentId: selected?.id,
          type: newAsset.type,
          criticality: newAsset.criticality,
          serialNumber: newAsset.serialNumber,
          specs: parsedSpecs
        })
      });
      if (!res.ok) throw new Error(await apiError(res, 'Không thể thêm thiết bị.'));
      const created = await res.json();
      setAssets(prev => [...prev, created]);
      setSelectedId(created.id);
      setShowAddModal(false);
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Không thể thêm thiết bị.'); }
    finally { setSaving(false); }
  };

  const handleUpdateSpecs = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      let parsed = {};
      try { parsed = JSON.parse(editSpecs.specsJson); } catch { throw new Error('JSON thông số không hợp lệ.'); }
      const response = await fetch(`/api/inventory/v1/assets/${selected.id}/specs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specs: parsed,
          status: editSpecs.status,
          criticality: editSpecs.criticality
        })
      });
      if (!response.ok) throw new Error(await apiError(response, 'Không thể lưu thông số.'));
      const updated = await response.json() as AssetSummaryDto;
      setAssets(prev => prev.map(a => a.id === updated.id ? {...a, ...updated} : a));
      setShowEditSpecsModal(false);
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Không thể lưu thông số.'); }
    finally { setSaving(false); }
  };

  const handleUploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const response=await fetch(`/api/inventory/v1/assets/${selected.id}/documents`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(newDoc)});
      if(!response.ok)throw new Error(await apiError(response,'Không thể lưu tài liệu.'));
      const document=await response.json();
      setAssets(prev=>prev.map(a=>a.id===selected.id?{...a,documents:[document,...(a.documents??[])]}:a));
      setShowUploadModal(false);
    } catch(error){setFormError(error instanceof Error?error.message:'Không thể lưu tài liệu.');}
    finally{setSaving(false);}
  };

  return (
    <section className={styles.explorer}>
      <aside>
        <div className={styles.treeHead}>
          <span>ASSET HIERARCHY</span>
          <strong>Cây tài sản Minh Long</strong>
          <input
            aria-label="Tìm tài sản"
            onChange={e => setQuery(e.target.value)}
            placeholder="Tìm theo mã hoặc tên thiết bị..."
            value={query}
          />
          <div className={styles.treeActions}>
            <button onClick={() => handleOpenAdd(selected)}>+ Thêm thiết bị con</button>
          </div>
        </div>
        <div className={styles.tree}>
          {roots.map(x => (
            <TreeNode
              key={x.id}
              node={x}
              assets={assets}
              visible={visible}
              selectedId={selected?.id}
              onSelect={setSelectedId}
            />
          ))}
        </div>
      </aside>

      {selected ? (
        <article className={styles.profile}>
          <header>
            <div>
              <span>{typeLabel[selected.type]} · ASSET 360°</span>
              <h2>{selected.name}</h2>
              <p>{selected.code}</p>
            </div>
            <div className={styles.actions}>
              <button onClick={() => {
                setEditSpecs({
                  status: selected.status,
                  criticality: selected.criticality,
                  specsJson: JSON.stringify(selected.specs ?? {}, null, 2)
                });
                setShowEditSpecsModal(true);
              }}>
                Chỉnh sửa thông số
              </button>
              <button className={styles.primary} onClick={() => handleOpenAdd(selected)}>+ Thêm phụ tùng</button>
            </div>
          </header>

          <section className={styles.status}>
            <div>
              <small>Tình trạng</small>
              <strong>{selected.status}</strong>
            </div>
            <div>
              <small>Độ quan trọng</small>
              <strong>{selected.criticality}</strong>
            </div>
            <div>
              <small>Mã Serial phân tầng</small>
              <strong>{selected.serialNumber ?? 'Chưa khai báo'}</strong>
            </div>
            <div>
              <small>Mã QR định danh</small>
              <strong>{selected.qrCode ?? selected.code}</strong>
            </div>
          </section>

          {/* Navigation Tabs */}
          <div className={styles.tabs}>
            <button className={activeTab === 'overview' ? styles.tabActive : ''} onClick={() => setActiveTab('overview')}>
              Tổng quan & BOM
            </button>
            <button className={activeTab === 'documents' ? styles.tabActive : ''} onClick={() => setActiveTab('documents')}>
              Tài liệu kỹ thuật ({selected.documents?.length || 0})
            </button>
            <button className={activeTab === 'timeline' ? styles.tabActive : ''} onClick={() => setActiveTab('timeline')}>
              Lịch sử vận hành & bảo trì ({selected.maintenanceHistory?.length || 0})
            </button>
            <button className={activeTab === 'procedures' ? styles.tabActive : ''} onClick={() => setActiveTab('procedures')}>
              Quy trình bảo trì
            </button>
          </div>

          {/* Tab Content 1: Overview */}
          {activeTab === 'overview' && (
            <div className={styles.columns}>
              <section>
                <h3>Thông số kỹ thuật</h3>
                {selected.specs && Object.keys(selected.specs).length ? (
                  <dl>
                    {Object.entries(selected.specs).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className={styles.muted}>Chưa có thông số kỹ thuật. Bấm "Chỉnh sửa thông số" để cập nhật.</p>
                )}
              </section>
              <section>
                <h3>
                  BOM phụ tùng tiêu chuẩn <span>{selected.bomCount ?? selected.bom?.length ?? 0}</span>
                </h3>
                {selected.bom && selected.bom.length ? (
                  <ul>
                    {selected.bom.map(x => (
                      <li key={x.itemCode}>
                        <div>
                          <b>{x.itemName}</b>
                          <small>{x.itemCode}</small>
                        </div>
                        <strong>{x.quantity}{x.critical ? ' · Critical' : ''}</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.muted}>Node này chưa gắn BOM phụ tùng.</p>
                )}
              </section>
            </div>
          )}

          {/* Tab Content 2: Documents */}
          {activeTab === 'documents' && (
            <div className={styles.tabContent}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0 }}>Hồ sơ & Tài liệu kỹ thuật PDF</h3>
                <button style={{ padding: '8px 14px', background: '#125b45', color: '#fff', border: 0, borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }} onClick={() => setShowUploadModal(true)}>
                  + Upload Tài liệu PDF
                </button>
              </div>
              <div className={styles.docList}>
                {selected.documents?.map(doc => (
                  <div key={doc.id} className={styles.docCard}>
                    <div>
                      <strong style={{ display: 'block', fontSize: '14px', color: '#1a4135' }}>{doc.title}</strong>
                      <span style={{ fontSize: '12px', color: '#748b83' }}>{doc.fileName} · {doc.fileSize} · Loại: {doc.docType.toUpperCase()}</span>
                    </div>
                    <a href={doc.fileUrl} target="_blank" rel="noreferrer">Xem PDF ↗</a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab Content 3: Timeline */}
          {activeTab === 'timeline' && (
            <div className={styles.tabContent}>
              <h3 style={{ marginTop: 0 }}>Lịch sử Vận hành & Sự cố bảo trì</h3>
              <div className={styles.timelineList}>
                {selected.maintenanceHistory?.map(ev => (
                  <div key={ev.id} className={styles.timelineCard}>
                    <i />
                    <div style={{ flex: 1 }}>
                      <h4>{ev.title} <span style={{ fontSize: '11px', padding: '2px 8px', background: '#e1ede8', color: '#165742', borderRadius: '12px', marginLeft: '6px' }}>{ev.type}</span></h4>
                      <p>{ev.note}</p>
                      {ev.replacedParts && ev.replacedParts.length > 0 && (
                        <p style={{ fontSize: '12px', color: '#b94726' }}>Phụ tùng thay thế: <b>{ev.replacedParts.join(', ')}</b></p>
                      )}
                      <span>Thực hiện: {ev.technician} · Ngày: {new Intl.DateTimeFormat('vi-VN').format(new Date(ev.date))}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab Content 4: Procedures */}
          {activeTab === 'procedures' && (
            <div className={styles.tabContent}>
              <h3 style={{ marginTop: 0 }}>Quy trình & Hướng dẫn Bảo dưỡng Tiêu chuẩn</h3>
              {selected.procedures?.map(proc => (
                <div key={proc.id} style={{ background: '#f8faf9', border: '1px solid #dce8e3', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <strong style={{ fontSize: '16px', color: '#154b3c' }}>{proc.title}</strong>
                    <span style={{ fontSize: '12px', background: '#e0efe9', padding: '3px 9px', borderRadius: '12px', color: '#165843' }}>Chu kỳ: {proc.frequency} · Thời lượng: {proc.estimatedDuration}</span>
                  </div>
                  {proc.safetyNotes && (
                    <div style={{ background: '#fdf3ef', borderLeft: '4px solid #e06544', padding: '8px 12px', fontSize: '13px', color: '#913b22', marginBottom: '14px' }}>
                      ⚠️ <b>Lưu ý an toàn:</b> {proc.safetyNotes}
                    </div>
                  )}
                  <table style={{ width: '100%', textAlign: 'left', fontSize: '13px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #d8e5e0', color: '#5b766d' }}>
                        <th style={{ padding: '8px 4px', width: '60px' }}>Bước</th>
                        <th style={{ padding: '8px 4px', width: '200px' }}>Hạng mục</th>
                        <th style={{ padding: '8px 4px' }}>Nội dung thao tác</th>
                        <th style={{ padding: '8px 4px', width: '180px' }}>Dụng cụ yêu cầu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proc.steps.map(s => (
                        <tr key={s.stepNo} style={{ borderBottom: '1px solid #edf3f1' }}>
                          <td style={{ padding: '10px 4px', fontWeight: 'bold' }}>{s.stepNo}</td>
                          <td style={{ padding: '10px 4px', color: '#19493b' }}><b>{s.title}</b></td>
                          <td style={{ padding: '10px 4px', color: '#4a655c' }}>{s.description}</td>
                          <td style={{ padding: '10px 4px', color: '#748b83' }}>{s.toolRequired || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </article>
      ) : (
        <div className={styles.empty}>Không tìm thấy tài sản.</div>
      )}

      {/* Modal 1: Add Asset */}
      {showAddModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>+ Thêm thiết bị / Phụ tùng mới</h3>
            <form onSubmit={handleCreateAsset}>
              <div className={styles.formGroup}>
                <label>Mã thiết bị (Quy định phân tầng)</label>
                <input required value={newAsset.code} onChange={e => setNewAsset({ ...newAsset, code: e.target.value })} />
              </div>
              <div className={styles.formGroup}>
                <label>Tên thiết bị / Phụ tùng</label>
                <input required value={newAsset.name} onChange={e => setNewAsset({ ...newAsset, name: e.target.value })} placeholder="VD: Gối trục tuabin số 1" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className={styles.formGroup}>
                  <label>Cấp bậc phân tầng</label>
                  <select value={newAsset.type} onChange={e => setNewAsset({ ...newAsset, type: e.target.value as typeof newAsset.type })}>
                    <option value="PLANT">Nhà máy (PLANT)</option>
                    <option value="SYSTEM">Hệ thống (SYSTEM)</option>
                    <option value="EQUIPMENT">Thiết bị (EQUIPMENT)</option>
                    <option value="COMPONENT">Chi tiết / Phụ tùng (COMPONENT)</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Độ quan trọng</label>
                  <select value={newAsset.criticality} onChange={e => setNewAsset({ ...newAsset, criticality: e.target.value as typeof newAsset.criticality })}>
                    <option value="CRITICAL">Critical (Sống còn)</option>
                    <option value="HIGH">High (Cao)</option>
                    <option value="MEDIUM">Medium (Trung bình)</option>
                    <option value="LOW">Low (Thấp)</option>
                  </select>
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Số Serial phân tầng (Manufacturer / Internal)</label>
                <input value={newAsset.serialNumber} onChange={e => setNewAsset({ ...newAsset, serialNumber: e.target.value })} placeholder="VD: SN-HPP-GEN-01" />
              </div>
              <div className={styles.formGroup}>
                <label>Thông số kỹ thuật ban đầu (JSON Specs)</label>
                <textarea rows={3} value={newAsset.specs} onChange={e => setNewAsset({ ...newAsset, specs: e.target.value })} />
              </div>
              {formError ? <p role="alert" className={styles.muted}>{formError}</p> : null}
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancel} onClick={() => setShowAddModal(false)}>Hủy</button>
                <button type="submit" className={styles.submit} disabled={saving}>{saving ? 'Đang lưu…' : 'Tạo thiết bị'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Edit Specs */}
      {showEditSpecsModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>Chỉnh sửa thông số & Trạng thái: {selected?.code}</h3>
            <form onSubmit={handleUpdateSpecs}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className={styles.formGroup}>
                  <label>Trạng thái vận hành</label>
                  <select value={editSpecs.status} onChange={e => setEditSpecs({ ...editSpecs, status: e.target.value })}>
                    <option value="OPERATING">OPERATING (Đang chạy)</option>
                    <option value="MAINTENANCE">MAINTENANCE (Bảo trì)</option>
                    <option value="STOPPED">STOPPED (Dừng sự cố)</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Độ quan trọng</label>
                  <select value={editSpecs.criticality} onChange={e => setEditSpecs({ ...editSpecs, criticality: e.target.value })}>
                    <option value="CRITICAL">CRITICAL</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Thông số kỹ thuật JSON (Dynamic Attributes)</label>
                <textarea rows={6} value={editSpecs.specsJson} onChange={e => setEditSpecs({ ...editSpecs, specsJson: e.target.value })} />
              </div>
              {formError ? <p role="alert" className={styles.muted}>{formError}</p> : null}
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancel} onClick={() => setShowEditSpecsModal(false)}>Hủy</button>
                <button type="submit" className={styles.submit} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu thông số'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Upload Document */}
      {showUploadModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>Đăng ký tài liệu kỹ thuật PDF: {selected?.code}</h3>
            <form onSubmit={handleUploadDoc}>
              <div className={styles.formGroup}>
                <label>Tên tài liệu / Tiêu đề</label>
                <input required value={newDoc.title} onChange={e => setNewDoc({ ...newDoc, title: e.target.value })} placeholder="VD: Hướng dẫn tháo lắp ổ đỡ Tuabin" />
              </div>
              <div className={styles.formGroup}>
                <label>Phân loại tài liệu</label>
                <select value={newDoc.docType} onChange={e => setNewDoc({ ...newDoc, docType: e.target.value as typeof newDoc.docType })}>
                  <option value="manual">Tài liệu O&M (Manual)</option>
                  <option value="cocq">Chứng nhận CO/CQ</option>
                  <option value="test_report">Biên bản thử nghiệm (Test Report)</option>
                  <option value="drawing">Bản vẽ kỹ thuật (Drawing)</option>
                  <option value="procedure">Quy trình vận hành</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>Tên file PDF</label>
                <input required value={newDoc.fileName} onChange={e => setNewDoc({ ...newDoc, fileName: e.target.value })} placeholder="manual-thiet-bi.pdf" />
              </div>
              <div className={styles.formGroup}>
                <label>URL file trên kho tài liệu</label>
                <input required type="url" value={newDoc.fileUrl} onChange={e => setNewDoc({ ...newDoc, fileUrl: e.target.value })} placeholder="https://storage.example/manual-thiet-bi.pdf" />
              </div>
              {formError ? <p role="alert" className={styles.muted}>{formError}</p> : null}
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancel} onClick={() => setShowUploadModal(false)}>Hủy</button>
                <button type="submit" className={styles.submit} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu tài liệu'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

async function apiError(response:Response,fallback:string){try{const body=await response.json() as {message?:string};return body.message||fallback;}catch{return fallback;}}

function TreeNode({
  node,
  assets,
  visible,
  selectedId,
  onSelect
}: {
  node: AssetSummaryDto;
  assets: AssetSummaryDto[];
  visible: Set<string>;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const children = assets.filter(x => x.parentId === node.id && visible.has(x.id));
  if (!visible.has(node.id)) return null;

  return (
    <div className={styles.branch}>
      <button className={selectedId === node.id ? styles.selected : ''} onClick={() => onSelect(node.id)}>
        <i className={`${styles.dot} ${styles[node.status.toLowerCase()] ?? ''}`} />
        <span>
          <b>{node.name}</b>
          <small>{node.code} · {typeLabel[node.type]}</small>
        </span>
        <em>{children.length || ''}</em>
      </button>
      {children.length ? (
        <div className={styles.children}>
          {children.map(x => (
            <TreeNode
              key={x.id}
              node={x}
              assets={assets}
              visible={visible}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
