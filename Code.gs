/**
 * =============================================
 * نظام EXO - Code.gs للـ Google Apps Script
 * يدير: المستخدمين، المشاريع، اليوميات، العهد
 * =============================================
 */

const SHEET_NAMES = {
  projects: 'بيانات المشاريع',
  materials: 'المواد', // قد لا نحتاجها لكن نتركها للتوافق
  suppliers: 'الموردين',
  users: 'Users',
  dailyLogs: 'سجل اليوميات',
  dailyLogPrices: 'أسعار اليوميات',
  advanceMovements: 'سجل حركات العهدة'
};

// المراحل الثابتة
const PROJECT_PHASES = ['فوم', 'رولات', 'أسمنتي', 'دورات مياه'];

// أنواع اليوميات الافتراضية مع أسعارها
const DEFAULT_DAILY_LOG_TYPES = [
  { id: 'carpenter', name: 'نجار', defaultPrice: 200, allowCustomPrice: false },
  { id: 'electrician', name: 'كهربائي', defaultPrice: 180, allowCustomPrice: false },
  { id: 'plumber', name: 'سباك', defaultPrice: 190, allowCustomPrice: false },
  { id: 'painter', name: 'دهان', defaultPrice: 170, allowCustomPrice: false },
  { id: 'mason', name: 'بناء', defaultPrice: 210, allowCustomPrice: false },
  { id: 'helper', name: 'مساعد', defaultPrice: 120, allowCustomPrice: false },
  { id: 'lump_sum', name: 'مقطوعية', defaultPrice: 0, allowCustomPrice: true }
];

// ── دوال مساعدة عامة ─────────────────────────────
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

function normalizeHeader(h) {
  return String(h).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function getHeaderRowIndex(sheet) {
  const values = sheet.getDataRange().getValues();
  for (let i = 0; i < Math.min(5, values.length); i++) {
    if (String(values[i][0]).trim() === 'ID') return i;
  }
  return 0;
}

function sheetToObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headerIdx = getHeaderRowIndex(sheet);
  const headers = values[headerIdx].map(normalizeHeader);
  return values.slice(headerIdx + 1)
    .filter(row => row.some(c => c !== '' && c !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return obj;
    });
}

function getNormalizedHeaders(sheet) {
  const headerIdx = getHeaderRowIndex(sheet);
  const raw = sheet.getRange(headerIdx + 1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return raw.map(normalizeHeader);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── إنشاء الشيتات المطلوبة ─────────────────────────
function getOrCreateUsersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.users);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.users);
    sheet.appendRow(['uid', 'username', 'email', 'role', 'تاريخ الإنشاء', 'الحالة']);
  }
  return sheet;
}

function getOrCreateDailyLogsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.dailyLogs);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.dailyLogs);
    sheet.appendRow(['ID', 'التاريخ', 'المشروع', 'المرحلة', 'نوع اليومية', 'اسم النوع', 'الكمية', 'سعر الوحدة', 'الإجمالي', 'ملاحظات', 'المشرف', 'تاريخ التسجيل']);
  }
  return sheet;
}

function getOrCreateDailyLogPricesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.dailyLogPrices);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.dailyLogPrices);
    sheet.appendRow(['النوع', 'الاسم', 'السعر الافتراضي', 'يسمح بسعر مخصص']);
    // تعبئة البيانات الافتراضية
    DEFAULT_DAILY_LOG_TYPES.forEach(t => {
      sheet.appendRow([t.id, t.name, t.defaultPrice, t.allowCustomPrice]);
    });
  }
  return sheet;
}

function getOrCreateAdvanceSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.advanceMovements);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.advanceMovements);
    sheet.appendRow(['ID', 'التاريخ', 'المشروع', 'المبلغ', 'رقم الفاتورة', 'الوصف', 'المشرف', 'نوع الحركة', 'المسجل بواسطة', 'تاريخ التسجيل']);
  }
  return sheet;
}

function getOrCreateProjectsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.projects);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.projects);
    sheet.appendRow(['اسم المشروع', 'المرحلة', 'الحالة', 'تاريخ الإضافة']);
  }
  return sheet;
}

function getOrCreateMaterialsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.materials);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.materials);
    sheet.appendRow(['اسم مختصر للبند', 'المواد المستخدمة', 'الوحدة']);
  }
  return sheet;
}

function getOrCreateSuppliersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.suppliers);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.suppliers);
    sheet.appendRow(['اسم المورد']);
  }
  return sheet;
}

// ═══════════════════════════════════════════════════════════
//  الدوال الرئيسية: doGet و doPost
// ═══════════════════════════════════════════════════════════

function doGet(e) {
  const action = e.parameter.action;
  try {
    if (action === 'getSetupData') return handleGetSetupData(e);
    if (action === 'getUserRole') return handleGetUserRole(e);
    if (action === 'getUsers') return handleGetUsers();
    if (action === 'getDailyLogs') return handleGetDailyLogs(e);
    if (action === 'getAdvanceMovements') return handleGetAdvanceMovements(e);

    return jsonResponse({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'logDailyLog') return handleLogDailyLog(body);
    if (action === 'logAdvanceExpense') return handleLogAdvanceExpense(body);
    if (action === 'depositAdvance') return handleDepositAdvance(body);
    if (action === 'registerUser') return handleRegisterUser(body);
    if (action === 'addProject') return handleAddProject(body);
    if (action === 'addDailyLogPrice') return handleAddDailyLogPrice(body);

    return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════
//  تنفيذ العمليات (GET)
// ═══════════════════════════════════════════════════════════

function handleGetSetupData(e) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'setupData_exo_v1';

  if (e.parameter && e.parameter.refresh) cache.remove(cacheKey);

  const cached = cache.get(cacheKey);
  if (cached) return jsonResponse(JSON.parse(cached));

  let projects = [], projectDates = {}, materials = [], suppliers = [], dailyLogPrices = {};

  try {
    const projData = sheetToObjects(getOrCreateProjectsSheet());
    const newestDate = {};
    projData.forEach(p => {
      const name = String(p['اسم المشروع'] || '').trim();
      if (!name || !String(p['الحالة'] || '').trim().includes('شغال')) return;
      const d = p['تاريخ الإضافة'] ? new Date(p['تاريخ الإضافة']) : null;
      if (d && (!newestDate[name] || d > newestDate[name])) newestDate[name] = d;
    });
    projects = Object.keys(newestDate);
    Object.entries(newestDate).forEach(([k, v]) => { projectDates[k] = v.getTime(); });
  } catch (err) { console.log('Projects Error:', err.message); }

  try {
    const matData = sheetToObjects(getOrCreateMaterialsSheet());
    materials = matData.map(row => ({
      phase: String(row['اسم مختصر للبند'] || '').trim(),
      name: String(row['المواد المستخدمة'] || '').trim(),
      unit: String(row['الوحدة'] || '').trim()
    })).filter(m => m.name && m.phase);
  } catch (err) { console.log('Materials Error:', err.message); }

  try {
    suppliers = sheetToObjects(getOrCreateSuppliersSheet())
      .map(s => String(s['اسم المورد'] || '').trim()).filter(Boolean);
  } catch (err) { console.log('Suppliers Error:', err.message); }

  // أسعار اليوميات
  try {
    const priceData = sheetToObjects(getOrCreateDailyLogPricesSheet());
    priceData.forEach(row => {
      const typeId = String(row['النوع'] || '').trim();
      if (typeId) {
        dailyLogPrices[typeId] = parseFloat(row['السعر الافتراضي']) || 0;
      }
    });
  } catch (err) { console.log('DailyLogPrices Error:', err.message); }

  const result = { projects, projectDates, materials, suppliers, dailyLogPrices };
  cache.put(cacheKey, JSON.stringify(result), 30);
  return jsonResponse(result);
}

function handleGetUserRole(e) {
  const email = e.parameter.email;
  const username = email ? email.split('@')[0].toLowerCase() : '';

  if (username === 'admin') return jsonResponse({ role: 'admin', username, active: true });

  try {
    const users = sheetToObjects(getOrCreateUsersSheet());
    const found = users.find(u => String(u['email'] || '').toLowerCase() === String(email || '').toLowerCase());

    if (!found) {
      return jsonResponse({ role: 'blocked', username, active: false, reason: 'not_registered' });
    }

    const status = String(found['الحالة'] || '').trim();
    if (status !== 'نشط') {
      return jsonResponse({ role: 'blocked', username, active: false, reason: 'inactive' });
    }

    return jsonResponse({ role: found['role'] || 'supervisor', username, active: true });
  } catch (err) {
    console.log('getUserRole error:', err.message);
  }

  return jsonResponse({ role: 'supervisor', username, active: true });
}

function handleGetUsers() {
  const users = sheetToObjects(getOrCreateUsersSheet());
  return jsonResponse({
    users: users.map(u => ({
      uid: u['uid'],
      username: u['username'],
      email: u['email'],
      role: u['role'] || 'supervisor',
      status: u['الحالة'] || 'نشط'
    }))
  });
}

function handleGetDailyLogs(e) {
  let logs = sheetToObjects(getOrCreateDailyLogsSheet());
  logs.sort((a, b) => new Date(b['التاريخ'] || 0) - new Date(a['التاريخ'] || 0));

  const email = e.parameter.email;
  if (email && email !== 'null' && email !== 'undefined') {
    const username = email.split('@')[0].toLowerCase();
    logs = logs.filter(l =>
      String(l['المشرف'] || '').trim().toLowerCase() === username
    );
  }
  return jsonResponse({ logs });
}

function handleGetAdvanceMovements(e) {
  let movements = sheetToObjects(getOrCreateAdvanceSheet());
  movements.sort((a, b) => new Date(b['التاريخ'] || 0) - new Date(a['التاريخ'] || 0));

  const supervisor = String((e.parameter && e.parameter.supervisor) || '').trim();
  if (supervisor) {
    movements = movements.filter(m => String(m['المشرف'] || '').trim() === supervisor);
  }

  return jsonResponse({
    movements: movements.map(m => ({
      id: m['ID'],
      date: m['التاريخ'],
      project: m['المشروع'],
      amount: m['المبلغ'],
      invoice: m['رقم الفاتورة'],
      description: m['الوصف'],
      supervisor: m['المشرف'],
      type: m['نوع الحركة']
    }))
  });
}

// ═══════════════════════════════════════════════════════════
//  تنفيذ العمليات (POST)
// ═══════════════════════════════════════════════════════════

function handleLogDailyLog(body) {
  try {
    const id = 'DL-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random()*1000);
    const sheet = getOrCreateDailyLogsSheet();

    sheet.appendRow([
      id,
      body.date || new Date(),
      body.project || '',
      body.phase || '',
      body.typeId || '',
      body.typeName || '',
      parseFloat(body.quantity) || 0,
      parseFloat(body.unitPrice) || 0,
      parseFloat(body.totalCost) || 0,
      body.notes || '',
      body.supervisor || '',
      new Date()
    ]);

    return jsonResponse({ ok: true, id });
  } catch (err) {
    return jsonResponse({ ok: false, error: 'خطأ: ' + err.message });
  }
}

function handleLogAdvanceExpense(params) {
  try {
    const amount = parseFloat(params.amount) || 0;
    if (amount <= 0) return jsonResponse({ ok: false, error: 'المبلغ غير صحيح' });
    const supervisor = String(params.supervisor || '').trim();
    if (!supervisor) return jsonResponse({ ok: false, error: 'المشرف مطلوب' });

    const id = 'ADV-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000);
    getOrCreateAdvanceSheet().appendRow([
      id,
      formatWafeqDate_(params.date || new Date()),
      String(params.project || '').trim(),
      Math.round(amount * 100) / 100,
      String(params.invoice || '').trim(),
      String(params.description || '').trim(),
      supervisor,
      'صرف',
      String(params.recordedBy || '').trim(),
      new Date()
    ]);
    return jsonResponse({ ok: true, id });
  } catch (err) {
    return jsonResponse({ ok: false, error: 'خطأ: ' + err.message });
  }
}

function handleDepositAdvance(params) {
  try {
    const amount = parseFloat(params.amount) || 0;
    if (amount <= 0) return jsonResponse({ ok: false, error: 'المبلغ غير صحيح' });
    const supervisor = String(params.supervisor || '').trim();
    if (!supervisor) return jsonResponse({ ok: false, error: 'المشرف مطلوب' });

    const id = 'DEP-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000);
    getOrCreateAdvanceSheet().appendRow([
      id,
      formatWafeqDate_(params.date || new Date()),
      '',
      Math.round(amount * 100) / 100,
      '',
      String(params.description || '').trim(),
      supervisor,
      'إيداع عهدة',
      String(params.recordedBy || '').trim(),
      new Date()
    ]);
    return jsonResponse({ ok: true, id });
  } catch (err) {
    return jsonResponse({ ok: false, error: 'خطأ: ' + err.message });
  }
}

function handleRegisterUser(body) {
  const sheet = getOrCreateUsersSheet();
  const role = String(body.username || '').toLowerCase() === 'admin' ? 'admin' : 'supervisor';
  sheet.appendRow([body.uid || '', body.username || '', body.email || '', role, new Date(), 'نشط']);
  return jsonResponse({ ok: true, role });
}

function handleAddProject(body) {
  const name = String((body && body.name) || '').trim();
  if (!name) return jsonResponse({ ok: false, error: 'اسم المشروع مطلوب' });
  const sheet = getOrCreateProjectsSheet();
  PROJECT_PHASES.forEach(phase => {
    sheet.appendRow([name, phase, 'شغالة', '', '', '', '', '', new Date()]);
  });
  CacheService.getScriptCache().remove('setupData_exo_v1');
  return jsonResponse({ ok: true, phases: PROJECT_PHASES.length });
}

function handleAddDailyLogPrice(body) {
  const typeId = String((body && body.typeId) || '').trim();
  const price = parseFloat((body && body.price)) || 0;
  if (!typeId) return jsonResponse({ ok: false, error: 'نوع اليومية مطلوب' });

  const sheet = getOrCreateDailyLogPricesSheet();
  const data = sheetToObjects(sheet);
  const headers = getNormalizedHeaders(sheet);
  const typeCol = headers.indexOf('النوع');
  const priceCol = headers.indexOf('السعر الافتراضي');

  // البحث عن الصف وتحديثه
  for (let i = 0; i < data.length; i++) {
    if (String(data[i]['النوع'] || '').trim() === typeId) {
      const rowNum = i + 2 + getHeaderRowIndex(sheet); // +2 لأن الفهرس يبدأ من 0 والرأس في الصف 1
      sheet.getRange(rowNum, priceCol + 1).setValue(price);
      CacheService.getScriptCache().remove('setupData_exo_v1');
      return jsonResponse({ ok: true });
    }
  }

  // لو مش لاقيه، أضفه جديد
  const typeInfo = DEFAULT_DAILY_LOG_TYPES.find(t => t.id === typeId);
  const name = typeInfo ? typeInfo.name : typeId;
  sheet.appendRow([typeId, name, price, false]);
  CacheService.getScriptCache().remove('setupData_exo_v1');
  return jsonResponse({ ok: true });
}

// ── دالة مساعدة لتنسيق التاريخ ─────────────────────
function formatWafeqDate_(date) {
  if (typeof date === 'string') date = new Date(date);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// ── دالة لتهيئة الشيتات (شغلها مرة واحدة) ───────────
function initializeSheets() {
  getOrCreateUsersSheet();
  getOrCreateDailyLogsSheet();
  getOrCreateDailyLogPricesSheet();
  getOrCreateAdvanceSheet();
  getOrCreateProjectsSheet();
  getOrCreateMaterialsSheet();
  getOrCreateSuppliersSheet();
  console.log('All sheets initialized');
}