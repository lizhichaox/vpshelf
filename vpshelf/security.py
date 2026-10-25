"""Small transparent security rules. Findings are signals, not compromise verdicts."""
import ipaddress
from pathlib import Path
from .collector import ssh_run


def evaluate(data, config=None):
    config = config or {}
    rules = []
    def add(code, level, **evidence):
        rules.append(dict(code=code, level=level, evidence=evidence))
    now = data['now']
    events = [e for e in data.get('events', []) if now-86400 <= e.get('ts', 0) <= now+60]
    readable = data.get('logs_readable', False)
    add('auth_logs', 'ok' if readable and not data.get('truncated') else 'unknown', truncated=bool(data.get('truncated')))
    if readable:
        failed = [e for e in events if e['kind']=='failed' and e['ts'] >= now-3600]
        count = len(failed)
        add('failed_logins', 'critical' if count >= 100 else 'warning' if count >= 20 else 'ok', count=count, window_hours=1)
        invalid = [e for e in events if e['kind']=='invalid_user' and e['ts'] >= now-3600]
        add('invalid_users', 'warning' if len(invalid) >= 10 else 'ok', count=len(invalid), window_hours=1)
        accepted = [e for e in events if e['kind']=='accepted']
        root_password = [e for e in accepted if e.get('user')=='root' and e.get('method') in ('password','keyboard-interactive')]
        add('root_password_login', 'critical' if root_password else 'ok', count=len(root_password), recent=root_password[-5:])
        trusted = [ipaddress.ip_network(x, strict=False) for x in config.get('trusted_login_ips', [])]
        if trusted:
            outsiders = []
            for e in accepted:
                try:
                    if not any(ipaddress.ip_address(e['ip']) in network for network in trusted):
                        outsiders.append(e)
                except ValueError:
                    outsiders.append(e)
            add('untrusted_login', 'critical' if outsiders else 'ok', count=len(outsiders), recent=outsiders[-5:])
        else:
            add('untrusted_login', 'skipped', recent=accepted[-5:])
    settings = data.get('sshd', {})
    if not {'passwordauthentication','permitrootlogin','permitemptypasswords'} <= settings.keys():
        add('sshd_config', 'unknown')
    else:
        # sshd -T reports global defaults; Match blocks and external controls are not evaluated.
        password = settings.get('passwordauthentication')=='yes'
        interactive = settings.get('kbdinteractiveauthentication')=='yes'
        add('password_auth', 'warning' if password or interactive else 'ok', password=password, keyboard_interactive=interactive, authentication_methods=settings.get('authenticationmethods'))
        root = settings['permitrootlogin']=='yes' and (password or interactive)
        add('root_password_config', 'warning' if root else 'ok', permit_root_login=settings['permitrootlogin'])
        add('empty_password', 'critical' if settings['permitemptypasswords']=='yes' else 'ok')
    add('reboot_required', 'warning' if data.get('reboot_required') else 'ok')
    levels={r['level'] for r in rules}
    level = 'critical' if 'critical' in levels else 'warning' if 'warning' in levels else 'unknown' if 'unknown' in levels else 'ok'
    return dict(status=level,checked_at=now,rules=rules,scope='ssh_auth_and_configuration',partial='unknown' in levels or 'skipped' in levels)


def collect_security(ssh, config=None):
    raw = ssh_run(ssh, Path(__file__).with_name('security_remote.py').read_text(), timeout=45)
    return evaluate(raw, config)
