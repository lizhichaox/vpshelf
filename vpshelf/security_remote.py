"""Executed over SSH with python3 on Linux. Read-only, bounded collection."""
import json
import os
import re
import subprocess
import time
from pathlib import Path


def run(command):
    variants = [command] if os.geteuid() == 0 else [['sudo', '-n'] + command, command]
    for cmd in variants:
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=7)
            if p.returncode == 0 and not any(x in p.stderr.lower() for x in ['not seeing messages', 'permission denied', 'insufficient permissions']):
                return p.stdout
        except (OSError, subprocess.TimeoutExpired):
            pass
    return None


def collect():
    now = time.time()
    raw = run(['journalctl', '-u', 'ssh.service', '-u', 'sshd.service', '--since', '24 hours ago', '-n', '5001', '-o', 'json', '--no-pager'])
    entries = []
    if raw:
        for line in raw.splitlines():
            try:
                item = json.loads(line)
                entries.append((float(item['__REALTIME_TIMESTAMP']) / 1e6, item.get('MESSAGE', '')))
            except (ValueError, KeyError, TypeError):
                pass
    events = []
    for ts, message in entries:
        if not isinstance(message, str):
            continue
        accepted = re.search(r'Accepted (\S+) for (\S+) from (\S+)', message)
        failed = re.search(r'Failed (\S+) for (?:invalid user )?(\S+) from (\S+)', message)
        invalid = re.search(r'Invalid user (\S+) from (\S+)', message)
        if accepted or failed:
            match = accepted or failed
            events.append(dict(ts=ts, kind='accepted' if accepted else 'failed', method=match[1], user=match[2][:64], ip=match[3][:64]))
        elif invalid:
            events.append(dict(ts=ts, kind='invalid_user', user=invalid[1][:64], ip=invalid[2][:64]))
    sshd = run(['/usr/sbin/sshd', '-T'])
    keys = {'passwordauthentication', 'kbdinteractiveauthentication', 'permitrootlogin', 'permitemptypasswords', 'authenticationmethods'}
    settings = {}
    if sshd:
        for line in sshd.splitlines():
            parts = line.split(None, 1)
            if len(parts) == 2 and parts[0] in keys:
                settings[parts[0]] = parts[1]
    return dict(now=now, logs_readable=bool(entries), truncated=len(entries) >= 5001,
                events=events, sshd=settings, reboot_required=Path('/var/run/reboot-required').exists())

if __name__ == '__main__':
    print(json.dumps(collect()))
