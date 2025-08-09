const firebaseConfig = {
    apiKey: "AIzaSyCz_dRomDL-tQWVd5ur-Xm_TaGVLItP0_0",
    authDomain: "telegram-events-bot-eb897.firebaseapp.com",
    projectId: "telegram-events-bot-eb897",
    storageBucket: "telegram-events-bot-eb897.firebasestorage.app",
    messagingSenderId: "114667236540",
    appId: "1:114667236540:web:4efe58a67cce5722c7b4b9"
};
firebase.initializeApp(firebaseConfig);
window.db      = firebase.firestore();
window.storage = firebase.storage();

console.log("✅ Firebase initialized, db:", window.db);
