const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const crypto=require('crypto');
initializeApp();const db=getFirestore(),TS=()=>FieldValue.serverTimestamp();
const R='asia-south1',opt={region:R,cors:true};
const bad=m=>{throw new HttpsError('invalid-argument',m)};
const str=(v,n=80)=>String(v??'').trim().replace(/\s+/g,' ').slice(0,n);
const hash=n=>crypto.createHash('sha256').update(str(n).toLowerCase()).digest('hex').slice(0,40);
const admin=r=>{if(!r.auth?.token.admin)throw new HttpsError('permission-denied','Admin only')};
const teamUid=r=>{if(!r.auth||r.auth.token.admin)throw new HttpsError('unauthenticated','Team login required');return r.auth.uid};
const money=n=>Math.round(n*100)/100;
const rid=v=>{const s=String(v||'').replace(/[^A-Za-z0-9]/g,'').slice(0,24);if(s.length<8)bad('Missing request id');return s.toUpperCase()};

exports.registerTeam=onCall(opt,async({data:d})=>{
 const name=str(d.teamName,40),pw=String(d.password||''),names=(d.members||[]).map(n=>str(n,40));
 if(name.length<2)bad('Team name required');if(pw.length<8)bad('Password needs 8+ characters');
 if(!names.length||names.length>20||names.some(n=>!n))bad('Every member needs a name (max 20)');
 const ref=db.doc('teamNames/'+name.toLowerCase().replace(/\//g,'_'));
 if((await ref.get()).exists)bad('Team name already taken');
 const u=await getAuth().createUser({email:hash(name)+'@teams.payasam.app',password:pw,displayName:name}).catch(()=>bad('Team name already taken'));
 try{const b=db.batch();
  b.create(ref,{teamId:u.uid});
  b.create(db.doc('teams/'+u.uid),{teamId:u.uid,teamName:name,memberCount:names.length,status:'active',createdAt:TS()});
  names.forEach(n=>{const m=db.collection('members').doc();b.create(m,{memberId:m.id,teamId:u.uid,memberName:n,status:'active',createdAt:TS(),updatedAt:TS()})});
  await b.commit();}catch(e){await getAuth().deleteUser(u.uid);bad('Name already taken')}
 return {teamId:u.uid};
});

exports.saveMember=onCall(opt,async r=>{
 const tid=teamUid(r),{memberId,name,remove}=r.data,n=str(name,40);
 await db.runTransaction(async t=>{
  const tr=db.doc('teams/'+tid);let m=null;
  if(memberId){m=await t.get(db.doc('members/'+memberId));if(!m.exists||m.data().teamId!==tid)throw new HttpsError('permission-denied','Not your member')}
  const act=(await t.get(db.collection('members').where('teamId','==',tid).where('status','==','active'))).size;
  if(remove){if(act<=1)bad('Team needs at least one member');t.update(m.ref,{status:'removed',updatedAt:TS()});t.update(tr,{memberCount:act-1})}
  else{if(!n)bad('Name required');
   if(m)t.update(m.ref,{memberName:n,updatedAt:TS()});
   else{if(act>=20)bad('Max 20 members');const x=db.collection('members').doc();t.create(x,{memberId:x.id,teamId:tid,memberName:n,status:'active',createdAt:TS(),updatedAt:TS()});t.update(tr,{memberCount:act+1})}}
 });return {ok:true};
});

exports.createOrder=onCall(opt,async r=>{
 const d=r.data||{},teamId=r.auth&&!r.auth.token.admin?r.auth.uid:str(d.teamId,40);
 const s=(await db.doc('public/settings').get()).data()||{};
 if(!s.pricePerLitre)bad('Price not configured yet');
 if(!teamId||!d.memberId)bad('Team and member required');
 const [t,m]=await Promise.all([db.doc('teams/'+teamId).get(),db.doc('members/'+str(d.memberId,40)).get()]);
 if(!t.exists||t.data().status!=='active')bad('Team unavailable');
 if(!m.exists||m.data().teamId!==teamId||m.data().status!=='active')bad('Choose a valid member');
 const litres=Number(d.litres),method=d.paymentMethod,phone=str(d.customerPhone,15),cust=str(d.customerName,60);
 if(!(litres>0&&litres<=1000))bad('Litres must be between 0 and 1000');
 if(!['Cash','UPI','Pending'].includes(method))bad('Invalid payment method');
 if(method==='UPI'&&!s.upiEnabled)bad('UPI is currently disabled');
 if(cust.length<2)bad('Customer name required');if(!/^\+?[0-9]{8,14}$/.test(phone))bad('Valid phone required');
 const id='PC-'+rid(d.requestId),ref=db.doc('orders/'+id),total=money(litres*s.pricePerLitre);
 try{await ref.create({orderId:id,teamId,teamNameSnapshot:t.data().teamName,memberId:m.id,memberNameSnapshot:m.data().memberName,customerName:cust,customerPhone:phone,litres,pricePerLitre:s.pricePerLitre,totalPrice:total,verifiedPaid:0,balanceDue:total,careOf:str(d.careOf,60),paymentMethod:method,paymentStatus:method==='UPI'?'Pending Verification':'Pending',orderStatus:'New',notes:str(d.notes,300),createdAt:TS(),updatedAt:TS()})}
 catch(e){if(e.code!==6)throw e}
 return {orderId:id,totalPrice:total};
});

exports.recordPayment=onCall(opt,async r=>{admin(r);
 const {orderId,method,notes}=r.data,amt=money(Number(r.data.amount)),pid='PAY-'+rid(r.data.requestId);
 if(!['Cash','UPI'].includes(method))bad('Method must be Cash or UPI');
 await db.runTransaction(async t=>{
  const o=await t.get(db.doc('orders/'+orderId));if(!o.exists)bad('Order not found');const x=o.data();
  if(x.orderStatus==='Cancelled')bad('Order is cancelled');
  if(!(amt>0)||amt>money(x.balanceDue))bad('Amount must be positive and within balance '+x.balanceDue);
  const p=db.doc('paymentRecords/'+pid);if((await t.get(p)).exists)bad('Duplicate payment entry');
  const paid=money(x.verifiedPaid+amt),bal=money(x.totalPrice-paid);
  t.create(p,{paymentId:pid,orderId,teamId:x.teamId,amount:amt,method,verificationStatus:'Verified',recordedBy:r.auth.uid,notes:str(notes,200),createdAt:TS()});
  t.update(o.ref,{verifiedPaid:paid,balanceDue:bal,paymentStatus:bal<=0?'Paid':'Partially Paid',updatedAt:TS()});
 });return {ok:true};
});

exports.setOrderStatus=onCall(opt,async r=>{admin(r);
 const {orderId,status,refund}=r.data;if(!['New','Confirmed','Delivered','Cancelled'].includes(status))bad('Invalid status');
 await db.runTransaction(async t=>{
  const o=await t.get(db.doc('orders/'+orderId));if(!o.exists)bad('Order not found');const x=o.data(),u={orderStatus:status,updatedAt:TS()};
  if(status==='Cancelled'&&x.verifiedPaid>0){
   if(refund!==true)bad('Order has verified payments: confirm the refund to cancel');
   const p=db.collection('paymentRecords').doc();
   t.create(p,{paymentId:p.id,orderId,teamId:x.teamId,amount:-x.verifiedPaid,method:'Refund',verificationStatus:'Verified',recordedBy:r.auth.uid,notes:'Refund on cancellation',createdAt:TS()});
   Object.assign(u,{verifiedPaid:0,balanceDue:0,paymentStatus:'Refunded'});}
  t.update(o.ref,u)});
 return {ok:true};
});

exports.editOrder=onCall(opt,async r=>{admin(r);const d=r.data;
 await db.doc('orders/'+d.orderId).update({customerName:str(d.customerName,60),customerPhone:str(d.customerPhone,15),careOf:str(d.careOf,60),notes:str(d.notes,300),updatedAt:TS()});return {ok:true}});

exports.setTeamStatus=onCall(opt,async r=>{admin(r);if(!['active','inactive'].includes(r.data.status))bad('Invalid');
 await db.doc('teams/'+r.data.teamId).update({status:r.data.status});return {ok:true}});

exports.saveSettings=onCall(opt,async r=>{admin(r);const d=r.data,p=Number(d.pricePerLitre);
 if(!(p>0))bad('Price must be positive');
 if(d.upiEnabled&&(!/^[\w.\-]{2,}@[A-Za-z]{2,}$/.test(str(d.upiId))||!str(d.payeeName)))bad('Valid UPI ID and payee name required to enable UPI');
 const c=['orders','litres','sales'];
 await db.doc('public/settings').set({pricePerLitre:p,upiEnabled:!!d.upiEnabled,upiId:str(d.upiId),payeeName:str(d.payeeName),paymentInstructions:str(d.paymentInstructions,300),defaultTeamRanking:c.includes(d.defaultTeamRanking)?d.defaultTeamRanking:'sales',defaultIndividualRanking:c.includes(d.defaultIndividualRanking)?d.defaultIndividualRanking:'sales',updatedAt:TS()},{merge:true});return {ok:true}});

async function rebuild(){
 const [T,M,O]=await Promise.all(['teams','members','orders'].map(c=>db.collection(c).get()));
 const ts={},ms={},z=()=>({orders:0,litres:0,sales:0});
 T.forEach(d=>{const x=d.data();if(x.status==='active')ts[d.id]={teamId:d.id,teamName:x.teamName,...z(),members:[]}});
 M.forEach(d=>{const x=d.data();if(!ts[x.teamId])return;ms[d.id]={memberId:d.id,memberName:x.memberName,teamId:x.teamId,teamName:ts[x.teamId].teamName,active:x.status==='active',...z()};if(x.status==='active')ts[x.teamId].members.push({memberId:d.id,memberName:x.memberName})});
 const cu=new Set(),st=z();
 O.forEach(d=>{const o=d.data();if(o.orderStatus==='Cancelled')return;st.orders++;st.litres+=o.litres;st.sales+=o.totalPrice;cu.add(o.customerPhone);
  for(const a of [ts[o.teamId],ms[o.memberId]])if(a){a.orders++;a.litres+=o.litres;a.sales=money(a.sales+o.totalPrice)}});
 await db.doc('public/board').set({teams:Object.values(ts),members:Object.values(ms).filter(m=>m.active||m.orders>0),stats:{...st,sales:money(st.sales),litres:money(st.litres),teams:Object.keys(ts).length,members:Object.values(ms).filter(m=>m.active).length,customers:cu.size},updatedAt:TS()});
}
for(const [n,p] of [['onOrder','orders/{id}'],['onMember','members/{id}'],['onTeam','teams/{id}']])exports[n]=onDocumentWritten({document:p,region:R},rebuild);
