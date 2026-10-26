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

describe('software list', () => {
  it('links NetScope to its Mac download and repository without inventing a native launch protocol', () => {
    const netscope = SOFTWARE_REFERENCES.find(software => software.id === 'netscope');
    expect(netscope?.repositoryUrl).toBe('https://github.com/Xaoilin/mac-network-activity');
    expect(netscope?.downloadUrl).toBe('https://github.com/Xaoilin/mac-network-activity/releases/latest/download/NetScope-macOS-arm64.zip');
    expect(netscope?.launchInstructions).toContain('Install NetScope.command');
    expect(netscope?.launchUrl).toBeUndefined();
  });

  it('links Kitab, a browser app, to its live reader and its repository, with no native launch or download', () => {
    const kitab = SOFTWARE_REFERENCES.find(software => software.id === 'kitab');
    expect(kitab?.websiteUrl).toBe('https://xaoilin.github.io/kitab/');
    expect(kitab?.repositoryUrl).toBe('https://github.com/Xaoilin/kitab');
    expect(kitab?.launchUrl).toBeUndefined();
    expect(kitab?.downloadUrl).toBeUndefined();
  });

  it('gives every entry its own id', () => {
    const ids = SOFTWARE_REFERENCES.map(software => software.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
