// ═══════════════════════════════════════════════════════════
// صفحة تسجيل اليوميات — نظام EXO
// ═══════════════════════════════════════════════════════════
import { auth, showMessage, hideMessage, todayStr, DAILY_LOG_TYPES, formatCurrency, PHASES } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getSetupData, logDailyLog, getDailyLogs } from './sheets-service.js';

const logDate = document.getElementById('logDate');
const logProject = document.getElementById('logProject');
const logPhase = document.getElementById('logPhase');
const logType = document.getElementById('logType');
const logQuantity = document.getElementById('logQuantity');
const logNotes = document.getElementById('logNotes');
const logUnitPrice = document.getElementById('logUnitPrice');
const logCustomPrice = document.getElementById('logCustomPrice');
const logTotalCost = document.getElementById('logTotalCost');
const priceDisplaySection = document.getElementById('priceDisplaySection');
const priceDisplay = document.getElementById('priceDisplay');
const customPriceSection = document.getElementById('customPriceSection');
const totalCostDisplay = document.getElementById('totalCostDisplay');
const totalCostDisplayValue = document.getElementById('totalCostDisplayValue');
const recentLogs = document.getElementById('recentLogs');
const submitBtn = document.getElementById('submitBtn');
const closeMessageBtn = document.getElementById('closeMessageBtn');

closeMessageBtn?.addEventListener('click', hideMessage);

logDate.value = todayStr();

let currentUsername = null;
let projects = [];
let projectPhases = {}; // مراحل كل مشروع من الشيت
let dailyLogPrices = {}; // سيخزن أسعار أنواع اليوميات من الشيت

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUsername = user.email.replace('@exo-system.local', '');

    await loadSetupData();
    await loadRecentLogs();

    document.getElementById('dailyLogForm').addEventListener('submit', handleSubmit);
    logType.addEventListener('change', handleTypeChange);
    logQuantity.addEventListener('input', calculateTotal);
    logCustomPrice.addEventListener('input', calculateTotal);
});

async function loadSetupData() {
    try {
        const data = await getSetupData();
        projects = data.projects || [];
        projectPhases = data.projectPhases || {};

        // تحميل أسعار اليوميات من الشيت
        dailyLogPrices = data.dailyLogPrices || {};

        // تعبئة المشاريع
        logProject.innerHTML = '<option value="" disabled selected>اختر المشروع</option>' +
            projects.map(p => `<option value="${p}">${p}</option>`).join('');

        // تعبئة المراحل (فاضية في الأول، هتتعبأ لما يختار مشروع)
        logPhase.innerHTML = '<option value="" disabled selected>اختر المشروع أولاً</option>';

        // تعبئة أنواع اليوميات
        logType.innerHTML = '<option value="" disabled selected>اختر نوع اليومية</option>' +
            DAILY_LOG_TYPES.map(t => `<option value="${t.id}" data-price="${dailyLogPrices[t.id] || t.defaultPrice}" data-custom="${t.allowCustomPrice}">${t.name}</option>`).join('');

        // لما يختار مشروع، حدث المراحل
        logProject.addEventListener('change', updatePhasesForProject);

    } catch (err) {
        console.error(err);
        showMessage('فشل تحميل البيانات: ' + err.message);
    }
}

function updatePhasesForProject() {
    const selectedProject = logProject.value;
    const phases = projectPhases[selectedProject] || [];
    
    if (phases.length > 0) {
        logPhase.innerHTML = '<option value="" disabled selected>اختر المرحلة</option>' +
            phases.map(p => `<option value="${p}">${p}</option>`).join('');
    } else {
        logPhase.innerHTML = '<option value="" disabled selected>لا توجد مراحل لهذا المشروع</option>';
    }
}

function handleTypeChange() {
    const selectedOption = logType.options[logType.selectedIndex];
    const price = parseFloat(selectedOption.dataset.price) || 0;
    const allowCustom = selectedOption.dataset.custom === 'true';

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
    calculateTotal();
}

