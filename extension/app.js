import {access,onUpdate} from './db.js';
import {collection,makeCard,convertToby,validate,matches,web,tabTags,byUrl,moveCards,addNext,normalizeWorkspace,completeNext} from './model.js';
import {el,btn,select,input,notify,ask} from './ui.js';
const $=s=>document.querySelector(s);
const names={home:'Collections',next:'Next',dups:'Duplicates',trash:'Trash'};
let state,page='home',query='',color='',tag='',fileMode,tabs=[],chosen=new Set();
let selecting=false, focusedCollection='', searchScope='tabs';
let queuedUrls=new Set();
const locate=(s,id)=>s.collections.find(c=>c.id===id);
const owner=(s,id)=>s.collections.find(c=>c.cards.some(x=>x.id===id));
const count=s=>s.collections.reduce((n,c)=>n+c.cards.length,0);
const domain=url=>{try{return new URL(url).hostname||url}catch{return url}};
const bar=(...nodes)=>{const b=el('div','','bar');b.append(...nodes);return b};
const requireValue=(v,msg)=>{if(!v)throw Error(msg);return v};
async function change(fn){state=await access(fn);render()}
async function refresh(){state=await access();render()}
function nav(p){filterFolds.clear();focusedCollection='';page=p;selecting=false;query='';tag='';color='';chosen.clear();render()}
function pick(options,value,label,fn){
  const n=select(options,value);n.setAttribute('aria-label',label);n.title=label;n.onchange=()=>Promise.resolve(fn(n.value)).catch(e=>notify(e.message));return n;
}
async function destination(title,groups=state.collections){
  const sel=select([...groups.map(c=>[c.id,c.name]),['new','＋ New collection']],groups.find(c=>c.id===state.recent)?.id||groups[0]?.id||'new');
  const name=input('New collection name');const update=()=>{name.hidden=sel.value!=='new';name.required=!name.hidden};sel.onchange=update;update();
  if(!await ask(title,sel,name))return;
  return s=>{
    const c=sel.value==='new'?collection(requireValue(name.value.trim(),'Enter a collection name.')):requireValue(locate(s,sel.value),'Collection was removed.');
    if(sel.value==='new')s.collections.push(c);s.recent=c.id;return c;
  };
}
async function saveTabs(items,close=false,target=null,tags=[]){
  if(!items.length)return notify('No web pages to save.');
  const dest=target?s=>requireValue(locate(s,target),'Collection was removed.'):await destination(close?'Save '+items.length+' tabs and close unpinned tabs':'Save '+items.length+' tabs');if(!dest)return;
  let added=0;
  await change(s=>{const c=dest(s);c.collapsed=false;s.recent=c.id;const urls=new Set(c.cards.map(x=>x.url));for(const t of items){if(!urls.has(t.url)){urls.add(t.url);c.cards.push({...makeCard(t.url,t.title,'',t.favIconUrl),tags:[...tags]});added++}}c.modified=Date.now()});
  let closed=0;
  if(close)for(const t of items.filter(t=>!t.pinned)){
    const current=await chrome.tabs.get(t.id).catch(()=>null);
    if(current?.url===t.url&&!current.pendingUrl&&!current.pinned&&current.windowId===t.windowId){try{await chrome.tabs.remove(t.id);closed++}catch(error){if(await chrome.tabs.get(t.id).catch(()=>null))throw error}}
  }
  notify('Saved '+added+' · already saved '+(items.length-added)+(close?' · closed '+closed:''));
}
async function move(ids){
  const candidates=state.collections.filter(c=>!c.cards.some(x=>ids.has(x.id)));
  const dest=await destination('Move to collection',candidates);if(!dest)return;
  let result,target;
  await change(s=>{target=dest(s);result=moveCards(s,ids,target);chosen.clear();selecting=false});
  if(result.moved&&!candidates.some(c=>c.id===target.id))await jump(target.id);
  notify(result.moved+' moved'+(result.skipped?' · '+result.skipped+' already saved in destination':''));
}
async function enqueue(ids){
  let added;await change(s=>{added=addNext(s,ids)});
  notify(added?'Added to Next':'Already in Next');
}
async function discard(ids,group=false){await change(s=>{
  const removed=new Set(ids);
  if(group){s.collections=s.collections.filter((c,i)=>{if(!ids.has(c.id))return true;s.trash.push({kind:'group',value:c,index:i});c.cards.forEach(x=>removed.add(x.id));return false})}
  else for(const c of s.collections)c.cards=c.cards.filter((x,i)=>{if(!ids.has(x.id))return true;s.trash.push({kind:'card',value:x,parent:c.id,parentName:c.name,index:i});c.modified=Date.now();return false});
  if(s.next.some(id=>removed.has(id))){
    const removedUrls=new Map(), replacements=new Map();
    for(const entry of s.trash){
      const cards=entry.kind==='card'?[entry.value]:entry.value.cards;
      for(const card of cards)if(removed.has(card.id))removedUrls.set(card.id,card.url);
    }
    for(const c of s.collections)for(const x of c.cards){
      if(!replacements.has(x.url))replacements.set(x.url,x.id);
    }
    s.next=s.next.map(id=>removed.has(id)?replacements.get(removedUrls.get(id)):id).filter(Boolean);
  }
  chosen.clear();
})}
async function restoreItem(id){await change(s=>{
  const i=s.trash.findIndex(t=>t.value.id===id);if(i<0)return;
  const t=s.trash[i];if(t.kind==='group')s.collections.splice(t.index,0,t.value);
  else{let c=locate(s,t.parent);if(!c){const j=s.trash.findIndex(x=>x.kind==='group'&&x.value.id===t.parent);
    if(j>=0){const g=s.trash[j];c=g.value;s.collections.splice(g.index,0,c);s.trash.splice(j,1)}else{c=collection(t.parentName||'Recovered');c.id=t.parent;s.collections.push(c)}}if(c.cards.some(x=>x.url===t.value.url))throw Error('This URL is already in the collection.');c.cards.splice(t.index,0,t.value)}
  s.trash=s.trash.filter(x=>x.value.id!==id);
})}
async function openCards(items){
  const valid=items.filter(x=>web(x.url));if(!valid.length)return notify('No web links to open.');
  if(valid.length>12&&!await ask('Open '+valid.length+' tabs?',el('p','These pages will open in this window.')))return;
  const active=(await chrome.tabs.query({active:true,currentWindow:true}))[0];
  for(const [i,x] of valid.entries())await chrome.tabs.create({url:x.url,active:valid.length===1,index:active.index+i+1});
}
function actions(entries,label='Collection actions'){const d=el('details');const sm=el('summary','•••');sm.setAttribute('aria-label',label);const box=el('div','','actions');
  for(const [name,fn] of entries)box.append(btn(name,()=>{d.open=false;return fn()}));d.append(sm,box);return d}
