const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'../vpshelf/static');
function setup(languages,choice){
 const nodes=new Map();const storage=new Map(choice?[['vpshelf.language',choice]]:[]);
 const el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',checked:true,open:false,handlers:{},addEventListener(k,f){this.handlers[k]=f},querySelectorAll(){return []},showModal(){this.open=true},close(){this.open=false;this.handlers.close?.()}});return nodes.get(id)};
 const row={id:'example',name:'客户自定义名称',provider:'bandwagon',status:'online',region:'LA',host:'node',errors:[],metrics:{cpu:12,cores:2,memory:35,memory_total:2147483648,disk:40,disk_total:21474836480,rx:10,tx:20},cloud_stale:true,cloud:{bandwidth:{remaining:50,total:100,remaining_percent:50,reset_at:123}}};
 const ctx=vm.createContext({document:{documentElement:{},querySelector:el,querySelectorAll:()=>[]},navigator:{languages},window:{addEventListener(){}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:async()=>({ok:true,status:200,json:async()=>({servers:[row]})}),setInterval(){},console});
 for(const file of ['i18n.js','app.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
 return {ctx,el,storage};
}
(async()=>{
 const a=setup(['en-US','zh-CN']);await new Promise(setImmediate);
 assert.equal(vm.runInContext('uiLocale()',a.ctx),'en');assert.match(a.el('#summary').innerHTML,/Total servers/);
 assert.match(a.el('#servers').innerHTML,/Security/);
 assert.match(a.el('#servers').innerHTML,/Memory/);
 assert.match(a.el('#servers').innerHTML,/2 vCPU/);
 assert.equal((a.el('#servers').innerHTML.match(/class="resource-line"/g)||[]).length,3);
 assert.match(a.el('#servers').innerHTML,/class="network-column"/);
 assert.match(a.el('#servers').innerHTML,/8.0 GiB \/ 20.0 GiB/);
 assert.match(a.el('#servers').innerHTML,/716.8 MiB \/ 2.0 GiB/);assert.match(a.el('#servers').innerHTML,/Stale data/);
assert.doesNotMatch(a.el('#servers').innerHTML,/t\('/);
 assert.match(a.el('#servers').innerHTML,/客户自定义名称/);
 vm.runInContext("rows[0].name='<img src=x onerror=alert(1)>';render()",a.ctx);
 assert.doesNotMatch(a.el('#servers').innerHTML,/<img/);assert.match(a.el('#servers').innerHTML,/&lt;img/);
 vm.runInContext("selected='example'",a.ctx);a.el('#detail').close();assert.equal(vm.runInContext('selected',a.ctx),null);
 assert.equal(vm.runInContext("displayName({name:'Lightsail · 新加坡'})",a.ctx),'Lightsail · Singapore');
 assert.equal(vm.runInContext("displayName({name:'CSTEIX-web · 北京'})",a.ctx),'CSTEIX-web · Beijing');
 assert.equal(vm.runInContext("t('自动 / Auto')",a.ctx),'Auto');
 a.el('#language').value='zh';a.el('#language').onchange();await new Promise(setImmediate);
 assert.match(a.el('#summary').innerHTML,/服务器总数/);assert.equal(a.storage.get('vpshelf.language'),'zh');
 const b=setup(['en-US'],'zh');assert.equal(vm.runInContext('uiLocale()',b.ctx),'zh');
 const c=setup(['zh-TW','en-US']);assert.equal(vm.runInContext('uiLocale()',c.ctx),'zh');
 console.log('PASS: browser language, persisted override, live switching, rendering and user names');
})();
