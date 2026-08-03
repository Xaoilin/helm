import { describe, it, expect, beforeEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import { renderWithProvider } from './surfaceTestHarness';
import SettingsSurface from '../surfaces/SettingsSurface';
import { APP_RELEASE_VERSION } from '../config/release';

describe('SettingsSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should render all settings sections', async () => {
    await act(async () => { renderWithProvider(<SettingsSurface />); });
    expect(screen.getByText('Calendar')).toBeInTheDocument();
    expect(screen.getByText('Privacy')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('should show Sabah One version', async () => {
    await act(async () => { renderWithProvider(<SettingsSurface />); });
    expect(screen.getByText(APP_RELEASE_VERSION)).toBeInTheDocument();
  });

  it('should have default calendar tab selector', async () => {
    await act(async () => { renderWithProvider(<SettingsSurface />); });
    expect(screen.getByText('Default calendar view')).toBeInTheDocument();
  });

  it('should show assistant mode controls', async () => {
    await act(async () => { renderWithProvider(<SettingsSurface />); });
    expect(screen.getByText('Open-ended AI mode')).toBeInTheDocument();
    expect(screen.getByText('Hosted OpenAI model')).toBeInTheDocument();
    expect(screen.getByText('Runtime status')).toBeInTheDocument();
  });

  it('should let you choose a curated hosted OpenAI model', async () => {
    await act(async () => { renderWithProvider(<SettingsSurface />); });

    const hostedModelSelect = screen.getByLabelText('Hosted OpenAI model');
    fireEvent.change(hostedModelSelect, { target: { value: 'gpt-5.4-mini' } });

    expect(screen.getByDisplayValue('GPT-5.4 mini - Best value')).toBeInTheDocument();
    expect(screen.getByText(/Lower-cost hosted model with strong general performance/i)).toBeInTheDocument();
  });

  it('should explain that turning Lina off keeps chat available and silences wake word access', async () => {
    localStorage.setItem('helm:settings', JSON.stringify({
      assistantEnabled: false,
      wakeWordEnabled: true,
    }));

    await act(async () => { renderWithProvider(<SettingsSurface />); });
    expect(screen.getByText(/Turn this off when you want Lina fully quiet/i)).toBeInTheDocument();
    expect(screen.getByText(/Chat in the Chat tab still works/i)).toBeInTheDocument();
    expect(screen.getByText(/Lina is off\. The floating button, keyboard shortcut, and wake word are all disabled/i)).toBeInTheDocument();
    expect(screen.getByText(/Wake-word listening is currently inactive because Lina is turned off/i)).toBeInTheDocument();
  });

});
