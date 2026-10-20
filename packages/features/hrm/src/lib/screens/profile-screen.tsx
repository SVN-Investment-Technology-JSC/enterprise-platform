'use client';

import { HrmFamilyPanel } from '../ui/hrm-family-panel';
import { HrmContractPanel } from '../ui/hrm-contract-panel';
import { HrmProfileDocumentsPanel } from '../ui/hrm-profile-documents-panel';
import type {
  HrmEmployeeDependent,
  HrmEmploymentContract,
  HrmCareerEvent,
  HrmCareerHistoryItem,
} from '@enterprise-platform/contracts-hrm';
import {
  BadgeCheck,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  CheckSquare,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  GraduationCap,
  Info,
  Landmark,
  Layers,
  Loader2,
  Mail,
  MapPin,
  Network,
  Phone,
  RotateCcw,
  Save,
  ShieldCheck,
  Target,
  User,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { Badge } from '../ui/badge';
import { CareerTimeline } from '../ui/career-timeline';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import { EmployeeHeroCard } from '../ui/employee-hero-card';
import { Input } from '../ui/input';
import { HubTabsSlot } from '../ui/hrm-tab-hub';
import {
  FieldLabel,
  IconInput,
  InfoCell,
  initialsOf,
  ProfileCard,
  FieldLegend,
  ReadonlyField,
  relationshipOptions,
  seniorityText,
} from '../ui/profile-cards';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { toast } from '../ui/toast';
import { hrmFetch, platformAuthApiUrl } from '../hrm-api';
import {
  changedValues,
  formatProfileValue,
  identityPatchBody,
  profileFieldLabels,
  protectedFieldsFromError,
} from '../profile-correction-model';

function formatVnDate(val?: string | null): string {
  if (!val) return '----';
  // Nếu đã ở dạng YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split('-');
    return `${d}/${m}/${y}`;
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val).slice(0, 10);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}


