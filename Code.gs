/**
 * =============================================
 * نظام EXO - Code.gs للـ Google Apps Script
 * يدير: المستخدمين، المشاريع، اليوميات (بنظام موافقات)، العهد (لكل مشروع شيت منفصل + موافقات)
 * الرتب: admin (مدير) / engineer (مهندس - مكتب فني: يوافق) / supervisor (مشرف: يسجل)
 * =============================================
 */

const SHEET_NAMES = {
  projects: 'بيانات المشاريع',
  users: 'Users',
  dailyLogs: 'سجل اليوميات',              // اليوميات الموافق عليها فقط
  pendingDailyLogs: 'يوميات تحت المراجعة', // اليوميات بانتظار موافقة المهندس
  dailyLogPrices: 'أسعار اليوميات',
  custodyItems: 'بنود العهد',              // البنود اللي المشرف بيختار منها في الفاتورة
  pendingCustody: 'عهد تحت المراجعة',      // فواتير العهد بانتظار موافقة المهندس
  custodyPrefix: 'عهدة - '                 // بادئة شيتات العهد: "عهدة - اسم المشروع"
};

// ضريبة القيمة المضافة 15% — المبلغ المدخل "شامل الضريبة" وبنستخرج منه قيمة الضريبة
const VAT_RATE = 0.15;

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

// حالات الموافقة
const STATUS_PENDING = 'بانتظار الموافقة';
const STATUS_APPROVED = 'موافق عليها';
const STATUS_REJECTED = 'مرفوضة';

// ═══════════════════════════════════════════════════════════
//  دوال مساعدة عامة
// ═══════════════════════════════════════════════════════════

function ensureColumn_(sheet, headerName) {
  const headerIdx = getHeaderRowIndex(sheet);
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(headerIdx + 1, 1, 1, lastCol).getValues()[0].map(normalizeHeader);
  if (headers.indexOf(headerName) === -1) {
    sheet.getRange(headerIdx + 1, lastCol + 1).setValue(headerName);
  }
}

function parseProjectsField_(raw) {
  return String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function getUserByUsername_(username) {
  const users = sheetToObjects(getOrCreateUsersSheet());
  return users.find(u => String(u['username'] || '').trim().toLowerCase() === String(username || '').trim().toLowerCase());
}

// امتناع تنفيذ إجراء لو المشرف مش مسموح له بالمشروع ده (لو معاه تقييد أصلاٌ)
function assertProjectAllowed_(username, project) {
  if (!project) return;
  if (String(username || '').trim().toLowerCase() === 'admin') return;
  const user = getUserByUsername_(username);
  if (!user) return;
  if (String(user['role'] || '').toLowerCase() === 'admin') return;
  const assigned = parseProjectsField_(user['المشاريع المخصصة']);
  if (assigned.length === 0) return;
  if (assigned.indexOf(project) === -1) {
    throw new Error('غير مصرح لك بالتسجيل على هذا المشروع');
  }
}

function isAdminEmail_(email) {
  const username = email ? String(email).split('@')[0].toLowerCase() : '';
  if (username === 'admin') return true;
  const user = getUserByUsername_(username);
  return !!user && String(user['role'] || '').toLowerCase() === 'admin';
}

function requireAdmin_(email) {
  if (!isAdminEmail_(email)) {
    throw new Error('غير مصرح: هذا الإجراء للمدير فقط');
  }
}

// المهندس (المكتب الفني) أو الأدمن — هما اللي يقدروا يوافقوا على اليوميات والعهد
function isApproverEmail_(email) {
  const username = email ? String(email).split('@')[0].toLowerCase() : '';
  if (username === 'admin') return true;
  const user = getUserByUsername_(username);
  if (!user) return false;
  const role = String(user['role'] || '').toLowerCase();
  return role === 'admin' || role === 'engineer';
}

function requireApprover_(email) {
  if (!isApproverEmail_(email)) {
    throw new Error('غير مصرح: هذا الإجراء للمهندس أو المدير فقط');
  }
}

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

function normalizeHeader(h) {
  return String(h).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function getHeaderRowIndexFromValues_(values) {
  for (let i = 0; i < Math.min(5, values.length); i++) {
    if (String(values[i][0]).trim() === 'ID') return i;
  }
  return 0;
}

function getHeaderRowIndex(sheet) {
  return getHeaderRowIndexFromValues_(sheet.getDataRange().getValues());
}

function sheetToObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headerIdx = getHeaderRowIndexFromValues_(values);
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

// تنظيف اسم المشروع عشان يصلح يكون اسم شيت (جوجل شيتس بيمنع : \ / ? * [ ])
function sanitizeSheetName_(name) {
  return String(name || '').replace(/[:\\\/\?\*\[\]]/g, '-').trim().slice(0, 80);
}

// حساب الضريبة: المبلغ المدخل "شامل الضريبة"
// لو فاتورة ضريبية: الضريبة = المبلغ - (المبلغ / 1.15) ، الصافي = المبلغ / 1.15
// لو مش ضريبية: الضريبة = 0 ، الصافي = المبلغ
function calcTax_(amount, isTaxInvoice) {
  const amt = Math.round((parseFloat(amount) || 0) * 100) / 100;
  if (!isTaxInvoice) return { gross: amt, tax: 0, net: amt };
  const net = Math.round((amt / (1 + VAT_RATE)) * 100) / 100;
  const tax = Math.round((amt - net) * 100) / 100;
  return { gross: amt, tax, net };
}

function formatWafeqDate_(date) {
  if (typeof date === 'string') date = new Date(date);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function newId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000);
}

// تفسير قيمة عمود "مطبوعة" (ممكن تتخزن Boolean أو 'TRUE'/'نعم' نصياً)
function isTruthyFlag_(v) {
  if (v === true) return true;
  const s = String(v || '').trim().toLowerCase();
  return s === 'true' || s === 'نعم' || s === '1';
}

// ═══════════════════════════════════════════════════════════
//  إنشاء الشيتات المطلوبة
// ═══════════════════════════════════════════════════════════

function getOrCreateUsersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.users);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.users);
    sheet.appendRow(['uid', 'username', 'email', 'role', 'تاريخ الإنشاء', 'الحالة', 'المشاريع المخصصة']);
  } else {
    ensureColumn_(sheet, 'المشاريع المخصصة');
  }
  return sheet;
}

