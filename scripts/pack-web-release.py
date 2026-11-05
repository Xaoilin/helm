#!/usr/bin/env python3
"""Package the verified Sabah browser build with its exact source-run receipt."""
import json
from pathlib import Path
import re
import sys
import tarfile


def main():
    source, output, commit, run_id = sys.argv[1:]
    root = Path(source)
    if not re.fullmatch('[0-9a-f]{40}', commit) or not run_id.isdigit() or int(run_id) <= 0:
        raise ValueError('Exact commit and successful source-run ID are required')
    assert (root / 'index.html').is_file() and (root / 'release.json').is_file()
    (root / 'deployment.json').write_text(json.dumps({
        'repository': 'Xaoilin/helm', 'commit': commit, 'sourceRunId': int(run_id),
    }, indent=2) + '\n')
    with tarfile.open(output, 'w') as archive:
        for file in sorted(root.rglob('*')):
            if file.is_symlink():
                raise ValueError('Frontend artifacts must not contain links')
            if file.is_file():
                archive.add(file, arcname=str(file.relative_to(root)), recursive=False)


if __name__ == '__main__':
    main()
