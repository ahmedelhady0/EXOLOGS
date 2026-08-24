// ═══════════════════════════════════════════════════════════
// صفحة تسجيل اليوميات — نظام EXO
// المشرف يقدر يضيف أكتر من بند (نوع + كمية) في نفس التسجيل
// وكلهم بيتسجلوا مع بعض بمعرف دفعة واحد (batchId)
// ═══════════════════════════════════════════════════════════
import { auth, showMessage, hideMessage, todayStr, formatCurrency } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getSetupData, logDailyLog, getDailyLogs, getUserRole } from './sheets-service.js';

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
const submitBtn = document.getElementById('submitBtn');
const closeMessageBtn = document.getElementById('closeMessageBtn');

closeMessageBtn?.addEventListener('click', hideMessage);

logDate.value = todayStr();

let currentUsername = null;
let projects = [];
let isAdmin = false;
let assignedProjects = []; // المشاريع المخصصة للمشرف الحالي (فاضية = بيشوف الكل)
let dailyLogTypes = []; // أنواع اليوميات (id/اسم/سعر/سعر يدوي) — من شيت "أسعار اليوميات"
let cart = []; // البنود المضافة قبل الحفظ النهائي — كلها بتتسجل مع بعض بمعرف دفعة واحد

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentUsername = user.email.replace('@exo-system.local', '');

    try {
        const info = await getUserRole(user.email);
        isAdmin = info.role === 'admin';
        assignedProjects = info.projects || [];
    } catch (err) {
        console.error(err);
    }

    await loadSetupData();
    await loadRecentLogs();

    logType.addEventListener('change', handleTypeChange);
    logQuantity.addEventListener('input', calculateItemTotal);
    logCustomPrice.addEventListener('input', calculateItemTotal);
    addItemBtn.addEventListener('click', handleAddItem);
    submitBtn.addEventListener('click', handleSubmitBatch);
});

async function loadSetupData() {
    try {
        const data = await getSetupData();
        projects = data.projects || [];
        dailyLogTypes = data.dailyLogTypes || [];

        // لو المشرف معاه مشاريع مخصصة، يشوفها بس — غير كده يشوف كل المشاريع (زي الأدمن)
        const visibleProjects = (!isAdmin && assignedProjects.length > 0)
            ? projects.filter(p => assignedProjects.includes(p))
            : projects;

        logProject.innerHTML = '<option value="" disabled selected>اختر المشروع</option>' +
            visibleProjects.map(p => `<option value="${p}">${p}</option>`).join('');

        const phases = data.phases || [];
        logPhase.innerHTML = '<option value="" disabled selected>اختر المرحلة</option>' +
            phases.map(p => `<option value="${p}">${p}</option>`).join('');

        logType.innerHTML = '<option value="" disabled selected>اختر نوع اليومية</option>' +
            dailyLogTypes.map(t => `<option value="${t.id}" data-price="${t.defaultPrice}" data-custom="${t.allowCustomPrice}">${t.name}</option>`).join('');
    } catch (err) {
        console.error(err);
        showMessage('فشل تحميل البيانات: ' + err.message);
    }
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

    cart.push({ typeId, typeName, quantity, unitPrice, totalCost });
    renderCart();

    // تصفير حقول "إضافة بند" عشان تضيف بند تاني على طول
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
    const phase = logPhase.value;
    const notes = logNotes.value.trim();

    if (!date || !project || !phase) {
        showMessage('يرجى اختيار التاريخ والمشروع والمرحلة');
        return;
    }
    if (cart.length === 0) {
        showMessage('أضف بند واحد على الأقل قبل الحفظ');
        return;
    }

    const grandTotal = cart.reduce((s, i) => s + i.totalCost, 0);
    const summary = cart.map(i => `${i.typeName} × ${i.quantity}`).join('، ');
    if (!confirm(`تسجيل: ${summary}\nالإجمالي: ${formatCurrency(grandTotal)}؟`)) return;

    try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري الحفظ...';

        await logDailyLog({
            date, project, phase, notes,
            supervisor: currentUsername,
            items: cart
        });

        showMessage('✅ تم تسجيل اليوميات بنجاح');
        cart = [];
        renderCart();
        logNotes.value = '';

        setTimeout(() => hideMessage(), 1200);
        await loadRecentLogs();
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

        if (!logs || logs.length === 0) {
            recentLogs.innerHTML = '<p class="text-center text-gray-500 text-sm">لا توجد يوميات مسجلة بعد</p>';
            return;
        }

        // تجميع البنود حسب معرف الدفعة عشان كل تسجيل يظهر سوا (بند/بندين/تلاتة..)
        const batches = [];
        const batchIndex = {};
        logs.forEach(l => {
            const key = l.batchId || l.id; // سجلات قديمة من قبل التحديث ده مالهاش batchId فكل سطر بيتعامل كدفعة لوحده
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
                        <span class="text-sm font-bold text-indigo-900">${formatDate(b.date)} — ${b.project} / ${b.phase}</span>
                        <span class="font-bold text-indigo-600 text-sm">${formatCurrency(batchTotal)}</span>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        ${b.items.map(i => `<span class="type-badge badge-daily">${i.typeName} × ${i.quantity}</span>`).join('')}
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
