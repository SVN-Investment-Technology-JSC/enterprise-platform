import {
  DEFAULT_PROCEDURE_ENGINE_SETTINGS,
  WORKSPACE_LINK_SETTING_OPTIONS,
  normalizeProcedureEngineSettings,
} from './workspace-link-settings.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';

describe('normalizeProcedureEngineSettings', () => {
  it('thiếu hoặc không phải object thì mặc định', () => {
    expect(normalizeProcedureEngineSettings(undefined)).toEqual(DEFAULT_PROCEDURE_ENGINE_SETTINGS);
    expect(normalizeProcedureEngineSettings('x')).toEqual(DEFAULT_PROCEDURE_ENGINE_SETTINGS);
  });

  it('giữ giá trị hợp lệ, giá trị lạ hoặc sai kiểu về mặc định', () => {
    const result = normalizeProcedureEngineSettings({
      engineChangeEligibility: 'never',
      engineReverseWho: 'ai-cung-duoc',
      engineReasonRequired: 5,
    });
    expect(result.engineChangeEligibility).toBe('never');
    expect(result.engineReverseWho).toBe('admin_only');
    expect(result.engineReasonRequired).toBe('required');
  });

  it('mặc định nằm trong danh sách giá trị hợp lệ của từng trường', () => {
    for (const [field, options] of Object.entries(WORKSPACE_LINK_SETTING_OPTIONS)) {
      expect(options as readonly string[]).toContain(
        (DEFAULT_PROCEDURE_ENGINE_SETTINGS as unknown as Record<string, string>)[field],
      );
    }
  });
});

describe('ProcedureEngineApplication.getProcedureLinkSettings', () => {
  const make = (reader?: { get: jest.Mock }) =>
    new ProcedureEngineApplication(
      {} as never, {} as never, {} as never,
      undefined, undefined, undefined, undefined, undefined, undefined,
      reader,
    );

  it('không có reader thì mặc định', async () => {
    expect(await make().getProcedureLinkSettings('t1')).toEqual(DEFAULT_PROCEDURE_ENGINE_SETTINGS);
  });

  it('dùng giá trị của reader, đã chuẩn hoá', async () => {
    const get = jest.fn().mockResolvedValue({ engineChangeWho: 'admin_only', engineAttachmentMirror: 'lạ' });
    const result = await make({ get }).getProcedureLinkSettings('t1');
    expect(get).toHaveBeenCalledWith('t1');
    expect(result.engineChangeWho).toBe('admin_only');
    expect(result.engineAttachmentMirror).toBe('all');
  });

  it('reader ném lỗi thì mặc định, không ném theo', async () => {
    const get = jest.fn().mockRejectedValue(new Error('hỏng'));
    expect(await make({ get }).getProcedureLinkSettings('t1')).toEqual(DEFAULT_PROCEDURE_ENGINE_SETTINGS);
  });
});
