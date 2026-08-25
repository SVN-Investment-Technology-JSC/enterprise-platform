import type {
  OrganizationUnit,
  TenantOrganizationContext,
} from '@enterprise-platform/contracts-organization';
import { useMemo, useState, useEffect } from 'react';
import {
  assignOrganizationMember,
  createOrganizationNode,
  loadCoreSnapshot,
  type PlatformCoreOrganizationSnapshot,
  type PlatformUser,
} from '../organization-api';
import styles from './procedure-engine.module.scss';

export function OrganizationBoard({
  organization,
  onReload,
}: {
  organization: TenantOrganizationContext;
  onReload?: () => Promise<void>;
}) {
  const units = useMemo(() => organization.units ?? [], [organization.units]);
  const members = useMemo(() => organization.members ?? [], [organization.members]);
  const unitTypes = useMemo(() => organization.unitTypes ?? [], [organization.unitTypes]);

  const [selectedId, setSelectedId] = useState<string | undefined>(() => units[0]?.id);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(units.map((u) => u.id)));
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddUnitModal, setShowAddUnitModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [coreSnapshot, setCoreSnapshot] = useState<PlatformCoreOrganizationSnapshot>();
  const [actionError, setActionError] = useState<string>();
  const [busyAction, setBusyAction] = useState(false);

  // Form states cho thêm đơn vị / phòng ban
  const [newUnitName, setNewUnitName] = useState('');
  const [newUnitCode, setNewUnitCode] = useState('');
  const [newUnitTypeId, setNewUnitTypeId] = useState('');
  const [newUnitParentId, setNewUnitParentId] = useState<string>('');
  const [newUnitDescription, setNewUnitDescription] = useState('');

  // Form states cho thêm nhân sự
  const [selectedUserId, setSelectedUserId] = useState('');
  const [memberCustomName, setMemberCustomName] = useState('');
  const [memberPosition, setMemberPosition] = useState('');
  const [isHead, setIsHead] = useState(false);
  const [targetUnitId, setTargetUnitId] = useState('');

  // Nạp core snapshot để có treeId, nodeTypes đầy đủ và danh sách platform users
  useEffect(() => {
    void loadCoreSnapshot().then((data) => {
      if (data) {
        setCoreSnapshot(data);
        if (data.nodeTypes.length > 0 && !newUnitTypeId) {
          const defaultUnitType = data.nodeTypes.find((t) => t.category === 'unit') ?? data.nodeTypes[0];
          setNewUnitTypeId(defaultUnitType.id);
        }
      }
    });
  }, [newUnitTypeId]);

  const selected = useMemo(() => {
    return units.find((unit) => unit.id === selectedId) ?? units[0];
  }, [units, selectedId]);

  const roots = useMemo(() => {
    return units.filter((unit) => !unit.parentId);
  }, [units]);

  const childrenMap = useMemo(() => {
    const map = new Map<string, OrganizationUnit[]>();
    for (const unit of units) {
      if (unit.parentId) {
        const list = map.get(unit.parentId) ?? [];
        list.push(unit);
        map.set(unit.parentId, list);
      }
    }
    return map;
  }, [units]);

  const toggleExpand = (unitId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) {
        next.delete(unitId);
      } else {
        next.add(unitId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedIds(new Set(units.map((u) => u.id)));
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  const filteredMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return undefined;
    const matched = new Set<string>();
    const parentOf = new Map(units.map((u) => [u.id, u.parentId]));

    const includeWithAncestors = (id: string) => {
      let cur: string | undefined = id;
      while (cur) {
        matched.add(cur);
        cur = parentOf.get(cur);
      }
    };

    for (const u of units) {
      if (u.name.toLowerCase().includes(q) || u.code.toLowerCase().includes(q)) {
        includeWithAncestors(u.id);
      }
    }
    for (const m of members) {
      if (m.unitId && (m.displayName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))) {
        includeWithAncestors(m.unitId);
      }
    }
    return matched;
  }, [searchQuery, units, members]);

  // Xử lý tạo phòng ban / đơn vị
  const handleOpenAddUnit = (parentId?: string) => {
    setActionError(undefined);
    setNewUnitName('');
    setNewUnitCode(`UNIT_${Math.floor(1000 + Math.random() * 9000)}`);
    setNewUnitParentId(parentId ?? selected?.id ?? '');
    setNewUnitDescription('');
    setShowAddUnitModal(true);
  };

  const handleCreateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUnitName.trim()) {
      setActionError('Vui lòng nhập tên phòng ban/đơn vị.');
      return;
    }
    setBusyAction(true);
    setActionError(undefined);
    try {
      const primaryTree = coreSnapshot?.trees.find((t) => t.isPrimary) ?? coreSnapshot?.trees[0];
      const treeId = primaryTree?.id;
      const typeId = newUnitTypeId || coreSnapshot?.nodeTypes[0]?.id || unitTypes[0]?.id;

      if (treeId && typeId) {
        await createOrganizationNode({
          treeId,
          parentId: newUnitParentId || null,
          nodeTypeId: typeId,
          code: newUnitCode.trim() || `UNIT_${Date.now()}`,
          name: newUnitName.trim(),
          description: newUnitDescription.trim() || undefined,
        });
      }

      setShowAddUnitModal(false);
      if (onReload) await onReload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Không thể tạo phòng ban.');
    } finally {
      setBusyAction(false);
    }
  };

  // Xử lý thêm nhân sự
  const handleOpenAddMember = (unitId?: string) => {
    setActionError(undefined);
    setTargetUnitId(unitId ?? selected?.id ?? units[0]?.id ?? '');
    setSelectedUserId(coreSnapshot?.users[0]?.id ?? '');
    setMemberCustomName('');
    setMemberPosition('');
    setIsHead(false);
    setShowAddMemberModal(true);
  };

  const handleCreateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUnitId) {
      setActionError('Vui lòng chọn phòng ban.');
      return;
    }
    setBusyAction(true);
    setActionError(undefined);
    try {
      if (selectedUserId) {
        await assignOrganizationMember({
          nodeId: targetUnitId,
          userId: selectedUserId,
          isPrimary: isHead,
          note: memberPosition ? `Chức danh: ${memberPosition}` : undefined,
        });
      }
      setShowAddMemberModal(false);
      if (onReload) await onReload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Không thể thêm nhân sự.');
    } finally {
      setBusyAction(false);
    }
  };

  const renderNode = (unit: OrganizationUnit, depth: number) => {
    if (filteredMatches && !filteredMatches.has(unit.id)) return null;

    const children = childrenMap.get(unit.id) ?? [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(unit.id);
    const isSelected = selected?.id === unit.id;

    return (
      <div key={unit.id}>
        <div
          className={`${styles.nodeRow} ${isSelected ? styles.selectedOrgRow : ''}`}
          style={{ paddingLeft: 10 + depth * 20 }}
        >
          {hasChildren ? (
            <button
              type="button"
              className={styles.toggleExpandBtn}
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(unit.id);
              }}
              title={isExpanded ? 'Thu gọn nhánh này' : 'Mở rộng nhánh này'}
              aria-label={isExpanded ? 'Thu gọn' : 'Mở rộng'}
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          ) : (
            <span className={styles.toggleLeafDot}>•</span>
          )}

          <button
            type="button"
            className={styles.orgNodeSelectBtn}
            onClick={() => setSelectedId(unit.id)}
          >
            <i>{unit.typeName.slice(0, 1)}</i>
            <div>
              <strong>{unit.name}</strong>
              <small>
                {unit.typeName} · {unit.memberCount} thành viên
              </small>
            </div>
          </button>
        </div>

        {hasChildren && isExpanded ? (
          <div>{children.map((child) => renderNode(child, depth + 1))}</div>
        ) : null}
      </div>
    );
  };

  return (
    <section className={styles.content}>
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>Tenant Core · Cơ cấu tổ chức</span>
          <h1>Sơ đồ tổ chức</h1>
          <p>
            {unitTypes.length} loại đơn vị · {units.length} đơn vị · {members.length} nhân sự.
          </p>
        </div>
        <div className={styles.orgActionsHeader}>
          <button
            type="button"
            className={`${styles.btnSm} ${styles.btnPrimarySm}`}
            onClick={() => handleOpenAddUnit(selected?.id)}
          >
            + Thêm phòng ban
          </button>
          <button
            type="button"
            className={`${styles.btnSm} ${styles.btnSecondarySm}`}
            onClick={() => handleOpenAddMember(selected?.id)}
          >
            + Thêm nhân sự
          </button>
        </div>
      </div>

      <div className={styles.orgLayout}>
        <article className={styles.orgTree}>
          <header>
            <h3>Cơ cấu doanh nghiệp</h3>
            <span>{units.length} đơn vị</span>
          </header>

          <input
            type="search"
            className={styles.orgSearchInput}
            placeholder="Tìm kiếm phòng ban hoặc nhân sự…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <div className={styles.orgTreeTools}>
            <span>{filteredMatches ? `Lọc: ${filteredMatches.size} đơn vị` : 'Cây phân cấp'}</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button type="button" onClick={expandAll} title="Mở rộng tất cả các nhánh">
                Mở rộng tất cả
              </button>
              <button type="button" onClick={collapseAll} title="Thu gọn tất cả các nhánh">
                Thu gọn tất cả
              </button>
            </div>
          </div>

          <div>{roots.map((root) => renderNode(root, 0))}</div>
        </article>

        <article className={styles.orgDetail}>
          {selected ? (
            <>
              <div className={styles.orgHero}>
                <span>{selected.name.slice(0, 2).toUpperCase()}</span>
                <div style={{ flex: 1 }}>
                  <small>
                    {selected.typeName} · {selected.code}
                  </small>
                  <h3>{selected.name}</h3>
                </div>
                <button
                  type="button"
                  className={`${styles.btnSm} ${styles.btnSecondarySm}`}
                  onClick={() => handleOpenAddUnit(selected.id)}
                  title="Thêm phòng ban con trực thuộc đơn vị này"
                >
                  + Đơn vị con
                </button>
              </div>

              <dl>
                <div>
                  <dt>Trưởng đơn vị</dt>
                  <dd>{selected.headName ?? 'Chưa bổ nhiệm'}</dd>
                </div>
                <div>
                  <dt>Thành viên</dt>
                  <dd>{selected.memberCount} người</dd>
                </div>
                <div>
                  <dt>Đơn vị cấp trên</dt>
                  <dd>
                    {units.find((item) => item.id === selected.parentId)?.name ?? 'Cấp cao nhất'}
                  </dd>
                </div>
              </dl>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '10px',
                }}
              >
                <h4 style={{ margin: 0 }}>Thành viên trong đơn vị</h4>
                <button
                  type="button"
                  className={`${styles.btnSm} ${styles.btnSecondarySm}`}
                  onClick={() => handleOpenAddMember(selected.id)}
                >
                  + Gán nhân sự
                </button>
              </div>

              <div className={styles.memberList}>
                {members
                  .filter((member) => member.unitId === selected.id)
                  .map((member) => (
                    <div key={member.membershipId}>
                      <span>{member.displayName.slice(0, 1).toUpperCase()}</span>
                      <div>
                        <strong>{member.displayName}</strong>
                        <small>{member.positionName ?? member.email}</small>
                      </div>
                      {member.isHead ? <em>Trưởng đơn vị</em> : null}
                    </div>
                  ))}
                {members.every((member) => member.unitId !== selected.id) ? (
                  <p style={{ color: 'var(--pe-text-muted)', fontSize: '13px', margin: '12px 0' }}>
                    Chưa có thành viên trong đơn vị này.
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--pe-text-muted)' }}>Vui lòng chọn một phòng ban.</p>
          )}
        </article>
      </div>

      {/* Modal Thêm Phòng Ban / Đơn Vị */}
      {showAddUnitModal ? (
        <div className={styles.modalBackdrop} onClick={() => setShowAddUnitModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h3>Thêm Phòng Ban / Đơn Vị Mới</h3>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setShowAddUnitModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateUnit}>
              <div className={styles.modalBody}>
                {actionError ? (
                  <div
                    style={{
                      padding: '8px 12px',
                      background: '#fee2e2',
                      color: '#b91c1c',
                      borderRadius: '6px',
                      fontSize: '12.5px',
                    }}
                  >
                    {actionError}
                  </div>
                ) : null}

                <div className={styles.formField}>
                  <label>Tên phòng ban / đơn vị *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Phòng Kỹ Thuật, Ban Giám Đốc..."
                    value={newUnitName}
                    onChange={(e) => setNewUnitName(e.target.value)}
                  />
                </div>

                <div className={styles.formField}>
                  <label>Mã đơn vị *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: DEPT_TECH"
                    value={newUnitCode}
                    onChange={(e) => setNewUnitCode(e.target.value)}
                  />
                </div>

                <div className={styles.formField}>
                  <label>Loại đơn vị *</label>
                  <select
                    value={newUnitTypeId}
                    onChange={(e) => setNewUnitTypeId(e.target.value)}
                  >
                    {(coreSnapshot?.nodeTypes ?? unitTypes).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({'code' in t ? (t as { code: string }).code : (t as { key: string }).key})
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formField}>
                  <label>Đơn vị cấp trên</label>
                  <select
                    value={newUnitParentId}
                    onChange={(e) => setNewUnitParentId(e.target.value)}
                  >
                    <option value="">-- Cấp cao nhất (Gốc) --</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formField}>
                  <label>Mô tả đơn vị</label>
                  <textarea
                    rows={2}
                    placeholder="Chức năng, nhiệm vụ..."
                    value={newUnitDescription}
                    onChange={(e) => setNewUnitDescription(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={`${styles.btnSm} ${styles.btnSecondarySm}`}
                  onClick={() => setShowAddUnitModal(false)}
                  disabled={busyAction}
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className={`${styles.btnSm} ${styles.btnPrimarySm}`}
                  disabled={busyAction}
                >
                  {busyAction ? 'Đang tạo…' : 'Tạo phòng ban'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal Thêm / Gán Nhân Sự */}
      {showAddMemberModal ? (
        <div className={styles.modalBackdrop} onClick={() => setShowAddMemberModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h3>Thêm & Phân Bổ Nhân Sự</h3>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setShowAddMemberModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateMember}>
              <div className={styles.modalBody}>
                {actionError ? (
                  <div
                    style={{
                      padding: '8px 12px',
                      background: '#fee2e2',
                      color: '#b91c1c',
                      borderRadius: '6px',
                      fontSize: '12.5px',
                    }}
                  >
                    {actionError}
                  </div>
                ) : null}

                <div className={styles.formField}>
                  <label>Phòng ban / Đơn vị tiếp nhận *</label>
                  <select
                    value={targetUnitId}
                    onChange={(e) => setTargetUnitId(e.target.value)}
                    required
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formField}>
                  <label>Chọn nhân sự tài khoản *</label>
                  {coreSnapshot?.users && coreSnapshot.users.length > 0 ? (
                    <select
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                      required
                    >
                      {coreSnapshot.users.map((user: PlatformUser) => (
                        <option key={user.id} value={user.id}>
                          {user.fullName} ({user.email})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      placeholder="Nhập tên nhân viên..."
                      value={memberCustomName}
                      onChange={(e) => setMemberCustomName(e.target.value)}
                    />
                  )}
                </div>

                <div className={styles.formField}>
                  <label>Chức vụ / Vị trí đảm nhiệm</label>
                  <input
                    type="text"
                    placeholder="VD: Trưởng phòng, Chuyên viên, Kỹ sư..."
                    value={memberPosition}
                    onChange={(e) => setMemberPosition(e.target.value)}
                  />
                </div>

                <label className={styles.checkboxField}>
                  <input
                    type="checkbox"
                    checked={isHead}
                    onChange={(e) => setIsHead(e.target.checked)}
                  />
                  <span>Chỉ định làm Trưởng đơn vị / Người phụ trách chính</span>
                </label>
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={`${styles.btnSm} ${styles.btnSecondarySm}`}
                  onClick={() => setShowAddMemberModal(false)}
                  disabled={busyAction}
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className={`${styles.btnSm} ${styles.btnPrimarySm}`}
                  disabled={busyAction}
                >
                  {busyAction ? 'Đang lưu…' : 'Xác nhận gán nhân sự'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
