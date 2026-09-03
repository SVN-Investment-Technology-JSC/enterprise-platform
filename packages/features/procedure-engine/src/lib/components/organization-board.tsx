'use client';

import type {
  OrganizationMember,
  OrganizationUnit,
  TenantOrganizationContext,
} from '@enterprise-platform/contracts-organization';
import { useMemo, useState, type FormEvent } from 'react';
import {
  assignOrganizationMember,
  createOrganizationUnit,
  loadPlatformUsers,
  removeOrganizationMember,
  updateOrganizationMember,
} from '../organization-api';
import styles from './procedure-engine.module.scss';

interface PlatformUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

export function OrganizationBoard({
  organization,
  onReload,
}: {
  organization: TenantOrganizationContext;
  onReload?: () => void | Promise<void>;
}) {
  const units = organization.units ?? [];
  const members = organization.members ?? [];
  const unitTypes = organization.unitTypes ?? [];

  const [selectedId, setSelectedId] = useState(units[0]?.id);
  const selected = units.find((unit) => unit.id === selectedId) ?? units[0];
  const roots = units.filter((unit) => !unit.parentId);

  // Modals state
  const [showAddUnitModal, setShowAddUnitModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showEditMemberModal, setShowEditMemberModal] = useState(false);
  const [editMember, setEditMember] = useState<OrganizationMember | null>(null);

  // New Unit Form State
  const [newUnitCode, setNewUnitCode] = useState('');
  const [newUnitName, setNewUnitName] = useState('');
  const [newUnitTypeId, setNewUnitTypeId] = useState(unitTypes[0]?.id ?? '');
  const [newUnitParentId, setNewUnitParentId] = useState<string>('');

  // Add Member Form State
  const [platformUsers, setPlatformUsers] = useState<PlatformUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [memberPosition, setMemberPosition] = useState('');
  const [isHead, setIsHead] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');

  // Edit Member Form State
  const [editPosition, setEditPosition] = useState('');
  const [editIsHead, setEditIsHead] = useState(false);
  const [editTargetUnitId, setEditTargetUnitId] = useState('');

  // Popconfirm state for removing member
  const [deletingMemberId, setDeletingMemberId] = useState<string | null>(null);

  const [busyAction, setBusyAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Filtered members for the selected unit
  const unitMembers = useMemo(
    () => (selected ? members.filter((member) => member.unitId === selected.id) : []),
    [members, selected],
  );

  // Summary Metrics
  const totalUnits = units.length;
  const totalMembers = members.length;
  const assignedMembersCount = members.filter((m) => Boolean(m.unitId)).length;
  const appointedHeadsCount = units.filter((u) => Boolean(u.headMembershipId)).length;

  const openAddMemberModal = async () => {
    setActionError(null);
    setSelectedUserId('');
    setMemberPosition('');
    setIsHead(false);
    setUserSearchQuery('');
    setShowAddMemberModal(true);
    try {
      const users = await loadPlatformUsers();
      setPlatformUsers(users);
      if (users.length > 0) setSelectedUserId(users[0].id);
    } catch {
      // If endpoint not ready, synthesize from organization members or fallback
      const synthetic = members.map((m) => ({
        id: m.userId,
        email: m.email,
        displayName: m.displayName,
        role: 'member',
      }));
      setPlatformUsers(synthetic);
      if (synthetic.length > 0) setSelectedUserId(synthetic[0].id);
    }
  };

  const openEditMemberModal = (member: OrganizationMember) => {
    setActionError(null);
    setEditMember(member);
    setEditPosition(member.positionName ?? '');
    setEditIsHead(member.isHead);
    setEditTargetUnitId(member.unitId ?? selected?.id ?? '');
    setShowEditMemberModal(true);
  };

  const handleCreateUnit = async (e: FormEvent) => {
    e.preventDefault();
    if (!newUnitCode.trim() || !newUnitName.trim() || !newUnitTypeId) {
      setActionError('Vui lòng nhập đầy đủ mã, tên và loại đơn vị.');
      return;
    }
    setBusyAction(true);
    setActionError(null);
    try {
      await createOrganizationUnit({
        code: newUnitCode.trim().toUpperCase(),
        name: newUnitName.trim(),
        typeId: newUnitTypeId,
        parentId: newUnitParentId || undefined,
      });
      setShowAddUnitModal(false);
      setNewUnitCode('');
      setNewUnitName('');
      if (onReload) await onReload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Không thể tạo đơn vị tổ chức.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleAssignMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !selectedUserId) {
      setActionError('Vui lòng chọn nhân sự để bổ nhiệm.');
      return;
    }
    setBusyAction(true);
    setActionError(null);
    try {
      await assignOrganizationMember({
        userId: selectedUserId,
        unitId: selected.id,
        positionName: memberPosition.trim() || undefined,
        isHead,
      });
      setShowAddMemberModal(false);
      if (onReload) await onReload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Không thể gán nhân sự.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSaveEditMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!editMember) return;
    setBusyAction(true);
    setActionError(null);
    try {
      await updateOrganizationMember(editMember.membershipId, {
        unitId: editTargetUnitId || undefined,
        positionName: editPosition.trim() || undefined,
        isHead: editIsHead,
      });
      setShowEditMemberModal(false);
      setEditMember(null);
      if (onReload) await onReload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Không thể cập nhật thông tin bổ nhiệm.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleRemoveMember = async (membershipId: string) => {
    setBusyAction(true);
    setActionError(null);
    try {
      await removeOrganizationMember(membershipId);
      setDeletingMemberId(null);
      if (onReload) await onReload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Không thể gỡ nhân sự khỏi đơn vị.');
    } finally {
      setBusyAction(false);
    }
  };

  const filteredUsers = useMemo(() => {
    if (!userSearchQuery.trim()) return platformUsers;
    const q = userSearchQuery.toLowerCase();
    return platformUsers.filter(
      (u) => u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [platformUsers, userSearchQuery]);

  return (
    <section className={styles.content}>
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>Tenant Core · Cơ cấu doanh nghiệp</span>
          <h2>Sơ đồ tổ chức &amp; Phân bổ nhân sự</h2>
          <p>
            Quản lý cây phòng ban, bổ nhiệm chức danh và chỉ định Trưởng đơn vị chịu trách nhiệm quy
            trình.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            className={`${styles.primaryButton}`}
            onClick={() => {
              setActionError(null);
              setShowAddUnitModal(true);
            }}
          >
            + Thêm đơn vị mới
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className={styles.summaryGrid}>
        <article>
          <div>
            <span>Cơ cấu tổ chức</span>
            <strong>{totalUnits}</strong>
            <small>Phòng ban &amp; Chi nhánh</small>
          </div>
        </article>

        <article>
          <div>
            <span>Tổng nhân sự</span>
            <strong>{totalMembers}</strong>
            <small>{assignedMembersCount} đã phân bổ vào đơn vị</small>
          </div>
        </article>

        <article>
          <div>
            <span>Lãnh đạo đơn vị</span>
            <strong>{appointedHeadsCount}</strong>
            <small>Trưởng đơn vị đã bổ nhiệm</small>
          </div>
        </article>
      </div>

      {/* Master Detail Split */}
      <div className={styles.orgLayout}>
        {/* Left Column: Organization Tree */}
        <article className={styles.orgTree}>
          <header>
            <h3>Cây cơ cấu tổ chức</h3>
            <span>{units.length} đơn vị</span>
          </header>
          {roots.map((unit) => (
            <OrganizationNode
              key={unit.id}
              unit={unit}
              all={units}
              selectedId={selected?.id}
              onSelect={setSelectedId}
              depth={0}
            />
          ))}
          {roots.length === 0 ? (
            <p style={{ padding: '20px', color: 'var(--muted)', fontSize: '13px' }}>
              Chưa có đơn vị tổ chức nào. Bấm &quot;Thêm đơn vị mới&quot; để khởi tạo.
            </p>
          ) : null}
        </article>

        {/* Right Column: Unit Detail & Member Management */}
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
              </div>

              <dl>
                <div>
                  <dt>Trưởng đơn vị</dt>
                  <dd style={{ color: selected.headName ? '#0f172a' : '#94a3b8' }}>
                    {selected.headName ? `${selected.headName}` : 'Chưa bổ nhiệm'}
                  </dd>
                </div>
                <div>
                  <dt>Số lượng thành viên</dt>
                  <dd>{selected.memberCount} nhân sự</dd>
                </div>
                <div>
                  <dt>Đơn vị cấp trên</dt>
                  <dd>
                    {units.find((item) => item.id === selected.parentId)?.name ??
                      'Cấp cao nhất (Root)'}
                  </dd>
                </div>
              </dl>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '20px',
                  marginBottom: '10px',
                }}
              >
                <h4 style={{ margin: 0 }}>Thành viên trong đơn vị ({unitMembers.length})</h4>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  style={{ fontSize: '11px', minHeight: '30px', padding: '0 10px' }}
                  onClick={openAddMemberModal}
                >
                  + Gán nhân sự
                </button>
              </div>

              <div className={styles.memberList}>
                {unitMembers.map((member) => (
                  <div
                    key={member.membershipId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 0',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span>{member.displayName.slice(0, 1).toUpperCase()}</span>
                      <div>
                        <strong>{member.displayName}</strong>
                        <small>{member.positionName ?? member.email}</small>
                      </div>
                      {member.isHead ? <em>Trưởng đơn vị</em> : null}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        style={{
                          background: 'none',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          padding: '3px 8px',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                        onClick={() => openEditMemberModal(member)}
                      >
                        Sửa
                      </button>

                      {deletingMemberId === member.membershipId ? (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            borderRadius: '6px',
                            padding: '2px 6px',
                          }}
                        >
                          <span style={{ fontSize: '11px', color: '#b91c1c' }}>Gỡ?</span>
                          <button
                            type="button"
                            style={{
                              background: '#dc2626',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              fontSize: '10.5px',
                              cursor: 'pointer',
                            }}
                            disabled={busyAction}
                            onClick={() => handleRemoveMember(member.membershipId)}
                          >
                            Đồng ý
                          </button>
                          <button
                            type="button"
                            style={{
                              background: '#e2e8f0',
                              color: '#334155',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              fontSize: '10.5px',
                              cursor: 'pointer',
                            }}
                            onClick={() => setDeletingMemberId(null)}
                          >
                            Huỷ
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          style={{
                            background: 'none',
                            border: '1px solid #fecaca',
                            color: '#b91c1c',
                            borderRadius: '6px',
                            padding: '3px 8px',
                            fontSize: '11px',
                            cursor: 'pointer',
                          }}
                          onClick={() => setDeletingMemberId(member.membershipId)}
                        >
                          Gỡ
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {unitMembers.length === 0 ? (
                  <p style={{ color: 'var(--muted)', fontSize: '12px', padding: '12px 0' }}>
                    Chưa có nhân sự nào được phân bổ vào đơn vị này.
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: '13px' }}>
              Chọn một đơn vị từ cây cơ cấu bên trái để xem và phân bổ nhân sự.
            </p>
          )}
        </article>
      </div>

      {/* Modal Thêm Đơn Vị Tổ Chức */}
      {showAddUnitModal ? (
        <div className={styles.modalBackdrop} onClick={() => setShowAddUnitModal(false)}>
          <div className={styles.orgDialog} onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>Thêm Đơn vị Tổ chức mới</h2>
              <button type="button" onClick={() => setShowAddUnitModal(false)}>
                
              </button>
            </header>
            <form onSubmit={handleCreateUnit}>
              {actionError ? (
                <div
                  style={{
                    padding: '8px 12px',
                    background: '#fee2e2',
                    color: '#b91c1c',
                    borderRadius: '6px',
                    fontSize: '12px',
                    marginBottom: '10px',
                  }}
                >
                  {actionError}
                </div>
              ) : null}

              <div className={styles.formRow}>
                <label>
                  Mã đơn vị *
                  <input
                    type="text"
                    placeholder="VD: P-KT, BG-HCM"
                    value={newUnitCode}
                    onChange={(e) => setNewUnitCode(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Loại đơn vị *
                  <select
                    value={newUnitTypeId}
                    onChange={(e) => setNewUnitTypeId(e.target.value)}
                    required
                  >
                    {unitTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label style={{ marginTop: '10px' }}>
                Tên đơn vị tổ chức *
                <input
                  type="text"
                  placeholder="VD: Phòng Kỹ thuật Công nghệ, Ban Giám đốc..."
                  value={newUnitName}
                  onChange={(e) => setNewUnitName(e.target.value)}
                  required
                />
              </label>

              <label style={{ marginTop: '10px' }}>
                Đơn vị cấp trên trực thuộc (Trống = Cấp cao nhất)
                <select
                  value={newUnitParentId}
                  onChange={(e) => setNewUnitParentId(e.target.value)}
                >
                  <option value="">— Cấp cao nhất (Root) —</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.code})
                    </option>
                  ))}
                </select>
              </label>

              <footer>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setShowAddUnitModal(false)}
                  disabled={busyAction}
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={busyAction}
                  style={{ marginLeft: '10px' }}
                >
                  {busyAction ? 'Đang tạo…' : 'Xác nhận tạo đơn vị'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal Bổ Nhiệm / Gán Nhân Sự */}
      {showAddMemberModal && selected ? (
        <div className={styles.modalBackdrop} onClick={() => setShowAddMemberModal(false)}>
          <div className={styles.orgDialog} onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>Gán Nhân sự vào {selected.name}</h2>
              <button type="button" onClick={() => setShowAddMemberModal(false)}>
                
              </button>
            </header>
            <form onSubmit={handleAssignMember}>
              {actionError ? (
                <div
                  style={{
                    padding: '8px 12px',
                    background: '#fee2e2',
                    color: '#b91c1c',
                    borderRadius: '6px',
                    fontSize: '12px',
                    marginBottom: '10px',
                  }}
                >
                  {actionError}
                </div>
              ) : null}

              <label>
                Tìm &amp; Chọn nhân sự *
                <input
                  type="text"
                  placeholder="Gõ để lọc tên hoặc email..."
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  style={{ marginBottom: '6px' }}
                />
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  size={5}
                  style={{ height: '120px', padding: '6px' }}
                  required
                >
                  {filteredUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName} ({u.email})
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ marginTop: '10px' }}>
                Chức danh / Vị trí đảm nhiệm
                <input
                  type="text"
                  placeholder="VD: Trưởng phòng, Kỹ sư chính, Chuyên viên..."
                  value={memberPosition}
                  onChange={(e) => setMemberPosition(e.target.value)}
                />
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '12px',
                  cursor: 'pointer',
                  fontWeight: 'normal',
                  fontSize: '12px',
                }}
              >
                <input
                  type="checkbox"
                  checked={isHead}
                  onChange={(e) => setIsHead(e.target.checked)}
                />
                <span>Chỉ định làm Trưởng đơn vị / Người phụ trách chính</span>
              </label>

              <footer>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setShowAddMemberModal(false)}
                  disabled={busyAction}
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={busyAction}
                  style={{ marginLeft: '10px' }}
                >
                  {busyAction ? 'Đang lưu…' : 'Xác nhận gán nhân sự'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal Cập Nhật Bổ Nhiệm */}
      {showEditMemberModal && editMember ? (
        <div className={styles.modalBackdrop} onClick={() => setShowEditMemberModal(false)}>
          <div className={styles.orgDialog} onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>Cập nhật Bổ nhiệm / Chức danh</h2>
              <button type="button" onClick={() => setShowEditMemberModal(false)}>
                
              </button>
            </header>
            <form onSubmit={handleSaveEditMember}>
              {actionError ? (
                <div
                  style={{
                    padding: '8px 12px',
                    background: '#fee2e2',
                    color: '#b91c1c',
                    borderRadius: '6px',
                    fontSize: '12px',
                    marginBottom: '10px',
                  }}
                >
                  {actionError}
                </div>
              ) : null}

              <div style={{ marginBottom: '10px' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Nhân sự:</span>
                <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '2px' }}>
                  {editMember.displayName} ({editMember.email})
                </div>
              </div>

              <label style={{ marginTop: '10px' }}>
                Đơn vị trực thuộc *
                <select
                  value={editTargetUnitId}
                  onChange={(e) => setEditTargetUnitId(e.target.value)}
                  required
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.code})
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ marginTop: '10px' }}>
                Chức danh / Vị trí
                <input
                  type="text"
                  placeholder="VD: Trưởng phòng, Kỹ sư chính..."
                  value={editPosition}
                  onChange={(e) => setEditPosition(e.target.value)}
                />
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '12px',
                  cursor: 'pointer',
                  fontWeight: 'normal',
                  fontSize: '12px',
                }}
              >
                <input
                  type="checkbox"
                  checked={editIsHead}
                  onChange={(e) => setEditIsHead(e.target.checked)}
                />
                <span>Chỉ định làm Trưởng đơn vị / Người phụ trách chính</span>
              </label>

              <footer>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setShowEditMemberModal(false)}
                  disabled={busyAction}
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={busyAction}
                  style={{ marginLeft: '10px' }}
                >
                  {busyAction ? 'Đang lưu…' : 'Lưu cập nhật'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function OrganizationNode({
  unit,
  all,
  selectedId,
  onSelect,
  depth,
}: {
  unit: OrganizationUnit;
  all: readonly OrganizationUnit[];
  selectedId?: string;
  onSelect(id: string): void;
  depth: number;
}) {
  const children = all.filter((item) => item.parentId === unit.id);
  return (
    <div>
      <button
        type="button"
        className={selectedId === unit.id ? styles.selectedOrg : ''}
        style={{ paddingLeft: 14 + depth * 22 }}
        onClick={() => onSelect(unit.id)}
      >
        <span>{children.length ? '▾' : '·'}</span>
        <i>{unit.typeName.slice(0, 1).toUpperCase()}</i>
        <div>
          <strong>{unit.name}</strong>
          <small>
            {unit.typeName} · {unit.memberCount} thành viên
          </small>
        </div>
      </button>
      {children.map((child) => (
        <OrganizationNode
          key={child.id}
          unit={child}
          all={all}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