function calculateTotal() {
    const qty = parseFloat(logQuantity.value) || 0;
    let unitPrice = parseFloat(logUnitPrice.value) || 0;

    const selectedOption = logType.options[logType.selectedIndex];
    const allowCustom = selectedOption?.dataset.custom === 'true';

    if (allowCustom) {
        unitPrice = parseFloat(logCustomPrice.value) || 0;
        priceDisplaySection.classList.add('hidden');
    }

    const total = qty * unitPrice;
    logTotalCost.value = total.toFixed(2);

    if (qty > 0 && unitPrice > 0) {
        totalCostDisplay.classList.remove('hidden');
        totalCostDisplayValue.textContent = formatCurrency(total);
    } else {
        totalCostDisplay.classList.add('hidden');
    }
}

async function handleSubmit(e) {
    e.preventDefault();

    const date = logDate.value;
    const project = logProject.value;
    const phase = logPhase.value;
    const typeId = logType.value;
    const quantity = parseFloat(logQuantity.value) || 0;
    const notes = logNotes.value.trim();
    const totalCost = parseFloat(logTotalCost.value) || 0;
    const unitPrice = parseFloat(logUnitCost.value) || 0;

    if (!date || !project || !phase || !typeId) {
        showMessage('يرجى ملء جميع الحقول المطلوبة');
        return;
    }
    if (quantity <= 0) {
        showMessage('الكمية يجب أن تكون أكبر من صفر');
        return;
    }

    const selectedOption = logType.options[logType.selectedIndex];
    const allowCustom = selectedOption?.dataset.custom === 'true';
    if (allowCustom && unitPrice <= 0) {
        showMessage('يرجى إدخال السعر للمقطوعية');
        return;
    }

    const typeInfo = DAILY_LOG_TYPES.find(t => t.id === typeId);
    const typeName = typeInfo?.name || typeId;

    if (!confirm(`تسجيل ${quantity} ${typeName} بـ ${formatCurrency(unitPrice)} للوحدة؟\nالإجمالي: ${formatCurrency(totalCost)}`)) return;

    try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري الحفظ...';

        await logDailyLog({
            date,
            project,
            phase,
            typeId,
            typeName,
            quantity,
            unitPrice,
            totalCost,
            notes,
            supervisor: currentUsername
        });

        showMessage('✅ تم تسجيل اليومية بنجاح');
        document.getElementById('dailyLogForm').reset();
        logDate.value = todayStr();
        priceDisplaySection.classList.add('hidden');
        customPriceSection.classList.add('hidden');
        totalCostDisplay.classList.add('hidden');
        logUnitPrice.value = '0';
        logTotalCost.value = '0';

        setTimeout(() => hideMessage(), 1200);
        await loadRecentLogs();
    } catch (err) {
        console.error(err);
        showMessage('❌ فشل الحفظ: ' + err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'تسجيل اليومية';
    }
}

async function loadRecentLogs() {
    try {
        const logs = await getDailyLogs(currentUsername);
        const recent = logs.slice(0, 10);

        if (recent.length === 0) {
            recentLogs.innerHTML = '<p class="text-center text-gray-500 text-sm">لا توجد يوميات مسجلة بعد</p>';
            return;
        }

        recentLogs.innerHTML = `
            <div class="overflow-x-auto">
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>التاريخ</th>
                            <th>المشروع</th>
                            <th>المرحلة</th>
                            <th>النوع</th>
                            <th>الكمية</th>
                            <th>سعر الوحدة</th>
                            <th>الإجمالي</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${recent.map(l => `
                            <tr>
                                <td class="whitespace-nowrap">${formatDate(l.date)}</td>
                                <td>${l.project}</td>
                                <td>${l.phase}</td>
                                <td><span class="type-badge badge-daily">${l.typeName}</span></td>
                                <td class="text-center">${l.quantity}</td>
                                <td class="text-center">${formatCurrency(l.unitPrice)}</td>
                                <td class="font-bold text-indigo-600">${formatCurrency(l.totalCost)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
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