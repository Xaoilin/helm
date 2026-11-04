import { afterEach, expect, it, vi } from 'vitest';
import { requestGoogleAuthorizationCode } from '../services/googleAuth';

afterEach(() => { delete window.google; });

it('requests only calendar-list reads and event access without inherited grants', async () => {
  type CodeConfig = Parameters<NonNullable<Window['google']>['accounts']['oauth2']['initCodeClient']>[0];
  let config: CodeConfig | undefined;
  window.google = { accounts: { oauth2: { initCodeClient: vi.fn(value => {
    config = value;
    return { requestCode: () => value.callback({ code: 'one-time-code' }) };
  }) } } };

  const result = await requestGoogleAuthorizationCode('public-client-id', { loginHint: 'person@example.test' });

  expect(config?.scope.split(' ')).toEqual([
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ]);
  expect(config?.include_granted_scopes).toBe(false);
  expect(config?.ux_mode).toBe('popup');
  expect(config?.login_hint).toBe('person@example.test');
  expect(result).toEqual({ code: 'one-time-code', scope: config?.scope });
});
