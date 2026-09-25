const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../engine.js');
const base = path.resolve(__dirname,'..');
const board = JSON.parse(fs.readFileSync(path.join(base,'tablero_web.json')));
const cards = JSON.parse(fs.readFileSync(path.join(base,'cartas_revisadas.json')));
const game = (cfg={humans:1,bots:2,seed:7}) => E.createGame(cfg,board,cards);
test('el banco web usa 36 preguntas revisadas y el tablero original',()=>{
  const revised=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../cartas_revisadas.json')));
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../data.js'),'utf8'),context);
  const web=JSON.parse(JSON.stringify(context.window.CONECTA_DATA));
  assert.deepEqual(web.board,board);
  assert.deepEqual(web.cards,revised);
  assert.equal(revised.length,36);
  assert.deepEqual(revised.map(c=>c.id),cards.map(c=>c.id));
  assert.deepEqual(revised.reduce((o,c)=>(o[c.answer]++,o),{A:0,B:0,C:0}),{A:12,B:12,C:12});
  for(const c of revised){
    assert.equal(c.family,c.id[0]);
    assert.ok(c.slide>=2&&c.slide<=13);
    assert.equal(c.options.length,3);
    assert.equal(new Set(c.options).size,3);
    assert.ok(c.question.length>40&&c.explanation.length>40);
  }
});
function setup(s) {
  while(s.phase==='setup') {
    const opts=E.legal(s).actions;
    s=E.apply(s,opts[0]);
  }
  return production(s);
}
function production(s) {
  while(s.phase==='production') s=E.apply(s,{type:'choose',resource:'H'});
  return s;
}
function turn(s) {
  s=E.apply(s,{type:'closeMarket'});
  while(s.actionsLeft) s=E.apply(s,{type:'gather',resource:'F'});
  return E.apply(s,{type:'endTurn'});
}
test('exports for browser classic script and CommonJS, original arrays untouched',()=>{
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../engine.js'),'utf8'),context);
  assert.equal(typeof context.window.ConectaEngine.createGame,'function');
  assert.equal(E.projects.length,9);
  const before=JSON.stringify(board), s=game();
  assert.equal(s.players.length,3); assert.equal(JSON.stringify(board),before);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(s))),JSON.stringify(s));
  assert.deepEqual(E.winner(s),[]);
  assert.throws(()=>E.createGame({humans:1,bots:1},board,cards));
});
test('serpiente, distintos tipos, producción y tope 9; semilla reproducible',()=>{
  let s=game({humans:1,bots:3,seed:90});
  assert.deepEqual(s.setupOrder,['A','B','C','D','D','C','B','A']);
  const first=E.legal(s).actions[0]; s=E.apply(s,first);
  assert.throws(()=>E.apply(s,{type:'place',hex:first.hex}));
  assert.ok(E.legal(s).actions.every(x=>x.hex!==first.hex));
  while(s.phase==='setup') s=E.apply(s,E.legal(s).actions[0]);
  assert.deepEqual(s.players.map(p=>p.centers.length),[2,2,2,2]);
  assert.equal(s.rolls.length,2);
  assert.deepEqual(game({humans:1,bots:3,seed:90}).decks,game({humans:1,bots:3,seed:90}).decks);
  s=production(s);
  assert.equal(E.score(s,'A'),2);
  assert.equal(s.phase,'market');
  assert.equal(E.legal(s).actions.some(a=>a.type==='impulse'),false);
  assert.throws(()=>E.apply(s,{type:'impulse',resource:'H'}));
});
test('mercado banco limitado, intercambio voluntario, mercado cerrado',()=>{
  let s=setup(game({humans:3,bots:0}));
  s.players[0].resources.F=9; s.players[1].resources.H=2;
  s=E.apply(s,{type:'bank',give:'F',receive:'H'});
  s=E.apply(s,{type:'bank',give:'F',receive:'H'});
  assert.throws(()=>E.apply(s,{type:'bank',give:'F',receive:'H'}));
  s=E.apply(s,{type:'offer',to:'B',give:{F:1},receive:{H:1}});
  assert.equal(s.current,'B'); assert.throws(()=>E.apply(s,{type:'closeMarket'}));
});
test('oferta se acepta o rechaza sin transferencias indebidas',()=>{
  let s=setup(game({humans:3,bots:0}));
  const a=s.players[0].resources.F,b=s.players[1].resources.H;
  s=E.apply(s,{type:'offer',to:'B',give:{F:1},receive:{H:1}});
  s=E.apply(s,{type:'reject'}); assert.equal(s.players[0].resources.F,a);
  s=E.apply(s,{type:'offer',to:'B',give:{F:1},receive:{H:1}});
  s=E.apply(s,{type:'accept'}); assert.equal(s.players[0].resources.F,a-1);
  assert.equal(s.players[1].resources.H,b-1);
  s=E.apply(s,{type:'closeMarket'});
  assert.throws(()=>E.apply(s,{type:'bank',give:'F',receive:'H'}));
});
test('expansión adyacente, límites, proyecto y reintento conservan recursos',()=>{
  let s=setup(game()); s=E.apply(s,{type:'closeMarket'});
  const ex=E.legal(s).actions.find(a=>a.type==='expand');
  assert.ok(ex); const old=E.score(s,'A');
  s=E.apply(s,ex); assert.equal(E.score(s,'A'),old+1);
  assert.equal(s.players[0].links.length,1);
  assert.throws(()=>E.apply(s,ex));
  s.players[0].resources={F:4,D:4,I:4,O:4,H:4};
  s=E.apply(s,{type:'project',project:'P1'});
  const id=s.pendingChallenge.cardId, before={...s.players[0].resources};
  assert.ok(s.pendingChallenge.idea);
  assert.throws(()=>E.apply(s,{type:'gather',resource:'F'}));
  s=E.apply(s,{type:'timeout'});
  assert.deepEqual(s.players[0].resources,before);
  assert.equal(s.players[0].pending.cardId,id);
  assert.throws(()=>E.apply(s,{type:'project',project:'P2'}));
  s=E.apply(s,{type:'endTurn'});
  // Advance the other players and production, preserving the pending card.
  while(s.current!=='A' || s.phase!=='market') {
    if(s.phase==='production') s=production(s);
    else s=E.botTurn(s);
  }
  s=E.apply(s,{type:'closeMarket'});
  assert.throws(()=>E.apply(s,{type:'project',project:'T1'}));
  s=E.apply(s,{type:'project',project:'P2'});
  assert.equal(s.pendingChallenge.cardId,id); assert.equal(s.pendingChallenge.idea,null);
  s=E.apply(s,{type:'answer',answer:cards.find(c=>c.id===id).answer});
  assert.equal(s.players[0].pending,null); assert.ok(s.players[0].completed.includes('P2'));
  assert.equal(s.lastChallenge.correct,true); assert.ok(s.lastChallenge.explanation);
});
test('bots reach finish without loops with seeded all-bot game',()=>{
  let s=game({humans:0,bots:3,seed:123});
  s=E.botTurn(s);
  assert.equal(s.phase,'finished'); assert.ok(s.round<=12);
  assert.equal(s.players.every(p=>p.centers.length>=2),true);
  assert.equal(E.winner(s).length>=1,true);
});
test('rondas rotan inicio, cierre al final y desempate familias/pendientes',()=>{
  let s=setup(game({humans:3,bots:0,seed:21}));
  for(let i=0;i<3;i++) { s=turn(s); if(s.phase==='production') s=production(s); }
  assert.equal(s.round,2); assert.equal(s.current,'B');
  s.players[1].completed=['P1','P2','P3','T1','T2','T3','C1'];
  // Los 16 puntos no bastan, incluso con las tres familias.
  const below=turn(s);
  assert.equal(below.finalRound,false);
  s.players[1].completed.push('C2');
  // B tiene 18 puntos; las demás empresas completan la ronda.
  s=turn(s); assert.equal(s.finalRound,true); assert.notEqual(s.phase,'finished');
  while(s.phase!=='finished') s=turn(s);
  assert.deepEqual(E.winner(s),['B']);
  const tie=game({humans:3,bots:0}); tie.phase='finished';
  tie.players[0].completed=['P1','T1']; tie.players[1].completed=['P1','T1'];
  tie.players[0].pending={cardId:'C01',family:'C'};
  assert.deepEqual(E.winner(tie),['B']);
  tie.players[1].pending={cardId:'C02',family:'C'};
  assert.deepEqual(E.winner(tie),['A','B']);
});
test('producción cobra por centro y por tirada; dos seises son elecciones independientes',()=>{
  let s=setup(game({humans:3,bots:0,seed:17}));
  s.players[0].centers=[1,7]; // dos centros I
  s.players[0].resources.I=8;
  s.rolls=[]; s.productionChoices=[];
  // Avanzar hasta ronda siguiente con dados reales; comprobación exacta forzando
  // el siguiente par mediante estado PRNG serializable encontrado por enumeración.
  function pair(seed) { let x=seed>>>0; const dice=[]; for(let i=0;i<2;i++){ x=(Math.imul(1664525,x)+1013904223)>>>0; dice.push(Math.floor(x/4294967296*6)+1); } return dice; }
  const seed=Array.from({length:100000},(_,i)=>i).find(x=>pair(x).join()==='3,3');
  assert.notEqual(seed,undefined);
  s.rng=seed;
  for(let i=0;i<3;i++) s=turn(s);
  assert.deepEqual(s.rolls,[3,3]);
  assert.equal(s.players[0].resources.I,9);
  const six=Array.from({length:100000},(_,i)=>i).find(x=>pair(x).join()==='6,6');
  assert.notEqual(six,undefined);
  s.rng=six;
  s=production(s);
  for(let i=0;i<3;i++) s=turn(s);
  assert.deepEqual(s.rolls,[6,6]);
  assert.equal(s.productionChoices.length,3);
  const old=s.players[0].resources.O;
  s=E.apply(s,{type:'choose',resource:'O'});
  assert.equal(s.players[0].resources.O,Math.min(9,old+1));
  s=E.apply(s,{type:'choose',resource:'O'});
  s=E.apply(s,{type:'choose',resource:'O'});
  assert.equal(s.productionChoices.length,3); // El segundo 6 comienza ahora.
  s=production(s);
  assert.equal(s.phase,'market');
});
test('un 6 se resuelve antes del segundo dado, sin regalar recursos prematuramente',()=>{
  let s=setup(game({humans:3,bots:0,seed:17}));
  function pair(seed) { let x=seed>>>0; return [0,1].map(()=>{x=(Math.imul(1664525,x)+1013904223)>>>0;return Math.floor(x/4294967296*6)+1;}); }
  const seed=Array.from({length:100000},(_,i)=>i).find(x=>pair(x).join()==='6,1');
  assert.notEqual(seed,undefined); s.rng=seed;
  const before=s.players.map(p=>p.resources.F);
  for(let i=0;i<3;i++) s=turn(s);
  assert.deepEqual(s.rolls,[6,1]); assert.equal(s.phase,'production');
  assert.equal(s.productionRollIndex,1);
  assert.deepEqual(s.players.map(p=>p.resources.F),before.map(n=>Math.min(9,n+2)));
  for(let i=0;i<3;i++) s=E.apply(s,{type:'choose',resource:'H'});
  assert.equal(s.phase,'market');
  assert.deepEqual(s.players.map(p=>p.resources.F),before.map((n,i)=>Math.min(9,n+2+s.players[i].centers.filter(id=>board.find(h=>h.id===id).type==='F').length)));
});
test('intercambios nunca consumen recursos sin entregar íntegro lo acordado',()=>{
  let s=setup(game({humans:3,bots:0}));
  s.players[0].resources={F:6,D:9,I:1,O:1,H:1};
  s.players[1].resources={F:9,D:2,I:1,O:1,H:1};
  assert.equal(E.legal(s).actions.some(a=>a.type==='bank'&&a.receive==='D'),false);
  const snapshot=JSON.stringify(s);
  assert.throws(()=>E.apply(s,{type:'bank',give:'F',receive:'D'}));
  assert.throws(()=>E.apply(s,{type:'offer',to:'B',give:{F:1},receive:{D:1}}));
  assert.equal(JSON.stringify(s),snapshot);
  s.players[0].resources.D=8;
  s.players[1].resources.F=8;
  s=E.apply(s,{type:'offer',to:'B',give:{F:1},receive:{D:1}});
  s=E.apply(s,{type:'accept'});
  assert.equal(s.players[0].resources.F,5);
  assert.equal(s.players[0].resources.D,9); // El máximo sigue siendo nueve.
  assert.equal(s.players[1].resources.F,9);
  assert.equal(s.players[1].resources.D,1);
});
test('ofertas del mismo recurso no encubren regalos',()=>{
  const s=setup(game({humans:3,bots:0}));
  s.players[0].resources.F=9;
  s.players[1].resources.F=1;
  const original=JSON.stringify(s);
  assert.throws(()=>E.apply(s,{type:'offer',to:'B',give:{F:2},receive:{F:1}}),/regalos/);
  assert.equal(JSON.stringify(s),original);
});
test('para un cuarto proyecto se requieren tres centros; para el sexto, cuatro',()=>{
  let s=setup(game({humans:3,bots:0,seed:53}));
  s=E.apply(s,{type:'closeMarket'});
  const p=s.players[0];p.resources={F:5,D:5,I:5,O:5,H:5};
  const free=()=>board.find(h=>!s.players.some(x=>x.centers.includes(h.id))).id;
  p.completed=['P1','T1','C1'];
  assert.equal(E.legal(s).actions.some(a=>a.type==='project'),false);
  assert.throws(()=>E.apply(s,{type:'project',project:'P2'}),/amplía tu red/);
  p.centers.push(free());
  assert.equal(E.legal(s).actions.some(a=>a.type==='project'&&a.project==='P2'),true);
  p.completed.push('P2','T2');
  assert.equal(E.legal(s).actions.some(a=>a.type==='project'),false);
  assert.throws(()=>E.apply(s,{type:'project',project:'C2'}),/amplía tu red/);
  p.centers.push(free());
  assert.equal(E.legal(s).actions.some(a=>a.type==='project'&&a.project==='C2'),true);
});
test('botTurn conserva intacto su estado de entrada aun al responder un reto',()=>{
  const s=setup(game({humans:0,bots:3,seed:53}));
  s.phase='actions'; s.active=s.current='A'; s.pendingChallenge={cardId:cards[0].id,project:'P1',family:'P',retry:false};
  s.players[0].resources={F:2,D:2,I:2,O:2,H:2};s.actionsLeft=0;
  const before=JSON.stringify(s);
  const after=E.botTurn(s);
  assert.equal(JSON.stringify(s),before);
  assert.notEqual(after,s);
});
test('fallos no mutan entrada y partida concluye tras 12 rondas sin umbral',()=>{
  let s=setup(game({humans:3,bots:0,seed:44}));
  const snapshot=JSON.stringify(s);
  assert.throws(()=>E.apply(s,{type:'expand',hex:999,from:1}));
  assert.equal(JSON.stringify(s),snapshot);
  let turns=0;
  while(s.phase!=='finished') {
    if(s.phase==='production') s=production(s);
    else { s=turn(s); turns++; }
  }
  assert.equal(s.round,12);
  assert.equal(turns,36);
  assert.ok(E.winner(s).length);
});
