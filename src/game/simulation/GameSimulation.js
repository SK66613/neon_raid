import { createBoss, createEnemy, createGameState } from '../state/createGameState.js';
import { CommandType } from './commands.js';
import { createMathRandomRng } from './rng.js';

const W = 360, H = 540, DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const clone = value => structuredClone(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class GameSimulation {
  constructor({ rng = createMathRandomRng() } = {}) {
    this.rng = rng;
    this.events = [];
    this.state = createGameState();
    this.#randomizeEnemies(this.state.enemies);
  }

  step(dt, commands = []) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.033);
    for (const command of commands) this.#command(command);
    const s = this.state;
    if (s.paused || s.dead || s.won) return;
    const p = s.player;
    p.hitTimer = Math.max(0, p.hitTimer - dt);
    p.dashTimer = Math.max(0, p.dashTimer - dt);
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.fireCooldown = Math.max(0, p.fireCooldown - dt);
    this.#reloadStep(dt);
    if (p.firing) this.#fire();
    this.#movePlayer(dt);
    if (s.stage === 1) this.#stageOne(dt); else this.#bossStep(dt);
    this.#projectiles(dt);
    this.#dangerZones(dt);
    this.#medkits();
    if (s.waveSpawnTimer > 0 && (s.waveSpawnTimer -= dt) <= 0 && s.stage === 1 && !s.dead) this.#spawnSecondWave();
    if (s.transitionTimer > 0 && (s.transitionTimer -= dt) <= 0) this.skipToBoss();
  }

  getSnapshot() { return clone(this.state); }
  drainEvents() { const result = this.events; this.events = []; return clone(result); }

  restart() { this.state = createGameState(); this.#randomizeEnemies(this.state.enemies); this.events = [{ type: 'wave-started', wave: 1 }]; }
  skipToBoss() {
    const s = this.state, p = s.player;
    s.stage = 2; s.transitionTimer = 0; s.waveSpawnTimer = 0; s.enemies = []; s.bullets = []; s.enemyBullets = [];
    s.crates = []; s.barrels = []; s.dangerZones = []; s.medkits = [{ x: 48, y: 425, alive: true }, { x: 310, y: 405, alive: true }];
    p.x = 180; p.y = 468; p.vx = p.vy = 0; p.hp = Math.min(p.maxHp, p.hp + 28); p.armor = Math.min(p.maxArmor, p.armor + 20);
    s.boss = createBoss(); this.#emit('boss-started');
  }
  completeStageOne() { this.state.kills = 6; this.state.transitionTimer = 0.05; this.#emit('sector-cleared'); }
  damageBoss(amount = 100) {
    if (this.state.stage !== 2 || this.state.won) return;
    const b = this.state.boss; b.hp = Math.max(0, b.hp - Math.max(0, amount)); b.flashTimer = 0.06;
    this.#emit('boss-hit', { damage: amount, hp: b.hp });
    if (b.hp <= 0) this.#winBoss();
  }
  damagePlayer(amount) {
    const s = this.state, p = s.player;
    if (p.hitTimer > 0 || p.dashTimer > 0 || s.dead) return;
    const absorbed = Math.min(amount, p.armor); p.armor -= absorbed; p.hp -= amount - absorbed; p.hitTimer = 0.28;
    this.#emit('player-hit', { damage: amount });
    if (p.hp <= 0) { p.hp = 0; s.dead = true; s.paused = true; this.#emit('player-died'); }
  }
  damageEnemy(id, amount) {
    const enemy = this.state.enemies.find(item => item.id === id);
    if (!enemy || enemy.deadTimer > 0) return;
    enemy.hp -= amount; enemy.hitTimer = 0.1; this.#emit('enemy-hit', { enemyId: id, damage: amount });
    if (enemy.hp <= 0) this.#killEnemy(enemy);
  }

  #command(command) {
    if (!command || typeof command.type !== 'string') return;
    const p = this.state.player;
    if (command.type === CommandType.MOVE) { p.moveX = clamp(Math.trunc(command.x || 0), -1, 1); p.moveY = clamp(Math.trunc(command.y || 0), -1, 1); }
    else if (command.type === CommandType.FIRE) { p.firing = Boolean(command.active); if (p.firing) this.#fire(); }
    else if (command.type === CommandType.DASH) this.#dash();
    else if (command.type === CommandType.GRENADE) this.#grenade();
    else if (command.type === CommandType.RELOAD) this.#startReload();
    else if (command.type === CommandType.PAUSE && !this.state.dead && !this.state.won) this.state.paused = !this.state.paused;
    else if (command.type === CommandType.RESTART) this.restart();
  }
  #emit(type, detail = {}) { this.events.push({ type, ...detail }); }
  #direction(dx, dy) { if (Math.hypot(dx, dy) < 0.001) return this.state.player.lastDirection; let i = Math.round((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI / 4)); return DIRECTIONS[((i % 8) + 8) % 8]; }
  #randomizeEnemies(enemies) { for (const e of enemies) { e.shootCooldown = 0.5 + this.rng.next(); e.strafe = this.rng.next() < 0.5 ? -1 : 1; } }
  #rectCircle(o, r) { const x = clamp(o.x, r.x, r.x + r.w), y = clamp(o.y, r.y, r.y + r.h); return Math.hypot(o.x - x, o.y - y) < o.radius; }
  #blocked(o, x, y) { const s = this.state; if (x-o.radius<13||x+o.radius>347||y-o.radius<60||y+o.radius>520) return true; if (s.stage === 1) { const q={x,y,radius:o.radius}; if(s.crates.some(c=>this.#rectCircle(q,c)))return true; if(s.barrels.some(b=>b.alive&&Math.hypot(x-b.x,y-b.y)<o.radius+b.radius-2))return true; } return false; }
  #move(o, dx, dy) { const ox=o.x, oy=o.y; o.x+=dx; if(this.#blocked(o,o.x,o.y))o.x=ox; o.y+=dy; if(this.#blocked(o,o.x,o.y))o.y=oy; }
  #visible(a,b) { const s=this.state;if(s.stage!==1)return true;const steps=Math.ceil(distance(a,b)/8);for(let i=1;i<steps;i++){const t=i/steps,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;if(s.crates.some(c=>x>c.x&&x<c.x+c.w&&y>c.y&&y<c.y+c.h))return false;if(s.barrels.some(br=>br.alive&&Math.hypot(x-br.x,y-br.y)<br.radius))return false}return true; }
  #target() { const s=this.state,p=s.player;if(s.stage===2)return s.boss;let best=null,bd=Infinity;for(const e of s.enemies)if(e.deadTimer<=0){const d=distance(p,e);if(d<bd&&this.#visible(p,e)){best=e;bd=d}}return best; }
  #movePlayer(dt) { const p=this.state.player;let dx=p.moveX,dy=p.moveY;const accel=520,friction=8;if(dx||dy){const l=Math.hypot(dx,dy);dx/=l;dy/=l;p.lastDirection=this.#direction(dx,dy);p.vx+=dx*accel*dt;p.vy+=dy*accel*dt}p.vx*=Math.max(0,1-friction*dt);p.vy*=Math.max(0,1-friction*dt);const sp=Math.hypot(p.vx,p.vy),max=p.speed*(p.dashTimer>0?1.6:1);if(sp>max){p.vx=p.vx/sp*max;p.vy=p.vy/sp*max}this.#move(p,p.vx*dt,p.vy*dt); }
  #fire() { const s=this.state,p=s.player;if(s.paused||s.dead||s.won||p.fireCooldown>0||p.reloadTimer>0)return;if(p.ammo<=0){this.#startReload();return}const t=this.#target();if(!t)return;const ty=s.stage===2?t.y+25:t.y,a=Math.atan2(ty-(p.y-12),t.x-p.x);p.aimDirection=this.#direction(Math.cos(a),Math.sin(a));s.bullets.push({x:p.x+Math.cos(a)*15,y:p.y-13+Math.sin(a)*8,vx:Math.cos(a)*350,vy:Math.sin(a)*350,life:1.35,damage:s.stage===2?17:26});p.ammo--;p.fireCooldown=.105;this.#emit('shot-fired',{x:p.x,y:p.y,direction:p.aimDirection}); }
  #startReload() { const p=this.state.player;if(p.reloadTimer>0||p.ammo===28||p.reserveAmmo<=0)return;p.reloadTimer=.82;this.#emit('reload-started'); }
  #reloadStep(dt) { const p=this.state.player;if(p.reloadTimer<=0)return;p.reloadTimer-=dt;if(p.reloadTimer<=0){p.reloadTimer=0;const take=Math.min(28-p.ammo,p.reserveAmmo);p.ammo+=take;p.reserveAmmo-=take;this.#emit('reload-completed');} }
  #dash() { const s=this.state,p=s.player;if(s.paused||s.dead||s.won||p.dashCooldown>0)return;let dx=p.moveX,dy=p.moveY;if(!dx&&!dy){const a=-Math.PI/2+DIRECTIONS.indexOf(p.lastDirection)*Math.PI/4;dx=Math.cos(a);dy=Math.sin(a)}const l=Math.hypot(dx,dy)||1,nx=clamp(p.x+dx/l*62,18,342),ny=clamp(p.y+dy/l*62,70,508);if(!this.#blocked(p,nx,ny)){p.x=nx;p.y=ny}p.dashTimer=.15;p.dashCooldown=1.45;this.#emit('dash',{x:p.x,y:p.y}); }
  #grenade() { const s=this.state,p=s.player;if(s.paused||s.dead||s.won||p.grenades<=0)return;p.grenades--;const t=this.#target(),x=t?t.x:p.x,y=t?(s.stage===2?t.y+25:t.y):p.y-65;this.#emit('grenade-thrown',{x,y});this.#explode(x,y,90,105); }
  #stageOne(dt) { const s=this.state,p=s.player;for(const e of s.enemies){if(e.deadTimer>0){e.deadTimer-=dt;continue}e.hitTimer=Math.max(0,e.hitTimer-dt);e.shootCooldown-=dt;e.burstCooldown-=dt;const a=Math.atan2(p.y-e.y,p.x-e.x),dd=distance(e,p),los=this.#visible(e,p);let mx=0,my=0,sx=0,sy=0;for(const o of s.enemies)if(o!==e&&o.deadTimer<=0){const x=e.x-o.x,y=e.y-o.y,d=Math.hypot(x,y);if(d>0&&d<34){sx+=x/d;sy+=y/d}}if(!los||dd>165){mx=Math.cos(a)+sx*.65;my=Math.sin(a)+sy*.65;e.state='seek'}else if(dd<95){mx=-Math.cos(a)+sx*.8;my=-Math.sin(a)+sy*.8;e.state='back'}else{mx=Math.cos(a+e.strafe*Math.PI/2)*.75+sx*.6;my=Math.sin(a+e.strafe*Math.PI/2)*.75+sy*.6;e.state='strafe'}const ml=Math.hypot(mx,my)||1;if(e.burst<=0){this.#move(e,mx/ml*e.speed*dt,my/ml*e.speed*dt);e.moveDirection=this.#direction(mx,my)}e.direction=this.#direction(Math.cos(a),Math.sin(a));if(los&&dd<220&&e.shootCooldown<=0){e.burst=e.role==='heavy'?3:2;e.burstCooldown=0;e.shootCooldown=e.role==='heavy'?1.65:1.35+this.rng.next()*.35}if(e.burst>0&&e.burstCooldown<=0){this.#enemyShot(e);e.burst--;e.burstCooldown=.16}} }
  #enemyShot(e) { const p=this.state.player,a=Math.atan2(p.y-e.y,p.x-e.x)+(this.rng.next()-.5)*.045;e.direction=this.#direction(Math.cos(a),Math.sin(a));this.state.enemyBullets.push({x:e.x+Math.cos(a)*13,y:e.y-8+Math.sin(a)*7,vx:Math.cos(a)*145,vy:Math.sin(a)*145,life:2.7,radius:3,damage:e.role==='heavy'?13:9});this.#emit('enemy-shot',{enemyId:e.id}); }
  #killEnemy(e) { const s=this.state;if(e.deadTimer>0)return;e.deadTimer=.55;s.kills++;this.#emit('enemy-killed',{enemyId:e.id,x:e.x,y:e.y});if(s.kills===3&&s.wave===1){s.wave=2;s.waveSpawnTimer=.45}if(s.kills>=6&&s.transitionTimer<=0){s.transitionTimer=2;this.#emit('sector-cleared');} }
  #spawnSecondWave() { const s=this.state, specs=[[48,115,'rifle'],[307,116,'rifle'],[305,365,'heavy']];const list=specs.map(([x,y,r])=>createEnemy(`enemy-${++s.nextId+3}`,x,y,r));this.#randomizeEnemies(list);s.enemies.push(...list);this.#emit('wave-started',{wave:2}); }
  #bossStep(dt) { const b=this.state.boss;b.moveTimer+=dt;b.frameTimer+=dt;b.attackTimer-=dt;b.flashTimer=Math.max(0,b.flashTimer-dt);b.x=180+Math.sin(b.moveTimer*.85)*(b.phase===3?48:34);b.y=193+Math.sin(b.moveTimer*1.45)*5;if(b.attackTimer<=0)this.#bossPattern();if(b.attackFrame>=0&&(b.attackFrame+=dt*8)>=4)b.attackFrame=-1;b.smokeTimer+=dt;if(b.phase>=2&&b.smokeTimer>.22){b.smokeTimer=0;this.#emit('boss-smoke',{x:b.x+(this.rng.next()-.5)*45,y:b.y-55+this.rng.next()*30});} }
  #updateBossPhase() { const b=this.state.boss,next=b.hp<400?3:b.hp<800?2:1;if(next!==b.phase){b.phase=next;this.#emit('boss-phase-changed',{phase:next});} }
  #bossPattern() { const b=this.state.boss;this.#updateBossPhase();if(b.phase===1){this.#bossBurst(5,.72,165);if(this.rng.next()<.65)this.#danger(55,30,30,1);b.attackTimer=.82}else if(b.phase===2){this.rng.next()<.5?this.#bossBurst(7,.98,178):this.#bossRadial(11,136);this.#danger(75,46,32,.82);b.attackTimer=.68}else{this.rng.next()<.48?this.#bossRadial(15,146):this.#bossBurst(9,1.22,188);this.#danger(90,54,34,.65);this.#danger(90,54,28,.78);b.attackTimer=.54} }
  #bossBurst(count,spread,speed) { const s=this.state,b=s.boss,p=s.player,a=Math.atan2(p.y-(b.y+35),p.x-b.x);for(let i=0;i<count;i++){const off=(i-(count-1)/2)*(spread/Math.max(1,count-1));s.enemyBullets.push({x:b.x,y:b.y+48,vx:Math.cos(a+off)*speed,vy:Math.sin(a+off)*speed,life:3.4,radius:4,damage:10})}b.attackFrame=0;this.#emit('enemy-shot',{boss:true}); }
  #bossRadial(count,speed) { const s=this.state,b=s.boss;for(let i=0;i<count;i++){const a=i/count*Math.PI*2+b.moveTimer*.4;s.enemyBullets.push({x:b.x,y:b.y+40,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,life:3.6,radius:4,damage:9})}b.attackFrame=2;this.#emit('enemy-shot',{boss:true}); }
  #danger(xRange,yRange,radius,delay) { const p=this.state.player;this.state.dangerZones.push({x:clamp(p.x+(this.rng.next()-.5)*xRange,30,330),y:clamp(p.y+(this.rng.next()-.5)*yRange,270,494),radius,delay,life:delay+.22}); }
  #dangerZones(dt) { for(const z of this.state.dangerZones){z.delay-=dt;z.life-=dt;if(z.delay<=0&&!z.exploded){z.exploded=true;this.#explode(z.x,z.y,z.radius+20,0)}}this.state.dangerZones=this.state.dangerZones.filter(z=>z.life>0); }
  #hitCover(b) { const s=this.state;if(s.stage!==1)return null;for(const c of s.crates)if(b.x>c.x&&b.x<c.x+c.w&&b.y>c.y&&b.y<c.y+c.h)return'crate';for(const barrel of s.barrels)if(barrel.alive&&Math.hypot(b.x-barrel.x,b.y-barrel.y)<barrel.radius)return barrel;return null; }
  #projectiles(dt) { const s=this.state,p=s.player;for(const b of s.bullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(b.life<=0)continue;const cover=this.#hitCover(b);if(cover){b.life=0;if(cover!=='crate'&&--cover.hp<=0){cover.alive=false;this.#emit('barrel-exploded',{x:cover.x,y:cover.y});this.#explode(cover.x,cover.y,90,0)}continue}if(s.stage===1){for(const e of s.enemies)if(e.deadTimer<=0&&Math.hypot(b.x-e.x,b.y-e.y)<13){b.life=0;this.damageEnemy(e.id,b.damage);break}}else if(Math.hypot(b.x-s.boss.x,b.y-(s.boss.y+20))<s.boss.radius+7){b.life=0;this.damageBoss(b.damage)}}s.bullets=s.bullets.filter(b=>b.life>0&&b.x>-20&&b.x<W+20&&b.y>-20&&b.y<H+20);for(const b of s.enemyBullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(b.life<=0)continue;if(this.#hitCover(b)){b.life=0;continue}if(Math.hypot(b.x-p.x,b.y-p.y)<p.radius+b.radius){b.life=0;this.damagePlayer(b.damage)}}s.enemyBullets=s.enemyBullets.filter(b=>b.life>0&&b.x>-25&&b.x<W+25&&b.y>-25&&b.y<H+25); }
  #explode(x,y,radius,bossDamage) { const s=this.state;this.#emit('explosion',{x,y,radius});for(const e of s.enemies)if(e.deadTimer<=0&&Math.hypot(e.x-x,e.y-y)<radius)this.damageEnemy(e.id,100);if(s.stage===2&&Math.hypot(s.boss.x-x,s.boss.y+25-y)<radius+s.boss.radius&&bossDamage)this.damageBoss(bossDamage);if(Math.hypot(s.player.x-x,s.player.y-y)<radius*.62)this.damagePlayer(18); }
  #medkits() { const p=this.state.player;for(const m of this.state.medkits)if(m.alive&&Math.hypot(p.x-m.x,p.y-m.y)<27){m.alive=false;p.hp=Math.min(p.maxHp,p.hp+32);this.#emit('medkit-collected',{x:m.x,y:m.y});} }
  #winBoss() { const s=this.state;if(s.won)return;s.boss.hp=0;s.won=true;s.paused=true;this.#emit('boss-defeated'); }
}
