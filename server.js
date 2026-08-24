
const path=require("path"), fs=require("fs"), crypto=require("crypto"), express=require("express"), http=require("http"), archiver=require("archiver"), {PDFDocument}=require("pdf-lib"), {Server}=require("socket.io");
const app=express(), server=http.createServer(app), io=new Server(server), PORT=process.env.PORT||3000;
app.use(express.static(__dirname));
const BASE=JSON.parse(fs.readFileSync(path.join(__dirname,"players.json"),"utf8"));
const SAVE=path.join(__dirname,"rooms.json");
const ROSTER_TEMPLATE=path.join(__dirname,"templates","asta_fantacalcio_serie_a_una_colonna_hd.pdf");
const DEFAULT={budget:500,seconds:7,squad:{P:3,D:8,C:8,A:7},maxPlayers:26,minPlayers:2};
const PHASES=["P","D","C","A"];
const ROLE_NAMES={P:"portieri",D:"difensori",C:"centrocampisti",A:"attaccanti"};
const rooms=new Map();
function load(){try{const x=JSON.parse(fs.readFileSync(SAVE));for(const r of Object.values(x)){r.users=new Map(Object.entries(r.users||{}));r.code=code();for(const u of r.users.values())u.recoveryCode=newRecoveryCode(r);r.turnOrder=turnOrder(r);r.settings={...DEFAULT,...r.settings,seconds:7,squad:{...DEFAULT.squad,...r.settings?.squad,A:7}};r.phaseIndex=Number.isInteger(r.phaseIndex)?r.phaseIndex:0;r.phaseDone=!!r.phaseDone;r.auction=null;r.connected={};r.salesHistory=Array.isArray(r.salesHistory)?r.salesHistory:(r.lastSale?[r.lastSale]:[]);r.lastSale=r.salesHistory.at(-1)||null;rooms.set(r.code,r)}persist()}catch{}}
function persist(){const out={};for(const [c,r] of rooms){out[c]={...r,users:Object.fromEntries(r.users)}}fs.writeFileSync(SAVE,JSON.stringify(out,null,2))}
load();
function code(){let c;do c=crypto.randomInt(0,10000).toString().padStart(4,"0");while(rooms.has(c));return c}
function name(v){return String(v||"").trim().replace(/\s+/g," ").slice(0,24)}
function clientId(v){return String(v||"").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,64)}
function recoveryCode(v){return String(v||"").replace(/\D/g,"").slice(0,4)}
function formatRecoveryCode(v){return v}
function newRecoveryCode(r){let c;do c=crypto.randomInt(0,10000).toString().padStart(4,"0");while([...r.users.values()].some(u=>u.recoveryCode===c));return c}
function user(r,id){return r.users.get(id)}
function turnOrder(r){const ids=[...r.users.keys()],saved=Array.isArray(r.turnOrder)?r.turnOrder:[];return [...saved.filter(id=>r.users.has(id)),...ids.filter(id=>!saved.includes(id))]}
function attach(r,s,id){const oldId=r.connected[id],old=oldId&&io.sockets?.sockets?.get(oldId);if(old&&old.id!==s.id){old.leave(r.code);old.data.room=null;old.data.userId=null}r.connected[id]=s.id;s.join(r.code);s.data.room=r.code;s.data.userId=id}
function sendRecoveryCode(s,r,u){s.emit("recoveryCode",{roomCode:r.code,userId:u.id,code:formatRecoveryCode(u.recoveryCode)})}
function phaseRole(r){return PHASES[r.phaseIndex]}
function hasRoleSpace(r,u,role){return u.team.length<r.settings.maxPlayers&&u.team.filter(p=>p.role===role).length<r.settings.squad[role]}
function maxBid(r,u){return u.budget-Math.max(0,r.settings.maxPlayers-u.team.length-1)}
function canPropose(r,u){return hasRoleSpace(r,u,phaseRole(r))&&maxBid(r,u)>=1}
function advancePhase(r){if(r.phaseDone)return;if(r.phaseIndex===PHASES.length-1){r.phaseDone=true;log(r,"✅ Asta completata.");return}r.phaseIndex++;ensureCurrent(r);log(r,`➡️ Fase ${phaseRole(r)} iniziata.`)}
function ensureCurrent(r){const ids=turnOrder(r);for(let n=0;n<ids.length;n++){const i=(r.turnIndex+n)%ids.length;if(canPropose(r,r.users.get(ids[i]))){r.turnIndex=i;return}}}
function nextTurn(r){r.turnIndex=(r.turnIndex+1)%Math.max(turnOrder(r).length,1);ensureCurrent(r)}
function publicRoom(r,includeAvailable=true){
 const state={code:r.code,serverNow:Date.now(),adminId:r.adminId,settings:r.settings,started:r.started,turnIndex:r.turnIndex,turnOrder:turnOrder(r),phaseRole:phaseRole(r),phaseDone:r.phaseDone,
  users:[...r.users.values()].map(u=>({id:u.id,name:u.name,budget:u.budget,team:u.team,connected:!!r.connected[u.id]})),
  auction:r.auction?{...r.auction}:null,log:r.log.slice(-35),lastSale:r.lastSale||null,undoCount:r.salesHistory?.length||0};
 if(includeAvailable)state.available=r.available;return state;
}
function emit(r,includeAvailable=true){io.to(r.code).emit("state",publicRoom(r,includeAvailable));persist()}
function log(r,t){r.log.push({text:t,at:Date.now()})}
function current(r){const ids=turnOrder(r);return ids.length?ids[r.turnIndex%ids.length]:null}
function findUserByName(r,n){return [...r.users.values()].find(u=>u.name.toLowerCase()===n.toLowerCase())}
function isAuctionComplete(r){return r.users.size>0&&[...r.users.values()].every(u=>u.team.length>=r.settings.maxPlayers)}
function isPhaseComplete(r){const role=phaseRole(r);return r.users.size>0&&[...r.users.values()].every(u=>u.team.filter(p=>p.role===role).length>=r.settings.squad[role])}
function setField(form,key,value){form.getTextField(key).setText(value==null?"":String(value))}
function fileName(v){return String(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-+|-+$/g,"")||"partecipante"}
async function rosterPdf(r,u){
 const pdf=await PDFDocument.load(fs.readFileSync(ROSTER_TEMPLATE)),form=pdf.getForm(),spent=u.team.reduce((n,p)=>n+p.price,0);
 setField(form,"squadra_utente",u.name);setField(form,"manager",u.name);setField(form,"data_asta",new Date().toLocaleDateString("it-IT"));setField(form,"budget_iniziale",r.settings.budget);
 for(const role of PHASES){const players=u.team.filter(p=>p.role===role),total=players.reduce((n,p)=>n+p.price,0);players.forEach((p,index)=>{const slot=String(index+1).padStart(2,"0");setField(form,`${role}_${slot}_nome`,p.name);setField(form,`${role}_${slot}_squadra`,p.team);setField(form,`${role}_${slot}_crediti`,p.price)});setField(form,`totale_${role}`,total)}
 setField(form,"totale_crediti_spesi",spent);setField(form,"crediti_rimanenti",u.budget);form.flatten();return Buffer.from(await pdf.save());
}
app.get("/api/rooms/:code/rose.zip",async(req,res)=>{
 const r=rooms.get(String(req.params.code||"").toUpperCase().trim()),id=clientId(req.query.userId);if(!r||r.adminId!==id)return res.status(403).send("Non sei autorizzato a scaricare i PDF.");if(!isAuctionComplete(r))return res.status(409).send("Le rose non sono ancora complete.");
 res.status(200).set({"Content-Type":"application/zip","Content-Disposition":`attachment; filename="rose-${r.code}.zip"`});const zip=archiver("zip",{zlib:{level:9}});zip.on("error",()=>{if(!res.headersSent)res.status(500).end();else res.end()});zip.pipe(res);
 try{for(const u of r.users.values())zip.append(await rosterPdf(r,u),{name:`rosa-${fileName(u.name)}.pdf`});await zip.finalize()}catch(e){if(!res.headersSent)res.status(500).send("Impossibile generare i PDF.");else res.end()}
});
function end(r){
 if(!r.auction)return;
 const a=r.auction,w=a.bidderId?r.users.get(a.bidderId):null;
 const i=r.available.findIndex(p=>p.name===a.player.name);
 if(w&&i>=0){
   const role=a.player.role;
   if(!hasRoleSpace(r,w,role)){ log(r,`Asta annullata: ${w.name} ha raggiunto il limite ${role}.`); }
   else if(a.currentBid>maxBid(r,w)){log(r,`Asta annullata: devi conservare i crediti per completare la rosa.`);}
   else{
     w.budget-=a.currentBid; w.team.push({...a.player,price:a.currentBid}); r.available.splice(i,1);
     r.lastSale={player:a.player.name,buyer:w.name,buyerId:w.id,price:a.currentBid,at:Date.now()};r.salesHistory.push(r.lastSale);
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
 const proposer=user(r,id);if(maxBid(r,proposer)<1)return "Devi conservare almeno 1 credito per ogni giocatore mancante.";
 if(!hasRoleSpace(r,proposer,r.available[i].role))return `Hai raggiunto il limite ${r.available[i].role}.`;
 r.auction={player:r.available[i],proposerId:id,currentBid:1,bidderId:id,bidderName:proposer.name,endsAt:Date.now()+r.settings.seconds*1000};
 log(r,`${user(r,id).name} propone ${pn}.`);emit(r,false);
}
function offer(r,id,inc){
 const a=r.auction,u=user(r,id);if(!a||!u)return "Nessuna asta attiva.";
 if(Date.now()>=a.endsAt)return "Tempo scaduto.";
 if(!hasRoleSpace(r,u,a.player.role))return `Hai raggiunto il limite ${a.player.role}.`;
 const limit=maxBid(r,u);if(limit<=a.currentBid)return "Hai raggiunto la tua offerta massima per completare la rosa.";
 const amount=Math.min(a.currentBid+inc,limit);
 a.currentBid=amount;a.bidderId=id;a.bidderName=u.name;a.endsAt=Date.now()+r.settings.seconds*1000;
 log(r,`${u.name} offre ${amount} per ${a.player.name}.`);emit(r,false);
}
io.on("connection",s=>{
 s.on("createRoom",({name:n,budget,clientId:id})=>{
  n=name(n);id=clientId(id);if(!n)return s.emit("errorMessage","Inserisci il nome.");if(!id)return s.emit("errorMessage","Sessione non valida.");
  const c=code(),r={code:c,adminId:id,settings:{...DEFAULT,budget:Number(budget)>0?Number(budget):500},users:new Map(),connected:{},available:BASE.map(x=>({...x})),turnIndex:0,turnOrder:[id],phaseIndex:0,phaseDone:false,auction:null,started:false,log:[],lastSale:null,salesHistory:[]};
  const u={id,name:n,budget:r.settings.budget,team:[],recoveryCode:newRecoveryCode(r)};r.users.set(id,u);rooms.set(c,r);attach(r,s,id);sendRecoveryCode(s,r,u);log(r,`👑 ${n} ha creato la lega.`);emit(r);
 });
 s.on("joinRoom",({code:c,name:n,clientId:id})=>{
  c=String(c||"").toUpperCase().trim();n=name(n);id=clientId(id);const r=rooms.get(c);
  if(!r)return s.emit("errorMessage","Codice stanza non trovato.");
  if(!n)return s.emit("errorMessage","Inserisci il nome.");if(!id)return s.emit("errorMessage","Sessione non valida.");
  if(r.users.has(id)){const u=r.users.get(id);attach(r,s,id);sendRecoveryCode(s,r,u);return emit(r)}
  if(findUserByName(r,n))return s.emit("errorMessage","Nome già utilizzato.");
  if(r.started)return s.emit("errorMessage","L'asta è già iniziata.");
  const u={id,name:n,budget:r.settings.budget,team:[],recoveryCode:newRecoveryCode(r)};r.users.set(id,u);r.turnOrder.push(id);attach(r,s,id);sendRecoveryCode(s,r,u);log(r,`${n} è entrato nella lega.`);emit(r);
 });
 s.on("rejoinRoom",({code:c,clientId:id})=>{const r=rooms.get(String(c||"").toUpperCase().trim());id=clientId(id);if(!r||!r.users.has(id))return s.emit("errorMessage","Sessione stanza non trovata.");const u=r.users.get(id);attach(r,s,id);sendRecoveryCode(s,r,u);emit(r)});
 s.on("recoverRoom",({code:c,recoveryCode:rc})=>{const r=rooms.get(String(c||"").toUpperCase().trim());rc=recoveryCode(rc);const u=r&&[...r.users.values()].find(x=>x.recoveryCode===rc);if(!u)return s.emit("errorMessage","Codice di recupero non valido.");attach(r,s,u.id);s.emit("recoveredSession",{roomCode:r.code,userId:u.id});sendRecoveryCode(s,r,u);emit(r)});
 s.on("setTurnOrder",({order})=>{const r=rooms.get(s.data.room),id=s.data.userId;if(!r||r.adminId!==id||r.started||!Array.isArray(order)||order.length!==r.users.size)return;const next=order.map(clientId);if(new Set(next).size!==r.users.size||next.some(x=>!r.users.has(x)))return;r.turnOrder=next;r.turnIndex=0;emit(r,false)});
 s.on("leaveRoom",()=>{const r=rooms.get(s.data.room),id=s.data.userId;if(!r||!id)return;r.connected[id]=false;s.leave(r.code);s.data.room=null;s.data.userId=null;emit(r,false)});
 s.on("start",()=>{const r=rooms.get(s.data.room),id=s.data.userId;if(!r||r.adminId!==id)return;if(r.users.size<r.settings.minPlayers)return s.emit("errorMessage",`Servono almeno ${r.settings.minPlayers} partecipanti.`);r.started=true;ensureCurrent(r);log(r,"🚀 Asta iniziata.");emit(r,false)});
 s.on("nextPhase",()=>{const r=rooms.get(s.data.room),id=s.data.userId;if(!r||r.adminId!==id)return;if(!r.started)return s.emit("errorMessage","Avvia prima l'asta.");if(r.auction)return s.emit("errorMessage","Attendi la fine dell'asta in corso.");if(r.phaseDone)return s.emit("errorMessage","L'asta è già terminata.");if(!isPhaseComplete(r))return s.emit("errorMessage",`Ogni partecipante deve completare i ${ROLE_NAMES[phaseRole(r)]}.`);advancePhase(r);emit(r,false)});
 s.on("propose",({playerName})=>{const r=rooms.get(s.data.room),id=s.data.userId;if(r?.started&&id){const e=start(r,id,playerName);if(e)s.emit("errorMessage",e)}});
 s.on("bid",({increment})=>{const r=rooms.get(s.data.room),id=s.data.userId,n=Number(increment);if(r&&id&&[1,2,5,10,15].includes(n)){const e=offer(r,id,n);if(e)s.emit("errorMessage",e)}});
 s.on("undoSale",()=>{const r=rooms.get(s.data.room),id=s.data.userId;if(!r||r.adminId!==id||!r.salesHistory?.length)return;const sale=r.salesHistory.at(-1),u=user(r,sale.buyerId)||findUserByName(r,sale.buyer),p=BASE.find(x=>x.name===sale.player);if(!u||!p)return;const ti=u.team.findIndex(x=>x.name===sale.player&&x.price===sale.price);if(ti>=0){r.salesHistory.pop();u.team.splice(ti,1);u.budget+=sale.price;r.available.push({...p});r.phaseIndex=Math.min(r.phaseIndex,PHASES.indexOf(p.role));r.phaseDone=false;log(r,`↩️ ${sale.player} è stato restituito a ${u.name}.`);r.lastSale=r.salesHistory.at(-1)||null;emit(r)}});
 s.on("displayMode",()=>s.emit("displayState",publicRoom(rooms.get(s.data.room))));
 s.on("disconnect",()=>{const r=rooms.get(s.data.room),id=s.data.userId;if(r&&id&&r.connected[id]===s.id){r.connected[id]=false;emit(r,false)}});
});
setInterval(()=>{for(const r of rooms.values())if(r.auction&&Date.now()>=r.auction.endsAt)end(r)},200);
server.listen(PORT,()=>console.log(`Fantacalcio: http://localhost:${PORT}`));
