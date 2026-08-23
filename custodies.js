// ═══════════════════════════════════════════════════════════
// صفحة العهد — كل مشرف يرى عهده فقط، الأدمن يرى الجميع
// ═══════════════════════════════════════════════════════════
import { auth, showMessage, hideMessage, todayStr, formatDate, formatCurrency } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getUserRole, getSetupData, getUsers, getAdvanceMovements, logAdvanceExpense, depositAdvance } from './sheets-service.js';

const adminSection = document.getElementById('adminSection');
const summarySection = document.getElementById('summarySection');
const printArea = document.getElementById('printArea');
const supervisorSelect = document.getElementById('supervisorSelect');
const expenseProject = document.getElementById('expenseProject');
const filterProject = document.getElementById('filterProject');
const movementsList = document.getElementById('movementsList');
const movementsEmpty = document.getElementById('movementsEmpty');
const logTotals = document.getElementById('logTotals');
const headerSub = document.getElementById('headerSub');
const remainingCard = document.getElementById('remainingCard');
const closeMessageBtn = document.getElementById('closeMessageBtn');

closeMessageBtn?.addEventListener('click', hideMessage);

let currentEmail = null;
let currentUsername = null;
let isAdmin = false;
let projects = [];
let allMovements = [];

document.getElementById('expenseDate').value = todayStr();

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    currentEmail = user.email;
    currentUsername = user.email.replace('@exo-system.local', '');

    try {
        const info = await getUserRole(user.email);
        isAdmin = info.role === 'admin';
    } catch (err) {
        console.error(err);
    }

    if (isAdmin) {
        adminSection.classList.remove('hidden');
        await loadSupervisors();
        supervisorSelect.addEventListener('change', loadMovements);
    } else {
        adminSection.classList.add('hidden');
        await loadMovements();
    }

    await loadProjects();
    document.getElementById('expenseForm').addEventListener('submit', handleExpenseSubmit);
    document.getElementById('depositForm').addEventListener('submit', handleDepositSubmit);
    document.getElementById('filterFrom').addEventListener('input', renderMovements);
    document.getElementById('filterTo').addEventListener('input', renderMovements);
    filterProject.addEventListener('change', renderMovements);
    document.getElementById('printBtn').addEventListener('click', () => window.print());
});

async function loadSupervisors() {
    try {
        const users = await getUsers();
        const supervisors = users.filter(u => u.role !== 'admin' && String(u.status || '').trim() !== 'غير نشط');
        supervisorSelect.innerHTML = '<option value="">— اختر المشرف —</option>' +
            supervisors.map(u => `<option value="${u.username}">${u.username}</option>`).join('');
    } catch (err) {
        console.error(err);
        showMessage('فشل تحميل المشرفين: ' + err.message);
    }
}

async function loadProjects() {
    try {
        const data = await getSetupData();
        projects = data.projects || [];
        const options = '<option value="">بدون مشروع</option>' +
            projects.map(p => `<option value="${p}">${p}</option>`).join('');
        expenseProject.innerHTML = options;
        filterProject.innerHTML = '<option value="">الكل</option>' + options;
    } catch (err) {
        console.error(err);
    }
}

async function loadMovements() {
    const supervisor = isAdmin ? supervisorSelect.value : currentUsername;
    if (!supervisor) return;
    try {
        allMovements = await getAdvanceMovements(supervisor);
        renderMovements();
    } catch (err) {
        console.error(err);
        showMessage('فشل تحميل سجل العهدة: ' + err.message);
    }
}

