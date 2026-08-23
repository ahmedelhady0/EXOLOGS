// ═══════════════════════════════════════════════════════════
// الصفحة الرئيسية — نظام EXO
// ═══════════════════════════════════════════════════════════
import { auth, showMessage, hideMessage } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getSetupData, getDailyLogsSummary, getAdvanceMovements, getUserRole } from './sheets-service.js';

const signOutBtn = document.getElementById('signOutBtn');
const userWelcome = document.getElementById('userWelcome');
const quickStats = document.getElementById('quickStats');
const closeMessageBtn = document.getElementById('closeMessageBtn');

closeMessageBtn?.addEventListener('click', hideMessage);

let currentUsername = null;
let isAdmin = false;

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }

    const username = user.email.replace('@exo-system.local', '');
    currentUsername = username;
    userWelcome.textContent = `👋 ${username}`;

    try {
        const info = await getUserRole(user.email);
        isAdmin = info.role === 'admin';
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
        const [setup, dailySummary, advanceMovements] = await Promise.all([
            getSetupData(),
            getDailyLogsSummary(currentUsername),
            getAdvanceMovements(currentUsername)
        ]);

        const projectsCount = (setup.projects || []).length;
        const today = new Date().toISOString().split('T')[0];

        // إحصائيات اليوميات لليوم
        const todayLogs = (dailySummary || []).filter(d => d.date === today);
        const todayTotalQty = todayLogs.reduce((sum, d) => sum + (Number(d.quantity) || 0), 0);
        const todayTotalCost = todayLogs.reduce((sum, d) => sum + (Number(d.totalCost) || 0), 0);

        // إحصائيات العهد
        const movements = advanceMovements || [];
        const totalDeposit = movements.filter(m => m.type === 'إيداع عهدة').reduce((s, m) => s + (Number(m.amount) || 0), 0);
        const totalExpense = movements.filter(m => m.type === 'صرف').reduce((s, m) => s + (Number(m.amount) || 0), 0);
        const remaining = totalDeposit - totalExpense;

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
            <div class="section-card p-4">
                <div class="text-sm text-gray-500 mb-1">عهدة ${currentUsername}</div>
                <div class="text-xl font-bold ${remaining >= 0 ? 'text-emerald-600' : 'text-red-600'}">${formatCurrency(remaining)}</div>
                <div class="text-xs text-gray-500">إيداع: ${formatCurrency(totalDeposit)} | صرف: ${formatCurrency(totalExpense)}</div>
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