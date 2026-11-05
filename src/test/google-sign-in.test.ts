import { afterEach, describe, expect, it, vi } from 'vitest';
import { initAccessService } from '../store/supabase/client';
import { signInWithGoogle } from '../store/supabase/auth';

describe('product-owned Google sign-in', () => {
  afterEach(() => { initAccessService(''); vi.unstubAllGlobals(); });
  it('navigates to the configured server sign-in entry and never trusts a caller return address', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    initAccessService('https://api.sabah.example/api/access');
    await signInWithGoogle();
    expect(assign).toHaveBeenCalledWith('https://api.sabah.example/api/access/signin');
  });
});