function renderMovements() {
    const from = document.getElementById('filterFrom').value;
    const to = document.getElementById('filterTo').value;
    const project = filterProject.value;
    const supervisorName = isAdmin ? supervisorSelect.value : currentUsername;

    let list = [...allMovements].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (from) list = list.filter(m => new Date(m.date) >= new Date(from));
    if (to) list = list.filter(m => new Date(m.date) <= new Date(to));
    if (project) list = list.filter(m => m.project === project);

    const isDeposit = m => m.type === 'إيداع عهدة';
    const sum = (arr, pred) => arr.filter(pred).reduce((s, m) => s + (Number(m.amount) || 0), 0);

    const totalDeposit = sum(allMovements, isDeposit);
    const totalExpense = sum(allMovements, m => !isDeposit(m));
    const remaining = totalDeposit - totalExpense;

    document.getElementById('totalDeposit').textContent = formatCurrency(totalDeposit);
    document.getElementById('totalExpense').textContent = formatCurrency(totalExpense);
    document.getElementById('remaining').textContent = formatCurrency(remaining);

    remainingCard.classList.remove('stat-remaining', 'stat-negative');
    remainingCard.classList.add(remaining < 0 ? 'stat-negative' : 'stat-remaining');
    document.getElementById('negativeAlert').classList.toggle('hidden', remaining >= 0);

    summarySection.classList.remove('hidden');
    printArea.classList.remove('hidden');
    document.getElementById('printTitle').classList.remove('hidden');
    document.getElementById('printHeader').classList.remove('hidden');
    document.getElementById('printName').textContent = supervisorName;
    document.getElementById('printDateSpan').textContent = formatDate(new Date());
    headerSub.textContent = `سجل صرف العهد ومتابعة المتبقي — ${supervisorName}`;

    movementsList.innerHTML = '';
    list.forEach(m => {
        const amt = Number(m.amount) || 0;
        const dep = isDeposit(m);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="whitespace-nowrap">${formatDate(m.date)}</td>
            <td>${m.project || '-'}</td>
            <td>${m.description || '-'}</td>
            <td class="whitespace-nowrap">${m.invoice || '-'}</td>
            <td><span class="type-badge ${dep ? 'badge-deposit' : 'badge-expense'}">${dep ? 'إيداع' : 'صرف'}</span></td>
            <td class="font-bold whitespace-nowrap" style="color:${dep ? '#059669' : '#dc2626'}">${dep ? '+' : '−'} ${formatCurrency(amt)}</td>
        `;
        movementsList.appendChild(row);
    });
    movementsEmpty.classList.toggle('hidden', list.length > 0);

    const shownDeposit = sum(list, isDeposit);
    const shownExpense = sum(list, m => !isDeposit(m));
    const hasFilter = from || to || project;
    if (hasFilter) {
        logTotals.classList.remove('hidden');
        document.getElementById('logDepositTotal').textContent = formatCurrency(shownDeposit);
        document.getElementById('logExpenseTotal').textContent = formatCurrency(shownExpense);
    } else {
        logTotals.classList.add('hidden');
    }
}

async function handleExpenseSubmit(e) {
    e.preventDefault();
    const amount = document.getElementById('expenseAmount').value;
    const invoice = document.getElementById('expenseInvoice').value.trim();
    const project = expenseProject.value;
    const description = document.getElementById('expenseDesc').value.trim();
    const date = document.getElementById('expenseDate').value;

    if (!amount || Number(amount) <= 0) { showMessage('⚠️ أدخل مبلغ صحيح'); return; }
    if (!description) { showMessage('⚠️ أدخل الوصف'); return; }
    if (!confirm(`تسجيل صرف ${amount} ر.س ${description ? '— ' + description : ''}؟`)) return;

    try {
        await logAdvanceExpense({
            date, amount: Number(amount), invoice, project, description,
            supervisor: currentUsername, recordedBy: currentEmail
        });
        showMessage('✅ تم تسجيل الصرف');
        document.getElementById('expenseAmount').value = '';
        document.getElementById('expenseInvoice').value = '';
        document.getElementById('expenseDesc').value = '';
        expenseProject.value = '';
        setTimeout(() => hideMessage(), 1200);
        await loadMovements();
    } catch (err) {
        showMessage('❌ فشل الحفظ: ' + err.message);
    }
}

async function handleDepositSubmit(e) {
    e.preventDefault();
    const target = supervisorSelect.value;
    const amount = document.getElementById('depositAmount').value;
    const description = document.getElementById('depositDesc').value.trim();

    if (!target) { showMessage('⚠️ اختر المشرف أولاً'); return; }
    if (!amount || Number(amount) <= 0) { showMessage('⚠️ أدخل مبلغ صحيح'); return; }
    if (!confirm(`إيداع ${amount} ر.س في عهدة "${target}"؟`)) return;

    try {
        await depositAdvance({
            date: todayStr(), amount: Number(amount), description,
            supervisor: target, recordedBy: currentEmail
        });
        showMessage('✅ تم الإيداع بنجاح');
        document.getElementById('depositAmount').value = '';
        document.getElementById('depositDesc').value = '';
        setTimeout(() => hideMessage(), 1200);
        await loadMovements();
    } catch (err) {
        showMessage('❌ فشل الإيداع: ' + err.message);
    }
}