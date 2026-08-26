// ═══════════════════════════════════════════════════════════
// صفحة الموافقات — المهندس (المكتب الفني) أو الأدمن يعتمدوا
// اليوميات وفواتير العهد المقدمة من المشرفين
// ═══════════════════════════════════════════════════════════
import { auth, showToast, showConfirm, showPrompt, skeletonCards, formatCurrency } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getUserRole, getPendingDailyLogs, getPendingCustody,
    approveDailyLog, rejectDailyLog, approveCustodyExpense, rejectCustodyExpense,
    bulkApproveDailyLogs, bulkApproveCustody
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
const bottomNavApprovals = document.getElementById('bottomNavApprovals');

let currentEmail = null;
let isApprover = false;

// دفعات محددة للموافقة الجماعية
const selectedDaily = new Set();
const selectedCustody = new Set();

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

    bottomNavApprovals?.classList.remove('hidden');
    tabDaily.addEventListener('click', () => switchTab('daily'));
    tabCustody.addEventListener('click', () => switchTab('custody'));

    dailyPendingList.innerHTML = skeletonCards(3);
    custodyPendingList.innerHTML = skeletonCards(3);

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

// ── اليوميات بانتظار الموافقة ──────────────────────────
async function loadPendingDaily() {
    try {
        const logs = await getPendingDailyLogs();
        const batches = groupByBatch(logs);
        dailyCount.textContent = batches.length;
        selectedDaily.clear();
        renderDailyBatches(batches);
    } catch (err) {
        console.error(err);
        dailyPendingList.innerHTML = '<p class="text-center text-red-500 text-sm py-6">فشل تحميل اليوميات</p>';
    }
}

function renderDailyBatches(batches) {
    if (!batches.length) {
        dailyPendingList.innerHTML = '<div class="empty-hint text-center text-sm text-gray-500 py-6">🎉 لا توجد يوميات بانتظار الموافقة</div>';
        return;
    }

    const toolbar = `
        <div class="bulk-toolbar">
            <label><input type="checkbox" id="dailySelectAll"> تحديد الكل (${batches.length})</label>
            <button type="button" id="dailyBulkApproveBtn" class="btn-secondary py-2 px-4 text-sm font-bold" disabled>✅ موافقة على المحدد (<span id="dailySelectedCount">0</span>)</button>
        </div>`;

    const cards = batches.map(b => {
        const total = b.items.reduce((s, i) => s + (Number(i.totalCost) || 0), 0);
        return `
            <div class="section-card p-5 mb-4 batch-card-row">
                <input type="checkbox" class="batch-select-checkbox batch-select-daily mt-1" data-batch="${b.batchId}">
                <div class="batch-card-content">
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
                        <button type="button" data-approve-daily="${b.batchId}" class="btn-secondary flex-1 py-2.5 font-bold text-sm">✅ موافقة</button>
                        <button type="button" data-reject-daily="${b.batchId}" class="btn-danger flex-1 py-2.5 font-bold text-sm">❌ رفض</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    dailyPendingList.innerHTML = toolbar + cards;
    wireDailyEvents();
}

function wireDailyEvents() {
    const selectAll = document.getElementById('dailySelectAll');
    const bulkBtn = document.getElementById('dailyBulkApproveBtn');
    const countEl = document.getElementById('dailySelectedCount');

    const updateToolbar = () => {
        countEl.textContent = selectedDaily.size;
        bulkBtn.disabled = selectedDaily.size === 0;
    };

    dailyPendingList.querySelectorAll('.batch-select-daily').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) selectedDaily.add(cb.dataset.batch); else selectedDaily.delete(cb.dataset.batch);
            const all = dailyPendingList.querySelectorAll('.batch-select-daily');
            selectAll.checked = selectedDaily.size === all.length;
            updateToolbar();
        });
    });

    selectAll?.addEventListener('change', () => {
        dailyPendingList.querySelectorAll('.batch-select-daily').forEach(cb => {
            cb.checked = selectAll.checked;
            if (selectAll.checked) selectedDaily.add(cb.dataset.batch); else selectedDaily.delete(cb.dataset.batch);
        });
        updateToolbar();
    });

    bulkBtn?.addEventListener('click', handleBulkApproveDaily);

    dailyPendingList.querySelectorAll('[data-approve-daily]').forEach(btn => {
        btn.addEventListener('click', () => approveDaily(btn.dataset.approveDaily));
    });
    dailyPendingList.querySelectorAll('[data-reject-daily]').forEach(btn => {
        btn.addEventListener('click', () => rejectDaily(btn.dataset.rejectDaily));
    });
}

async function approveDaily(batchId) {
    const ok = await showConfirm('الموافقة على هذه اليومية؟');
    if (!ok) return;
    try {
        await approveDailyLog(batchId, currentEmail);
        showToast('تمت الموافقة ونقلها لسجل اليوميات', 'success');
        await loadPendingDaily();
    } catch (err) {
        showToast('فشلت الموافقة: ' + err.message, 'error');
    }
}

async function rejectDaily(batchId) {
    const reason = await showPrompt('سبب رفض هذه اليومية (اختياري):', { placeholder: 'مثال: الكمية غير مطابقة' });
    if (reason === null) return; // المستخدم ألغى
    try {
        await rejectDailyLog(batchId, currentEmail, reason);
        showToast('تم رفض اليومية', 'warning');
        await loadPendingDaily();
    } catch (err) {
        showToast('فشل الرفض: ' + err.message, 'error');
    }
}

async function handleBulkApproveDaily() {
    const ids = Array.from(selectedDaily);
    if (!ids.length) return;
    const ok = await showConfirm(`الموافقة على ${ids.length} يومية محددة دفعة واحدة؟`);
    if (!ok) return;
    try {
        const r = await bulkApproveDailyLogs(ids, currentEmail);
        if (r.failed && r.failed.length) {
            showToast(`تمت الموافقة على ${r.batches} وفشلت ${r.failed.length}`, 'warning');
        } else {
            showToast(`تمت الموافقة على ${r.batches} يومية`, 'success');
        }
        await loadPendingDaily();
    } catch (err) {
        showToast('فشلت الموافقة الجماعية: ' + err.message, 'error');
    }
}

// ── فواتير العهد بانتظار الموافقة ──────────────────────
async function loadPendingCustody() {
    try {
        const items = await getPendingCustody();
        const batches = groupByBatch(items);
        custodyCount.textContent = batches.length;
        selectedCustody.clear();
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

    const toolbar = `
        <div class="bulk-toolbar">
            <label><input type="checkbox" id="custodySelectAll"> تحديد الكل (${batches.length})</label>
            <button type="button" id="custodyBulkApproveBtn" class="btn-secondary py-2 px-4 text-sm font-bold" disabled>✅ موافقة على المحدد (<span id="custodySelectedCount">0</span>)</button>
        </div>`;

    const cards = batches.map(b => {
        const total = b.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
        const totalTax = b.items.reduce((s, i) => s + (Number(i.tax) || 0), 0);
        return `
            <div class="section-card p-5 mb-4 batch-card-row">
                <input type="checkbox" class="batch-select-checkbox batch-select-custody mt-1" data-batch="${b.batchId}">
                <div class="batch-card-content">
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
                        <button type="button" data-approve-custody="${b.batchId}" class="btn-secondary flex-1 py-2.5 font-bold text-sm">✅ موافقة</button>
                        <button type="button" data-reject-custody="${b.batchId}" class="btn-danger flex-1 py-2.5 font-bold text-sm">❌ رفض</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    custodyPendingList.innerHTML = toolbar + cards;
    wireCustodyEvents();
}

function wireCustodyEvents() {
    const selectAll = document.getElementById('custodySelectAll');
    const bulkBtn = document.getElementById('custodyBulkApproveBtn');
    const countEl = document.getElementById('custodySelectedCount');

    const updateToolbar = () => {
        countEl.textContent = selectedCustody.size;
        bulkBtn.disabled = selectedCustody.size === 0;
    };

    custodyPendingList.querySelectorAll('.batch-select-custody').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) selectedCustody.add(cb.dataset.batch); else selectedCustody.delete(cb.dataset.batch);
            const all = custodyPendingList.querySelectorAll('.batch-select-custody');
            selectAll.checked = selectedCustody.size === all.length;
            updateToolbar();
        });
    });

    selectAll?.addEventListener('change', () => {
        custodyPendingList.querySelectorAll('.batch-select-custody').forEach(cb => {
            cb.checked = selectAll.checked;
            if (selectAll.checked) selectedCustody.add(cb.dataset.batch); else selectedCustody.delete(cb.dataset.batch);
        });
        updateToolbar();
    });

    bulkBtn?.addEventListener('click', handleBulkApproveCustody);

    custodyPendingList.querySelectorAll('[data-approve-custody]').forEach(btn => {
        btn.addEventListener('click', () => approveCustody(btn.dataset.approveCustody));
    });
    custodyPendingList.querySelectorAll('[data-reject-custody]').forEach(btn => {
        btn.addEventListener('click', () => rejectCustody(btn.dataset.rejectCustody));
    });
}

