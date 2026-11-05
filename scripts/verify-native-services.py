#!/usr/bin/env python3
"""Fail deployment closed unless Sabah's independently owned native services are ready."""
import json
import sys
import urllib.request


def main():
    base = sys.argv[1].rstrip('/')
    if base != 'https://api.sabah.xaoilin.com':
        raise ValueError('Deployment must target the owned Sabah API origin')
    for service in ['access', 'profile', 'prayer', 'calendar', 'life', 'knowledge', 'planner', 'finance', 'live']:
        for suffix in ['health'] + ([] if service == 'live' else ['health/database']):
            with urllib.request.urlopen(f'{base}/api/{service}/{suffix}', timeout=15) as response:
                body = json.load(response)
            if body.get('status') != 'UP' or (suffix.endswith('/database') and body.get('database') != 'UP'):
                raise RuntimeError(f'{service} is not ready')
    with urllib.request.urlopen(f'{base}/.well-known/oauth-authorization-server/api/access', timeout=15) as response:
        metadata = json.load(response)
    if metadata.get('issuer') != base + '/api/access':
        raise RuntimeError('Native identity issuer is not active')
    print('Sabah native service, database and identity readiness verified')


if __name__ == '__main__':
    main()
