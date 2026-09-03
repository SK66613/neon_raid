import assert from 'node:assert/strict'; import test from 'node:test'; import { PENDING_RESUME_AUTH_MS, RaidRoom, RECONNECT_GRACE_MS } from '../server/RaidRoom.js';
class Socket { constructor(){this.messages=[];this.attachment=null;this.closed=false;this.readyState=1;this.closeArgs=[];this.throwOnSend=false;} send(v){if(this.throwOnSend)throw new Error('broken send');this.messages.push(JSON.parse(v));} serializeAttachment(v){this.attachment=structuredClone(v);} deserializeAttachment(){return structuredClone(this.attachment);} close(code,reason){this.closed=true;this.readyState=3;this.closeArgs.push([code,reason]);} }
class Context { constructor(){this.sockets=[];} acceptWebSocket(s){this.sockets.push(s);} getWebSockets(){return [...this.sockets];} remove(s){this.sockets=this.sockets.filter(x=>x!==s);} }
class FakeResponse { constructor(body,init={}){this.body=body;this.status=init.status??200;this.webSocket=init.webSocket;} static json(v,init){return new FakeResponse(JSON.stringify(v),init);} async json(){return JSON.parse(this.body);} }
class Scheduler { constructor(){this.callbacks=new Map();this.timeouts=new Map();this.next=1;this.clears=0;} setInterval(fn,ms){assert.equal(ms,1000/30);const id=this.next++;this.callbacks.set(id,fn);return id;} clearInterval(id){this.clears++;this.callbacks.delete(id);} setTimeout(fn,ms){assert.ok([PENDING_RESUME_AUTH_MS,RECONNECT_GRACE_MS].includes(ms));const id=this.next++;this.timeouts.set(id,{fn,ms});return id;} clearTimeout(id){this.timeouts.delete(id);} tick(){for(const fn of [...this.callbacks.values()])fn();} expire(ms=RECONNECT_GRACE_MS){for(const [id,item] of [...this.timeouts])if(item.ms===ms){this.timeouts.delete(id);item.fn();}} }
const last=(s,type)=>s.messages.filter(m=>m.type===type).at(-1); const frames=s=>s.messages.filter(m=>m.type==='state-frame');

test('resume upgrade is unavailable without a live matching reservation',async t=>{
 const oldR=globalThis.Response,oldW=globalThis.WebSocketPair,pairs=[];globalThis.Response=FakeResponse;globalThis.WebSocketPair=class{constructor(){pairs.push(this);}};t.after(()=>{globalThis.Response=oldR;if(oldW===undefined)delete globalThis.WebSocketPair;else globalThis.WebSocketPair=oldW;});
 const room=new RaidRoom(new Context(),{scheduler:new Scheduler()}),response=await room.fetch(new Request('https://x/ws?roomId=room&resume=1',{headers:{Upgrade:'websocket'}}));assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'resume-unavailable'});assert.equal(pairs.length,0);assert.equal(room.pendingResumeAuth.size,0);
});

