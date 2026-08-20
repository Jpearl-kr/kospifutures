import { initializeApp } from "https://www.gstatic.com/firebasejs/11.5.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.5.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAj9SG1Xs16CeuYiRn1InKqj7AtAdM668c",
  authDomain: "kospifutures.firebaseapp.com",
  projectId: "kospifutures",
  storageBucket: "kospifutures.firebasestorage.app",
  messagingSenderId: "458442427427",
  appId: "1:458442427427:web:e6b837d6c22eabd9ee3596",
  measurementId: "G-GBF789T061",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      tier: "free",
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    });
  } else {
    await setDoc(ref, { lastLoginAt: serverTimestamp() }, { merge: true });
  }
}

function renderAuthUI(user) {
  const area = document.getElementById("authArea");
  if (!area) return;

  if (user) {
    area.innerHTML =
      '<div class="auth-user">' +
      (user.photoURL ? '<img class="auth-avatar" src="' + user.photoURL + '" alt="">' : "") +
      '<span class="auth-name">' + (user.displayName || user.email) + "</span>" +
      '<button type="button" class="btn-secondary" id="authSignOutBtn">Sign out</button>' +
      "</div>";
    document.getElementById("authSignOutBtn").addEventListener("click", function () {
      signOut(auth);
    });
  } else {
    area.innerHTML = '<button type="button" class="btn-secondary" id="authSignInBtn">Sign in with Google</button>';
    document.getElementById("authSignInBtn").addEventListener("click", function () {
      var provider = new GoogleAuthProvider();
      signInWithPopup(auth, provider).catch(function (err) {
        console.error("Sign-in failed", err);
      });
    });
  }
}

onAuthStateChanged(auth, function (user) {
  renderAuthUI(user);
  if (user) ensureUserDoc(user).catch(function (err) { console.error("Failed to save profile", err); });
});
