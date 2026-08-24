// ═══════════════════════════════════════════════════════════
// إعدادات Firebase — نظام EXO
// ═══════════════════════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyD2E2_Tr98L66ck23idPOK1U6TgHKgFbdY",
    authDomain: "exologs-1d046.firebaseapp.com",
    projectId: "exologs-1d046",
    storageBucket: "exologs-1d046.firebasestorage.app",
    messagingSenderId: "1090407293498",
    appId: "1:1090407293498:web:fe5d05474d875046390b03"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// معرف التطبيق المنفصل عن المشروع القديم
export const appId = 'exo-system';
export const adminUsername = "admin";

// ═══════════════════════════════════════════════════════════
// دوال مساعدة مشتركة
// ═══════════════════════════════════════════════════════════
export function showMessage(text) {
    const box = document.getElementById('messageBox');
    const txt = document.getElementById('messageText');
    if (box && txt) {
        txt.textContent = text;
        box.classList.remove('hidden');
        box.classList.add('flex');
    } else {
        alert(text);
    }
}

export function hideMessage() {
    const box = document.getElementById('messageBox');
    if (box) {
        box.classList.add('hidden');
        box.classList.remove('flex');
    }
}

export function todayStr() {
    const d = new Date();
    return d.toISOString().split('T')[0];
}

export function formatDate(ts) {
    if (!ts) return '';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatCurrency(amount) {
    return Number(amount).toLocaleString('ar-EG') + ' ر.س';
}