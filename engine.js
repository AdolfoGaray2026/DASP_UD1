/* CONECTA HEX — motor puro (script clásico y CommonJS).
 * createGame({humans:1,bots:2,seed:123}, board, cards) -> estado JSON; seed entero
 * opcional hace reproducibles dados, mazos y bots. Empresas A..D: humanos primero.
 * apply(state, action) -> NUEVO estado (no muta entrada), o Error si es ilegal.
 * legal(state) -> {phase,current,actions}; acciones son plantillas/alternativas útiles
 * para UI, no sustituye la validación de apply. botTurn(state) ejecuta bots hasta
 * humano o fin (también puede resolver elecciones de producción de bots).
 * score(state, id?) -> puntos de empresa, o mapa por ID; winner(state) ->
 * array de IDs empatados (solo cuando phase==='finished'); projects -> catálogo.
 * Fases/actions:
 * setup: {type:'place',hex:id}; serpiente, dos tipos distintos.
 * production: {type:'choose',resource:'F'|'D'|'I'|'O'|'H'} para cada 6.
 * market: {type:'bank',give,receive},
 * {type:'offer',to,give:{F:1},receive:{H:1}}, {type:'accept'},
 * {type:'reject'}, {type:'cancel'}, {type:'closeMarket'}.
 * actions: {type:'gather',resource}, {type:'expand',hex:id,from:id},
 * {type:'project',project:'P1'}, {type:'answer',answer:'A'|'B'|'C'},
 * {type:'timeout'}, {type:'endTurn'}. Reto pendiente visible en
 * pendingChallenge={cardId,project,family,retry,idea,question,options};
 * en reintentos idea=null. UI controla temporizador 30s/mercado 45s.
 * Ambigüedades: el tirador inicial y desempates físicos se sustituyen por orden
 * A..D (configuración determina asientos); dados automáticos al inicio de ronda.
 * Un intercambio humano/humano requiere oferta y aceptación del destinatario;
 * durante esa espera current es el destinatario, pero el turno sigue siendo del
 * oferente. Los bots rechazan ofertas automáticamente. El mazo se baraja con PRNG
 * serializable y se recicla desde descartes cuando se agota. La carta resuelta
 * conserva explicación en lastChallenge para que la UI la muestre.
 */
