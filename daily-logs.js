// ═══════════════════════════════════════════════════════════
// صفحة تسجيل اليوميات — نظام EXO
// المشرف يقدر يضيف أكتر من بند (نوع + كمية) في نفس التسجيل، وكلهم بيتسجلوا
// تحت نفس الـ ID. المرحلة بتتحدد حسب المشروع المختار (من شيت "بيانات المشاريع")
// ═══════════════════════════════════════════════════════════
import { auth, showMessage, hideMessage, todayStr, formatCurrency } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getSetupData, logDailyLog, getDailyLogs, getMyDailyLogRequests, getUserRole } from './sheets-service.js';

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
const closeMessageBtn = document.getElementById('closeMessageBtn');
const noProjectsWarning = document.getElementById('noProjectsWarning');
const loggingFormSections = document.getElementById('loggingFormSections');
const refreshBtn = document.getElementById('refreshBtn');

closeMessageBtn?.addEventListener('click', hideMessage);
refreshBtn?.addEventListener('click', refreshData);

logDate.value = todayStr();

let currentUsername = null;
let projects = [];
let isAdmin = false;
let assignedProjects = []; // المشاريع المخصصة للمشرف الحالي (فاضية = بيشوف الكل)
let dailyLogTypes = []; // أنواع اليوميات (id/اسم/سعر/سعر يدوي) — من شيت "أسعار اليوميات"
let projectPhases = {}; // المراحل الشغالة لكل مشروع — من شيت "بيانات المشاريع" (المرحلة اللي حالتها مش "شغالة" ما بتظهرش)
let cart = []; // البنود المضافة قبل الحفظ النهائي — كلها بتتسجل مع بعض بمعرف واحد

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUsername = user.email.replace('@exo-system.local', '');

    // الثلاث نداءات دي مالهاش علاقة ببعض، فبنطلقهم مع بعض بدل ما ننتظر كل واحد لوحده
    // (كل نداء لـ Apps Script بياخد وقت، فتشغيلهم متوازي بيقلل وقت التحميل بشكل كبير)
    const [roleInfo, setupData, logsData, pendingData] = await Promise.all([
        getUserRole(user.email).catch(err => { console.error(err); return null; }),
        getSetupData().catch(err => { console.error(err); showMessage('فشل تحميل البيانات: ' + err.message); return null; }),
        getDailyLogs(currentUsername).catch(err => { console.error(err); return []; }),
        getMyDailyLogRequests(user.email).catch(err => { console.error(err); return []; })
    ]);

    let roleLoadFailed = false;
    if (roleInfo) {
        isAdmin = roleInfo.role === 'admin';
        assignedProjects = roleInfo.projects || [];
    } else {
        roleLoadFailed = true;
    }

    if (setupData) applySetupData(setupData, roleLoadFailed);
    renderRecentLogs(logsData || []);
    renderPendingLogs(pendingData || []);

    logProject.addEventListener('change', updatePhaseOptions);
    logType.addEventListener('change', handleTypeChange);
    logQuantity.addEventListener('input', calculateItemTotal);
    logCustomPrice.addEventListener('input', calculateItemTotal);
    addItemBtn.addEventListener('click', handleAddItem);
    submitBtn.addEventListener('click', handleSubmitBatch);
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
        showMessage('✅ تم تحديث البيانات');
        setTimeout(() => hideMessage(), 1000);
    } catch (err) {
        console.error(err);
        showMessage('❌ فشل التحديث: ' + err.message);
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
    if (!phase) { showMessage('يرجى اختيار المرحلة'); return; }

    const typeId = logType.value;
    if (!typeId) { showMessage('يرجى اختيار نوع اليومية'); return; }

    const quantity = parseFloat(logQuantity.value) || 0;
    if (quantity <= 0) { showMessage('الكمية يجب أن تكون أكبر من صفر'); return; }

    const allowCustom = currentItemAllowsCustom();
    const unitPrice = currentItemUnitPrice();
    if (allowCustom && unitPrice <= 0) { showMessage('يرجى إدخال السعر للمقطوعية'); return; }

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
        showMessage('يرجى اختيار التاريخ والمشروع');
        return;
    }
    if (cart.length === 0) {
        showMessage('أضف بند واحد على الأقل قبل الحفظ');
        return;
    }

    const grandTotal = cart.reduce((s, i) => s + i.totalCost, 0);
    const summary = cart.map(i => `${i.typeName} × ${i.quantity} (${i.phase})`).join('، ');
    if (!confirm(`تسجيل: ${summary}\nالإجمالي: ${formatCurrency(grandTotal)}؟`)) return;

    try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري الحفظ...';

        // كل بند في السلة بيبعت بمرحلته الخاصة (item.phase) — السيرفر بيحفظ مرحلة كل بند على حدة
        await logDailyLog({
            date, project, notes,
            supervisor: currentUsername,
            items: cart
        });

        showMessage('✅ تم إرسال اليومية للمهندس للموافقة عليها');
        cart = [];
        renderCart();
        logNotes.value = '';

        setTimeout(() => hideMessage(), 1500);
        await Promise.all([loadRecentLogs(), loadPendingLogs()]);
    } catch (err) {
        console.error(err);
        showMessage('❌ فشل الحفظ: ' + err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '✅ حفظ كل اليوميات';
    }
}

async function loadRecentLogs() {
    try {
        const logs = await getDailyLogs(currentUsername);
        renderRecentLogs(logs || []);
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

function renderRecentLogs(logs) {
    try {
        if (!logs || logs.length === 0) {
            recentLogs.innerHTML = '<p class="text-center text-gray-500 text-sm">لا توجد يوميات موافق عليها بعد</p>';
            return;
        }

        // تجميع البنود حسب نفس الـ id عشان كل تسجيل يظهر سوا (بند/بندين/تلاتة..)
        const batches = [];
        const batchIndex = {};
        logs.forEach(l => {
            const key = l.batchId || l.id; // سجلات قديمة قبل توحيد العمودين لسه بتتجمع صح عن طريق batchId
            if (!batchIndex[key]) {
                batchIndex[key] = { date: l.date, project: l.project, phase: l.phase, items: [] };
                batches.push(batchIndex[key]);
            }
            batchIndex[key].items.push(l);
        });

        const recentBatches = batches.slice(0, 10);

        recentLogs.innerHTML = recentBatches.map(b => {
            const batchTotal = b.items.reduce((s, i) => s + (Number(i.totalCost) || 0), 0);
            return `
                <div class="p-4 mb-3 rounded-xl" style="border:1px solid rgba(30,60,114,0.12); background:rgba(255,255,255,0.6);">
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-sm font-bold text-indigo-900">${formatDate(b.date)} — ${b.project}</span>
                        <span class="font-bold text-indigo-600 text-sm">${formatCurrency(batchTotal)}</span>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        ${b.items.map(i => `<span class="type-badge badge-daily">${i.typeName} × ${i.quantity} — ${i.phase}</span>`).join('')}
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error(err);
        recentLogs.innerHTML = '<p class="text-center text-red-500 text-sm">فشل تحميل السجل</p>';
    }
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
