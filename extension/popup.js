import {access} from './db.js';
import {collection,makeCard,web,addNext} from './model.js';
import {notify} from './ui.js';
const $=s=>document.querySelector(s);
const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
$('#title').textContent=tab?.title||'';
if(!web(tab?.url)){$('form').hidden=true;$('form').style.display='none';notify('Open a web page to save it.')}
else {
 const state=await access(),choices=new Map();
 const nameCounts=new Map();
 for(const c of state.collections)nameCounts.set(c.name,(nameCounts.get(c.name)||0)+1);
 for(const c of state.collections){
   const label=nameCounts.get(c.name)>1?c.name+' · '+c.id:c.name;
   choices.set(label,c.id);$('#groups').append(new Option(label));
 }
 $('#name').value=[...choices].find(([,id])=>id===state.recent)?.[0]||choices.keys().next().value||'';
 const copies=state.collections.filter(c=>c.cards.some(x=>x.url===tab.url));
 if(copies.length)$('#duplicates').textContent='Already saved in '+copies.map(c=>c.name).join(', ')+'.';
 $('#name').focus();$('#name').select();
 $('form').onsubmit=async e=>{e.preventDefault();try{
   const name=$('#name').value.trim();if(!name)return notify('Enter a collection name.');
   await access(s=>{
     let c=choices.has(name)?s.collections.find(x=>x.id===choices.get(name)):s.collections.find(x=>x.name===name);
     if(!c&&choices.has(name))throw Error('Collection removed. Reopen this panel.');
     if(!c){c=collection(name);s.collections.push(c)}
     let x=c.cards.find(x=>x.url===tab.url);
     if(!x){x=makeCard(tab.url,tab.title,'',tab.favIconUrl);c.cards.push(x);c.modified=Date.now()}
     x.tags=[...new Set([...(x.tags||[]),...$('#tags').value.split(',').map(t=>t.trim()).filter(Boolean)])];
     if($('#next').checked)addNext(s,[x.id]);s.recent=c.id;
   });window.close();
 }catch(err){notify(err.message)}};
}
