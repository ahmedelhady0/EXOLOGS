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
// أنواع اليوميات مع أسعارها (تجيب من الشيت أوتوماتيك)
// ═══════════════════════════════════════════════════════════
export const DAILY_LOG_TYPES = [
    { id: 'carpenter', name: 'نجار', defaultPrice: 200, allowCustomPrice: false },
    { id: 'electrician', name: 'كهربائي', defaultPrice: 180, allowCustomPrice: false },
    { id: 'plumber', name: 'سباك', defaultPrice: 190, allowCustomPrice: false },
    { id: 'painter', name: 'دهان', defaultPrice: 170, allowCustomPrice: false },
    { id: 'mason', name: 'بناء', defaultPrice: 210, allowCustomPrice: false },
    { id: 'helper', name: 'مساعد', defaultPrice: 120, allowCustomPrice: false },
    { id: 'lump_sum', name: 'مقطوعية', defaultPrice: 0, allowCustomPrice: true }
];

// المراحل الثابتة
export const PHASES = ["فوم", "رولات", "أسمنتي", "دورات مياه"];

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