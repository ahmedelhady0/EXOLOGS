// ═══════════════════════════════════════════════════════════
// صفحة العهد — كل مشروع له عهدة مستقلة بشيت منفصل
// المشرف يسجل فواتير (سلة) → تروح للمهندس للموافقة
// الأدمن يودع مباشرة، يعيّن مشاريع، يضيف بنود، ويحدد الرتب
// ═══════════════════════════════════════════════════════════
import { auth, showMessage, hideMessage, todayStr, formatCurrency, printReport } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getUserRole, getSetupData, getUsers, getProjectCustody, getMyCustodyRequests,
    logCustodyExpense, depositCustody, addCustodyItem, updateUserProjects, setUserRole
} from './sheets-service.js';

const adminSection = document.getElementById('adminSection');
const custodyProjectSelect = document.getElementById('custodyProjectSelect');
const custodyContent = document.getElementById('custodyContent');
const noProjectsWarning = document.getElementById('noProjectsWarning');
const headerSub = document.getElementById('headerSub');
const closeMessageBtn = document.getElementById('closeMessageBtn');
const refreshBtn = document.getElementById('refreshBtn');

// عناصر الفاتورة
const invDate = document.getElementById('invDate');
const invAmount = document.getElementById('invAmount');
const invIsTax = document.getElementById('invIsTax');
const invPhase = document.getElementById('invPhase');
const invItem = document.getElementById('invItem');
const invInvoice = document.getElementById('invInvoice');
const invDesc = document.getElementById('invDesc');
const taxBreakdown = document.getElementById('taxBreakdown');
const addInvoiceBtn = document.getElementById('addInvoiceBtn');
const submitCustodyBtn = document.getElementById('submitCustodyBtn');
const printLedgerBtn = document.getElementById('printLedgerBtn');
const printCartBtn = document.getElementById('printCartBtn');

closeMessageBtn?.addEventListener('click', hideMessage);
refreshBtn?.addEventListener('click', refreshData);
invDate.value = todayStr();

let currentEmail = null;
let currentUsername = null;
let isAdmin = false;
let assignedProjects = [];
let projects = [];
let projectPhases = {};
let custodyItems = [];
let vatRate = 0.15;
let allUsers = [];
let selectedProject = '';
let cart = []; // سلة الفواتير قبل الإرسال
let lastSummary = {};   // آخر ملخص عهدة محمّل (للطباعة)
let lastMovements = []; // آخر حركات محمّلة (للطباعة)

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentEmail = user.email;
    currentUsername = user.email.replace('@exo-system.local', '');

    try {
        const info = await getUserRole(user.email);
        isAdmin = info.role === 'admin';
        assignedProjects = info.projects || [];
    } catch (err) {
        console.error(err);
    }

    const setup = await loadSetup();
    if (!setup) return;

    // المشاريع اللي يشوفها المستخدم
    const visibleProjects = isAdmin ? projects : projects.filter(p => assignedProjects.includes(p));

    if (!isAdmin && visibleProjects.length === 0) {
        noProjectsWarning.classList.remove('hidden');
        return;
    }
    noProjectsWarning.classList.add('hidden');

    custodyProjectSelect.innerHTML = '<option value="" disabled selected>— اختر المشروع —</option>' +
        visibleProjects.map(p => `<option value="${p}">${p}</option>`).join('');

    populateItemSelect();

    if (isAdmin) {
        adminSection.classList.remove('hidden');
        await setupAdmin(visibleProjects);
    }

    custodyProjectSelect.addEventListener('change', handleProjectChange);
    invAmount.addEventListener('input', updateTaxBreakdown);
    invIsTax.addEventListener('change', updateTaxBreakdown);
    addInvoiceBtn.addEventListener('click', handleAddInvoice);
    submitCustodyBtn.addEventListener('click', handleSubmitCustody);
    printLedgerBtn?.addEventListener('click', handlePrintLedger);
    printCartBtn?.addEventListener('click', handlePrintCart);
});

