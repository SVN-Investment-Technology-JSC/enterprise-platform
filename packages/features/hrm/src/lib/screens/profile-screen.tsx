'use client';

import {HrmFamilyPanel} from '../ui/hrm-family-panel';
import {HrmContractPanel} from '../ui/hrm-contract-panel';
import {HrmProfileDocumentsPanel} from '../ui/hrm-profile-documents-panel';
import type {
  HrmEmployeeDependent,
  HrmEmploymentContract,
  HrmCareerHistoryItem,
} from '@enterprise-platform/contracts-hrm';
import {
  Award,
  BadgeCheck,
  Briefcase,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  GraduationCap,
  History,
  Info,
  Landmark,
  Layers,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Network,
  PencilLine,
  Phone,
  RotateCcw,
  Save,
  ShieldCheck,
  Target,
  User,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import { EmployeeHeroCard } from '../ui/employee-hero-card';
import { Input } from '../ui/input';
import { toast } from '../ui/toast';
import { hrmFetch, platformAuthApiUrl } from '../hrm-api';
import { ProfileCorrectionDialog } from '../ui/profile-correction-dialog';
import {
  PROFILE_CORRECTION_GROUPS,
  changedValues,
  formatProfileValue,
  identityPatchBody,
  profileFieldLabels,
  protectedFieldsFromError,
  type ProfileCorrectionField,
} from '../profile-correction-model';

type SubTabKey = 'personal' | 'work_history' | 'bank_tax';

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
  const [activeTab, setActiveTab] = useState<SubTabKey>('personal');
  const [isJdModalOpen, setIsJdModalOpen] = useState(false);
  const [isAccountMasked, setIsAccountMasked] = useState(true);
  const [dependents, setDependents] = useState<HrmEmployeeDependent[]>([]);
  const [contracts, setContracts] = useState<HrmEmploymentContract[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [careerHistory, setCareerHistory] = useState<HrmCareerHistoryItem[]>([]);
  const [loadingCareer, setLoadingCareer] = useState(false);

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
  // Dialog đề nghị đính chính: danh sách trường đang mở (null = đóng).
  const [correctionFields, setCorrectionFields] = useState<
    ProfileCorrectionField[] | null
  >(null);
  // Các trường máy chủ yêu cầu đính chính khi lưu trực tiếp bị từ chối.
  const [approvalRequiredFields, setApprovalRequiredFields] = useState<
    ProfileCorrectionField[] | null
  >(null);

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
    if (activeTab === 'work_history') {
      setLoadingCareer(true);
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
  }, [activeTab, employeeId]);

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
      setApprovalRequiredFields(protectedFields);
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

  const handleSaveIdentityBlock = async () => {
    if (!isIdentityDirty) return;
    setSavingIdentity(true);
    try {
      await hrmFetch('/my-profile', {
        method: 'PATCH',
        body: JSON.stringify(identityPatchBody(identityEdits)),
      });

      setSavedIdentity((prev) => ({
        ...prev,
        gender,
        nationality,
        ethnicity,
        maritalStatus,
      }));
      setProfileMeta((prev) => ({ ...prev, gender: genderLabelOf(gender) }));

      toast.add({
        title: 'Đã lưu thông tin nhân thân',
        description: 'Giới tính, quốc tịch, dân tộc và hôn nhân đã được cập nhật.',
        type: 'success',
      });
    } catch (e) {
      reportSaveError(
        e,
        'Không thể lưu thông tin nhân thân. Vui lòng thử lại.',
        'Lỗi cập nhật',
      );
    } finally {
      setSavingIdentity(false);
    }
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

  const handleSaveContactBlock = async () => {
    if (!isContactDirty) return;
    setSavingContact(true);
    try {
      await hrmFetch('/my-profile', {
        method: 'PATCH',
        body: JSON.stringify(contactEdits),
      });

      setSavedContact({
        personalEmail,
        phone,
        permanentAddress,
        currentAddress,
      });

      toast.add({
        title: 'Đã lưu thông tin liên lạc',
        description:
          'Dữ liệu đã được lưu thành công vào cơ sở dữ liệu hệ thống.',
        type: 'success',
      });
    } catch (e) {
      reportSaveError(
        e,
        'Không thể lưu thông tin vào cơ sở dữ liệu. Vui lòng thử lại.',
        'Lỗi cập nhật',
      );
    } finally {
      setSavingContact(false);
    }
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

  const handleSaveEmergencyBlock = async () => {
    if (!isEmergencyDirty) return;
    setSavingEmergency(true);
    try {
      await hrmFetch('/my-profile', {
        method: 'PATCH',
        body: JSON.stringify(emergencyEdits),
      });

      setSavedEmergency({
        name: emergencyContactName,
        relationship: emergencyContactRelationship,
        phone: emergencyContactPhone,
      });

      toast.add({
        title: 'Đã lưu thông tin liên hệ khẩn cấp',
        description: 'Thông tin liên hệ khẩn cấp đã được lưu vào database.',
        type: 'success',
      });
    } catch (e) {
      reportSaveError(
        e,
        'Không thể lưu thông tin khẩn cấp vào database.',
        'Lỗi cập nhật',
      );
    } finally {
      setSavingEmergency(false);
    }
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
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {profileLoadError && (
        <p
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
        >
          {profileLoadError}
        </p>
      )}
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
            Không gian Nhân sự Cá nhân
          </span>
          <h2 className="text-xl font-bold tracking-tight text-slate-950 mt-0.5">
            Hồ sơ của tôi
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Tra cứu thông tin cá nhân, hồ sơ bảo hiểm, quá trình công tác và tài
            khoản ngân hàng chi trả lương.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          {isAnyDirty && (
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md font-medium animate-pulse flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-amber-500" />
              Có thay đổi chưa lưu
            </span>
          )}
          <Button
            size="sm"
            disabled={!isAnyDirty || isSavingAny}
            className={`font-semibold text-xs shadow-sm gap-1.5 rounded-md h-9 transition-all ${
              isAnyDirty
                ? 'bg-[#2563eb] hover:bg-blue-700 text-white shadow-blue-200 shadow'
                : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
            }`}
            onClick={handleSaveAll}
          >
            {isSavingAny ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            <span>{isSavingAny ? 'Đang lưu...' : 'Lưu toàn bộ thay đổi'}</span>
          </Button>
        </div>
      </div>

      {/* Hero Employee Identity Card */}
      <EmployeeHeroCard
        profile={{
          fullName: profileMeta.fullName,
          employeeCode: profileMeta.employeeCode,
          employmentStatus: profileMeta.employmentStatus,
          department: profileMeta.department,
          position: profileMeta.position,
          workEmail: profileMeta.workEmail,
          phone: phone,
          roleLabel,
          companyName,
          joinDate: profileMeta.joinDate,
        }}
      />

      {/* Sub-tabs Navigation */}
      <div className="border-b border-slate-200">
        <div className="flex space-x-8 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('personal')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'personal'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <User className="size-4" />
            <span>Thông tin cá nhân</span>
            {activeTab === 'personal' && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white">
                Đang xem
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('work_history')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'work_history'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <History className="size-4" />
            <span>Quá trình công tác</span>
            {activeTab === 'work_history' && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white">
                Đang xem
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('bank_tax')}
            className={`py-3 px-1 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'bank_tax'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Landmark className="size-4" />
            <span>Lương - Thuế - Ngân hàng</span>
            {activeTab === 'bank_tax' && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white">
                Đang xem
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Sub-tab 1: Personal Information */}
      {activeTab === 'personal' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Block (5 cols): Identity & Citizen Card (Editable Self-Service) */}
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-4 bg-blue-600 rounded-full" />
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      Khối Nhận diện nhân sự
                    </h3>
                  </div>
                  <Badge className="bg-slate-100 text-slate-700 border border-slate-200 text-[10px] gap-1 font-semibold">
                    <Lock className="size-3" />
                    Định danh chỉ đọc
                  </Badge>
                </div>

                {approvalRequiredFields && (
                  <div
                    role="alert"
                    className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900 space-y-2"
                  >
                    <p>
                      Không lưu trực tiếp được:{' '}
                      <strong>
                        {profileFieldLabels(approvalRequiredFields).join(', ') ||
                          'thông tin định danh'}
                      </strong>
                      . Ngày sinh và CCCD phải gửi đơn đính chính để
                      được duyệt.
                    </p>
                    <Button
                      type="button"
                      permission="hrm.self.request"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        setCorrectionFields(
                          approvalRequiredFields.length
                            ? approvalRequiredFields
                            : PROFILE_CORRECTION_GROUPS.flatMap((g) => g.fields),
                        );
                        setApprovalRequiredFields(null);
                      }}
                    >
                      Gửi đề nghị đính chính
                    </Button>
                  </div>
                )}

                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                    <span className="text-slate-500">
                      Mã nhân viên (employee_code)
                    </span>
                    <span className="font-bold text-slate-900 font-mono">
                      {profileMeta.employeeCode || '----'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div className="sm:col-span-2 space-y-1.5">
                      <label
                        htmlFor="profile-full-name"
                        className="font-semibold text-slate-800 block"
                      >
                        Họ và tên
                      </label>
                      <Input
                        id="profile-full-name"
                        type="text"
                        readOnly
                        value={savedIdentity.fullName}
                        className="text-xs h-9 font-semibold bg-slate-100"
                      />
                      <p className="text-[11px] text-slate-400">
                        Do Core quản lý. Muốn đổi họ tên hãy liên hệ quản trị
                        viên để sửa tại Core.
                      </p>
                    </div>
                    {PROFILE_CORRECTION_GROUPS.filter((g) => g.key === 'personal').map(
                      (group) => (
                        <div
                          key={group.key}
                          className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3"
                        >
                          <div className="sm:col-span-2 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                              Ngày sinh
                            </span>
                            <Button
                              type="button"
                              permission="hrm.self.request"
                              size="sm"
                              variant="outline"
                              title={group.title}
                              className="h-7 text-xs"
                              onClick={() => setCorrectionFields(group.fields)}
                            >
                              Đề nghị đính chính
                            </Button>
                          </div>
                          <div className="space-y-1.5">
                            <label
                              htmlFor="profile-date-of-birth"
                              className="font-semibold text-slate-800 block"
                            >
                              Ngày sinh
                            </label>
                            <Input
                              id="profile-date-of-birth"
                              type="text"
                              readOnly
                              value={
                                savedIdentity.dateOfBirth
                                  ? formatProfileValue('dateOfBirth', savedIdentity.dateOfBirth)
                                  : ''
                              }
                              className="text-xs h-9 bg-slate-100"
                            />
                          </div>
                        </div>
                      ),
                    )}

                    <div className="sm:col-span-2 space-y-1.5">
                      <label className="font-semibold text-slate-800 block">
                        Giới tính
                      </label>
                      <SearchableSelect
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

                    {PROFILE_CORRECTION_GROUPS.filter((g) => g.key === 'identity').map(
                      (group) => (
                        <div
                          key={group.key}
                          className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3"
                        >
                          <div className="sm:col-span-2 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                              Giấy tờ định danh (CCCD)
                            </span>
                            <Button
                              type="button"
                              permission="hrm.self.request"
                              size="sm"
                              variant="outline"
                              title={group.title}
                              className="h-7 text-xs"
                              onClick={() => setCorrectionFields(group.fields)}
                            >
                              Đề nghị đính chính
                            </Button>
                          </div>
                          <div className="space-y-1.5">
                            <label
                              htmlFor="profile-id-number"
                              className="font-semibold text-slate-800 block"
                            >
                              Số CCCD / CMND
                            </label>
                            <Input
                              id="profile-id-number"
                              type="text"
                              readOnly
                              value={savedIdentity.identityCardNumber}
                              className="text-xs h-9 font-mono bg-slate-100"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label
                              htmlFor="profile-id-issued-date"
                              className="font-semibold text-slate-800 block"
                            >
                              Ngày cấp
                            </label>
                            <Input
                              id="profile-id-issued-date"
                              type="text"
                              readOnly
                              value={
                                savedIdentity.identityCardIssuedDate
                                  ? formatProfileValue(
                                      'identityCardIssuedDate',
                                      savedIdentity.identityCardIssuedDate,
                                    )
                                  : ''
                              }
                              className="text-xs h-9 bg-slate-100"
                            />
                          </div>
                          <div className="sm:col-span-2 space-y-1.5">
                            <label
                              htmlFor="profile-id-issued-place"
                              className="font-semibold text-slate-800 block"
                            >
                              Nơi cấp
                            </label>
                            <Input
                              id="profile-id-issued-place"
                              type="text"
                              readOnly
                              value={savedIdentity.identityCardIssuedPlace}
                              className="text-xs h-9 bg-slate-100"
                            />
                          </div>
                        </div>
                      ),
                    )}

                    <div className="space-y-1.5">
                      <label className="font-semibold text-slate-800 block">
                        Quốc tịch
                      </label>
                      <Input
                        type="text"
                        value={nationality}
                        placeholder="Việt Nam"
                        onChange={(e) => setNationality(e.target.value)}
                        className="text-xs h-9"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="font-semibold text-slate-800 block">
                        Dân tộc
                      </label>
                      <Input
                        type="text"
                        value={ethnicity}
                        placeholder="Kinh"
                        onChange={(e) => setEthnicity(e.target.value)}
                        className="text-xs h-9"
                      />
                    </div>

                    <div className="sm:col-span-2 space-y-1.5">
                      <label className="font-semibold text-slate-800 block">
                        Tình trạng hôn nhân
                      </label>
                      <SearchableSelect
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
                </div>

                {/* Footer Controls for Identity Block */}
                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {isIdentityDirty ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-600 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Có thay đổi chưa lưu
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                        <Check className="size-3 text-emerald-500" />
                        Đã đồng bộ
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!isIdentityDirty || savingIdentity}
                      onClick={handleResetIdentityBlock}
                      className="h-8 text-xs font-medium border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40"
                    >
                      <RotateCcw className="size-3.5 mr-1" />
                      Hoàn tác
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!isIdentityDirty || savingIdentity}
                      onClick={() => void handleSaveIdentityBlock()}
                      className="h-8 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-40"
                    >
                      {savingIdentity ? (
                        <Loader2 className="size-3.5 mr-1 animate-spin" />
                      ) : (
                        <Save className="size-3.5 mr-1" />
                      )}
                      {savingIdentity ? 'Đang lưu...' : 'Lưu định danh'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Blocks (7 cols): Contact Info & Emergency Contact */}
            <div className="lg:col-span-7 space-y-6">
              {/* Contact Block */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-4 bg-blue-600 rounded-full" />
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      Khối Thông tin liên lạc
                    </h3>
                  </div>
                  <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] gap-1 font-semibold">
                    <PencilLine className="size-3" />
                    Được phép cập nhật
                  </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-800 flex items-center justify-between">
                      <span>Email cá nhân</span>
                      <span className="text-slate-400 font-normal">
                        (personal_email)
                      </span>
                    </label>
                    <div className="relative">
                      <Mail className="size-4 absolute left-3 top-2.5 text-slate-400" />
                      <Input
                        type="email"
                        value={personalEmail}
                        placeholder="Chưa cập nhật email cá nhân"
                        onChange={(e) => setPersonalEmail(e.target.value)}
                        className="pl-9 text-xs h-9"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-800 flex items-center justify-between">
                      <span>Số điện thoại di động</span>
                      <span className="text-slate-400 font-normal">
                        (phone)
                      </span>
                    </label>
                    <div className="relative">
                      <Phone className="size-4 absolute left-3 top-2.5 text-slate-400" />
                      <Input
                        type="tel"
                        value={phone}
                        placeholder="Chưa cập nhật số điện thoại"
                        onChange={(e) => setPhone(e.target.value)}
                        className="pl-9 text-xs h-9"
                      />
                    </div>
                  </div>

                  <div className="md:col-span-2 space-y-1.5">
                    <label className="font-semibold text-slate-800">
                      Địa chỉ thường trú
                    </label>
                    <Input
                      type="text"
                      value={permanentAddress}
                      placeholder="Chưa cập nhật địa chỉ thường trú"
                      onChange={(e) => setPermanentAddress(e.target.value)}
                      className="text-xs h-9"
                    />
                  </div>

                  <div className="md:col-span-2 space-y-1.5">
                    <label className="font-semibold text-slate-800">
                      Địa chỉ tạm trú / Nơi ở hiện tại
                    </label>
                    <Input
                      type="text"
                      value={currentAddress}
                      placeholder="Chưa cập nhật địa chỉ nơi ở hiện tại"
                      onChange={(e) => setCurrentAddress(e.target.value)}
                      className="text-xs h-9"
                    />
                  </div>
                </div>

                {/* Footer Controls for Contact Info Block */}
                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {isContactDirty ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-600 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Có thay đổi chưa lưu
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                        <Check className="size-3 text-emerald-500" />
                        Đã đồng bộ
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!isContactDirty || savingContact}
                      onClick={handleResetContactBlock}
                      className="h-8 text-xs font-medium border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40"
                    >
                      <RotateCcw className="size-3.5 mr-1" />
                      Hoàn tác
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!isContactDirty || savingContact}
                      onClick={handleSaveContactBlock}
                      className="h-8 text-xs font-semibold bg-[#2563eb] hover:bg-blue-700 text-white shadow-sm disabled:opacity-40"
                    >
                      {savingContact ? (
                        <>
                          <Loader2 className="size-3.5 mr-1 animate-spin" />
                          Đang lưu...
                        </>
                      ) : (
                        <>
                          <Save className="size-3.5 mr-1" />
                          Lưu thông tin liên lạc
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Emergency Contact Block */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-4 bg-amber-500 rounded-full" />
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      Khối Liên hệ khẩn cấp
                    </h3>
                  </div>
                  <Badge className="bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
                    Bắt buộc điền
                  </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-800">
                      Tên người liên hệ khẩn cấp *
                    </label>
                    <Input
                      type="text"
                      value={emergencyContactName}
                      placeholder="Chưa có thông tin người liên hệ"
                      onChange={(e) => setEmergencyContactName(e.target.value)}
                      className="text-xs h-9"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-800">
                      Mối quan hệ *
                    </label>
                    <Input
                      type="text"
                      value={emergencyContactRelationship}
                      placeholder="Ví dụ: Vợ / Chồng, Bố / Mẹ, Anh / Chị..."
                      onChange={(e) =>
                        setEmergencyContactRelationship(e.target.value)
                      }
                      className="text-xs h-9"
                    />
                  </div>

                  <div className="md:col-span-2 space-y-1.5">
                    <label className="font-semibold text-slate-800">
                      Số điện thoại khẩn cấp *
                    </label>
                    <Input
                      type="tel"
                      value={emergencyContactPhone}
                      placeholder="Chưa có SĐT khẩn cấp"
                      onChange={(e) => setEmergencyContactPhone(e.target.value)}
                      className="text-xs h-9 font-medium"
                    />
                  </div>
                </div>

                {/* Footer Controls for Emergency Contact Block */}
                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {isEmergencyDirty ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-600 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Có thay đổi chưa lưu
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                        <Check className="size-3 text-emerald-500" />
                        Đã đồng bộ
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!isEmergencyDirty || savingEmergency}
                      onClick={handleResetEmergencyBlock}
                      className="h-8 text-xs font-medium border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40"
                    >
                      <RotateCcw className="size-3.5 mr-1" />
                      Hoàn tác
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!isEmergencyDirty || savingEmergency}
                      onClick={handleSaveEmergencyBlock}
                      className="h-8 text-xs font-semibold bg-[#2563eb] hover:bg-blue-700 text-white shadow-sm disabled:opacity-40"
                    >
                      {savingEmergency ? (
                        <>
                          <Loader2 className="size-3.5 mr-1 animate-spin" />
                          Đang lưu...
                        </>
                      ) : (
                        <>
                          <Save className="size-3.5 mr-1" />
                          Lưu liên hệ khẩn cấp
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {employeeId && (
            <HrmProfileDocumentsPanel
              employeeId={employeeId}
              mode="self"
              identityCardNumber={profileMeta.identityCardNumber}
            />
          )}
        </div>
      )}

      {/* Sub-tab 2: Work History (Quá trình công tác) */}
      {activeTab === 'work_history' && (
        <div className="space-y-6">
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

          {/* Org & Position block - Master-Detail Spec Sheet Layout */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-3">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-[#021E73]">
                  <Building2 className="size-5 text-[#021E73]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      Cơ cấu tổ chức & Vị trí công tác
                    </h3>
                    <Badge className="bg-blue-100 text-blue-800 text-[10px] font-bold border border-blue-200">
                      {profileMeta.employmentStatus || 'Bổ nhiệm chính thức'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Bảng đặc tả định danh cơ cấu tổ chức, sơ đồ quản lý và thẩm
                    quyền chức danh
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
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
                <Badge variant="outline" className="text-[10px] text-slate-500 gap-1 h-8 px-2.5">
                  <Lock className="size-3" />
                  Chỉ đọc (Read-only)
                </Badge>
              </div>
            </div>

            {/* Sơ đồ cây phân cấp tổ chức (Hierarchy Path) */}
            <div className="p-3 bg-slate-50/70 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
                  <Network className="size-3.5 text-slate-400" />
                  Phân cấp quản lý:
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-800 font-medium text-[11px] shadow-2xs">
                  <Building2 className="size-3.5 text-slate-400" />
                  {companyName || '----'}
                </span>
                {profileMeta.division && (
                  <>
                    <ChevronRight className="size-3.5 text-slate-400" />
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-700 font-medium text-[11px] shadow-2xs">
                      {profileMeta.division}
                    </span>
                  </>
                )}
                <ChevronRight className="size-3.5 text-slate-400" />
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-[#021E73] font-semibold text-[11px] shadow-2xs">
                  <Building2 className="size-3.5 text-[#021E73]" />
                  {profileMeta.department || '----'}
                </span>
                <ChevronRight className="size-3.5 text-slate-400" />
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-800 font-bold text-[11px]">
                  <Award className="size-3.5 text-blue-800" />
                  {profileMeta.position || '----'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-600 font-medium">
                <ShieldCheck className="size-3.5 text-emerald-600" />
                <span>
                  Cấp bậc ngạch:{' '}
                  <strong className="text-slate-900">
                    {profileMeta.salaryGrade || '----'}
                  </strong>
                </span>
              </div>
            </div>

            {/* Bảng đặc tả 2 cột Master-Detail */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-1">
              {/* Cột 1: Thông tin Đơn vị & Pháp nhân */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                    <Building2 className="size-3.5 text-[#021E73]" />
                    Cơ cấu Đơn vị & Pháp nhân
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    ORGANIZATION_UNIT
                  </span>
                </div>
                <div className="divide-y divide-slate-100 text-xs">
                  <div className="grid grid-cols-12 px-4 py-3 hover:bg-slate-50/50 transition-colors items-center">
                    <span className="col-span-4 text-slate-500 font-medium">
                      Công ty / Pháp nhân
                    </span>
                    <div className="col-span-8 space-y-0.5">
                      <div className="font-bold text-slate-900 text-sm">
                        {companyName || '----'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Doanh nghiệp{' '}
                        <span className="font-mono text-[10px] text-slate-400">
                          (core_tenants)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 px-4 py-3 hover:bg-slate-50/50 transition-colors items-center">
                    <span className="col-span-4 text-slate-500 font-medium">
                      Khối đơn vị
                    </span>
                    <div className="col-span-8">
                      <span className="font-semibold text-slate-900">
                        {profileMeta.division || 'Khối Công nghệ & Vận hành'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 px-4 py-3 hover:bg-slate-50/50 transition-colors items-center">
                    <span className="col-span-4 text-slate-500 font-medium">
                      Phòng ban công tác
                    </span>
                    <div className="col-span-8 flex items-center justify-between">
                      <span className="font-bold text-slate-900">
                        {profileMeta.department || '----'}
                      </span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded border border-slate-200">
                        {profileMeta.department ? 'DEP-ASSIGNED' : '----'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 px-4 py-3 hover:bg-slate-50/50 transition-colors items-center">
                    <span className="col-span-4 text-slate-500 font-medium">
                      Bộ phận / Đội nhóm
                    </span>
                    <div className="col-span-8">
                      <span className="font-medium text-slate-900">
                        {profileMeta.team || 'Trực thuộc Phòng ban'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 px-4 py-3 hover:bg-slate-50/50 transition-colors items-center">
                    <span className="col-span-4 text-slate-500 font-medium">
                      Địa điểm làm việc
                    </span>
                    <div className="col-span-8 flex items-center justify-between">
                      <span className="text-slate-800 flex items-center gap-1">
                        <MapPin className="size-3.5 text-slate-400" />
                        {profileMeta.location || 'Văn phòng Trụ sở chính'}
                      </span>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        On-site
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Cột 2: Thông tin Chức danh & Tuyến quản lý */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                    <Award className="size-3.5 text-[#021E73]" />
                    Chức danh & Thẩm quyền quản lý
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    POSITION_HIERARCHY
                  </span>
                </div>
                <div className="divide-y divide-slate-100 text-xs">
                  <div className="grid grid-cols-12 px-4 py-3 hover:bg-slate-50/50 transition-colors items-center">
                    <span className="col-span-4 text-slate-500 font-medium">
                      Chức danh công việc
                    </span>
                    <div className="col-span-8 flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="font-bold text-slate-900 text-sm">
                          {profileMeta.position || '----'}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {profileMeta.position ? 'Chức danh chính' : '----'}
                        </div>
                      </div>
                      <Badge className="bg-[#021E73] text-white text-[10px] font-bold">
                        {profileMeta.position ? 'ACTIVE' : '----'}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 px-4 py-3 hover:bg-slate-50/50 transition-colors items-center">
                    <span className="col-span-4 text-slate-500 font-medium">
                      Mã vị trí & Cấp bậc
                    </span>
                    <div className="col-span-8 flex items-center gap-2">
                      <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                        {profileMeta.positionCode || 'POS-DEFAULT'}
                      </span>
                      <span className="text-[11px] text-slate-600">
                        {profileMeta.salaryGrade || 'Chuyên viên'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 px-4 py-3 hover:bg-slate-50/50 transition-colors items-center">
                    <span className="col-span-4 text-slate-500 font-medium">
                      Quyết định bổ nhiệm
                    </span>
                    <div className="col-span-8 flex items-center gap-2">
                      <span className="font-semibold text-slate-800">
                        {profileMeta.employeeCode
                          ? `QĐ-TNS-${profileMeta.employeeCode}`
                          : '----'}
                      </span>
                      <span className="text-slate-300">•</span>
                      <span className="text-[11px] text-slate-500">
                        Hiệu lực:{' '}
                        <strong className="text-slate-800">
                          {formatVnDate(
                            profileMeta.officialDate || profileMeta.joinDate,
                          )}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 px-4 py-3 hover:bg-slate-50/50 transition-colors items-center">
                    <span className="col-span-4 text-slate-500 font-medium">
                      Quản lý trực tiếp
                    </span>
                    <div className="col-span-8 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="size-7 rounded-full bg-slate-200 text-slate-600 text-[11px] font-bold flex items-center justify-center">
                          {profileMeta.directManagerName
                            ? profileMeta.directManagerName
                                .trim()
                                .split(/\s+/)
                                .filter(Boolean)
                                .slice(-2)
                                .map((n) => n[0])
                                .join('')
                                .toUpperCase()
                            : '--'}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 flex items-center gap-1">
                            <span>
                              {profileMeta.directManagerName ||
                                'Chưa phân công quản lý'}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {profileMeta.directManagerTitle || 'Trưởng bộ phận'}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        {profileMeta.directManagerName
                          ? 'HEAD-ASSIGNED'
                          : 'UNASSIGNED'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 px-4 py-3 hover:bg-slate-50/50 transition-colors items-center">
                    <span className="col-span-4 text-slate-500 font-medium">
                      Phạm vi trách nhiệm
                    </span>
                    <div className="col-span-8">
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        {profileMeta.note || '----'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline of promotions / employment events */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <span className="w-1.5 h-4 bg-[#021E73] rounded-full" />
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                  Lịch sử Bổ nhiệm & Công tác (Timeline)
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
                    : careerHistory.length > 0
                      ? `${careerHistory.length} vị trí / quyết định`
                      : profileMeta.joinDate || profileMeta.officialDate
                        ? 'Dữ liệu sơ bộ hồ sơ'
                        : 'Chưa có sự kiện'}
                </Badge>
              </div>
            </div>

            {loadingCareer ? (
              <div className="py-10 flex flex-col items-center justify-center gap-2 text-slate-500 text-xs">
                <Loader2 className="size-5 animate-spin text-[#021E73]" />
                <span>Đang đồng bộ quá trình công tác từ sơ đồ tổ chức...</span>
              </div>
            ) : careerHistory.length > 0 ? (
              <div className="relative pl-6 sm:pl-8 border-l-2 border-blue-200 space-y-6 ml-2 sm:ml-4">
                {careerHistory.map((item) => {
                  const isActive = item.status === 'active' && !item.endDate;
                  return (
                    <div key={item.assignmentId} className="relative group">
                      {/* Timeline Dot Indicator */}
                      <span
                        className={`absolute -left-[31px] sm:-left-[39px] top-1 size-4 rounded-full border-2 border-white ring-2 ${
                          isActive
                            ? 'bg-[#021E73] ring-blue-300'
                            : 'bg-slate-400 ring-slate-200'
                        }`}
                      />
                      <div className="bg-slate-50 hover:bg-slate-50/80 transition-colors p-4 rounded-xl border border-slate-200">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                              <Briefcase className="size-3.5 text-[#021E73]" />
                              {item.positionName}
                            </h4>
                            <Badge
                              className={`text-[10px] font-bold ${
                                isActive
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                  : 'bg-slate-200 text-slate-700'
                              }`}
                            >
                              {isActive ? 'Đang đương nhiệm' : 'Đã kết thúc'}
                            </Badge>
                            {item.isPrimary ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] font-semibold text-blue-800 border-blue-300 bg-blue-50"
                              >
                                Chính thức
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-[10px] font-normal text-slate-600 border-slate-300"
                              >
                                Kiêm nhiệm
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-xs font-semibold text-blue-700 font-mono">
                            <Calendar className="size-3 text-slate-400" />
                            <span>
                              {formatVnDate(item.startDate)} -{' '}
                              {item.endDate ? formatVnDate(item.endDate) : 'Hiện tại'}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600 font-medium">
                          <span className="flex items-center gap-1">
                            <Building2 className="size-3 text-slate-400" />
                            Đơn vị: <strong>{item.unitName}</strong>
                          </span>
                          {item.positionCode && (
                            <>
                              <span>•</span>
                              <span>
                                Mã vị trí:{' '}
                                <code className="font-mono text-slate-700 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                                  {item.positionCode}
                                </code>
                              </span>
                            </>
                          )}
                        </div>

                        {item.note && (
                          <div className="mt-2.5 p-2 bg-white rounded-lg border border-slate-200/80 text-[11px] text-slate-600 leading-relaxed">
                            {item.note}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
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
                        <span className="text-xs font-semibold text-blue-700 font-mono">
                          {formatVnDate(profileMeta.officialDate)} - Nay
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mb-2">
                        Được tiếp nhận và bổ nhiệm vị trí chính thức tại tổ chức.
                        Trạng thái lao động:{' '}
                        <strong>
                          {profileMeta.employmentStatus || 'OFFICIAL'}
                        </strong>
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
                        <span className="text-xs font-semibold text-slate-500 font-mono">
                          {formatVnDate(profileMeta.joinDate)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mb-2">
                        Ngày bắt đầu làm việc tại {companyName || 'công ty'} theo quyết
                        định tiếp nhận nhân sự.
                      </p>
                      <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500 font-medium">
                        <span>
                          Mã nhân viên: {profileMeta.employeeCode || '----'}
                        </span>
                        <span>•</span>
                        <span>Ngày gia nhập: {formatVnDate(profileMeta.joinDate)}</span>
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

          {employeeId&&<HrmContractPanel employeeId={employeeId} rows={contracts} onChanged={setContracts} readOnly/>}
        </div>
      )}

      {/* Sub-tab 3: Bank & Tax (Ngân hàng & Thuế) */}
      {activeTab === 'bank_tax' && (
        <div className="space-y-6">
          {/* Security Notice Banner */}
          <div className="bg-gradient-to-r from-blue-50/90 via-slate-50 to-blue-50/50 border border-blue-200/80 rounded-xl p-4 text-xs text-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div className="flex items-start sm:items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100/80 text-[#021E73] shrink-0">
                <ShieldCheck className="size-4" />
              </div>
              <div className="space-y-0.5">
                <span className="font-bold text-slate-900 block sm:inline">
                  Quy chuẩn bảo mật tài khoản chi lương:
                </span>{' '}
                <span className="text-slate-600">
                  Thông tin tài khoản thụ hưởng và MST/BHXH được mã hóa và đồng
                  bộ trực tiếp với hệ thống hạch toán chi lương định kỳ.
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              <Badge
                variant="outline"
                className="bg-white text-slate-700 border-slate-300 text-[11px] font-medium"
              >
                Cấp bảo mật L2
              </Badge>
              <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold gap-1">
                <CheckCircle2 className="size-3" />
                {profileMeta.bankAccountNumber
                  ? 'Đã liên kết tài khoản'
                  : 'Chưa có thông tin'}
              </Badge>
            </div>
          </div>

          {/* Main Payment & Tax Spec Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Bank Account Spec Card (7 Cols) */}
            <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
              {/* Header */}
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-1.5 h-4 bg-[#021E73] rounded-full" />
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    Tài khoản thụ hưởng nhận lương (Payroll Account)
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="text-[10px] text-slate-600 border-slate-300 gap-1 bg-white"
                  >
                    <Lock className="size-3 text-slate-400" />
                    Chỉ đọc
                  </Badge>
                </div>
              </div>

              {/* Bank Card Visual Summary Block */}
              <div className="p-5 border-b border-slate-200 bg-gradient-to-br from-slate-900 via-[#021E73] to-[#0A3299] text-white relative overflow-hidden">
                <div className="absolute -right-8 -bottom-8 w-44 h-44 rounded-full bg-white/5 pointer-events-none blur-xl" />
                <div className="relative z-10 flex flex-col justify-between h-40">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-lg bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center font-bold text-sm tracking-wider text-emerald-400">
                        {profileMeta.bankName
                          ? profileMeta.bankName.slice(0, 3).toUpperCase()
                          : '----'}
                      </div>
                      <div>
                        <div className="font-bold text-sm text-white tracking-wide">
                          {profileMeta.bankName || '----'}
                        </div>
                        <div className="text-[11px] text-blue-200/90 font-medium">
                          {profileMeta.bankBranch
                            ? `Chi nhánh: ${profileMeta.bankBranch}`
                            : '----'}
                        </div>
                      </div>
                    </div>
                    <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-semibold">
                      {profileMeta.bankAccountNumber
                        ? 'Tài khoản chính'
                        : 'Chưa thiết lập'}
                    </Badge>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] text-blue-200 uppercase tracking-wider font-semibold">
                      Số tài khoản thụ hưởng
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-mono text-xl font-bold tracking-widest text-white">
                        {profileMeta.bankAccountNumber
                          ? isAccountMasked
                            ? profileMeta.bankAccountNumber.length > 4
                              ? '**** **** ' +
                                profileMeta.bankAccountNumber.slice(-4)
                              : '****'
                            : profileMeta.bankAccountNumber
                          : '----'}
                      </div>
                      {profileMeta.bankAccountNumber && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setIsAccountMasked(!isAccountMasked)}
                            className="p-1.5 rounded hover:bg-white/15 text-blue-200 hover:text-white transition-colors"
                            title={
                              isAccountMasked
                                ? 'Hiện số tài khoản đầy đủ'
                                : 'Ẩn số tài khoản'
                            }
                          >
                            {isAccountMasked ? (
                              <Eye className="size-4" />
                            ) : (
                              <EyeOff className="size-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(
                                profileMeta.bankAccountNumber,
                              );
                              toast.add({
                                title: 'Sao chép STK thành công',
                                description: `Đã lưu số tài khoản ${profileMeta.bankAccountNumber} vào khay nhớ tạm.`,
                                type: 'success',
                              });
                            }}
                            className="p-1.5 rounded hover:bg-white/15 text-blue-200 hover:text-white transition-colors"
                            title="Sao chép số tài khoản"
                          >
                            <Copy className="size-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-white/10 text-xs">
                    <div>
                      <span className="text-[10px] text-blue-200/80 uppercase block">
                        Chủ tài khoản
                      </span>
                      <span className="font-mono font-bold tracking-wide text-white text-xs">
                        {profileMeta.fullName
                          ? profileMeta.fullName.toUpperCase()
                          : '----'}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-blue-200/80 uppercase block">
                        Trạng thái
                      </span>
                      <span className="text-emerald-300 font-semibold text-xs flex items-center gap-1 justify-end">
                        <span
                          className={`size-1.5 rounded-full inline-block ${profileMeta.bankAccountNumber ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`}
                        />
                        {profileMeta.bankAccountNumber
                          ? 'Đang nhận chi trả'
                          : '----'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bank Metadata Table / Spec Rows */}
              <div className="p-5 divide-y divide-slate-100 text-xs">
                <div className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <span className="text-slate-500 font-medium">
                    Tên ngân hàng
                  </span>
                  <span className="font-semibold text-slate-900 text-right">
                    {profileMeta.bankName || '----'}
                  </span>
                </div>
                <div className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <span className="text-slate-500 font-medium">
                    Chi nhánh mở tài khoản
                  </span>
                  <span className="font-semibold text-slate-900 text-right">
                    {profileMeta.bankBranch || '----'}
                  </span>
                </div>
                <div className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <span className="text-slate-500 font-medium">
                    Phòng giao dịch liên kết
                  </span>
                  <span className="font-medium text-slate-800 text-right">
                    ----
                  </span>
                </div>
                <div className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <span className="text-slate-500 font-medium">
                    Hình thức chi trả tiền lương
                  </span>
                  <div className="text-right">
                    <span className="font-semibold text-slate-900 block">
                      {profileMeta.bankAccountNumber
                        ? 'Chuyển khoản trực tiếp'
                        : '----'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Footer */}
              <div className="mt-auto px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">
                  Tài khoản nhận lương do phòng Nhân sự quản lý. Cần thay đổi vui
                  lòng liên hệ phòng Nhân sự.
                </span>
              </div>
            </div>

            {/* Dependents Spec Block (Full width under left column) */}
            <div className="lg:col-span-12"><HrmFamilyPanel rows={dependents} onChanged={setDependents}/></div>

            {/* Right Column: Tax & Social Insurance Spec (5 Cols) */}
            <div className="lg:col-span-5 space-y-6">
              {/* Personal Income Tax Block */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-1.5 h-4 bg-emerald-600 rounded-full" />
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      Mã số thuế & Giảm trừ gia cảnh
                    </h3>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${profileMeta.taxCode ? 'text-emerald-700 border-emerald-300 bg-emerald-50' : 'text-slate-500 border-slate-200 bg-slate-50'}`}
                  >
                    {profileMeta.taxCode ? 'Hợp lệ' : 'Chưa có'}
                  </Badge>
                </div>

                <div className="p-5 space-y-4 text-xs">
                  <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 flex items-center justify-between">
                    <div>
                      <span className="text-slate-500 block text-[11px]">
                        Mã số thuế cá nhân (MST)
                      </span>
                      <div className="font-mono font-extrabold text-slate-900 text-base mt-0.5 tracking-wide">
                        {profileMeta.taxCode || '----'}
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {profileMeta.taxCode ? 'Cơ quan thuế quản lý' : '----'}
                      </span>
                    </div>
                    {profileMeta.taxCode && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900"
                        title="Sao chép MST"
                        onClick={() => {
                          navigator.clipboard.writeText(profileMeta.taxCode);
                          toast.add({
                            title: 'Sao chép MST thành công',
                            description: `Đã sao chép mã số thuế ${profileMeta.taxCode} vào bộ nhớ tạm.`,
                            type: 'success',
                          });
                        }}
                      >
                        <Copy className="size-4" />
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2 divide-y divide-slate-100">
                    <div className="pt-2 flex items-center justify-between">
                      <span className="text-slate-500">
                        Số người phụ thuộc đăng ký
                      </span>
                      <span className="font-semibold text-slate-900 text-xs">
                        ----
                      </span>
                    </div>
                    <div className="pt-2 flex items-center justify-between">
                      <span className="text-slate-500">
                        Mức giảm trừ gia cảnh NPT
                      </span>
                      <span className="font-semibold text-slate-900 text-xs">
                        ----
                      </span>
                    </div>
                    <div className="pt-2 flex items-center justify-between">
                      <span className="text-slate-500">
                        Mức giảm trừ bản thân
                      </span>
                      <span className="font-semibold text-slate-900 text-xs">
                        ----
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Social Insurance (BHXH) Block */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-1.5 h-4 bg-sky-600 rounded-full" />
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      Bảo hiểm xã hội & Y tế (BHXH - BHYT)
                    </h3>
                  </div>
                  <Badge
                    className={`text-[10px] font-semibold ${profileMeta.socialInsuranceNumber ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-slate-50 text-slate-500 border border-slate-200'}`}
                  >
                    {profileMeta.socialInsuranceNumber
                      ? 'Đang đóng'
                      : 'Chưa có'}
                  </Badge>
                </div>

                <div className="p-5 space-y-4 text-xs">
                  <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 flex items-center justify-between">
                    <div>
                      <span className="text-slate-500 block text-[11px]">
                        Mã số BHXH
                      </span>
                      <div className="font-mono font-extrabold text-slate-900 text-base mt-0.5 tracking-wide">
                        {profileMeta.socialInsuranceNumber || '----'}
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {profileMeta.socialInsuranceNumber
                          ? 'Cơ quan BHXH quản lý'
                          : '----'}
                      </span>
                    </div>
                    {profileMeta.socialInsuranceNumber && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900"
                        title="Sao chép số BHXH"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            profileMeta.socialInsuranceNumber,
                          );
                          toast.add({
                            title: 'Sao chép mã BHXH thành công',
                            description: `Đã sao chép mã số BHXH ${profileMeta.socialInsuranceNumber} vào bộ nhớ tạm.`,
                            type: 'success',
                          });
                        }}
                      >
                        <Copy className="size-4" />
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2 divide-y divide-slate-100">
                    <div className="pt-2 flex items-center justify-between">
                      <span className="text-slate-500">Mã nơi KCB ban đầu</span>
                      <span className="font-semibold text-slate-800">----</span>
                    </div>
                    <div className="pt-2 flex items-center justify-between">
                      <span className="text-slate-500">
                        Tỷ lệ đóng BHXH người LĐ
                      </span>
                      <span className="font-semibold text-slate-900 text-xs">
                        ----
                      </span>
                    </div>
                    <div className="pt-2 flex items-center justify-between">
                      <span className="text-slate-500">
                        Tỷ lệ đóng của Doanh nghiệp
                      </span>
                      <span className="font-semibold text-slate-900 text-xs">
                        ----
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* Dialog: Thêm người phụ thuộc */}


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

      <ProfileCorrectionDialog
        open={correctionFields !== null}
        onOpenChange={(open) => {
          if (!open) setCorrectionFields(null);
        }}
        fields={correctionFields ?? []}
        employeeId={employeeId}
        current={{
          dateOfBirth: savedIdentity.dateOfBirth,
          identityCardNumber: savedIdentity.identityCardNumber,
          identityCardIssuedDate: savedIdentity.identityCardIssuedDate,
          identityCardIssuedPlace: savedIdentity.identityCardIssuedPlace,
        }}
      />
    </div>
  );
}
