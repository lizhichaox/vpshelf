const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let focused,changed=0;
class Element{
 constructor(){this.children=[];this.attrs={};this.events={};this.hidden=false;this.textContent='';}
 appendChild(e){this.children.push(e);e.parentNode=this;return e}append(...es){es.forEach(e=>this.appendChild(e))}
 insertBefore(e){return this.appendChild(e)}setAttribute(k,v){this.attrs[k]=v}getAttribute(k){return this.attrs[k]}
 addEventListener(k,f){this.events[k]=f}focus(){focused=this}contains(e){return e===this||this.children.includes(e)}
}
const parent=new Element(),select=new Element();select.id='language';select.options=[{textContent:'Auto',value:'auto',selected:true},{textContent:'中文',value:'zh'},{textContent:'English',value:'en'}];select.selectedIndex=0;select.value='auto';select.selectedOptions=[select.options[0]];select.parentNode=parent;select.setAttribute('aria-label','Language');
select.dispatchEvent=()=>{changed++;select.selectedIndex=select.options.findIndex(o=>o.value===select.value);select.options.forEach((o,i)=>o.selected=i===select.selectedIndex);select.selectedOptions=[select.options[select.selectedIndex]];select.events.change?.()};
const doc={createElement:()=>new Element(),querySelectorAll:()=>[select],addEventListener(){}};const win={addEventListener(){}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../vpshelf/static/dropdowns.js'),'utf8'),{document:doc,window:win,Event:class{}});
const wrapper=parent.children[0],button=wrapper.children[1],list=wrapper.children[2];
assert.equal(select.hidden,true);assert.equal(button.children[0].textContent,'Auto');button.onclick();assert.equal(list.hidden,false);assert.equal(focused,list.children[0]);
list.children[0].onkeydown({key:'ArrowDown',preventDefault(){}});assert.equal(focused,list.children[1]);list.children[1].onclick();assert.equal(select.value,'zh');assert.equal(changed,1);assert.equal(list.hidden,true);assert.equal(button.children[0].textContent,'中文');
button.onclick();list.children[1].onkeydown({key:'Escape',preventDefault(){}});assert.equal(list.hidden,true);assert.equal(focused,button);
select.options[0].textContent='自动';win.refreshDropdowns();assert.equal(list.children[0].textContent,'自动');console.log('PASS: dropdown keyboard selection, Escape, native change and translated labels');
