import json
import tempfile
import subprocess
import sys
import threading
import time
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from vpshelf.app import Store, Monitor, handler, load_config
from vpshelf.collector import bandwidth, ssh_metrics, provider_info, REMOTE

class CoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store=Store(Path(self.tmp.name)/'data.db')
        self.server={'id':'one','name':'Test','provider':'bandwagon','ssh':{'host':'test'},'cloud':{'veid':'1','api_key':'private'}}
        self.monitor=Monitor({'servers':[self.server]},self.store)
    def test_bandwidth_multiplier_and_overage(self):
        b=bandwidth({'plan_monthly_data':100,'data_counter':90,'monthly_data_multiplier':0.5,'data_next_reset':123})
        self.assertEqual((b['total'],b['used'],b['remaining']),(50,45,5))
        self.assertAlmostEqual(b['remaining_percent'],10)
        self.assertEqual(bandwidth({'plan_monthly_data':100,'data_counter':110})['remaining'],0)
        with self.assertRaises(ValueError): bandwidth({'plan_monthly_data':0,'data_counter':0})
    def test_failures_preserve_cloud_but_clear_metrics(self):
        with patch('vpshelf.app.ssh_metrics',return_value={'cpu':12}),patch('vpshelf.app.provider_info',return_value={'state':'running'}) as cloud:
            self.monitor.collect(self.server);self.monitor.collect(self.server)
            self.assertEqual(cloud.call_count,1)
        self.monitor.cloud_cache['one']['attempt']=0
        with patch('vpshelf.app.ssh_metrics',side_effect=RuntimeError('secret')),patch('vpshelf.app.provider_info',side_effect=RuntimeError('api_key=secret')):
            self.monitor.collect(self.server)
        row=self.monitor.snapshot()[0]
        self.assertEqual(row['status'],'unreachable');self.assertIsNone(row['metrics'])
        self.assertEqual(row['cloud']['state'],'running');self.assertTrue(row['cloud_stale'])
        self.assertNotIn('secret',json.dumps(row));self.assertEqual(len(self.store.history('one')),3)
    def test_history_isolation(self):
        self.store.save('one',{'checked_at':time.time(),'metrics':{'cpu':9}})
        self.assertEqual(len(self.store.history('one')),1);self.assertEqual(self.store.history('two'),[])
    def test_ssh_strict_and_no_shell(self):
        with patch('vpshelf.collector.subprocess.run') as run:
            run.return_value.stdout='{"cpu":12}'
            self.assertEqual(ssh_metrics({'host':'my-host'})['cpu'],12)
            self.assertIn('StrictHostKeyChecking=yes',run.call_args.args[0])
            self.assertNotIn('shell',run.call_args.kwargs)
        with self.assertRaises(ValueError):ssh_metrics({'host':'-oProxyCommand=bad'})
    @unittest.skipUnless(sys.platform == "linux", "Remote sampler requires Linux /proc")
    def test_linux_sampler(self):
        result=subprocess.run([sys.executable,"-c",REMOTE],text=True,capture_output=True,check=True,timeout=10)
        data=json.loads(result.stdout)
        for key in ("cpu","memory","disk"):
            self.assertGreaterEqual(data[key],0);self.assertLessEqual(data[key],100)
        self.assertGreater(data["memory_total"],0);self.assertEqual(len(data["load"]),3)

    def test_bandwagon_request_identifies_client(self):
        import io
        payload={'error':0,'plan_monthly_data':100,'data_counter':40}
        with patch('vpshelf.collector.urllib.request.urlopen',return_value=io.BytesIO(json.dumps(payload).encode())) as call:
            result=provider_info(self.server)
            request=call.call_args.args[0]
            self.assertTrue(request.get_header('User-agent').startswith('VPShelf/'))
            self.assertEqual(request.get_header('Accept'),'application/json')
            self.assertEqual(result['bandwidth']['remaining'],60)

    def test_safe_cloud_diagnostics(self):
        import socket
        import ssl
        from urllib.error import URLError, HTTPError
        from vpshelf.collector import safe_error, ProviderError
        self.assertIn('DNS',safe_error(URLError(socket.gaierror(-2,'secret'))))
        self.assertIn('TLS',safe_error(URLError(ssl.SSLCertVerificationError('secret'))))
        self.assertIn('HTTP 403',safe_error(HTTPError('https://example/?api_key=secret',403,'secret',{},None)))
        self.assertIn('错误码 5',safe_error(ProviderError(5)))
        for exc in [RuntimeError('secret'),ValueError('secret'),KeyError('secret')]:
            self.assertNotIn('secret',safe_error(exc))

    def test_config_duplicates(self):
        path=Path(self.tmp.name)/'config.json';path.write_text(json.dumps({'servers':[self.server,self.server]}))
        with self.assertRaises(ValueError):load_config(path)
    def test_http_auth_and_private_routes(self):
        import io
        class Connection:
            def __init__(self,request):
                self.input=io.BytesIO(request);self.output=bytearray()
            def makefile(self,*args):return self.input
            def sendall(self,data):self.output.extend(data)
        def request(path,auth=''):
            c=Connection(('GET '+path+' HTTP/1.0\r\nAuthorization: '+auth+'\r\n\r\n').encode())
            handler(self.monitor,'test-token')(c,('127.0.0.1',1234),None)
            return bytes(c.output)
        self.assertIn(b'401',request('/api/servers').splitlines()[0])
        content=request('/api/servers','Bearer test-token')
        self.assertIn(b'200',content.splitlines()[0])
        self.assertNotIn(b'api_key',content);self.assertNotIn(b'private',content)
        for path in ['/config.local.json','/../config.local.json','/api/unknown']:
            self.assertIn(b'404',request(path,'Bearer test-token').splitlines()[0])
        self.assertIn(b'VPShelf',request('/'))

if __name__=='__main__':unittest.main()
