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

// اسم الشركة اللي بيظهر في ترويسة التقارير المطبوعة — غيّره لاسم شركتك
export const companyName = "EXO";

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

// ═══════════════════════════════════════════════════════════
// إشعارات Toast خفيفة — بديل المودال لرسائل النجاح/التنبيه
// البسيطة اللي مش محتاجة توقف المستخدم (بتختفي لوحدها)
// type: 'success' | 'error' | 'warning' | 'info'
// ═══════════════════════════════════════════════════════════
export function showToast(text, type = 'success') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container no-print';
        document.body.appendChild(container);
    }

    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-text">${text}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast-show'));

    const remove = () => {
        toast.classList.remove('toast-show');
        setTimeout(() => toast.remove(), 250);
    };
    const timer = setTimeout(remove, type === 'error' ? 4500 : 2800);
    toast.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

// ═══════════════════════════════════════════════════════════
// مودال تأكيد بنفس هوية تصميم الموقع — بديل confirm() الافتراضي
// بيرجع Promise<boolean>: true لو ضغط تأكيد، false لو ألغى
// ═══════════════════════════════════════════════════════════
export function showConfirm(message, { confirmText = 'تأكيد', cancelText = 'إلغاء', danger = false } = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-backdrop';
        overlay.innerHTML = `
            <div class="confirm-box">
                <p class="confirm-message">${message}</p>
                <div class="confirm-actions">
                    <button type="button" class="confirm-cancel">${cancelText}</button>
                    <button type="button" class="confirm-ok ${danger ? 'confirm-danger' : ''}">${confirmText}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('confirm-show'));

        const cleanup = (result) => {
            overlay.classList.remove('confirm-show');
            setTimeout(() => overlay.remove(), 200);
            resolve(result);
        };
        overlay.querySelector('.confirm-ok').addEventListener('click', () => cleanup(true));
        overlay.querySelector('.confirm-cancel').addEventListener('click', () => cleanup(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    });
}

// ═══════════════════════════════════════════════════════════
// مودال إدخال نص بنفس هوية التصميم — بديل prompt() الافتراضي
// بيرجع Promise<string|null>: النص لو ضغط تأكيد، null لو ألغى
// ═══════════════════════════════════════════════════════════
export function showPrompt(message, { placeholder = '', okText = 'تأكيد', cancelText = 'إلغاء' } = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-backdrop';
        overlay.innerHTML = `
            <div class="confirm-box">
                <p class="confirm-message">${message}</p>
                <textarea class="confirm-input" rows="2" placeholder="${placeholder}"></textarea>
                <div class="confirm-actions">
                    <button type="button" class="confirm-cancel">${cancelText}</button>
                    <button type="button" class="confirm-ok">${okText}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('confirm-show'));
        const input = overlay.querySelector('.confirm-input');
        setTimeout(() => input.focus(), 150);

        const cleanup = (result) => {
            overlay.classList.remove('confirm-show');
            setTimeout(() => overlay.remove(), 200);
            resolve(result);
        };
        overlay.querySelector('.confirm-ok').addEventListener('click', () => cleanup(input.value.trim()));
        overlay.querySelector('.confirm-cancel').addEventListener('click', () => cleanup(null));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
    });
}

// ═══════════════════════════════════════════════════════════
// سطور Skeleton بديلة لنص "جاري التحميل..." أثناء انتظار الشيت
// ═══════════════════════════════════════════════════════════
export function skeletonCards(count = 3) {
    return Array.from({ length: count }, () => `
        <div class="skeleton-card">
            <div class="skeleton-line w-60"></div>
            <div class="skeleton-line w-40"></div>
        </div>
    `).join('');
}

export function skeletonRows(count = 4) {
    return Array.from({ length: count }, () => `<tr class="skeleton-row"><td colspan="99"><div class="skeleton-line w-100"></div></td></tr>`).join('');
}

export function formatCurrency(amount) {
    return Number(amount).toLocaleString('ar-EG') + ' ر.س';
}

// ═══════════════════════════════════════════════════════════
// طباعة تقرير احترافي (كشف عهدة / سجل يوميات) — عبر معاينة طباعة
// المتصفح، والمستخدم يقدر يحفظه PDF مباشرة من نافذة الطباعة
// (اختر "حفظ كـ PDF" بدل الطابعة). مفيش حاجة تتحمّل ولا مكتبات؛
// شغالة بالعربي وبالـ RTL صح 100% لأنها بتستخدم نفس صفحة الموقع.
//
// title: عنوان التقرير، subtitle: نص فرعي (مثلاً اسم المشروع)
// metaLines: مصفوفة سطور تفاصيل تظهر يمين الترويسة (تاريخ، مشرف، إجماليات...)
// columns: أسماء الأعمدة، rows: مصفوفة صفوف (كل صف = مصفوفة نصوص)
// totalsRow: صف إجمالي اختياري يظهر في أسفل الجدول
// showSignatures: يظهر خانات توقيع (مشرف/مهندس/إدارة) في آخر الصفحة
// ═══════════════════════════════════════════════════════════
export function printReport({
    title, subtitle = '', metaLines = [], columns = [], rows = [],
    totalsRow = null, showSignatures = true, emptyText = 'لا توجد بيانات'
}) {
    let area = document.getElementById('printArea');
    if (!area) {
        area = document.createElement('div');
        area.id = 'printArea';
        area.className = 'print-only';
        document.body.appendChild(area);
    }

    const rowsHtml = rows.length
        ? rows.map(r => `<tr>${r.map(c => `<td>${c ?? '-'}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${columns.length}" style="padding:16px;color:#999;">${emptyText}</td></tr>`;

    const totalsHtml = (totalsRow && rows.length)
        ? `<tfoot><tr>${totalsRow.map(c => `<td>${c ?? ''}</td>`).join('')}</tr></tfoot>`
        : '';

    const metaHtml = metaLines.filter(Boolean).join('<br>');

    const signaturesHtml = showSignatures ? `
        <div class="print-signatures">
            <div class="sig"><div class="line">توقيع المشرف</div></div>
            <div class="sig"><div class="line">توقيع المهندس / المكتب الفني</div></div>
            <div class="sig"><div class="line">اعتماد الإدارة</div></div>
        </div>
    ` : '';

    area.innerHTML = `
        <div class="print-report">
            <div class="print-letterhead">
                <div>
                    <div class="company-name">🏗️ ${companyName}</div>
                    <div class="report-title">${title}${subtitle ? ' — ' + subtitle : ''}</div>
                </div>
                <div class="report-meta">${metaHtml}</div>
            </div>
            <table>
                <thead><tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr></thead>
                <tbody>${rowsHtml}</tbody>
                ${totalsHtml}
            </table>
            ${signaturesHtml}
            <div class="print-footer">تم إنشاء هذا التقرير آلياً من نظام ${companyName} — ${new Date().toLocaleString('ar-EG')}</div>
        </div>
    `;

    // اسم الملف المقترح لو المستخدم اختار "حفظ كـ PDF" من نافذة الطباعة
    const prevTitle = document.title;
    document.title = `${title}${subtitle ? '-' + subtitle : ''}`.replace(/\s+/g, '_');
    window.print();
    setTimeout(() => { document.title = prevTitle; }, 800);
}