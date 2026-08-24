// ═══════════════════════════════════════════════════════════
// تسجيل الدخول / إنشاء حساب — نظام EXO
// ═══════════════════════════════════════════════════════════
import { auth, db, appId, adminUsername, showMessage, hideMessage } from './firebase-config.js';
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, setDoc, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { registerUser } from './sheets-service.js';

const authEmailInput = document.getElementById('authEmail');
const authPasswordInput = document.getElementById('authPassword');
const signInBtn = document.getElementById('signInBtn');
const signUpBtn = document.getElementById('signUpBtn');
const closeMessageBtn = document.getElementById('closeMessageBtn');

let isSigningUp = false; // بيمنع الـ auth-state-listener تحت من التحويل لـ home.html قبل ما signUp() يخلص كتابة الشيت

function usernameToEmail(username) {
    return `${username}@exo-system.local`;
}

async function findUserByUsername(username) {
    const usersRef = collection(db, `artifacts/${appId}/public/data/users`);
    const q = query(usersRef, where("username", "==", username));
    const snap = await getDocs(q);
    if (!snap.empty) {
        const d = snap.docs[0];
        return { id: d.id, ...d.data() };
    }
    return null;
}

async function signIn() {
    const username = authEmailInput.value.trim();
    const password = authPasswordInput.value.trim();

    if (!username || !password) {
        showMessage('يرجى ملء جميع الحقول');
        return;
    }

    showMessage('جاري تسجيل الدخول...');
    try {
        const email = usernameToEmail(username);
        await signInWithEmailAndPassword(auth, email, password);
        showMessage('تم تسجيل الدخول بنجاح!');
        setTimeout(() => { window.location.href = 'home.html'; }, 1000);
    } catch (error) {
        console.error(error);
        if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential'].includes(error.code)) {
            showMessage('اسم المستخدم أو كلمة المرور غير صحيحة');
        } else {
            showMessage(`فشل تسجيل الدخول: ${error.message}`);
        }
    }
}

async function signUp() {
    const username = authEmailInput.value.trim();
    const password = authPasswordInput.value.trim();

    if (!username || !password) {
        showMessage('يرجى ملء جميع الحقول');
        return;
    }
    if (username.length < 3) {
        showMessage('اسم المستخدم يجب أن يكون 3 أحرف على الأقل');
        return;
    }
    if (password.length < 6) {
        showMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
        return;
    }
    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(username)) {
        showMessage('اسم المستخدم يجب أن يحتوي على حروف إنجليزية وأرقام فقط');
        return;
    }

    isSigningUp = true;
    showMessage('جاري إنشاء الحساب...');
    try {
        const existing = await findUserByUsername(username);
        if (existing) {
            showMessage('اسم المستخدم مستخدم بالفعل');
            return;
        }
        const email = usernameToEmail(username);
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const role = username.toLowerCase() === adminUsername.toLowerCase() ? 'admin' : 'supervisor';

        await setDoc(doc(db, `artifacts/${appId}/public/data/users`, cred.user.uid), {
            username, role, email, createdAt: new Date(), status: 'نشط'
        });

        // تسجيل المستخدم كمان في شيت Users (مصدر الصلاحيات وتعيين المشاريع في التطبيق)
        // لو فشل النداء ده لأي سبب (مشكلة شبكة مثلاً)، الحساب في Firebase يفضل شغال عادي،
        // بس الأدمن مش هيقدر يديله صلاحيات مشاريع لحد ما يتسجل في الشيت — فبنعلم في الكونسول للمتابعة
        try {
            await registerUser({ uid: cred.user.uid, username, email });
        } catch (sheetErr) {
            console.error('فشل تسجيل المستخدم في شيت Users:', sheetErr);
        }

        showMessage('✅ تم إنشاء الحساب بنجاح');
        setTimeout(() => { window.location.href = 'home.html'; }, 1000);
    } catch (error) {
        console.error(error);
        if (error.code === 'auth/email-already-in-use') {
            showMessage('اسم المستخدم مستخدم بالفعل');
        } else if (error.code === 'auth/weak-password') {
            showMessage('كلمة المرور ضعيفة جداً');
        } else {
            showMessage(`فشل إنشاء الحساب: ${error.message}`);
        }
    } finally {
        isSigningUp = false;
    }
}

signInBtn?.addEventListener('click', signIn);
signUpBtn?.addEventListener('click', signUp);
closeMessageBtn?.addEventListener('click', hideMessage);

onAuthStateChanged(auth, (user) => {
    if (isSigningUp) return; // بلاش تحويل مبكر — خلي signUp() يخلص كتابة Firestore + الشيت الأول
    if (user && (window.location.pathname.endsWith('index.html') || window.location.pathname === '/')) {
        window.location.href = 'home.html';
    }
});