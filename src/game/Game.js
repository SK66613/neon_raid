import { DIRS, PLAYER_ASSETS, CORP_SEC_ASSETS, WARDEN_X_IDLE_ASSETS, WARDEN_X_ATTACK_ASSETS, ENVIRONMENT_ASSETS } from './assets.js';
import { CommandType, fireCommand, moveCommand } from './simulation/commands.js';
import { createLocalGameSession } from './session/LocalGameSession.js';

export function startGame() {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const ui = Object.fromEntries(['hpText','armText','hpFill','armFill','bossHud','bossFill','bossPhase','stageName','objectiveLabel','objectiveText','ammo','reserve','status','grenades','dashCd'].map(id => [id, document.getElementById(id)]));
  const images = { player: {}, enemy: {}, bossIdle: [], bossAttack: [], other: {} };
  const sources = [];
  for (const direction of DIRS) {
    images.player[direction] = {}; images.enemy[direction] = {};
    for (const frame of ['idle', 'run1', 'run2']) {
      sources.push([PLAYER_ASSETS[direction][frame], image => { images.player[direction][frame] = image; }]);
      sources.push([CORP_SEC_ASSETS[direction][frame], image => { images.enemy[direction][frame] = image; }]);
    }
  }
  WARDEN_X_IDLE_ASSETS.forEach((source, index) => sources.push([source, image => { images.bossIdle[index] = image; }]));
  WARDEN_X_ATTACK_ASSETS.forEach((source, index) => sources.push([source, image => { images.bossAttack[index] = image; }]));
  Object.entries(ENVIRONMENT_ASSETS).forEach(([key, source]) => sources.push([source, image => { images.other[key] = image; }]));
  Promise.all(sources.map(([source, assign]) => new Promise(resolve => { const image = new Image(); image.onload = image.onerror = () => { assign(image); resolve(); }; image.src = source; }))).then(run);

  function run() {
    const session = createLocalGameSession();
    const testAdapter = session.createTestAdapter();
    const keys = { up: false, down: false, left: false, right: false };
    const visual = { time: 0, shake: 0, muzzle: 0, bossFlash: 0, particles: [], casings: [], rain: [], last: 0 };
    let audioContext = null;
    for (let i = 0; i < 70; i++) visual.rain.push({ x: Math.random()*360, y: Math.random()*540, speed: 70+Math.random()*100, length: 5+Math.random()*9, alpha: .08+Math.random()*.16 });
    const audio = () => { if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)(); return audioContext; };
    const tone = (frequency, duration=.04, type='square', gain=.02) => { try { const a=audio(),o=a.createOscillator(),g=a.createGain();o.type=type;o.frequency.value=frequency;g.gain.setValueAtTime(gain,a.currentTime);g.gain.exponentialRampToValueAtTime(.0001,a.currentTime+duration);o.connect(g);g.connect(a.destination);o.start();o.stop(a.currentTime+duration); } catch {} };
    const command = value => session.submit(value);
    const movement = () => moveCommand((keys.right?1:0)-(keys.left?1:0), (keys.down?1:0)-(keys.up?1:0));

    function effects(events) {
      for (const event of events) {
        if (event.type === 'shot-fired') { const angle=-Math.PI/2+DIRS.indexOf(event.direction)*Math.PI/4;visual.muzzle=.06;visual.casings.push({x:event.x,y:event.y-8,vx:-Math.sin(angle)*(35+Math.random()*28),vy:-30-Math.random()*35,life:.65});tone(90,.035,'sawtooth',.018); }
        if (event.type === 'enemy-shot') { if(event.boss)visual.bossFlash=.1;tone(event.boss?50:70,event.boss ? .07 : .03,event.boss?'sawtooth':'square',event.boss ? .025 : .008);  }
        if (event.type === 'player-hit') { visual.shake=4; tone(45,.08,'sawtooth',.02); }
        if (event.type === 'enemy-killed') { visual.particles.push({type:'burst',x:event.x,y:event.y,r:4,max:28,life:.3}); tone(52,.08,'square',.018); }
        if (event.type === 'explosion') { visual.shake=7; visual.particles.push({...event,type:'explosion',r:5,max:event.radius,life:.45}); tone(38,.16,'sawtooth',.035); }
        if (event.type === 'dash') { visual.particles.push({...event,type:'dash',r:4,max:36,life:.22}); tone(190,.06,'triangle',.02); }
        if (event.type === 'boss-smoke') visual.particles.push({...event,type:'smoke',r:10,max:30,life:.65});
        if (event.type === 'boss-defeated') tone(260,.3,'sawtooth',.035);
        if (event.type === 'wave-started') ui.status.textContent = event.wave===1?'Этап 1: первая группа Corp Sec. Укрытия блокируют пули.':'Вторая группа вошла в сектор.';
        if (event.type === 'sector-cleared') ui.status.textContent = 'SECTOR CLEAR — доступ к реактору открыт.';
        if (event.type === 'boss-started') ui.status.textContent = 'Этап 2: Warden-X ожил. Следи за красными зонами и паттернами пуль.';
        if (event.type === 'reload-started') { ui.status.textContent = 'RELOADING…'; tone(320,.05,'square',.012); }
        if (event.type === 'reload-completed') { const snapshot=session.getSnapshot();ui.status.textContent=snapshot.stage===1?'Сектор активен.':`Warden-X: ${Math.ceil(snapshot.boss.hp)} HP`; }
        if (event.type === 'medkit-collected') ui.status.textContent = '+32 HP';
        if (event.type === 'player-died') ui.status.textContent = 'RAID FAILED — нажми RESTART GAME';
        if (event.type === 'boss-defeated') ui.status.textContent = 'WARDEN-X DESTROYED — TWO-STAGE RAID COMPLETE';
      }
    }
    function sync(s) {
      const p=s.player,b=s.boss;ui.hpText.textContent=`${Math.ceil(p.hp)}/${p.maxHp}`;ui.armText.textContent=`${Math.ceil(p.armor)}/${p.maxArmor}`;ui.hpFill.style.width=`${100*p.hp/p.maxHp}%`;ui.armFill.style.width=`${100*p.armor/p.maxArmor}%`;ui.ammo.textContent=p.ammo;ui.reserve.textContent=p.reserveAmmo;ui.grenades.textContent=p.grenades;ui.dashCd.textContent=p.dashCooldown>0?p.dashCooldown.toFixed(1):'READY';ui.stageName.textContent=s.stage===1?'AREA 2-3A':'AREA 2-3B';ui.bossHud.classList.toggle('show',s.stage===2);ui.objectiveLabel.textContent=s.stage===1?'⚠ CLEAR THE SECTOR':'⚠ DEFEAT WARDEN-X';ui.objectiveText.textContent=s.stage===1?`${s.kills} / 6`:`PHASE ${b.phase}`;ui.bossFill.style.width=`${100*b.hp/b.maxHp}%`;ui.bossPhase.textContent=`PHASE ${b.phase}`;document.getElementById('pause').textContent=s.paused&&!s.dead&&!s.won?'PLAY':'PAUSE';
    }
    const bottom = (image,x,y,height,alpha=1) => { if(!image?.width)return;const width=image.width*(height/image.height);ctx.save();ctx.globalAlpha=alpha;ctx.drawImage(image,x-width/2,y-height,width,height);ctx.restore(); };
    function drawFloor() { const pattern=ctx.createPattern(images.other.floor,'repeat');ctx.fillStyle=pattern||'#071017';ctx.fillRect(0,0,360,540);ctx.fillStyle='rgba(3,7,11,.36)';ctx.fillRect(0,0,360,540);const gradient=ctx.createLinearGradient(0,0,360,540);gradient.addColorStop(0,'rgba(0,196,220,.13)');gradient.addColorStop(.55,'rgba(0,0,0,0)');gradient.addColorStop(1,'rgba(230,35,96,.14)');ctx.fillStyle=gradient;ctx.fillRect(0,0,360,540); }
    function drawStage1Bg(transitioning) { drawFloor();ctx.fillStyle='rgba(5,9,13,.92)';ctx.fillRect(0,0,360,58);ctx.fillStyle='#171e24';ctx.fillRect(0,54,360,7);ctx.fillStyle='#24cad6';ctx.fillRect(16,54,92,2);ctx.fillStyle='#ee354d';ctx.fillRect(252,54,92,2);ctx.fillStyle='#11181e';ctx.fillRect(0,60,17,480);ctx.fillRect(343,60,17,480);for(let y=80;y<540;y+=52){ctx.fillStyle='#26323a';ctx.fillRect(3,y,11,3);ctx.fillRect(346,y,11,3)}ctx.fillStyle='#0a1015';ctx.fillRect(128,60,104,50);ctx.strokeStyle='#3c4b54';ctx.strokeRect(130,62,100,46);ctx.fillStyle=transitioning?'#2ce09c':'#d63b48';ctx.font='bold 11px monospace';ctx.textAlign='center';ctx.fillText(transitioning?'REACTOR OPEN':'LOCKED',180,90);ctx.textAlign='left'; }
    function drawBossBg() { drawFloor();ctx.fillStyle='rgba(4,6,8,.53)';ctx.fillRect(0,0,360,540);ctx.fillStyle='#11171c';ctx.fillRect(0,0,360,64);ctx.fillStyle='#151b20';ctx.fillRect(0,64,42,170);ctx.fillRect(318,64,42,170);ctx.strokeStyle='rgba(238,48,65,.42)';ctx.lineWidth=10;ctx.beginPath();ctx.arc(180,155,87,Math.PI*.12,Math.PI*.88);ctx.stroke();ctx.lineWidth=2;ctx.strokeStyle='rgba(255,62,77,.76)';ctx.beginPath();ctx.arc(180,155,76,Math.PI*.12,Math.PI*.88);ctx.stroke();ctx.fillStyle='rgba(255,45,60,.13)';ctx.fillRect(174,65,12,120);ctx.fillStyle='#e73c4d';ctx.font='bold 9px monospace';ctx.fillText('REACTOR 03',10,92);ctx.fillText('CORE OVERLOAD',266,92); }
    function drawMuzzle(x,y,direction,size=34) { if(!images.other.flash?.width)return;const angle=-Math.PI/2+DIRS.indexOf(direction)*Math.PI/4;ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.globalCompositeOperation='lighter';ctx.drawImage(images.other.flash,15,-size*.28,size*1.25,size*.56);ctx.restore(); }
    function actor(image,o,height,shadowColor,alpha=1) { ctx.save();ctx.globalAlpha=.22;ctx.fillStyle=shadowColor;ctx.beginPath();ctx.ellipse(o.x,o.y+7,o.radius*1.35,o.radius*.55,0,0,Math.PI*2);ctx.fill();ctx.restore();bottom(image,o.x,o.y+20,height,alpha); }
    function draw(s) {
      ctx.save();ctx.translate((Math.random()-.5)*visual.shake,(Math.random()-.5)*visual.shake);s.stage===1?drawStage1Bg(s.transitionTimer>0):drawBossBg();
      if(s.stage===1){for(const c of s.crates){ctx.save();ctx.shadowColor='#21cbd6';ctx.shadowBlur=8;bottom(images.other.crate,c.x+c.w/2,c.y+c.h+8,c.h+34);ctx.restore()}for(const b of s.barrels)if(b.alive){ctx.save();ctx.shadowColor='#ff3045';ctx.shadowBlur=12;bottom(images.other.barrel,b.x,b.y+27,66);ctx.restore()}}
      else { const b=s.boss,index=b.attackFrame>=0?Math.min(3,Math.floor(b.attackFrame)):Math.floor(b.frameTimer*5)%4;bottom(b.attackFrame>=0?images.bossAttack[index]:images.bossIdle[index],b.x,b.y+118,250,b.flashTimer>0||visual.bossFlash>0?.6:1); }
      for(const m of s.medkits)if(m.alive){ctx.save();ctx.shadowColor='#1af0b2';ctx.shadowBlur=14;bottom(images.other.medkit,m.x,m.y+20,48);ctx.restore()}
      const p=s.player,moving=Math.hypot(p.vx,p.vy)>13,frame=moving?(Math.floor(visual.time*10)%2?'run1':'run2'):'idle';
      const drawPlayer=()=>actor(images.player[p.firing||visual.muzzle>0?p.aimDirection:p.lastDirection][frame],p,67,'#25d8e0',p.hitTimer>0&&Math.floor(p.hitTimer*22)%2===0?.45:p.dashTimer>0?.72:1);
      if(s.stage===1){const actors=[...s.enemies.filter(e=>e.deadTimer<=0).map(enemy=>({y:enemy.y,enemy})),{y:p.y,player:true}].sort((a,b)=>a.y-b.y);for(const entry of actors){if(entry.player){drawPlayer();continue}const e=entry.enemy,enemyMoving=e.burst<=0,enemyFrame=enemyMoving?(Math.floor((visual.time+e.x*.01)*8)%2?'run1':'run2'):'idle';actor(images.enemy[e.burst>0?e.direction:e.moveDirection][enemyFrame],e,62,'#ff334c',e.hitTimer>0?.65:1);ctx.fillStyle='#351016';ctx.fillRect(e.x-17,e.y-35,34,3);ctx.fillStyle='#f03c51';ctx.fillRect(e.x-17,e.y-35,34*Math.max(0,e.hp/e.maxHp),3);if(e.burst>0)drawMuzzle(e.x,e.y-12,e.direction,30)}}else drawPlayer();
      if(visual.muzzle>0)drawMuzzle(p.x,p.y-12,p.aimDirection,34);
      ctx.save();ctx.globalCompositeOperation='lighter';for(const b of s.bullets){ctx.strokeStyle='#ffd75a';ctx.lineWidth=2.4;ctx.beginPath();ctx.moveTo(b.x-b.vx*.026,b.y-b.vy*.026);ctx.lineTo(b.x,b.y);ctx.stroke()}for(const b of s.enemyBullets){ctx.fillStyle=s.stage===2?'#ff3954':'#ff4355';ctx.beginPath();ctx.arc(b.x,b.y,b.radius,0,Math.PI*2);ctx.fill()}ctx.restore();
      for(const z of s.dangerZones){ctx.save();ctx.globalAlpha=.35+.2*Math.sin(z.life*22);ctx.fillStyle='#f52947';ctx.beginPath();ctx.arc(z.x,z.y,z.radius,0,Math.PI*2);ctx.fill();ctx.globalAlpha=.8;ctx.strokeStyle='#ff5b68';ctx.lineWidth=2;ctx.beginPath();ctx.arc(z.x,z.y,z.radius,0,Math.PI*2);ctx.stroke();ctx.restore();}
      for(const casing of visual.casings){ctx.save();ctx.globalAlpha=Math.max(0,casing.life*1.5);ctx.translate(casing.x,casing.y);ctx.rotate(casing.life*13);ctx.fillStyle='#c79d36';ctx.fillRect(-3,-1,6,2);ctx.restore();}
      for(const f of visual.particles){if(f.type==='smoke'){ctx.save();ctx.globalAlpha=Math.max(0,f.life*.55);bottom(images.other.smoke,f.x,f.y+f.r,40+f.r);ctx.restore();continue}ctx.save();ctx.globalAlpha=Math.max(0,f.life*2.3);ctx.strokeStyle=f.type==='dash'?'#36dce6':'#ffb038';ctx.lineWidth=4;ctx.beginPath();ctx.arc(f.x,f.y,f.r||5,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#ef3b52';ctx.lineWidth=2;ctx.beginPath();ctx.arc(f.x,f.y,(f.r||5)*.62,0,Math.PI*2);ctx.stroke();ctx.restore();}
      for(const r of visual.rain){ctx.strokeStyle=`rgba(121,211,232,${r.alpha})`;ctx.beginPath();ctx.moveTo(r.x,r.y);ctx.lineTo(r.x-2,r.y+r.length);ctx.stroke();}ctx.restore();
      if(s.transitionTimer>0){ctx.fillStyle='rgba(0,0,0,.62)';ctx.fillRect(40,224,280,88);ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='bold 18px monospace';ctx.fillText('SECTOR CLEAR',180,258);ctx.fillStyle='#35d8e2';ctx.font='9px monospace';ctx.fillText('ENTERING REACTOR CORE…',180,283);ctx.textAlign='left'}
      if(s.paused){ctx.fillStyle='rgba(0,0,0,.62)';ctx.fillRect(45,226,270,92);ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='bold 18px monospace';ctx.fillText(s.won?'RAID COMPLETE':s.dead?'RAID FAILED':'PAUSED',180,260);ctx.font='9px monospace';ctx.fillStyle='#a3b5bd';ctx.fillText(s.won?'WARDEN-X DESTROYED':s.dead?'RESTART GAME':'PRESS PLAY',180,285);ctx.textAlign='left'}
    }
    function loop(timestamp) { const dt=Math.min(.033,(timestamp-visual.last)/1000||0);visual.last=timestamp;visual.time+=dt;visual.shake=Math.max(0,visual.shake-dt*17);visual.muzzle=Math.max(0,visual.muzzle-dt);visual.bossFlash=Math.max(0,visual.bossFlash-dt);for(const casing of visual.casings){casing.vy+=90*dt;casing.x+=casing.vx*dt;casing.y+=casing.vy*dt;casing.life-=dt}visual.casings=visual.casings.filter(casing=>casing.life>0);for(const r of visual.rain){r.y+=r.speed*dt;r.x-=r.speed*.18*dt;if(r.y>550){r.y=-10;r.x=Math.random()*360}if(r.x<-10)r.x=370}for(const particle of visual.particles){particle.life-=dt;if(particle.type!=='smoke')particle.r=(particle.r||4)+((particle.radius||particle.max||28)-(particle.r||4))*Math.min(1,dt*12);else particle.r+=(particle.max-particle.r)*Math.min(1,dt*12)}visual.particles=visual.particles.filter(particle=>particle.life>0);session.submit(movement());session.update(dt);const snapshot=session.getSnapshot();effects(session.drainEvents());sync(snapshot);draw(snapshot);requestAnimationFrame(loop); }
    document.querySelectorAll('[data-dir]').forEach(button => { const key=button.dataset.dir,on=e=>{e.preventDefault();audio();keys[key]=true;button.classList.add('on')},off=e=>{e?.preventDefault();keys[key]=false;button.classList.remove('on')};button.addEventListener('pointerdown',on);for(const name of ['pointerup','pointercancel','pointerleave'])button.addEventListener(name,off);});
    const fire=document.getElementById('fire'),fireOn=e=>{e.preventDefault();audio();command(fireCommand(true));fire.classList.add('on')},fireOff=e=>{e?.preventDefault();command(fireCommand(false));fire.classList.remove('on')};fire.addEventListener('pointerdown',fireOn);for(const name of ['pointerup','pointercancel','pointerleave'])fire.addEventListener(name,fireOff);
    document.getElementById('dash').addEventListener('click',()=>command({type:CommandType.DASH}));document.getElementById('grenade').addEventListener('click',()=>command({type:CommandType.GRENADE}));document.getElementById('pause').addEventListener('click',()=>command({type:CommandType.PAUSE}));document.getElementById('reset').addEventListener('click',()=>command({type:CommandType.RESTART}));
    document.addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(k==='w'||e.key==='ArrowUp')keys.up=true;if(k==='s'||e.key==='ArrowDown')keys.down=true;if(k==='a'||e.key==='ArrowLeft')keys.left=true;if(k==='d'||e.key==='ArrowRight')keys.right=true;if(e.code==='Space'){command(fireCommand(true));e.preventDefault()}if(k==='g')command({type:CommandType.GRENADE});if(e.key==='Shift')command({type:CommandType.DASH});});document.addEventListener('keyup',e=>{const k=e.key.toLowerCase();if(k==='w'||e.key==='ArrowUp')keys.up=false;if(k==='s'||e.key==='ArrowDown')keys.down=false;if(k==='a'||e.key==='ArrowLeft')keys.left=false;if(k==='d'||e.key==='ArrowRight')keys.right=false;if(e.code==='Space')command(fireCommand(false));});
    window.addEventListener('blur',()=>{command(fireCommand(false));const s=session.getSnapshot();if(!s.paused&&!s.dead&&!s.won)command({type:CommandType.PAUSE});});
    window.__NEON_TEST={get:()=>{const s=session.getSnapshot();return{stage:s.stage,x:s.player.x,y:s.player.y,ammo:s.player.ammo,bossHp:s.boss.hp,kills:s.kills,paused:s.paused,dead:s.dead,won:s.won}},skipToBoss:()=>testAdapter.skipToBoss(),completeStage1:()=>testAdapter.completeStageOne(),damageBoss:(n=100)=>testAdapter.damageBoss(n),reload:()=>{session.submit(fireCommand(false));session.submit({type:CommandType.RELOAD});session.update(0)}};
    ui.status.textContent='Этап 1: первая группа Corp Sec. Укрытия блокируют пули.';window.__NEON_READY=true;requestAnimationFrame(loop);
  }
}
