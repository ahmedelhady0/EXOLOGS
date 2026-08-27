// ═══════════════════════════════════════════════════════════
// صفحة تسجيل اليوميات — نظام EXO
// المشرف يقدر يضيف أكتر من بند (نوع + كمية) في نفس التسجيل، وكلهم بيتسجلوا
// تحت نفس الـ ID. المرحلة بتتحدد حسب المشروع المختار (من شيت "بيانات المشاريع")
// ═══════════════════════════════════════════════════════════
import { auth, showToast, showConfirm, todayStr, formatCurrency, printReport, skeletonCards } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getSetupData, logDailyLog, getDailyLogs, getMyDailyLogRequests, getUserRole, markDailyLogsPrinted } from './sheets-service.js';

const logDate = document.getElementById('logDate');
const logProject = document.getElementById('logProject');
const logPhase = document.getElementById('logPhase');
const logType = document.getElementById('logType');
const logQuantity = document.getElementById('logQuantity');
const logNotes = document.getElementById('logNotes');
const logUnitPrice = document.getElementById('logUnitPrice');
const logCustomPrice = document.getElementById('logCustomPrice');
const priceDisplaySection = document.getElementById('priceDisplaySection');
const priceDisplay = document.getElementById('priceDisplay');
const customPriceSection = document.getElementById('customPriceSection');
const itemTotalDisplay = document.getElementById('itemTotalDisplay');
const itemTotalDisplayValue = document.getElementById('itemTotalDisplayValue');
const addItemBtn = document.getElementById('addItemBtn');
const cartList = document.getElementById('cartList');
const cartCount = document.getElementById('cartCount');
const cartGrandTotal = document.getElementById('cartGrandTotal');
const cartGrandTotalValue = document.getElementById('cartGrandTotalValue');
const recentLogs = document.getElementById('recentLogs');
const pendingLogs = document.getElementById('pendingLogs');
const submitBtn = document.getElementById('submitBtn');
const noProjectsWarning = document.getElementById('noProjectsWarning');
const loggingFormSections = document.getElementById('loggingFormSections');
const refreshBtn = document.getElementById('refreshBtn');
const printCartBtn = document.getElementById('printCartBtn');
const printLogsBtn = document.getElementById('printLogsBtn');
const bottomNavApprovals = document.getElementById('bottomNavApprovals');
const filterDailyFrom = document.getElementById('filterDailyFrom');
const filterDailyTo = document.getElementById('filterDailyTo');
const filterDailyProject = document.getElementById('filterDailyProject');
const printShownBtn = document.getElementById('printShownBtn');
const printSelectedBtn = document.getElementById('printSelectedBtn');
const selectedCountEl = document.getElementById('selectedCount');
const shownCountEl = document.getElementById('shownCount');
const dailySelectAllVisible = document.getElementById('dailySelectAllVisible');
const dailyStatementSelect = document.getElementById('dailyStatementSelect');
const printDailyStatementBtn = document.getElementById('printDailyStatementBtn');

refreshBtn?.addEventListener('click', refreshData);

logDate.value = todayStr();

