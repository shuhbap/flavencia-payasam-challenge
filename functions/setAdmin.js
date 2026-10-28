// Usage: GOOGLE_APPLICATION_CREDENTIALS=key.json node setAdmin.js admin@example.com
const a=require('firebase-admin');a.initializeApp();
a.auth().getUserByEmail(process.argv[2]).then(u=>a.auth().setCustomUserClaims(u.uid,{admin:true})).then(()=>console.log('Admin granted'));