test('authenticated resume takes over a still-live member and late departure is harmless',async t=>{
 const oldR=globalThis.Response,oldW=globalThis.WebSocketPair,pairs=[];globalThis.Response=FakeResponse;globalThis.WebSocketPair=class{constructor(){this.client=new Socket();this.server=new Socket();pairs.push(this);}};t.after(()=>{globalThis.Response=oldR;if(oldW===undefined)delete globalThis.WebSocketPair;else globalThis.WebSocketPair=oldW;});
 const ctx=new Context(),scheduler=new Scheduler();let token=0;const room=new RaidRoom(ctx,{scheduler,createMatchId:()=> 'live-match',createResumeToken:()=>`${++token}`.padStart(64,'0')}),join=new Request('https://x/ws?roomId=room&reconnect=1',{headers:{Upgrade:'websocket'}}),resume=new Request('https://x/ws?roomId=room&resume=1',{headers:{Upgrade:'websocket'}});
 await room.fetch(join);await room.fetch(join);const original=pairs[0].server,survivor=pairs[1].server,host=room.host,identity={...original.attachment},oldToken=original.attachment.resumeToken;assert.equal(room.reservations.size,0);
 await room.fetch(resume);const invalid=pairs.at(-1).server;room.webSocketMessage(invalid,JSON.stringify({version:2,type:'resume',matchId:identity.matchId,connectionId:identity.connectionId,resumeToken:'f'.repeat(64)}));assert.equal(last(invalid,'error').code,'resume-rejected');assert.equal(original.attachment.socketType,undefined);assert.equal(original.closed,false);assert.equal(room.memberSockets().includes(original),true);
 await room.fetch(resume);const replacement=pairs.at(-1).server;room.webSocketMessage(replacement,JSON.stringify({version:2,type:'resume',matchId:identity.matchId,connectionId:identity.connectionId,resumeToken:oldToken}));
 assert.equal(room.host,host);assert.equal(replacement.attachment.connectionId,identity.connectionId);assert.equal(replacement.attachment.slot,identity.slot);assert.equal(replacement.attachment.matchId,identity.matchId);assert.equal(replacement.attachment.lastInputSeq,-1);assert.notEqual(replacement.attachment.resumeToken,oldToken);assert.equal(original.attachment.socketType,'retired-member');assert.equal(original.attachment.resumeToken,null);assert.equal(room.memberSockets().includes(original),false);assert.equal(room.memberSockets().includes(replacement),true);assert.equal(room.reservations.size,0);assert.deepEqual(replacement.messages.slice(0,4).map(message=>message.type),['welcome','resume-ticket','state-frame','roster']);
 room.webSocketMessage(original,JSON.stringify({version:2,type:'input',matchId:identity.matchId,seq:99,command:{type:'fire',active:true}}));room.webSocketError(original);room.webSocketClose(original,1006,'late',false);assert.equal(room.host,host);assert.equal(room.memberSockets().includes(replacement),true);assert.equal(room.reservations.size,0);assert.equal(last(survivor,'match-aborted'),undefined);
 await room.fetch(resume);const replay=pairs.at(-1).server;room.webSocketMessage(replay,JSON.stringify({version:2,type:'resume',matchId:identity.matchId,connectionId:identity.connectionId,resumeToken:oldToken}));assert.equal(last(replay,'error').code,'resume-rejected');assert.equal(room.memberSockets().includes(replacement),true);
});

test('RaidRoom runs match lifecycle, strict matched sequencing, and fresh replacement', async t=>{
 const oldR=globalThis.Response,oldW=globalThis.WebSocketPair,pairs=[]; globalThis.Response=FakeResponse; globalThis.WebSocketPair=class{constructor(){this.client=new Socket();this.server=new Socket();pairs.push(this);}};
 t.after(()=>{globalThis.Response=oldR;if(oldW===undefined)delete globalThis.WebSocketPair;else globalThis.WebSocketPair=oldW;});
 const ctx=new Context(), scheduler=new Scheduler(); let id=0; const room=new RaidRoom(ctx,{scheduler,createMatchId:()=>`match-${++id}`});
 const req=new Request('https://x/ws?roomId=room',{headers:{Upgrade:'websocket'}}); await room.fetch(req); const one=pairs[0].server;
 assert.equal(scheduler.callbacks.size,0); assert.equal(one.attachment.matchState,'waiting'); assert.equal(one.attachment.matchId,null);
 room.webSocketMessage(one,JSON.stringify({version:2,type:'input',matchId:'none',seq:0,command:{type:'dash'}})); assert.equal(last(one,'error').code,'match-not-active');
 await room.fetch(req); const two=pairs[1].server; assert.equal(scheduler.callbacks.size,1);
 assert.equal(one.attachment.matchId,'match-1'); assert.equal(two.attachment.matchId,'match-1'); assert.equal(frames(one)[0].tick,0); assert.deepEqual(frames(one)[0],frames(two)[0]); assert.equal(frames(one)[0].events[0].type,'match-started');
 scheduler.tick(); scheduler.tick(); assert.deepEqual(frames(one).map(f=>f.tick),[0,1,2]); assert.deepEqual(frames(two).map(f=>f.tick),[0,1,2]);
 const before=frames(one).length; room.webSocketMessage(one,JSON.stringify({version:2,type:'input',matchId:'wrong',seq:8,command:{type:'dash'}})); assert.equal(last(one,'error').code,'stale-match'); assert.equal(one.attachment.lastInputSeq,-1);
 room.webSocketMessage(one,JSON.stringify({version:2,type:'input',matchId:'match-1',seq:4,command:{type:'move',x:1,y:0}})); assert.deepEqual(last(one,'input-ack'),{version:2,type:'input-ack',matchId:'match-1',seq:4}); assert.equal(frames(one).length,before); assert.equal(one.attachment.lastInputSeq,4);
 room.webSocketMessage(two,JSON.stringify({version:2,type:'input',matchId:'match-1',seq:2,command:{type:'move',x:-1,y:0}})); assert.equal(last(two,'input-ack').seq,2);
 room.webSocketMessage(one,JSON.stringify({version:2,type:'input',matchId:'match-1',seq:4,command:{type:'dash'}})); assert.equal(last(one,'error').code,'stale-sequence');
 for(const extra of [{slot:2},{dt:.1}]) room.webSocketMessage(one,JSON.stringify({version:2,type:'input',matchId:'match-1',seq:5,command:{type:'dash'},...extra})); assert.equal(last(one,'error').code,'invalid-message');
 scheduler.tick(); assert.equal(frames(one).at(-1).snapshot.players[0].moveX,1); assert.equal(frames(two).at(-1).snapshot.players[1].moveX,-1); assert.equal(frames(one).at(-1).snapshot.boss.hp,frames(two).at(-1).snapshot.boss.hp);
 const departingAbortCount=two.messages.filter(m=>m.type==='match-aborted').length; room.webSocketClose(two,1000,'client left',true); assert.deepEqual(two.closeArgs.at(-1),[1000,'client left']); assert.equal(two.messages.filter(m=>m.type==='match-aborted').length,departingAbortCount); assert.equal(scheduler.callbacks.size,0); assert.equal(one.closed,false); assert.equal(last(one,'match-aborted').reason,'player-left'); assert.equal(one.attachment.matchState,'waiting');
 ctx.remove(two);
 await room.fetch(req); const replacement=pairs[2].server; assert.equal(one.attachment.matchId,'match-2'); assert.equal(replacement.attachment.matchId,'match-2'); assert.notEqual(one.attachment.matchId,'match-1');
 room.webSocketMessage(one,JSON.stringify({version:2,type:'input',matchId:'match-1',seq:5,command:{type:'dash'}})); assert.equal(last(one,'error').code,'stale-match'); assert.equal(one.attachment.lastInputSeq,4);
 room.webSocketMessage(one,JSON.stringify({version:2,type:'input',matchId:'match-2',seq:5,command:{type:'dash'}})); assert.equal(last(one,'input-ack').matchId,'match-2'); room.abortMatch('server-error'); assert.equal(scheduler.callbacks.size,0);
});

