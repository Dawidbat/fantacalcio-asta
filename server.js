
const path=require("path"), fs=require("fs"), express=require("express"), http=require("http"), {Server}=require("socket.io");
const app=express(), server=http.createServer(app), io=new Server(server), PORT=process.env.PORT||3000;
app.use(express.static(path.join(__dirname,"public")));
const BASE=JSON.parse(fs.readFileSync(path.join(__dirname,"players.json"),"utf8"));
const SAVE=path.join(__dirname,"rooms.json");
const DEFAULT={budget:500,seconds:15,squad:{P:3,D:8,C:8,A:6},minPlayers:2};
const rooms=new Map();
function load(){try{const x=JSON.parse(fs.readFileSync(SAVE));for(const [code,r] of Object.entries(x)){r.users=new Map(Object.entries(r.users||{}));r.auction=null;r.connected={};rooms.set(code,r)}}catch{}}
function persist(){const out={};for(const [c,r] of rooms){out[c]={...r,users:Object.fromEntries(r.users)}}fs.writeFileSync(SAVE,JSON.stringify(out,null,2))}
load();
function code(){let c;do c=Math.random().toString(36).slice(2,7).toUpperCase();while(rooms.has(c));return c}
function name(v){return String(v||"").trim().replace(/\s+/g," ").slice(0,24)}
function user(r,id){return r.users.get(id)}
function publicRoom(r){
 return {code:r.code,adminId:r.adminId,settings:r.settings,started:r.started,turnIndex:r.turnIndex,
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
   const role=a.player.role, max=r.settings.squad[role];
   if(w.team.filter(x=>x.role===role).length>=max){ log(r,`Asta annullata: ${w.name} ha raggiunto il limite ${role}.`); }
   else if(w.budget<a.currentBid){log(r,`Asta annullata: budget insufficiente.`);}
   else{
     w.budget-=a.currentBid; w.team.push({...a.player,price:a.currentBid}); r.available.splice(i,1);
     r.lastSale={player:a.player.name,buyer:w.name,price:a.currentBid,at:Date.now()};
     log(r,`🏆 ${w.name} compra ${a.player.name} per ${a.currentBid}.`);
   }
 }else log(r,`Nessuna offerta per ${a.player.name}.`);
 r.auction=null;r.turnIndex=(r.turnIndex+1)%Math.max(r.users.size,1);emit(r);
}
function start(r,id,pn){
 if(r.auction)return "C'è già un'asta in corso.";
 if(current(r)!==id)return "Non è il tuo turno.";
 const i=r.available.findIndex(p=>p.name===pn);if(i<0)return "Giocatore non disponibile.";
 r.auction={player:r.available[i],proposerId:id,currentBid:0,bidderId:null,bidderName:null,endsAt:Date.now()+r.settings.seconds*1000};
 log(r,`${user(r,id).name} propone ${pn}.`);emit(r);
}
function offer(r,id,inc){
 const a=r.auction,u=user(r,id);if(!a||!u)return "Nessuna asta attiva.";
 if(Date.now()>=a.endsAt)return "Tempo scaduto.";
 const amount=a.currentBid+inc;if(amount>u.budget)return "Budget insufficiente.";
 a.currentBid=amount;a.bidderId=id;a.bidderName=u.name;a.endsAt=Date.now()+r.settings.seconds*1000;
 log(r,`${u.name} offre ${amount} per ${a.player.name}.`);emit(r);
}
io.on("connection",s=>{
 s.on("createRoom",({name:n,budget})=>{
  n=name(n);if(!n)return s.emit("errorMessage","Inserisci il nome.");
  const c=code(),r={code:c,adminId:s.id,settings:{...DEFAULT,budget:Number(budget)>0?Number(budget):500},users:new Map(),connected:{},available:BASE.map(x=>({...x})),turnIndex:0,auction:null,started:false,log:[],lastSale:null};
  r.users.set(s.id,{id:s.id,name:n,budget:r.settings.budget,team:[]});r.connected[s.id]=true;rooms.set(c,r);s.join(c);s.data.room=c;log(r,`👑 ${n} ha creato la lega.`);emit(r);
 });
 s.on("joinRoom",({code:c,name:n})=>{
  c=String(c||"").toUpperCase().trim();n=name(n);const r=rooms.get(c);
  if(!r)return s.emit("errorMessage","Codice stanza non trovato.");
  if(!n)return s.emit("errorMessage","Inserisci il nome.");
  if(findUserByName(r,n))return s.emit("errorMessage","Nome già utilizzato.");
  if(r.started)return s.emit("errorMessage","L'asta è già iniziata.");
  r.users.set(s.id,{id:s.id,name:n,budget:r.settings.budget,team:[]});r.connected[s.id]=true;s.join(c);s.data.room=c;log(r,`${n} è entrato nella lega.`);emit(r);
 });
 s.on("start",()=>{const r=rooms.get(s.data.room);if(!r||r.adminId!==s.id)return;if(r.users.size<r.settings.minPlayers)return s.emit("errorMessage",`Servono almeno ${r.settings.minPlayers} partecipanti.`);r.started=true;log(r,"🚀 Asta iniziata.");emit(r)});
 s.on("propose",({playerName})=>{const r=rooms.get(s.data.room);if(r?.started){const e=start(r,s.id,playerName);if(e)s.emit("errorMessage",e)}});
 s.on("bid",({increment})=>{const r=rooms.get(s.data.room),n=Number(increment);if(r&&[1,2,5,10,15].includes(n)){const e=offer(r,s.id,n);if(e)s.emit("errorMessage",e)}});
 s.on("undoSale",()=>{const r=rooms.get(s.data.room);if(!r||r.adminId!==s.id||!r.lastSale)return;const sale=r.lastSale,u=findUserByName(r,sale.buyer),p=BASE.find(x=>x.name===sale.player);if(!u||!p)return;const ti=u.team.findIndex(x=>x.name===sale.player&&x.price===sale.price);if(ti>=0){u.team.splice(ti,1);u.budget+=sale.price;r.available.push({...p});log(r,`↩️ ${sale.player} è stato restituito a ${u.name}.`);r.lastSale=null;emit(r)}});
 s.on("displayMode",()=>s.emit("displayState",publicRoom(rooms.get(s.data.room))));
 s.on("disconnect",()=>{const r=rooms.get(s.data.room);if(r){r.connected[s.id]=false;emit(r)}});
});
setInterval(()=>{for(const r of rooms.values())if(r.auction&&Date.now()>=r.auction.endsAt)end(r)},200);
server.listen(PORT,()=>console.log(`Fantacalcio: http://localhost:${PORT}`));
