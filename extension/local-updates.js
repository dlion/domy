// Unpacked builds are updated in place. The manifest version is advanced last.
async function refreshLocalBuild(){
  try {
    const installed=chrome.runtime.getManifest().version;
    const response=await fetch(chrome.runtime.getURL('manifest.json'),{cache:'no-store'});
    if(!response.ok)return;
    const disk=await response.json();
    if(disk.name==='DOMY'&&disk.version!==installed)chrome.runtime.reload();
  }catch{ /* A concurrent extension reload may invalidate this page. */ }
}
refreshLocalBuild();
