// ═══════════════════════════════════════════════════════════
// صفحة الموافقات — المهندس (المكتب الفني) أو الأدمن يعتمدوا
// اليوميات وفواتير العهد المقدمة من المشرفين
// ═══════════════════════════════════════════════════════════
import { auth, showMessage, hideMessage, formatCurrency } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getUserRole, getPendingDailyLogs, getPendingCustody,
    approveDailyLog, rejectDailyLog, approveCustodyExpense, rejectCustodyExpense
} from './sheets-service.js';

const noAccessWarning = document.getElementById('noAccessWarning');
const approvalsContent = document.getElementById('approvalsContent');
const tabDaily = document.getElementById('tabDaily');
const tabCustody = document.getElementById('tabCustody');
const dailySection = document.getElementById('dailySection');
const custodySection = document.getElementById('custodySection');
const dailyPendingList = document.getElementById('dailyPendingList');
const custodyPendingList = document.getElementById('custodyPendingList');
const dailyCount = document.getElementById('dailyCount');
const custodyCount = document.getElementById('custodyCount');
const closeMessageBtn = document.getElementById('closeMessageBtn');

closeMessageBtn?.addEventListener('click', hideMessage);

let currentEmail = null;
let isApprover = false;

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentEmail = user.email;

    try {
        const info = await getUserRole(user.email);
        isApprover = (info.role === 'admin' || info.role === 'engineer');
    } catch (err) {
        console.error(err);
    }

    if (!isApprover) {
        noAccessWarning.classList.remove('hidden');
        approvalsContent.classList.add('hidden');
        return;
    }

    tabDaily.addEventListener('click', () => switchTab('daily'));
    tabCustody.addEventListener('click', () => switchTab('custody'));

    await loadAll();
});

function switchTab(tab) {
    if (tab === 'daily') {
        tabDaily.classList.add('tab-active');
        tabCustody.classList.remove('tab-active');
        dailySection.classList.remove('hidden');
        custodySection.classList.add('hidden');
    } else {
        tabCustody.classList.add('tab-active');
        tabDaily.classList.remove('tab-active');
        custodySection.classList.remove('hidden');
        dailySection.classList.add('hidden');
    }
}

async function loadAll() {
    await Promise.all([loadPendingDaily(), loadPendingCustody()]);
}

// ── اليوميات بانتظار الموافقة ──────────────────────────
async function loadPendingDaily() {
    try {
        const logs = await getPendingDailyLogs();
        const batches = groupByBatch(logs);
        dailyCount.textContent = batches.length;
        renderDailyBatches(batches);
    } catch (err) {
        console.error(err);
        dailyPendingList.innerHTML = '<p class="text-center text-red-500 text-sm py-6">فشل تحميل اليوميات</p>';
    }
}

function groupByBatch(logs) {
    const batches = [];
    const index = {};
    logs.forEach(l => {
        const key = l.batchId || l.id;
        if (!index[key]) {
            index[key] = { batchId: key, date: l.date, project: l.project, phase: l.phase, supervisor: l.supervisor, notes: l.notes, items: [] };
            batches.push(index[key]);
        }
        index[key].items.push(l);
    });
    return batches;
}

function renderDailyBatches(batches) {
    if (!batches.length) {
        dailyPendingList.innerHTML = '<div class="empty-hint text-center text-sm text-gray-500 py-6">🎉 لا توجد يوميات بانتظار الموافقة</div>';
        return;
    }

    dailyPendingList.innerHTML = batches.map(b => {
        const total = b.items.reduce((s, i) => s + (Number(i.totalCost) || 0), 0);
        return `
            <div class="section-card p-5 mb-4">
                <div class="flex flex-wrap justify-between items-center gap-2 mb-3">
                    <div>
                        <div class="font-bold text-indigo-900">${formatDate(b.date)} — ${b.project}</div>
                        <div class="text-xs text-gray-500 mt-0.5">المشرف: <b>${b.supervisor}</b></div>
                    </div>
                    <div class="font-bold text-indigo-600">${formatCurrency(total)}</div>
                </div>
                <div class="flex flex-wrap gap-2 mb-3">
                    ${b.items.map(i => `<span class="type-badge badge-daily">${i.typeName} × ${i.quantity} — ${i.phase}</span>`).join('')}
                </div>
                ${b.notes ? `<p class="text-xs text-gray-500 mb-3">📝 ${b.notes}</p>` : ''}
                <div class="flex gap-2">
                    <button type="button" onclick="approveDaily('${b.batchId}')" class="btn-secondary flex-1 py-2.5 font-bold text-sm">✅ موافقة</button>
                    <button type="button" onclick="rejectDaily('${b.batchId}')" class="btn-danger flex-1 py-2.5 font-bold text-sm">❌ رفض</button>
                </div>
            </div>
        `;
    }).join('');
}