// اليوميات الموافق عليها (النهائية)
function getOrCreateDailyLogsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.dailyLogs);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.dailyLogs);
    sheet.appendRow(['ID', 'التاريخ', 'المشروع', 'المرحلة', 'نوع اليومية', 'اسم النوع', 'الكمية', 'سعر الوحدة', 'الإجمالي', 'ملاحظات', 'المشرف', 'تاريخ التسجيل', 'مطبوعة']);
  } else {
    ensureColumn_(sheet, 'مطبوعة');
  }
  return sheet;
}

// اليوميات بانتظار الموافقة — نفس أعمدة سجل اليوميات + الحالة + سبب الرفض
function getOrCreatePendingDailyLogsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.pendingDailyLogs);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.pendingDailyLogs);
    sheet.appendRow(['ID', 'التاريخ', 'المشروع', 'المرحلة', 'نوع اليومية', 'اسم النوع', 'الكمية', 'سعر الوحدة', 'الإجمالي', 'ملاحظات', 'المشرف', 'تاريخ التسجيل', 'الحالة', 'سبب الرفض']);
  }
  return sheet;
}

function getOrCreateDailyLogPricesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.dailyLogPrices);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.dailyLogPrices);
    sheet.appendRow(['النوع', 'الاسم', 'السعر الافتراضي', 'يسمح بسعر مخصص']);
    DEFAULT_DAILY_LOG_TYPES.forEach(t => {
      sheet.appendRow([t.id, t.name, t.defaultPrice, t.allowCustomPrice]);
    });
  }
  return sheet;
}

// بنود العهد — قائمة البنود اللي المشرف بيختار منها وقت تسجيل الفاتورة
function getOrCreateCustodyItemsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.custodyItems);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.custodyItems);
    sheet.appendRow(['اسم البند']);
  }
  return sheet;
}

// فواتير العهد بانتظار الموافقة
function getOrCreatePendingCustodySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.pendingCustody);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.pendingCustody);
    sheet.appendRow(['ID', 'التاريخ', 'المشروع', 'القيمة', 'قيمة الضريبة', 'صافي القيمة', 'فاتورة ضريبية', 'رقم الفاتورة', 'المرحلة', 'البند', 'الوصف', 'المشرف', 'تاريخ التسجيل', 'الحالة', 'سبب الرفض']);
  }
  return sheet;
}

// شيت عهدة لكل مشروع على حدة: "عهدة - اسم المشروع"
function getOrCreateProjectCustodySheet(project) {
  const name = SHEET_NAMES.custodyPrefix + sanitizeSheetName_(project);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(['ID', 'التاريخ', 'نوع الحركة', 'القيمة', 'قيمة الضريبة', 'صافي القيمة', 'فاتورة ضريبية', 'رقم الفاتورة', 'المرحلة', 'البند', 'الوصف', 'المشرف', 'المسجل بواسطة', 'تاريخ التسجيل', 'مطبوعة']);
  } else {
    ensureColumn_(sheet, 'مطبوعة');
  }
  return sheet;
}

