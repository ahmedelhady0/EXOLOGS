// ═══════════════════════════════════════════════════════════
// Service Worker — نظام EXO
// بيخزن "هيكل" الموقع (HTML/CSS/JS/الأيقونات) عشان يفتح فوراً
// حتى لو النت ضعيف أو مقطوع في الموقع. بيانات Google Sheets نفسها
// (اليوميات/العهد) بتتطلب نت شغال زي ما هي — احنا مش بنخزنها هنا
// عشان تفضل دايماً محدّثة وصحيحة ماليًا.
// ═══════════════════════════════════════════════════════════

const CACHE_VERSION = 'exo-shell-v1';

const APP_SHELL = [
    'index.html',
    'home.html',
    'daily-logs.html',
    'custodies.html',
    'approvals.html',
    'styles.css',
    'firebase-config.js',
    'sheets-service.js',
    'auth.js',
    'home.js',
    'daily-logs.js',
    'custodies.js',
    'approvals.js',
    'manifest.json',
    'icons/icon-192.png',
    'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return; // اطلبات الحفظ/التسجيل (POST) لازم تروح للنت مباشرة دايمًا

    const url = new URL(request.url);

    // أي حاجة مش من نفس الموقع (Google Apps Script، Firebase، الخطوط، Tailwind CDN)
    // تروح للنت زي ما هي من غير تخزين — دي بيانات حية أو مكتبات خارجية
    if (url.origin !== self.location.origin) return;

    // Stale-while-revalidate: ارجع النسخة المخزنة فورًا (لو موجودة) وفي نفس الوقت
    // حدّثها من النت في الخلفية عشان المرة الجاية تبقى أحدث نسخة
    event.respondWith(
        caches.open(CACHE_VERSION).then(async (cache) => {
            const cached = await cache.match(request);
            const networkFetch = fetch(request)
                .then((response) => {
                    if (response && response.status === 200) cache.put(request, response.clone());
                    return response;
                })
                .catch(() => cached);
            return cached || networkFetch;
        })
    );
});
