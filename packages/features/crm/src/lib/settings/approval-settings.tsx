'use client';

import {
  APPROVAL_KIND_LABELS,
  APPROVAL_MODE_LABELS,
  type ApprovalBinding,
  type ApprovalKind,
  type ApprovalMode,
  type ProcedureDefinitionOption,
} from '@enterprise-platform/contracts-crm';
import { SearchableSelect, toast } from '@enterprise-platform/shared-ui';
import { useEffect, useState } from 'react';
import { Field } from '../components/crm-ui';
import {
  errorMessage,
  listApprovalBindings,
  listProcedureOptions,
  loadQuoteApprovalSettings,
  saveApprovalBinding,
  saveQuoteApprovalSettings,
} from '../crm-api';
import { labelOptions } from '../crm-context';
import { parseNumber } from '../pricing/pricing.model';
import styles from '../sales.module.scss';

/**
 * Cấu hình duyệt (T3-17, `crm.manage`): ngưỡng duyệt báo giá theo vai trò người
 * lập và biên tối thiểu; cách duyệt báo giá vượt ngưỡng, đơn vượt hạn mức công
 * nợ (trực tiếp trong Bán hàng hoặc qua một quy trình đã công bố). Server kiểm
 * quy trình có thật và đã công bố trước khi lưu.
 */
export function ApprovalSettingsPage() {
  return (
    <>
      <ThresholdSettings />
      <ApprovalBindings />
    </>
  );
}

function ThresholdSettings() {
  const [staff, setStaff] = useState('');
  const [teamLead, setTeamLead] = useState('');
  const [manager, setManager] = useState('');
  const [margin, setMargin] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadQuoteApprovalSettings()
      .then((value) => {
        setStaff(value.roleLimits.staff === null ? '' : String(value.roleLimits.staff));
        setTeamLead(value.roleLimits.teamLead === null ? '' : String(value.roleLimits.teamLead));
        setManager(value.roleLimits.manager === null ? '' : String(value.roleLimits.manager));
        setMargin(String(value.minMarginPercent));
        setLoaded(true);
      })
      .catch((cause) => setError(errorMessage(cause, 'Không tải được ngưỡng duyệt.')));
  }, []);

  const limit = (text: string) => (text.trim() ? (parseNumber(text) ?? Number.NaN) : null);

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      await saveQuoteApprovalSettings({
        roleLimits: { staff: limit(staff), teamLead: limit(teamLead), manager: limit(manager) },
        minMarginPercent: parseNumber(margin) ?? Number.NaN,
      });
      toast.success('Đã lưu ngưỡng duyệt báo giá.');
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được ngưỡng duyệt.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="Ngưỡng duyệt báo giá">
      <h2 className={styles.title}>Ngưỡng duyệt báo giá</h2>
      <p className={styles.muted}>
        Báo giá cần duyệt khi chiết khấu một dòng vượt hạn mức theo vai trò người gửi, biên lợi nhuận dưới mức tối thiểu, có
        ghi đè giá hoặc chiết khấu, hoặc Kho chưa có giá vốn. Bằng đúng hạn mức thì không cần duyệt.
      </p>
      {error ? <p className={styles.alert}>{error}</p> : null}
      {loaded ? (
        <form
          className={styles.fieldGrid}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label="Hạn mức chiết khấu của nhân viên (%)" hint="Bỏ trống là không giới hạn">
            <input className={styles.input} inputMode="decimal" value={staff} onChange={(event) => setStaff(event.target.value)} />
          </Field>
          <Field label="Hạn mức của trưởng nhóm (%)" hint="Người có quyền duyệt báo giá">
            <input className={styles.input} inputMode="decimal" value={teamLead} onChange={(event) => setTeamLead(event.target.value)} />
          </Field>
          <Field label="Hạn mức của quản lý (%)" hint="Người xem toàn bộ dữ liệu CRM">
            <input className={styles.input} inputMode="decimal" value={manager} onChange={(event) => setManager(event.target.value)} />
          </Field>
          <Field label="Biên lợi nhuận tối thiểu (%)">
            <input className={styles.input} inputMode="decimal" value={margin} onChange={(event) => setMargin(event.target.value)} />
          </Field>
          <div className={styles.formActions}>
            <button type="submit" className={styles.buttonPrimary} disabled={saving}>
              {saving ? 'Đang lưu…' : 'Lưu ngưỡng duyệt'}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function ApprovalBindings() {
  const [bindings, setBindings] = useState<readonly ApprovalBinding[]>([]);
  const [procedures, setProcedures] = useState<readonly ProcedureDefinitionOption[]>([]);
  const [procedureError, setProcedureError] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    listApprovalBindings()
      .then(setBindings)
      .catch((cause) => setError(errorMessage(cause, 'Không tải được cách duyệt.')));
    listProcedureOptions()
      .then(setProcedures)
      .catch((cause) => setProcedureError(errorMessage(cause, 'Không tải được danh sách quy trình.')));
  }, []);

  return (
    <section className={styles.panel} aria-label="Cách duyệt">
      <h2 className={styles.title}>Cách duyệt</h2>
      <p className={styles.muted}>
        Duyệt trực tiếp: người có quyền duyệt báo giá duyệt ngay trong CRM. Duyệt qua Quy trình: hệ thống tạo hồ sơ
        theo quy trình đã chọn, bước người lập tự hoàn tất, kết quả quay về CRM.
      </p>
      {error ? <p className={styles.alert}>{error}</p> : null}
      {procedureError ? <p className={styles.warning}>{procedureError}</p> : null}
      {bindings.map((binding) => (
        <BindingRow key={binding.kind} binding={binding} procedures={procedures} onSaved={setBindings} />
      ))}
    </section>
  );
}

