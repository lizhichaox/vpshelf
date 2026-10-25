'use strict';
(() => {
  const controls=[];
  function closeAll(except){controls.forEach(c=>{if(c!==except)c.close();});}
  for(const select of document.querySelectorAll('#language, #provider')){
    const wrapper=document.createElement('div');wrapper.className='select-control';
    select.parentNode.insertBefore(wrapper,select);wrapper.appendChild(select);select.hidden=true;
    const button=document.createElement('button');button.type='button';button.className='select-trigger';
    button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
    const label=document.createElement('span');button.appendChild(label);
    const list=document.createElement('div');list.className='select-menu';list.id=select.id+'-menu';list.hidden=true;list.setAttribute('role','listbox');
    button.setAttribute('aria-controls',list.id);wrapper.append(button,list);
    let active=0;
    const c={select,button,list,close(){list.hidden=true;button.setAttribute('aria-expanded','false');},refresh(){
      button.setAttribute('aria-label',select.getAttribute('aria-label')||'');
      list.setAttribute('aria-label',select.getAttribute('aria-label')||'');
      label.textContent=select.selectedOptions[0]?.textContent||'';
      [...list.children].forEach((option,i)=>{option.textContent=select.options[i].textContent;option.setAttribute('aria-selected',String(select.options[i].selected));});
    }};
    function focus(i){active=(i+select.options.length)%select.options.length;list.children[active]?.focus();}
    function open(last=false){closeAll(c);list.hidden=false;button.setAttribute('aria-expanded','true');focus(last?select.options.length-1:Math.max(0,select.selectedIndex));}
    for(const [i,option] of [...select.options].entries()){
      const item=document.createElement('button');item.type='button';item.className='select-option';item.setAttribute('role','option');item.tabIndex=-1;
      item.onclick=()=>{select.value=option.value;c.close();select.dispatchEvent(new Event('change',{bubbles:true}));c.refresh();button.focus();};
      item.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();focus(active+(e.key==='ArrowDown'?1:-1));}else if(e.key==='Home'||e.key==='End'){e.preventDefault();focus(e.key==='Home'?0:select.options.length-1);}else if(e.key==='Escape'){e.preventDefault();c.close();button.focus();}else if(e.key==='Tab')c.close();};
      list.appendChild(item);
    }
    button.onclick=()=>{if(list.hidden)open();else c.close();};
    button.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open(e.key==='ArrowUp');}else if(e.key==='Escape')c.close();};
    wrapper.addEventListener('focusout',e=>{if(!wrapper.contains(e.relatedTarget))c.close();});
    select.addEventListener('change',c.refresh);controls.push(c);c.refresh();
  }
  document.addEventListener('click',e=>{if(!e.target.closest('.select-control'))closeAll();});
  window.addEventListener('blur',()=>closeAll());
  window.refreshDropdowns=()=>controls.forEach(c=>c.refresh());
})();
