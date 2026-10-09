import type { SoftwareReference } from '../types/domain';

/** Only add confirmed, deliberately published software links to this list. */
export const SOFTWARE_REFERENCES: readonly SoftwareReference[] = [
  {
    id: 'autoclicker',
    name: 'Autoclicker',
    description: 'A native Mac autoclicker with adjustable timing, left or right clicks, repeat limits and a global start/stop shortcut.',
    repositoryUrl: 'https://github.com/Xaoilin/autoclicker',
    downloadUrl: 'https://github.com/Xaoilin/autoclicker/releases/latest/download/Sabah-Autoclicker-macOS.zip',
    launchUrl: 'sabah-autoclicker://open',
    launchInstructions: 'macOS 13+. Install and open the app once, then launch it here. Clicking starts inside the app. The first download is not Apple notarized.',
  },
];

export const SOFTWARE_GITHUB_URL = 'https://github.com/Xaoilin?tab=repositories';