async function approveCustody(batchId) {
    const ok = await showConfirm('الموافقة على فواتير العهدة دي؟');
    if (!ok) return;
    try {
        await approveCustodyExpense(batchId, currentEmail);
        showToast('تمت الموافقة ونقلها لعهد المشروع', 'success');
        await loadPendingCustody();
    } catch (err) {
        showToast('فشلت الموافقة: ' + err.message, 'error');
    }
}

async function rejectCustody(batchId) {
    const reason = await showPrompt('سبب رفض فواتير العهدة دي (اختياري):', { placeholder: 'مثال: الفاتورة غير واضحة' });
    if (reason === null) return;
    try {
        await rejectCustodyExpense(batchId, currentEmail, reason);
        showToast('تم رفض فواتير العهدة', 'warning');
        await loadPendingCustody();
    } catch (err) {
        showToast('فشل الرفض: ' + err.message, 'error');
    }
}

async function handleBulkApproveCustody() {
    const ids = Array.from(selectedCustody);
    if (!ids.length) return;
    const ok = await showConfirm(`الموافقة على ${ids.length} دفعة فواتير عهدة محددة دفعة واحدة؟`);
    if (!ok) return;
    try {
        const r = await bulkApproveCustody(ids, currentEmail);
        if (r.failed && r.failed.length) {
            showToast(`تمت الموافقة على ${r.batches} وفشلت ${r.failed.length}`, 'warning');
        } else {
            showToast(`تمت الموافقة على ${r.batches} دفعة فواتير عهدة`, 'success');
        }
        await loadPendingCustody();
    } catch (err) {
        showToast('فشلت الموافقة الجماعية: ' + err.message, 'error');
    }
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return String(dateStr);
    return d.toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