function BindingRow({
  binding,
  procedures,
  onSaved,
}: {
  binding: ApprovalBinding;
  procedures: readonly ProcedureDefinitionOption[];
  onSaved: (next: ApprovalBinding[]) => void;
}) {
  const [mode, setMode] = useState<ApprovalMode>(binding.mode);
  const [definitionId, setDefinitionId] = useState(binding.procedureDefinitionId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  // Quy trình đang gắn có thể không còn trong danh sách (đã lưu trữ): vẫn hiện tên đã lưu.
  const options = procedures.map((item) => ({ value: item.id, label: item.name, badge: item.code }));
  if (binding.procedureDefinitionId && !procedures.some((item) => item.id === binding.procedureDefinitionId)) {
    options.push({ value: binding.procedureDefinitionId, label: binding.procedureDefinitionName ?? 'Quy trình đã gắn', badge: '' });
  }

  async function save(kind: ApprovalKind) {
    if (mode === 'PROCEDURE' && !definitionId) return setError('Vui lòng chọn quy trình duyệt.');
    setSaving(true);
    setError(undefined);
    try {
      onSaved(await saveApprovalBinding(kind, { mode, procedureDefinitionId: mode === 'PROCEDURE' ? definitionId : null }));
      toast.success('Đã lưu cách duyệt.');
    } catch (cause) {
      setError(errorMessage(cause, 'Không lưu được cách duyệt.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={styles.fieldGrid}
      onSubmit={(event) => {
        event.preventDefault();
        void save(binding.kind);
      }}
    >
      <h3 className={styles.sectionTitle}>{APPROVAL_KIND_LABELS[binding.kind]}</h3>
      <Field label="Cách duyệt">
        <SearchableSelect options={labelOptions(APPROVAL_MODE_LABELS)} value={mode} onChange={(value) => setMode(value as ApprovalMode)} />
      </Field>
      {mode === 'PROCEDURE' ? (
        <Field label="Quy trình duyệt" required>
          <SearchableSelect
            options={options}
            value={definitionId}
            placeholder="Chọn quy trình đã công bố"
            emptyText="Chưa có quy trình đã công bố"
            onChange={setDefinitionId}
          />
        </Field>
      ) : null}
      {error ? <p className={styles.alert}>{error}</p> : null}
      <div className={styles.formActions}>
        <button type="submit" className={styles.buttonPrimary} disabled={saving}>
          {saving ? 'Đang lưu…' : 'Lưu'}
        </button>
      </div>
    </form>
  );
}
