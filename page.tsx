'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Profile = { id:string; nickname:string; elo:number; wins:number; losses:number; role:string };
type Match = { id:string; map_name:string; status:string; team_a_name:string|null; team_b_name:string|null; team_a_score:number|null; team_b_score:number|null; created_at:string };
export default function Home() {
  const [profile,setProfile]=useState<Profile|null>(null);
  const [players,setPlayers]=useState<Profile[]>([]);
  const [matches,setMatches]=useState<Match[]>([]);
  const [modal,setModal]=useState<'signup'|'login'|null>(null);
  const [nickname,setNickname]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [queueing,setQueueing]=useState(false);
  const [busy,setBusy]=useState(false);
  const [toast,setToast]=useState('');
  const supabase=createClient();
  function notify(s:string){setToast(s);setTimeout(()=>setToast(''),3200)}
  async function refresh(){
    const {data:{user}}=await supabase.auth.getUser();
    if(user){
      const {data}=await supabase.from('profiles').select('id,nickname,elo,wins,losses,role').eq('id',user.id).maybeSingle();
      if(data)setProfile(data as Profile);
    } else setProfile(null);
    const {data:rank}=await supabase.from('profiles').select('id,nickname,elo,wins,losses,role').order('elo',{ascending:false}).limit(5);
    if(rank)setPlayers(rank as Profile[]);
    const {data:recent}=await supabase.from('matches').select('id,map_name,status,team_a_name,team_b_name,team_a_score,team_b_score,created_at').in('status',['completed','ready','pending']).order('created_at',{ascending:false}).limit(5);
    if(recent)setMatches(recent as Match[]);
  }
  useEffect(()=>{refresh(); const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{refresh()});return()=>subscription.unsubscribe()},[]);
  async function auth(e:React.FormEvent){
    e.preventDefault();setBusy(true);
    try{
      if(modal==='signup'){
        const {data,error}=await supabase.auth.signUp({email,password,options:{data:{nickname}}});
        if(error)throw error;
        if(data.user){const {error:profileError}=await supabase.from('profiles').upsert({id:data.user.id,nickname:nickname.trim()||email.split('@')[0]});if(profileError)throw profileError}
        notify('Бүртгэлийн хүсэлт илгээгдлээ. Email баталгаажуулалт шаардлагатай байж болно.');
      }else{
        const {error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;notify('Амжилттай нэвтэрлээ.');
      }
      setModal(null);await refresh();
    }catch(err){notify(err instanceof Error?err.message:'Алдаа гарлаа')}finally{setBusy(false)}
  }
  async function logout(){await supabase.auth.signOut();setProfile(null);notify('Гарлаа.')}
  async function queue(){
    if(!profile){setModal('login');notify('Эхлээд нэвтэрнэ үү.');return}
    setBusy(true);
    try{const {error}=await supabase.rpc('join_matchmaking_queue');if(error)throw error;setQueueing(true);notify('Matchmaking queue-д орлоо. 5 тоглогчтой тал бүр бүрдэхэд lobby үүснэ.');}
    catch(err){notify(err instanceof Error?err.message:'Queue-д ороход алдаа гарлаа')}finally{setBusy(false)}
  }
  async function leaveQueue(){try{const {error}=await supabase.rpc('leave_matchmaking_queue');if(error)throw error;setQueueing(false);notify('Queue-ээс гарлаа.')}catch(err){notify(err instanceof Error?err.message:'Алдаа гарлаа')}}
  async function createTeam(){
    if(!profile){setModal('login');return}
    const name=prompt('Багийн нэр:');if(!name?.trim())return;
    const {error}=await supabase.rpc('create_team',{p_name:name.trim()});
    if(error)notify(error.message);else notify('Баг амжилттай үүслээ.');
  }
  return <><header className="topbar"><div className="shell nav"><div className="brand"><span className="logo">C</span> COUNTER<em>FLAME</em></div><nav className="links"><a href="#home">HOME</a><a href="#matches">MATCHES</a><a href="#leaderboard">LEADERBOARD</a><a href="#tournaments">TOURNAMENTS</a></nav><div className="spread">{profile?<><span className="muted" style={{fontSize:11}}>{profile.nickname} · {profile.elo} ELO</span><button className="btn" onClick={logout}>LOG OUT</button></>:<><button className="btn" onClick={()=>setModal('login')}>LOG IN</button><button className="btn primary" onClick={()=>setModal('signup')}>JOIN NOW ↗</button></>}</div></div></header>
  <main className="shell" id="home"><section className="hero"><div><div className="eyebrow">THE COMPETITIVE EDGE</div><h1>PLAY HARD.<br/><span>CLIMB HIGHER.</span></h1><p>Your home for competitive Counterflame. Find matches, build your squad, track your progress, and prove you belong at the top.</p><div className="actions"><button className="btn primary" disabled={busy} onClick={queue}>{queueing?'✓ IN QUEUE':'⚡ FIND A MATCH'}</button>{queueing&&<button className="btn" onClick={leaveQueue}>LEAVE QUEUE</button>}<button className="btn" onClick={()=>document.querySelector('#leaderboard')?.scrollIntoView({behavior:'smooth'})}>VIEW RANKINGS ↗</button></div></div>
  <div className="feature"><div className="spread"><span className="muted" style={{fontSize:10,letterSpacing:1.5}}>FEATURED MATCH</span><span className="live">COMPETITIVE</span></div><div className="matchtitle">RANKED · MIRAGE · BEST OF 1</div><div className="teams"><div><div className="teamicon orange">V</div><div className="teamname">VORTEX</div><div className="meta">2,148 ELO</div></div><div><div className="score">13 <span className="muted">:</span> 9</div><div className="versus">SAMPLE SCORE</div></div><div><div className="teamicon">N</div><div className="teamname">NIGHTFALL</div><div className="meta">2,031 ELO</div></div></div><div className="spread matchbottom"><span>ASIA REGION</span><span>DEMO MATCH CARD</span></div></div></section>
  <section className="stats"><div className="stat"><label>REGISTERED PLAYERS</label><strong>{players.length||'—'}</strong></div><div className="stat"><label>RECENT MATCHES</label><strong>{matches.length||'—'}</strong></div><div className="stat"><label>YOUR ELO</label><strong>{profile?.elo??'—'}</strong></div><div className="stat"><label>YOUR WINS</label><strong>{profile?.wins??'—'}</strong></div></section>
  <section className="section" id="matches"><div className="sectionhead"><div><div className="kicker">THE ACTION</div><h2>Recent Matches</h2></div><button className="btn" onClick={()=>refresh()}>↻ REFRESH</button></div><div className="panel"><div className="tablehead" style={{gridTemplateColumns:'1fr 1.2fr .7fr .5fr'}}><span>MAP / MATCH</span><span>TEAMS</span><span>STATUS</span><span>RESULT</span></div>{matches.length?matches.map(m=><div className="matchrow" style={{gridTemplateColumns:'1fr 1.2fr .7fr .5fr'}} key={m.id}><div className="mapname">{m.map_name}<small>Match #{m.id.slice(0,8)}</small></div><div className="matchteams"><span className="tag o">{(m.team_a_name||'A')[0]}</span>{m.team_a_name||'Team A'} <span className="muted">vs</span><span className="tag">{(m.team_b_name||'B')[0]}</span>{m.team_b_name||'Team B'}</div><div className={m.status==='completed'?'status':'status upcoming'}>{m.status.toUpperCase()}</div><div style={{fontWeight:900}}>{m.status==='completed'?`${m.team_a_score??0} : ${m.team_b_score??0}`:'—'}</div></div>):<div className="muted" style={{padding:20,fontSize:12}}>Одоогоор database-д match алга. Queue бүрдэж lobby үүсэхэд энд харагдана.</div>}</div></section>
  <section className="section" id="leaderboard"><div className="sectionhead"><div><div className="kicker">THE BEST OF THE BEST</div><h2>Top Players</h2></div><button className="btn" onClick={refresh}>↻ REFRESH</button></div><div className="panel"><div className="tablehead"><span>#</span><span>PLAYER</span><span>ELO</span><span>WIN RATE</span><span>W / L</span></div>{players.length?players.map((p,i)=>{const total=p.wins+p.losses;return <div className="playerrow" key={p.id}><div className="muted">{String(i+1).padStart(2,'0')}</div><div className="player"><div className={'avatar '+(i===0?'orange':'')}>{p.nickname[0]?.toUpperCase()}</div><div>{p.nickname}<small>{p.role==='admin'?'ADMIN':'PLAYER'}</small></div></div><div className="elo">{p.elo.toLocaleString()}</div><div>{total?Math.round(p.wins/total*100)+'%':'—'}</div><div>{p.wins} / {p.losses}</div></div>}):<div className="muted" style={{padding:20,fontSize:12}}>Бүртгүүлсэн тоглогчид leaderboard дээр гарна.</div>}</div></section>
  <section className="section" id="tournaments"><div className="sectionhead"><div><div className="kicker">MAKE YOUR MARK</div><h2>Teams & Tournaments</h2></div><button className="btn primary" onClick={createTeam}>CREATE TEAM +</button></div><div className="tournaments"><article className="tourney"><span className="badge">5V5 · OPEN</span><h3>COUNTERFLAME OPEN</h3><p>Багаа бүрдүүлж, bracket тэмцээнд оролцох суурь хэсэг.</p><div className="prize">Open <small>REGISTRATION</small></div><button className="btn" onClick={()=>notify('Тэмцээний бүртгэлийн системийг дараагийн хувилбарт нэмнэ.')}>VIEW EVENT ↗</button></article><article className="tourney"><span className="badge">5V5 · RANKED</span><h3>RANKED SEASON</h3><p>ELO-оор өрсөлдөж, leaderboard-ийн дээд байрыг эзэл.</p><div className="prize">ELO <small>RANKED MODE</small></div><button className="btn" onClick={queue}>FIND A MATCH ↗</button></article><article className="tourney"><span className="badge">COMMUNITY</span><h3>BUILD YOUR SQUAD</h3><p>Баг үүсгэж, найзуудаа элсүүлэн нэг нэрийн дор тогло.</p><div className="prize">5 Players <small>PER TEAM</small></div><button className="btn" onClick={createTeam}>CREATE TEAM +</button></article></div></section>
  <section className="section"><div className="kicker">PLAYER PROFILE</div><h2>Ready to compete?</h2><p className="muted" style={{maxWidth:650,fontSize:13}}>Account үүсгэж ELO-оо хяна, matchmaking queue-д орж багтайгаа өрсөлд. Жинхэнэ game server холболт тусад нь хөгжүүлнэ.</p><button className="btn primary" onClick={()=>setModal('signup')}>CREATE PLAYER PROFILE ↗</button></section></main>
  <footer className="footer"><div className="shell footerinner"><div className="brand"><span className="logo">C</span> COUNTER<em>FLAME</em></div><span>COMMUNITY BUILT · COMPETITION FIRST</span><span>© 2026 COUNTERFLAME · COMMUNITY PROJECT</span></div></footer>
  {modal&&<div className="modalback" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(null)}}><div className="modal"><h2>{modal==='signup'?'Join Counterflame':'Welcome back'}</h2><p>{modal==='signup'?'Тоглогчийн account үүсгэнэ үү.':'Account руугаа нэвтэрнэ үү.'}</p><form onSubmit={auth}>{modal==='signup'&&<label className="field"><span>NICKNAME</span><input required minLength={3} maxLength={18} value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="Your in-game name"/></label>}<label className="field"><span>EMAIL</span><input required type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label><label className="field"><span>PASSWORD</span><input required minLength={8} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/></label><div className="modalactions"><button type="button" className="btn" onClick={()=>setModal(null)}>CANCEL</button><button className="btn primary" disabled={busy}>{busy?'PLEASE WAIT…':modal==='signup'?'CREATE ACCOUNT':'LOG IN'}</button></div></form><p>Нэвтрэлт Supabase Auth ашиглана. Email confirmation асаалттай бол email-ээ баталгаажуулна.</p></div></div>}
  {toast&&<div className="toast">{toast}</div>}</>;
}
