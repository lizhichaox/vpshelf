'use strict';
const $=s=>document.querySelector(s);
const TOKEN_KEY='vpshelf.accessToken';
function savedToken(){try{return localStorage.getItem(TOKEN_KEY)||'';}catch{return '';}}
function saveToken(value){try{if(value)localStorage.setItem(TOKEN_KEY,value);else localStorage.removeItem(TOKEN_KEY);}catch{/* Storage may be disabled; memory login still works. */}}
let rows=[], token=savedToken(), selected=null;
const names={bandwagon:'Bandwagon',lightsail:'AWS Lightsail',aliyun:'阿里云 ECS',generic:'Generic'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=n=>Number.isFinite(n)?n.toFixed(1)+'%':'—';
function bytes(n){if(!Number.isFinite(n))return '—';const units=['B','KiB','MiB','GiB','TiB'];let i=0;while(n>=1024&&i<4){n/=1024;i++;}return n.toFixed(i?1:0)+' '+units[i];}
const date=n=>n?new Date(n*1000).toLocaleString():'—';
const status={pending:'等待采集',online:'SSH 在线',unreachable:'SSH 不可达',unknown:'未配置 SSH'};
async function api(path){const r=await fetch(path,{headers:token?{Authorization:'Bearer '+token}:{}});if(r.status===401){saveToken('');token='';if(!$('#login').open)$('#login').showModal();throw Error('需要访问密钥');}if(!r.ok)throw Error('请求失败，请检查服务');return r.json();}
function bar(n,color='#478b6c'){const v=Number.isFinite(n)?Math.max(0,Math.min(100,n)):0;return `<div class="bar"><svg viewBox="0 0 100 4" preserveAspectRatio="none"><rect width="${v}" height="4" fill="${color}"/></svg></div>`;}
function render(){
 const online=rows.filter(r=>r.status==='online').length;
 const warn=rows.filter(r=>r.errors?.length||r.cloud?.bandwidth?.remaining_percent<20).length;
 const cpu=rows.filter(r=>r.metrics).map(r=>r.metrics.cpu);
 $('#summary').innerHTML=[['服务器总数',rows.length,'跨 '+new Set(rows.map(r=>r.provider)).size+' 个服务商'],['SSH 在线',online,'已成功取得运行指标'],['平均 CPU',cpu.length?pct(cpu.reduce((a,b)=>a+b,0)/cpu.length):'—','按最近成功采样计算'],['需要关注',warn,'采集异常或剩余流量低于 20%']].map(([a,b,c])=>`<div class="stat"><label>${a}</label><strong>${b}</strong><small>${c}</small></div>`).join('');
 const query=$('#search').value.trim().toLowerCase(), provider=$('#provider').value;
 const filtered=rows.filter(r=>(!provider||r.provider===provider)&&[r.name,r.region,r.host].join(' ').toLowerCase().includes(query));
 $('#count').textContent=`${filtered.length} / ${rows.length}`;
 $('#servers').innerHTML=filtered.length?filtered.map(r=>{
  const m=r.metrics,b=r.cloud?.bandwidth;const level=b?.remaining_percent<10?'critical':b?.remaining_percent<20?'warning':'';
  return `<article class="server"><div class="identity"><div class="provider">${esc(names[r.provider])}</div><h3>${esc(r.name)}</h3><div class="sub">${esc(r.region||'地区未设置')} · ${esc(r.host||r.cloud?.ip||'仅云 API')}</div>${r.errors?.length?`<div class="errors">${r.errors.map(esc).join('<br>')}</div>`:''}</div><span class="status ${esc(r.status)}">${status[r.status]||'未知'}</span><div><div class="metric"><span>CPU</span>${pct(m?.cpu)}</div>${bar(m?.cpu)}<div class="metric"><span>内存</span>${pct(m?.memory)}</div>${bar(m?.memory,'#919ec3')}</div><div><div class="metric"><span>磁盘 /</span>${pct(m?.disk)}</div><div class="metric"><span>↓ 接收</span>${bytes(m?.rx)}/s</div><div class="metric"><span>↑ 发送</span>${bytes(m?.tx)}/s</div></div><div class="traffic">${b?`<div class="sub">周期剩余 ${r.cloud_stale?'· 数据过期':''}</div><div class="remaining ${level}">${bytes(b.remaining)} <small>(${pct(b.remaining_percent)})</small></div>${bar(b.remaining_percent,level?'#c68a42':'#478b6c')}<div class="sub">总额 ${bytes(b.total)} · 重置 ${date(b.reset_at)}</div>`:`<div class="sub">云实例状态</div><div class="metric">${esc(r.cloud?.state||'—')}</div><div class="sub">${esc(r.cloud?.plan||'未提供周期流量额度')}</div>`}</div><button class="details-btn" data-id="${esc(r.id)}">详情 ↗</button></article>`;
 }).join(''):`<div class="empty">${rows.length?'没有匹配的服务器。':'还没有服务器。<br>在 config.local.json 中添加服务器后重启服务。'}</div>`;
 $('#servers').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>detail(b.dataset.id));
}
async function refresh(){try{const data=await api('/api/servers');rows=data.servers;render();$('#updated').textContent='视图更新 '+new Date().toLocaleTimeString();$('#error').hidden=true;return true;}catch(e){$('#error').textContent=e.message;$('#error').hidden=false;return false;}}
async function detail(id){
 selected=id;const row=rows.find(r=>r.id===id);$('#detail-title').textContent=row.name;$('#details').textContent='';$('#chart').innerHTML='';$('#history-note').textContent='加载中…';if(!$('#detail').open)$('#detail').showModal();
 try{const samples=await api('/api/history?id='+encodeURIComponent(id));if(selected!==id)return;
 const m=row.metrics;$('#details').innerHTML=[['主机',row.host||'—'],['云信息更新时间',date(row.cloud_updated_at)],['运行指标采集时间',date(row.checked_at)],['负载 1 / 5 / 15 分钟',m?.load?.map(x=>x.toFixed(2)).join(' / ')||'—'],['CPU 核心',m?.cores??'—'],['运行时间',m?Math.floor(m.uptime/86400)+' 天':'—'],['内存容量',bytes(m?.memory_total)],['根磁盘容量',bytes(m?.disk_total)],['实例到期时间',row.cloud?.expires_at||'厂商未提供']].map(([a,b])=>`<div><span class="sub">${esc(a)}</span><br>${esc(b)}</div>`).join('');
 const end=Date.now()/1000,start=end-86400;let svg='';for(const y of [0,50,100])svg+=`<line x1="35" y1="${190-y*1.6}" x2="790" y2="${190-y*1.6}" stroke="#e1e8df"/><text x="3" y="${194-y*1.6}" font-size="11" fill="#839087">${y}</text>`;
 for(const [key,color] of [['cpu','#478b6c'],['memory','#919ec3']]){let part=[];const flush=()=>{if(part.length===1){const [x,y]=part[0].split(',');svg+=`<circle cx="${x}" cy="${y}" r="3" fill="${color}"/>`;}else if(part.length>1)svg+=`<polyline points="${part.join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`;part=[];};let previous=null;for(const s of samples){if(previous&&s.checked_at-previous>180)flush();previous=s.checked_at;if(!Number.isFinite(s.metrics?.[key])){flush();continue;}part.push(`${35+(s.checked_at-start)/86400*755},${190-s.metrics[key]*1.6}`);}flush();}
 svg+='<text x="35" y="215" fill="#839087" font-size="11">24 小时前</text><text x="755" y="215" fill="#839087" font-size="11">现在</text>';$('#chart').innerHTML=svg;$('#history-note').textContent=samples.some(s=>s.metrics)?'采集失败处保留断点；历史保留 7 天，此处显示最近 24 小时。':'尚无成功的运行指标采样。';
 }catch(e){$('#history-note').textContent=e.message;}
}
$('#refresh').onclick=refresh;$('#search').oninput=render;$('#provider').onchange=render;$('#close').onclick=()=>{$('#detail').close();selected=null;};$('#auth').onclick=()=>$('#login').showModal();$('#login-cancel').onclick=()=>$('#login').close();$('#forget-token').onclick=()=>{saveToken('');token='';$('#token').value='';rows=[];render();$('#remember-token').checked=false;};$('#login-form').onsubmit=async e=>{e.preventDefault();token=$('#token').value.trim();const remember=$('#remember-token').checked;saveToken('');$('#token').value='';$('#login').close();if(await refresh()){if(remember)saveToken(token);}};refresh();setInterval(refresh,15000);
