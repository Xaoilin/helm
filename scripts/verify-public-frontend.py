#!/usr/bin/env python3
"""Do not replace the old address until the owned public site serves this exact frontend."""
import argparse
import json
import re
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('commit')
    parser.add_argument('--wait', type=int, default=600, choices=range(601))
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}', args.commit):
        raise ValueError('An exact verified commit is required')
    deadline = time.monotonic() + args.wait
    while True:
        try:
            with urllib.request.urlopen('https://sabah.xaoilin.com/helm/deployment.json', timeout=15) as response:
                receipt = json.load(response)
            if receipt.get('repository') != 'Xaoilin/helm' or receipt.get('commit') != args.commit:
                raise RuntimeError('The owned public site is serving a different frontend')
            break
        except (urllib.error.URLError, TimeoutError, ValueError, RuntimeError):
            if time.monotonic() >= deadline:
                raise
            print('Waiting for the verified DigitalOcean frontend to be publicly served', flush=True)
            time.sleep(5)
    print('Owned public frontend source receipt verified; the legacy address can redirect safely')


if __name__ == '__main__':
    main()
