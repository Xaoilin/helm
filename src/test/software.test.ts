import { describe, expect, it } from 'vitest';
import contract from '../../contracts/autoclicker-launch.json';
import { SOFTWARE_REFERENCES } from '../config/software';

describe('native software launch contract', () => {
  it('links the native Mac tool and asks only to open its stopped window', () => {
    const autoclicker = SOFTWARE_REFERENCES.find(software => software.id === 'autoclicker');
    expect(autoclicker?.repositoryUrl).toBe('https://github.com/Xaoilin/autoclicker');
    expect(autoclicker?.downloadUrl).toBe('https://github.com/Xaoilin/autoclicker/releases/latest/download/Sabah-Autoclicker-macOS.zip');
    expect(autoclicker?.launchUrl).toBe(contract.openUrl);
    expect(contract).toEqual({ version: 1, openUrl: 'sabah-autoclicker://open', behavior: 'show-window-only', acceptsParameters: false });
  });
});
