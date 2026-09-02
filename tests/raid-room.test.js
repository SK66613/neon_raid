import assert from 'node:assert/strict'; import test from 'node:test'; import { RaidRoom } from '../server/RaidRoom.js';
class Socket { constructor(){this.messages=[];this.attachment=null;this.closed=false;this.readyState=1;this.closeArgs=[];this.throwOnSend=false;} send(v){if(this.throwOnSend)throw new Error('broken send');this.messages.push(JSON.parse(v));} serializeAttachment(v){this.attachment=structuredClone(v);} deserializeAttachment(){return structuredClone(this.attachment);} close(code,reason){this.closed=true;this.readyState=3;this.closeArgs.push([code,reason]);} }
class Context { constructor(){this.sockets=[];} acceptWebSocket(s){this.sockets.push(s);} getWebSockets(){return [...this.sockets];} remove(s){this.sockets=this.sockets.filter(x=>x!==s);} }
class FakeResponse { constructor(body,init={}){this.body=body;this.status=init.status??200;this.webSocket=init.webSocket;} static json(v,init){return new FakeResponse(JSON.stringify(v),init);} async json(){return JSON.parse(this.body);} }
class Scheduler { constructor(){this.callbacks=new Map();this.next=1;this.clears=0;} setInterval(fn,ms){assert.equal(ms,1000/30);const id=this.next++;this.callbacks.set(id,fn);return id;} clearInterval(id){this.clears++;this.callbacks.delete(id);} tick(){for(const fn of [...this.callbacks.values()])fn();} }
const last=(s,type)=>s.messages.filter(m=>m.type===type).at(-1); const frames=s=>s.messages.filter(m=>m.type==='state-frame');

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
 room.webSocketMessage(one,JSON.stringify({version:2,type:'input',matchId:'match-1',seq:4,command:{type:'move',x:1,y:0}})); assert.deepEqual(last(one,'input-ack'),{version:2,type:'input-ack',matchId:'match-1',seq:4}); assert.equal(frames(one).length,before); assert.deepEqual(one.attachment,{connectionId:one.attachment.connectionId,slot:1,lastInputSeq:4,matchId:'match-1',matchState:'active'});
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
