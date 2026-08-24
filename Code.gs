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
  phases: 'المراحل',
  advanceMovements: 'سجل حركات العهدة'
};

// قيم بداية فقط (seed) — بعد كده المراحل الفعلية بتتقرا من شيت "المراحل" وتتعدل من غير ما تلمس الكود
const DEFAULT_PHASES = ['فوم', 'رولات', 'أسمنتي', 'دورات مياه'];

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

// امتناع تنفيذ إجراء لو المشرف مش مسموح له بالمشروع ده (لو معاه تقييد أصلاً)
function assertProjectAllowed_(username, project) {
  if (!project) return; // بدون مشروع (زي بند صرف عام) مسموح دايمًا
  if (String(username || '').trim().toLowerCase() === 'admin') return;
  const user = getUserByUsername_(username);
  if (!user) return; // تحوط: لو مش لاقيينه بالاسم سيبها تعدي بدل ما توقف العمل
  if (String(user['role'] || '').toLowerCase() === 'admin') return;
  const assigned = parseProjectsField_(user['المشاريع المخصصة']);
  if (assigned.length === 0) return; // لسه الأدمن ما حددش مشاريع لهذا المشرف = مفيش تقييد
  if (assigned.indexOf(project) === -1) {
    throw new Error('غير مصرح لك بالتسجيل على هذا المشروع');
  }
}

// كل الإجراءات الحساسة (إضافة مشروع، تعديل سعر، إيداع عهدة، تعيين مشاريع) لازم تتأكد إن الطالب أدمن فعلاً
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
  // ContentService مع MIME type JSON - Apps Script بيضيف CORS headers تلقائي لـ "Anyone" access
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doOptions(e) {
  // للـ CORS preflight requests
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

// ── إنشاء الشيتات المطلوبة ─────────────────────────
function getOrCreateUsersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.users);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.users);
    sheet.appendRow(['uid', 'username', 'email', 'role', 'تاريخ الإنشاء', 'الحالة', 'المشاريع المخصصة']);
  } else {
    ensureColumn_(sheet, 'المشاريع المخصصة'); // ترقية تلقائية لو الشيت اتعمل قبل إضافة الميزة دي
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

function getOrCreatePhasesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.phases);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.phases);
    sheet.appendRow(['اسم المرحلة']);
    DEFAULT_PHASES.forEach(p => sheet.appendRow([p]));
  }
  return sheet;
}

