import type { SoftwareReference } from '../types/domain';

/** Only add confirmed, deliberately published software links to this list. */
export const SOFTWARE_REFERENCES: readonly SoftwareReference[] = [
  {
    id: 'camera-zoom',
    name: 'Camera Zoom',
    description: 'A Windows camera app with live preview, camera and software zoom, automatic photo saving and an optional transparent crop overlay.',
    repositoryUrl: 'https://github.com/Xaoilin/camera-zoom',
    launchInstructions: 'Windows. Open the installed Camera Zoom app from your taskbar. The private GitHub repository includes setup instructions for another PC.',
  },
  {
    id: 'autoclicker',
    name: 'Autoclicker',
    description: 'A native Mac autoclicker with adjustable timing, left or right clicks, repeat limits and a global start/stop shortcut.',
    repositoryUrl: 'https://github.com/Xaoilin/autoclicker',
    downloadUrl: 'https://github.com/Xaoilin/autoclicker/releases/latest/download/Sabah-Autoclicker-macOS.zip',
    launchUrl: 'sabah-autoclicker://open',
    launchInstructions: 'macOS 13+. Install and open the app once, then launch it here. Clicking starts inside the app. The first download is not Apple notarized.',
  },
  {
    id: 'kitab',
    name: 'Kitab',
    description: 'A reader for Islamic PDF books on your phone or computer. It reads English and Arabic aloud and switches voice by language, reads scanned pages on the device, and keeps your library on the device. It works offline once opened.',
    repositoryUrl: 'https://github.com/Xaoilin/kitab',
    websiteUrl: 'https://xaoilin.github.io/kitab/',
    launchInstructions: 'Opens in your browser. On iPhone, open it in Safari, then choose Share and Add to Home Screen. The first time you listen it downloads a voice (about 160 to 430 MB).',
  },
  {
    id: 'netscope',
    name: 'NetScope',
    description: 'A native Mac network monitor with live device and per-app upload and download speeds, local graphs and history, named snapshots and CSV export. Its background agent starts at login and keeps recording after the dashboard closes.',
    repositoryUrl: 'https://github.com/Xaoilin/mac-network-activity',
    downloadUrl: 'https://github.com/Xaoilin/mac-network-activity/releases/latest/download/NetScope-macOS-arm64.zip',
    launchUrl: 'sabah-netscope://open',
    launchInstructions: 'Apple Silicon, macOS 14+. Install NetScope 1.0.1 or later: extract the download and run Install NetScope.command, then open the app once. Launch on Mac opens its dashboard without changing collection. The download is ad-hoc signed and not Apple notarized. Per-app attribution follows macOS sampling limits.',
  },
];

export const SOFTWARE_GITHUB_URL = 'https://github.com/Xaoilin?tab=repositories';
