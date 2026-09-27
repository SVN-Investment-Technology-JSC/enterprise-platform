'use client';

import type { LoginPortal, LoginResponse } from '@enterprise-platform/contracts-identity';
import { SearchableSelect, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import styles from './login-form.module.scss';
import { SessionRecovery } from './session-recovery';

interface LoginFormProps {
  portal: LoginPortal;
  eyebrow: string;
  title: string;
  description: string;
}

interface LocalLoginAccount extends SearchableSelectOption {
  readonly password: string;
}

const LOCAL_TENANT_PASSWORD = 'ChangeMe-Docker-Tenant-123';
const LOCAL_LOGIN_ACCOUNTS: readonly LocalLoginAccount[] = [
  { value: 'superadmin@platform.local', label: 'Platform Super Admin', description: 'Platform Core', password: 'ChangeMe-Docker-Superadmin-123' },
  { value: 'admin@savina.local', label: 'Quản trị SAVINA', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'bui.cong.quyen@savina.local', label: 'Bùi Công Quyền', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'bui.duy.khanh@savina.local', label: 'Bùi Duy Khánh', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'bui.huu.van@savina.local', label: 'Bùi Hữu Vân', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'bui.long.quoc.huy@savina.local', label: 'Bùi Long Quốc Huy', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'cao.khanh.ngoc@savina.local', label: 'Cao Khánh Ngọc', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'dau.ba.kien@savina.local', label: 'Đậu Bá Kiên', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'dau.xuan.thanh@savina.local', label: 'Đậu Xuân Thanh', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'do.thanh.phong@savina.local', label: 'Đỗ Thanh Phong', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'dong.trinh.bao@savina.local', label: 'Đồng Trịnh Bảo', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'ha.nguyen.hoang@savina.local', label: 'Hà Nguyên Hoàng', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'huynh.kim.viet@savina.local', label: 'Huỳnh Kim Việt', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'huynh.thi.dong@savina.local', label: 'Huỳnh Thị Đông', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'huynh.thi.hong.nhung@savina.local', label: 'Huỳnh Thị Hồng Nhung', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'huynh.van.trong@savina.local', label: 'Huỳnh Văn Trọng', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'le.minh.tri@savina.local', label: 'Lê Minh Trí', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'le.thi.to.nga@savina.local', label: 'Lê Thị Tố Nga', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'ngo.tan.trinh@savina.local', label: 'Ngô Tấn Trinh', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.duy.thuan@savina.local', label: 'Nguyễn Duy Thuận', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.gia.bao@savina.local', label: 'Nguyễn Gia Bảo', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.hong.sang@savina.local', label: 'Nguyễn Hồng Sang', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.huu.hung@savina.local', label: 'Nguyễn Hữu Hưng', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.minh.y@savina.local', label: 'Nguyễn Minh Ý', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.tan.thinh@savina.local', label: 'Nguyễn Tấn Thịnh', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.thi.diem.my@savina.local', label: 'Nguyễn Thị Diễm My', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.thi.thuy@savina.local', label: 'Nguyễn Thị Thủy', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.tran.nhu.quynh@savina.local', label: 'Nguyễn Trần Như Quỳnh', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.vu.bao.cuong@savina.local', label: 'Nguyễn Vũ Bảo Cường', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyen.vu.hau@savina.local', label: 'Nguyễn Vũ Hậu', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'pham.viet.quan@savina.local', label: 'Phạm Việt Quân', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'phan.duc.thang@savina.local', label: 'Phan Đức Thắng', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'phan.thi.dieu.thuy@savina.local', label: 'Phan Thị Diệu Thúy', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'phan.trung.kien@savina.local', label: 'Phan Trung Kiên', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'quach.van.quy@savina.local', label: 'Quách Văn Quý', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'ta.quang.hoang@savina.local', label: 'Tạ Quang Hoàng', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.cao.vu@savina.local', label: 'Trần Cao Vũ', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.quang.binh@savina.local', label: 'Trần Quang Bình', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.quoc.vuong@savina.local', label: 'Trần Quốc Vương', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.thi.to.uyen@savina.local', label: 'Trần Thị Tố Uyên', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.thuy.uyen@savina.local', label: 'Trần Thúy Uyên', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.van.cuong@savina.local', label: 'Trần Văn Cường', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.van.quoc@savina.local', label: 'Trần Văn Quốc', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'tran.van.thin@savina.local', label: 'Trần Văn Thìn', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'truong.quang.bao.vuong@savina.local', label: 'Trương Quang Bảo Vương', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'vo.tuan.kiet@savina.local', label: 'Võ Tuấn Kiệt', description: 'Tenant SAVINA', password: LOCAL_TENANT_PASSWORD },
  { value: 'buithih@test.com', label: 'Bùi Thị Hoa', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'dangvang@test.com', label: 'Đặng Văn Giang', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'dinhthil@test.com', label: 'Đinh Thị Lan', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'hoangvane@test.com', label: 'Hoàng Văn Em', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'lequangc@test.com', label: 'Lê Quang Cường', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'maihoangm@test.com', label: 'Mai Hoàng Minh', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'ngothin@test.com', label: 'Ngô Thị Nga', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyenkhoai@test.com', label: 'Nguyễn Khoa Ích', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'nguyenvana@test.com', label: 'Nguyễn Văn An', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'phamthid@test.com', label: 'Phạm Thị Dung', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'phanvano@test.com', label: 'Phan Văn Oanh', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'test@test.com', label: 'test_name', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'tranthib@test.com', label: 'Trần Thị Bình', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'truongvank@test.com', label: 'Trương Văn Khang', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'vothif@test.com', label: 'Võ Thị Phương', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
  { value: 'vuongthip@test.com', label: 'Võ Thị Phúc', description: 'Tenant TEST', password: LOCAL_TENANT_PASSWORD },
];

export function LoginForm({ portal, eyebrow, title, description }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const localAccounts = process.env.NODE_ENV !== 'production'
    ? LOCAL_LOGIN_ACCOUNTS.filter((account) => portal === 'platform' ? account.value === 'superadmin@platform.local' : account.value !== 'superadmin@platform.local')
    : [];
  const [selectedAccount, setSelectedAccount] = useState('');

  function selectLocalAccount(email: string) {
    const account = localAccounts.find((candidate) => candidate.value === email);
    setSelectedAccount(email);
    setEmail(email);
    setPassword(account?.password ?? '');
    setError(undefined);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch('/api/auth/v1/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, portal }),
      });
      const payload = await response.json() as LoginResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? 'Đăng nhập không thành công.');
      router.replace(payload.redirectTo);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Đăng nhập không thành công.');
    } finally {
      setBusy(false);
    }
  }

  const platform = portal === 'platform';
  return (
    <main className={`${styles.page} ${platform ? styles.platform : styles.tenant}`}>
      <SessionRecovery />
      <section className={styles.context}>
        <Link href="/">
          ← Chọn loại tài khoản
        </Link>
        <div>
          <span>{platform ? 'Quản trị hệ thống' : 'Doanh nghiệp'}</span>
          <h1>{platform ? 'Quản trị hệ thống.' : 'Không gian làm việc.'}</h1>
          <p>
            {platform
              ? 'Dành riêng cho người vận hành hệ thống: tạo doanh nghiệp, cấp phân hệ. Không truy cập được dữ liệu của doanh nghiệp.'
              : 'Quy trình, bảo trì và kho vật tư của doanh nghiệp bạn, trong cùng một nơi.'}
          </p>
        </div>
      </section>

      <section className={styles.login}>
        <form onSubmit={submit}>
          <div>
            <small>{eyebrow}</small>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          {localAccounts.length ? (
            <label>
              Tài khoản local
              <SearchableSelect
                options={localAccounts}
                placeholder="Chọn tài khoản để tự điền email và mật khẩu"
                searchPlaceholder="Tìm theo tên hoặc email…"
                value={selectedAccount}
                onChange={selectLocalAccount}
                clearable
              />
            </label>
          ) : null}
          <label>
            Email
            <input autoComplete="username" autoFocus onChange={(event) => setEmail(event.currentTarget.value)} required type="email" value={email} />
          </label>
          <label>
            Mật khẩu
            <input autoComplete="current-password" onChange={(event) => setPassword(event.currentTarget.value)} required type="password" value={password} />
          </label>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <button disabled={busy} type="submit">
            {busy ? 'Đang xác minh…' : 'Đăng nhập'}
          </button>
          <footer>
            {platform
              ? 'Chỉ dành cho người quản trị hệ thống. Nhân sự doanh nghiệp đăng nhập ở cổng doanh nghiệp.'
              : 'Tài khoản do doanh nghiệp của bạn cấp. Nếu chưa có, liên hệ người quản trị nội bộ.'}
          </footer>
        </form>
      </section>
    </main>
  );
}
