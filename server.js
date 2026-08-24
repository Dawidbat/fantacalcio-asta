
const path=require("path"), fs=require("fs"), express=require("express"), http=require("http"), {Server}=require("socket.io");
const app=express(), server=http.createServer(app), io=new Server(server), PORT=process.env.PORT||3000;
app.use(express.static(__dirname));
const BASE=JSON.parse(fs.readFileSync(path.join(__dirname,"players.json"),"utf8"));
const SAVE=path.join(__dirname,"rooms.json");
const DEFAULT={budget:500,seconds:7,squad:{P:3,D:8,C:8,A:7},maxPlayers:26,minPlayers:2};
const PHASES=["P","D","C","A"];
const rooms=new Map();
function load(){try{const x=JSON.parse(fs.readFileSync(SAVE));for(const [code,r] of Object.entries(x)){r.users=new Map(Object.entries(r.users||{}));r.settings={...DEFAULT,...r.settings,seconds:7,squad:{...DEFAULT.squad,...r.settings?.squad,A:7}};r.phaseIndex=Number.isInteger(r.phaseIndex)?r.phaseIndex:0;r.phaseDone=!!r.phaseDone;r.auction=null;r.connected={};rooms.set(code,r)}}catch{}}
function persist(){const out={};for(const [c,r] of rooms){out[c]={...r,users:Object.fromEntries(r.users)}}fs.writeFileSync(SAVE,JSON.stringify(out,null,2))}
load();
function code(){let c;do c=Math.random().toString(36).slice(2,7).toUpperCase();while(rooms.has(c));return c}
function name(v){return String(v||"").trim().replace(/\s+/g," ").slice(0,24)}
function clientId(v){return String(v||"").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,64)}
function user(r,id){return r.users.get(id)}
function attach(r,s,id){r.connected[id]=s.id;s.join(r.code);s.data.room=r.code;s.data.userId=id}
function phaseRole(r){return PHASES[r.phaseIndex]}
function hasRoleSpace(r,u,role){return u.team.length<r.settings.maxPlayers&&u.team.filter(p=>p.role===role).length<r.settings.squad[role]}
function canPropose(r,u){return hasRoleSpace(r,u,phaseRole(r))&&u.budget>=1}
function advancePhase(r){if(r.phaseDone)return;if(r.phaseIndex===PHASES.length-1){r.phaseDone=true;log(r,"✅ Asta completata.");return}r.phaseIndex++;ensureCurrent(r);log(r,`➡️ Fase ${phaseRole(r)} iniziata.`)}
function ensureCurrent(r){const ids=[...r.users.keys()];for(let n=0;n<ids.length;n++){const i=(r.turnIndex+n)%ids.length;if(canPropose(r,r.users.get(ids[i]))){r.turnIndex=i;return}}}
function nextTurn(r){r.turnIndex=(r.turnIndex+1)%Math.max(r.users.size,1);ensureCurrent(r)}
function publicRoom(r){
 return {code:r.code,serverNow:Date.now(),adminId:r.adminId,settings:r.settings,started:r.started,turnIndex:r.turnIndex,phaseRole:phaseRole(r),phaseDone:r.phaseDone,
  users:[...r.users.values()].map(u=>({id:u.id,name:u.name,budget:u.budget,team:u.team,connected:!!r.connected[u.id]})),
  available:r.available,auction:r.auction?{...r.auction}:null,log:r.log.slice(-35),lastSale:r.lastSale||null};
}
function emit(r){io.to(r.code).emit("state",publicRoom(r));persist()}
function log(r,t){r.log.push({text:t,at:Date.now()})}
function current(r){const ids=[...r.users.keys()];return ids.length?ids[r.turnIndex%ids.length]:null}
function findUserByName(r,n){return [...r.users.values()].find(u=>u.name.toLowerCase()===n.toLowerCase())}
function end(r){
 if(!r.auction)return;
 const a=r.auction,w=a.bidderId?r.users.get(a.bidderId):null;
 const i=r.available.findIndex(p=>p.name===a.player.name);
 if(w&&i>=0){
   const role=a.player.role;
   if(!hasRoleSpace(r,w,role)){ log(r,`Asta annullata: ${w.name} ha raggiunto il limite ${role}.`); }
   else if(w.budget<a.currentBid){log(r,`Asta annullata: budget insufficiente.`);}
   else{
     w.budget-=a.currentBid; w.team.push({...a.player,price:a.currentBid}); r.available.splice(i,1);
     r.lastSale={player:a.player.name,buyer:w.name,price:a.currentBid,at:Date.now()};
     log(r,`🏆 ${w.name} compra ${a.player.name} per ${a.currentBid}.`);
   }
 }else log(r,`Nessuna offerta per ${a.player.name}.`);
 r.auction=null;nextTurn(r);emit(r);
}
function start(r,id,pn){
 if(r.auction)return "C'è già un'asta in corso.";
 if(r.phaseDone)return "L'asta è terminata.";
 if(current(r)!==id)return "Non è il tuo turno.";
 const i=r.available.findIndex(p=>p.name===pn);if(i<0)return "Giocatore non disponibile.";
 if(r.available[i].role!==phaseRole(r))return `In questa fase puoi proporre solo giocatori ${phaseRole(r)}.`;
 const proposer=user(r,id);if(proposer.budget<1)return "Budget insufficiente.";
 if(!hasRoleSpace(r,proposer,r.available[i].role))return `Hai raggiunto il limite ${r.available[i].role}.`;
 r.auction={player:r.available[i],proposerId:id,currentBid:1,bidderId:id,bidderName:proposer.name,endsAt:Date.now()+r.settings.seconds*1000};
 log(r,`${user(r,id).name} propone ${pn}.`);emit(r);
}
function offer(r,id,inc){
 const a=r.auction,u=user(r,id);if(!a||!u)return "Nessuna asta attiva.";
 if(Date.now()>=a.endsAt)return "Tempo scaduto.";
 if(!hasRoleSpace(r,u,a.player.role))return `Hai raggiunto il limite ${a.player.role}.`;
 const amount=a.currentBid+inc;if(amount>u.budget)return "Budget insufficiente.";
 a.currentBid=amount;a.bidderId=id;a.bidderName=u.name;a.endsAt=Date.now()+r.settings.seconds*1000;
 log(r,`${u.name} offre ${amount} per ${a.player.name}.`);emit(r);
}
io.on("connection",s=>{
 s.on("createRoom",({name:n,budget,clientId:id})=>{
  n=name(n);id=clientId(id);if(!n)return s.emit("errorMessage","Inserisci il nome.");if(!id)return s.emit("errorMessage","Sessione non valida.");
  const c=code(),r={code:c,adminId:id,settings:{...DEFAULT,budget:Number(budget)>0?Number(budget):500},users:new Map(),connected:{},available:BASE.map(x=>({...x})),turnIndex:0,phaseIndex:0,phaseDone:false,auction:null,started:false,log:[],lastSale:null};
  r.users.set(id,{id,name:n,budget:r.settings.budget,team:[]});rooms.set(c,r);attach(r,s,id);log(r,`👑 ${n} ha creato la lega.`);emit(r);
 });
 s.on("joinRoom",({code:c,name:n,clientId:id})=>{
  c=String(c||"").toUpperCase().trim();n=name(n);id=clientId(id);const r=rooms.get(c);
  if(!r)return s.emit("errorMessage","Codice stanza non trovato.");
  if(!n)return s.emit("errorMessage","Inserisci il nome.");if(!id)return s.emit("errorMessage","Sessione non valida.");
  if(r.users.has(id)){attach(r,s,id);return emit(r)}
  if(findUserByName(r,n))return s.emit("errorMessage","Nome già utilizzato.");
  if(r.started)return s.emit("errorMessage","L'asta è già iniziata.");
  r.users.set(id,{id,name:n,budget:r.settings.budget,team:[]});attach(r,s,id);log(r,`${n} è entrato nella lega.`);emit(r);
 });
 s.on("rejoinRoom",({code:c,clientId:id})=>{const r=rooms.get(String(c||"").toUpperCase().trim());id=clientId(id);if(!r||!r.users.has(id))return s.emit("errorMessage","Sessione stanza non trovata.");attach(r,s,id);emit(r)});
 s.on("leaveRoom",()=>{const r=rooms.get(s.data.room),id=s.data.userId;if(!r||!id)return;r.connected[id]=false;s.leave(r.code);s.data.room=null;s.data.userId=null;emit(r)});
 s.on("start",()=>{const r=rooms.get(s.data.room),id=s.data.userId;if(!r||r.adminId!==id)return;if(r.users.size<r.settings.minPlayers)return s.emit("errorMessage",`Servono almeno ${r.settings.minPlayers} partecipanti.`);r.started=true;ensureCurrent(r);log(r,"🚀 Asta iniziata.");emit(r)});
 s.on("nextPhase",()=>{const r=rooms.get(s.data.room),id=s.data.userId;if(!r||r.adminId!==id)return;if(!r.started)return s.emit("errorMessage","Avvia prima l'asta.");if(r.auction)return s.emit("errorMessage","Attendi la fine dell'asta in corso.");if(r.phaseDone)return s.emit("errorMessage","L'asta è già terminata.");advancePhase(r);emit(r)});
 s.on("propose",({playerName})=>{const r=rooms.get(s.data.room),id=s.data.userId;if(r?.started&&id){const e=start(r,id,playerName);if(e)s.emit("errorMessage",e)}});
 s.on("bid",({increment})=>{const r=rooms.get(s.data.room),id=s.data.userId,n=Number(increment);if(r&&id&&[1,2,5,10,15].includes(n)){const e=offer(r,id,n);if(e)s.emit("errorMessage",e)}});
 s.on("undoSale",()=>{const r=rooms.get(s.data.room),id=s.data.userId;if(!r||r.adminId!==id||!r.lastSale)return;const sale=r.lastSale,u=findUserByName(r,sale.buyer),p=BASE.find(x=>x.name===sale.player);if(!u||!p)return;const ti=u.team.findIndex(x=>x.name===sale.player&&x.price===sale.price);if(ti>=0){u.team.splice(ti,1);u.budget+=sale.price;r.available.push({...p});r.phaseIndex=Math.min(r.phaseIndex,PHASES.indexOf(p.role));r.phaseDone=false;log(r,`↩️ ${sale.player} è stato restituito a ${u.name}.`);r.lastSale=null;emit(r)}});
 s.on("displayMode",()=>s.emit("displayState",publicRoom(rooms.get(s.data.room))));
 s.on("disconnect",()=>{const r=rooms.get(s.data.room),id=s.data.userId;if(r&&id&&r.connected[id]===s.id){r.connected[id]=false;emit(r)}});
});
setInterval(()=>{for(const r of rooms.values())if(r.auction&&Date.now()>=r.auction.endsAt)end(r)},200);
server.listen(PORT,()=>console.log(`Fantacalcio: http://localhost:${PORT}`));