test('reconnect-capable membership reserves, resumes with rotation, and expires safely', async t=>{
 const oldR=globalThis.Response,oldW=globalThis.WebSocketPair,pairs=[];globalThis.Response=FakeResponse;globalThis.WebSocketPair=class{constructor(){this.client=new Socket();this.server=new Socket();pairs.push(this);}};
 t.after(()=>{globalThis.Response=oldR;if(oldW===undefined)delete globalThis.WebSocketPair;else globalThis.WebSocketPair=oldW;});
 const ctx=new Context(),scheduler=new Scheduler();let now=100,id=0,token=0;
 const room=new RaidRoom(ctx,{scheduler,now:()=>now,createMatchId:()=>`match-${++id}`,createResumeToken:()=>`${++token}`.padStart(64,'0')});
 const capable=new Request('https://x/ws?roomId=room&reconnect=1',{headers:{Upgrade:'websocket'}}),normal=new Request('https://x/ws?roomId=room',{headers:{Upgrade:'websocket'}});
 await room.fetch(capable);await room.fetch(normal);const gone=pairs[0].server,survivor=pairs[1].server,host=room.host,oldToken=last(gone,'resume-ticket').resumeToken;
 room.webSocketMessage(gone,JSON.stringify({version:2,type:'input',matchId:'match-1',seq:7,command:{type:'move',x:1,y:1}}));
 room.webSocketMessage(survivor,JSON.stringify({version:2,type:'input',matchId:'match-1',seq:9,command:{type:'dash'}}));
 room.webSocketError(gone);assert.equal(room.host,host);assert.equal(scheduler.callbacks.size,1);assert.equal(scheduler.timeouts.size,1);assert.equal(last(survivor,'match-aborted'),undefined);
 scheduler.tick();assert.equal(frames(survivor).at(-1).snapshot.players[0].moveX,0);assert.equal(frames(survivor).at(-1).snapshot.players[0].firing,false);
 assert.equal((await room.fetch(normal)).status,409);
 await room.fetch(new Request('https://x/ws?roomId=room&resume=1',{headers:{Upgrade:'websocket'}}));const pending=pairs.at(-1).server;
 await room.fetch(new Request('https://x/ws?roomId=room&resume=1',{headers:{Upgrade:'websocket'}}));const replay=pairs.at(-1).server;
 assert.equal(last(survivor,'roster').players.length,1);const beforeTick=frames(survivor).at(-1).tick;
 room.webSocketMessage(pending,JSON.stringify({version:2,type:'resume',matchId:'match-1',connectionId:gone.attachment.connectionId,resumeToken:oldToken}));
 assert.equal(pending.attachment.connectionId,gone.attachment.connectionId);assert.equal(pending.attachment.slot,gone.attachment.slot);assert.equal(pending.attachment.lastInputSeq,-1);assert.equal(room.host,host);assert.equal(last(pending,'welcome').connectionId,gone.attachment.connectionId);assert.notEqual(last(pending,'resume-ticket').resumeToken,oldToken);assert.equal(frames(pending).at(-1).tick,beforeTick);assert.deepEqual(frames(pending).at(-1).events,[]);assert.equal(survivor.attachment.lastInputSeq,9);
 assert.equal(room.pendingResumeAuth.size,1);
 room.webSocketMessage(replay,JSON.stringify({version:2,type:'resume',matchId:'match-1',connectionId:gone.attachment.connectionId,resumeToken:oldToken}));assert.equal(last(replay,'error').code,'resume-rejected');assert.equal(replay.closed,true);assert.equal(room.pendingResumeAuth.size,0);
 room.webSocketError(pending);const deadline=room.reservations.get(pending.attachment.connectionId).deadline;room.handleDeparture(pending);assert.equal(room.reservations.get(pending.attachment.connectionId).deadline,deadline);assert.equal(scheduler.timeouts.size,1);
 now=deadline;scheduler.expire();assert.equal(room.host,null);assert.equal(scheduler.callbacks.size,0);assert.equal(survivor.attachment.matchState,'waiting');assert.equal(last(survivor,'match-aborted').reason,'player-left');assert.equal(room.reservations.size,0);
 ctx.remove(gone);ctx.remove(pending);ctx.remove(replay);await room.fetch(normal);assert.equal(room.host?.getMatchId(),'match-2');
});

