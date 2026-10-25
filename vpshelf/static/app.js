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
const date=n=>n?new Date(n*1000).toLocaleString(uiLocale()==='zh'?'zh-CN':'en-US'):'—';
const timestamp=value=>{if(!value)return t('厂商未提供');const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString(uiLocale()==='zh'?'zh-CN':'en-US');};
const status={pending:'等待采集',online:'SSH 在线',unreachable:'SSH 不可达',unknown:'未配置 SSH'};

const securityLabels={ok:'正常',warning:'注意',critical:'高风险',unknown:'未知'};
const securityRuleLabels={auth_logs:'认证日志覆盖',failed_logins:'失败登录：20 次/小时提醒，100 次/小时高风险',invalid_users:'无效用户：10 次/小时提醒',root_password_login:'近 24 小时 root 密码登录',untrusted_login:'近 24 小时非信任来源成功登录',sshd_config:'SSH 配置可读性',password_auth:'SSH 密码或交互认证开启',root_password_config:'全局配置允许 root 密码登录',empty_password:'SSH 空密码认证开启',reboot_required:'系统提示需要重启',collection_failed:'安全采集失败：检查 SSH 和读取权限'};
let activeDetailPanel='overview';
function setDetailPanel(panel){
 activeDetailPanel=panel;
 for(const name of ['overview','security']){
  const selected=name===panel;
  $('#'+name+'-panel').hidden=!selected;
  $('#detail-'+name+'-tab').setAttribute('aria-selected',String(selected));
  $('#detail-'+name+'-tab').tabIndex=selected?0:-1;
 }
}
function securityHtml(audit){
 if(!audit)return `<section class="security-report"><h3>${t('安全检查')}</h3><p>${t('尚未采集')}</p></section>`;
 return `<section class="security-report"><h3>${t('安全检查')} · ${t(securityLabels[audit.status]||'未知')}</h3><p>${t('检查时间')} ${date(audit.checked_at)} · ${t('默认每 15 分钟检查一次')}</p><p>${t('范围：SSH 登录日志与全局认证配置；不等同于漏洞扫描或入侵鉴定。')}</p>${audit.stale?`<p>${t('连接已中断，以下为历史结果')}</p>`:''}${(audit.rules||[]).map(r=>{
 const e=r.evidence||{};
 const state=r.level==='skipped'?'跳过':securityLabels[r.level]||'未知';
 const values=[e.count!=null?t('次数')+': '+e.count:'',e.password!=null?'PasswordAuthentication: '+(e.password?'yes':'no'):'',e.keyboard_interactive!=null?'KbdInteractiveAuthentication: '+(e.keyboard_interactive?'yes':'no'):'',e.permit_root_login?'PermitRootLogin: '+e.permit_root_login:'',e.truncated?t('日志超过 5000 条，结果可能不完整'):''].filter(Boolean).join(' · ');
 return `<div class="security-rule"><span class="security-badge security-${esc(r.level)}">${t(state)}</span><div><strong>${esc(t(securityRuleLabels[r.code]||r.code))}</strong><div class="sub">${esc(values)}</div>${e.recent?.length?`<details class="auth-events"><summary>${t("近期登录记录")} · ${e.recent.length}</summary><div class="auth-log">${e.recent.map(event=>`<div class="auth-event"><time>${esc(date(event.ts))}</time><span>${esc(event.user)} @ ${esc(event.ip)}</span><span>${esc(event.method||'')}</span></div>`).join('')}</div></details>`:''}</div></div>`;
 }).join('')}<p>${t('未配置 trusted_login_ips 时仅展示近期成功登录，不判断陌生来源。配置规则需结合 MFA 和云防火墙人工复核。')}</p></section>`;
}
async function api(path){const r=await fetch(path,{headers:token?{Authorization:'Bearer '+token}:{}});if(r.status===401){saveToken('');token='';if(!$('#login').open)$('#login').showModal();throw Error(t('需要访问密钥'));}if(!r.ok)throw Error(t('请求失败，请检查服务'));return r.json();}
function resourceCapacity(percent,total){
 if(!Number.isFinite(percent)||!Number.isFinite(total))return '—';
 return `<span class="resource-used">${bytes(total*percent/100)}</span><span class="resource-total"> / ${bytes(total)}</span>`;
}
function resourceGauge(percent){return `<span class="resource-gauge" aria-hidden="true">${bar(percent)}</span>`;}
function bar(n,color='#478b6c'){const v=Number.isFinite(n)?Math.max(0,Math.min(100,n)):0;return `<div class="bar"><svg viewBox="0 0 100 4" preserveAspectRatio="none"><rect width="${v}" height="4" fill="${color}"/></svg></div>`;}
function render(){
 const online=rows.filter(r=>r.status==='online').length;
 const warn=rows.filter(r=>r.errors?.length||['warning','critical','unknown'].includes(r.security?.status)||r.cloud?.bandwidth?.remaining_percent<20).length;
 const cpu=rows.filter(r=>r.metrics).map(r=>r.metrics.cpu);
 $('#summary').innerHTML=[[t('服务器总数'),rows.length,t('跨 ')+new Set(rows.map(r=>r.provider)).size+t(' 个服务商')],[t('SSH 在线'),online,t('已成功取得运行指标')],[t('平均 CPU'),cpu.length?pct(cpu.reduce((a,b)=>a+b,0)/cpu.length):'—',t('按最近成功采样计算')],[t('需要关注'),warn,t('安全提醒、采集异常或低流量')]].map(([a,b,c])=>`<div class="stat"><label>${a}</label><strong>${b}</strong><small>${c}</small></div>`).join('');
 const query=$('#search').value.trim().toLowerCase(), provider=$('#provider').value;
 const filtered=rows.filter(r=>(!provider||r.provider===provider)&&[r.name,r.region,r.host].join(' ').toLowerCase().includes(query));
 $('#count').textContent=`${filtered.length} / ${rows.length}`;
 $('#servers').innerHTML=filtered.length?filtered.map(r=>{
  const m=r.metrics,b=r.cloud?.bandwidth;const level=b?.remaining_percent<10?'critical':b?.remaining_percent<20?'warning':'';
  return `<article class="server" role="button" tabindex="0" data-id="${esc(r.id)}" aria-label="${esc(t('查看服务器详情'))}: ${esc(displayName(r))}"><div class="identity"><div class="provider">${esc(t(names[r.provider]))}</div><h3>${esc(displayName(r))}</h3><div class="sub" title="${esc(r.region||t('地区未设置'))} · ${esc(r.host||r.cloud?.ip||t('仅云 API'))}">${esc(r.region||t('地区未设置'))} · ${esc(r.host||r.cloud?.ip||t('仅云 API'))}</div>${r.errors?.length?`<div class="errors">${r.errors.map(e=>esc(t(e))).join('<br>')}</div>`:''}</div><div class="connection-status"><span class="status ${esc(r.status)}">${t(status[r.status]||'未知')}</span><span class="security-badge security-${esc(r.security?.status||'unknown')}" title="${esc(t('安全检查'))}">${t('安全')} · ${t(securityLabels[r.security?.status]||'未知')}</span></div><div class="resource-column"><div class="resource-line"><span class="resource-label">CPU</span><span class="resource-value">${m?.cores?esc(m.cores)+" vCPU":"—"}</span><strong>${pct(m?.cpu)}</strong>${resourceGauge(m?.cpu)}</div><div class="resource-line"><span class="resource-label">${t("内存")}</span><span class="resource-value">${resourceCapacity(m?.memory,m?.memory_total)}</span><strong>${pct(m?.memory)}</strong>${resourceGauge(m?.memory)}</div><div class="resource-line"><span class="resource-label">${t("磁盘 /")}</span><span class="resource-value">${resourceCapacity(m?.disk,m?.disk_total)}</span><strong>${pct(m?.disk)}</strong>${resourceGauge(m?.disk)}</div><div class="resource-line network-line"><span class="resource-label">${t("网络")}</span><span class="network-rates"><span><span class="rate-arrow">↓</span> ${bytes(m?.rx)}/s</span><span><span class="rate-arrow">↑</span> ${bytes(m?.tx)}/s</span></span></div></div><div class="traffic">${b?`<div class="sub">${t("周期剩余")} ${r.cloud_stale?t('· 数据过期'):''}</div><div class="remaining ${level}">${bytes(b.remaining)} <small>(${pct(b.remaining_percent)})</small></div>${bar(b.remaining_percent,level?'#c68a42':'#478b6c')}<div class="sub">${t("总额")} ${bytes(b.total)} · ${t("重置")} ${date(b.reset_at)}</div>`:`<div class="sub">${t("云实例状态")}</div><div class="metric">${esc(r.cloud?.state||'—')}</div><div class="sub">${esc(r.cloud?.plan||t('未提供周期流量额度'))}</div>`}</div></article>`;
 }).join(''):`<div class="empty">${rows.length?t('没有匹配的服务器。'):t('还没有服务器。<br>在 config.local.json 中添加服务器后重启服务。')}</div>`;
 $('#servers').querySelectorAll('.server[data-id]').forEach(row=>{
  row.onclick=()=>{if(!window.getSelection?.()?.toString())detail(row.dataset.id);};
  row.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();detail(row.dataset.id);}};
 });
}
async function refresh(){try{const data=await api('/api/servers');rows=data.servers;render();$('#updated').textContent=t('视图更新 ')+new Date().toLocaleTimeString(uiLocale()==='zh'?'zh-CN':'en-US');$('#error').hidden=true;return true;}catch(e){$('#error').textContent=e.message;$('#error').hidden=false;return false;}}
async function detail(id){
 if(selected!==id)setDetailPanel('overview');selected=id;const row=rows.find(r=>r.id===id);$('#detail-title').textContent=displayName(row);$('#detail-subtitle').textContent=[t(names[row.provider]),row.region,row.cloud?.ip||row.host].filter(Boolean).join(' · ');$('#security-details').innerHTML=securityHtml(row.security);$('#detail-security-status').textContent=t(securityLabels[row.security?.status]||'未知');$('#detail-security-status').className='security-badge security-'+(row.security?.status||'unknown');$('#details').textContent='';$('#chart').innerHTML='';$('#history-note').textContent=t('加载中…');if(!$('#detail').open)$('#detail').showModal();
 try{const samples=await api('/api/history?id='+encodeURIComponent(id));if(selected!==id)return;
 const m=row.metrics;$('#details').innerHTML=[[t('主机'),row.host||'—'],[t('云信息更新时间'),date(row.cloud_updated_at)],[t('运行指标采集时间'),date(row.checked_at)],[t('负载 1 / 5 / 15 分钟'),m?.load?.map(x=>x.toFixed(2)).join(' / ')||'—'],[t('CPU 核心'),m?.cores??'—'],[t('运行时间'),m?Math.floor(m.uptime/86400)+t(' 天'):'—'],[t('内存容量'),bytes(m?.memory_total)],[t('根磁盘容量'),bytes(m?.disk_total)],[t('实例到期时间'),timestamp(row.cloud?.expires_at)],[t('实例名称'),row.cloud?.instance_name||'—'],[t('可用区'),row.cloud?.zone||'—'],[t('系统镜像'),t(row.cloud?.blueprint||'—')],[t('公网 IPv4'),row.cloud?.ip||'—'],[t('私网 IPv4'),row.cloud?.private_ip||'—'],['IPv6',row.cloud?.ipv6?.join(', ')||'—'],[t('月套餐价格'),row.cloud?.monthly_price_usd!=null?'$'+row.cloud.monthly_price_usd:'—'],[t('套餐流量额度'),row.cloud?.transfer_gb!=null?row.cloud.transfer_gb+t(' GB / 月（非剩余额度）'):'—'],[t('CPU 突增余额'),pct(row.cloud?.burst_percent)],[t('公网带宽'),row.cloud?.bandwidth_mbps!=null?row.cloud.bandwidth_mbps+' Mbps':'—'],[t('实例计费方式'),row.cloud?.billing_type||'—'],[t('网络计费方式'),row.cloud?.network_billing_type||'—']].filter(([,value])=>value!=='—'&&value!==t('厂商未提供')).map(([a,b])=>`<div><span class="sub">${esc(a)}</span><br>${esc(b)}</div>`).join('');
 const end=Date.now()/1000,start=end-86400;let svg='';for(const y of [0,50,100])svg+=`<line x1="35" y1="${190-y*1.6}" x2="790" y2="${190-y*1.6}" stroke="#e1e8df"/><text x="3" y="${194-y*1.6}" font-size="11" fill="#839087">${y}</text>`;
 for(const [key,color] of [['cpu','#478b6c'],['memory','#919ec3']]){let part=[];const flush=()=>{if(part.length===1){const [x,y]=part[0].split(',');svg+=`<circle cx="${x}" cy="${y}" r="3" fill="${color}"/>`;}else if(part.length>1)svg+=`<polyline points="${part.join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`;part=[];};let previous=null;for(const s of samples){if(previous&&s.checked_at-previous>180)flush();previous=s.checked_at;if(!Number.isFinite(s.metrics?.[key])){flush();continue;}part.push(`${35+(s.checked_at-start)/86400*755},${190-s.metrics[key]*1.6}`);}flush();}
 svg+=t('<text x="35" y="215" fill="#839087" font-size="11">24 小时前</text><text x="755" y="215" fill="#839087" font-size="11">现在</text>');$('#chart').innerHTML=svg;$('#history-note').textContent=samples.some(s=>s.metrics)?t('采集失败处保留断点；历史保留 7 天，此处显示最近 24 小时。'):t('尚无成功的运行指标采样。');
 }catch(e){$('#history-note').textContent=e.message;}
}
for(const panel of ['overview','security']){
 const tab=$('#detail-'+panel+'-tab');
 tab.onclick=()=>setDetailPanel(panel);
 tab.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'overview':event.key==='End'?'security':activeDetailPanel==='overview'?'security':'overview';setDetailPanel(next);$('#detail-'+next+'-tab').focus();}};
}
$('#detail').addEventListener('close',()=>{selected=null;});
$('#refresh').onclick=refresh;$('#search').oninput=render;$('#provider').onchange=render;$('#close').onclick=()=>{$('#detail').close();selected=null;};$('#auth').onclick=()=>$('#login').showModal();$('#login-cancel').onclick=()=>$('#login').close();$('#forget-token').onclick=()=>{saveToken('');token='';$('#token').value='';rows=[];render();$('#remember-token').checked=false;};$('#login-form').onsubmit=async e=>{e.preventDefault();token=$('#token').value.trim();const remember=$('#remember-token').checked;saveToken('');$('#token').value='';$('#login').close();if(await refresh()){if(remember)saveToken(token);}};refresh();setInterval(refresh,15000);

$('#language').value=languageChoice;
$('#language').onchange=()=>{languageChoice=$('#language').value;try{localStorage.setItem(UI_LANG_KEY,languageChoice);}catch{}translateStatic();render();if(selected)detail(selected);refresh();};
window.addEventListener('languagechange',()=>{if(languageChoice==='auto'){translateStatic();render();if(selected)detail(selected);}});
translateStatic();