// بيقرا شيت عهدة المشروع لو موجود فقط (من غير ما ينشئه) — عشان الملخص مايعملش شيتات فاضية
function getProjectCustodySheetIfExists_(project) {
  const name = SHEET_NAMES.custodyPrefix + sanitizeSheetName_(project);
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
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

function getDailyLogTypesList_() {
  try {
    const list = sheetToObjects(getOrCreateDailyLogPricesSheet()).map(row => ({
      id: String(row['النوع'] || '').trim(),
      name: String(row['الاسم'] || '').trim(),
      defaultPrice: parseFloat(row['السعر الافتراضي']) || 0,
      allowCustomPrice: String(row['يسمح بسعر مخصص']).toLowerCase() === 'true' || row['يسمح بسعر مخصص'] === true
    })).filter(t => t.id);
    return list.length ? list : DEFAULT_DAILY_LOG_TYPES;
  } catch (err) {
    return DEFAULT_DAILY_LOG_TYPES;
  }
}

function getCustodyItemsList_() {
  try {
    return sheetToObjects(getOrCreateCustodyItemsSheet())
      .map(r => String(r['اسم البند'] || '').trim())
      .filter(Boolean);
  } catch (err) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
//  الدوال الرئيسية: doGet و doPost
// ═══════════════════════════════════════════════════════════

function doGet(e) {
  const action = e.parameter.action;
  try {
    if (action === 'getSetupData') return handleGetSetupData(e);
    if (action === 'getProjectsData') return handleGetProjectsData(e);
    if (action === 'getUserRole') return handleGetUserRole(e);
    if (action === 'getUsers') return handleGetUsers();
    if (action === 'getDailyLogs') return handleGetDailyLogs(e);
    if (action === 'getMyDailyLogRequests') return handleGetMyDailyLogRequests(e);
    if (action === 'getPendingDailyLogs') return handleGetPendingDailyLogs(e);
    if (action === 'getPendingCustody') return handleGetPendingCustody(e);
    if (action === 'getMyCustodyRequests') return handleGetMyCustodyRequests(e);
    if (action === 'getProjectCustody') return handleGetProjectCustody(e);
    if (action === 'getMyCustodySummary') return handleGetMyCustodySummary(e);
    if (action === 'getCustodyItems') return handleGetCustodyItems();
    return jsonResponse({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    // اليوميات
    if (action === 'logDailyLog') return handleLogDailyLog(body);
    if (action === 'approveDailyLog') return handleApproveDailyLog(body);
    if (action === 'rejectDailyLog') return handleRejectDailyLog(body);
    if (action === 'bulkApproveDailyLogs') return handleBulkApproveDailyLogs(body);
    if (action === 'markDailyLogsPrinted') return handleMarkDailyLogsPrinted(body);

    // العهد
    if (action === 'logCustodyExpense') return handleLogCustodyExpense(body);
    if (action === 'approveCustodyExpense') return handleApproveCustodyExpense(body);
    if (action === 'rejectCustodyExpense') return handleRejectCustodyExpense(body);
    if (action === 'bulkApproveCustody') return handleBulkApproveCustody(body);
    if (action === 'markCustodyPrinted') return handleMarkCustodyPrinted(body);
    if (action === 'depositCustody') return handleDepositCustody(body);
    if (action === 'addCustodyItem') return handleAddCustodyItem(body);

    // المستخدمين والمشاريع
    if (action === 'registerUser') return handleRegisterUser(body);
    if (action === 'addProject') return handleAddProject(body);
    if (action === 'addProjectPhase') return handleAddProjectPhase(body);
    if (action === 'addDailyLogPrice') return handleAddDailyLogPrice(body);
    if (action === 'updateUserProjects') return handleUpdateUserProjects(body);
    if (action === 'setUserRole') return handleSetUserRole(body);

    return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════
//  القراءة (GET)
// ═══════════════════════════════════════════════════════════

// بيانات الإعداد: المشاريع + مراحلها (من بيانات المشاريع فقط) + أنواع اليوميات + بنود العهد
function handleGetSetupData(e) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'setupData_exo_v2';

  if (e.parameter && e.parameter.refresh) cache.remove(cacheKey);

  const cached = cache.get(cacheKey);
  if (cached) return jsonResponse(JSON.parse(cached));

  let projects = [], projectDates = {}, allProjects = [], projectPhases = {}, dailyLogPrices = {}, dailyLogTypes = [], custodyItems = [];

  try {
    const projData = sheetToObjects(getOrCreateProjectsSheet());
    const newestDate = {};
    const allProjectsSet = {};
    const phasesByProject = {};

    projData.forEach(p => {
      const name = String(p['اسم المشروع'] || '').trim();
      const phase = String(p['المرحلة'] || '').trim();
      const isActive = String(p['الحالة'] || '').trim().includes('شغال');
      if (!name) return;

      allProjectsSet[name] = true;
      if (!isActive) return;

      const d = p['تاريخ الإضافة'] ? new Date(p['تاريخ الإضافة']) : null;
      if (d && (!newestDate[name] || d > newestDate[name])) newestDate[name] = d;

      if (phase) {
        if (!phasesByProject[name]) phasesByProject[name] = [];
        if (phasesByProject[name].indexOf(phase) === -1) phasesByProject[name].push(phase);
      }
    });

    projects = Object.keys(newestDate);
    Object.entries(newestDate).forEach(([k, v]) => { projectDates[k] = v.getTime(); });
    allProjects = Object.keys(allProjectsSet);
    projectPhases = phasesByProject;
  } catch (err) { console.log('Projects Error:', err.message); }

  try {
    dailyLogTypes = getDailyLogTypesList_();
    dailyLogTypes.forEach(t => { dailyLogPrices[t.id] = t.defaultPrice; });
  } catch (err) { console.log('DailyLogPrices Error:', err.message); }

  try {
    custodyItems = getCustodyItemsList_();
  } catch (err) { console.log('CustodyItems Error:', err.message); }

  const result = { projects, projectDates, allProjects, projectPhases, dailyLogPrices, dailyLogTypes, custodyItems, vatRate: VAT_RATE };
  cache.put(cacheKey, JSON.stringify(result), 30);
  return jsonResponse(result);
}

// نسخة خفيفة: المشاريع + مراحلها فقط (لسرعة تحميل صفحة اليوميات)
function handleGetProjectsData(e) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'projectsData_exo_v2';
  if (e.parameter && e.parameter.refresh) cache.remove(cacheKey);
  const cached = cache.get(cacheKey);
  if (cached) return jsonResponse(JSON.parse(cached));

  let projects = [], allProjects = [], projectPhases = {};
  try {
    const projData = sheetToObjects(getOrCreateProjectsSheet());
    const newestDate = {};
    const allProjectsSet = {};
    const phasesByProject = {};
    projData.forEach(p => {
      const name = String(p['اسم المشروع'] || '').trim();
      const phase = String(p['المرحلة'] || '').trim();
      const isActive = String(p['الحالة'] || '').trim().includes('شغال');
      if (!name) return;
      allProjectsSet[name] = true;
      if (!isActive) return;
      newestDate[name] = true;
      if (phase) {
        if (!phasesByProject[name]) phasesByProject[name] = [];
        if (phasesByProject[name].indexOf(phase) === -1) phasesByProject[name].push(phase);
      }
    });
    projects = Object.keys(newestDate);
    allProjects = Object.keys(allProjectsSet);
    projectPhases = phasesByProject;
  } catch (err) { console.log('ProjectsData Error:', err.message); }

  const result = { projects, allProjects, projectPhases };
  cache.put(cacheKey, JSON.stringify(result), 30);
  return jsonResponse(result);
}

function handleGetUserRole(e) {
  const email = e.parameter.email;
  const username = email ? email.split('@')[0].toLowerCase() : '';

  if (username === 'admin') return jsonResponse({ role: 'admin', username, active: true, projects: [] });

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

    const role = found['role'] || 'supervisor';
    const projects = role === 'admin' ? [] : parseProjectsField_(found['المشاريع المخصصة']);

    return jsonResponse({ role, username, active: true, projects });
  } catch (err) {
    console.log('getUserRole error:', err.message);
  }

  return jsonResponse({ role: 'supervisor', username, active: true, projects: [] });
}

function handleGetUsers() {
  const users = sheetToObjects(getOrCreateUsersSheet());
  return jsonResponse({
    users: users.map(u => ({
      uid: u['uid'],
      username: u['username'],
      email: u['email'],
      role: u['role'] || 'supervisor',
      status: u['الحالة'] || 'نشط',
      projects: parseProjectsField_(u['المشاريع المخصصة'])
    }))
  });
}

// اليوميات الموافق عليها فقط (من سجل اليوميات)
function handleGetDailyLogs(e) {
  let logs = sheetToObjects(getOrCreateDailyLogsSheet());
  logs.sort((a, b) => new Date(b['التاريخ'] || 0) - new Date(a['التاريخ'] || 0));

  const email = e.parameter.email;
  if (email && email !== 'null' && email !== 'undefined') {
    const username = email.split('@')[0].toLowerCase();
    logs = logs.filter(l => String(l['المشرف'] || '').trim().toLowerCase() === username);
  }

  return jsonResponse({ logs: mapDailyLog_(logs, STATUS_APPROVED) });
}

// طلبات المشرف نفسه (بانتظار الموافقة + المرفوضة) عشان يشوف حالتها
function handleGetMyDailyLogRequests(e) {
  const email = e.parameter.email;
  const username = email ? email.split('@')[0].toLowerCase() : '';
  let logs = sheetToObjects(getOrCreatePendingDailyLogsSheet());
  logs = logs.filter(l => String(l['المشرف'] || '').trim().toLowerCase() === username);
  logs.sort((a, b) => new Date(b['تاريخ التسجيل'] || 0) - new Date(a['تاريخ التسجيل'] || 0));
  return jsonResponse({ logs: mapDailyLog_(logs, null) });
}

// كل اليوميات بانتظار الموافقة (للمهندس/الأدمن)
function handleGetPendingDailyLogs(e) {
  let logs = sheetToObjects(getOrCreatePendingDailyLogsSheet());
  logs = logs.filter(l => String(l['الحالة'] || '').trim() === STATUS_PENDING);
  logs.sort((a, b) => new Date(b['تاريخ التسجيل'] || 0) - new Date(a['تاريخ التسجيل'] || 0));
  return jsonResponse({ logs: mapDailyLog_(logs, STATUS_PENDING) });
}

function mapDailyLog_(logs, forcedStatus) {
  return logs.map(l => ({
    id: l['ID'],
    batchId: l['ID'],
    date: l['التاريخ'],
    project: l['المشروع'],
    phase: l['المرحلة'],
    typeId: l['نوع اليومية'],
    typeName: l['اسم النوع'],
    quantity: l['الكمية'],
    unitPrice: l['سعر الوحدة'],
    totalCost: l['الإجمالي'],
    notes: l['ملاحظات'],
    supervisor: l['المشرف'],
    status: forcedStatus || String(l['الحالة'] || '').trim(),
    rejectReason: l['سبب الرفض'] || '',
    printed: isTruthyFlag_(l['مطبوعة'])
  }));
}

// كل فواتير العهد بانتظار الموافقة (للمهندس/الأدمن)
function handleGetPendingCustody(e) {
  let rows = sheetToObjects(getOrCreatePendingCustodySheet());
  rows = rows.filter(r => String(r['الحالة'] || '').trim() === STATUS_PENDING);
  rows.sort((a, b) => new Date(b['تاريخ التسجيل'] || 0) - new Date(a['تاريخ التسجيل'] || 0));
  return jsonResponse({ items: mapCustodyRow_(rows, STATUS_PENDING) });
}

// طلبات المشرف نفسه (بانتظار الموافقة + المرفوضة) لمشروع معين — عشان يشوف حالتها
function handleGetMyCustodyRequests(e) {
  const email = e.parameter.email;
  const username = email ? email.split('@')[0].toLowerCase() : '';
  const project = String((e.parameter && e.parameter.project) || '').trim();

  let rows = sheetToObjects(getOrCreatePendingCustodySheet());
  rows = rows.filter(r => String(r['المشرف'] || '').trim().toLowerCase() === username);
  if (project) rows = rows.filter(r => String(r['المشروع'] || '').trim() === project);
  rows.sort((a, b) => new Date(b['تاريخ التسجيل'] || 0) - new Date(a['تاريخ التسجيل'] || 0));
  return jsonResponse({ items: mapCustodyRow_(rows, null) });
}

// حركات عهدة مشروع معين (إيداعات + مصروفات موافق عليها) لمشرف معين
function handleGetProjectCustody(e) {
  const project = String((e.parameter && e.parameter.project) || '').trim();
  const supervisor = String((e.parameter && e.parameter.supervisor) || '').trim();
  if (!project) return jsonResponse({ error: 'المشروع مطلوب' });

  let movements = [];
  try {
    const sheet = getProjectCustodySheetIfExists_(project);
    if (sheet) movements = sheetToObjects(sheet);
  } catch (err) {
    movements = [];
  }
  if (supervisor) {
    movements = movements.filter(m => String(m['المشرف'] || '').trim().toLowerCase() === supervisor.toLowerCase());
  }
  movements.sort((a, b) => new Date(b['التاريخ'] || 0) - new Date(a['التاريخ'] || 0));

  const isDeposit = m => String(m['نوع الحركة'] || '').trim() === 'إيداع عهدة';
  const totalDeposit = movements.filter(isDeposit).reduce((s, m) => s + (Number(m['القيمة']) || 0), 0);
  const totalExpense = movements.filter(m => !isDeposit(m)).reduce((s, m) => s + (Number(m['القيمة']) || 0), 0);

  return jsonResponse({
    movements: movements.map(m => ({
      id: m['ID'],
      date: m['التاريخ'],
      type: m['نوع الحركة'],
      amount: m['القيمة'],
      tax: m['قيمة الضريبة'],
      net: m['صافي القيمة'],
      isTax: m['فاتورة ضريبية'],
      invoice: m['رقم الفاتورة'],
      phase: m['المرحلة'],
      item: m['البند'],
      description: m['الوصف'],
      supervisor: m['المشرف'],
      printed: isTruthyFlag_(m['مطبوعة'])
    })),
    summary: {
      totalDeposit: Math.round(totalDeposit * 100) / 100,
      totalExpense: Math.round(totalExpense * 100) / 100,
      remaining: Math.round((totalDeposit - totalExpense) * 100) / 100
    }
  });
}

// ملخص عهد المشرف الحالي عبر كل مشاريعه (للصفحة الرئيسية)
function handleGetMyCustodySummary(e) {
  const email = e.parameter.email;
  const username = email ? email.split('@')[0].toLowerCase() : '';

  // مشاريع المشرف
  let projects = [];
  try {
    const info = sheetToObjects(getOrCreateProjectsSheet());
    const activeSet = {};
    info.forEach(p => {
      if (String(p['الحالة'] || '').trim().includes('شغال')) activeSet[String(p['اسم المشروع'] || '').trim()] = true;
    });
    projects = Object.keys(activeSet);
  } catch (err) { projects = []; }

  const user = getUserByUsername_(username);
  const assigned = user ? parseProjectsField_(user['المشاريع المخصصة']) : [];
  const isAdminRole = user && String(user['role'] || '').toLowerCase() === 'admin';
  if (!isAdminRole && assigned.length) {
    projects = projects.filter(p => assigned.indexOf(p) !== -1);
  }

  const custodies = [];
  projects.forEach(project => {
    try {
      const sheet = getProjectCustodySheetIfExists_(project);
      if (!sheet) return; // المشروع لسه مفيش له شيت عهدة — نتخطاه من غير ما ننشئه
      const movements = sheetToObjects(sheet)
        .filter(m => String(m['المشرف'] || '').trim().toLowerCase() === username);
      const isDeposit = m => String(m['نوع الحركة'] || '').trim() === 'إيداع عهدة';
      const totalDeposit = movements.filter(isDeposit).reduce((s, m) => s + (Number(m['القيمة']) || 0), 0);
      const totalExpense = movements.filter(m => !isDeposit(m)).reduce((s, m) => s + (Number(m['القيمة']) || 0), 0);
      custodies.push({
        project,
        totalDeposit: Math.round(totalDeposit * 100) / 100,
        totalExpense: Math.round(totalExpense * 100) / 100,
        remaining: Math.round((totalDeposit - totalExpense) * 100) / 100
      });
    } catch (err) { /* نتخطى المشروع ده */ }
  });

  return jsonResponse({ custodies });
}

function handleGetCustodyItems() {
  return jsonResponse({ items: getCustodyItemsList_() });
}

function mapCustodyRow_(rows, forcedStatus) {
  return rows.map(r => ({
    id: r['ID'],
    batchId: r['ID'],
    date: r['التاريخ'],
    project: r['المشروع'],
    amount: r['القيمة'],
    tax: r['قيمة الضريبة'],
    net: r['صافي القيمة'],
    isTax: r['فاتورة ضريبية'],
    invoice: r['رقم الفاتورة'],
    phase: r['المرحلة'],
    item: r['البند'],
    description: r['الوصف'],
    supervisor: r['المشرف'],
    status: forcedStatus || String(r['الحالة'] || '').trim(),
    rejectReason: r['سبب الرفض'] || ''
  }));
}

// ═══════════════════════════════════════════════════════════
//  اليوميات (POST)
// ═══════════════════════════════════════════════════════════

// المشرف يسجل يومية → بتروح "يوميات تحت المراجعة" بانتظار موافقة المهندس
function handleLogDailyLog(body) {
  try {
    assertProjectAllowed_(body.supervisor, body.project);

    const items = Array.isArray(body.items) && body.items.length
      ? body.items
      : [{ typeId: body.typeId, typeName: body.typeName, quantity: body.quantity, unitPrice: body.unitPrice, totalCost: body.totalCost }];

    if (!items.length || !items[0].typeId) {
      return jsonResponse({ ok: false, error: 'أضف بند واحد على الأقل' });
    }

    const now = new Date();
    const id = newId_('DL');

    const rows = items.map(item => ([
      id,
      body.date || now,
      body.project || '',
      String(item.phase || body.phase || '').trim(),
      item.typeId || '',
      item.typeName || '',
      parseFloat(item.quantity) || 0,
      parseFloat(item.unitPrice) || 0,
      parseFloat(item.totalCost) || 0,
      body.notes || '',
      body.supervisor || '',
      now,
      STATUS_PENDING,
      ''
    ]));

    const sheet = getOrCreatePendingDailyLogsSheet();
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

    return jsonResponse({ ok: true, id, count: rows.length, status: STATUS_PENDING });
  } catch (err) {
    return jsonResponse({ ok: false, error: 'خطأ: ' + err.message });
  }
}

// المهندس/الأدمن يوافق على دفعة يوميات → تنتقل من "تحت المراجعة" إلى "سجل اليوميات"
// (منطق أساسي قابل لإعادة الاستخدام في الموافقة المفردة والموافقة الجماعية)
function approveDailyLogCore_(batchId) {
  batchId = String(batchId || '').trim();
  if (!batchId) return { ok: false, error: 'معرف الدفعة مطلوب' };

  const pendingSheet = getOrCreatePendingDailyLogsSheet();
  const values = pendingSheet.getDataRange().getValues();
  const headerIdx = getHeaderRowIndex(pendingSheet);

  // نجمع صفوف الدفعة (أول 12 عمود = أعمدة سجل اليوميات + عمود "مطبوعة" فاضي)
  const rowsToMove = [];
  const rowNumbers = [];
  for (let i = headerIdx + 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === batchId) {
      rowsToMove.push(values[i].slice(0, 12).concat(['']));
      rowNumbers.push(i + 1);
    }
  }
  if (!rowsToMove.length) return { ok: false, error: 'الدفعة غير موجودة: ' + batchId };

  const logSheet = getOrCreateDailyLogsSheet();
  logSheet.getRange(logSheet.getLastRow() + 1, 1, rowsToMove.length, rowsToMove[0].length).setValues(rowsToMove);

  // حذف الصفوف من تحت المراجعة (من الأسفل للأعلى عشان الفهرسة)
  rowNumbers.sort((a, b) => b - a).forEach(rn => pendingSheet.deleteRow(rn));

  return { ok: true, count: rowsToMove.length };
}

function handleApproveDailyLog(body) {
  try {
    requireApprover_(body && body.approverEmail);
    return jsonResponse(approveDailyLogCore_(body && body.batchId));
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// موافقة جماعية على أكتر من دفعة يوميات مرة واحدة (لتسريع مراجعة المهندس)
function handleBulkApproveDailyLogs(body) {
  try {
    requireApprover_(body && body.approverEmail);
    const batchIds = Array.isArray(body && body.batchIds) ? body.batchIds : [];
    if (!batchIds.length) return jsonResponse({ ok: false, error: 'لا توجد دفعات محددة' });

    let approved = 0;
    const failed = [];
    batchIds.forEach(id => {
      const r = approveDailyLogCore_(id);
      if (r.ok) approved += r.count; else failed.push({ batchId: id, error: r.error });
    });
    return jsonResponse({ ok: true, approved, batches: batchIds.length - failed.length, failed });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// المشرف يعلّم دفعات يوميات معينة كـ "مطبوعة" (بعد ما يطبعها/يسلّمها) عشان
// طباعة السجل الجاية تعرض بس اليوميات الجديدة اللي لسه ما اتطبعتش
function handleMarkDailyLogsPrinted(body) {
  try {
    const ids = Array.isArray(body && body.ids) ? body.ids.map(String) : [];
    if (!ids.length) return jsonResponse({ ok: false, error: 'لا توجد يوميات لتعليمها' });

    const sheet = getOrCreateDailyLogsSheet();
    const headers = getNormalizedHeaders(sheet);
    const idCol = headers.indexOf('ID');
    const printedCol = headers.indexOf('مطبوعة');
    const headerIdx = getHeaderRowIndex(sheet);
    const values = sheet.getDataRange().getValues();

    let count = 0;
    for (let i = headerIdx + 1; i < values.length; i++) {
      if (ids.indexOf(String(values[i][idCol]).trim()) !== -1) {
        sheet.getRange(i + 1, printedCol + 1).setValue(true);
        count++;
      }
    }
    return jsonResponse({ ok: true, count });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// المهندس/الأدمن يرفض دفعة يوميات
function handleRejectDailyLog(body) {
  try {
    requireApprover_(body && body.approverEmail);
    const batchId = String((body && body.batchId) || '').trim();
    if (!batchId) return jsonResponse({ ok: false, error: 'معرف الدفعة مطلوب' });
    const reason = String((body && body.reason) || '').trim();

    const pendingSheet = getOrCreatePendingDailyLogsSheet();
    const values = pendingSheet.getDataRange().getValues();
    const headerIdx = getHeaderRowIndex(pendingSheet);
    const headers = getNormalizedHeaders(pendingSheet);
    const statusCol = headers.indexOf('الحالة');
    const reasonCol = headers.indexOf('سبب الرفض');

    let count = 0;
    for (let i = headerIdx + 1; i < values.length; i++) {
      if (String(values[i][0]).trim() === batchId) {
        pendingSheet.getRange(i + 1, statusCol + 1).setValue(STATUS_REJECTED);
        if (reason) pendingSheet.getRange(i + 1, reasonCol + 1).setValue(reason);
        count++;
      }
    }
    if (!count) return jsonResponse({ ok: false, error: 'الدفعة غير موجودة' });
    return jsonResponse({ ok: true, count });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════
//  العهد (POST)
// ═══════════════════════════════════════════════════════════

// المشرف يسجل فواتير عهدة (سلة) → بتروح "عهد تحت المراجعة" بانتظار الموافقة
function handleLogCustodyExpense(body) {
  try {
    const supervisor = String(body.supervisor || '').trim();
    const project = String(body.project || '').trim();
    if (!supervisor) return jsonResponse({ ok: false, error: 'المشرف مطلوب' });
    if (!project) return jsonResponse({ ok: false, error: 'المشروع مطلوب' });
    assertProjectAllowed_(supervisor, project);

    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return jsonResponse({ ok: false, error: 'أضف فاتورة واحدة على الأقل' });

    const now = new Date();
    const id = newId_('CUS');

    const rows = items.map(it => {
      const isTax = !!it.isTax;
      const t = calcTax_(it.amount, isTax);
      return [
        id,
        it.date || formatWafeqDate_(now),
        project,
        t.gross,
        t.tax,
        t.net,
        isTax ? 'نعم' : 'لا',
        String(it.invoice || '').trim(),
        String(it.phase || '').trim(),
        String(it.item || '').trim(),
        String(it.description || '').trim(),
        supervisor,
        now,
        STATUS_PENDING,
        ''
      ];
    });

    const sheet = getOrCreatePendingCustodySheet();
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

    return jsonResponse({ ok: true, id, count: rows.length, status: STATUS_PENDING });
  } catch (err) {
    return jsonResponse({ ok: false, error: 'خطأ: ' + err.message });
  }
}

// المهندس/الأدمن يوافق على دفعة فواتير عهدة → تنتقل لشيت عهدة المشروع
// (منطق أساسي قابل لإعادة الاستخدام في الموافقة المفردة والموافقة الجماعية)
function approveCustodyCore_(batchId, approverEmail) {
  batchId = String(batchId || '').trim();
  if (!batchId) return { ok: false, error: 'معرف الدفعة مطلوب' };

  const pendingSheet = getOrCreatePendingCustodySheet();
  const values = pendingSheet.getDataRange().getValues();
  const headerIdx = getHeaderRowIndex(pendingSheet);

  const rowsToMove = [];
  const rowNumbers = [];
  let project = '';
  for (let i = headerIdx + 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === batchId) {
      project = String(values[i][2]).trim(); // عمود المشروع
      rowsToMove.push(values[i]);
      rowNumbers.push(i + 1);
    }
  }
  if (!rowsToMove.length) return { ok: false, error: 'الدفعة غير موجودة: ' + batchId };
  if (!project) return { ok: false, error: 'المشروع غير محدد في الدفعة' };

  // تحويل الصفوف لتنسيق شيت عهدة المشروع:
  // [ID, التاريخ, نوع الحركة, القيمة, قيمة الضريبة, صافي القيمة, فاتورة ضريبية, رقم الفاتورة, المرحلة, البند, الوصف, المشرف, المسجل بواسطة, تاريخ التسجيل, مطبوعة]
  const approver = String(approverEmail || '').split('@')[0];
  const custodyRows = rowsToMove.map(r => ([
    r[0], r[1], 'صرف', r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], approver, new Date(), ''
  ]));

  const custodySheet = getOrCreateProjectCustodySheet(project);
  custodySheet.getRange(custodySheet.getLastRow() + 1, 1, custodyRows.length, custodyRows[0].length).setValues(custodyRows);

  rowNumbers.sort((a, b) => b - a).forEach(rn => pendingSheet.deleteRow(rn));

  return { ok: true, count: custodyRows.length, project };
}

function handleApproveCustodyExpense(body) {
  try {
    requireApprover_(body && body.approverEmail);
    return jsonResponse(approveCustodyCore_(body && body.batchId, body && body.approverEmail));
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// موافقة جماعية على أكتر من دفعة فواتير عهدة مرة واحدة
function handleBulkApproveCustody(body) {
  try {
    requireApprover_(body && body.approverEmail);
    const batchIds = Array.isArray(body && body.batchIds) ? body.batchIds : [];
    if (!batchIds.length) return jsonResponse({ ok: false, error: 'لا توجد دفعات محددة' });

    let approved = 0;
    const failed = [];
    batchIds.forEach(id => {
      const r = approveCustodyCore_(id, body.approverEmail);
      if (r.ok) approved += r.count; else failed.push({ batchId: id, error: r.error });
    });
    return jsonResponse({ ok: true, approved, batches: batchIds.length - failed.length, failed });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// المشرف يعلّم حركات عهدة معينة كـ "مطبوعة" (بعد ما يطبعها ويسلّمها للمحاسب)
// عشان طباعة كشف الحساب الجاية تعرض بس الحركات الجديدة اللي لسه ما اتطبعتش
function handleMarkCustodyPrinted(body) {
  try {
    const project = String((body && body.project) || '').trim();
    const ids = Array.isArray(body && body.ids) ? body.ids.map(String) : [];
    if (!project) return jsonResponse({ ok: false, error: 'المشروع مطلوب' });
    if (!ids.length) return jsonResponse({ ok: false, error: 'لا توجد حركات لتعليمها' });

    const sheet = getOrCreateProjectCustodySheet(project);
    const headers = getNormalizedHeaders(sheet);
    const idCol = headers.indexOf('ID');
    const printedCol = headers.indexOf('مطبوعة');
    const headerIdx = getHeaderRowIndex(sheet);
    const values = sheet.getDataRange().getValues();

    let count = 0;
    for (let i = headerIdx + 1; i < values.length; i++) {
      if (ids.indexOf(String(values[i][idCol]).trim()) !== -1) {
        sheet.getRange(i + 1, printedCol + 1).setValue(true);
        count++;
      }
    }
    return jsonResponse({ ok: true, count });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// المهندس/الأدمن يرفض دفعة فواتير عهدة
function handleRejectCustodyExpense(body) {
  try {
    requireApprover_(body && body.approverEmail);
    const batchId = String((body && body.batchId) || '').trim();
    if (!batchId) return jsonResponse({ ok: false, error: 'معرف الدفعة مطلوب' });
    const reason = String((body && body.reason) || '').trim();

    const pendingSheet = getOrCreatePendingCustodySheet();
    const values = pendingSheet.getDataRange().getValues();
    const headerIdx = getHeaderRowIndex(pendingSheet);
    const headers = getNormalizedHeaders(pendingSheet);
    const statusCol = headers.indexOf('الحالة');
    const reasonCol = headers.indexOf('سبب الرفض');

    let count = 0;
    for (let i = headerIdx + 1; i < values.length; i++) {
      if (String(values[i][0]).trim() === batchId) {
        pendingSheet.getRange(i + 1, statusCol + 1).setValue(STATUS_REJECTED);
        if (reason) pendingSheet.getRange(i + 1, reasonCol + 1).setValue(reason);
        count++;
      }
    }
    if (!count) return jsonResponse({ ok: false, error: 'الدفعة غير موجودة' });
    return jsonResponse({ ok: true, count });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// الأدمن يودع مباشرة في عهدة مشروع لمشرف (من غير موافقة)
function handleDepositCustody(body) {
  try {
    requireAdmin_(body && body.recordedBy);
    const amount = parseFloat(body.amount) || 0;
    if (amount <= 0) return jsonResponse({ ok: false, error: 'المبلغ غير صحيح' });
    const supervisor = String(body.supervisor || '').trim();
    const project = String(body.project || '').trim();
    if (!supervisor) return jsonResponse({ ok: false, error: 'المشرف مطلوب' });
    if (!project) return jsonResponse({ ok: false, error: 'المشروع مطلوب' });

    const id = newId_('DEP');
    getOrCreateProjectCustodySheet(project).appendRow([
      id,
      formatWafeqDate_(body.date || new Date()),
      'إيداع عهدة',
      Math.round(amount * 100) / 100,
      0,
      Math.round(amount * 100) / 100,
      'لا',
      '',
      '',
      '',
      String(body.description || '').trim(),
      supervisor,
      String(body.recordedBy || '').trim(),
      new Date(),
      ''
    ]);
    return jsonResponse({ ok: true, id });
  } catch (err) {
    return jsonResponse({ ok: false, error: 'خطأ: ' + err.message });
  }
}

// الأدمن يضيف بند جديد لبنود العهد
function handleAddCustodyItem(body) {
  try {
    requireAdmin_(body && body.requesterEmail);
    const name = String((body && body.name) || '').trim();
    if (!name) return jsonResponse({ ok: false, error: 'اسم البند مطلوب' });

    const existing = getCustodyItemsList_();
    if (existing.indexOf(name) !== -1) return jsonResponse({ ok: false, error: 'البند موجود بالفعل' });

    getOrCreateCustodyItemsSheet().appendRow([name]);
    CacheService.getScriptCache().remove('setupData_exo_v2');
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════
//  المستخدمين والمشاريع (POST)
// ═══════════════════════════════════════════════════════════

function handleRegisterUser(body) {
  const sheet = getOrCreateUsersSheet();
  const uid = String((body && body.uid) || '').trim();
  const username = String((body && body.username) || '').trim();
  const email = String((body && body.email) || '').trim();
  const role = username.toLowerCase() === 'admin' ? 'admin' : 'supervisor';

  const existing = sheetToObjects(sheet).find(u =>
    (uid && String(u['uid'] || '').trim() === uid) ||
    (username && String(u['username'] || '').trim().toLowerCase() === username.toLowerCase())
  );
  if (existing) {
    return jsonResponse({ ok: true, role: existing['role'] || role, alreadyExists: true });
  }

  sheet.appendRow([uid, username, email, role, new Date(), 'نشط', '']);
  return jsonResponse({ ok: true, role });
}

function handleUpdateUserProjects(body) {
  try {
    requireAdmin_(body && body.requesterEmail);
    const username = String((body && body.username) || '').trim();
    if (!username) return jsonResponse({ ok: false, error: 'اسم المشرف مطلوب' });

    const projectsList = Array.isArray(body.projects) ? body.projects : [];
    const cleanProjects = projectsList.map(p => String(p).trim()).filter(Boolean);

    const sheet = getOrCreateUsersSheet();
    const headerIdx = getHeaderRowIndex(sheet);
    const headers = getNormalizedHeaders(sheet);
    const usernameCol = headers.indexOf('username');
    const projectsCol = headers.indexOf('المشاريع المخصصة');
    const values = sheet.getDataRange().getValues();

    for (let i = headerIdx + 1; i < values.length; i++) {
      if (String(values[i][usernameCol] || '').trim().toLowerCase() === username.toLowerCase()) {
        sheet.getRange(i + 1, projectsCol + 1).setValue(cleanProjects.join(', '));
        return jsonResponse({ ok: true });
      }
    }
    return jsonResponse({ ok: false, error: 'المشرف غير موجود' });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// الأدمن يغيّر رتبة مستخدم (supervisor <-> engineer) عشان يحدد مين المهندس اللي يوافق
function handleSetUserRole(body) {
  try {
    requireAdmin_(body && body.requesterEmail);
    const username = String((body && body.username) || '').trim();
    const role = String((body && body.role) || '').trim().toLowerCase();
    if (!username) return jsonResponse({ ok: false, error: 'اسم المستخدم مطلوب' });
    if (['supervisor', 'engineer'].indexOf(role) === -1) return jsonResponse({ ok: false, error: 'الرتبة غير صالحة' });

    const sheet = getOrCreateUsersSheet();
    const headerIdx = getHeaderRowIndex(sheet);
    const headers = getNormalizedHeaders(sheet);
    const usernameCol = headers.indexOf('username');
    const roleCol = headers.indexOf('role');
    const values = sheet.getDataRange().getValues();

    for (let i = headerIdx + 1; i < values.length; i++) {
      if (String(values[i][usernameCol] || '').trim().toLowerCase() === username.toLowerCase()) {
        sheet.getRange(i + 1, roleCol + 1).setValue(role);
        return jsonResponse({ ok: true });
      }
    }
    return jsonResponse({ ok: false, error: 'المستخدم غير موجود' });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// إضافة مشروع جديد — بقا من غير شيت "المراحل": المشروع بيتضاف بصف واحد من غير مرحلة،
// والأدمن يضيف المراحل بعدين من "تفعيل مرحلة لمشروع"
function handleAddProject(body) {
  requireAdmin_(body && body.requesterEmail);
  const name = String((body && body.name) || '').trim();
  if (!name) return jsonResponse({ ok: false, error: 'اسم المشروع مطلوب' });

  const sheet = getOrCreateProjectsSheet();
  const exists = sheetToObjects(sheet).some(p => String(p['اسم المشروع'] || '').trim() === name);
  if (exists) return jsonResponse({ ok: false, error: 'المشروع موجود بالفعل' });

  sheet.appendRow([name, '', 'شغالة', new Date()]);
  CacheService.getScriptCache().remove('setupData_exo_v2');
  CacheService.getScriptCache().remove('projectsData_exo_v2');
  return jsonResponse({ ok: true });
}

// تفعيل مرحلة لمشروع — بتتضاف مباشرة في "بيانات المشاريع" وتظهر فوراً (بنمسح الكاش)
function handleAddProjectPhase(body) {
  requireAdmin_(body && body.requesterEmail);
  const project = String((body && body.project) || '').trim();
  const phase = String((body && body.phase) || '').trim();
  if (!project || !phase) return jsonResponse({ ok: false, error: 'المشروع والمرحلة مطلوبين' });

  const sheet = getOrCreateProjectsSheet();
  const data = sheetToObjects(sheet);
  const headers = getNormalizedHeaders(sheet);
  const statusCol = headers.indexOf('الحالة');

  for (let i = 0; i < data.length; i++) {
    if (String(data[i]['اسم المشروع'] || '').trim() === project && String(data[i]['المرحلة'] || '').trim() === phase) {
      const rowNum = i + 2 + getHeaderRowIndex(sheet);
      sheet.getRange(rowNum, statusCol + 1).setValue('شغالة');
      CacheService.getScriptCache().remove('setupData_exo_v2');
      CacheService.getScriptCache().remove('projectsData_exo_v2');
      return jsonResponse({ ok: true, reactivated: true });
    }
  }

  sheet.appendRow([project, phase, 'شغالة', new Date()]);
  CacheService.getScriptCache().remove('setupData_exo_v2');
  CacheService.getScriptCache().remove('projectsData_exo_v2');
  return jsonResponse({ ok: true });
}

function handleAddDailyLogPrice(body) {
  requireAdmin_(body && body.requesterEmail);
  const typeId = String((body && body.typeId) || '').trim();
  const price = parseFloat((body && body.price)) || 0;
  if (!typeId) return jsonResponse({ ok: false, error: 'نوع اليومية مطلوب' });

  const sheet = getOrCreateDailyLogPricesSheet();
  const data = sheetToObjects(sheet);
  const headers = getNormalizedHeaders(sheet);
  const priceCol = headers.indexOf('السعر الافتراضي');
  const nameCol = headers.indexOf('الاسم');
  const customCol = headers.indexOf('يسمح بسعر مخصص');

  for (let i = 0; i < data.length; i++) {
    if (String(data[i]['النوع'] || '').trim() === typeId) {
      const rowNum = i + 2 + getHeaderRowIndex(sheet);
      sheet.getRange(rowNum, priceCol + 1).setValue(price);
      if (body && body.name) sheet.getRange(rowNum, nameCol + 1).setValue(String(body.name).trim());
      if (body && typeof body.allowCustomPrice !== 'undefined') {
        sheet.getRange(rowNum, customCol + 1).setValue(!!body.allowCustomPrice);
      }
      CacheService.getScriptCache().remove('setupData_exo_v2');
      return jsonResponse({ ok: true });
    }
  }

  const name = String((body && body.name) || '').trim() || typeId;
  const allowCustomPrice = !!(body && body.allowCustomPrice);
  sheet.appendRow([typeId, name, price, allowCustomPrice]);
  CacheService.getScriptCache().remove('setupData_exo_v2');
  return jsonResponse({ ok: true });
}

// ── دالة لتهيئة الشيتات (شغلها مرة واحدة) ───────────
function initializeSheets() {
  getOrCreateUsersSheet();
  getOrCreateDailyLogsSheet();
  getOrCreatePendingDailyLogsSheet();
  getOrCreateDailyLogPricesSheet();
  getOrCreateCustodyItemsSheet();
  getOrCreatePendingCustodySheet();
  getOrCreateProjectsSheet();
  console.log('All sheets initialized');
}