test('intentional capable close aborts immediately without reservation',async t=>{
 const oldR=globalThis.Response,oldW=globalThis.WebSocketPair,pairs=[];globalThis.Response=FakeResponse;globalThis.WebSocketPair=class{constructor(){this.client=new Socket();this.server=new Socket();pairs.push(this);}};t.after(()=>{globalThis.Response=oldR;if(oldW===undefined)delete globalThis.WebSocketPair;else globalThis.WebSocketPair=oldW;});
 const ctx=new Context(),scheduler=new Scheduler(),room=new RaidRoom(ctx,{scheduler,createMatchId:()=> 'm',createResumeToken:()=> 'a'.repeat(64)}),req=new Request('https://x/ws?roomId=room&reconnect=1',{headers:{Upgrade:'websocket'}});await room.fetch(req);await room.fetch(req);room.webSocketClose(pairs[0].server,1000,'Session closed',true);assert.equal(room.host,null);assert.equal(room.reservations.size,0);assert.equal(last(pairs[1].server,'match-aborted').reason,'player-left');
});

test('pending resume authentication is bounded, expiring, and independent of reservations',async t=>{
 const oldR=globalThis.Response,oldW=globalThis.WebSocketPair,pairs=[];globalThis.Response=FakeResponse;globalThis.WebSocketPair=class{constructor(){this.client=new Socket();this.server=new Socket();pairs.push(this);}};t.after(()=>{globalThis.Response=oldR;if(oldW===undefined)delete globalThis.WebSocketPair;else globalThis.WebSocketPair=oldW;});
 const ctx=new Context(),scheduler=new Scheduler();let token=0;const room=new RaidRoom(ctx,{scheduler,createMatchId:()=> 'match',createResumeToken:()=>`${++token}`.padStart(64,'0')}),join=new Request('https://x/ws?roomId=room&reconnect=1',{headers:{Upgrade:'websocket'}}),resume=new Request('https://x/ws?roomId=room&resume=1',{headers:{Upgrade:'websocket'}});await room.fetch(join);await room.fetch(join);const absent=pairs[0].server;room.webSocketError(absent);const reservation=room.reservations.get(absent.attachment.connectionId);
 await room.fetch(resume);await room.fetch(resume);const silentOne=pairs[2].server,silentTwo=pairs[3].server;assert.equal(room.pendingResumeAuth.size,2);assert.equal((await room.fetch(resume)).status,429);scheduler.expire(PENDING_RESUME_AUTH_MS);assert.equal(silentOne.closed,true);assert.equal(silentTwo.closed,true);assert.equal(room.pendingResumeAuth.size,0);assert.equal(room.reservations.get(reservation.connectionId),reservation);
 assert.equal((await room.fetch(resume)).status,101);const invalid=pairs.at(-1).server;room.webSocketMessage(invalid,JSON.stringify({version:2,type:'resume',matchId:'wrong',connectionId:reservation.connectionId,resumeToken:reservation.resumeToken}));assert.equal(last(invalid,'error').code,'resume-rejected');assert.equal(invalid.closed,true);assert.equal(room.pendingResumeAuth.size,0);assert.equal(room.reservations.get(reservation.connectionId),reservation);
 await room.fetch(resume);const closing=pairs.at(-1).server;room.webSocketClose(closing,1001,'away',false);room.webSocketError(closing);assert.equal(room.pendingResumeAuth.size,0);assert.equal(room.host?.getMatchId(),'match');assert.equal(room.reservations.get(reservation.connectionId),reservation);
 await room.fetch(resume);const retired=pairs.at(-1).server;room.abortMatch('server-error');assert.equal(retired.closed,true);assert.equal(room.pendingResumeAuth.size,0);assert.equal(room.reservations.size,0);
});

