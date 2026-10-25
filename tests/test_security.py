import unittest
from vpshelf.security import evaluate

class SecurityTests(unittest.TestCase):
    def data(self):
        return dict(now=100000,logs_readable=True,truncated=False,events=[],sshd=dict(passwordauthentication='no',kbdinteractiveauthentication='no',permitrootlogin='prohibit-password',permitemptypasswords='no'))
    def test_missing_visibility_never_green(self):
        d=self.data();d['logs_readable']=False
        self.assertEqual(evaluate(d)['status'],'unknown')
        d=self.data();d['sshd']={}
        self.assertEqual(evaluate(d)['status'],'unknown')
    def test_no_allowlist_is_explicitly_skipped(self):
        result=evaluate(self.data())
        self.assertEqual(result['status'],'ok');self.assertTrue(result['partial'])
        self.assertEqual(next(r for r in result['rules'] if r['code']=='untrusted_login')['level'],'skipped')
    def test_failure_thresholds_and_old_events(self):
        for n,status in [(19,'ok'),(20,'warning'),(100,'critical')]:
            d=self.data();d['events']=[dict(ts=99999,kind='failed')]*n+[dict(ts=95000,kind='failed')]*200
            self.assertEqual(evaluate(d)['status'],status)
    def test_root_password_and_trusted_ip(self):
        d=self.data();d['events']=[dict(ts=99999,kind='accepted',user='root',method='password',ip='192.0.2.2')]
        self.assertEqual(evaluate(d)['status'],'critical')
        d['events'][0]['method']='publickey'
        self.assertEqual(evaluate(d,{'trusted_login_ips':['192.0.2.0/24']})['status'],'ok')
        self.assertEqual(evaluate(d,{'trusted_login_ips':['198.51.100.1']})['status'],'critical')
    def test_ipv6_allowlist(self):
        d=self.data();d['events']=[dict(ts=99999,kind='accepted',user='admin',method='publickey',ip='2001:db8::2')]
        self.assertEqual(evaluate(d,{'trusted_login_ips':['2001:db8::/32']})['status'],'ok')
    def test_truncation_and_config_findings(self):
        d=self.data();d['truncated']=True;self.assertEqual(evaluate(d)['status'],'unknown')
        d=self.data();d['sshd']['passwordauthentication']='yes';self.assertEqual(evaluate(d)['status'],'warning')
        d=self.data();d['sshd']['permitemptypasswords']='yes';self.assertEqual(evaluate(d)['status'],'critical')
    def test_failed_collector_clears_previous_verdict(self):
        from vpshelf.app import Monitor,Store
        from unittest.mock import patch
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            s={'id':'test','provider':'generic','ssh':{'host':'test'}}
            m=Monitor({'servers':[s],'security_interval':60},Store(Path(tmp)/'db'))
            with patch('vpshelf.app.ssh_metrics',return_value={}),patch('vpshelf.app.collect_security',return_value=evaluate(self.data())):
                m.collect(s)
            m.security_cache['test']['checked_at']=0
            with patch('vpshelf.app.ssh_metrics',return_value={}),patch('vpshelf.app.collect_security',side_effect=RuntimeError('secret')):
                m.collect(s)
            row=m.snapshot()[0]
            self.assertEqual(row['status'],'online');self.assertEqual(row['security']['status'],'unknown')
            self.assertNotIn('secret',str(row))

class LocalApiSecurityTests(unittest.TestCase):
    def response(self,token,headers):
        import io,tempfile
        from pathlib import Path
        from vpshelf.app import Monitor,Store,handler
        class Connection:
            def __init__(self):self.output=bytearray()
            def makefile(self,*args):return io.BytesIO(('GET /api/servers HTTP/1.0\r\n'+headers+'\r\n\r\n').encode('latin-1'))
            def sendall(self,data):self.output.extend(data)
        with tempfile.TemporaryDirectory() as tmp:
            m=Monitor({'servers':[]},Store(Path(tmp)/'db'))
            connection=Connection();handler(m,token)(connection,('127.0.0.1',123),None)
            return bytes(connection.output)
    def test_no_token_rejects_foreign_host(self):
        self.assertIn(b'403',self.response('','Host: attacker.example').splitlines()[0])
        self.assertIn(b'200',self.response('','Host: localhost:8765').splitlines()[0])
    def test_non_ascii_auth_does_not_crash(self):
        self.assertIn(b'401',self.response('correct-token','Host: localhost\r\nAuthorization: Bearer \xe9').splitlines()[0])
