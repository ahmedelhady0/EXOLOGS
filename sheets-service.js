// ═══════════════════════════════════════════════════════════
// خدمة Google Sheets — نظام EXO
// ═══════════════════════════════════════════════════════════

// ⚠️ غيّر هذا الرابط لرابط Web App الخاص بك بعد نشر Code.gs
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwM3v8UioGSsOjFMqFU5lPyufahE9bTFcJWIdX3RyPXe4NIklC4MWH_VjUQG9IQGcJj4Q/exec";

async function callGet(params) {
    const url = new URL(WEB_APP_URL);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
}

async function callPost(body) {
    const res = await fetch(WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { parsed = { ok: true }; }
    if (parsed && parsed.ok === false) throw new Error(parsed.error || 'فشل الطلب');
    return parsed;
}

// ── كاش محلي (localStorage) ─────────────────────────────
function cacheGet(key, ttlMs, fetcher) {
    try {
        const cached = localStorage.getItem(key);
        if (cached) {
            const { data, ts } = JSON.parse(cached);
            if (Date.now() - ts < ttlMs) return Promise.resolve(data);
        }
    } catch (_) {}
    return fetcher().then(data => {
        try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch (_) {}
        return data;
    });
}

function bustCache(key) {
    try { localStorage.removeItem(key); } catch (_) {}
}

// ── القراءة ────────────────────────────────────────────────
export async function getSetupData(forceRefresh = false) {
    if (forceRefresh) bustCache('cache_setup_exo');
    return cacheGet('cache_setup_exo', 30 * 1000, () =>
        callGet({ action: 'getSetupData', ...(forceRefresh ? { refresh: 1 } : {}) })
    );
}

export async function getProjectsData(forceRefresh = false) {
    if (forceRefresh) bustCache('cache_projects_exo');
    return cacheGet('cache_projects_exo', 30 * 1000, () =>
        callGet({ action: 'getProjectsData', ...(forceRefresh ? { refresh: 1 } : {}) })
    );
}

export async function getUserRole(email) {
    return callGet({ action: 'getUserRole', email });
}

export async function getUsers() {
    const data = await callGet({ action: 'getUsers' });
    return data.users || [];
}

// اليوميات الموافق عليها
export async function getDailyLogs(email = null, forceRefresh = false) {
    const cacheKey = 'cache_dailylogs_' + (email || 'all');
    if (forceRefresh) bustCache(cacheKey);
    return cacheGet(cacheKey, 30 * 1000, () =>
        callGet({ action: 'getDailyLogs', email }).then(d => d.logs || [])
    );
}

export async function getDailyLogsSummary(email = null) {
    return getDailyLogs(email);
}

// طلبات المشرف نفسه (بانتظار الموافقة / المرفوضة)
export async function getMyDailyLogRequests(email) {
    return callGet({ action: 'getMyDailyLogRequests', email }).then(d => d.logs || []);
}

// اليوميات بانتظار الموافقة (للمهندس/الأدمن)
export async function getPendingDailyLogs() {
    return callGet({ action: 'getPendingDailyLogs' }).then(d => d.logs || []);
}

// فواتير العهد بانتظار الموافقة (للمهندس/الأدمن)
export async function getPendingCustody() {
    return callGet({ action: 'getPendingCustody' }).then(d => d.items || []);
}

// طلبات المشرف نفسه (بانتظار الموافقة + المرفوضة) لمشروع معين
export async function getMyCustodyRequests(email, project = null) {
    return callGet({ action: 'getMyCustodyRequests', email, project }).then(d => d.items || []);
}

// حركات عهدة مشروع معين لمشرف معين
export async function getProjectCustody(project, supervisor = null) {
    return callGet({ action: 'getProjectCustody', project, supervisor });
}

// ملخص عهد المشرف عبر كل مشاريعه
export async function getMyCustodySummary(email) {
    return callGet({ action: 'getMyCustodySummary', email }).then(d => d.custodies || []);
}

// بنود العهد
export async function getCustodyItems() {
    return callGet({ action: 'getCustodyItems' }).then(d => d.items || []);
}

// ── الكتابة: اليوميات ────────────────────────────────────
export async function logDailyLog(data) {
    const r = await callPost({ action: 'logDailyLog', ...data });
    bustCache('cache_dailylogs_' + data.supervisor);
    bustCache('cache_dailylogs_all');
    return r;
}

export async function logDailyLogBatch(data) {
    return logDailyLog(data);
}

export async function approveDailyLog(batchId, approverEmail) {
    const r = await callPost({ action: 'approveDailyLog', batchId, approverEmail });
    clearCache();
    return r;
}

// موافقة جماعية على أكتر من دفعة يوميات مرة واحدة
export async function bulkApproveDailyLogs(batchIds, approverEmail) {
    const r = await callPost({ action: 'bulkApproveDailyLogs', batchIds, approverEmail });
    clearCache();
    return r;
}

// تعليم دفعات يوميات معينة كـ "مطبوعة" عشان الطباعة الجاية تتخطاها
export async function markDailyLogsPrinted(ids) {
    return callPost({ action: 'markDailyLogsPrinted', ids });
}

export async function rejectDailyLog(batchId, approverEmail, reason = '') {
    const r = await callPost({ action: 'rejectDailyLog', batchId, approverEmail, reason });
    clearCache();
    return r;
}

// ── الكتابة: العهد ───────────────────────────────────────
export async function logCustodyExpense(data) {
    const r = await callPost({ action: 'logCustodyExpense', ...data });
    clearCache();
    return r;
}

export async function approveCustodyExpense(batchId, approverEmail) {
    const r = await callPost({ action: 'approveCustodyExpense', batchId, approverEmail });
    clearCache();
    return r;
}

// موافقة جماعية على أكتر من دفعة فواتير عهدة مرة واحدة
export async function bulkApproveCustody(batchIds, approverEmail) {
    const r = await callPost({ action: 'bulkApproveCustody', batchIds, approverEmail });
    clearCache();
    return r;
}

// تعليم حركات عهدة معينة كـ "مطبوعة" عشان الطباعة الجاية تتخطاها
export async function markCustodyPrinted(project, ids) {
    return callPost({ action: 'markCustodyPrinted', project, ids });
}

export async function rejectCustodyExpense(batchId, approverEmail, reason = '') {
    const r = await callPost({ action: 'rejectCustodyExpense', batchId, approverEmail, reason });
    clearCache();
    return r;
}

export async function depositCustody(data) {
    const r = await callPost({ action: 'depositCustody', ...data });
    clearCache();
    return r;
}

export async function addCustodyItem(name, requesterEmail) {
    const r = await callPost({ action: 'addCustodyItem', name, requesterEmail });
    bustCache('cache_setup_exo');
    return r;
}

// ── الكتابة: المستخدمين والمشاريع ────────────────────────
export async function registerUser(userData) {
    return callPost({ action: 'registerUser', ...userData });
}

export async function updateUserProjects(username, projects, requesterEmail) {
    return callPost({ action: 'updateUserProjects', username, projects, requesterEmail });
}

export async function setUserRole(username, role, requesterEmail) {
    return callPost({ action: 'setUserRole', username, role, requesterEmail });
}

export async function addProject(name, requesterEmail) {
    const r = await callPost({ action: 'addProject', name, requesterEmail });
    bustCache('cache_setup_exo');
    bustCache('cache_projects_exo');
    return r;
}

export async function addProjectPhase(project, phase, requesterEmail) {
    const r = await callPost({ action: 'addProjectPhase', project, phase, requesterEmail });
    bustCache('cache_setup_exo');
    bustCache('cache_projects_exo');
    return r;
}

export async function addDailyLogPrice(typeId, price, requesterEmail, name = null, allowCustomPrice = null) {
    const body = { action: 'addDailyLogPrice', typeId, price, requesterEmail };
    if (name !== null) body.name = name;
    if (allowCustomPrice !== null) body.allowCustomPrice = allowCustomPrice;
    const r = await callPost(body);
    bustCache('cache_setup_exo');
    return r;
}

export function clearCache() {
    try {
        localStorage.removeItem('cache_setup_exo');
        localStorage.removeItem('cache_projects_exo');
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('cache_dailylogs_') || key.startsWith('cache_movements_') || key.startsWith('cache_custody_'))) {
                localStorage.removeItem(key);
            }
        }
    } catch (_) {}
}