export default function HrmProfilePage() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isJdModalOpen, setIsJdModalOpen] = useState(false);
  const [isAccountMasked, setIsAccountMasked] = useState(true);
  const [dependents, setDependents] = useState<HrmEmployeeDependent[]>([]);
  const [contracts, setContracts] = useState<HrmEmploymentContract[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [, setCareerHistory] = useState<HrmCareerHistoryItem[]>([]);
  const [loadingCareer, setLoadingCareer] = useState(false);
  const [careerEvents, setCareerEvents] = useState<HrmCareerEvent[]>([]);

  const [companyName, setCompanyName] = useState('');
  const [roleLabel, setRoleLabel] = useState('');

  // Identity profile state from server/database
  const [profileMeta, setProfileMeta] = useState({
    fullName: '',
    employeeCode: '',
    workEmail: '',
    gender: '',
    employmentStatus: '',
    dateOfBirth: '',
    identityCardNumber: '',
    identityCardIssuedDate: '',
    identityCardIssuedPlace: '',
    department: '',
    position: '',
    division: '',
    team: '',
    location: '',
    positionCode: '',
    salaryGrade: '',
    directManagerName: '',
    directManagerTitle: '',
    directManagerEmail: '',
    joinDate: '',
    officialDate: '',
    bankAccountNumber: '',
    bankName: '',
    bankBranch: '',
    taxCode: '',
    socialInsuranceNumber: '',
    note: '',
  });

  // Form states for editable identity info
  const [savedIdentity, setSavedIdentity] = useState({
    fullName: '',
    dateOfBirth: '',
    gender: '',
    identityCardNumber: '',
    identityCardIssuedDate: '',
    identityCardIssuedPlace: '',
    nationality: 'Việt Nam',
    ethnicity: 'Kinh',
    maritalStatus: '',
  });
  // Họ tên do Core quản lý (chỉ đọc); ngày sinh và CCCD (số, ngày cấp, nơi cấp) chỉ đọc: đổi qua đơn đính chính nên không có state sửa.
  const [gender, setGender] = useState(savedIdentity.gender);
  const [nationality, setNationality] = useState(savedIdentity.nationality);
  const [ethnicity, setEthnicity] = useState(savedIdentity.ethnicity);
  const [maritalStatus, setMaritalStatus] = useState(
    savedIdentity.maritalStatus,
  );
  const [savingIdentity, setSavingIdentity] = useState(false);
  // Lỗi tải hồ sơ (vd HRM_PROFILE_NOT_INITIALIZED: có ở Core nhưng chưa khởi tạo hồ sơ HRM): hiển thị message của API.
  const [profileLoadError, setProfileLoadError] = useState('');
  // Form states for editable contact info
  const [savedContact, setSavedContact] = useState({
    personalEmail: '',
    phone: '',
    permanentAddress: '',
    currentAddress: '',
  });
  const [personalEmail, setPersonalEmail] = useState(
    savedContact.personalEmail,
  );
  const [phone, setPhone] = useState(savedContact.phone);
  const [permanentAddress, setPermanentAddress] = useState(
    savedContact.permanentAddress,
  );
  const [currentAddress, setCurrentAddress] = useState(
    savedContact.currentAddress,
  );
  const [savingContact, setSavingContact] = useState(false);

  // Form states for editable emergency contact info
  const [savedEmergency, setSavedEmergency] = useState({
    name: '',
    relationship: '',
    phone: '',
  });
  const [emergencyContactName, setEmergencyContactName] = useState(
    savedEmergency.name,
  );
  const [emergencyContactRelationship, setEmergencyContactRelationship] =
    useState(savedEmergency.relationship);
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(
    savedEmergency.phone,
  );
  const [savingEmergency, setSavingEmergency] = useState(false);

  // Load actual data from Database via HRM API
  useEffect(() => {
    async function loadProfile() {
      try {
        const payload = await hrmFetch<{ data: any }>('/my-profile');
        const p = payload.data;
        if (p) {
          const genderLabel =
            p.gender === 'MALE'
              ? 'Nam'
              : p.gender === 'FEMALE'
                ? 'Nữ'
                : p.gender === 'OTHER'
                  ? 'Khác'
                  : p.gender || '';

          const statusLabel =
            p.employmentStatus === 'OFFICIAL'
              ? 'CHÍNH THỨC (Official)'
              : p.employmentStatus === 'PROBATION'
                ? 'THỬ VIỆC (Probation)'
                : p.employmentStatus === 'ON_LEAVE'
                  ? 'NGHỈ PHÉP (On Leave)'
                  : p.employmentStatus === 'RESIGNED'
                    ? 'ĐÃ NGHỈ VIỆC (Resigned)'
                    : p.employmentStatus === 'TERMINATED'
                      ? 'CHẤM DỨT HĐ (Terminated)'
                      : p.employmentStatus || '';

          setProfileMeta({
            fullName: p.fullName || '',
            employeeCode: p.employeeCode || '',
            workEmail: p.email || p.personalEmail || '',
            gender: genderLabel,
            employmentStatus: statusLabel,
            dateOfBirth: p.dateOfBirth ? String(p.dateOfBirth) : '',
            identityCardNumber: p.identityCardNumber || '',
            identityCardIssuedDate: p.identityCardIssuedDate
              ? String(p.identityCardIssuedDate)
              : '',
            identityCardIssuedPlace: p.identityCardIssuedPlace || '',
            department: p.department || '',
            position: p.position || '',
            division: p.division || '',
            team: p.team || '',
            location: p.location || '',
            positionCode: p.positionCode || '',
            salaryGrade: p.salaryGrade || '',
            directManagerName: p.directManagerName || '',
            directManagerTitle: p.directManagerTitle || '',
            directManagerEmail: p.directManagerEmail || '',
            joinDate: p.joinDate ? String(p.joinDate).slice(0, 10) : '',
            officialDate: p.officialDate
              ? String(p.officialDate).slice(0, 10)
              : '',
            bankAccountNumber: p.bankAccountNumber || '',
            bankName: p.bankName || '',
            bankBranch: p.bankBranch || '',
            taxCode: p.taxCode || '',
            socialInsuranceNumber: p.socialInsuranceNumber || '',
            note: p.note || '',
          });

          const newIdentity = {
            fullName: p.fullName || '',
            dateOfBirth: p.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : '',
            gender: p.gender || '',
            identityCardNumber: p.identityCardNumber || '',
            identityCardIssuedDate: p.identityCardIssuedDate
              ? String(p.identityCardIssuedDate).slice(0, 10)
              : '',
            identityCardIssuedPlace: p.identityCardIssuedPlace || '',
            nationality: p.nationality || 'Việt Nam',
            ethnicity: p.ethnicity || 'Kinh',
            maritalStatus: p.maritalStatus || '',
          };
          setSavedIdentity(newIdentity);
          setGender(newIdentity.gender);
          setNationality(newIdentity.nationality);
          setEthnicity(newIdentity.ethnicity);
          setMaritalStatus(newIdentity.maritalStatus);

          const newContact = {
            personalEmail: p.personalEmail || p.email || '',
            phone: p.phone || '',
            permanentAddress: p.permanentAddress || '',
            currentAddress: p.currentAddress || '',
          };
          setSavedContact(newContact);
          setPersonalEmail(newContact.personalEmail);
          setPhone(newContact.phone);
          setPermanentAddress(newContact.permanentAddress);
          setCurrentAddress(newContact.currentAddress);

          const newEmergency = {
            name: p.emergencyContactName || '',
            relationship: p.emergencyContactRelationship || '',
            phone: p.emergencyContactPhone || '',
          };
          setSavedEmergency(newEmergency);
          setEmergencyContactName(newEmergency.name);
          setEmergencyContactRelationship(newEmergency.relationship);
          setEmergencyContactPhone(newEmergency.phone);

          setCompanyName(p.companyName || '');
          setEmployeeId(p.employeeId || '');
          if (p.dependents) {
            setDependents(p.dependents);
          }
          if (p.contracts) {
            setContracts(p.contracts);
          }
        }
      } catch (err) {
        console.error('Không thể tải profile từ API:', err);
        setProfileLoadError(
          err instanceof Error && err.message
            ? err.message
            : 'Không thể tải hồ sơ nhân viên',
        );
      }
    }
    async function loadRole() {
      try {
        const res = await fetch(platformAuthApiUrl('/me'), {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) return;
        const session = await res.json();
        const roles = Array.isArray(session?.roles) ? session.roles : [];
        setRoleLabel(roles.join(', '));
      } catch {
        // Vai trò chỉ để hiển thị; bỏ qua nếu không tải được.
      }
    }
    void loadProfile();
    void loadRole();
  }, []);

  // Tải lịch sử bổ nhiệm & quá trình công tác từ CORE Organization
  useEffect(() => {
    // Tải một lần khi đã có mã nhân viên (để thẻ Công tác hiện tại có chức danh, đơn vị thật) và khi mở ngăn kéo lịch sử.
    if (employeeId || historyOpen) {
      setLoadingCareer(true);
      hrmFetch<{ data: HrmCareerEvent[] }>('/my-profile/career-events')
        .then((payload) => setCareerEvents(payload?.data || []))
        .catch((err) => {
          console.error('Không thể tải lịch sử bổ nhiệm & công tác:', err);
          setCareerEvents([]);
        });
      hrmFetch<{ data: HrmCareerHistoryItem[] }>('/my-profile/career-history')
        .then((payload) => {
          const list: HrmCareerHistoryItem[] = payload?.data || [];
          setCareerHistory(list);
          const activePrimary = list.find((item) => item.status === 'active' && item.isPrimary) ||
            list.find((item) => item.status === 'active') || list[0];
          if (activePrimary) {
            setProfileMeta((prev) => ({
              ...prev,
              position: activePrimary.positionName || prev.position,
              positionCode: activePrimary.positionCode || prev.positionCode,
              department: activePrimary.unitName || prev.department,
            }));
          }
        })
        .catch((err) => {
          console.error('Không thể tải lịch sử bổ nhiệm & công tác:', err);
          setCareerHistory([]);
        })
        .finally(() => {
          setLoadingCareer(false);
        });
    }
  }, [historyOpen, employeeId]);

  const maskAccount = (value: string) =>
    value.length > 4 ? `**** **** ${value.slice(-4)}` : '****';
  const copyText = (value: string, title: string, description: string) => {
    void navigator.clipboard?.writeText(value);
    toast.add({ title, description, type: 'success' });
  };

  // Dirty state detection
  // Chỉ các trường nhân thân được sửa trực tiếp; định danh (ngày sinh, CCCD) đi qua đơn đính chính.
  const identityEdits = changedValues(
    {
      gender: savedIdentity.gender,
      nationality: savedIdentity.nationality,
      ethnicity: savedIdentity.ethnicity,
      maritalStatus: savedIdentity.maritalStatus,
    },
    { gender, nationality, ethnicity, maritalStatus },
  );
  const isIdentityDirty = Object.keys(identityEdits).length > 0;

  const contactEdits = changedValues(savedContact, {
    personalEmail,
    phone,
    permanentAddress,
    currentAddress,
  });
  const isContactDirty = Object.keys(contactEdits).length > 0;

  // Khóa gửi lên API là emergencyContact*; state lưu dùng tên ngắn nên đổi tên khóa khi dựng thân PATCH.
  const emergencyEditsShort = changedValues(savedEmergency, {
    name: emergencyContactName,
    relationship: emergencyContactRelationship,
    phone: emergencyContactPhone,
  });
  const emergencyEdits: Record<string, string> = {};
  if (emergencyEditsShort.name !== undefined)
    emergencyEdits.emergencyContactName = emergencyEditsShort.name;
  if (emergencyEditsShort.relationship !== undefined)
    emergencyEdits.emergencyContactRelationship =
      emergencyEditsShort.relationship;
  if (emergencyEditsShort.phone !== undefined)
    emergencyEdits.emergencyContactPhone = emergencyEditsShort.phone;
  const isEmergencyDirty = Object.keys(emergencyEdits).length > 0;

  const isAnyDirty = isIdentityDirty || isContactDirty || isEmergencyDirty;
  const isSavingAny = savingIdentity || savingContact || savingEmergency;

  // Handlers with API synchronization
  const genderLabelOf = (value: string) =>
    value === 'MALE'
      ? 'Nam'
      : value === 'FEMALE'
        ? 'Nữ'
        : value === 'OTHER'
          ? 'Khác'
          : value || '';

  /** Lỗi lưu hồ sơ: nếu máy chủ yêu cầu đính chính thì báo rõ các trường và mở đường tới đơn đính chính. */
  const reportSaveError = (e: unknown, fallback: string, title: string) => {
    const protectedFields = protectedFieldsFromError(e);
    if (protectedFields) {
      toast.add({
        title: 'Cần gửi đơn đính chính',
        description: `${profileFieldLabels(protectedFields).join(', ') || 'Thông tin định danh'} không sửa trực tiếp được.`,
        type: 'error',
      });
      return;
    }
    toast.add({
      title,
      description: e instanceof Error ? e.message : fallback,
      type: 'error',
    });
  };

  const handleResetIdentityBlock = () => {
    setGender(savedIdentity.gender);
    setNationality(savedIdentity.nationality);
    setEthnicity(savedIdentity.ethnicity);
    setMaritalStatus(savedIdentity.maritalStatus);
    toast.add({
      title: 'Đã hoàn tác thay đổi',
      description:
        'Thông tin nhận diện nhân sự đã được khôi phục về trạng thái ban đầu.',
      type: 'info',
    });
  };

  const handleResetContactBlock = () => {
    setPersonalEmail(savedContact.personalEmail);
    setPhone(savedContact.phone);
    setPermanentAddress(savedContact.permanentAddress);
    setCurrentAddress(savedContact.currentAddress);
    toast.add({
      title: 'Đã hoàn tác thay đổi',
      description:
        'Thông tin liên lạc đã được khôi phục về trạng thái ban đầu.',
      type: 'info',
    });
  };

  const handleResetEmergencyBlock = () => {
    setEmergencyContactName(savedEmergency.name);
    setEmergencyContactRelationship(savedEmergency.relationship);
    setEmergencyContactPhone(savedEmergency.phone);
    toast.add({
      title: 'Đã hoàn tác thay đổi',
      description:
        'Thông tin liên hệ khẩn cấp đã được khôi phục về trạng thái ban đầu.',
      type: 'info',
    });
  };

  const handleSaveAll = async () => {
    if (!isAnyDirty) return;
    setSavingIdentity(true);
    setSavingContact(true);
    setSavingEmergency(true);
    try {
      await hrmFetch('/my-profile', {
        method: 'PATCH',
        body: JSON.stringify({
          ...identityPatchBody(identityEdits),
          ...contactEdits,
          ...emergencyEdits,
        }),
      });

      setSavedIdentity((prev) => ({
        ...prev,
        gender,
        nationality,
        ethnicity,
        maritalStatus,
      }));
      setSavedContact({
        personalEmail,
        phone,
        permanentAddress,
        currentAddress,
      });
      setSavedEmergency({
        name: emergencyContactName,
        relationship: emergencyContactRelationship,
        phone: emergencyContactPhone,
      });

      setProfileMeta((prev) => ({ ...prev, gender: genderLabelOf(gender) }));

      toast.add({
        title: 'Đã lưu toàn bộ thông tin',
        description: 'Dữ liệu hồ sơ cá nhân đã được đồng bộ xuống Database.',
        type: 'success',
      });
    } catch (e) {
      reportSaveError(
        e,
        'Không thể đồng bộ dữ liệu với máy chủ.',
        'Lỗi đồng bộ',
      );
    } finally {
      setSavingIdentity(false);
      setSavingContact(false);
      setSavingEmergency(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      {profileLoadError && (
        <p
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
        >
          {profileLoadError}
        </p>
      )}

      {/* Tiêu đề: tên trang, thanh tab Hồ sơ / Phiếu lương và nút lưu */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Hồ sơ của tôi
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Tra cứu thông tin cá nhân, hồ sơ bảo hiểm, quá trình công tác và tài
            khoản ngân hàng chi trả lương.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <HubTabsSlot />
          {isAnyDirty && (
            <>
              <span className="hidden items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 md:flex">
                <span className="size-1.5 rounded-full bg-amber-500" />
                Có thay đổi chưa lưu
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 text-xs"
                disabled={isSavingAny}
                onClick={() => {
                  handleResetIdentityBlock();
                  handleResetContactBlock();
                  handleResetEmergencyBlock();
                }}
              >
                <RotateCcw className="size-3.5" />
                Hoàn tác
              </Button>
            </>
          )}
          <Button
            size="sm"
            disabled={!isAnyDirty || isSavingAny}
            className="h-9 gap-1.5 text-xs font-semibold"
            onClick={handleSaveAll}
          >
            {isSavingAny ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            <span>{isSavingAny ? 'Đang lưu...' : 'Lưu thay đổi'}</span>
          </Button>
        </div>
      </div>

      <EmployeeHeroCard
        syncLabel="Đồng bộ từ Core"
        profile={{
          fullName: profileMeta.fullName,
          employeeCode: profileMeta.employeeCode,
          employmentStatus: profileMeta.employmentStatus,
          department: profileMeta.department,
          position: profileMeta.position,
          workEmail: profileMeta.workEmail,
          phone,
          roleLabel,
          companyName,
          joinDate: profileMeta.joinDate,
        }}
      />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {/* Cột trái */}
        <div className="space-y-3">
          <ProfileCard
            icon={User}
            title="Thông tin cá nhân"
            testId="profile-personal-card"
          >
            <FieldLegend />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ReadonlyField id="profile-full-name" label="Họ và tên" value={savedIdentity.fullName} hint="Do Core HRM quản lý" />
              <ReadonlyField id="profile-employee-code" label="Mã nhân viên" value={profileMeta.employeeCode} mono hint="Do hệ thống cấp" />
              <ReadonlyField
                id="profile-date-of-birth"
                label="Ngày sinh"
                icon={Calendar}
                hint="Đổi qua đơn đính chính"
                value={
                  savedIdentity.dateOfBirth
                    ? formatProfileValue('dateOfBirth', savedIdentity.dateOfBirth)
                    : ''
                }
              />
              <div className="space-y-1">
                <FieldLabel>Giới tính</FieldLabel>
                <SearchableSelect
                  height={36}
                  value={gender}
                  onChange={(val) => setGender(val)}
                  options={[
                    { value: 'MALE', label: 'Nam' },
                    { value: 'FEMALE', label: 'Nữ' },
                    { value: 'OTHER', label: 'Khác' },
                  ]}
                  placeholder="Chọn giới tính"
                  searchPlaceholder="Tìm giới tính..."
                  clearable
                />
              </div>
              <ReadonlyField id="profile-id-number" label="Số CCCD / CMND" icon={CreditCard} mono value={savedIdentity.identityCardNumber} hint="Đổi qua đơn đính chính" />
              <ReadonlyField
                id="profile-id-issued-date"
                label="Ngày cấp"
                icon={Calendar}
                hint="Đổi qua đơn đính chính"
                value={
                  savedIdentity.identityCardIssuedDate
                    ? formatProfileValue('identityCardIssuedDate', savedIdentity.identityCardIssuedDate)
                    : ''
                }
              />
              <div className="sm:col-span-2">
                <ReadonlyField id="profile-id-issued-place" label="Nơi cấp" icon={MapPin} value={savedIdentity.identityCardIssuedPlace} hint="Đổi qua đơn đính chính" />
              </div>
              <div className="space-y-1">
                <label htmlFor="profile-nationality" className="block text-[11px] font-semibold text-slate-600">
                  Quốc tịch
                </label>
                <Input
                  id="profile-nationality"
                  type="text"
                  value={nationality}
                  placeholder="Việt Nam"
                  onChange={(e) => setNationality(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="profile-ethnicity" className="block text-[11px] font-semibold text-slate-600">
                  Dân tộc
                </label>
                <Input
                  id="profile-ethnicity"
                  type="text"
                  value={ethnicity}
                  placeholder="Kinh"
                  onChange={(e) => setEthnicity(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <FieldLabel>Tình trạng hôn nhân</FieldLabel>
                <SearchableSelect
                  height={36}
                  value={maritalStatus}
                  onChange={(val) => setMaritalStatus(val)}
                  options={[
                    { value: 'Độc thân', label: 'Độc thân' },
                    { value: 'Đã kết hôn', label: 'Đã kết hôn' },
                    { value: 'Ly hôn', label: 'Ly hôn' },
                    { value: 'Khác', label: 'Khác' },
                  ]}
                  placeholder="Chọn tình trạng hôn nhân"
                  searchPlaceholder="Tìm tình trạng..."
                  clearable
                />
              </div>
            </div>
          </ProfileCard>

          {employeeId && (
            <HrmProfileDocumentsPanel
              employeeId={employeeId}
              mode="self"
              variant="compact"
              identityCardNumber={profileMeta.identityCardNumber}
            />
          )}
        </div>

        {/* Cột phải */}
        <div className="space-y-3">
          <ProfileCard
            icon={Phone}
            title="Liên hệ & người thân"
            testId="profile-contact-card"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <IconInput id="profile-email" label="Email cá nhân" type="email" icon={Mail} value={personalEmail} placeholder="Chưa cập nhật email cá nhân" onChange={setPersonalEmail} />
              <IconInput id="profile-phone" label="Số điện thoại di động" type="tel" icon={Phone} value={phone} placeholder="Chưa cập nhật số điện thoại" onChange={setPhone} />
              <IconInput id="profile-permanent-address" label="Địa chỉ thường trú" icon={MapPin} value={permanentAddress} placeholder="Chưa cập nhật địa chỉ thường trú" onChange={setPermanentAddress} />
              <IconInput id="profile-current-address" label="Địa chỉ tạm trú / Nơi ở hiện tại" icon={MapPin} value={currentAddress} placeholder="Chưa cập nhật địa chỉ nơi ở hiện tại" onChange={setCurrentAddress} />
            </div>
            <div className="mt-4 border-t border-slate-100 pt-3">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
                <Users className="size-4 text-blue-600" aria-hidden="true" />
                Người liên hệ khẩn cấp
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <IconInput id="profile-emergency-name" label="Họ và tên" required icon={User} value={emergencyContactName} placeholder="Chưa có thông tin người liên hệ" onChange={setEmergencyContactName} />
                <div className="space-y-1">
                  <FieldLabel>
                    Mối quan hệ<span className="ml-0.5 text-red-500">*</span>
                  </FieldLabel>
                  <SearchableSelect
                    height={36}
                    value={emergencyContactRelationship}
                    onChange={(val) => setEmergencyContactRelationship(val)}
                    options={relationshipOptions(emergencyContactRelationship)}
                    placeholder="Chọn mối quan hệ"
                    searchPlaceholder="Tìm mối quan hệ..."
                    clearable
                  />
                </div>
                <IconInput id="profile-emergency-phone" label="Số điện thoại" required type="tel" icon={Phone} value={emergencyContactPhone} placeholder="Chưa có SĐT khẩn cấp" onChange={setEmergencyContactPhone} />
              </div>
            </div>
          </ProfileCard>

          <ProfileCard
            icon={Landmark}
            title="Thông tin ngân hàng nhận lương"
            testId="profile-bank-card"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ReadonlyField id="profile-bank-name" label="Ngân hàng" value={profileMeta.bankName} />
              <div className="space-y-1">
                <label htmlFor="profile-bank-account" className="block text-[11px] font-semibold text-slate-600">
                  Số tài khoản
                </label>
                <div className="relative">
                  <CreditCard className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <Input
                    id="profile-bank-account"
                    type="text"
                    readOnly
                    value={
                      profileMeta.bankAccountNumber
                        ? isAccountMasked
                          ? maskAccount(profileMeta.bankAccountNumber)
                          : profileMeta.bankAccountNumber
                        : ''
                    }
                    className="h-9 bg-slate-50 pl-9 pr-16 font-mono text-xs"
                  />
                  {profileMeta.bankAccountNumber && (
                    <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center">
                      <button
                        type="button"
                        aria-label={isAccountMasked ? 'Hiện số tài khoản đầy đủ' : 'Ẩn số tài khoản'}
                        title={isAccountMasked ? 'Hiện số tài khoản đầy đủ' : 'Ẩn số tài khoản'}
                        onClick={() => setIsAccountMasked(!isAccountMasked)}
                        className="rounded p-1 text-slate-400 hover:text-slate-700"
                      >
                        {isAccountMasked ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                      </button>
                      <button
                        type="button"
                        aria-label="Sao chép số tài khoản"
                        title="Sao chép số tài khoản"
                        onClick={() => copyText(profileMeta.bankAccountNumber, 'Sao chép STK thành công', `Đã lưu số tài khoản ${profileMeta.bankAccountNumber} vào khay nhớ tạm.`)}
                        className="rounded p-1 text-slate-400 hover:text-slate-700"
                      >
                        <Copy className="size-4" />
                      </button>
                    </span>
                  )}
                </div>
              </div>
              <ReadonlyField id="profile-bank-holder" label="Chủ tài khoản" icon={User} value={profileMeta.fullName} />
              <ReadonlyField id="profile-bank-branch" label="Chi nhánh" icon={MapPin} value={profileMeta.bankBranch} />
              <ReadonlyField id="profile-tax-code" label="Mã số thuế cá nhân" mono value={profileMeta.taxCode} />
              <ReadonlyField id="profile-social-insurance" label="Số sổ BHXH" mono value={profileMeta.socialInsuranceNumber} />
            </div>
            <p className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
              <ShieldCheck className="size-3.5 shrink-0 text-slate-400" />
              Thông tin tài khoản ngân hàng được bảo mật và chỉ hiển thị cho các vai trò có thẩm quyền. Cần thay đổi vui lòng liên hệ phòng Nhân sự.
            </p>
          </ProfileCard>
        </div>
      </div>

      {/* Công tác hiện tại */}
      <ProfileCard
        icon={Briefcase}
        title="Công tác hiện tại"
        testId="profile-current-work"
        action={
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
          >
            Xem lịch sử công tác & hợp đồng
            <ChevronRight className="size-3.5" />
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <InfoCell label="Chức danh công việc">{profileMeta.position || '----'}</InfoCell>
          <InfoCell label="Đơn vị công tác">{profileMeta.department || '----'}</InfoCell>
          <div className="min-w-0">
            <p className="text-[11px] text-slate-500">Quản lý trực tiếp</p>
            {profileMeta.directManagerName ? (
              <p className="mt-0.5 flex items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
                  {initialsOf(profileMeta.directManagerName)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {profileMeta.directManagerName}
                  </span>
                  {profileMeta.directManagerTitle && (
                    <span className="block truncate text-[11px] text-slate-500">
                      {profileMeta.directManagerTitle}
                    </span>
                  )}
                </span>
              </p>
            ) : (
              <p className="mt-0.5 text-sm font-semibold text-slate-900">----</p>
            )}
          </div>
          <InfoCell label="Ngày hiệu lực" icon={Calendar}>
            {profileMeta.joinDate ? formatVnDate(profileMeta.joinDate) : '----'}
          </InfoCell>
          <InfoCell label="Thâm niên công tác" icon={Clock}>
            {seniorityText(profileMeta.joinDate)}
          </InfoCell>
        </div>
      </ProfileCard>

      {/* Người phụ thuộc */}
      <HrmFamilyPanel rows={dependents} onChanged={setDependents} />

      {/* Ngăn kéo: quá trình công tác và hợp đồng */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-white p-0 sm:max-w-[1000px]">
          <SheetHeader className="shrink-0 border-b border-slate-200 bg-slate-50/70">
            <SheetTitle>Quá trình công tác và hợp đồng</SheetTitle>
            <SheetDescription>
              Dữ liệu đồng bộ từ Core HRM, quản lý bởi Ban Nhân sự.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-4 text-xs text-slate-700 flex items-start sm:items-center gap-3 shadow-sm">
              <Info className="size-5 text-blue-700 shrink-0" />
              <div className="flex-1">
                <span className="font-bold text-slate-900">
                  Thông báo quản trị:
                </span>{' '}
                Thông tin quá trình công tác được đồng bộ trực tiếp từ hệ thống
                Core HRM và quản lý bởi Ban Nhân sự. Mọi thay đổi về vị trí hoặc
                quyết định bổ nhiệm vui lòng liên hệ phòng Tổ chức - Cán bộ.
              </div>
              <Badge className="bg-blue-100 text-blue-800 border border-blue-200 shrink-0 hidden md:inline-flex gap-1 text-[11px]">
                <BadgeCheck className="size-3.5" />
                Đã xác thực
              </Badge>
            </div>

            {/* Cơ cấu tổ chức và vị trí công tác: chỉ hiển thị chữ, không hiện mã nội bộ */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-[#021E73]">
                    <Building2 className="size-5" />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-slate-900">
                      Cơ cấu tổ chức và vị trí công tác
                    </h3>
                    {profileMeta.employmentStatus && (
                      <Badge className="bg-blue-100 text-blue-800 text-[10px] font-bold border border-blue-200">
                        {profileMeta.employmentStatus}
                      </Badge>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open(
                      employeeId
                        ? `/organization?highlight=${employeeId}`
                        : '/organization',
                      '_blank',
                    )
                  }
                  className="text-xs h-8 px-3 gap-1.5 border-slate-300 hover:bg-blue-50 hover:text-blue-900"
                >
                  <ExternalLink className="size-3.5" />
                  <span>Xem trên Sơ đồ tổ chức</span>
                </Button>
              </div>

              <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 text-sm">
                {(
                  [
                    ['Công ty', companyName],
                    ['Khối đơn vị', profileMeta.division],
                    ['Phòng ban', profileMeta.department],
                    ['Bộ phận / Đội nhóm', profileMeta.team],
                    ['Địa điểm làm việc', profileMeta.location],
                    ['Chức danh', profileMeta.position],
                    [
                      'Hiệu lực bổ nhiệm',
                      profileMeta.officialDate || profileMeta.joinDate
                        ? formatVnDate(
                          profileMeta.officialDate || profileMeta.joinDate,
                        )
                        : null,
                    ],
                    [
                      'Quản lý trực tiếp',
                      profileMeta.directManagerName
                        ? profileMeta.directManagerTitle
                          ? `${profileMeta.directManagerName} (${profileMeta.directManagerTitle})`
                          : profileMeta.directManagerName
                        : null,
                    ],
                  ] as [string, string | null | undefined][]
                ).map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-start justify-between gap-4 py-2.5 border-b border-slate-100"
                  >
                    <dt className="text-slate-500 shrink-0">{label}</dt>
                    <dd className="font-semibold text-slate-900 text-right">
                      {value || '----'}
                    </dd>
                  </div>
                ))}
              </dl>
              {profileMeta.note && (
                <p className="text-xs text-slate-600 leading-relaxed">
                  <span className="text-slate-500">Phạm vi trách nhiệm: </span>
                  {profileMeta.note}
                </p>
              )}
            </div>

            {/* Timeline of promotions / employment events */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                  <span className="w-1.5 h-4 bg-[#021E73] rounded-full" />
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    Lịch sử bổ nhiệm và công tác
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(employeeId ? `/organization?highlight=${employeeId}` : '/organization', '_blank')}
                    className="h-7 text-xs px-2.5 gap-1.5 text-slate-700 hover:text-slate-900 border-slate-300 shadow-2xs"
                    title="Mở sơ đồ tổ chức công ty"
                  >
                    <Network className="size-3.5 text-[#021E73]" />
                    <span>Xem trên Sơ đồ tổ chức</span>
                    <ExternalLink className="size-3 text-slate-400" />
                  </Button>
                  <Badge variant="outline" className="text-slate-500 text-[11px]">
                    {loadingCareer
                      ? 'Đang tải...'
                      : careerEvents.length > 0
                        ? `${careerEvents.length} sự kiện`
                        : profileMeta.joinDate || profileMeta.officialDate
                          ? 'Dữ liệu sơ bộ hồ sơ'
                          : 'Chưa có sự kiện'}
                  </Badge>
                </div>
              </div>

              {loadingCareer ? (
                <div className="py-10 flex flex-col items-center justify-center gap-2 text-slate-500 text-xs">
                  <Loader2 className="size-5 animate-spin text-[#021E73]" />
                  <span>Đang tải lịch sử bổ nhiệm và công tác...</span>
                </div>
              ) : careerEvents.length > 0 ? (
                <CareerTimeline events={careerEvents} />
              ) : (
                <div className="relative pl-6 sm:pl-8 border-l-2 border-blue-200 space-y-6 ml-2 sm:ml-4">
                  {profileMeta.officialDate && (
                    <div className="relative">
                      <span className="absolute -left-[31px] sm:-left-[39px] top-1 size-4 rounded-full bg-[#021E73] border-2 border-white ring-2 ring-blue-200" />
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-xs font-bold text-slate-900">
                              {profileMeta.position
                                ? `Bổ nhiệm chính thức: ${profileMeta.position}`
                                : 'Chuyển nhân sự chính thức'}
                            </h4>
                            <Badge className="bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                              Hiện tại
                            </Badge>
                          </div>
                          <span className="text-xs font-semibold text-blue-700">
                            {formatVnDate(profileMeta.officialDate)} - Nay
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mb-2">
                          Được tiếp nhận và bổ nhiệm vị trí chính thức tại tổ chức.
                          Trạng thái lao động:{' '}
                          <strong>{profileMeta.employmentStatus || '----'}</strong>
                          .
                        </p>
                        <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500 font-medium">
                          <span>Phòng ban: {profileMeta.department || '----'}</span>
                          <span>•</span>
                          <span>Chức vụ: {profileMeta.position || '----'}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {profileMeta.joinDate && (
                    <div className="relative">
                      <span className="absolute -left-[31px] sm:-left-[39px] top-1 size-4 rounded-full bg-blue-400 border-2 border-white ring-2 ring-blue-100" />
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-xs font-bold text-slate-900">
                              Gia nhập công ty (Onboarding)
                            </h4>
                            <Badge
                              variant="outline"
                              className="text-slate-600 text-[10px]"
                            >
                              Khởi đầu
                            </Badge>
                          </div>
                          <span className="text-xs font-semibold text-slate-500">
                            {formatVnDate(profileMeta.joinDate)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mb-2">
                          Ngày bắt đầu làm việc tại {companyName || 'công ty'} theo quyết
                          định tiếp nhận nhân sự.
                        </p>
                        <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500 font-medium">

                        </div>
                      </div>
                    </div>
                  )}

                  {!profileMeta.joinDate && !profileMeta.officialDate && (
                    <div className="text-xs text-slate-500 italic py-2">
                      Chưa có dữ liệu lịch sử công tác được ghi nhận trong cơ sở dữ
                      liệu.
                    </div>
                  )}
                </div>
              )}
            </div>

            {employeeId && <HrmContractPanel employeeId={employeeId} rows={contracts} onChanged={setContracts} readOnly />}
          </div>
        </SheetContent>
      </Sheet>

      {/* Modal: Job Description & Competencies Dialog - Enterprise Spec Sheet */}
      <Dialog open={isJdModalOpen} onOpenChange={setIsJdModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden gap-0 bg-white">
          {/* Header với nhận diện chức danh & Metadata */}
          <div className="p-5 border-b border-slate-200 bg-slate-50/80">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="size-11 rounded-xl bg-[#021E73] text-white flex items-center justify-center shadow-xs shrink-0 mt-0.5">
                  <Briefcase className="size-5" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-slate-900 leading-snug">
                      {profileMeta.position || '----'}
                    </h3>
                    <Badge className="bg-[#021E73] text-white text-[10px] font-bold">
                      {profileMeta.position ? 'ACTIVE' : '----'}
                    </Badge>
                    <span className="font-mono text-[11px] px-2 py-0.5 bg-white border border-slate-200 rounded text-slate-700 font-semibold">
                      {profileMeta.employeeCode || '----'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium">
                    {profileMeta.position || '----'} •{' '}
                    {profileMeta.department || '----'}
                  </p>
                </div>
              </div>
              <Badge
                variant="outline"
                className={`text-[10px] ${profileMeta.position ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-slate-500 bg-slate-50 border-slate-200'} gap-1 font-semibold shrink-0`}
              >
                <CheckCircle2 className="size-3" />
                {profileMeta.position
                  ? 'Khung JD ban hành chính thức'
                  : 'Chưa có JD'}
              </Badge>
            </div>

            {/* Dải thông số chức danh ngắn gọn */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4 pt-3 border-t border-slate-200/80 text-[11px]">
              <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200/80">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">
                  Phòng ban
                </span>
                <span className="font-bold text-slate-800 truncate block">
                  {profileMeta.department || '----'}
                </span>
              </div>
              <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200/80">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">
                  Báo cáo cho
                </span>
                <span className="font-bold text-slate-800 truncate block">
                  ----
                </span>
              </div>
              <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200/80">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">
                  Hình thức làm việc
                </span>
                <span className="font-bold text-slate-800 truncate block">
                  Toàn thời gian
                </span>
              </div>
              <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200/80">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">
                  Kỳ soát xét JD
                </span>
                <span className="font-bold text-slate-800 truncate block">
                  ----
                </span>
              </div>
            </div>
          </div>

          {/* Body nội dung cuộn nội bộ */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-slate-700">
            {/* Mục tiêu cốt lõi của vị trí */}
            <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-100 flex items-start gap-3">
              <Target className="size-5 text-[#021E73] shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-[#021E73] uppercase tracking-wide text-[11px] mb-1">
                  Mục tiêu cốt lõi của chức danh (Job Purpose)
                </h4>
                <p className="text-slate-600 leading-relaxed text-xs">
                  Chịu trách nhiệm bảo đảm độ tin cậy vận hành liên tục 24/7 của
                  toàn bộ hệ thống cơ điện, tự động hóa hạ tầng và các hệ thống
                  phụ trợ tòa nhà; phòng ngừa rủi ro gián đoạn nguồn cấp điện kỹ
                  thuật và duy trì tuân thủ nghiêm ngặt các quy chuẩn an toàn
                  lao động quốc gia.
                </p>
              </div>
            </div>

            {/* Khối 1: Nhiệm vụ & Trách nhiệm chính (Phân rã theo mảng công tác) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-200">
                <h4 className="font-bold text-slate-900 uppercase tracking-wide text-xs flex items-center gap-2">
                  <CheckSquare className="size-4 text-[#021E73]" />
                  Nhiệm vụ &amp; Trách nhiệm chính (Key Responsibilities)
                </h4>
                <span className="text-[10px] text-slate-400 font-mono">
                  Tỷ trọng KPI
                </span>
              </div>

              <div className="space-y-2.5">
                <div className="p-3 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors bg-white">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-bold text-slate-800 text-xs">
                      1. Giám sát vận hành &amp; Bảo trì ngăn ngừa (Preventive
                      Maintenance)
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-mono text-blue-700 bg-blue-50 border-blue-200"
                    >
                      35%
                    </Badge>
                  </div>
                  <p className="text-slate-600 leading-relaxed text-[11px]">
                    Thực hiện lịch kiểm tra định kỳ hệ thống trạm biến áp, tủ
                    điện phân phối hạ thế, hệ thống điều hòa thông gió HVAC, máy
                    phát điện dự phòng và bộ lưu điện UPS theo đúng checklist
                    quy trình.
                  </p>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors bg-white">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-bold text-slate-800 text-xs">
                      2. Điều phối &amp; Ứng phó sự cố khẩn cấp (Incident
                      Response 24/7)
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-mono text-blue-700 bg-blue-50 border-blue-200"
                    >
                      25%
                    </Badge>
                  </div>
                  <p className="text-slate-600 leading-relaxed text-[11px]">
                    Trực tiếp có mặt tại hiện trường xử lý các cảnh báo sự cố kỹ
                    thuật hạ tầng theo cam kết SLA phản hồi dưới 15 phút; thiết
                    lập nguồn điện thay thế khẩn cấp và lập báo cáo nguyên nhân
                    gốc rễ (RCA).
                  </p>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors bg-white">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-bold text-slate-800 text-xs">
                      3. Quản trị vật tư phụ tùng &amp; Nhật ký số hóa EAM/HRM
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-mono text-blue-700 bg-blue-50 border-blue-200"
                    >
                      20%
                    </Badge>
                  </div>
                  <p className="text-slate-600 leading-relaxed text-[11px]">
                    Đề xuất danh mục vật tư thay thế tiêu hao, quản lý tồn kho
                    dự phòng an toàn cơ điện và hoàn tất số hóa 100% phiếu xuất
                    bảo trì trên phân hệ EAM của nền tảng.
                  </p>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors bg-white">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-bold text-slate-800 text-xs">
                      4. An toàn lao động, Huấn luyện nghiệp vụ &amp; Đào tạo
                      nội bộ
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-mono text-blue-700 bg-blue-50 border-blue-200"
                    >
                      20%
                    </Badge>
                  </div>
                  <p className="text-slate-600 leading-relaxed text-[11px]">
                    Giám sát tuân thủ bảo hộ lao động cho kỹ sư mới và nhà thầu
                    phụ; làm mentor hướng dẫn thực tập sinh kỹ thuật và tham gia
                    diễn tập PCCC, sự cố áp lực cao định kỳ.
                  </p>
                </div>
              </div>
            </div>

            {/* Khối 2: Tiêu chuẩn năng lực & Điều kiện tiên quyết */}
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-200">
                <h4 className="font-bold text-slate-900 uppercase tracking-wide text-xs flex items-center gap-2">
                  <GraduationCap className="size-4 text-[#021E73]" />
                  Khung tiêu chuẩn năng lực &amp; Chứng chỉ (Competency &amp;
                  Requirements)
                </h4>
                <span className="text-[10px] font-semibold text-slate-500">
                  Đạt chuẩn Level III
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-lg bg-slate-50/70 border border-slate-200 space-y-2">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5 text-[11px]">
                    <Layers className="size-3.5 text-[#021E73]" />
                    Trình độ chuyên môn &amp; Kinh nghiệm
                  </span>
                  <ul className="space-y-1.5 list-disc pl-4 text-slate-600 text-[11px]">
                    <li>
                      Tốt nghiệp Đại học chuyên ngành Điện, Cơ điện, Tự động hóa
                      hoặc liên quan.
                    </li>
                    <li>
                      Tối thiểu <strong>03 năm kinh nghiệm</strong> vận hành bảo
                      trì cơ điện tòa nhà / trung tâm dữ liệu.
                    </li>
                    <li>
                      Thành thạo đọc bản vẽ kỹ thuật CAD, sơ đồ nguyên lý mạch
                      điện một sợi (Single-line diagram).
                    </li>
                  </ul>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50/70 border border-slate-200 space-y-2">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5 text-[11px]">
                    <ShieldCheck className="size-3.5 text-emerald-600" />
                    Chứng chỉ hành nghề &amp; Kỹ năng bắt buộc
                  </span>
                  <ul className="space-y-1.5 list-disc pl-4 text-slate-600 text-[11px]">
                    <li>
                      Chứng chỉ An toàn vệ sinh lao động -{' '}
                      <strong>Nhóm 3</strong> (Thao tác thiết bị điện áp cao).
                    </li>
                    <li>
                      Chứng nhận huấn luyện vận hành thiết bị áp lực và phòng
                      cháy chữa cháy cơ sở.
                    </li>
                    <li>
                      Kỹ năng phân tích xử lý sự cố độc lập và tinh thần trực
                      chiến ca đêm.
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Quyền hạn & Mối quan hệ công tác */}
            <div className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-slate-600">
              <div className="space-y-0.5">
                <span className="font-bold text-slate-800 block text-[11px]">
                  Quyền hạn chức danh (Authority Scope):
                </span>
                <p className="text-[11px]">
                  Được quyền ký xác nhận phiếu bàn giao thiết bị sau bảo dưỡng;
                  được quyền tạm ngắt thiết bị khi phát hiện nguy cơ mất an toàn
                  điện nghiêm trọng và báo cáo khẩn cấp cho Quản lý trực tiếp.
                </p>
              </div>
              <div className="text-[10px] text-slate-400 font-mono shrink-0 sm:text-right">
                <div>Phiên bản JD: v2.4 (2023)</div>
                <div>Ban hành bởi Ban Nhân sự</div>
              </div>
            </div>
          </div>

          {/* Footer nút thao tác */}
          <div className="p-4 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between">
            <div className="text-[11px] text-slate-500 hidden sm:flex items-center gap-1">
              <Info className="size-3.5 text-slate-400" />
              <span>
                Dữ liệu lưu trữ trong mô-đun{' '}
                <code className="font-mono text-slate-700 font-semibold">
                  hrm_position_profiles
                </code>
              </span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Button
                size="sm"
                className="bg-[#021E73] hover:bg-blue-900 text-white text-xs font-semibold h-8"
                onClick={() => setIsJdModalOpen(false)}
              >
                Đóng cửa sổ
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
