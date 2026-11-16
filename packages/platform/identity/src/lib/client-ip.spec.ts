import { normalizeClientIp, trustProxyFromEnv } from './client-ip';

describe('trustProxyFromEnv', () => {
  it('SEC-BE010-10: leaves Express default (do not trust X-Forwarded-For) when TRUST_PROXY is not set', () => {
    expect(trustProxyFromEnv({})).toBeUndefined();
    expect(trustProxyFromEnv({ TRUST_PROXY: '  ' })).toBeUndefined();
  });

  it('parses hop counts, booleans and proxy address lists', () => {
    expect(trustProxyFromEnv({ TRUST_PROXY: '1' })).toBe(1);
    expect(trustProxyFromEnv({ TRUST_PROXY: '2' })).toBe(2);
    expect(trustProxyFromEnv({ TRUST_PROXY: 'false' })).toBe(false);
    expect(trustProxyFromEnv({ TRUST_PROXY: 'TRUE' })).toBe(true);
    expect(trustProxyFromEnv({ TRUST_PROXY: 'loopback, 10.0.0.0/8' })).toBe('loopback, 10.0.0.0/8');
  });
});

describe('normalizeClientIp', () => {
  it('strips the IPv4-mapped prefix and normalises case', () => {
    expect(normalizeClientIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(normalizeClientIp(' 2001:DB8::1 ')).toBe('2001:db8::1');
    expect(normalizeClientIp(undefined)).toBe('unknown');
  });
});
