#!/usr/bin/env python3
"""Retain old bookmarks as a static redirect; credentials and OAuth parameters are discarded."""
from pathlib import Path
import sys

TARGET = 'https://sabah.xaoilin.com/helm/'
root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
html = ('<!doctype html><html lang="en"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="referrer" content="no-referrer">'
        '<meta http-equiv="refresh" content="0;url=' + TARGET + '">'
        '<title>Open the application</title><script>location.replace(' + repr(TARGET) + ')</script>'
        '<p>The application has moved. <a href="' + TARGET + '">Open it here</a>.</p></html>')
for name in ['index.html', '404.html']:
    (root / name).write_text(html)
