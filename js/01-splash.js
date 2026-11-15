// ── Splash ──
(function(){
  const h=new Date().getHours();let g;
  if(h>=6&&h<12)g='早上好';else if(h>=12&&h<14)g='中午好';else if(h>=14&&h<18)g='下午好';else if(h>=18&&h<24)g='晚上好';else g='夜深了';
  const t='hi，'+g,el=document.getElementById('splashText');
  el.innerHTML=t.split('').map((c,i)=>`<span class="splash-char" style="animation-delay:${i*80}ms">${c}</span>`).join('');
  let d=false;function dismiss(){if(d)return;d=true;document.getElementById('splash').classList.add('fadeout');setTimeout(()=>{const s=document.getElementById('splash');if(s)s.remove()},500);lockOrientation()  /* 全屏已按用户要求移除，这里只锁竖屏 */}
  document.getElementById('splash').addEventListener('click',dismiss);
  setTimeout(dismiss,1500+t.length*80);
})();
