import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ signInWithOAuth: vi.fn() }));

vi.mock('../store/supabase/client', () => ({
  getClient: () => ({ auth }),
}));

import { signInWithGoogle } from '../store/supabase/auth';

describe('Google account sign-in', () => {
  beforeEach(() => {
    auth.signInWithOAuth.mockReset();
    auth.signInWithOAuth.mockResolvedValue({ error: null });
  });

  it('requests identity only, without earlier Calendar grants or forced consent', async () => {
    await signInWithGoogle();

    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        scopes: 'openid email profile',
        redirectTo: window.location.origin + import.meta.env.BASE_URL,
        queryParams: { include_granted_scopes: 'false' },
      },
    });
  });

  it('preserves the agent consent return address', async () => {
    const redirectTo = 'https://sabah.example.test/helm/?authorization_id=synthetic';
    await signInWithGoogle(redirectTo);

    expect(auth.signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe(redirectTo);
  });
});
