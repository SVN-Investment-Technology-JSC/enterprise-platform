/**
 * @jest-environment jsdom
 */
import type { AdminPipeline } from '@enterprise-platform/contracts-crm';
import { render, screen } from '@testing-library/react';
import { PipelineSettings } from './pipeline-settings';

jest.mock('../sales.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('./pipeline-settings.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
jest.mock('../components/crm-ui', () => ({ CrmDialog: () => null, Field: ({ children }: { children: unknown }) => children }));
jest.mock('@enterprise-platform/shared-ui', () => ({
  Popconfirm: ({ children }: { children: unknown }) => children,
  SearchableSelect: () => null,
  toast: { success: jest.fn(), error: jest.fn() },
}));

const mockList = jest.fn();
jest.mock('../crm-api', () => ({
  errorMessage: (cause: { message?: string }, fallback: string) => cause?.message ?? fallback,
  listAdminPipelines: () => mockList(),
  listPipelineTemplates: () => Promise.resolve([]),
  listDocumentTypes: () => Promise.resolve([]),
}));

const stage = (id: string, patch = {}) => ({
  id, pipelineId: 'p1', code: id.toUpperCase(), name: `GĐ ${id}`, semantic: 'OPEN', sortOrder: 1, defaultProbability: 10, active: true,
  skippable: false, assigneeRule: 'NONE', assigneeParam: null, nextStageIds: [], requirements: [], opportunityCount: 0, used: false, ...patch,
});
const pipelines = [
  { id: 'p1', code: 'STD', name: 'Luồng chuẩn', profile: 'STANDARD', isDefault: true, active: true, sortOrder: 1, careSuggestion: true, opportunityCount: 4, stages: [stage('a', { used: true, opportunityCount: 4 }), stage('b')] },
  { id: 'p2', code: 'TDR', name: 'Luồng thầu', profile: 'TENDER', isDefault: false, active: true, sortOrder: 2, careSuggestion: false, opportunityCount: 0, stages: [stage('c')] },
] as unknown as AdminPipeline[];

describe('PipelineSettings', () => {
  it('luồng mặc định khoá xoá, tắt và giải thích bằng tiếng Việt; giai đoạn đã dùng khoá xoá', async () => {
    mockList.mockResolvedValue(pipelines);
    render(<PipelineSettings />);
    expect(await screen.findByRole('button', { name: 'Xoá luồng' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Tắt luồng' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Đặt làm mặc định' })).toHaveProperty('disabled', true);
    expect(screen.getAllByText(/Luồng mặc định không tắt hoặc xoá được/).length).toBeGreaterThan(0);
    const deletes = screen.getAllByRole('button', { name: 'Xoá' });
    expect(deletes[0]).toHaveProperty('disabled', true);
    expect(deletes[1]).toHaveProperty('disabled', false);
  });
});