const colors=[['','Indigo','#6669c7'],['Verde','Sage','#75937a'],['Blu','Ocean','#4276ac'],['Ambra','Ochre','#ad732e'],['Rosa','Rose','#b65a7a'],['Red','Red','#c54d4d']];
const tint=c=>(colors.find(([key])=>key===c.color)||colors[0])[2];
function labeled(label,node){const wrap=el('label',label,'field');wrap.append(node);return wrap}
async function edit(c=null){
  const name=input('Collection name',c?.name||'');name.required=true;
  let selected=c?.color||'';
  const swatches=bar();
  for(const [key,label,hex] of colors){
    const swatch=btn('',()=>{selected=key;for(const b of swatches.children)b.setAttribute('aria-pressed',String(b===swatch))},'swatch');
    swatch.style.setProperty('--swatch',hex);swatch.title=label;swatch.setAttribute('aria-label',label);swatch.setAttribute('aria-pressed',String(key===selected));swatches.append(swatch);
  }
  if(!await ask(c?'Edit collection':'New collection',labeled('Name',name),labeled('Collection color',swatches)))return;
  const title=requireValue(name.value.trim(),'Enter a collection name.');
  const target=c||collection(title);
  await change(s=>{const g=c?requireValue(locate(s,c.id),'Collection removed.'):target;
    Object.assign(g,{name:title,color:selected,modified:Date.now()});
    if(!c){s.collections.unshift(g);s.recent=g.id;page='home';color=tag='';chosen.clear();selecting=false}
  });
  if(!c){
    nav('home');
    const node=document.getElementById('group-'+target.id);
    node?.scrollIntoView({block:'nearest'});
    node?.querySelector('.groupname')?.focus({preventScroll:true});
  }
}
const newGroup=()=>edit();
async function jump(id){
  const c=locate(state,id);
  if(!c)return notify('Collection was removed.');
  page='home';focusedCollection=id;query=color=tag='';selecting=false;chosen.clear();
  if(c.collapsed)await change(s=>{const g=locate(s,id);if(g)g.collapsed=false});
  else render();
  window.scrollTo({top:0});
  document.querySelector('.groupname')?.focus({preventScroll:true});
}
function favicon(url,saved=''){
  const box=el('span',domain(url).replace(/^www\./,'').slice(0,1).toUpperCase(),'favicon');
  if(!web(url))return box;
  const cached=new URL(chrome.runtime.getURL('/_favicon/'));
  cached.searchParams.set('pageUrl',url);cached.searchParams.set('size','32');
  const sources=[];
  if(/^data:image\/(?:png|gif|webp|jpeg|x-icon|vnd.microsoft.icon)[;,]/i.test(saved)||/^https:\/\//i.test(saved))sources.push(saved);
  sources.push(cached.href);
  const img=el('img');img.alt='';img.loading='lazy';img.draggable=false;img.referrerPolicy='no-referrer';
  img.onerror=()=>{if(sources.length)img.src=sources.shift();else img.remove()};
  // Lazy images need a mounted box before Brave will schedule the request.
  box.append(img);img.onload=()=>{box.replaceChildren(img)};img.src=sources.shift();
  return box;
}
function draggable(node,type,value){
  node.draggable=true;node.ondragstart=e=>{if(type==='saved'&&node.closest){const entry=node.closest('.entry');if(entry)e.dataTransfer.setDragImage(entry,12,12)}e.dataTransfer.setData('application/x-schedario-'+type,String(value));e.dataTransfer.effectAllowed=type==='open'?'copy':'move';document.body.classList.add('dragging')};
  node.ondragend=()=>{document.body.classList.remove('dragging');document.querySelectorAll('.over').forEach(n=>n.classList.remove('over'))};
}
function dropTarget(node,c){
  const prefix='application/x-schedario-';
  node.ondragover=e=>{if([...e.dataTransfer.types].some(t=>t===prefix+'open'||t===prefix+'saved')){e.preventDefault();node.classList.add('over')}};
  node.ondragleave=e=>{if(!node.contains(e.relatedTarget))node.classList.remove('over')};
  node.ondrop=async e=>{e.preventDefault();node.classList.remove('over');try{
    const live=e.dataTransfer.getData(prefix+'open'),id=e.dataTransfer.getData(prefix+'saved');
    if(live){const t=tabs.find(t=>t.id===Number(live));if(t)await saveTabs([t],false,c.id);return}
    if(!id)return;
    let result;
    await change(s=>{const to=locate(s,c.id);if(to)result=moveCards(s,new Set([id]),to)});
    if(result?.skipped)notify('Already saved in this collection.');

  }catch(error){notify(error.message)}};
}
function tagEditor(existing=[],group){
  const field=input('Tags, separated by commas',existing.join(', '));
  const chips=bar();chips.classList.add('tag-options');if(group)chips.style.setProperty('--tint',tint(group));
  const read=()=>[...new Set(field.value.split(',').map(t=>t.trim()).filter(Boolean))];
  for(const t of new Set([...tabTags(state),...(state.tagSuggestions||[])]))
    chips.append(btn(t,()=>{field.value=[...new Set([...read(),t])].join(', ')},'chip'));
  return {fields:[labeled('Tab tags',field),chips],read};
}
async function editTags(x){
  const editor=tagEditor(x.tags,owner(state,x.id));
  if(await ask('Edit tab tags',el('p',x.title),...editor.fields))await change(s=>{
    const g=owner(s,x.id),card=g?.cards.find(v=>v.id===x.id);
    if(card){card.tags=editor.read();g.modified=Date.now()}
  });
}
function filterTag(value){nav('home');tag=value;render()}
function visibleCards(c){
  if(!query&&!tag)return c.cards;
  return c.cards.filter(x=>(!tag||x.tags?.includes(tag))&&(!query||matches(c.name,'',query)||matches(x.title,x.url,query)));
}
function bookmarkTags(tags, limit){
  const group=el('div','','bookmark-tags');
  function filterButton(tag){
    const control=btn(tag,()=>filterTag(tag),'bookmark-tag');
    control.setAttribute('aria-label','Filter by '+tag);
    control.title=tag;
    return control;
  }
  for(const tag of tags.slice(0,limit))group.append(filterButton(tag));
  const rest=tags.slice(limit);
  if(rest.length){
    const overflow=actions(rest.map(tag=>[tag,()=>filterTag(tag)]),'Show '+rest.length+' more tags');
    overflow.className='tag-overflow';
    overflow.querySelector('summary').textContent='+'+rest.length;
    group.append(overflow);
  }
  return group;
}
function row(x,c){
  const r=el('div','','entry');
  const grip=el('span','⠿','move-grip');
  grip.title='Drag to another collection';
  grip.setAttribute('aria-label','Drag to another collection');
  draggable(grip,'saved',x.id);
  r.append(grip);
  const link=btn(x.title,()=>selecting?toggle():openCards([x]),'bookmark-title');
  link.title=x.title+'\n'+x.url;
  const site=el('span','','bookmark-site');
  site.append(favicon(x.url,x.icon),el('span',domain(x.url),'hostname'));
  r.append(link,site);
  if(state.view==='card'&&x.note?.trim())r.append(el('p',x.note,'bookmark-note'));
  if(x.tags?.length)r.append(bookmarkTags(x.tags,state.view==='card'?2:1));
  function toggle(){
    if(chosen.has(x.id))chosen.delete(x.id);else chosen.add(x.id);
    link.setAttribute('aria-pressed',String(chosen.has(x.id)));
    r.classList.toggle('selected',chosen.has(x.id));
    bulkTools();
  }
  if(selecting){
    r.classList.toggle('selected',chosen.has(x.id));
    link.setAttribute('aria-pressed',String(chosen.has(x.id)));
  }else{
    const queued=queuedUrls.has(x.url);
    const quick=btn(queued?'✓ Next':'+ Next',()=>enqueue([x.id]),'queue-action');
    quick.disabled=queued;quick.setAttribute('aria-label',queued?'Already in Next':'Add to Next');quick.title=queued?'Already in Next':'Add to Next';
    const menu=actions([['Edit tags',()=>editTags(x)],['Move to…',()=>move(new Set([x.id]))],['Move to Trash',()=>discard(new Set([x.id]))]],'Tab actions');
    menu.className='bookmark-menu';const controls=el('div','','bookmark-controls');controls.append(quick,menu);r.append(controls);
  }
  return r;
}
function bulkTools(){
  const b=$('#bulk');if(!b)return;b.replaceChildren();b.hidden=!selecting;
  if(!selecting)return;
  b.append(el('strong',chosen.size+' selected'));
  if(chosen.size){const ids=new Set(chosen);b.append(btn('Move…',()=>move(ids)),btn('Add to Next',()=>enqueue(ids)),btn('Open',()=>openCards(state.collections.flatMap(c=>c.cards).filter(x=>ids.has(x.id)))),btn('Trash',()=>discard(ids)))}
  b.append(btn('Done',()=>{selecting=false;chosen.clear();render()}));
}

function sortedGroups(){const a=state.collections.slice();const cmp={alpha:(a,b)=>a.name.localeCompare(b.name),modified:(a,b)=>b.modified-a.modified,created:(a,b)=>b.created-a.created,star:(a,b)=>Number(b.star)-Number(a.star)}[state.sort];return cmp?a.sort(cmp):a}
function shift(array,index,step){if(index<0||index+step<0||index+step>=array.length)return;const [v]=array.splice(index,1);array.splice(index+step,0,v)}
const shown=new Map();
const filterFolds=new Map();
function drawShortcuts(){
 const list=$('#shortcuts');list.replaceChildren();
 for(const c of sortedGroups()){const b=btn(c.name,()=>jump(c.id),'shortcut');b.style.setProperty('--tint',tint(c));dropTarget(b,c);list.append(b)}
}
async function addTo(c){
 const seen=new Set(c.cards.map(x=>x.url));
 const eligible=tabs.filter(t=>{if(seen.has(t.url))return false;seen.add(t.url);return true});
 const choices=select([['url','Paste a link'],...eligible.map(t=>[String(t.id),t.title||domain(t.url)])],eligible.length?String(eligible[0].id):'url');
 const editor=tagEditor([],c);
 const url=input('https://…'),name=input('Optional title');
 const sync=()=>{url.hidden=name.hidden=choices.value!=='url';url.required=!url.hidden};choices.onchange=sync;sync();
 if(!await ask('Add to '+c.name,labeled('Open tab or link',choices),url,name,...editor.fields))return;
 if(choices.value!=='url'){const t=tabs.find(x=>x.id===Number(choices.value));if(!t)throw Error('This tab has closed.');return saveTabs([t],false,c.id,editor.read())}
 const address=url.value.trim();if(!web(address))throw Error('Enter an HTTP or HTTPS link.');
 await saveTabs([{url:address,title:name.value.trim()||domain(address)}],false,c.id,editor.read());
}
function groupView(c){
 const a=el('article','','collection');a.id='group-'+c.id;a.style.setProperty('--tint',tint(c));dropTarget(a,c);
 const filtered=Boolean(query||tag);
 const expanded=filtered?!filterFolds.get(c.id):!c.collapsed;
 const title=btn(c.name,()=>{
   if(filtered){filterFolds.set(c.id,expanded);render();return}
   return change(s=>{const g=locate(s,c.id);if(g)g.collapsed=!g.collapsed});
 },'groupname');
 title.setAttribute('aria-expanded',String(expanded));
 title.title=(expanded?'Collapse ':'Expand ')+c.name;
 const heading=bar(title,el('span',String(c.cards.length),'count'));heading.classList.add('group-title');
 const tools=bar(btn('+ Add tab',()=>addTo(c),'addtab'),actions([
  [c.star?'Remove star':'Star collection',()=>change(s=>{const g=locate(s,c.id);if(g)g.star=!g.star})],
  ['Edit collection',()=>edit(c)],['Open all tabs',()=>openCards(c.cards)],
  ...[-1,1].map(step=>[step<0?'Move up':'Move down',()=>change(s=>{s.sort='manual';shift(s.collections,s.collections.findIndex(x=>x.id===c.id),step)})]),
  ['Move to Trash',()=>discard(new Set([c.id]),true)]
 ]));
 if(c.star)heading.append(el('span','★','star'));
 const top=el('div','','group-head');top.append(heading,tools);a.append(top);
 if(!expanded)return a;
 if(!c.cards.length){const empty=el('div','','dropzone');empty.append(el('span','↳','dropicon'),el('strong','Drop an open tab here'),btn('Choose a tab or paste a link',()=>addTo(c),'text-btn'));a.append(empty);return a}
 const list=el('div','','items '+state.view),limit=shown.get(c.id)||24;
 const visible=visibleCards(c);
 visible.slice(0,limit).forEach(x=>list.append(row(x,c)));a.append(list);
 if(visible.length>limit)a.append(btn('Show more · '+(visible.length-limit)+' remaining',()=>{shown.set(c.id,limit+48);render()},'more'));
 return a;
}
function home(){
 const tools=$('#tools'),content=$('#content');
 if(focusedCollection)tools.append(btn('← All collections',()=>nav('home'),'quiet'));
 const filters=el('details','','filters'),summary=el('summary',tag||color?'Filter •':'Filter'),panel=el('div','','filter-panel');
 const update=(type,value)=>{if(type==='color')color=value;else tag=value;chosen.clear();render()};
 panel.append(labeled('Color',pick([['','All colors'],['indigo','Indigo'],...colors.slice(1).map(([k,v])=>[k,v])],color,'Filter by color',v=>update('color',v))),labeled('Tag',pick([['','All tags'],...tabTags(state).map(t=>[t,t])],tag,'Filter by tag',v=>update('tag',v))));
 filters.append(summary,panel);
 const toolbar=bar(pick([['grid','Grid'],['card','Cards'],['list','List'],['compact','Compact']],state.view,'Layout',v=>change(s=>s.view=v)),pick([['manual','Custom order'],['modified','Last modified'],['alpha','Alphabetical'],['star','Starred first'],['created','Date created']],state.sort,'Sort collections',v=>change(s=>s.sort=v)),filters);
 toolbar.classList.add('toolbar');if(!selecting)toolbar.append(btn('Select tabs',()=>{selecting=true;chosen.clear();render()},'selection'));
 if(tag||color)toolbar.append(btn('Clear filters ×',()=>{tag=color='';render()},'chip'));tools.append(toolbar);
 const bulk=bar();bulk.id='bulk';tools.append(bulk);bulkTools();
 if(query)toolbar.append(btn('Search: '+query+' ×',()=>{query='';chosen.clear();render()},'chip'));
 for(const c of sortedGroups()){
  if(focusedCollection&&c.id!==focusedCollection)continue;
  if(color&&(c.color||'indigo')!==color)continue;
  if((tag||query)&&!visibleCards(c).length&&(tag||!matches(c.name,'',query)))continue;
  content.append(groupView(c));
 }
 if(!content.children.length){const empty=el('div','','welcome');empty.append(el('h2',state.collections.length?'No matching collections':'Create your first collection'),el('p',state.collections.length?'Try another filter.':'Group tabs for a trip, a project, or your next read.'));if(!state.collections.length)empty.append(btn('＋ New collection',newGroup,'primary'));content.append(empty)}
}

function render(){
 if(focusedCollection&&!locate(state,focusedCollection))focusedCollection='';
 const queuedIds=new Set(state.next);
 queuedUrls=new Set(state.collections.flatMap(c=>c.cards.filter(x=>queuedIds.has(x.id)).map(x=>x.url)));
 $('#create').hidden=page!=='home';
 $('#heading').textContent=names[page];$('#counts').textContent=state.collections.length+' collections · '+count(state)+' saved tabs';
 $('#nav').replaceChildren(...Object.entries(names).map(([k,v])=>btn(v,()=>nav(k),page===k?'active':'')));
 if(focusedCollection&&page==='home'){const c=locate(state,focusedCollection);$('#heading').textContent=c.name;$('#counts').textContent=c.cards.length+' saved tabs'}
 drawShortcuts();
 const tagNav=$('#tag-nav'),tags=tabTags(state);tagNav.replaceChildren();
 if(tags.length){tagNav.append(el('div','Tags','side-label'));for(const t of tags)tagNav.append(btn('# '+t,()=>filterTag(t),'shortcut tag-shortcut'))}
 const out=$('#content');out.replaceChildren();$('#tools').replaceChildren();
 if(page==='home')return home();
 if(page==='next')renderNext(out);
 if(page==='dups')renderDuplicates(out);
 if(page==='trash')renderTrash(out);
 if(!out.children.length)out.append(el('p',{next:'Add a saved link to Next.',dups:'No duplicate URLs in your collections.',trash:'Trash is empty.'}[page],'empty'));
}
function itemLine(title,detail,icon,...buttons){
 const line=el('div','','item-line'),label=el('div','','item-label');
 label.append(el('strong',title),el('span',detail,'meta'));
 line.append(icon,label,...buttons);return line;
}
function sectionHeading(title,n){const h=el('h2',title,'section-heading');h.append(el('span',String(n),'count'));return h}
function renderNext(out){
 const history=state.completed||[];
 const links=new Map();
 if(state.next.length)for(const c of state.collections)for(const x of c.cards)links.set(x.id,{c,x});
 const dates=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'});
 $('#counts').textContent=state.next.length+' in queue · '+history.length+' completed';
 out.append(sectionHeading('Up next',state.next.length));
 if(!state.next.length)out.append(el('p','Your queue is clear. Add a saved link to Next.','empty'));
 for(const id of state.next){
   const item=links.get(id);if(!item)continue;
   const {c,x}=item;
   const line=itemLine(x.title,c.name+' · '+domain(x.url),favicon(x.url,x.icon),
     btn('Open',()=>openCards([x]),'quiet'),
     actions([[-1,'Move up'],[1,'Move down']].map(([step,name])=>[name,()=>change(s=>shift(s.next,s.next.indexOf(id),step))]),'Queue order'),
     btn('✓ Done',async()=>{await change(s=>completeNext(s,id));notify('Moved to Completed.')},'finish'));
   out.append(line);
 }
 if(history.length){out.append(sectionHeading('Completed',history.length));for(const h of history){
   const date=dates.format(h.at);
   out.append(itemLine(h.title,date+' · '+h.source,el('span','✓','complete-icon'),
     ...(web(h.url)?[btn('Open',()=>openCards([h]),'quiet')]:[])));
 }}
}
function trashCopyButton(c,x){
 const b=btn('🗑',()=>discard(new Set([x.id])),'trash-copy-icon');
 b.title='Move copy from '+c.name+' to Trash';
 b.setAttribute('aria-label',b.title);
 return b;
}
function renderDuplicates(out){
 const sets=[...byUrl(state.collections)].filter(([,copies])=>copies.length>1);
 $('#counts').textContent=sets.length+' repeated '+(sets.length===1?'URL':'URLs');
 for(const [url,copies] of sets){
   const block=el('article','','dupe-block');
   block.append(itemLine(copies[0].x.title,url,favicon(url,copies[0].x.icon),el('span',copies.length+' copies','count')));
   for(const {c,x} of copies){
     const dot=el('i','','dot');dot.style.setProperty('--tint',tint(c));
     block.append(itemLine(c.name,x.title,dot,trashCopyButton(c,x)));
   }
   out.append(block);
 }
}
async function purge(ids){
 const n=ids.size;
 if(!await ask(n===1?'Delete this item permanently?':'Empty Trash?',el('p','Permanently delete '+n+' trashed '+(n===1?'item':'items')+'? This cannot be undone.')))return;
 await change(s=>{s.trash=s.trash.filter(t=>!ids.has(t.value.id))});
}
function renderTrash(out){
 $('#counts').textContent=state.trash.length+' items in Trash';
 if(state.trash.length)$('#tools').append(btn('Empty Trash ('+state.trash.length+')…',()=>purge(new Set(state.trash.map(t=>t.value.id))),'danger-link'));
 for(const t of [...state.trash].reverse()){
   const g=t.kind==='group',v=t.value;
   out.append(itemLine(g?v.name:v.title,g?'Collection · '+v.cards.length+' tabs':t.parentName+' · '+domain(v.url),
     g?el('span','▤','favicon'):favicon(v.url,v.icon),btn('Restore',()=>restoreItem(v.id),'quiet'),
     btn('Delete permanently…',()=>purge(new Set([v.id])),'danger-link')));
 }
}
let tabsRevision=0;
async function updateTabs(){
 const revision=++tabsRevision;
 const fresh=(await chrome.tabs.query({currentWindow:true})).filter(t=>web(t.url));
 if(revision!==tabsRevision)return;
 tabs=fresh;
 const o=$('#open');o.replaceChildren();
 if(!tabs.length){o.append(el('p','Open a web page in this window to save it.','empty'));return}
 o.append(el('p','Drag a tab to a collection.','hint'));
 for(const t of tabs){
  const b=btn('',()=>state.collections.length===1?saveTabs([t],false,state.collections[0].id):saveTabs([t]),'live');
  b.title='Drag or click to save '+t.title;const label=el('span','','rowtext');
  label.append(el('span',t.title,'tab-title'),el('span',domain(t.url),'meta'));b.append(favicon(t.url,t.favIconUrl),label,el('span','⠿','grip'));draggable(b,'open',t.id);o.append(b)
 }
 o.append(btn('Save window · '+tabs.length,()=>saveTabs([...tabs]),'session'),btn('Save and close…',()=>saveTabs([...tabs],true),'text-btn'));
}

let tabsTimer;
function scheduleTabs(){
 clearTimeout(tabsTimer);
 if(!document.hidden)tabsTimer=setTimeout(()=>updateTabs().catch(e=>notify(e.message)),80);
}
for(const event of ['onCreated','onRemoved','onAttached','onDetached','onMoved'])chrome.tabs[event].addListener(scheduleTabs);
chrome.tabs.onUpdated.addListener((_id,changes)=>{
 if(['url','title','favIconUrl','pinned'].some(key=>key in changes))scheduleTabs();
});
document.addEventListener('visibilitychange',scheduleTabs);
$('#import').onclick=()=>chooseFile('toby');$('#restore').onclick=()=>chooseFile('restore');
function chooseFile(mode){fileMode=mode;const f=$('#file');f.value='';f.multiple=mode==='toby';f.click()}
$('#file').onchange=async e=>{try{
 const files=[...e.target.files];if(!files.length)return;
 if(fileMode==='restore'){const data=JSON.parse(await files[0].text());if(!['schedario','domy'].includes(data.format)||data.version!==1)throw Error('Unrecognized backup format.');const restored=normalizeWorkspace(validate(data.state));
 if(await ask('Replace your current workspace?',el('p','This backup contains '+restored.collections.length+' collections and '+count(restored)+' tabs.')))await change(s=>{Object.assign(s,restored);chosen.clear();shown.clear();filterFolds.clear();selecting=false;focusedCollection='';page='home';query=tag=color=''});return}
 const imports=[];for(const f of files){const bytes=await f.arrayBuffer();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 if(!state.imports.includes(hash)&&!imports.some(x=>x.hash===hash))imports.push({hash,groups:convertToby(JSON.parse(new TextDecoder().decode(bytes)))})}
 if(!imports.length)return notify('These files have already been imported.');
 const groups=imports.flatMap(x=>x.groups);
 if(await ask('Import these collections?',el('p',groups.map(c=>c.name+' ('+c.cards.length+')').join(' · '))))await change(s=>{for(const x of imports)if(!s.imports.includes(x.hash)){s.collections.push(...x.groups);s.imports.push(x.hash)}page='home'});
 }catch(err){notify(err.message)}};
$('#backup').onclick=async()=>{try{const s=await access(),url=URL.createObjectURL(new Blob([JSON.stringify({format:'domy',version:1,state:s})],{type:'application/json'}));const a=el('a');a.href=url;a.download='domy-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}catch(e){notify(e.message)}};
const finder=$('#finder'),needle=$('#needle');
let searchState, searchUrls;
function indexedUrls(){
 if(searchState!==state){searchUrls=byUrl(state.collections);searchState=state}
 return searchUrls;
}
function findResults(){
 const results=$('#results'),q=needle.value.trim();results.replaceChildren();
 const entries=[];
 if(searchScope==='collections')for(const c of state.collections){
  if(entries.length>60)break;
  if(matches(c.name,'',q))entries.push([c.name,'Collection · '+c.cards.length+' tabs',()=>jump(c.id)]);

 }

 if(searchScope==='tabs'&&q)for(const [url,copies] of indexedUrls()){
   if(entries.length>60)break;
   const hit=copies.find(({x})=>matches(x.title,url,q));
   if(hit)entries.push([hit.x.title,[...new Set(copies.map(({c})=>c.name))].join(' · ')+' · '+domain(url),()=>openCards([hit.x])]);
 }
 for(const [title,detail,fn] of entries.slice(0,60)){const b=btn('',()=>{finder.close();return fn()},'result');b.append(el('strong',title),el('span',detail,'meta'));results.append(b)}
 if(searchScope==='tabs'&&q&&entries.length){results.append(btn('View all matches in collections',()=>{finder.close();nav('home');query=q;render()},'text-btn'))}
 if(!entries.length)results.append(el('p',searchScope==='tabs'&&!q?'Type a title or URL to find a saved tab.':'No matches.','empty'));
 if(entries.length>60)results.append(el('p','Showing the first 60 results. Refine your search for more.','hint'));
}
function setScope(scope){
 searchScope=scope;
 for(const key of ['tabs','collections'])$('#search-'+key).setAttribute('aria-pressed',String(key===scope));
 needle.placeholder=scope==='tabs'?'Search saved tabs by title or URL':'Search by collection name';
 needle.setAttribute('aria-label',needle.placeholder);findResults();needle.focus();
}
for(const key of ['tabs','collections'])$('#search-'+key).onclick=()=>setScope(key);
function find(){needle.value='';finder.showModal();setScope('tabs')}
needle.oninput=findResults;
finder.onkeydown=e=>{const rows=[...$('#results').querySelectorAll('button')],i=rows.indexOf(document.activeElement);
 if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();rows[Math.max(0,Math.min(rows.length-1,i+(e.key==='ArrowDown'?1:-1)))]?.focus()}
 if(e.key==='Enter'&&document.activeElement===needle){e.preventDefault();rows[0]?.click()}};
$('#dismiss').onclick=()=>finder.close();$('#find').onclick=find;$('#create').onclick=()=>newGroup().catch(e=>notify(e.message));
document.addEventListener('keydown',e=>{if((e.key==='/'||((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'))&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();find()}});
document.addEventListener('click',e=>{for(const d of document.querySelectorAll('details[open]'))if(!d.contains(e.target))d.open=false});
document.addEventListener('drop',()=>document.body.classList.remove('dragging'));

onUpdate(refresh);await refresh();await updateTabs();