test('terminal frame during grace retires reservations and returns survivor to waiting',async t=>{
 const oldR=globalThis.Response,oldW=globalThis.WebSocketPair,pairs=[];globalThis.Response=FakeResponse;globalThis.WebSocketPair=class{constructor(){this.client=new Socket();this.server=new Socket();pairs.push(this);}};t.after(()=>{globalThis.Response=oldR;if(oldW===undefined)delete globalThis.WebSocketPair;else globalThis.WebSocketPair=oldW;});
 let id=0;const frame=status=>({version:2,type:'state-frame',matchId:`m${id}`,tick:1,snapshot:{status},events:[]});
 const hosts=[];const createHost=matchId=>{const host={getMatchId:()=>matchId,initialFrame:()=>frame('active'),tick:()=>frame('won'),applyCommand(){},currentFrame:()=>frame('active')};hosts.push(host);return host;};
 const ctx=new Context(),scheduler=new Scheduler(),room=new RaidRoom(ctx,{scheduler,createMatchId:()=>`m${++id}`,createHost,createResumeToken:()=> 'a'.repeat(64)}),capable=new Request('https://x/ws?roomId=room&reconnect=1',{headers:{Upgrade:'websocket'}}),resume=new Request('https://x/ws?roomId=room&resume=1',{headers:{Upgrade:'websocket'}});await room.fetch(capable);await room.fetch(capable);const absent=pairs[0].server,survivor=pairs[1].server;room.webSocketError(absent);await room.fetch(resume);const stalePending=pairs.at(-1).server;scheduler.tick();assert.equal(frames(survivor).at(-1).snapshot.status,'won');assert.equal(room.reservations.size,0);assert.equal(room.pendingResumeAuth.size,0);assert.equal(stalePending.closed,true);assert.equal(room.host,null);assert.equal(survivor.attachment.matchState,'waiting');ctx.remove(absent);await room.fetch(capable);assert.equal(room.host,hosts[1]);assert.equal(room.host.getMatchId(),'m2');room.webSocketMessage(stalePending,JSON.stringify({version:2,type:'resume',matchId:'m1',connectionId:absent.attachment.connectionId,resumeToken:'a'.repeat(64)}));assert.equal(stalePending.attachment.socketType,'pending-resume');
});

test('broadcast skips CLOSING sockets and abort cleanup survives a throwing send', async t=>{
 const oldR=globalThis.Response,oldW=globalThis.WebSocketPair,pairs=[]; globalThis.Response=FakeResponse; globalThis.WebSocketPair=class{constructor(){this.client=new Socket();this.server=new Socket();pairs.push(this);}};
 t.after(()=>{globalThis.Response=oldR;if(oldW===undefined)delete globalThis.WebSocketPair;else globalThis.WebSocketPair=oldW;});
 const ctx=new Context(),scheduler=new Scheduler(),room=new RaidRoom(ctx,{scheduler,createMatchId:()=> 'failure-match'}),req=new Request('https://x/ws?roomId=room',{headers:{Upgrade:'websocket'}});
 await room.fetch(req);await room.fetch(req);const survivor=pairs[0].server,departing=pairs[1].server;
 departing.readyState=2;const count=departing.messages.length;scheduler.tick();assert.equal(departing.messages.length,count);assert.equal(frames(survivor).at(-1).tick,1);
 survivor.throwOnSend=true;room.webSocketClose(departing,1001,'away',true);
 assert.equal(scheduler.callbacks.size,0);assert.equal(room.host,null);assert.equal(survivor.attachment.matchState,'waiting');
});