let currentUsername = null;
let projects = [];
let isAdmin = false;
let assignedProjects = []; // المشاريع المخصصة للمشرف الحالي (فاضية = بيشوف الكل)
let dailyLogTypes = []; // أنواع اليوميات (id/اسم/سعر/سعر يدوي) — من شيت "أسعار اليوميات"
let projectPhases = {}; // المراحل الشغالة لكل مشروع — من شيت "بيانات المشاريع" (المرحلة اللي حالتها مش "شغالة" ما بتظهرش)
let cart = []; // البنود المضافة قبل الحفظ النهائي — كلها بتتسجل مع بعض بمعرف واحد
let lastLogs = []; // آخر سجل يوميات معتمدة اتحمّل (للطباعة)
let allDailyBatches = []; // كل دفعات اليوميات المبنية من lastLogs (قبل الفلترة)
let filteredDailyBatches = []; // الدفعات بعد تطبيق الفلترة (اللي هتتعرّض للمستخدم)
const selectedLogBatches = new Set(); // معرفات الدفعات المحددة للطباعة الجماعية

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUsername = user.email.replace('@exo-system.local', '');

    pendingLogs.innerHTML = skeletonCards(2);
    recentLogs.innerHTML = skeletonCards(2);

    // الثلاث نداءات دي مالهاش علاقة ببعض، فبنطلقهم مع بعض بدل ما ننتظر كل واحد لوحده
    // (كل نداء لـ Apps Script بياخد وقت، فتشغيلهم متوازي بيقلل وقت التحميل بشكل كبير)
    const [roleInfo, setupData, logsData, pendingData] = await Promise.all([
        getUserRole(user.email).catch(err => { console.error(err); return null; }),
        getSetupData().catch(err => { console.error(err); showToast('فشل تحميل البيانات: ' + err.message, 'error'); return null; }),
        getDailyLogs(currentUsername).catch(err => { console.error(err); return []; }),
        getMyDailyLogRequests(user.email).catch(err => { console.error(err); return []; })
    ]);

    let roleLoadFailed = false;
    if (roleInfo) {
        isAdmin = roleInfo.role === 'admin';
        assignedProjects = roleInfo.projects || [];
        if (roleInfo.role === 'admin' || roleInfo.role === 'engineer') bottomNavApprovals?.classList.remove('hidden');
    } else {
        roleLoadFailed = true;
    }

    if (setupData) applySetupData(setupData, roleLoadFailed);
    lastLogs = logsData || [];
    renderRecentLogs();
    renderPendingLogs(pendingData || []);

    logProject.addEventListener('change', updatePhaseOptions);
    logType.addEventListener('change', handleTypeChange);
    logQuantity.addEventListener('input', calculateItemTotal);
    logCustomPrice.addEventListener('input', calculateItemTotal);
    addItemBtn.addEventListener('click', handleAddItem);
    submitBtn.addEventListener('click', handleSubmitBatch);
    printCartBtn?.addEventListener('click', handlePrintCart);
    printLogsBtn?.addEventListener('click', handlePrintLogs);
    filterDailyFrom?.addEventListener('input', applyDailyFilters);
    filterDailyTo?.addEventListener('input', applyDailyFilters);
    filterDailyProject?.addEventListener('change', applyDailyFilters);
    dailySelectAllVisible?.addEventListener('change', handleSelectAllVisible);
    printShownBtn?.addEventListener('click', handlePrintShown);
    printSelectedBtn?.addEventListener('click', handlePrintSelected);
    dailyStatementSelect?.addEventListener('change', () => {
        printDailyStatementBtn.disabled = !dailyStatementSelect.value;
    });
    printDailyStatementBtn?.addEventListener('click', handlePrintDailyStatement);
});

function applySetupData(data, roleLoadFailed) {
    projects = data.projects || [];
    dailyLogTypes = data.dailyLogTypes || [];
    projectPhases = data.projectPhases || {};

    // الأدمن يشوف كل المشاريع. المشرف يشوف بس المشاريع المكتوبة له في عمود "المشاريع المخصصة"
    // في شيت Users — لو العمود فاضي، معناه ملوش مشاريع لسه (مش إنه يشوف الكل)
    const visibleProjects = isAdmin ? projects : projects.filter(p => assignedProjects.includes(p));

    if (!isAdmin && visibleProjects.length === 0) {
        noProjectsWarning.textContent = roleLoadFailed
            ? '⚠️ تعذر تحميل صلاحياتك، حدّث الصفحة أو تواصل مع الأدمن.'
            : '⚠️ لا يوجد أي مشاريع مخصصة لك حاليًا. تواصل مع الأدمن لتفعيل مشروع لك.';
        noProjectsWarning.classList.remove('hidden');
        loggingFormSections.classList.add('hidden');
        return;
    }
    noProjectsWarning.classList.add('hidden');
    loggingFormSections.classList.remove('hidden');

    logProject.innerHTML = '<option value="" disabled selected>اختر المشروع</option>' +
        visibleProjects.map(p => `<option value="${p}">${p}</option>`).join('');

    // فلتر السجل: نفس قائمة المشاريع المرئية + "الكل"
    if (filterDailyProject) {
        filterDailyProject.innerHTML = '<option value="">الكل</option>' +
            visibleProjects.map(p => `<option value="${p}">${p}</option>`).join('');
    }

    // المرحلة بتتحدد لما تختار المشروع (كل مشروع له مراحله الشغالة بس من شيت "بيانات المشاريع")
    updatePhaseOptions();

    logType.innerHTML = '<option value="" disabled selected>اختر نوع اليومية</option>' +
        dailyLogTypes.map(t => `<option value="${t.id}" data-price="${t.defaultPrice}" data-custom="${t.allowCustomPrice}">${t.name}</option>`).join('');
}

