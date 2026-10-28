import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';
import {cfg} from './firebase-config.js';
const app=initializeApp(cfg);
export const auth=getAuth(app),db=getFirestore(app),fns=getFunctions(app,'asia-south1');
export const call=n=>async d=>(await httpsCallable(fns,n)(d)).data;
export const $=s=>document.querySelector(s);
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const inr=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
export const toast=(m,err)=>{const t=document.createElement('div');t.className='toast'+(err?' err':'');t.setAttribute('role','alert');t.textContent=m;document.body.append(t);setTimeout(()=>t.remove(),4500)};
export const msg=e=>e?.message?.replace(/^.*?: /,'')||'Something went wrong';
export async function teamEmail(n){const k=n.trim().replace(/\s+/g,' ').toLowerCase();const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(k));return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,40)+'@teams.payasam.app'}
export const csv=(rows,name)=>{if(!rows.length)return toast('No rows to export',1);const k=Object.keys(rows[0]),q=v=>`"${String(v??'').replace(/"/g,'""')}"`;const b=new Blob([[k.join(','),...rows.map(r=>k.map(c=>q(r[c])).join(','))].join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name+'.csv';a.click()};
