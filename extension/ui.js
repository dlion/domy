export function el(tag,text='',cls='') {
  const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;
}
export function btn(label,fn,cls=''){
  const n=el('button',label,cls);n.type='button';n.onclick=()=>Promise.resolve().then(fn).catch(e=>notify(e.message));return n;
}
export function select(options,value) {
  const n=el('select');options.forEach(([v,t])=>n.add(new Option(t,v)));n.value=value;return n;
}
export function input(placeholder,value=''){
  const n=el('input');n.placeholder=placeholder;n.setAttribute('aria-label',placeholder);n.value=value;return n;
}
let timer;
export function notify(msg){const o=document.querySelector('output');o.textContent=msg;clearTimeout(timer);timer=setTimeout(()=>o.textContent='',6500)}
export function ask(title,...fields){
  const d=document.querySelector('#editor');d.querySelector('h2').textContent=title;
  d.querySelector('#fields').replaceChildren(...fields);d.querySelector('button[value=ok]').textContent=/Delete this|Empty Trash/.test(title)?'Delete permanently':/Import/.test(title)?'Import':/Open /.test(title)?'Open':/Replace/.test(title)?'Restore':/^Move /.test(title)?'Move':'Save';d.returnValue='cancel';d.showModal();d.querySelector('#cancel').onclick=()=>d.close('cancel');
  return new Promise(resolve=>d.addEventListener('close',()=>resolve(d.returnValue==='ok'),{once:true}));
}