// زر تحديث البيانات: بيمسح الكاش (المحلي + كاش السيرفر) ويعيد تحميل المشاريع والمراحل فوراٍ
async function refreshData() {
    try {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '⏳ جاري التحديث...';
        const prevProject = logProject.value;
        // true = forceRefresh: بيمسح كاش localStorage ويبعت refresh=1 للسيرفر عشان يمسح كاش Apps Script
        const setupData = await getSetupData(true);
        if (setupData) applySetupData(setupData, false);
        // لو المشروع المختار لسه موجود بعد التحديث، فضّله مختار وحدّث قائمة مراحله
        if (prevProject && [...logProject.options].some(o => o.value === prevProject)) {
            logProject.value = prevProject;
            updatePhaseOptions();
        }
        showToast('تم تحديث البيانات', 'success');
    } catch (err) {
        console.error(err);
        showToast('فشل التحديث: ' + err.message, 'error');
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = '🔄 تحديث البيانات';
    }
}

function updatePhaseOptions() {
    const project = logProject.value;
    const phases = project ? (projectPhases[project] || []) : [];

    if (!project) {
        logPhase.innerHTML = '<option value="" disabled selected>اختر المشروع أولاً</option>';
        logPhase.disabled = true;
        return;
    }
    if (phases.length === 0) {
        logPhase.innerHTML = '<option value="" disabled selected>لا توجد مراحل شغالة لهذا المشروع</option>';
        logPhase.disabled = true;
        return;
    }

    logPhase.disabled = false;
    logPhase.innerHTML = '<option value="" disabled selected>اختر المرحلة</option>' +
        phases.map(p => `<option value="${p}">${p}</option>`).join('');
}

function handleTypeChange() {
    const selectedOption = logType.options[logType.selectedIndex];
    const price = parseFloat(selectedOption?.dataset.price) || 0;
    const allowCustom = selectedOption?.dataset.custom === 'true';

    logUnitPrice.value = price;

    if (allowCustom) {
        priceDisplaySection.classList.add('hidden');
        customPriceSection.classList.remove('hidden');
        logCustomPrice.value = '';
        logCustomPrice.focus();
    } else {
        priceDisplaySection.classList.remove('hidden');
        customPriceSection.classList.add('hidden');
        priceDisplay.textContent = formatCurrency(price);
        priceDisplay.classList.remove('manual');
    }
    calculateItemTotal();
}

function currentItemAllowsCustom() {
    const selectedOption = logType.options[logType.selectedIndex];
    return selectedOption?.dataset.custom === 'true';
}

function currentItemUnitPrice() {
    return currentItemAllowsCustom()
        ? (parseFloat(logCustomPrice.value) || 0)
        : (parseFloat(logUnitPrice.value) || 0);
}

function calculateItemTotal() {
    const qty = parseFloat(logQuantity.value) || 0;
    const unitPrice = currentItemUnitPrice();
    const total = qty * unitPrice;

    if (qty > 0 && unitPrice > 0) {
        itemTotalDisplay.classList.remove('hidden');
        itemTotalDisplayValue.textContent = formatCurrency(total);
    } else {
        itemTotalDisplay.classList.add('hidden');
    }
}