function getPhasesList_() {
  try {
    const list = sheetToObjects(getOrCreatePhasesSheet())
      .map(r => String(r['اسم المرحلة'] || '').trim())
      .filter(Boolean);
    return list.length ? list : DEFAULT_PHASES;
  } catch (err) {
    return DEFAULT_PHASES;
  }
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
    if (action === 'getProjectsData') return handleGetProjectsData(e);
    if (action === 'getUserRole') return handleGetUserRole(e);
    if (action === 'getUsers') return handleGetUsers();
    if (action === 'getDailyLogs') return handleGetDailyLogs(e);
    if (action === 'getAdvanceMovements') return handleGetAdvanceMovements(e);

    return jsonResponse({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// دالة لمعالجة طلبات OPTIONS (CORS preflight)
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  // Handle CORS preflight
  if (e && e.postData && e.postData.type === 'options') {
    return jsonResponse({ ok: true });
  }
  
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'logDailyLog') return handleLogDailyLog(body);
    if (action === 'logAdvanceExpense') return handleLogAdvanceExpense(body);
    if (action === 'depositAdvance') return handleDepositAdvance(body);
    if (action === 'registerUser') return handleRegisterUser(body);
    if (action === 'addProject') return handleAddProject(body);
    if (action === 'addProjectPhase') return handleAddProjectPhase(body);
    if (action === 'addPhase') return handleAddPhase(body);
    if (action === 'addDailyLogPrice') return handleAddDailyLogPrice(body);
    if (action === 'updateUserProjects') return handleUpdateUserProjects(body);

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

  let projects = [], projectDates = {}, allProjects = [], projectPhases = {}, dailyLogPrices = {}, phases = [], dailyLogTypes = [];

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

      allProjectsSet[name] = true; // كل المشاريع (حتى لو مش شغالة) — تفيد الأدمن وقت تفعيل مرحلة
      if (!isActive) return;

      const d = p['تاريخ الإضافة'] ? new Date(p['تاريخ الإضافة']) : null;
      if (d && (!newestDate[name] || d > newestDate[name])) newestDate[name] = d;

      // المراحل الشغالة بس بتتضاف لكل مشروع — لو مسحت "شغالة" من الحالة، المرحلة دي بتختفي من هنا تلقائي
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

  // أسعار اليوميات (خريطة للتوافق القديم) + قائمة الأنواع الكاملة (المصدر الفعلي للفورم دلوقتي)
  try {
    dailyLogTypes = getDailyLogTypesList_();
    dailyLogTypes.forEach(t => { dailyLogPrices[t.id] = t.defaultPrice; });
  } catch (err) { console.log('DailyLogPrices Error:', err.message); }

  // المراحل — بتتقرا من شيت "المراحل" فتقدر تضيف/تعدّل من غير ما تلمس الكود
  try {
    phases = getPhasesList_();
  } catch (err) { console.log('Phases Error:', err.message); }

  const result = { projects, projectDates, allProjects, projectPhases, dailyLogPrices, dailyLogTypes, phases };
  cache.put(cacheKey, JSON.stringify(result), 30);
  return jsonResponse(result);
}

function handleGetProjectsData(e) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'projectsData_exo_v1';

  if (e.parameter && e.parameter.refresh) cache.remove(cacheKey);

  const cached = cache.get(cacheKey);
  if (cached) return jsonResponse(JSON.parse(cached));

  let projects = [], projectPhases = {};

  try {
    const projData = sheetToObjects(getOrCreateProjectsSheet());
    const newestDate = {};
    projData.forEach(p => {
      const name = String(p['اسم المشروع'] || '').trim();
      const phase = String(p['المرحلة'] || '').trim();
      const status = String(p['الحالة'] || '').trim();
      if (!name || !status.includes('شغال')) return;
      const d = p['تاريخ الإضافة'] ? new Date(p['تاريخ الإضافة']) : null;
      if (d && (!newestDate[name] || d > newestDate[name])) newestDate[name] = d;
      if (phase && !projectPhases[name]) projectPhases[name] = [];
      if (phase && !projectPhases[name].includes(phase)) projectPhases[name].push(phase);
    });
    projects = Object.keys(newestDate);
  } catch (err) { console.log('Projects Error:', err.message); }

  const result = { projects, projectPhases };
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
    // مصفوفة فاضية = المشرف لسه مالوش تقييد، فبيشوف كل المشاريع
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

  return jsonResponse({
    logs: logs.map(l => ({
      id: l['ID'],
      batchId: l['معرف الدفعة'],
      date: l['التاريخ'],
      project: l['المشروع'],
      phase: l['المرحلة'],
      typeId: l['نوع اليومية'],
      typeName: l['اسم النوع'],
      quantity: l['الكمية'],
      unitPrice: l['سعر الوحدة'],
      totalCost: l['الإجمالي'],
      notes: l['ملاحظات'],
      supervisor: l['المشرف']
    }))
  });
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
    assertProjectAllowed_(body.supervisor, body.project);

    const items = Array.isArray(body.items) && body.items.length
      ? body.items
      : [{ typeId: body.typeId, typeName: body.typeName, quantity: body.quantity, unitPrice: body.unitPrice, totalCost: body.totalCost }];

    if (!items.length || !items[0].typeId) {
      return jsonResponse({ ok: false, error: 'أضف بند واحد على الأقل' });
    }

    const now = new Date();
    const stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
    const id = 'DL-' + stamp + '-' + Math.floor(Math.random() * 1000); // نفس المعرف لكل بنود التسجيل ده — عمود واحد بس

    const rows = items.map(item => ([
      id,
      body.date || now,
      body.project || '',
      body.phase || '',
      item.typeId || '',
      item.typeName || '',
      parseFloat(item.quantity) || 0,
      parseFloat(item.unitPrice) || 0,
      parseFloat(item.totalCost) || 0,
      body.notes || '',
      body.supervisor || '',
      now
    ]));

    const sheet = getOrCreateDailyLogsSheet();
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

    return jsonResponse({ ok: true, id, count: rows.length });
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
    assertProjectAllowed_(supervisor, String(params.project || '').trim());

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
    requireAdmin_(params.recordedBy);
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
  // حماية لو الجسم فاضي أو مش JSON
  if (!body || typeof body !== 'object') {
    return jsonResponse({ ok: false, error: 'بيانات الطلب فاضية أو غير صالحة: ' + JSON.stringify(body) });
  }
  
  const sheet = getOrCreateUsersSheet();
  const role = String(body.username || '').toLowerCase() === 'admin' ? 'admin' : 'supervisor';
  // المشاريع المخصصة: فاضية للإنشاء الجديد (الأدمن يقدر يحددها لاحقاً)
  sheet.appendRow([body.uid || '', body.username || '', body.email || '', role, new Date(), 'نشط', '']);
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

function handleAddProject(body) {
  requireAdmin_(body && body.requesterEmail);
  const name = String((body && body.name) || '').trim();
  if (!name) return jsonResponse({ ok: false, error: 'اسم المشروع مطلوب' });
  const sheet = getOrCreateProjectsSheet();
  const phasesList = getPhasesList_();
  const now = new Date();
  phasesList.forEach(phase => {
    sheet.appendRow([name, phase, 'شغالة', now]);
  });
  CacheService.getScriptCache().remove('setupData_exo_v1');
  return jsonResponse({ ok: true, phases: phasesList.length });
}

// تفعيل مرحلة لمشروع موجود (أو إرجاعها "شغالة" لو كانت متوقفة) — ده اللي بيتحكم في ظهورها لصفحة اليوميات
function handleAddProjectPhase(body) {
  requireAdmin_(body && body.requesterEmail);
  const project = String((body && body.project) || '').trim();
  const phase = String((body && body.phase) || '').trim();
  if (!project || !phase) return jsonResponse({ ok: false, error: 'المشروع والمرحلة مطلوبين' });

  const sheet = getOrCreateProjectsSheet();
  const data = sheetToObjects(sheet);
  const headers = getNormalizedHeaders(sheet);
  const statusCol = headers.indexOf('الحالة');

  // لو نفس المشروع/المرحلة موجودين بالفعل بأي حالة، رجّعها "شغالة" بدل ما تتكرر
  for (let i = 0; i < data.length; i++) {
    if (String(data[i]['اسم المشروع'] || '').trim() === project && String(data[i]['المرحلة'] || '').trim() === phase) {
      const rowNum = i + 2 + getHeaderRowIndex(sheet);
      sheet.getRange(rowNum, statusCol + 1).setValue('شغالة');
      CacheService.getScriptCache().remove('setupData_exo_v1');
      return jsonResponse({ ok: true, reactivated: true });
    }
  }

  sheet.appendRow([project, phase, 'شغالة', new Date()]);
  CacheService.getScriptCache().remove('setupData_exo_v1');
  return jsonResponse({ ok: true });
}

function handleAddPhase(body) {
  requireAdmin_(body && body.requesterEmail);
  const name = String((body && body.name) || '').trim();
  if (!name) return jsonResponse({ ok: false, error: 'اسم المرحلة مطلوب' });

  const existing = getPhasesList_();
  if (existing.indexOf(name) !== -1) {
    return jsonResponse({ ok: false, error: 'المرحلة موجودة بالفعل' });
  }

  getOrCreatePhasesSheet().appendRow([name]);
  CacheService.getScriptCache().remove('setupData_exo_v1');
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

  // البحث عن الصف وتحديثه (لو النوع موجود بالفعل)
  for (let i = 0; i < data.length; i++) {
    if (String(data[i]['النوع'] || '').trim() === typeId) {
      const rowNum = i + 2 + getHeaderRowIndex(sheet); // +2 لأن الفهرس يبدأ من 0 والرأس في الصف 1
      sheet.getRange(rowNum, priceCol + 1).setValue(price);
      if (body && body.name) sheet.getRange(rowNum, nameCol + 1).setValue(String(body.name).trim());
      if (body && typeof body.allowCustomPrice !== 'undefined') {
        sheet.getRange(rowNum, customCol + 1).setValue(!!body.allowCustomPrice);
      }
      CacheService.getScriptCache().remove('setupData_exo_v1');
      return jsonResponse({ ok: true });
    }
  }

  // لو مش لاقيه، أضفه كنوع يومية جديد بالكامل (زي "حداد" مثلاً)
  const name = String((body && body.name) || '').trim() || typeId;
  const allowCustomPrice = !!(body && body.allowCustomPrice);
  sheet.appendRow([typeId, name, price, allowCustomPrice]);
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
  getOrCreatePhasesSheet();
  getOrCreateAdvanceSheet();
  getOrCreateProjectsSheet();
  getOrCreateMaterialsSheet();
  getOrCreateSuppliersSheet();
  console.log('All sheets initialized');
}