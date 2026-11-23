import type { SharedNasConnectionSettings, SharedNasListing, SharedNasOverview } from '@enterprise-platform/contracts-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '../shared-api';
import { NasAccountsPanel, NasConnectionPanel } from './nas-connection-panel';
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
  moveNasEntries: jest.fn(),
  deleteNasEntry: jest.fn(),
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
    { name: 'SAVINA', label: 'DỮ LIỆU CHUNG', access: 'write', via: ['nhóm Văn Thư'], writeCappedByErp: false },
    { name: 'KINH DOANH', label: 'KINH DOANH', access: 'read', via: ['nhóm users'], writeCappedByErp: false },
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

/** Dữ liệu kéo thả giả: jsdom không có DataTransfer. */
function transfer(options: { files?: File[]; entry?: string }) {
  const data = new Map<string, string>();
  if (options.entry) data.set('application/x-erp-nas-entry', options.entry);
  return {
    types: options.entry ? ['application/x-erp-nas-entry'] : ['Files'],
    files: options.files ?? [],
    items: [],
    dropEffect: 'none',
    effectAllowed: 'all',
    getData: (type: string) => data.get(type) ?? '',
    setData: (type: string, value: string) => data.set(type, value),
  };
}

describe('NasView', () => {
  beforeEach(() => jest.resetAllMocks());

  it('hiện thư mục chia sẻ theo tên hiển thị, không hiện quyền; thư mục đứng trước tệp; có quyền ghi thì có nút tải lên', async () => {
    mocked.loadNasOverview.mockResolvedValue(overview);
    mocked.listNasEntries.mockResolvedValue(listing());
    render(<NasView />);
    const names = (await screen.findAllByRole('button', { name: /HỢP ĐỒNG|Báo giá/ })).map((button) => button.textContent);
    expect(names[0]).toContain('HỢP ĐỒNG');
    expect(screen.getByRole('button', { name: /Tải tệp/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tải thư mục/ })).toBeTruthy();
    expect(screen.queryByText(/Đọc\/Ghi|Chỉ đọc|Quyền của bạn|Bảng quyền/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /HỢP ĐỒNG/ }));
    await waitFor(() => expect(mocked.listNasEntries).toHaveBeenLastCalledWith('SAVINA', 'HỢP ĐỒNG', 0));
  });

  it('thư mục chỉ đọc thì không có nút ghi', async () => {
    mocked.loadNasOverview.mockResolvedValue({ ...overview, shares: overview.shares.slice(1) });
    mocked.listNasEntries.mockResolvedValue(listing({ share: 'KINH DOANH', access: 'read', canWrite: false }));
    render(<NasView />);
    await screen.findByRole('button', { name: /HỢP ĐỒNG/ });
    expect(screen.queryByRole('button', { name: /Tải tệp/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đổi tên' })).toBeNull();
  });

  it('thả tệp từ máy vào một dòng thư mục thì tải vào thư mục đó', async () => {
    mocked.loadNasOverview.mockResolvedValue(overview);
    mocked.listNasEntries.mockResolvedValue(listing());
    mocked.uploadToNas.mockResolvedValue(undefined);
    render(<NasView />);
    const row = (await screen.findByRole('button', { name: /HỢP ĐỒNG/ })).closest('tr')!;
    const file = new File(['abc'], 'HĐ 02.pdf');
    fireEvent.dragOver(row, { dataTransfer: transfer({ files: [file] }) });
    expect(row.getAttribute('data-drop')).toBe('true');
    fireEvent.drop(row, { dataTransfer: transfer({ files: [file] }) });
    await waitFor(() => expect(mocked.uploadToNas).toHaveBeenCalledWith('SAVINA', 'HỢP ĐỒNG', file, 'HĐ 02.pdf'));
  });

  it('kéo một dòng thả vào thư mục khác thì chuyển; thả vào chính chỗ đang nằm thì thôi', async () => {
    mocked.loadNasOverview.mockResolvedValue(overview);
    mocked.listNasEntries.mockResolvedValue(listing());
    mocked.moveNasEntries.mockResolvedValue({ moved: 1 });
    render(<NasView />);
    const folderRow = (await screen.findByRole('button', { name: /HỢP ĐỒNG/ })).closest('tr')!;
    const fileRow = screen.getByRole('button', { name: /Báo giá/ }).closest('tr')!;
    expect(fileRow.getAttribute('draggable')).toBe('true');
    fireEvent.drop(folderRow, { dataTransfer: transfer({ entry: JSON.stringify(['Báo giá.xlsx']) }) });
    await waitFor(() => expect(mocked.moveNasEntries).toHaveBeenCalledWith('SAVINA', ['Báo giá.xlsx'], 'HỢP ĐỒNG'));
    mocked.moveNasEntries.mockClear();
    // Thả vào vùng bảng = thư mục đang mở, chính chỗ tệp đang nằm.
    fireEvent.drop(screen.getByRole('region', { name: 'Nội dung thư mục' }), {
      dataTransfer: transfer({ entry: JSON.stringify(['Báo giá.xlsx']) }),
    });
    expect(mocked.moveNasEntries).not.toHaveBeenCalled();
  });

  it('chưa ghép tài khoản NAS thì báo ngắn gọn, không đọc thư mục', async () => {
    mocked.loadNasOverview.mockResolvedValue({ ...overview, account: undefined, shares: [] });
    render(<NasView />);
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

  it('thử kết nối lấy thư mục để chọn; lưu gửi thư mục đã chọn, giữ mật khẩu cũ khi để trống', async () => {
    mocked.loadNasSettings.mockResolvedValue(settings);
    mocked.testNasConnection.mockResolvedValue({ ok: true, message: 'Kết nối tốt.', shares: [{ name: 'SAVINA' }, { name: 'KINH DOANH' }] });
    mocked.saveNasSettings.mockResolvedValue(settings);
    render(<NasConnectionPanel />);
    expect(await screen.findByText(/1\/2 tài khoản đã ghép/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thử kết nối' }));
    expect(await screen.findByText('Kết nối tốt.')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'KINH DOANH' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocked.saveNasSettings).toHaveBeenCalled());
    expect(mocked.saveNasSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://100.79.184.77:5000',
        password: undefined,
        shares: [{ name: 'SAVINA' }, { name: 'KINH DOANH' }],
        version: 3,
      }),
    );
  });
});

describe('NasAccountsPanel', () => {
  beforeEach(() => jest.resetAllMocks());

  it('bảng ghép tài khoản: đếm đã ghép, lọc chưa ghép, hiện cách ghép', async () => {
    mocked.loadNasSettings.mockResolvedValue(settings);
    mocked.loadNasAccounts.mockResolvedValue([
      { name: 'thuyptd', description: '', disabled: false, groups: ['users', 'Văn Thư'], erpUserId: 'u1', erpUserName: 'Thúy', linkSource: 'auto' },
      { name: 'khach', description: '', disabled: false, groups: ['users'], linkSource: 'none' },
    ]);
    mocked.loadDirectory.mockResolvedValue({ people: [{ userId: 'u1', displayName: 'Thúy', unitNames: [] }], nodes: [], degraded: false });
    render(<NasAccountsPanel />);
    expect(await screen.findByText('1/2 đã ghép')).toBeTruthy();
    expect(screen.getByText('Tự ghép')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chỉ hiện chưa ghép' }));
    expect(screen.queryByText('thuyptd')).toBeNull();
    expect(screen.getByText('khach')).toBeTruthy();
  });
});