window.approveDaily = async function (batchId) {
    if (!confirm('الموافقة على هذه اليومية؟')) return;
    try {
        await approveDailyLog(batchId, currentEmail);
        showMessage('✅ تمت الموافقة ونقلها لسجل اليوميات');
        setTimeout(() => hideMessage(), 1200);
        await loadPendingDaily();
    } catch (err) {
        showMessage('❌ فشلت الموافقة: ' + err.message);
    }
};

window.rejectDaily = async function (batchId) {
    const reason = prompt('سبب الرفض (اختياري):');
    if (reason === null) return; // المستخدم ضغط إلغاء
    try {
        await rejectDailyLog(batchId, currentEmail, reason.trim());
        showMessage('تم رفض اليومية');
        setTimeout(() => hideMessage(), 1200);
        await loadPendingDaily();
    } catch (err) {
        showMessage('❌ فشل الرفض: ' + err.message);
    }
};

// ── فواتير العهد بانتظار الموافقة ──────────────────────
async function loadPendingCustody() {
    try {
        const items = await getPendingCustody();
        const batches = groupByBatch(items);
        custodyCount.textContent = batches.length;
        renderCustodyBatches(batches);
    } catch (err) {
        console.error(err);
        custodyPendingList.innerHTML = '<p class="text-center text-red-500 text-sm py-6">فشل تحميل فواتير العهد</p>';
    }
}

function renderCustodyBatches(batches) {
    if (!batches.length) {
        custodyPendingList.innerHTML = '<div class="empty-hint text-center text-sm text-gray-500 py-6">🎉 لا توجد فواتير عهدة بانتظار الموافقة</div>';
        return;
    }

    custodyPendingList.innerHTML = batches.map(b => {
        const total = b.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
        const totalTax = b.items.reduce((s, i) => s + (Number(i.tax) || 0), 0);
        return `
            <div class="section-card p-5 mb-4">
                <div class="flex flex-wrap justify-between items-center gap-2 mb-3">
                    <div>
                        <div class="font-bold text-indigo-900">💰 ${b.project}</div>
                        <div class="text-xs text-gray-500 mt-0.5">المشرف: <b>${b.supervisor}</b> — ${b.items.length} فاتورة</div>
                    </div>
                    <div class="text-left">
                        <div class="font-bold text-indigo-600">${formatCurrency(total)}</div>
                        ${totalTax > 0 ? `<div class="text-xs text-gray-400">ضريبة: ${formatCurrency(totalTax)}</div>` : ''}
                    </div>
                </div>
                <div class="overflow-x-auto mb-3">
                    <table class="report-table text-xs">
                        <thead>
                            <tr><th>التاريخ</th><th>البند</th><th>المرحلة</th><th>الوصف</th><th>ضريبية</th><th>القيمة</th></tr>
                        </thead>
                        <tbody>
                            ${b.items.map(i => `
                                <tr>
                                    <td class="whitespace-nowrap">${formatDate(i.date)}</td>
                                    <td>${i.item || '-'}</td>
                                    <td>${i.phase || '-'}</td>
                                    <td>${i.description || '-'}</td>
                                    <td>${i.isTax === 'نعم' || i.isTax === true ? '✅' : '—'}</td>
                                    <td class="whitespace-nowrap font-bold">${formatCurrency(i.amount)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="flex gap-2">
                    <button type="button" onclick="approveCustody('${b.batchId}')" class="btn-secondary flex-1 py-2.5 font-bold text-sm">✅ موافقة</button>
                    <button type="button" onclick="rejectCustody('${b.batchId}')" class="btn-danger flex-1 py-2.5 font-bold text-sm">❌ رفض</button>
                </div>
            </div>
        `;
    }).join('');
}

window.approveCustody = async function (batchId) {
    if (!confirm('الموافقة على فواتير العهدة دي؟')) return;
    try {
        await approveCustodyExpense(batchId, currentEmail);
        showMessage('✅ تمت الموافقة ونقلها لعهد المشروع');
        setTimeout(() => hideMessage(), 1200);
        await loadPendingCustody();
    } catch (err) {
        showMessage('❌ فشلت الموافقة: ' + err.message);
    }
};

window.rejectCustody = async function (batchId) {
    const reason = prompt('سبب الرفض (اختياري):');
    if (reason === null) return;
    try {
        await rejectCustodyExpense(batchId, currentEmail, reason.trim());
        showMessage('تم رفض فواتير العهدة');
        setTimeout(() => hideMessage(), 1200);
        await loadPendingCustody();
    } catch (err) {
        showMessage('❌ فشل الرفض: ' + err.message);
    }
};

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return String(dateStr);
    return d.toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
