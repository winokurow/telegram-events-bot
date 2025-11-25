const firebaseConfig = {
  apiKey: "AIzaSyCz_dRomDL-tQWVd5ur-Xm_TaGVLItP0_0",
  authDomain: "telegram-events-bot-eb897.firebaseapp.com",
  projectId: "telegram-events-bot-eb897",
  storageBucket: "telegram-events-bot-eb897.firebasestorage.app",
  messagingSenderId: "114667236540",
  appId: "1:114667236540:web:4efe58a67cce5722c7b4b9",
};
firebase.initializeApp(firebaseConfig);

const appCheck = firebase.appCheck();
appCheck.activate(
  new firebase.appCheck.ReCaptchaEnterpriseProvider(
    "6LfP3tMrAAAAAPPxN1QXjIp7i0BIUHI4wcxbAG_c",
  ),
  true, // Set to true to allow auto-refresh.
);

// 3) Useful logs
firebase.firestore.setLogLevel("error"); // 'debug' if you want very verbose logs

firebase.appCheck().onTokenChanged((tokenResult) => {
  if (tokenResult && tokenResult.token) {
    console.log(
      "[AppCheck] token acquired:",
      tokenResult.token.slice(0, 12) + "…",
    );
  } else {
    console.warn("[AppCheck] NO TOKEN YET");
  }
});

window.db = firebase.firestore();
window.storage = firebase.storage();

console.log("✅ Firebase initialized, db:", window.db);
