import type { SoftwareReference } from '../types/domain';

/** Only add confirmed, deliberately published software links to this list. */
export const SOFTWARE_REFERENCES: readonly SoftwareReference[] = [
  {
    id: 'autoclicker',
    name: 'Autoclicker',
    description: 'A general-purpose desktop autoclicker. Its GitHub repository is awaiting confirmation.',
  },
];

export const SOFTWARE_GITHUB_URL = 'https://github.com/Xaoilin?tab=repositories';
