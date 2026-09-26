import { describe, expect, it } from 'vitest';
import {
  canApplyLocalCalendarMutation,
  isProviderBackedCalendarSource,
} from '../services/calendarProviderSync';
import { makeCalendarAccount, makeCalendarSource } from './fixtures';

describe('calendar account/source/event identity', () => {
  it('proves a source is provider-backed through either its explicit id or its active account', () => {
    const googleAccount = makeCalendarAccount({
      id: 'account-google',
      provider: 'google',
      connected: true,
      mocked: false,
    });
    const localAccount = makeCalendarAccount({ id: 'account-local', provider: 'local' });
    const explicitProviderSource = makeCalendarSource({
      accountId: localAccount.id,
      googleCalendarId: 'google-primary',
    });
    const accountBackedSource = makeCalendarSource({ accountId: googleAccount.id });
    const localSource = makeCalendarSource({ accountId: localAccount.id });

    expect(isProviderBackedCalendarSource(explicitProviderSource, [localAccount])).toBe(true);
    expect(isProviderBackedCalendarSource(accountBackedSource, [googleAccount])).toBe(true);
    expect(isProviderBackedCalendarSource(localSource, [localAccount])).toBe(false);
    expect(canApplyLocalCalendarMutation(accountBackedSource, [googleAccount])).toBe(false);
    expect(canApplyLocalCalendarMutation(localSource, [localAccount])).toBe(true);
  });
});
