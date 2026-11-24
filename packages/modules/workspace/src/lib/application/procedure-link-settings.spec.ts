import {
  DEFAULT_PROCEDURE_LINK_SETTINGS,
  PROCEDURE_ENGINE_SETTING_KEYS,
} from '@enterprise-platform/contracts-workspace';
import {
  PROCEDURE_LINK_KEY,
  loadProcedureLinkSettings,
  normalizeProcedureLinkSettings,
  pickProcedureEngineSettings,
} from './procedure-link-settings.js';

describe('normalizeProcedureLinkSettings', () => {
  it('thiếu hoặc không phải object thì dùng mặc định', () => {
    expect(normalizeProcedureLinkSettings(undefined)).toEqual(DEFAULT_PROCEDURE_LINK_SETTINGS);
    expect(normalizeProcedureLinkSettings('x')).toEqual(DEFAULT_PROCEDURE_LINK_SETTINGS);
  });

  it('giữ giá trị hợp lệ, trường hỏng về mặc định', () => {
    const result = normalizeProcedureLinkSettings({
      onCompletedWorkItem: 'review',
      onRejected: 'bogus',
      progressPullClosedItems: 5,
      onInstanceDeleted: 'unlink_keep',
    });
    expect(result.onCompletedWorkItem).toBe('review');
    expect(result.onInstanceDeleted).toBe('unlink_keep');
    expect(result.onRejected).toBe(DEFAULT_PROCEDURE_LINK_SETTINGS.onRejected);
    expect(result.progressPullClosedItems).toBe('skip');
  });
});

describe('cài đặt do module Quy trình thực thi (engine*)', () => {
  it('mặc định giữ hành vi hiện hành và dữ liệu cũ thiếu trường vẫn chuẩn hoá được', () => {
    const result = normalizeProcedureLinkSettings({ onStarted: 'in_progress' });
    for (const key of PROCEDURE_ENGINE_SETTING_KEYS) {
      expect(result[key]).toBe(DEFAULT_PROCEDURE_LINK_SETTINGS[key]);
    }
    expect(DEFAULT_PROCEDURE_LINK_SETTINGS).toMatchObject({
      engineChangeEligibility: 'untouched',
      engineChangeWho: 'creator_approver_admin',
      engineChangeOldInstanceFate: 'delete',
      engineReverseWho: 'admin_only',
      engineReverseStatuses: 'completed_or_rejected',
      engineDeleteLinkedWho: 'initiator_approver_admin',
      engineAttachmentMirror: 'all',
      engineStartWithoutOrgChart: 'block',
      engineReasonRequired: 'required',
    });
  });

  it('giữ giá trị hợp lệ, giá trị lạ về mặc định', () => {
    const result = normalizeProcedureLinkSettings({ engineChangeWho: 'admin_only', engineReverseWho: 'moi-nguoi' });
    expect(result.engineChangeWho).toBe('admin_only');
    expect(result.engineReverseWho).toBe('admin_only');
  });

  it('pickProcedureEngineSettings chỉ trả đúng các khoá engine*', () => {
    const picked = pickProcedureEngineSettings(normalizeProcedureLinkSettings({ onStarted: 'in_progress' }));
    expect(Object.keys(picked).sort()).toEqual([...PROCEDURE_ENGINE_SETTING_KEYS].sort());
    expect(picked).not.toHaveProperty('onStarted');
  });
});

describe('loadProcedureLinkSettings', () => {
  it('đọc theo khoá procedure_link', async () => {
    const get = jest.fn().mockResolvedValue({ onStarted: 'in_progress' });
    const result = await loadProcedureLinkSettings({ settings: { get } } as never, 't1');
    expect(get).toHaveBeenCalledWith('t1', PROCEDURE_LINK_KEY);
    expect(result.onStarted).toBe('in_progress');
  });
});
