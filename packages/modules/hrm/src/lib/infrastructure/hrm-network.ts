import { BadRequestException } from '@nestjs/common';
import { BlockList, isIP } from 'node:net';

function rule(value: unknown) {
  if (typeof value !== 'string') return null;
  const parts = value.split('/');
  const family = isIP(parts[0]);
  if (!family || parts.length > 2) return null;
  const prefix =
    parts.length === 1 ? (family === 4 ? 32 : 128) : Number(parts[1]);
  if (parts.length === 2 && !/^\d+$/.test(parts[1])) return null;
  if (
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > (family === 4 ? 32 : 128)
  )
    return null;
  return {
    address: parts[0],
    family: family === 4 ? ('ipv4' as const) : ('ipv6' as const),
    prefix,
  };
}
export const validIpRule = (value: unknown) => rule(value) !== null;
export function matchesIpRules(ip: string, rules: unknown[]) {
  const family = isIP(ip);
  if (!family) return false;
  const list = new BlockList();
  for (const value of rules) {
    const parsed = rule(value);
    if (parsed) list.addSubnet(parsed.address, parsed.prefix, parsed.family);
  }
  return list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/** Danh sách IP/CIDR của một địa điểm: bỏ ô trống và trùng, tối đa 50 mục, mỗi mục phải hợp lệ. */
export function parseSiteIps(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BadRequestException('Danh sách IP không hợp lệ');
  const ips = [...new Set(value.map((ip) => (typeof ip === 'string' ? ip.trim() : '')).filter(Boolean))];
  if (ips.length > 50) throw new BadRequestException('Mỗi địa điểm chỉ khai báo tối đa 50 IP');
  const bad = ips.find((ip) => !validIpRule(ip));
  if (bad) throw new BadRequestException(`IP "${bad}" không hợp lệ (dạng 203.0.113.5 hoặc 203.0.113.0/24)`);
  return ips;
}
