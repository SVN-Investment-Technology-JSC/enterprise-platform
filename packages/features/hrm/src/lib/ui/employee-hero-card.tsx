'use client';

import { Mail, Phone, UserCheck } from 'lucide-react';
import { Badge } from '../ui/badge';

export interface EmployeeProfileHeroData {
  fullName?: string;
  employeeCode?: string;
  employmentStatus?: string;
  department?: string;
  position?: string;
  workEmail?: string;
  phone?: string;
  roleLabel?: string;
  joinDate?: string;
}

interface EmployeeHeroCardProps {
  profile: EmployeeProfileHeroData;
}

export function EmployeeHeroCard({ profile }: EmployeeHeroCardProps) {
  const fullName = profile.fullName || '----';
  const employeeCode = profile.employeeCode || '----';
  const employmentStatus = profile.employmentStatus || 'CHÍNH THỨC (Official)';
  const position = profile.position || '----';
  const department = profile.department || '----';
  const workEmail = profile.workEmail || '----';
  const phone = profile.phone || '----';
  const roleLabel = profile.roleLabel || 'Tenant Administrator';

  const initials =
    fullName !== '----'
      ? fullName
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(-2)
          .map((n) => n[0])
          .join('')
          .toUpperCase() || 'NA'
      : 'NA';

  const seniorityDisplay = profile.joinDate
    ? (() => {
        const join = new Date(profile.joinDate);
        const now = new Date();
        if (isNaN(join.getTime())) return '----';
        const totalMonths =
          (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth());
        if (totalMonths <= 0) return 'Dưới 1 tháng';
        const years = Math.floor(totalMonths / 12);
        const months = totalMonths % 12;
        if (years === 0) return `${months} tháng`;
        return months > 0 ? `${years} năm ${months} tháng` : `${years} năm`;
      })()
    : '----';

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 z-10">
        <div className="relative">
          <div className="size-20 rounded-full bg-[#091426] text-white font-bold text-2xl flex items-center justify-center shadow-md border-2 border-white ring-2 ring-slate-100">
            {initials}
          </div>
          <span
            className="absolute bottom-0.5 right-0.5 size-4 bg-emerald-500 border-2 border-white rounded-full"
            title="Đang làm việc"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-xl font-bold text-slate-900">{fullName}</h3>
            <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border border-emerald-200 text-xs font-bold">
              {employmentStatus}
            </Badge>
            <Badge variant="outline" className="text-xs font-mono text-slate-700 bg-slate-50">
              Mã: {employeeCode}
            </Badge>
          </div>
          <p className="text-xs text-slate-600 font-medium flex flex-wrap items-center gap-2">
            <span>{position}</span>
            <span>•</span>
            <span>{department}</span>
            <span>•</span>
            <span>SVN DTS Corporation</span>
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <Mail className="size-3.5 text-slate-400" />
              <span>{workEmail}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Phone className="size-3.5 text-slate-400" />
              <span>{phone}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <UserCheck className="size-3.5 text-slate-400" />
              <span>
                Vai trò: <strong>{roleLabel}</strong>
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex sm:flex-col items-end justify-between self-stretch sm:self-auto pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-100 gap-1 shrink-0 z-10">
        <span className="text-xs text-slate-500">Thâm niên công tác</span>
        <span className="text-xl font-black text-[#091426]">{seniorityDisplay}</span>
        <Badge variant="outline" className="text-[10px] text-emerald-700 bg-emerald-50 border-emerald-200">
          {profile.joinDate ? '+1 ngày phép thâm niên / năm' : '----'}
        </Badge>
      </div>
    </div>
  );
}
