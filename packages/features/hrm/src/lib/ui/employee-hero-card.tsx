'use client';

import { Link2, Mail, Phone, UserCheck } from 'lucide-react';
import { Badge } from '../ui/badge';
import { initialsOf } from './profile-cards';

export interface EmployeeProfileHeroData {
  fullName?: string;
  employeeCode?: string;
  employmentStatus?: string;
  department?: string;
  position?: string;
  workEmail?: string;
  phone?: string;
  roleLabel?: string;
  companyName?: string;
  joinDate?: string;
}

interface EmployeeHeroCardProps {
  profile: EmployeeProfileHeroData;
  /** Nhãn bên phải (ví dụ "Đồng bộ từ Core"): hồ sơ này lấy dữ liệu định danh từ hệ thống gốc. */
  syncLabel?: string;
}

/** Thẻ nhận diện nhân viên ở đầu Hồ sơ của tôi: ảnh đại diện, họ tên, trạng thái, mã, chức danh, liên hệ và vai trò. */
export function EmployeeHeroCard({ profile, syncLabel }: EmployeeHeroCardProps) {
  const fullName = profile.fullName || '----';
  const employmentStatus = profile.employmentStatus || 'CHÍNH THỨC (Official)';
  const line = [profile.position || '----', profile.department || '----', profile.companyName || '----'];
  return (
    <div
      data-testid="employee-hero"
      className="flex flex-col items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs md:flex-row md:items-center"
    >
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <div className="relative shrink-0">
          <div className="flex size-[84px] items-center justify-center rounded-full bg-[#091426] text-3xl font-bold text-white">
            {initialsOf(profile.fullName)}
          </div>
          <span
            className="absolute bottom-1 right-1 size-4 rounded-full border-2 border-white bg-emerald-500"
            title="Đang làm việc"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-2xl font-bold text-slate-900">{fullName}</h2>
            <Badge className="border border-emerald-200 bg-emerald-50 text-[14px] font-bold text-emerald-700 hover:bg-emerald-50">
              {employmentStatus}
            </Badge>
            <Badge variant="outline" className="bg-slate-50 font-mono text-[14px] text-slate-700">
              Mã: {profile.employeeCode || '----'}
            </Badge>
          </div>
          <p className="flex flex-wrap items-center gap-x-2 text-[14px] font-medium text-slate-600">
            {line.map((part, index) => (
              <span key={index} className="flex items-center gap-2">
                {index > 0 && <span aria-hidden="true">•</span>}
                <span className={index === 2 ? 'uppercase' : ''}>{part}</span>
              </span>
            ))}
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-0.5 text-[14px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <Mail className="size-3.5 text-slate-400" />
              {profile.workEmail || '----'}
            </span>
            <span className="flex items-center gap-1.5">
              <Phone className="size-3.5 text-slate-400" />
              {profile.phone || 'Chưa cập nhật'}
            </span>
            {profile.roleLabel?.trim() ? (
              <span className="flex items-center gap-1.5">
                <UserCheck className="size-3.5 text-slate-400" />
                <span>
                  Vai trò: <strong className="text-slate-700">{profile.roleLabel.trim()}</strong>
                </span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {syncLabel && (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] font-semibold text-amber-800">
          <Link2 className="size-3.5" aria-hidden="true" />
          {syncLabel}
        </span>
      )}
    </div>
  );
}
