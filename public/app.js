import {auth,db,call,$,esc,inr,toast,msg,teamEmail} from './fb.js';
import {signInWithEmailAndPassword,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {doc,collection,query,where,onSnapshot} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
let board={teams:[],members:[],stats:{}},S={},user=null,myMembers=[],myOrders=[],myPays=[],unsub=[];
const CAT={orders:'Most Orders',litres:'Most Litres',sales:'Highest Sales'};
const views=['home','register','login','order','teams','people','dash'];
const show=()=>{let v=location.hash.slice(1);if(!views.includes(v))v='home';if(v==='dash'&&!user)v='login';views.forEach(x=>$('#v-'+x).classList.toggle('on',x===v))};
addEventListener('hashchange',show);
const rank=(l,m)=>[...l].sort((a,b)=>b[m]-a[m]||b.litres-a.litres||b.orders-a.orders||(a.teamName||a.memberName).localeCompare(b.teamName||b.memberName));
const val=(x,m)=>m==='sales'?inr(x[m]):x[m];
function lb(el,list,m,ind){const r=rank(list,m),top=r[0]?.[m]||0;
 const nm=x=>ind?`${esc(x.memberName)}<br><small>${esc(x.teamName)}</small>`:esc(x.teamName);
 const pod=[1,0,2].filter(i=>r[i]).map(i=>`<div class="p${i+1}"><b>${['🥇','🥈','🥉'][i]}</b><br>${nm(r[i])}<br><b>${val(r[i],m)}</b></div>`).join('');
 el.innerHTML=r.length?`<div class="pod">${pod}</div><div class="card tw"><table><tr><th>Rank<th>${ind?'Member<th>Team':'Team'}<th>Orders<th>Litres<th>Sales${ind?'':'<th>Progress'}</tr>${r.map((x,i)=>`<tr><td>${i+1}<td>${esc(ind?x.memberName:x.teamName)}${ind?'<td>'+esc(x.teamName):''}<td>${x.orders}<td>${x.litres}<td>${inr(x.sales)}${ind?'':`<td><div class="bar"><i style="width:${top?x[m]/top*100:0}%"></i></div>`}</tr>`).join('')}</table></div>`:'<p class="card">No data yet. Be the first to order!</p>'}
const upiPanels=[],forms=[];const fillTeams=()=>forms.forEach(r=>r.fillT?.());
function paintBoards(){const s=board.stats||{};$('#stats').innerHTML=[['Teams',s.teams],['Members',s.members],['Valid Orders',s.orders],['Litres Sold',s.litres],['Total Sales',inr(s.sales)],['Customers',s.customers]].map(([k,v])=>`<div class="card stat"><b>${v??0}</b>${k}</div>`).join('');
 lb($('#tb'),board.teams,$('#tc').value,0);lb($('#pb'),board.members,$('#pc').value,1);if(user)paintDash();fillTeams()}
['#tc','#pc'].forEach(s=>{$(s).innerHTML=Object.entries(CAT).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');$(s).value='sales';$(s).onchange=paintBoards});
let first=1;
onSnapshot(doc(db,'public/board'),d=>{board=d.exists()?d.data():board;paintBoards()},()=>toast('Could not load rankings',1));
onSnapshot(doc(db,'public/settings'),d=>{S=d.data()||{};if(first){first=0;$('#tc').value=S.defaultTeamRanking||'sales';$('#pc').value=S.defaultIndividualRanking||'sales'}paintBoards();upiPanels.forEach(f=>f())},()=>{});
$('#rc').innerHTML=Array.from({length:20},(_,i)=>`<option>${i+1}</option>`).join('');$('#rc').value=3;
const mf=()=>{$('#rm').innerHTML=Array.from({length:+$('#rc').value},(_,i)=>`<label>Member ${i+1} name<input class="mn" required maxlength="40"></label>`).join('')};mf();$('#rc').onchange=mf;
$('#rf').onsubmit=async e=>{e.preventDefault();const f=e.target,p=f.p.value;if(p!==f.c.value)return toast('Passwords do not match',1);const b=f.querySelector('button');b.disabled=1;
 try{await call('registerTeam')({teamName:f.t.value,password:p,members:[...f.querySelectorAll('.mn')].map(i=>i.value)});await signInWithEmailAndPassword(auth,await teamEmail(f.t.value),p);toast('Team registered!');f.reset();mf();location.hash='dash'}catch(x){toast(msg(x),1)}b.disabled=0};
$('#lf').onsubmit=async e=>{e.preventDefault();const f=e.target;try{await signInWithEmailAndPassword(auth,await teamEmail(f.t.value),f.p.value);location.hash='dash'}catch{toast('Wrong team name or password',1)}};
$('#lo').onclick=async e=>{e.preventDefault();if(confirm('Log out? Your data stays saved.')){await signOut(auth);location.hash='home'}};
function orderForm(root,fixed){const rq=crypto.randomUUID().replace(/-/g,'');
 root.innerHTML=`<form><div class="row"><label>Team<select name="team" required></select></label><label>Team member<select name="member" required></select></label><label>Customer name<input name="cn" required></label><label>Customer phone<input name="ph" required inputmode="tel" pattern="\\+?[0-9]{8,14}"></label><label>Litres<input name="l" type="number" min="0.5" step="0.5" required></label><label>Payment method<select name="pm"><option>Cash</option><option>UPI</option><option>Pending</option></select></label><label>C/O (Care Of), optional<input name="co" maxlength="60" placeholder="e.g. Local Shop"></label><label>Notes, optional<input name="nt" maxlength="300"></label></div>
 <p>Price per litre: <b class="pp"></b>. Total: <b class="tt"></b></p><p><small>Placing an order does not confirm payment. An admin verifies payments.</small></p>
 <div class="upi card" hidden></div><button class="alt">Place order</button></form>`;
 const f=root.querySelector('form'),ts=f.team,ms=f.member,up=f.querySelector('.upi');
 const fillM=()=>{const t=board.teams.find(x=>x.teamId===ts.value);const l=fixed?myMembers.filter(m=>m.status==='active'):t?.members||[];const c=ms.value;ms.innerHTML=l.map(m=>`<option value="${m.memberId}">${esc(m.memberName)}</option>`).join('');if(c)ms.value=c};
 root.fillT=()=>{const c=ts.value;ts.innerHTML=(fixed?board.teams.filter(t=>t.teamId===user?.uid):board.teams).map(t=>`<option value="${t.teamId}">${esc(t.teamName)}</option>`).join('');if(c)ts.value=c;fillM()};
 const upi=()=>{const tot=Math.round(f.l.value*(S.pricePerLitre||0)*100)/100;f.querySelector('.pp').textContent=inr(S.pricePerLitre);f.querySelector('.tt').textContent=inr(tot);
  f.pm.options[1].disabled=!S.upiEnabled;if(!S.upiEnabled&&f.pm.value==='UPI')f.pm.value='Pending';
  up.hidden=f.pm.value!=='UPI';if(up.hidden)return;
  if(!S.upiId||!S.payeeName)return up.innerHTML='<p>UPI details are not configured. Choose another method.</p>';
  if(!(tot>0))return up.innerHTML='<p>Enter litres to see the payable amount.</p>';
  const uri=`upi://pay?pa=${encodeURIComponent(S.upiId)}&pn=${encodeURIComponent(S.payeeName)}&am=${tot.toFixed(2)}&cu=INR`;
  up.innerHTML=`<h4>Scan to Pay</h4><div class="qr"></div><p>UPI ID: <b>${esc(S.upiId)}</b> <button type="button" class="cp">Copy UPI ID</button><br>Payee: ${esc(S.payeeName)}<br>Amount payable: <b>${inr(tot)}</b></p><p>${esc(S.paymentInstructions||'')}</p><button type="button" class="dl">Download QR</button>`;
  const q=up.querySelector('.qr');new QRCode(q,{text:uri,width:180,height:180});
  up.querySelector('.cp').onclick=()=>navigator.clipboard.writeText(S.upiId).then(()=>toast('UPI ID copied'));
  up.querySelector('.dl').onclick=()=>{const c=q.querySelector('canvas'),a=document.createElement('a');a.href=c.toDataURL();a.download='payasam-upi-qr.png';a.click()}};
 upiPanels.push(upi);ts.onchange=fillM;f.l.oninput=upi;f.pm.onchange=upi;root.fillT();upi();
 f.onsubmit=async e=>{e.preventDefault();if(!confirm('Place this order?'))return;const b=f.querySelector('button.alt');b.disabled=1;
  try{const r=await call('createOrder')({requestId:rq,teamId:ts.value,memberId:ms.value,customerName:f.cn.value,customerPhone:f.ph.value,litres:+f.l.value,paymentMethod:f.pm.value,careOf:f.co.value,notes:f.nt.value});toast(`Order ${r.orderId} placed (${inr(r.totalPrice)}). Payment is pending verification.`);orderForm(root,fixed)}catch(x){toast(msg(x),1);b.disabled=0}}}
forms.push($('#oform'));orderForm($('#oform'),0);
function paintDash(){const tm=board.teams.find(t=>t.teamId===user.uid),v=myOrders.filter(o=>o.orderStatus!=='Cancelled');
 const col=m=>inr(myPays.filter(p=>p.method===m).reduce((a,p)=>a+p.amount,0));
 const rk=rank(board.teams,$('#tc').value).findIndex(t=>t.teamId===user.uid)+1;
 $('#dt').textContent=tm?.teamName||'Your team';
 $('#ds').innerHTML=[['Orders',v.length],['Litres',v.reduce((a,o)=>a+o.litres,0)],['Sales',inr(v.reduce((a,o)=>a+o.totalPrice,0))],['Verified Cash',col('Cash')],['Verified UPI',col('UPI')],['Outstanding',inr(v.reduce((a,o)=>a+o.balanceDue,0))],['Customers',new Set(v.map(o=>o.customerPhone)).size],['Team Rank',rk||'-']].map(([k,x])=>`<div class="card stat"><b>${x}</b>${k}</div>`).join('');
 $('#mt').innerHTML='<tr><th>Member<th>Orders<th>Litres<th>Sales<th>Rank<th></tr>'+myMembers.filter(m=>m.status==='active').map(m=>{const s=board.members.find(x=>x.memberId===m.memberId)||{orders:0,litres:0,sales:0},r=rank(board.members,$('#pc').value).findIndex(x=>x.memberId===m.memberId)+1;return `<tr><td>${esc(m.memberName)}<td>${s.orders}<td>${s.litres}<td>${inr(s.sales)}<td>${r||'-'}<td><button data-e="${m.memberId}">Edit</button><button data-r="${m.memberId}">Remove</button></tr>`}).join('');
 $('#ot').innerHTML='<tr><th>Order<th>Date<th>Customer<th>Member<th>C/O<th>L<th>Total<th>Paid<th>Balance<th>Payment<th>Order</tr>'+[...myOrders].sort((a,b)=>(b.createdAt?.seconds||9e9)-(a.createdAt?.seconds||9e9)).map(o=>`<tr><td>${o.orderId}<td>${o.createdAt?.toDate().toLocaleDateString()||''}<td>${esc(o.customerName)}<td>${esc(o.memberNameSnapshot)}<td>${esc(o.careOf)}<td>${o.litres}<td>${inr(o.totalPrice)}<td>${inr(o.verifiedPaid)}<td>${inr(o.balanceDue)}<td><span class="tag">${o.paymentStatus}</span><td><span class="tag">${o.orderStatus}</span></tr>`).join('')}
$('#mt').onclick=async e=>{const b=e.target.closest('button');if(!b)return;const m=myMembers.find(x=>x.memberId===(b.dataset.e||b.dataset.r));try{
 if(b.dataset.e){const n=prompt('Member name',m.memberName);if(!n||!n.trim())return;await call('saveMember')({memberId:m.memberId,name:n})}
 else{if(!confirm(`Remove ${m.memberName}? Their past orders are kept.`))return;await call('saveMember')({memberId:m.memberId,remove:true})}toast('Saved')}catch(x){toast(msg(x),1)}};
$('#mf').onsubmit=async e=>{e.preventDefault();try{await call('saveMember')({name:e.target.n.value});e.target.reset();toast('Member added')}catch(x){toast(msg(x),1)}};
onAuthStateChanged(auth,async u=>{unsub.forEach(f=>f());unsub=[];const t=u&&(await u.getIdTokenResult()).claims.admin?null:u;user=t;
 $('#nl').hidden=!!t;$('#nd').hidden=$('#lo').hidden=!t;show();if(!t)return;
 const q=c=>query(collection(db,c),where('teamId','==',t.uid));
 unsub=[onSnapshot(q('members'),s=>{myMembers=s.docs.map(d=>d.data());paintDash();fillTeams()}),onSnapshot(q('orders'),s=>{myOrders=s.docs.map(d=>d.data());paintDash()}),onSnapshot(q('paymentRecords'),s=>{myPays=s.docs.map(d=>d.data());paintDash()})];
 if(!forms.includes($('#qform'))){forms.push($('#qform'));orderForm($('#qform'),1)}else fillTeams()});
show();
