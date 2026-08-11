const CACHE='bookkeeping-v5';

self.addEventListener('install',e=>{
  // Clear everything immediately on install
  e.waitUntil(
    caches.keys().then(ks=>Promise.all(ks.map(k=>caches.delete(k))))
    .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys().then(ks=>Promise.all(ks.map(k=>caches.delete(k))))
    .then(()=>clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  e.respondWith(
    fetch(e.request).then(res=>{
      if(res.ok){const rc=res.clone();caches.open(CACHE).then(c=>c.put(e.request,rc))}
      return res;
    }).catch(()=>caches.match(e.request))
  );
});
