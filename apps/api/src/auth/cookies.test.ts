import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookies';

describe('authentication cookies', () => {
  it('parses exactly one stable session cookie and rejects ambiguous duplicates', () => {
    expect(readSessionCookie('theme=dark; customer_ops_session=abc_123; locale=en')).toBe(
      'abc_123',
    );
    expect(
      readSessionCookie('customer_ops_session=first; customer_ops_session=second'),
    ).toBeUndefined();
    expect(readSessionCookie(undefined)).toBeUndefined();
  });

  it('sets the production cookie with HttpOnly, Lax, root path, exact TTL, and no Domain', () => {
    const setHeader = vi.fn();
    const response = { setHeader } as unknown as Response;
    setSessionCookie(response, 'raw-token', {
      webOrigin: 'https://web.example.test',
      sessionTtlSeconds: 604_800,
      secureCookies: true,
    });
    const value = String(setHeader.mock.calls[0]?.[1]);

    expect(value).toContain('customer_ops_session=raw-token');
    expect(value).toContain('Max-Age=604800');
    expect(value).toContain('Path=/');
    expect(value).toContain('HttpOnly');
    expect(value).toContain('SameSite=Lax');
    expect(value).toContain('Secure');
    expect(value).not.toMatch(/Domain=/iu);
  });

  it('clears the same host-only cookie idempotently', () => {
    const setHeader = vi.fn();
    clearSessionCookie({ setHeader } as unknown as Response, {
      webOrigin: 'http://localhost:3000',
      sessionTtlSeconds: 604_800,
      secureCookies: false,
    });
    const value = String(setHeader.mock.calls[0]?.[1]);

    expect(value).toContain('Max-Age=0');
    expect(value).toContain('Path=/');
    expect(value).toContain('HttpOnly');
    expect(value).not.toContain('Secure');
    expect(value).not.toMatch(/Domain=/iu);
  });
});
