import {initial,normalizeWorkspace} from './model.js';
const channel=new BroadcastChannel('schedario-updates');
export const onUpdate=fn=>channel.addEventListener('message',fn);
const opened=new Promise((resolve,reject)=>{
  const req=indexedDB.open('schedario',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('workspace');
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
});
export async function access(change) {
  const db=await opened;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('workspace',change?'readwrite':'readonly');
    const store=tx.objectStore('workspace'), req=store.get('state');
    let state,problem;
    req.onsuccess=()=>{
      state=req.result||initial();
      try {
        normalizeWorkspace(state);
        if(change){change(state);normalizeWorkspace(state);store.put(state,'state')}
      } catch(e){problem=e;tx.abort()}
    };
    tx.oncomplete=()=>{if(change)channel.postMessage('refresh');resolve(state)};
    tx.onabort=()=>reject(problem||tx.error||Error('Save interrupted.'));
    tx.onerror=()=>reject(problem||tx.error);
  });
}
