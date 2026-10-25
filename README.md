# VPShelf

**A small shelf for your servers.**

**English** · [简体中文](README.zh-CN.md)

A compact, self-hosted dashboard for a personal fleet of VPS instances. Bring BandwagonHost, AWS Lightsail, Alibaba Cloud ECS, and generic Linux servers into one view—with resource metrics, provider information, transfer balances, and read-only security checks.

Built for small fleets, typically fewer than 10 servers. Python + SQLite + vanilla JavaScript. No frontend build step, Redis, or monitoring agent.

## Features

- **One compact overview:** search, provider filtering, resource usage, transfer balances, and security status.
- **SSH metrics:** CPU, memory, root disk usage, load averages, uptime, and network rates.
- **BandwagonHost transfer:** used, remaining, allowance, and billing-cycle reset time from KiwiVM. Remaining transfer below 20% / 10% is highlighted.
- **Cloud details:** instance state, region, availability zone, addresses, hardware, and provider-specific plan information.
- **Security signals:** SSH authentication events and configuration checks, with evidence in the details view.
- **History:** 24-hour CPU/memory charts, backed by seven days of samples in SQLite.
- **English and Chinese:** follows browser language preferences, with a persistent manual override.
- **Private credentials:** local configuration or environment variable references. Optional browser token persistence.

## Provider support

| Provider | Cloud API data | Required credentials / permissions |
| --- | --- | --- |
| BandwagonHost | Transfer used, remaining, total, reset time, datacenter | VEID + KiwiVM API key |
| AWS Lightsail | State, region, zone, IPs, hardware, bundle price and transfer allowance, CPU burst balance | AWS credential chain or access keys; `lightsail:GetInstance`, `lightsail:GetBundles`, `lightsail:GetInstanceMetricData` |
| Alibaba Cloud ECS | State, region, zone, IPs, CPU/RAM, OS, expiry, billing type, bandwidth | RAM AccessKey; `ecs:DescribeInstances` |
| Generic Linux | SSH metrics and security checks | SSH key authentication |

SSH and cloud collection are independent. Configure either, or both. All providers use SSH for guest memory, disk, load, and security checks.

**Lightsail's monthly transfer allowance is not a remaining-transfer balance.** ECS fixed-bandwidth plans display bandwidth, not a fictional monthly quota. Network-interface counters are operational metrics, not billing data.

## Quick start

Requires Python 3.10+ and an OpenSSH client on the monitoring host. Target servers need Linux and Python 3.

```sh
git clone https://github.com/lizhichaox/vpshelf.git
cd vpshelf
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp config.example.json config.local.json
chmod 600 config.local.json
export VPSHELF_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
```

Edit `config.local.json`: replace or remove the placeholder servers and set any referenced environment variables. Then start:

```sh
python3 -m vpshelf.app
```