function handleAddItem() {
    const phase = logPhase.value;
    if (!phase) { showToast('يرجى اختيار المرحلة', 'warning'); return; }

    const typeId = logType.value;
    if (!typeId) { showToast('يرجى اختيار نوع اليومية', 'warning'); return; }

    const quantity = parseFloat(logQuantity.value) || 0;
    if (quantity <= 0) { showToast('الكمية يجب أن تكون أكبر من صفر', 'warning'); return; }

    const allowCustom = currentItemAllowsCustom();
    const unitPrice = currentItemUnitPrice();
    if (allowCustom && unitPrice <= 0) { showToast('يرجى إدخال السعر للمقطوعية', 'warning'); return; }

    const selectedOption = logType.options[logType.selectedIndex];
    const typeInfo = dailyLogTypes.find(t => t.id === typeId);
    const typeName = typeInfo?.name || selectedOption?.textContent || typeId;
    const totalCost = quantity * unitPrice;

    // كل بند بيحتفظ بمرحلته الخاصة — عشان تقدر تسجل أكتر من بند بمراحل مختلفة في نفس السلة
    cart.push({ typeId, typeName, phase, quantity, unitPrice, totalCost });
    renderCart();

    // تصفير حقول "إضافة بند" عشان تضيف بند تاني على طول
    // (المرحلة بتفضل مختارة لتسهيل إضافة بند تاني بنفس المرحلة، وتقدر تغيّرها للبند الجاي)
    logType.selectedIndex = 0;
    logQuantity.value = '';
    logCustomPrice.value = '';
    priceDisplaySection.classList.add('hidden');
    customPriceSection.classList.add('hidden');
    itemTotalDisplay.classList.add('hidden');
}

function removeCartItem(index) {
    cart.splice(index, 1);
    renderCart();
}
window.removeCartItem = removeCartItem; // مستخدمة في onclick جوه الـ HTML المتولد ديناميكيًا

function renderCart() {
    if (cart.length === 0) {
        cartList.innerHTML = '<p class="text-center text-gray-400 text-sm py-4">لسه مفيش بنود مضافة</p>';
        cartCount.textContent = '0 بند';
        cartGrandTotal.classList.add('hidden');
        return;
    }

    cartCount.textContent = `${cart.length} بند`;
    cartList.innerHTML = cart.map((item, i) => `
        <div class="flex justify-between items-center py-2 ${i > 0 ? 'border-t border-gray-100' : ''}">
            <div>
                <span class="type-badge badge-daily">${item.typeName}</span>
                <span class="text-sm text-gray-600 mr-2">× ${item.quantity}</span>
                <div class="text-xs text-gray-400 mt-1">🏗️ ${item.phase}</div>
            </div>
            <div class="flex items-center gap-3">
                <span class="font-bold text-indigo-600 text-sm">${formatCurrency(item.totalCost)}</span>
                <button type="button" onclick="removeCartItem(${i})" class="text-red-500 text-lg leading-none">✖</button>
            </div>
        </div>
    `).join('');

    const grandTotal = cart.reduce((s, i) => s + i.totalCost, 0);
    cartGrandTotal.classList.remove('hidden');
    cartGrandTotalValue.textContent = formatCurrency(grandTotal);
}

async function handleSubmitBatch() {
    const date = logDate.value;
    const project = logProject.value;
    const notes = logNotes.value.trim();

    if (!date || !project) {
        showToast('يرجى اختيار التاريخ والمشروع', 'warning');
        return;
    }
    if (cart.length === 0) {
        showToast('أضف بند واحد على الأقل قبل الحفظ', 'warning');
        return;
    }

    const grandTotal = cart.reduce((s, i) => s + i.totalCost, 0);
    const summary = cart.map(i => `${i.typeName} × ${i.quantity} (${i.phase})`).join('، ');
    const ok = await showConfirm(`تسجيل: ${summary}\nالإجمالي: ${formatCurrency(grandTotal)}؟`);
    if (!ok) return;

    try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري الحفظ...';

        // كل بند في السلة بيبعت بمرحلته الخاصة (item.phase) — السيرفر بيحفظ مرحلة كل بند على حدة
        await logDailyLog({
            date, project, notes,
            supervisor: currentUsername,
            items: cart
        });

        showToast('تم إرسال اليومية للمهندس للموافقة عليها', 'success');
        cart = [];
        renderCart();
        logNotes.value = '';

        await Promise.all([loadRecentLogs(), loadPendingLogs()]);
    } catch (err) {
        console.error(err);
        showToast('فشل الحفظ: ' + err.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '✅ حفظ كل اليوميات';
    }
}

