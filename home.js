// ═══════════════════════════════════════════════════════════
// الصفحة الرئيسية — نظام EXO
// ═══════════════════════════════════════════════════════════
import { auth, showMessage, hideMessage } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getSetupData, getDailyLogsSummary, getMyCustodySummary, getUserRole } from './sheets-service.js';

const signOutBtn = document.getElementById('signOutBtn');
const userWelcome = document.getElementById('userWelcome');
const quickStats = document.getElementById('quickStats');
const closeMessageBtn = document.getElementById('closeMessageBtn');
const approvalsCard = document.getElementById('approvalsCard');

closeMessageBtn?.addEventListener('click', hideMessage);

let currentUsername = null;
let currentEmail = null;
let isAdmin = false;

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }

    const username = user.email.replace('@exo-system.local', '');
    currentUsername = username;
    currentEmail = user.email;
    userWelcome.textContent = `👋 ${username}`;

    try {
        const info = await getUserRole(user.email);
        isAdmin = info.role === 'admin';
        // بطاقة الموافقات تظهر للمهندس أو الأدمن
        if (info.role === 'admin' || info.role === 'engineer') {
            approvalsCard.classList.remove('hidden');
        }
    } catch (err) {
        console.error(err);
    }

    await loadQuickStats();
});

signOutBtn?.addEventListener('click', async () => {
    try {
        await signOut(auth);
        window.location.href = 'index.html';
    } catch (err) {
        showMessage('فشل تسجيل الخروج: ' + err.message);
    }
});

async function loadQuickStats() {
    try {
        const [setup, dailySummary, custodies] = await Promise.all([
            getSetupData(),
            getDailyLogsSummary(currentUsername),
            getMyCustodySummary(currentEmail)
        ]);

        const projectsCount = (setup.projects || []).length;
        const today = new Date().toISOString().split('T')[0];

        // إحصائيات اليوميات لليوم
        const todayLogs = (dailySummary || []).filter(d => d.date === today);
        const todayTotalQty = todayLogs.reduce((sum, d) => sum + (Number(d.quantity) || 0), 0);
        const todayTotalCost = todayLogs.reduce((sum, d) => sum + (Number(d.totalCost) || 0), 0);

        // عهدة كل مشروع
        const custodyList = custodies || [];
        const custodyHtml = custodyList.length
            ? custodyList.map(c => `
                <div class="flex justify-between items-center text-sm py-1.5 border-b border-gray-100 last:border-0">
                    <span class="text-gray-600">${c.project}</span>
                    <span class="font-bold ${c.remaining >= 0 ? 'text-emerald-600' : 'text-red-600'}">${formatCurrency(c.remaining)}</span>
                </div>
            `).join('')
            : '<p class="text-gray-400 text-sm">لا توجد عهد مفعلة</p>';

        quickStats.innerHTML = `
            <div class="section-card p-4">
                <div class="text-sm text-gray-500 mb-1">إجمالي المشاريع</div>
                <div class="text-2xl font-bold text-indigo-600">${projectsCount}</div>
            </div>
            <div class="section-card p-4">
                <div class="text-sm text-gray-500 mb-1">إجماليات اليوم (${today})</div>
                <div class="text-xl font-bold text-amber-600">${todayTotalQty} وحدة</div>
                <div class="text-sm text-amber-700">${formatCurrency(todayTotalCost)}</div>
            </div>
            <div class="section-card p-4 sm:col-span-2">
                <div class="text-sm text-gray-500 mb-2">المتبقي في العهد (لكل مشروع)</div>
                ${custodyHtml}
            </div>
        `;
    } catch (err) {
        console.error(err);
        quickStats.innerHTML = `
            <div class="empty-hint text-center col-span-2">
                <p class="text-gray-500">فشل تحميل الإحصائيات</p>
            </div>
        `;
    }
}

function formatCurrency(amount) {
    return Number(amount).toLocaleString('ar-EG') + ' ر.س';
}