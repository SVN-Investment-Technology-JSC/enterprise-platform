import { DEFAULT_PROCEDURE_LINK_SETTINGS } from '@enterprise-platform/contracts-workspace';
import {
  PROCEDURE_LINK_KEY,
  loadProcedureLinkSettings,
  normalizeProcedureLinkSettings,
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

describe('loadProcedureLinkSettings', () => {
  it('đọc theo khoá procedure_link', async () => {
    const get = jest.fn().mockResolvedValue({ onStarted: 'in_progress' });
    const result = await loadProcedureLinkSettings({ settings: { get } } as never, 't1');
    expect(get).toHaveBeenCalledWith('t1', PROCEDURE_LINK_KEY);
    expect(result.onStarted).toBe('in_progress');
  });
});
