export const id = () => crypto.randomUUID();
export const collection = name => ({id:id(),name,star:false,collapsed:false,color:'',tags:[],created:Date.now(),modified:Date.now(),cards:[]});
export const initial = () => ({collections:[],next:[],completed:[],trash:[],imports:[],layoutVersion:3,view:'list',sort:'manual',recent:''});
export function web(url) {
  try {return ['https:', 'http:'].includes(new URL(url).protocol)} catch {return false}
}
export const makeCard = (url,title,note='',icon='') => ({id:id(),url,title:title||url,tags:[],note,icon,created:Date.now()});
export function convertToby(data) {
  if(data?.version!==3 || !Array.isArray(data.lists)) throw Error('Expected a Toby v3 export.');
  return data.lists.map(list=>{
    if(typeof list.title!=='string'||!Array.isArray(list.cards)) throw Error('Invalid Toby collection.');
    const c=collection(list.title);
    c.tags=(Array.isArray(list.labels)?list.labels:[]).filter(v=>typeof v==='string');
    c.cards=list.cards.map(x=>{
      if(typeof x.url!=='string'||!x.url) throw Error('Missing tab URL.');
      return {...makeCard(x.url,x.customTitle||x.title,x.customDescription,x.favIconURL),created:0};
    });
    return c;
  });
}
export function validate(s) {
  const check = ok=>{if(!ok) throw Error('Invalid or incomplete backup.')};
  check(s&&['collections','next','imports','trash'].every(k=>Array.isArray(s[k])));
  const ids=new Set();
  const item=x=>{check(x&&typeof x.id==='string'&&x.id&&!ids.has(x.id));ids.add(x.id)};
  const validTags=t=>t===undefined||(Array.isArray(t)&&t.every(v=>typeof v==='string'));
  check(validTags(s.tagSuggestions));
  check(s.completed===undefined||(Array.isArray(s.completed)&&s.completed.every(h=>h&&typeof h.title==='string'&&typeof h.source==='string'&&typeof h.url==='string'&&typeof h.ref==='string'&&typeof h.id==='string'&&Number.isFinite(h.at))));
  const card=x=>{item(x);check(validTags(x.tags));check(['url','title','note','icon'].every(k=>typeof x[k]==='string')&&x.url.length)};
  const group=c=>{item(c);check(typeof c.name==='string'&&Array.isArray(c.tags)&&c.tags.every(t=>typeof t==='string')&&typeof c.color==='string'&&Array.isArray(c.cards));c.cards.forEach(card)};
  s.collections.forEach(group);
  check(s.next.every(n=>ids.has(n))&&new Set(s.next).size===s.next.length);
  for(const t of s.trash){check(t&&['group','card'].includes(t.kind));(t.kind==='group'?group:card)(t.value)}
  check(s.imports.every(x=>typeof x==='string')&&['compact','list','card','grid'].includes(s.view)&&['manual','alpha','star','created','modified'].includes(s.sort));
  return s;
}
export const matches=(title,url,query)=>query.toLowerCase().trim().split(/\s+/).every(word=>(title+' '+url).toLowerCase().includes(word));

export function tabTags(workspace) {
  const used = workspace.collections.flatMap(c => c.cards.flatMap(x => x.tags || []));
  return [...new Set(used)].sort((a,b) => a.localeCompare(b));
}

export function byUrl(collections) {
  const urls = new Map();
  for (const c of collections) for (const x of c.cards) {
    if (!urls.has(x.url)) urls.set(x.url, []);
    urls.get(x.url).push({c,x});
  }
  return urls;
}

export function normalizeWorkspace(s) {
  const vocabulary = new Set(s.tagSuggestions || []);
  function migrate(c) {
    for (const t of c.tags || []) vocabulary.add(t);
    for (const x of c.cards) {
      if (c.tags?.length) x.tags = [...new Set([...(x.tags || []), ...c.tags])];
      else x.tags ||= [];
    }
    if (!c.tags || c.tags.length) c.tags = [];
  }
  for (const c of s.collections) migrate(c);
  for (const t of s.trash) {
    if (t.kind === 'group') migrate(t.value);
    else t.value.tags ||= [];
  }
  s.tagSuggestions = [...vocabulary];
  s.completed ||= [];
  if (s.next.length) {
    const requested = new Set(s.next);
    const groups = new Map();
    const urls = new Map();
    for (const c of s.collections) {
      const expand = requested.has(c.id);
      if (expand) groups.set(c.id,c.cards.map(x=>x.id));
      for (const x of c.cards) if (expand || requested.has(x.id)) urls.set(x.id,x.url);
    }
    const queue = [], seen = new Set();
    function append(id) {
      const url = urls.get(id);
      if (url && !seen.has(url)) { seen.add(url); queue.push(id); }
    }
    for (const id of s.next) {
      if (groups.has(id)) groups.get(id).forEach(append);
      else append(id);
    }
    s.next = queue;
  }
  if (s.layoutVersion !== 3) { s.view = 'list'; s.layoutVersion = 3; }
  return s;
}

// Keep the original when a move would collide with a saved URL.
export function moveCards(s, ids, to) {
  const urls = new Set(to.cards.map(x=>x.url));
  let moved = 0, skipped = 0;
  for (const c of s.collections) {
    if (c.id === to.id) continue;
    c.cards = c.cards.filter(x => {
      if (!ids.has(x.id)) return true;
      if (urls.has(x.url)) { skipped++; return true; }
      urls.add(x.url);
      to.cards.push(x);
      moved++;
      c.modified = to.modified = Date.now();
      return false;
    });
  }
  if (moved) to.collapsed = false;
  return {moved,skipped};
}

export function addNext(s,ids) {
  const before = s.next.length;
  const links = new Set(s.collections.flatMap(c=>c.cards.map(x=>x.id)));
  s.next.push(...Array.from(ids).filter(id=>links.has(id)));
  normalizeWorkspace(s);
  return s.next.length - before;
}

export function completeNext(s,ref,at=Date.now()){
  if(!s.next.includes(ref))return false;
  for(const c of s.collections){
    const x=c.cards.find(card=>card.id===ref);
    if(!x)continue;
    s.completed ||= [];
    s.completed.unshift({id:id(),ref,title:x.title,url:x.url,source:c.name,at});
    s.next=s.next.filter(i=>i!==ref);
    return true;
  }
  return false;
}