test('webSocketError closes and excludes the failed socket while the survivor waits',async t=>{
 const oldR=globalThis.Response,oldW=globalThis.WebSocketPair,pairs=[];globalThis.Response=FakeResponse;globalThis.WebSocketPair=class{constructor(){this.client=new Socket();this.server=new Socket();pairs.push(this);}};
 t.after(()=>{globalThis.Response=oldR;if(oldW===undefined)delete globalThis.WebSocketPair;else globalThis.WebSocketPair=oldW;});
 const ctx=new Context(),scheduler=new Scheduler(),room=new RaidRoom(ctx,{scheduler,createMatchId:()=> 'error-match'}),req=new Request('https://x/ws?roomId=room',{headers:{Upgrade:'websocket'}});await room.fetch(req);await room.fetch(req);const survivor=pairs[0].server,failed=pairs[1].server,failedCount=failed.messages.length;
 room.webSocketError(failed);assert.deepEqual(failed.closeArgs.at(-1),[1011,'WebSocket error']);assert.equal(failed.messages.length,failedCount);assert.equal(last(survivor,'match-aborted').reason,'player-left');assert.equal(survivor.attachment.matchState,'waiting');assert.equal(scheduler.callbacks.size,0);
});

test('CLOSING membership neither consumes capacity nor starts a match before replacement',async t=>{
 const oldR=globalThis.Response,oldW=globalThis.WebSocketPair,pairs=[];globalThis.Response=FakeResponse;globalThis.WebSocketPair=class{constructor(){this.client=new Socket();this.server=new Socket();pairs.push(this);}};
 t.after(()=>{globalThis.Response=oldR;if(oldW===undefined)delete globalThis.WebSocketPair;else globalThis.WebSocketPair=oldW;});
 const open=new Socket(),closing=new Socket();open.serializeAttachment({connectionId:'open',slot:1,lastInputSeq:-1,matchId:null,matchState:'waiting'});closing.serializeAttachment({connectionId:'closing',slot:2,lastInputSeq:-1,matchId:null,matchState:'waiting'});closing.readyState=2;
 const ctx=new Context();ctx.sockets=[open,closing];const scheduler=new Scheduler(),room=new RaidRoom(ctx,{scheduler,createMatchId:()=> 'replacement-match'});
 assert.deepEqual(room.coordinator().roster(),[{connectionId:'open',slot:1}]);assert.equal(room.host,null);assert.equal(scheduler.callbacks.size,0);assert.equal(open.attachment.matchState,'waiting');
 const response=await room.fetch(new Request('https://x/ws?roomId=room',{headers:{Upgrade:'websocket'}})),replacement=pairs[0].server;
 assert.equal(response.status,101);assert.equal(scheduler.callbacks.size,1);assert.notEqual(room.host,null);assert.equal(open.attachment.matchState,'active');assert.equal(replacement.attachment.matchState,'active');assert.equal(closing.attachment.matchState,'waiting');assert.equal(frames(closing).length,0);
});

test('stale recovery clears active metadata even when sends throw or sockets are CLOSING',()=>{
 const healthy=new Socket(),closing=new Socket();healthy.serializeAttachment({connectionId:'healthy',slot:1,lastInputSeq:3,matchId:'old-match',matchState:'active'});closing.serializeAttachment({connectionId:'closing',slot:2,lastInputSeq:4,matchId:'old-match',matchState:'active'});healthy.throwOnSend=true;closing.readyState=2;
 const ctx=new Context();ctx.sockets=[healthy,closing];const scheduler=new Scheduler();assert.doesNotThrow(()=>new RaidRoom(ctx,{scheduler}));assert.equal(healthy.attachment.matchState,'waiting');assert.equal(healthy.attachment.matchId,null);assert.equal(closing.attachment.matchState,'waiting');assert.equal(closing.attachment.matchId,null);assert.equal(scheduler.callbacks.size,0);
});
