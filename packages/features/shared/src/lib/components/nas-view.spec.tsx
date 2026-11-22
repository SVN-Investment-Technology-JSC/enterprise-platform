import type { SharedNasConnectionSettings, SharedNasListing, SharedNasOverview } from '@enterprise-platform/contracts-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '../shared-api';
import { NasConnectionPanel } from './nas-connection-panel';
import { NasView } from './nas-view';

jest.mock('../shared-api', () => ({
  errorMessage: (cause: { message?: string } | undefined, fallback: string) => cause?.message ?? fallback,
  loadNasOverview: jest.fn(),
  listNasEntries: jest.fn(),
  nasDownloadTicket: jest.fn(),
  openNasFile: jest.fn(),
  uploadToNas: jest.fn(),
  createNasFolder: jest.fn(),
  renameNasEntry: jest.fn(),
  deleteNasEntry: jest.fn(),
  loadNasPermissions: jest.fn(),
  loadNasSettings: jest.fn(),
  saveNasSettings: jest.fn(),
  testNasConnection: jest.fn(),
  syncNas: jest.fn(),
  loadNasAccounts: jest.fn(),
  linkNasAccount: jest.fn(),
  loadDirectory: jest.fn(),
}));

const mocked = api as jest.Mocked<typeof api>;

const overview: SharedNasOverview = {
  enabled: true,
  label: 'NAS văn phòng',
  account: 'thuyptd',
  shares: [
    { name: 'SAVINA', label: 'SAVINA', access: 'write', via: ['nhóm Văn Thư'], writeCappedByErp: false },
    { name: 'KINH DOANH', label: 'Kinh doanh', access: 'read', via: ['nhóm users'], writeCappedByErp: false },
  ],
};

function listing(patch: Partial<SharedNasListing> = {}): SharedNasListing {
  return {
    share: 'SAVINA',
    path: '',
    access: 'write',
    canWrite: true,
    total: 2,
    offset: 0,
    entries: [
      { name: 'Báo giá.xlsx', path: 'Báo giá.xlsx', isDir: false, sizeBytes: 2048 },
      { name: 'HỢP ĐỒNG', path: 'HỢP ĐỒNG', isDir: true },
    ],
    ...patch,
  };
}

describe('NasView', () => {
  beforeEach(() => jest.resetAllMocks());

  it('hiện thư mục chia sẻ được vào, quyền và lý do; thư mục đứng trước tệp; có quyền ghi thì có Tải lên', async () => {
    mocked.loadNasOverview.mockResolvedValue(overview);
    mocked.listNasEntries.mockResolvedValue(listing());
    render(<NasView canManage={false} />);
    expect(await screen.findByText('Quyền của bạn: Đọc/Ghi (nhóm Văn Thư).')).toBeTruthy();
    const names = (await screen.findAllByRole('button', { name: /HỢP ĐỒNG|Báo giá/ })).map((button) => button.textContent);
    expect(names[0]).toContain('HỢP ĐỒNG');
    expect(screen.getByRole('button', { name: 'Tải lên' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bảng quyền' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /HỢP ĐỒNG/ }));
    await waitFor(() => expect(mocked.listNasEntries).toHaveBeenLastCalledWith('SAVINA', 'HỢP ĐỒNG', 0));
  });

  it('thư mục chỉ đọc thì không có nút ghi', async () => {
    mocked.loadNasOverview.mockResolvedValue({ ...overview, shares: [overview.shares[1]!] });
    mocked.listNasEntries.mockResolvedValue(listing({ share: 'KINH DOANH', access: 'read', canWrite: false }));
    render(<NasView canManage />);
    expect(await screen.findByText('Quyền của bạn: Chỉ đọc (nhóm users).')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tải lên' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đổi tên' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Bảng quyền' })).toBeTruthy();
  });

  it('chưa ghép tài khoản NAS thì báo rõ, không gọi đọc thư mục', async () => {
    mocked.loadNasOverview.mockResolvedValue({ ...overview, account: undefined, shares: [] });
    render(<NasView canManage={false} />);
    expect(await screen.findByText(/chưa được ghép với tài khoản NAS/)).toBeTruthy();
    expect(mocked.listNasEntries).not.toHaveBeenCalled();
  });
});

const settings: SharedNasConnectionSettings = {
  available: true,
  editable: true,
  configured: true,
  enabled: true,
  label: 'NAS văn phòng',
  provider: 'synology',
  baseUrl: 'http://100.79.184.77:5000',
  username: 'erp-connector',
  hasSecret: true,
  shares: [{ name: 'SAVINA' }],
  syncMinutes: 15,
  lastSync: { at: '2026-11-22T05:00:00.000Z', ok: true, message: 'Đã đồng bộ 48 tài khoản.' },
  version: 3,
  accounts: 2,
  linkedAccounts: 1,
};

describe('NasConnectionPanel', () => {
  beforeEach(() => jest.resetAllMocks());

  it('thử kết nối lấy thư mục chia sẻ để chọn; lưu gửi thư mục đã chọn, giữ mật khẩu cũ khi để trống', async () => {
    mocked.loadNasSettings.mockResolvedValue(settings);
    mocked.loadNasAccounts.mockResolvedValue([]);
    mocked.loadDirectory.mockResolvedValue({ people: [], nodes: [], degraded: false });
    mocked.testNasConnection.mockResolvedValue({ ok: true, message: 'Kết nối tốt.', shares: [{ name: 'SAVINA' }, { name: 'KINH DOANH' }] });
    mocked.saveNasSettings.mockResolvedValue(settings);
    render(<NasConnectionPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Thử kết nối' }));
    expect(await screen.findByText('Kết nối tốt.')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'KINH DOANH' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu kết nối' }));
    await waitFor(() => expect(mocked.saveNasSettings).toHaveBeenCalled());
    expect(mocked.saveNasSettings.mock.calls[0]![0]).toMatchObject({
      baseUrl: 'http://100.79.184.77:5000',
      password: undefined,
      shares: [{ name: 'SAVINA' }, { name: 'KINH DOANH' }],
      version: 3,
    });
  });

  it('bảng ghép tài khoản: lọc chưa ghép, hiện cách ghép', async () => {
    mocked.loadNasSettings.mockResolvedValue(settings);
    mocked.loadNasAccounts.mockResolvedValue([
      { name: 'thuyptd', description: '', disabled: false, groups: ['users', 'Văn Thư'], erpUserId: 'u1', erpUserName: 'Thúy', linkSource: 'auto' },
      { name: 'khach', description: '', disabled: false, groups: ['users'], linkSource: 'none' },
    ]);
    mocked.loadDirectory.mockResolvedValue({ people: [{ userId: 'u1', displayName: 'Thúy', unitNames: [] }], nodes: [], degraded: false });
    render(<NasConnectionPanel />);
    expect(await screen.findByText('Tự ghép')).toBeTruthy();
    expect(screen.getByText('Văn Thư')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chỉ hiện chưa ghép' }));
    expect(screen.queryByText('thuyptd')).toBeNull();
    expect(screen.getByText('khach')).toBeTruthy();
  });
});
