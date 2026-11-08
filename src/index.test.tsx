import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import ErrorBoundary from './ErrorBoundary';

// What the page is rendered with, kept rather than drawn
const rendered = vi.hoisted(() => ({ element: null as ReactElement<{ fallbackMessage?: string; children?: ReactElement }> | null }));
vi.mock('react-dom/client', () => ({ default: { createRoot: () => ({ render: (element: typeof rendered.element) => { rendered.element = element; } }) } }));
const App = vi.hoisted(() => () => null);
vi.mock('./App', () => ({ default: App }));
vi.mock('./reportWebVitals', () => ({ default: () => {} }));

describe('index', () => {
  it('renders the app inside a boundary of its own, so that what throws outside the panes still leaves a page', async () => {
    vi.stubGlobal('document', { getElementById: () => ({}) });
    await import('./index');
    vi.unstubAllGlobals();
    expect(rendered.element?.type).toBe(ErrorBoundary);
    expect(rendered.element?.props.fallbackMessage).toBe('The app crashed. Click Retry to start it again.');
    expect(rendered.element?.props.children?.type).toBe(App);
  });
});