Open **[http://127.0.0.1:8765](http://127.0.0.1:8765)**. Enter the dashboard token printed in the startup console. “Remember on this browser” stores a successfully verified token in localStorage; use **Access token → Forget token** to clear it.

For a first test, add just one server. There is no demo data; an empty `servers` array displays the empty state. The core app, SSH collector, and BandwagonHost adapter use only Python's standard library; the SDK dependencies are needed for Lightsail and ECS.

## Configuration

A minimal SSH-only configuration:

```json
{
  "token": "env:VPSHELF_TOKEN",
  "interval": 60,
  "cloud_interval": 600,
  "security_interval": 900,
  "servers": [
    {
      "id": "my-server",
      "name": "My VPS",
      "provider": "generic",
      "ssh": {
        "host": "my-ssh-alias",
        "user": "monitor",
        "port": 22,
        "identity_file": "~/.ssh/id_ed25519"
      }
    }
  ]
}
```

| Setting | Behavior |
| --- | --- |
| `id` | Stable, unique server ID: letters, digits, `_`, or `-`. Used to associate history. |
| `provider` | `bandwagon`, `lightsail`, `aliyun`, or `generic`. |
| `ssh` / `cloud` | At least one is required. Cloud examples are in [config.example.json](config.example.json). |
| `interval` | SSH metrics, default 60 seconds; range 15–3600. |
| `cloud_interval` | Cloud data, default 600 seconds; range 300–86400. Failed cloud requests retry after 60 seconds. |
| `security_interval` | Security checks, default 900 seconds; range 60–86400. |
| `token` | Dashboard access token. Non-loopback binding requires at least 24 characters. |

Changes to server configuration require a restart. Refreshing the dashboard reads the latest cached samples; it does not force a cloud API request.

### Private credentials

Keep secrets in `config.local.json`, which is excluded from Git and the Docker build context, or reference environment variables with `env:VARIABLE_NAME`.

The Python app does not load `.env` automatically. Export variables in the process environment; for a persistent service, configure them in its service environment. Docker Compose supports `.env` interpolation. Keep dashboard tokens and cloud API keys separate.

### SSH connection

`host` accepts an IP, hostname, or alias from `~/.ssh/config`. Set `port` explicitly for nonstandard ports; it defaults to 22. The collector honors SSH config options such as `ProxyJump` and identity selection.

Connect manually once, verify the host fingerprint, and confirm key-based authentication works. VPShelf uses batch mode and strict host-key checking; it does not automatically trust new hosts or prompt for passwords.

Metrics require no root access. Security logs and `sshd -T` may require elevated read permissions. The security collector tries existing `sudo -n` permissions, then normal user access, without changing permissions or waiting for a password.

### BandwagonHost

Obtain the VEID and API key from **KiwiVM → API**:

```json
"cloud": {
  "veid": "YOUR_VEID",
  "api_key": "env:BANDWAGON_API_KEY"
}
```

VPShelf calls `getServiceInfo`. It multiplies both `plan_monthly_data` and `data_counter` by `monthly_data_multiplier`, displays binary GiB/TiB, and shows `data_next_reset` separately from instance expiry. The billing cycle need not start on the first day of a calendar month.

### AWS Lightsail

Set `region` and `instance_name`. Authentication supports boto3's default credential chain, a named `profile`, or explicit `access_key_id`, `secret_access_key`, and optional `session_token`.

The example config uses `profile: default`. Remove `profile` if using environment variables or a workload role without a configured AWS profile. Use a dedicated read-only IAM identity with the three actions listed in the provider table; scope access by region where appropriate.

### Alibaba Cloud ECS

Set `region`, `instance_id`, `access_key_id`, and `access_key_secret`. Use a dedicated RAM identity with `ecs:DescribeInstances`. The current adapter supports AccessKeys, not Alibaba STS tokens. Pay-as-you-go instances may not have an expiry date.

## Security checks

The collector reads the last 24 hours of systemd journal entries for `ssh.service` / `sshd.service`, plus global `sshd -T` settings and the reboot-required marker.

| Rule | Trigger | Result |
| --- | --- | --- |
| Failed logins | ≥20 / hour; ≥100 / hour | Review; high risk |
| Invalid-user attempts | ≥10 / hour | Review |
| Root password / keyboard-interactive success | Any in 24 hours | High risk; investigate |
| Successful login outside trusted ranges | Any in 24 hours, when configured | High risk; investigate |
| Password or keyboard-interactive authentication enabled | Global SSH settings | Review alongside MFA / AuthenticationMethods |
| Root password login permitted | Global SSH settings | Review |
| Empty-password authentication enabled | Global SSH settings | High-risk configuration |
| `/var/run/reboot-required` exists | System requests reboot | Review |
| Logs unavailable, empty, truncated, or config unreadable | Incomplete visibility | Unknown / partial coverage |

Add trusted login sources per server to enable unfamiliar-source detection:

```json
"security": {
  "trusted_login_ips": ["203.0.113.10", "2001:db8::/32"]
}
```

Without this list, recent successful logins are shown for review without classifying unfamiliar sources. Status precedence is **high risk → review → unknown → OK**. A disconnected SSH host marks prior security results as stale.

An OK result means no rule fired within the inspected scope. This is not a vulnerability scan or proof that a host is uncompromised. Checks do not modify servers. Collection is capped at 5001 journal entries; rotated `auth.log`, conditional SSH `Match` rules, cloud firewalls, and package vulnerability databases are not evaluated.

## Persistent deployment

Run VPShelf on an always-on host to collect continuously. Closing the browser is fine; stopping the service or putting the monitoring machine to sleep pauses collection. Existing samples remain on disk; missed guest metrics are not backfilled. Provider transfer counters are fetched again when collection resumes.

Start the app under your preferred service manager with an explicit working directory, interpreter, configuration path, and database path:

```sh
/path/to/vpshelf/.venv/bin/python -m vpshelf.app \
  --config /path/to/vpshelf/config.local.json \
  --db /path/to/vpshelf/data/vpshelf.sqlite3
```

### Docker

```sh
docker compose up -d --build
```

Prepare the private config and environment variables first. Compose binds port 8765 to localhost and keeps SQLite in a named volume. For SSH, mount a dedicated SSH directory containing keys, config, and verified `known_hosts` at `/home/shelf/.ssh:ro`; container UID 10001 must be able to read it. Use container-visible key paths. AWS profiles require a separate credentials mount, or use environment credentials instead.

The built-in HTTP server is intended for personal, low-concurrency use. Keep it on localhost or access it through an SSH tunnel. Public deployments should use an HTTPS reverse proxy with access controls. Non-loopback startup does not print the access token.

## Troubleshooting

- **SSH unreachable:** check hostname, port, username, key, host fingerprint, and remote `python3`. Confirm the same alias works in a terminal.
- **Cloud collection failed:** inspect the displayed network, TLS, HTTP, SDK, or configuration error. Check region, instance identifier, credentials, and read permissions.
- **Security unknown:** check journal availability and existing read/sudo permissions. Empty or incomplete logs never count as full coverage.
- **No transfer balance:** BandwagonHost needs KiwiVM credentials; SSH counters cannot substitute for billing counters. Lightsail currently shows allowance only.
- **Data looks stale:** confirm the collector is running and the monitoring host is awake. Cloud failures preserve the previous data with a stale flag.

## Development

```sh
python3 -m unittest discover -s tests -v
node tests/test_i18n.cjs
node tests/test_dropdowns.cjs
node --check vpshelf/static/app.js
```

Tests cover transfer math, error/cache behavior, HTTP access control, SSH options, security rules, language switching, and dropdown keyboard interaction. Cloud and SSH integrations use test doubles; the Linux sampler test runs against `/proc` in Linux CI.

Current scope: manual server inventory, local history, read-only collection, and on-screen alerts. No automatic discovery, resource-control actions, or outbound notifications. The repository does not currently include a license file.
