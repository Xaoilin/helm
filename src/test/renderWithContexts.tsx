import type { Context, ReactElement, ReactNode } from 'react';
import { render, renderHook, type RenderOptions } from '@testing-library/react';

/**
 * One context value supplied to a component under test.
 *
 * Build bindings with `provide` so the fake value is type-checked against the
 * real context shape; a drifted fake then fails typecheck instead of passing
 * silently the way an untyped `vi.mock` of a hook module can.
 */
export interface ContextBinding {
  context: Context<unknown>;
  value: unknown;
}

export function provide<T>(context: Context<T | null>, value: T): ContextBinding;
export function provide<T>(context: Context<T>, value: T): ContextBinding;
export function provide<T>(context: Context<T>, value: T): ContextBinding {
  return { context: context as Context<unknown>, value };
}

export function ContextStack({ bindings, children }: { bindings: readonly ContextBinding[]; children: ReactNode }) {
  return bindings.reduceRight<ReactNode>(
    (inner, { context, value }) => <context.Provider value={value}>{inner}</context.Provider>,
    children,
  );
}

/** Render UI with only the context values it reads, without mounting real providers. */
export function renderWithContexts(
  ui: ReactElement,
  bindings: readonly ContextBinding[],
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, {
    ...options,
    wrapper: ({ children }) => <ContextStack bindings={bindings}>{children}</ContextStack>,
  });
}

/** Run a hook with only the context values it reads, without mounting real providers. */
export function renderHookWithContexts<Result, Props>(
  hook: (props: Props) => Result,
  bindings: readonly ContextBinding[],
) {
  return renderHook(hook, {
    wrapper: ({ children }) => <ContextStack bindings={bindings}>{children}</ContextStack>,
  });
}
