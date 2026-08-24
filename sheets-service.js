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
    return cacheGet('cache_setup_exo', 5 * 60 * 1000, () =>
        callGet({ action: 'getSetupData', ...(forceRefresh ? { refresh: 1 } : {}) })
    );
}

export async function getUserRole(email) {
    return callGet({ action: 'getUserRole', email });
}

export async function getUsers() {
    const data = await callGet({ action: 'getUsers' });
    return data.users || [];
}

export async function getDailyLogs(email = null, forceRefresh = false) {
    const cacheKey = 'cache_dailylogs_' + (email || 'all');
    if (forceRefresh) bustCache(cacheKey);
    return cacheGet(cacheKey, 5 * 60 * 1000, () =>
        callGet({ action: 'getDailyLogs', email }).then(d => d.logs || [])
    );
}

export async function getDailyLogsSummary(email = null) {
    return getDailyLogs(email);
}

export async function getAdvanceMovements(supervisor = null) {
    const data = await callGet({ action: 'getAdvanceMovements',
        ...((supervisor && supervisor !== 'الكل') ? { supervisor } : {}) });
    return data.movements || [];
}

// ── الكتابة ────────────────────────────────────────────────
export async function logDailyLog(data) {
    const r = await callPost({ action: 'logDailyLog', ...data });
    // مسح الكاش
    try { localStorage.removeItem('cache_dailylogs_' + data.supervisor); } catch (_) {}
    try { localStorage.removeItem('cache_dailylogs_all'); } catch (_) {}
    return r;
}

export async function logAdvanceExpense(data) {
    return callPost({ action: 'logAdvanceExpense', ...data });
}

export async function depositAdvance(data) {
    return callPost({ action: 'depositAdvance', ...data });
}

export async function registerUser(userData) {
    return callPost({ action: 'registerUser', ...userData });
}

export async function updateUserProjects(username, projects, requesterEmail) {
    return callPost({ action: 'updateUserProjects', username, projects, requesterEmail });
}

export async function addProject(name, requesterEmail) {
    const r = await callPost({ action: 'addProject', name, requesterEmail });
    bustCache('cache_setup_exo');
    return r;
}

export async function addProjectPhase(project, phase, requesterEmail) {
    const r = await callPost({ action: 'addProjectPhase', project, phase, requesterEmail });
    bustCache('cache_setup_exo');
    return r;
}

export async function addPhase(name, requesterEmail) {
    const r = await callPost({ action: 'addPhase', name, requesterEmail });
    bustCache('cache_setup_exo');
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
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('cache_dailylogs_') || key.startsWith('cache_movements_'))) {
                localStorage.removeItem(key);
            }
        }
    } catch (_) {}
}
