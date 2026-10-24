from contextlib import contextmanager
import argparse
import concurrent.futures
import hmac
import json
import os
import re
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from .collector import provider_info, ssh_metrics, secret, safe_error


def load_config(path):
    data=json.loads(Path(path).read_text())
    ids=set()
    for s in data.get('servers',[]):
        if not re.fullmatch(r'[a-zA-Z0-9_-]+',s.get('id','')) or s['id'] in ids:
            raise ValueError('Server ids must be unique and contain only letters, digits, _ or -')
        ids.add(s['id'])
        if s.get('provider') not in ('bandwagon','lightsail','aliyun','generic'):
            raise ValueError('Unknown provider')
        if 'ssh' not in s and not s.get('cloud'):
            raise ValueError('A server needs SSH or cloud configuration')
    if not 15 <= data.get('interval',60) <= 3600:
        raise ValueError('interval must be 15..3600 seconds')
    if not 300 <= data.get('cloud_interval',600) <= 86400:
        raise ValueError('cloud_interval must be 300..86400 seconds')
    return data


class Store:
    def __init__(self,path):
        self.path=str(path)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS samples (server TEXT, ts REAL, data TEXT)')
            db.execute('CREATE INDEX IF NOT EXISTS by_server_time ON samples(server,ts)')
    @contextmanager
    def connect(self):
        db=sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()
    def save(self,server,data):
        with self.connect() as db:
            db.execute('INSERT INTO samples VALUES (?,?,?)',(server,data['checked_at'],json.dumps(data)))
            db.execute('DELETE FROM samples WHERE ts < ?', (time.time()-7*86400,))
    def history(self,server):
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute('SELECT data FROM samples WHERE server=? AND ts>=? ORDER BY ts',(server,time.time()-86400))]


class Monitor:
    def __init__(self,config,store):
        self.config,self.store=config,store
        self.lock=threading.Lock()
        self.rows={s['id']:dict(id=s['id'],name=s.get('name',s['id']),provider=s['provider'],region=s.get('region',''),host=s.get('ssh',{}).get('host',''),status='pending',cloud={},metrics=None) for s in config.get('servers',[])}
        self.cloud_cache={}
        self.stop=threading.Event()
    def collect(self,s):
        now=time.time()
        with self.lock:
            row=dict(self.rows[s['id']])
        row.update(checked_at=now, errors=[],metrics=None,status='unknown')
        if s.get('ssh'):
            try:
                row['metrics']=ssh_metrics(s['ssh']); row['status']='online'
            except Exception:
                row['status']='unreachable'; row['errors'].append('SSH 采集失败：请检查连接、主机指纹和远端 Python 3')
        cached=self.cloud_cache.get(s['id'],{})
        retry_interval = 60 if cached.get('error') else self.config.get('cloud_interval',600)
        if s.get('cloud') and now-cached.get('attempt',0)>=retry_interval:
            cached=dict(cached,attempt=now)
            try:
                cached.update(data=provider_info(s),updated=now,error=None)
            except Exception as error:
                cached['error']='云 API 采集失败：' + safe_error(error)
                print(s['id'] + ': ' + cached['error'], flush=True)
            self.cloud_cache[s['id']]=cached
        row['cloud']=cached.get('data',{})
        row['cloud_updated_at']=cached.get('updated')
        row['cloud_stale']=bool(cached.get('error'))
        if cached.get('error'): row['errors'].append(cached['error'])
        if row['cloud'].get('region'): row['region']=row['cloud']['region']
        self.store.save(s['id'],row)
        with self.lock: self.rows[s['id']]=row
    def run(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            while not self.stop.is_set():
                futures=[pool.submit(self.collect,s) for s in self.config.get('servers',[])]
                for f in futures:
                    try: f.result()
                    except Exception: print('Sample could not be stored; check database access.',flush=True)
                self.stop.wait(self.config.get('interval',60))
    def snapshot(self):
        with self.lock: return list(self.rows.values())


def handler(monitor,token):
    static=Path(__file__).parent/'static'
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def send(self,status,body,kind='application/json'):
            self.send_response(status)
            self.send_header('Content-Type',kind+'; charset=utf-8')
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'")
            self.end_headers(); self.wfile.write(body)
        def do_GET(self):
            url=urlsplit(self.path)
            if url.path.startswith('/api/'):
                auth=self.headers.get('Authorization','')
                if token and not hmac.compare_digest(auth,'Bearer '+token):
                    return self.send(401,b'{"error":"Authentication required"}')
                if url.path=='/api/servers':
                    data={'servers':monitor.snapshot(),'interval':monitor.config.get('interval',60)}
                elif url.path=='/api/history':
                    sid=parse_qs(url.query).get('id',[''])[0]
                    if sid not in monitor.rows: return self.send(404,b'{}')
                    data=monitor.store.history(sid)
                else: return self.send(404,b'{}')
                return self.send(200,json.dumps(data).encode())
            files={'/':('index.html','text/html'),'/app.js':('app.js','text/javascript'),'/style.css':('style.css','text/css')}
            if url.path not in files: return self.send(404,b'Not found','text/plain')
            name,kind=files[url.path]
            self.send(200,(static/name).read_bytes(),kind)
    return Handler


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--config',default='config.local.json')
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--db',default='data/vpshelf.sqlite3')
    args=parser.parse_args()
    config=load_config(args.config)
    token=secret(config.get('token',''))
    if args.host not in ('127.0.0.1','::1','localhost') and len(token)<24:
        parser.error('Non-loopback binding requires a token of at least 24 characters')
    os.umask(0o077)
    Path(args.db).parent.mkdir(parents=True,exist_ok=True)
    monitor=Monitor(config,Store(args.db))
    worker=threading.Thread(target=monitor.run,daemon=True); worker.start()
    httpd=ThreadingHTTPServer((args.host,args.port),handler(monitor,token))
    print(f'VPShelf: http://{args.host}:{args.port}',flush=True)
    if token and args.host in ('127.0.0.1', '::1', 'localhost'):
        print(f'面板访问口令: {token}', flush=True)
    try: httpd.serve_forever()
    except KeyboardInterrupt: pass
    finally: monitor.stop.set(); httpd.server_close(); worker.join(timeout=45)

if __name__=='__main__': main()
