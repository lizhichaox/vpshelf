"""Read-only provider adapters and Linux SSH metrics."""
import json
import os
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

REMOTE = r'''
import json, time, os, shutil
from pathlib import Path
def cpu():
    a=list(map(int,Path('/proc/stat').read_text().splitlines()[0].split()[1:9]))
    return sum(a),a[3]+a[4]
def net():
    result={}
    for line in Path('/proc/net/dev').read_text().splitlines()[2:]:
        name,values=line.split(':'); v=values.split()
        if name.strip() != 'lo': result[name.strip()]=[int(v[0]),int(v[8])]
    return result
a=cpu(); n=net(); start=time.monotonic(); time.sleep(1); b=cpu(); m=net(); dt=time.monotonic()-start
mem={k:int(v.split()[0])*1024 for k,v in (line.split(':',1) for line in Path('/proc/meminfo').read_text().splitlines())}
disk=shutil.disk_usage('/')
print(json.dumps(dict(cpu=round(100*(1-(b[1]-a[1])/max(1,b[0]-a[0])),1),cores=os.cpu_count(),load=list(os.getloadavg()),memory=round(100*(1-mem.get('MemAvailable',mem['MemFree'])/mem['MemTotal']),1),memory_total=mem['MemTotal'],disk=round(100*disk.used/disk.total,1),disk_total=disk.total,rx=sum(max(0,m[k][0]-n[k][0]) for k in m if k in n)/dt,tx=sum(max(0,m[k][1]-n[k][1]) for k in m if k in n)/dt,uptime=float(Path('/proc/uptime').read_text().split()[0]))))
'''

def secret(value):
    if isinstance(value, str) and value.startswith('env:'):
        return os.environ[value[4:]]
    return value


def ssh_metrics(config):
    target = config['host']
    # SSH aliases are allowed; options cannot be injected through destination.
    if not target or target.startswith('-') or any(c.isspace() for c in target):
        raise ValueError('Invalid SSH host')
    cmd = ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
           '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2']
    if config.get('identity_file'):
        cmd += ['-i', str(Path(config['identity_file']).expanduser())]
    if config.get('user'):
        cmd += ['-l', config['user']]
    cmd += ['-p', str(int(config.get('port', 22))), target, 'python3 -']
    p = subprocess.run(cmd, input=REMOTE, text=True, capture_output=True, timeout=20, check=True)
    return json.loads(p.stdout)


def bandwidth(data):
    multiplier = float(data.get('monthly_data_multiplier', 1))
    total = float(data['plan_monthly_data']) * multiplier
    used = float(data['data_counter']) * multiplier
    if total <= 0 or used < 0 or multiplier <= 0:
        raise ValueError('Invalid bandwidth counters')
    return dict(total=total, used=used, remaining=max(0,total-used),
                remaining_percent=max(0,100*(1-used/total)), reset_at=data.get('data_next_reset'))


def provider_info(server):
    provider, c = server['provider'], server.get('cloud', {})
    if not c:
        return {}
    if provider == 'bandwagon':
        query=urllib.parse.urlencode({'veid':c['veid'], 'api_key':secret(c['api_key'])})
        req=urllib.request.Request('https://api.64clouds.com/v1/getServiceInfo?'+query)
        with urllib.request.urlopen(req, timeout=15) as response:
            data=json.load(response)
        if data.get('error',0):
            raise RuntimeError('Provider API error')
        return dict(region=data.get('node_datacenter'), bandwidth=bandwidth(data))
    if provider == 'lightsail':
        import boto3
        from botocore.config import Config
        session=boto3.Session(profile_name=c.get('profile'), region_name=c['region'],
            aws_access_key_id=secret(c.get('access_key_id')),
            aws_secret_access_key=secret(c.get('secret_access_key')),
            aws_session_token=secret(c.get('session_token')))
        client=session.client('lightsail', config=Config(connect_timeout=5, read_timeout=10, retries={'max_attempts':1}))
        d=client.get_instance(instanceName=c['instance_name'])['instance']
        return dict(region=d['location']['regionName'],state=d['state']['name'],ip=d.get('publicIpAddress'),plan=d.get('bundleId'))
    if provider == 'aliyun':
        from alibabacloud_ecs20140526.client import Client
        from alibabacloud_ecs20140526.models import DescribeInstancesRequest
        from alibabacloud_tea_openapi.models import Config
        from alibabacloud_tea_util.models import RuntimeOptions
        cfg=Config(access_key_id=secret(c['access_key_id']),access_key_secret=secret(c['access_key_secret']),region_id=c['region'])
        cfg.endpoint='ecs.'+c['region']+'.aliyuncs.com'
        response=Client(cfg).describe_instances_with_options(DescribeInstancesRequest(region_id=c['region'],instance_ids=json.dumps([c['instance_id']])),RuntimeOptions(connect_timeout=5000,read_timeout=10000,autoretry=False))
        items=response.body.instances.instance
        if not items:
            raise ValueError('Instance not found')
        d=items[0]
        return dict(region=d.region_id,state=d.status,plan=d.instance_type,expires_at=d.expired_time)
    return {}