(function (root) {
  'use strict';
  const R = ['F','D','I','O','H'];
  const projects = Object.freeze([
    {id:'P1',family:'P',title:'Registro compartido',cost:{F:1,D:1,I:1,H:1}},
    {id:'P2',family:'P',title:'Indicadores y analítica',cost:{F:1,D:1,I:1,H:1}},
    {id:'P3',family:'P',title:'Atención al cliente',cost:{F:1,D:1,I:1,H:1}},
    {id:'T1',family:'T',title:'Oficina conectada',cost:{F:1,D:1,I:1,O:1}},
    {id:'T2',family:'T',title:'Planta conectada',cost:{F:1,D:1,I:1,O:1}},
    {id:'T3',family:'T',title:'Puente IT/OT',cost:{F:1,D:1,I:1,O:1}},
    {id:'C1',family:'C',title:'Plan de digitalización',cost:{F:1,D:1,H:2}},
    {id:'C2',family:'C',title:'Formación y cambio',cost:{F:1,D:1,H:2}},
    {id:'C3',family:'C',title:'Riesgos y continuidad',cost:{F:1,D:1,H:2}}
  ]);
  function fail(message) { throw new Error(message); }
  function check(ok, message) { if (!ok) fail(message); }
  function rand(s, max) { s.rng = (Math.imul(1664525,s.rng) + 1013904223) >>> 0; return Math.floor(s.rng / 4294967296 * max); }
  function shuffle(s, list) { for(let i=list.length-1;i>0;i--) { const j=rand(s,i+1); [list[i],list[j]]=[list[j],list[i]]; } return list; }
  function player(s,id) { return s.players.find(p=>p.id===id); }
  function hex(s,id) { return s.board.find(h=>h.id===id); }
  function adjacent(a,b) { return a && b && Math.max(Math.abs(a.q-b.q),Math.abs(a.r-b.r),Math.abs(a.q+a.r-b.q-b.r))===1; }
  function active(s) { return player(s,s.active); }
  function add(p,r,n) { p.resources[r]=Math.min(9,p.resources[r]+n); }
  function enough(p,cost) { return Object.entries(cost).every(([r,n])=>p.resources[r]>=n); }
  function deduct(p,cost) { for(const [r,n] of Object.entries(cost)) p.resources[r]-=n; }
  function fitsTrade(from,to,give,receive) { return R.every(r=>from.resources[r]-(give[r]||0)+(receive[r]||0)<=9 && to.resources[r]-(receive[r]||0)+(give[r]||0)<=9); }
  function bundle(v) { check(v && typeof v==='object' && !Array.isArray(v),'Lote inválido'); const b={}; for(const [r,n] of Object.entries(v)) { check(R.includes(r)&&Number.isInteger(n)&&n>0,'Lote inválido'); b[r]=n; } check(Object.keys(b).length>0,'Lote vacío'); return b; }
  function card(s,id) { return s.cards.find(c=>c.id===id); }
  function chooseCard(s,family) { if(!s.decks[family].length) { check(s.discards[family].length>0,'Mazo vacío'); s.decks[family]=shuffle(s,s.discards[family].splice(0)); } return s.decks[family].pop(); }
  function score(s,id) { const one=p=>p.centers.length+2*p.completed.length; return id===undefined ? Object.fromEntries(s.players.map(p=>[p.id,one(p)])) : one(player(s,id)); }
  function families(p) { return new Set(p.completed.map(id=>id[0])).size; }
  function winner(s) { if(s.phase!=='finished') return []; let a=s.players.slice(); const full=a.filter(p=>families(p)===3); if(full.length) a=full; else { const max=Math.max(...a.map(families)); a=a.filter(p=>families(p)===max); } const points=Math.max(...a.map(p=>score(s,p.id))); a=a.filter(p=>score(s,p.id)===points); const min=Math.min(...a.map(p=>Number(!!p.pending))); return a.filter(p=>Number(!!p.pending)===min).map(p=>p.id); }
  // Se resuelve el primer dado por completo antes del segundo, incluso si sale 6.
  function resolveProduction(s) {
    while(s.productionRollIndex<s.rolls.length) {
      const roll=s.rolls[s.productionRollIndex++];
      if(roll===6) {
        s.productionChoices=s.players.map(p=>p.id);
        s.current=s.productionChoices[0];
        return;
      }
      for(const p of s.players) add(p,R[roll-1],p.centers.filter(id=>hex(s,id).type===R[roll-1]).length);
    }
    beginTurn(s);
  }
  function beginRound(s) { s.phase='production'; s.rolls=[rand(s,6)+1,rand(s,6)+1]; s.productionChoices=[]; s.productionRollIndex=0; resolveProduction(s); }
  function beginTurn(s) { s.phase='market'; s.active=s.order[s.turnIndex]; s.current=s.active; s.actionsLeft=2; s.bankTrades=0; s.expanded=false; s.challenged=false; s.offer=null; s.pendingChallenge=null; s.lastChallenge=null; }
  function endTurn(s) { const p=active(s); if(score(s,p.id)>=18 && families(p)===3) s.finalRound=true; s.turnIndex++; if(s.turnIndex===s.order.length) { if(s.finalRound||s.round===10) { s.phase='finished'; s.current=null; s.active=null; return; } s.round++; s.startIndex=(s.startIndex+1)%s.players.length; s.order=s.players.slice(s.startIndex).concat(s.players.slice(0,s.startIndex)).map(p=>p.id); s.turnIndex=0; beginRound(s); } else beginTurn(s); }
  function createGame(config,board,cards) {
    check(config && Number.isInteger(config.humans) && Number.isInteger(config.bots) && [3,4].includes(config.humans+config.bots),'Se necesitan 3 o 4 empresas');
    check(Array.isArray(board)&&board.length===19&&new Set(board.map(h=>h.id)).size===19&&board.every(h=>Number.isInteger(h.q)&&Number.isInteger(h.r)&&R.includes(h.type))&&new Set(board.map(h=>`${h.q},${h.r}`)).size===19,'Tablero inválido');
    check(Array.isArray(cards)&&cards.length===36&&new Set(cards.map(c=>c.id)).size===36&&['P','T','C'].every(f=>cards.filter(c=>c.family===f).length===12)&&cards.every(c=>['A','B','C'].includes(c.answer)&&Array.isArray(c.options)&&c.options.length===3),'Cartas inválidas');
    const seed=config.seed===undefined ? Math.floor(Math.random()*4294967296) : config.seed;
    check(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff,'Semilla inválida');
    const players=Array.from({length:config.humans+config.bots},(_,i)=>({id:'ABCD'[i],kind:i<config.humans?'human':'bot',resources:Object.fromEntries(R.map(r=>[r,1])),centers:[],links:[],completed:[],pending:null}));
    const s={board:JSON.parse(JSON.stringify(board)),cards:JSON.parse(JSON.stringify(cards)),players,rng:seed>>>0,phase:'setup',round:1,startIndex:0,order:players.map(p=>p.id),turnIndex:0,active:null,current:'A',setupOrder:players.map(p=>p.id).concat(players.map(p=>p.id).reverse()),setupIndex:0,rolls:[],productionChoices:[],decks:{P:[],T:[],C:[]},discards:{P:[],T:[],C:[]},actionsLeft:2,bankTrades:0,expanded:false,challenged:false,offer:null,pendingChallenge:null,lastChallenge:null,finalRound:false};
    for(const f of ['P','T','C']) s.decks[f]=shuffle(s,cards.filter(c=>c.family===f).map(c=>c.id));
    return s;
  }
  function legal(s) {
    const p=player(s,s.current), a=[];
    if(s.phase==='setup') for(const h of s.board) if(!s.players.some(x=>x.centers.includes(h.id))&&(!p.centers.length||hex(s,p.centers[0]).type!==h.type)) a.push({type:'place',hex:h.id});
    if(s.phase==='production') for(const resource of R) a.push({type:'choose',resource});

    if(s.phase==='market') {
      if(s.offer) a.push({type:s.current===s.offer.to?'accept':'cancel'},{type:'reject'});
      else { a.push({type:'closeMarket'}); if(s.bankTrades<2) for(const give of R) if(p.resources[give]>=3) for(const receive of R) if(receive!==give&&p.resources[receive]<9) a.push({type:'bank',give,receive}); for(const other of s.players) if(other.id!==s.active&&other.kind==='human') a.push({type:'offer',to:other.id,give:{},receive:{}}); }
    }
    if(s.phase==='actions') {
      if(s.pendingChallenge) { for(const answer of ['A','B','C']) a.push({type:'answer',answer}); a.push({type:'timeout'}); }
      else { a.push({type:'endTurn'}); if(s.actionsLeft) { for(const resource of R) a.push({type:'gather',resource}); if(!s.expanded&&p.centers.length<5&&enough(p,{F:1,D:1,I:1})) for(const h of s.board) if(!s.players.some(x=>x.centers.includes(h.id))) for(const from of p.centers) if(adjacent(hex(s,from),h)) a.push({type:'expand',hex:h.id,from}); if(!s.challenged) for(const pr of projects) if(!p.completed.includes(pr.id)&&(!p.pending||p.pending.family===pr.family)&&enough(p,pr.cost)&&(p.pending||s.decks[pr.family].length||s.discards[pr.family].length)) a.push({type:'project',project:pr.id}); } }
    }
    return {phase:s.phase,current:s.current,actions:a};
  }
  function apply(state,action) {
    check(state&&action&&typeof action.type==='string','Acción inválida');
    const s=JSON.parse(JSON.stringify(state)), t=action.type, p=player(s,s.current);
    check(s.phase!=='finished','Partida terminada');
    if(s.phase==='setup') { check(t==='place'&&legal(s).actions.some(a=>a.hex===action.hex),'Colocación ilegal'); p.centers.push(action.hex); s.setupIndex++; if(s.setupIndex===s.setupOrder.length) beginRound(s); else s.current=s.setupOrder[s.setupIndex]; return s; }
    if(s.phase==='production') { check(t==='choose'&&R.includes(action.resource),'Elección inválida'); add(p,action.resource,1); s.productionChoices.shift(); if(s.productionChoices.length) s.current=s.productionChoices[0]; else if(s.productionRollIndex===undefined) beginTurn(s); else resolveProduction(s); return s; }

    if(s.phase==='market') {
      if(s.offer) { const offer=s.offer; check((s.current===offer.to&&['accept','reject'].includes(t))||(s.current===s.active&&['cancel'].includes(t)),'Respuesta a oferta requerida'); if(t==='accept') { const from=player(s,s.active),to=player(s,offer.to); check(!Object.keys(offer.give).some(r=>r in offer.receive)&&enough(from,offer.give)&&enough(to,offer.receive)&&fitsTrade(from,to,offer.give,offer.receive),'Recursos insuficientes, mismos tipos o tope de 9 superado'); deduct(from,offer.give); deduct(to,offer.receive); for(const [r,n] of Object.entries(offer.receive)) add(from,r,n); for(const [r,n] of Object.entries(offer.give)) add(to,r,n); } s.offer=null; s.current=s.active; return s; }
      check(s.current===s.active,'Turno incorrecto');
      if(t==='closeMarket') { s.phase='actions'; return s; }
      if(t==='bank') { check(s.bankTrades<2&&R.includes(action.give)&&R.includes(action.receive)&&action.give!==action.receive&&p.resources[action.give]>=3&&p.resources[action.receive]<9,'Cambio bancario ilegal o recurso receptor al máximo'); p.resources[action.give]-=3; add(p,action.receive,1); s.bankTrades++; return s; }
      if(t==='offer') { const to=player(s,action.to), give=bundle(action.give), receive=bundle(action.receive); check(!Object.keys(give).some(r=>r in receive),'Intercambia tipos de recurso distintos; no se permiten regalos'); check(to&&to.id!==s.active&&to.kind==='human'&&enough(p,give)&&enough(to,receive)&&fitsTrade(p,to,give,receive),'Oferta ilegal: recursos insuficientes o tope de 9 superado'); s.offer={to:to.id,give,receive}; s.current=to.id; return s; }
      fail('Acción de mercado ilegal');
    }
    check(s.phase==='actions'&&s.current===s.active,'Fase inválida');
    if(s.pendingChallenge) {
      check(t==='answer'||t==='timeout','Resuelve el reto primero');
      check(t==='timeout'||['A','B','C'].includes(action.answer),'Respuesta inválida');
      const challenge=s.pendingChallenge, c=card(s,challenge.cardId), ok=t==='answer'&&action.answer===c.answer;
      s.lastChallenge={cardId:c.id,project:challenge.project,correct:ok,answer:c.answer,explanation:c.explanation};
      if(ok) { deduct(p,projects.find(x=>x.id===challenge.project).cost); p.completed.push(challenge.project); p.pending=null; s.discards[c.family].push(c.id); }
      else p.pending={cardId:c.id,family:c.family,failedRound:s.round,failedTurn:s.turnIndex};
      s.pendingChallenge=null; return s;
    }
    if(t==='endTurn') { endTurn(s); return s; }
    check(s.actionsLeft>0,'Sin acciones');
    if(t==='gather') { check(R.includes(action.resource),'Recurso inválido'); add(p,action.resource,1); s.actionsLeft--; return s; }
    if(t==='expand') { check(!s.expanded&&p.centers.length<5&&enough(p,{F:1,D:1,I:1})&&hex(s,action.hex)&&p.centers.includes(action.from)&&adjacent(hex(s,action.from),hex(s,action.hex))&&!s.players.some(x=>x.centers.includes(action.hex)),'Expansión ilegal'); deduct(p,{F:1,D:1,I:1}); p.centers.push(action.hex); p.links.push([action.from,action.hex]); s.expanded=true; s.actionsLeft--; return s; }
    if(t==='project') { const pr=projects.find(x=>x.id===action.project); check(pr&&!s.challenged&&!p.completed.includes(pr.id)&&enough(p,pr.cost)&&(!p.pending||p.pending.family===pr.family),'Proyecto ilegal'); check(!p.pending||p.pending.failedRound<s.round||p.pending.failedTurn!==s.turnIndex,'Reintento en mismo turno'); const retry=!!p.pending, id=retry?p.pending.cardId:chooseCard(s,pr.family), c=card(s,id); s.pendingChallenge={cardId:id,project:pr.id,family:pr.family,retry,idea:retry?null:c.idea,question:c.question,options:c.options.slice()}; s.challenged=true; s.actionsLeft--; return s; }
    fail('Acción ilegal');
  }
  function botTurn(state) {
    let s=JSON.parse(JSON.stringify(state)), guard=0;
    while(s.phase!=='finished'&&player(s,s.current).kind==='bot') {
      check(++guard<1000,'Bucle de bot'); const p=player(s,s.current), opts=legal(s).actions, pick=(type)=>opts.find(a=>a.type===type);
      if(s.phase==='setup') { const candidates=opts.filter(a=>['F','D','I','H','O'].includes(hex(s,a.hex).type)); s=apply(s,candidates[0]); }
      else if(s.phase==='production') s=apply(s,{type:'choose',resource:needed(p)});

      else if(s.phase==='market') s=apply(s,s.offer?{type:'reject'}:{type:'closeMarket'});
      else if(s.pendingChallenge) {
        const c=card(s,s.pendingChallenge.cardId);
        // Los rivales también fallan a veces; el reintento consolida el aprendizaje.
        const answer=s.pendingChallenge.retry||rand(s,4)!==0 ? c.answer : ['A','B','C'].find(x=>x!==c.answer);
        s=apply(s,{type:'answer',answer});
      }
      else if(s.phase==='actions') { const pr=opts.find(a=>a.type==='project'&&(p.pending?a.project[0]===p.pending.family:families(p)<3&&!p.completed.some(x=>x[0]===a.project[0])))||pick('project'); const expansion=pick('expand'); if(pr) s=apply(s,pr); else if(expansion) s=apply(s,expansion); else if(s.actionsLeft) s=apply(s,{type:'gather',resource:needed(p)}); else s=apply(s,{type:'endTurn'}); }
    }
    return s;
  }
  function needed(p) { const targets=p.pending?projects.find(x=>x.family===p.pending.family&&!p.completed.includes(x.id)):projects.find(x=>!p.completed.some(id=>id[0]===x.family)&&!p.completed.includes(x.id))||projects.find(x=>!p.completed.includes(x.id)); const cost=targets?targets.cost:{F:1,D:1,I:1}; return R.find(r=>p.resources[r]<(cost[r]||0))||R.reduce((best,r)=>p.resources[r]<p.resources[best]?r:best,'F'); }
  const api={createGame,legal,apply,botTurn,score,winner,projects};
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.ConectaEngine=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null);