async function loadSetup(forceRefresh = false) {
    try {
        const data = await getSetupData(forceRefresh);
        projects = data.projects || [];
        projectPhases = data.projectPhases || {};
        custodyItems = data.custodyItems || [];
        vatRate = data.vatRate || 0.15;
        return data;
    } catch (err) {
        console.error(err);
        showMessage('فشل تحميل البيانات: ' + err.message);
        return null;
    }
}

function populateItemSelect() {
    invItem.innerHTML = '<option value="">— اختر البند —</option>' +
        custodyItems.map(i => `<option value="${i}">${i}</option>`).join('');
}

// زر تحديث البيانات: بيمسح الكاش (المحلي + كاش السيرفر) ويعيد تحميل
// المشاريع والمراحل وبنود العهد وقائمة المستخدمين فوراٍ
async function refreshData() {
    try {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '⏳ جاري التحديث...';

        const prevProject = custodyProjectSelect.value;

        // حدّث الدور والمشاريع المخصصة (ممكن الأدمن غيّرهم من الشيت)
        try {
            const info = await getUserRole(currentEmail);
            isAdmin = info.role === 'admin';
            assignedProjects = info.projects || [];
        } catch (err) { console.error(err); }

        // حدّث بيانات الإعداد مع مسح الكاش (forceRefresh = true)
        const setup = await loadSetup(true);
        if (!setup) return;

        const visibleProjects = isAdmin ? projects : projects.filter(p => assignedProjects.includes(p));

        if (!isAdmin && visibleProjects.length === 0) {
            noProjectsWarning.classList.remove('hidden');
            custodyContent.classList.add('hidden');
            return;
        }
        noProjectsWarning.classList.add('hidden');

        custodyProjectSelect.innerHTML = '<option value="" disabled selected>— اختر المشروع —</option>' +
            visibleProjects.map(p => `<option value="${p}">${p}</option>`).join('');
        populateItemSelect();

        if (isAdmin) {
            adminSection.classList.remove('hidden');
            await populateAdminData();
        }

        // لو المشروع المختار لسه موجود، فضّله مختار وحدّث بياناته (مراحله + عهدته + فواتيره المعلقة)
        if (prevProject && visibleProjects.includes(prevProject)) {
            custodyProjectSelect.value = prevProject;
            await handleProjectChange();
        } else if (prevProject) {
            // المشروع المختار مبقاش موجود — اخفِ محتوى العهدة
            selectedProject = '';
            custodyContent.classList.add('hidden');
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

// ── تغيير المشروع: حمّل عهدته ──────────────────────────
async function handleProjectChange() {
    selectedProject = custodyProjectSelect.value;
    if (!selectedProject) return;

    custodyContent.classList.remove('hidden');
    headerSub.textContent = `عهدة مشروع: ${selectedProject}`;

    // مراحل المشروع الشغالة
    const phases = projectPhases[selectedProject] || [];
    invPhase.innerHTML = '<option value="">— اختر المرحلة —</option>' +
        phases.map(p => `<option value="${p}">${p}</option>`).join('');

    await Promise.all([loadProjectCustody(), loadMyPending()]);
}

async function loadProjectCustody() {
    try {
        // المشرف يشوف حركاته بس، الأدمن يشوف كل حركات المشروع
        const supervisor = isAdmin ? '' : currentUsername;
        const data = await getProjectCustody(selectedProject, supervisor || null);
        lastSummary = data.summary || {};
        lastMovements = data.movements || [];
        renderSummary(lastSummary);
        renderMovements(lastMovements);
    } catch (err) {
        console.error(err);
    }
}

function renderSummary(s) {
    const totalDeposit = Number(s.totalDeposit) || 0;
    const totalExpense = Number(s.totalExpense) || 0;
    const remaining = Number(s.remaining) || 0;

    document.getElementById('custTotalDeposit').textContent = formatCurrency(totalDeposit);
    document.getElementById('custTotalExpense').textContent = formatCurrency(totalExpense);
    document.getElementById('custRemaining').textContent = formatCurrency(remaining);

    const card = document.getElementById('custRemainingCard');
    card.classList.remove('stat-remaining', 'stat-negative');
    card.classList.add(remaining < 0 ? 'stat-negative' : 'stat-remaining');
    document.getElementById('custNegativeAlert').classList.toggle('hidden', remaining >= 0);
}

function renderMovements(movements) {
    const tbody = document.getElementById('custMovementsList');
    const empty = document.getElementById('custMovementsEmpty');
    tbody.innerHTML = '';

    if (!movements.length) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    movements.forEach(m => {
        const isDeposit = m.type === 'إيداع عهدة';
        const amt = Number(m.amount) || 0;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="whitespace-nowrap">${formatDate(m.date)}</td>
            <td><span class="type-badge ${isDeposit ? 'badge-deposit' : 'badge-expense'}">${isDeposit ? 'إيداع' : 'صرف'}</span></td>
            <td>${m.item || '-'}</td>
            <td>${m.description || '-'}</td>
            <td>${(m.isTax === 'نعم' || m.isTax === true) ? '✅' : '—'}</td>
            <td class="font-bold whitespace-nowrap" style="color:${isDeposit ? '#059669' : '#dc2626'}">${isDeposit ? '+' : '−'} ${formatCurrency(amt)}</td>
        `;
        tbody.appendChild(row);
    });
}

// ── فواتيري قيد المراجعة (للمشرف) ──────────────────────
async function loadMyPending() {
    const box = document.getElementById('custPendingList');
    try {
        const items = await getMyCustodyRequests(currentEmail, selectedProject);
        if (!items.length) {
            box.innerHTML = '<p class="text-center text-gray-400 text-sm py-3">لا توجد فواتير قيد المراجعة</p>';
            return;
        }
        // تجميع حسب الدفعة
        const batches = [];
        const idx = {};
        items.forEach(i => {
            const key = i.batchId || i.id;
            if (!idx[key]) { idx[key] = { status: i.status, items: [] }; batches.push(idx[key]); }
            idx[key].items.push(i);
        });

        box.innerHTML = batches.map(b => {
            const total = b.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
            const isPending = b.status === 'بانتظار الموافقة';
            const badge = isPending
                ? '<span class="type-badge badge-pending">⏳ بانتظار الموافقة</span>'
                : '<span class="type-badge badge-rejected">❌ مرفوضة</span>';
            return `
                <div class="p-3 mb-2 rounded-xl flex justify-between items-center" style="border:1px solid rgba(30,60,114,0.12); background:rgba(255,255,255,0.6);">
                    <div class="text-sm text-gray-700">${b.items.length} فاتورة — ${formatCurrency(total)}</div>
                    ${badge}
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="text-center text-red-500 text-sm py-3">فشل التحميل</p>';
    }
}

// ── حساب الضريبة (المبلغ شامل الضريبة) ─────────────────
function calcTax(amount, isTax) {
    const amt = Math.round((parseFloat(amount) || 0) * 100) / 100;
    if (!isTax) return { gross: amt, tax: 0, net: amt };
    const net = Math.round((amt / (1 + vatRate)) * 100) / 100;
    const tax = Math.round((amt - net) * 100) / 100;
    return { gross: amt, tax, net };
}

function updateTaxBreakdown() {
    const amount = parseFloat(invAmount.value) || 0;
    const isTax = invIsTax.checked;
    if (amount <= 0) {
        taxBreakdown.classList.add('hidden');
        return;
    }
    const t = calcTax(amount, isTax);
    document.getElementById('taxGross').textContent = formatCurrency(t.gross);
    document.getElementById('taxValue').textContent = formatCurrency(t.tax);
    document.getElementById('taxNet').textContent = formatCurrency(t.net);
    taxBreakdown.classList.remove('hidden');
}

// ── السلة ────────────────────────────────────────────────
function handleAddInvoice() {
    const amount = parseFloat(invAmount.value) || 0;
    const description = invDesc.value.trim();

    if (amount <= 0) { showMessage('⚠️ أدخل قيمة صحيحة'); return; }
    if (!description) { showMessage('⚠️ أدخل الوصف'); return; }

    const isTax = invIsTax.checked;
    const t = calcTax(amount, isTax);

    cart.push({
        date: invDate.value || todayStr(),
        amount: t.gross,
        isTax,
        invoice: invInvoice.value.trim(),
        phase: invPhase.value,
        item: invItem.value,
        description
    });
    renderCart();

    // تصفير الحقول
    invAmount.value = '';
    invInvoice.value = '';
    invDesc.value = '';
    invIsTax.checked = false;
    taxBreakdown.classList.add('hidden');
}

function removeCartInvoice(index) {
    cart.splice(index, 1);
    renderCart();
}
window.removeCartInvoice = removeCartInvoice;

function renderCart() {
    const list = document.getElementById('custCartList');
    const count = document.getElementById('custCartCount');
    const totalBox = document.getElementById('custCartTotal');

    if (!cart.length) {
        list.innerHTML = '<p class="text-center text-gray-400 text-sm py-3">لسه مفيش فواتير مضافة</p>';
        count.textContent = '0 فاتورة';
        totalBox.classList.add('hidden');
        return;
    }

    count.textContent = `${cart.length} فاتورة`;
    list.innerHTML = cart.map((c, i) => `
        <div class="flex justify-between items-center py-2 ${i > 0 ? 'border-t border-gray-100' : ''}">
            <div class="text-sm text-gray-700">
                ${c.item ? `<span class="type-badge badge-custody">${c.item}</span> ` : ''}
                <span>${c.description}</span>
                ${c.isTax ? '<span class="text-xs text-amber-600 mr-1">(ضريبية)</span>' : ''}
            </div>
            <div class="flex items-center gap-3">
                <span class="font-bold text-indigo-600 text-sm">${formatCurrency(c.amount)}</span>
                <button type="button" onclick="removeCartInvoice(${i})" class="text-red-500 text-lg leading-none">✖</button>
            </div>
        </div>
    `).join('');

    const total = cart.reduce((s, c) => s + c.amount, 0);
    totalBox.classList.remove('hidden');
    document.getElementById('custCartTotalValue').textContent = formatCurrency(total);
}

async function handleSubmitCustody() {
    if (!selectedProject) { showMessage('⚠️ اختر المشروع أولاٌ'); return; }
    if (!cart.length) { showMessage('⚠️ أضف فاتورة واحدة على الأقل'); return; }

    const total = cart.reduce((s, c) => s + c.amount, 0);
    if (!confirm(`إرسال ${cart.length} فاتورة بإجمالي ${formatCurrency(total)} للموافقة؟`)) return;

    try {
        submitCustodyBtn.disabled = true;
        submitCustodyBtn.textContent = 'جاري الإرسال...';
        await logCustodyExpense({
            project: selectedProject,
            supervisor: currentUsername,
            recordedBy: currentEmail,
            items: cart
        });
        showMessage('✅ تم إرسال الفواتير للمهندس للموافقة');
        cart = [];
        renderCart();
        setTimeout(() => hideMessage(), 1500);
        await Promise.all([loadMyPending(), loadProjectCustody()]);
    } catch (err) {
        showMessage('❌ فشل الإرسال: ' + err.message);
    } finally {
        submitCustodyBtn.disabled = false;
        submitCustodyBtn.textContent = '✅ إرسال للموافقة';
    }
}

// ── طباعة كشف حساب العهدة (الحركات المعتمدة) ───────────
function handlePrintLedger() {
    if (!selectedProject) { showMessage('⚠️ اختر المشروع أولاً لطباعة كشف حسابه'); return; }

    const rows = lastMovements.map(m => {
        const isDeposit = m.type === 'إيداع عهدة';
        const amt = Number(m.amount) || 0;
        return [
            formatDate(m.date),
            isDeposit ? 'إيداع' : 'صرف',
            m.item || '-',
            m.description || '-',
            (m.isTax === 'نعم' || m.isTax === true) ? 'نعم' : '—',
            (isDeposit ? '+ ' : '− ') + formatCurrency(amt)
        ];
    });

    printReport({
        title: 'كشف حساب عهدة مشروع',
        subtitle: selectedProject,
        metaLines: [
            `المشرف: ${isAdmin ? 'كل المشرفين' : currentUsername}`,
            `تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}`,
            `إجمالي الإيداعات: ${formatCurrency(lastSummary.totalDeposit || 0)}`,
            `إجمالي الصرف: ${formatCurrency(lastSummary.totalExpense || 0)}`,
            `المتبقي: ${formatCurrency(lastSummary.remaining || 0)}`
        ],
        columns: ['التاريخ', 'النوع', 'البند', 'الوصف', 'ضريبية', 'القيمة'],
        rows,
        totalsRow: ['', '', '', '', 'المتبقي', formatCurrency(lastSummary.remaining || 0)],
        emptyText: 'لا توجد حركات معتمدة بعد لهذا المشروع'
    });
}

// ── طباعة سلة الفواتير الحالية (قبل إرسالها للموافقة) ────
// مفيدة عشان المشرف يطبع/يحفظ PDF لفواتيره أول ما يخلص إدخالها
function handlePrintCart() {
    if (!selectedProject) { showMessage('⚠️ اختر المشروع أولاً'); return; }
    if (!cart.length) { showMessage('⚠️ لا توجد فواتير في السلة للطباعة'); return; }

    const rows = cart.map(c => [
        formatDate(c.date),
        c.item || '-',
        c.phase || '-',
        c.description,
        c.isTax ? 'نعم' : '—',
        c.invoice || '-',
        formatCurrency(c.amount)
    ]);
    const total = cart.reduce((s, c) => s + c.amount, 0);

    printReport({
        title: 'كشف فواتير عهدة (قبل الإرسال للموافقة)',
        subtitle: selectedProject,
        metaLines: [
            `المشرف: ${currentUsername}`,
            `عدد الفواتير: ${cart.length}`,
            `تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}`
        ],
        columns: ['التاريخ', 'البند', 'المرحلة', 'الوصف', 'ضريبية', 'رقم الفاتورة', 'القيمة'],
        rows,
        totalsRow: ['', '', '', '', '', 'الإجمالي', formatCurrency(total)]
    });
}

// ═══════════════════════════════════════════════════════════
//  قسم الإدارة (للأدمن فقط)
// ═══════════════════════════════════════════════════════════
async function setupAdmin(visibleProjects) {
    await populateAdminData();

    document.getElementById('depositForm').addEventListener('submit', handleDepositSubmit);
    document.getElementById('assignSupervisorSelect').addEventListener('change', renderProjectAssignBox);
    document.getElementById('saveProjectsBtn').addEventListener('click', handleSaveProjects);
    document.getElementById('saveRoleBtn').addEventListener('click', handleSaveRole);
    document.getElementById('addItemForm').addEventListener('submit', handleAddItemSubmit);
}

// بيجيب قائمة المستخدمين ويعبّي قوائم الإدارة — بيتنادى عند التحميل وعند التحديث
// (من غير ما يضيف event listeners تاني عشان ما تتكررش)
async function populateAdminData() {
    try {
        allUsers = await getUsers();
    } catch (err) {
        console.error(err);
        allUsers = [];
    }

    const supervisors = allUsers.filter(u => u.role !== 'admin' && String(u.status || '').trim() !== 'غير نشط');
    const supOptions = supervisors.map(u => `<option value="${u.username}">${u.username}</option>`).join('');

    document.getElementById('depositSupervisor').innerHTML = '<option value="">— اختر —</option>' + supOptions;
    document.getElementById('assignSupervisorSelect').innerHTML = '<option value="">— اختر المشرف —</option>' + supOptions;
    document.getElementById('roleUserSelect').innerHTML = '<option value="">— اختر —</option>' + supOptions;

    const projOptions = projects.map(p => `<option value="${p}">${p}</option>`).join('');
    document.getElementById('depositProject').innerHTML = '<option value="">— اختر —</option>' + projOptions;

    renderItemsList();
}

async function handleDepositSubmit(e) {
    e.preventDefault();
    const supervisor = document.getElementById('depositSupervisor').value;
    const project = document.getElementById('depositProject').value;
    const amount = document.getElementById('depositAmount').value;
    const description = document.getElementById('depositDesc').value.trim();

    if (!supervisor) { showMessage('⚠️ اختر المشرف'); return; }
    if (!project) { showMessage('⚠️ اختر المشروع'); return; }
    if (!amount || Number(amount) <= 0) { showMessage('⚠️ أدخل مبلغ صحيح'); return; }
    if (!confirm(`إيداع ${amount} ر.س في عهدة "${supervisor}" لمشروع "${project}"؟`)) return;

    try {
        await depositCustody({ date: todayStr(), amount: Number(amount), description, supervisor, project, recordedBy: currentEmail });
        showMessage('✅ تم الإيداع بنجاح');
        document.getElementById('depositAmount').value = '';
        document.getElementById('depositDesc').value = '';
        setTimeout(() => hideMessage(), 1200);
        // لو المشروع المعروض هو نفسه، حدّث العرض
        if (selectedProject === project) await loadProjectCustody();
    } catch (err) {
        showMessage('❌ فشل الإيداع: ' + err.message);
    }
}

function renderProjectAssignBox() {
    const box = document.getElementById('projectAssignBox');
    const saveBtn = document.getElementById('saveProjectsBtn');
    const username = document.getElementById('assignSupervisorSelect').value;
    if (!username) {
        box.innerHTML = '<div class="text-xs text-gray-400 text-center py-2">اختر مشرف أولاٌ</div>';
        saveBtn.classList.add('hidden');
        return;
    }
    if (!projects.length) {
        box.innerHTML = '<div class="text-xs text-gray-400 text-center py-2">لا توجد مشاريع</div>';
        saveBtn.classList.add('hidden');
        return;
    }
    const user = allUsers.find(u => u.username === username);
    const assigned = new Set(user?.projects || []);
    box.innerHTML = `
        <div class="grid grid-cols-2 gap-2">
            ${projects.map(p => `
                <label class="flex items-center gap-2 text-xs bg-white border rounded-lg px-2 py-1.5 cursor-pointer" style="border-color:rgba(30,60,114,0.15);">
                    <input type="checkbox" class="project-assign-checkbox" value="${p}" ${assigned.has(p) ? 'checked' : ''}>
                    <span>${p}</span>
                </label>
            `).join('')}
        </div>
    `;
    saveBtn.classList.remove('hidden');
}

async function handleSaveProjects() {
    const username = document.getElementById('assignSupervisorSelect').value;
    if (!username) return;
    const checked = Array.from(document.querySelectorAll('.project-assign-checkbox:checked')).map(c => c.value);
    try {
        await updateUserProjects(username, checked, currentEmail);
        showMessage('✅ تم حفظ مشاريع المشرف');
        setTimeout(() => hideMessage(), 1200);
        allUsers = await getUsers();
        renderProjectAssignBox();
    } catch (err) {
        showMessage('❌ فشل الحفظ: ' + err.message);
    }
}

async function handleSaveRole() {
    const username = document.getElementById('roleUserSelect').value;
    const role = document.getElementById('roleSelect').value;
    if (!username) { showMessage('⚠️ اختر المستخدم'); return; }
    try {
        await setUserRole(username, role, currentEmail);
        showMessage('✅ تم تحديث الرتبة');
        setTimeout(() => hideMessage(), 1200);
        allUsers = await getUsers();
    } catch (err) {
        showMessage('❌ فشل التحديث: ' + err.message);
    }
}

async function handleAddItemSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('newItemName').value.trim();
    if (!name) return;
    try {
        await addCustodyItem(name, currentEmail);
        showMessage('✅ تم إضافة البند');
        document.getElementById('newItemName').value = '';
        setTimeout(() => hideMessage(), 1200);
        const setup = await loadSetup();
        if (setup) { populateItemSelect(); renderItemsList(); }
    } catch (err) {
        showMessage('❌ فشل الإضافة: ' + err.message);
    }
}

function renderItemsList() {
    const box = document.getElementById('itemsListBox');
    if (box) {
        box.textContent = custodyItems.length ? 'البنود الحالية: ' + custodyItems.join('، ') : 'لا توجد بنود بعد';
    }
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return String(dateStr);
    return d.toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