async function loadRecentLogs() {
    try {
        const logs = await getDailyLogs(currentUsername);
        lastLogs = logs || [];
        renderRecentLogs();
    } catch (err) {
        console.error(err);
        recentLogs.innerHTML = '<p class="text-center text-red-500 text-sm">فشل تحميل السجل</p>';
    }
}

async function loadPendingLogs() {
    try {
        const email = auth.currentUser?.email;
        if (!email) return;
        const logs = await getMyDailyLogRequests(email);
        renderPendingLogs(logs || []);
    } catch (err) {
        console.error(err);
        pendingLogs.innerHTML = '<p class="text-center text-red-500 text-sm">فشل تحميل الطلبات</p>';
    }
}

function renderPendingLogs(logs) {
    try {
        if (!logs || logs.length === 0) {
            pendingLogs.innerHTML = '<p class="text-center text-gray-400 text-sm">لا توجد طلبات قيد المراجعة</p>';
            return;
        }

        const batches = [];
        const batchIndex = {};
        logs.forEach(l => {
            const key = l.batchId || l.id;
            if (!batchIndex[key]) {
                batchIndex[key] = { date: l.date, project: l.project, phase: l.phase, status: l.status, rejectReason: l.rejectReason, items: [] };
                batches.push(batchIndex[key]);
            }
            batchIndex[key].items.push(l);
        });

        pendingLogs.innerHTML = batches.slice(0, 10).map(b => {
            const batchTotal = b.items.reduce((s, i) => s + (Number(i.totalCost) || 0), 0);
            const isPending = b.status === 'بانتظار الموافقة';
            const badge = isPending
                ? '<span class="type-badge badge-pending">⏳ بانتظار الموافقة</span>'
                : '<span class="type-badge badge-rejected">❌ مرفوضة</span>';
            return `
                <div class="p-4 mb-3 rounded-xl" style="border:1px solid rgba(30,60,114,0.12); background:rgba(255,255,255,0.6);">
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-sm font-bold text-indigo-900">${formatDate(b.date)} — ${b.project}</span>
                        ${badge}
                    </div>
                    <div class="flex flex-wrap gap-2 mb-1">
                        ${b.items.map(i => `<span class="type-badge badge-daily">${i.typeName} × ${i.quantity} — ${i.phase}</span>`).join('')}
                    </div>
                    <div class="flex justify-between items-center mt-2">
                        <span class="font-bold text-indigo-600 text-sm">${formatCurrency(batchTotal)}</span>
                        ${(!isPending && b.rejectReason) ? `<span class="text-xs text-red-500">سبب الرفض: ${b.rejectReason}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error(err);
        pendingLogs.innerHTML = '<p class="text-center text-red-500 text-sm">فشل تحميل الطلبات</p>';
    }
}

// ── سجل اليوميات الموافق عليها: فلترة + طباعة (فردية/مجموعة/الظاهر) ──
function renderRecentLogs() {
    try {
        allDailyBatches = buildDailyBatches(lastLogs);
        applyDailyFilters(); // بيبنّي filteredDailyBatches ويحدّث الواجهة
        populateDailyStatementSelect();
    } catch (err) {
        console.error(err);
        recentLogs.innerHTML = '<p class="text-center text-red-500 text-sm">فشل تحميل السجل</p>';
    }
}

function buildDailyBatches(logs) {
    const batches = [];
    const idx = {};
    (logs || []).forEach(l => {
        const key = l.batchId || l.id;
        if (!idx[key]) { idx[key] = { batchId: key, date: l.date, project: l.project, items: [] }; batches.push(idx[key]); }
        idx[key].items.push(l);
    });
    // ترتيب تنازلي حسب التاريخ
    batches.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    return batches;
}

function applyDailyFilters() {
    const from = filterDailyFrom?.value;
    const to = filterDailyTo?.value;
    const project = filterDailyProject?.value || '';

    filteredDailyBatches = allDailyBatches.filter(b => {
        if (project && b.project !== project) return false;
        if (from && new Date(b.date || 0) < new Date(from)) return false;
        if (to && new Date(b.date || 0) > new Date(to)) return false;
        return true;
    });

    renderFilteredBatches();
}

function renderFilteredBatches() {
    selectedLogBatches.clear(); // بمسح التحديد عشان الدفعات اتغيّرت
    updateDailyPrintToolbar();

    if (!filteredDailyBatches.length) {
        recentLogs.innerHTML = '<p class="text-center text-gray-400 text-sm py-4">لا توجد يوميات في هذا النطاق</p>';
        shownCountEl.textContent = '';
        return;
    }

    shownCountEl.textContent = `الظاهر: ${filteredDailyBatches.length} دفعة`;

    recentLogs.innerHTML = filteredDailyBatches.map(b => {
        const batchTotal = b.items.reduce((s, i) => s + (Number(i.totalCost) || 0), 0);
        const allPrinted = b.items.every(i => i.printed);
        const statementId = allPrinted ? (b.items.find(i => i.statementId)?.statementId || '') : '';
        const statusBadge = allPrinted
            ? `<span class="type-badge badge-deposit">كشف ${statementId}</span>`
            : '<span class="type-badge badge-pending">جديدة</span>';
        return `
            <div class="p-4 mb-3 rounded-xl flex gap-3" style="border:1px solid rgba(30,60,114,0.12); background:rgba(255,255,255,0.6);">
                <input type="checkbox" class="log-batch-select mt-1" data-batch="${b.batchId}">
                <div class="flex-1">
                    <div class="flex flex-wrap justify-between items-center mb-2">
                        <span class="text-sm font-bold text-indigo-900">${formatDate(b.date)} — ${b.project}</span>
                        <div class="flex items-center gap-2">
                            ${statusBadge}
                            <button type="button" onclick="printDailyBatch('${b.batchId}')" class="print-btn py-1 px-2 text-xs font-bold no-print">🖨️</button>
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        ${b.items.map(i => `<span class="type-badge badge-daily">${i.typeName} × ${i.quantity} — ${i.phase}</span>`).join('')}
                    </div>
                    <div class="text-left mt-2">
                        <span class="font-bold text-indigo-600 text-sm">${formatCurrency(batchTotal)}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // ربط تغيّر الـ checkbox بكل دفعة
    recentLogs.querySelectorAll('.log-batch-select').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) selectedLogBatches.add(cb.dataset.batch); else selectedLogBatches.delete(cb.dataset.batch);
            syncDailySelectAllCheckbox();
            updateDailyPrintToolbar();
        });
    });
}

function updateDailyPrintToolbar() {
    const n = filteredDailyBatches.length;
    if (dailySelectAllVisible) dailySelectAllVisible.checked = n > 0 && selectedLogBatches.size === n;
    if (selectedCountEl) selectedCountEl.textContent = selectedLogBatches.size;
    if (printSelectedBtn) printSelectedBtn.disabled = selectedLogBatches.size === 0;
    if (printShownBtn) printShownBtn.disabled = n === 0;
}

function syncDailySelectAllCheckbox() {
    if (!dailySelectAllVisible) return;
    dailySelectAllVisible.checked = filteredDailyBatches.length > 0 && selectedLogBatches.size === filteredDailyBatches.length;
}

function handleSelectAllVisible() {
    if (dailySelectAllVisible.checked) {
        filteredDailyBatches.forEach(b => selectedLogBatches.add(b.batchId));
    } else {
        selectedLogBatches.clear();
    }
    // حدّث الـ checkboxes في الواجهة
    recentLogs.querySelectorAll('.log-batch-select').forEach(cb => {
        cb.checked = dailySelectAllVisible.checked;
    });
    updateDailyPrintToolbar();
}

// دالة عامة بتطبع أي مجموعة دفعات (ظاهرة / محددة / دفعة واحدة)
function printDailyBatches(batches) {
    if (!batches.length) { showToast('لا توجد دفعات للطباعة', 'info'); return; }

    const rows = [];
    let grandTotal = 0;
    batches.forEach(b => {
        b.items.forEach(i => {
            const cost = Number(i.totalCost) || 0;
            grandTotal += cost;
            rows.push([formatDate(b.date), b.project, i.typeName, i.phase, i.quantity, formatCurrency(cost)]);
        });
    });

    printReport({
        title: 'سجل اليوميات المعتمدة',
        subtitle: isAdmin ? '' : currentUsername,
        metaLines: [
            `المشرف: ${currentUsername}`,
            `عدد الدفعات: ${batches.length}`,
            `تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}`
        ],
        columns: ['التاريخ', 'المشروع', 'النوع', 'المرحلة', 'الكمية', 'التكلفة'],
        rows,
        totalsRow: ['', '', '', '', 'الإجمالي', formatCurrency(grandTotal)]
    });

    // بعد الطباعة نسأل: هل تم تسوية الدفعات غير المطبوعة منها؟
    const unprintedIds = batches.flatMap(b => b.items).filter(i => !i.printed).map(i => i.id);
    if (unprintedIds.length) askMarkLogsPrinted(unprintedIds);
}

function handlePrintShown() {
    printDailyBatches(filteredDailyBatches);
}

function handlePrintSelected() {
    const ids = Array.from(selectedLogBatches);
    if (!ids.length) return;
    const batches = filteredDailyBatches.filter(b => ids.includes(b.batchId));
    printDailyBatches(batches);
}

// طباعة دفعة واحدة (من زر الطباعة على كل دفعة)
window.printDailyBatch = function (batchId) {
    const batch = allDailyBatches.find(b => b.batchId === batchId);
    if (!batch) { showToast('الدفعة غير موجودة', 'error'); return; }
    printDailyBatches([batch]);
};

// ── طباعة بنود اليومية الحالية (قبل الحفظ والإرسال للموافقة) ──
function handlePrintCart() {
    if (!cart.length) { showToast('أضف بند واحد على الأقل قبل الطباعة', 'warning'); return; }

    const rows = cart.map(i => [
        i.typeName, i.phase, i.quantity, formatCurrency(i.unitPrice), formatCurrency(i.totalCost)
    ]);
    const total = cart.reduce((s, i) => s + i.totalCost, 0);

    printReport({
        title: 'يومية عمالة (قبل الإرسال للموافقة)',
        subtitle: logProject.value || '',
        metaLines: [
            `المشرف: ${currentUsername}`,
            `التاريخ: ${formatDate(logDate.value)}`,
            `عدد البنود: ${cart.length}`
        ],
        columns: ['النوع', 'المرحلة', 'الكمية', 'سعر الوحدة', 'الإجمالي'],
        rows,
        totalsRow: ['', '', '', 'الإجمالي الكلي', formatCurrency(total)]
    });
}

// ── طباعة سجل اليوميات الموافق عليها اللي لسه ما اتسوتش ──────────
// بنطبع بس اليوميات اللي لسه "جديدة" (ما اتعلمتش مطبوعة قبل كده)، عشان
// لو المحاسب استلم كشف الأسبوع اللي فات وسواه، الطباعة الجاية ميكررهوش
function handlePrintLogs() {
    const unsettled = lastLogs.filter(l => !l.printed);
    if (!unsettled.length) {
        showToast('لا توجد يوميات جديدة — كل السجل اتطبع وتم تسويته من قبل', 'info');
        return;
    }

    const batches = [];
    const idx = {};
    unsettled.forEach(l => {
        const key = l.batchId || l.id;
        if (!idx[key]) { idx[key] = { date: l.date, project: l.project, items: [] }; batches.push(idx[key]); }
        idx[key].items.push(l);
    });

    const rows = [];
    let grandTotal = 0;
    batches.forEach(b => {
        b.items.forEach(i => {
            const cost = Number(i.totalCost) || 0;
            grandTotal += cost;
            rows.push([formatDate(b.date), b.project, i.typeName, i.phase, i.quantity, formatCurrency(cost)]);
        });
    });

    printReport({
        title: 'سجل اليوميات المعتمدة (الجديدة)',
        subtitle: isAdmin ? '' : currentUsername,
        metaLines: [
            `المشرف: ${currentUsername}`,
            `عدد اليوميات الجديدة: ${batches.length}`,
            `تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}`
        ],
        columns: ['التاريخ', 'المشروع', 'النوع', 'المرحلة', 'الكمية', 'التكلفة'],
        rows,
        totalsRow: ['', '', '', '', 'الإجمالي', formatCurrency(grandTotal)]
    });

    askMarkLogsPrinted(unsettled.map(l => l.id));
}

// بعد الطباعة، نسأل نتأكد إن السجل ده اتسلّم/اتسوى — لو أكد، بنعلّم
// اليوميات دي "مطبوعة" برقم كشف جديد عشان متتكررش في طباعة السجل الجاية،
// وتقدر بعدين ترجع تطبع نفس الكشف ده تاني من "كشوف سابقة"
async function askMarkLogsPrinted(ids) {
    const ok = await showConfirm(
        'تم تسليم هذا السجل للمحاسب وتسويته؟\nلو أكدت، اليوميات دي مش هتظهر تاني في طباعة السجل الجاية.',
        { confirmText: 'تمت التسوية ✅', cancelText: 'لسه، سيبها تظهر تاني' }
    );
    if (!ok) return;
    try {
        const r = await markDailyLogsPrinted(ids);
        const statementId = r && r.statementId ? String(r.statementId) : null;
        lastLogs.forEach(l => {
            if (ids.includes(l.id)) { l.printed = true; if (statementId) l.statementId = statementId; }
        });
        renderRecentLogs();
        showToast(statementId ? `تم تعليم اليوميات ضمن كشف رقم ${statementId}` : 'تم تعليم اليوميات كمطبوعة/متسواة', 'success');
    } catch (err) {
        showToast('تعذر تعليم اليوميات: ' + err.message, 'error');
    }
}

// ── كشوف سابقة (تسويات اتأكدت قبل كده) — استرجاع وإعادة طباعة أي كشف ────
function populateDailyStatementSelect() {
    if (!dailyStatementSelect) return;
    const statements = {};
    lastLogs.forEach(l => {
        if (!l.statementId) return;
        if (!statements[l.statementId]) statements[l.statementId] = { id: l.statementId, count: 0, total: 0, dates: [] };
        statements[l.statementId].count++;
        statements[l.statementId].total += Number(l.totalCost) || 0;
        statements[l.statementId].dates.push(l.date);
    });
    const list = Object.values(statements).sort((a, b) => Number(b.id) - Number(a.id));

    if (!list.length) {
        dailyStatementSelect.innerHTML = '<option value="">— لا توجد كشوف سابقة —</option>';
        printDailyStatementBtn.disabled = true;
        return;
    }
    dailyStatementSelect.innerHTML = '<option value="">— اختر كشف سابق —</option>' +
        list.map(s => {
            const dates = s.dates.filter(Boolean).sort();
            const range = dates.length ? `${formatDate(dates[0])} → ${formatDate(dates[dates.length - 1])}` : '';
            return `<option value="${s.id}">كشف رقم ${s.id} — ${s.count} بند — ${formatCurrency(s.total)} ${range ? '(' + range + ')' : ''}</option>`;
        }).join('');
}

function handlePrintDailyStatement() {
    const statementId = dailyStatementSelect.value;
    if (!statementId) return;
    const logs = lastLogs.filter(l => l.statementId === statementId);
    if (!logs.length) { showToast('تعذر إيجاد بنود هذا الكشف', 'error'); return; }

    const batches = buildDailyBatches(logs);
    const rows = [];
    let grandTotal = 0;
    batches.forEach(b => {
        b.items.forEach(i => {
            const cost = Number(i.totalCost) || 0;
            grandTotal += cost;
            rows.push([formatDate(b.date), b.project, i.typeName, i.phase, i.quantity, formatCurrency(cost)]);
        });
    });

    printReport({
        title: `سجل اليوميات المعتمدة (كشف رقم ${statementId})`,
        subtitle: isAdmin ? '' : currentUsername,
        metaLines: [
            `المشرف: ${currentUsername}`,
            `تاريخ إعادة الطباعة: ${new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}`,
            `عدد الدفعات: ${batches.length}`
        ],
        columns: ['التاريخ', 'المشروع', 'النوع', 'المرحلة', 'الكمية', 'التكلفة'],
        rows,
        totalsRow: ['', '', '', '', 'الإجمالي', formatCurrency(grandTotal)]
    });
    // ده استرجاع لكشف اتسوّى قبل كده — مفيش تسوية جديدة تتسأل هنا
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
