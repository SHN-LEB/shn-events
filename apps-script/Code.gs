/**
 * SHN LEB Events Portal — back office (Google Apps Script)
 *
 * The web app on GitHub Pages talks only to this script. The script owns:
 *   - the master sheet  "SHN LEB Events — Master"  (events list + settings)
 *   - one Google Sheet per event, created in the events Drive folder
 *
 * First-time setup: run setup() once from the Apps Script editor, then deploy
 * as a Web app (Execute as: Me, Who has access: Anyone). See README.md.
 */

const APP_VERSION = '1.9.0';

/* Drive folder that holds the master sheet and every event sheet.
   Leave empty to have setup() create a "SHN Events" folder in My Drive. */
const EVENTS_FOLDER_ID = '1JkQzc0GkBpx6OvErqHcBe2VYljxhtjxh';
const TOKEN_HOURS = 12;
const STAFF_TOKEN_HOURS = 16;
const VAT_PCT = 11;   // prices include VAT; the VAT column is for reporting only
const LBP_STEP = 5000; // LBP change is rounded to this step

const MASTER_TABS = {
  Events: ['Event ID', 'Name', 'Type', 'Venue', 'Start Date', 'End Date', 'Status', 'Sheet URL', 'Sheet ID', 'Created At',
    'Info (app)', 'Break-even (app)', 'Copy From', 'Days Sold', 'Avg Units / Day', 'Avg Sales / Day', 'Learnings (app)'],
  Settings: ['Setting', 'Value', 'Notes']
};

const MASTER_SETTINGS = [
  ['ADMIN_PASSWORD', 'change-me', 'Password for management. Change it now.'],
  ['CATALOG_SHEET_ID', '1BYe78W9HkYqhN19iT2iyyKyKnBdjnNSSi29zfg62aO0', 'SHN Catalogue (read only)'],
  ['COGS_PCT', 35, 'COGS as % of selling price. Copied into each new event and locked there'],
  ['DEFAULT_FX_RATE', 89500, 'LBP per USD, copied into each new event'],
  ['DEFAULT_MAX_DISCOUNT_PCT', 20, 'Highest discount % a cashier can enter, copied into each new event'],
  ['DEFAULT_OPENING_CASH_USD', 0, 'Copied into each new event'],
  ['DEFAULT_OPENING_CASH_LBP', 0, 'Copied into each new event'],
  ['MANAGER_PIN', '1234', 'Manager PIN for big returns and discounts above the max. Copied into each new event (changeable there). Change it now'],
  ['RETURN_APPROVAL_USD', 51, 'Returns above this amount (USD) need the manager PIN'],
  ['COMMISSION_THRESHOLD', 30, 'Price (USD) from which the higher commission applies. Copied into each new event'],
  ['CASH_WARN_USD', 250, 'Warn when the drawer holds more than this (USD)'],
  ['CASH_WARN_LBP', 3000000, 'Warn when the drawer holds more than this (LBP)'],
  ['DEFAULT_STAFF_RATE', 3, 'Hourly rate (USD) suggested in the break-even simulation'],
  ['WHISH_PAY_LINK', 'https://whish.money/app/pay/WttWZdc0D', 'Link inside the Whish QR code shown for online payments. Paste a new link to change the QR; leave empty to hide the Whish button'],
  ['SHOP_DOMAIN', 'superheatedneurons.com', 'Website the POS takes product pictures from (matched by SKU = Ref Code)'],
  ['TRACKER_COUNTRY', 'LEB', 'Sales Tracker tab: Country'],
  ['TRACKER_CHANNEL', 'Community', 'Sales Tracker tab: Channel'],
  ['TRACKER_CHANNEL_TYPE', 'Events', 'Sales Tracker tab: Channel Type'],
  ['TRACKER_WAREHOUSE', 'Monte Verde WH', 'Sales Tracker tab: Warehouse'],
  ['EXPENSE_TYPES', 'Rent, Transport, Bags, Marketing, Ops, Other', 'Expense types offered in the app (comma separated)'],
  ['EVENT_EXCLUDED_PRODUCT_LINES', 'Accessories, (Blank), CTT, Display Stands, Events, Giant Games, Merchandizing, Ops, Rebates', 'Catalogue product lines left out of event catalogues. Comma separated; (Blank) = no product line']
];

/* Catalogue columns, matched by header name (case and spaces ignored) */
const CATALOG_COLS = {
  ref: 'Ref Code',
  name: 'Product Description',
  line: 'Product Line',
  family: 'Game Family',
  price: 'SHN Price (Leb) TTC USD'
};
const MAX_ROWS = 1000; // rows prepared with dropdowns and formulas in event tabs

const EVENT_TYPES = ['Sales', 'Awareness'];

/* Every tab of an event sheet. '' leaves an empty separator column between blocks.
   Settings: A-C event settings, E-I staff list, K-O this event's catalogue.
   (Events created before v1.8 have a Threshold column in the staff list and the catalogue in L-P: still read.)
   Listing:  A-G products from the catalogue, I-K tools & materials (management only), M-V external products,
             X all product names (hidden helper). */
const STAFF_COL = 5;      // Settings!E
const CATALOG_COL = 11;   // Settings!K
const MAT_COL = 9;        // Listing!I
const CONS_COL = 13;      // Listing!M
const ALL_NAMES_COL = 24; // Listing!X
/* Colour per column group: [tab, first col, last col, header colour, body colour] */
const BLOCK_COLORS = [
  ['Settings', 1, 3, '#d9d9d9', '#f3f3f3'],                                   // event settings: grey
  ['Settings', STAFF_COL, STAFF_COL + 4, '#c9daf8', '#eef4fd'],               // staff: blue
  ['Settings', CATALOG_COL, CATALOG_COL + 4, '#d9ead3', '#f1f8ee'],           // catalogue: green
  ['Listing', 1, 4, '#a4c2f4', '#c9daf8'],                                    // products, automatic part: darker blue
  ['Listing', 5, 7, '#c9daf8', '#eef4fd'],                                    // products: blue
  ['Listing', MAT_COL, MAT_COL + 2, '#d9d2e9', '#f4f1fa'],                    // tools & materials: purple
  ['Listing', CONS_COL, CONS_COL + 9, '#fce5cd', '#fef5ec'],                  // external products: orange
  ['Stock Moves', 1, 5, '#d9ead3', '#f1f8ee']                                 // stock moves: green
];
/* Columns filled by formulas: shown in grey italic so nobody types in them */
const AUTO_COLS = [['Listing', 1, 4], ['Stock Moves', 2, 2]];

const DAYS_HEADERS = ['Day', 'Date', 'Opened At', 'Opened By', 'Closed At', 'Closed By', 'Opening Cash Diff USD', 'Opening Cash Diff LBP', 'Opening Stock Diff (units)', 'Closing Cash Diff USD', 'Closing Cash Diff LBP', 'Closing Stock Diff (units)', 'Cash Variance During Day USD', 'Cash Variance During Day LBP', 'Stock Variance During Day (units)', 'Demo Units Missing (closing)', 'Sales (USD)', 'Online (USD)', 'Units Sold', 'Status', 'Day Notes', 'Demo Plays', 'Customers Activated'];
const CUSTOMERS_HEADERS = ['Customer ID', 'Added At', 'Name', 'Phone', 'Email', 'Note', 'Sale ID', 'Added By', 'Day'];
const REFILLS_HEADERS = ['Request ID', 'Requested At', 'Requested By', 'Ref Code', 'Product', 'Qty', 'Note', 'Day', 'Status'];
const DEMOS_HEADERS = ['Entry ID', 'Saved At', 'Day', 'Ref Code', 'Product', 'Plays', 'Saved By'];
/* tabs added after v1.7: created on first use in older event sheets */
const LATE_TABS = { Customers: CUSTOMERS_HEADERS, Refills: REFILLS_HEADERS, Demos: DEMOS_HEADERS };

const EVENT_TABS = [
  ['Settings', ['Setting', 'Value', 'Notes', '',
    'Staff Name', 'Hourly Rate (USD)', 'Commission Under Threshold (USD/item)', 'Commission At/Over Threshold (USD/item)', 'Active (Y/N)', '',
    'Catalogue: Product', 'Ref Code', 'Price (USD)', 'Category', 'Game Family']],
  ['Listing', ['Ref Code', 'Category', 'Game Family', 'Price (USD)', 'Product', 'Opening Qty', 'Demo Qty', '',
    'Tools & Materials', 'Qty', 'Notes', '',
    'External Product', 'Ref Code', 'Category', 'Price (USD)', 'Opening Qty', 'Demo Qty', 'Partner', 'Pay Type (Fixed/%)', 'Pay Value', 'Picture URL', '',
    'All Products (auto)']],
  ['Stock Moves', ['Date', 'Ref Code', 'Product', 'Qty (+refill / -return)', 'Note']],
  ['Sales', ['Sale ID', 'Line', 'Date', 'Time', 'Seller', 'Ref Code', 'Product', 'Category', 'Qty', 'Unit Price (USD)', 'Discount %', 'Line Total (USD)', 'Payment Method', 'Online (USD)', 'Received USD', 'Received LBP', 'Change USD', 'Change LBP', 'Rounding (USD)', 'VAT (USD)', 'Void', 'Void Reason', 'Logged At', 'Note', 'Return Of']],
  ['Shifts', ['Date', 'Employee', 'Clock In', 'Clock Out', 'Hours', 'Note']],
  ['Cash', ['Entry ID', 'Date Time', 'Kind', 'USD', 'LBP', 'Counted / Handed By', 'Handed To', 'Note', 'Expected USD', 'Expected LBP', 'Diff USD', 'Diff LBP', 'Purpose', 'Day', 'Banknotes']],
  ['Counts', ['Count ID', 'Counted At', 'Ref Code', 'Product', 'Expected Sellable', 'Counted Sellable', 'Diff Sellable', 'Expected Demo', 'Counted Demo', 'Diff Demo', 'Counted By', 'Purpose', 'Day']],
  ['Days', DAYS_HEADERS],
  ['Expenses', ['Expense ID', 'Date', 'Type', 'Description', 'Amount USD', 'Amount LBP', 'Total USD', 'Added At']],
  ['Customers', CUSTOMERS_HEADERS],
  ['Refills', REFILLS_HEADERS],
  ['Demos', DEMOS_HEADERS],
  ['P&L', ['Line', 'USD']],
  ['Sales Tracker', ['Date', 'Product Code', 'Description', 'Qty', 'Total Sales $', 'Country', 'Channel', 'Channel Type', 'Warehouse', 'Delivered by', 'Sales Date', 'Invoice Date', 'Invoice number', 'Parent Account', 'Customer', 'Branch', 'Product Ref.', 'Description', 'Quantity', 'Unit Amount HT (Invoiced)', 'Currency', 'Total Amount HT (Invoiced)', 'Total VAT (Invoiced)']]
];

/* ------------------------------------------------------------------ setup */

function setup() {
  const props = PropertiesService.getScriptProperties();

  let folder = null;
  if (EVENTS_FOLDER_ID && props.getProperty('FOLDER_ID') !== EVENTS_FOLDER_ID) {
    folder = DriveApp.getFolderById(EVENTS_FOLDER_ID); // fails clearly if the account can't open it
    props.setProperty('FOLDER_ID', EVENTS_FOLDER_ID);
  }
  const folderId = props.getProperty('FOLDER_ID');
  if (folderId) { try { folder = DriveApp.getFolderById(folderId); } catch (e) { folder = null; } }
  if (!folder) {
    folder = DriveApp.createFolder('SHN LEB Events');
    props.setProperty('FOLDER_ID', folder.getId());
  }

  let master = null;
  const masterId = props.getProperty('MASTER_ID');
  if (masterId) { try { master = SpreadsheetApp.openById(masterId); } catch (e) { master = null; } }
  if (!master) {
    master = SpreadsheetApp.create('SHN LEB Events — Master');
    DriveApp.getFileById(master.getId()).moveTo(folder);
    props.setProperty('MASTER_ID', master.getId());
  }
  ensureMasterTabs_(master);

  if (!props.getProperty('TOKEN_SECRET')) {
    props.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }
  Logger.log('Setup done. Master sheet: ' + master.getUrl());
  Logger.log('Events folder: ' + folder.getUrl());
  return master.getUrl();
}

function ensureMasterTabs_(ss) {
  Object.keys(MASTER_TABS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) writeHeader_(sh, MASTER_TABS[name]);
    else ensureHeaders_(sh, MASTER_TABS[name]);
  });
  const settings = ss.getSheetByName('Settings');
  const have = {};
  settings.getDataRange().getValues().slice(1).forEach(function (r) { have[String(r[0]).trim()] = true; });
  MASTER_SETTINGS.forEach(function (row) {
    if (!have[row[0]]) settings.appendRow(row);
  });
  const extra = ss.getSheetByName('Sheet1');
  if (extra && ss.getSheets().length > 1) ss.deleteSheet(extra);
}

/* adds header cells that a newer version expects (existing columns are never moved) */
function ensureHeaders_(sh, headers) {
  const have = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  headers.forEach(function (h, i) {
    if (h && !String(have[i] || '').trim()) sh.getRange(1, i + 1).setValue(h).setFontWeight('bold').setBackground('#eef1f6');
  });
}

/* a tab added in a newer version: created the first time an older event sheet needs it */
function lateTab_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    writeHeader_(sh, LATE_TABS[name]);
  }
  return sh;
}

function writeHeader_(sh, headers) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  headers.forEach(function (h, i) { if (h) sh.getRange(1, i + 1).setBackground('#eef1f6'); });
  sh.setFrozenRows(1);
}

/* ------------------------------------------------------------------ http */

function doGet() {
  return json_({ ok: true, app: 'SHN LEB Events', version: APP_VERSION });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Bad request.' });
  }
  try {
    return json_(Object.assign({ ok: true, version: APP_VERSION }, route_(req)));
  } catch (err) {
    if (err && err.userMessage) return json_({ ok: false, error: err.userMessage, code: err.code || 'error', version: APP_VERSION });
    const detail = String((err && err.message) || err);
    console.error(err && err.stack || err);
    try { logError_({ eventId: req.eventId || req.id || '', where: 'server: ' + req.action, message: detail, details: String(err && err.stack || '').slice(0, 1500) }); } catch (e2) { /* never fail twice */ }
    return json_({ ok: false, error: 'Something went wrong on the server.', detail: detail, code: 'server', version: APP_VERSION });
  }
}

function route_(req) {
  switch (req.action) {
    case 'ping': return { version: APP_VERSION };
    case 'adminLogin': return adminLogin_(req);
    case 'listEvents': requireAdmin_(req); return { events: listEvents_() };
    case 'createEvent': requireAdmin_(req); return { event: createEvent_(req) };
    case 'duplicateEvent': requireAdmin_(req); return { event: duplicateEvent_(req) };
    case 'launchEvent': requireAdmin_(req); return { event: launchEvent_(req.id) };
    case 'deleteDraft': requireAdmin_(req); return { deleted: deleteDraft_(req.id) };
    case 'saveInfo': requireAdmin_(req); return { event: saveInfo_(req.id, req.event || {}) };
    case 'saveBreakeven': requireAdmin_(req); return { event: saveBreakeven_(req.id, req.breakeven) };
    case 'saveLearnings': requireAdmin_(req); return { learnings: saveLearnings_(req.id, req.learnings) };
    case 'catalogueNames': requireAdmin_(req); return { names: catalogueNames_() };
    case 'overview': requireAdmin_(req); return { overview: overview_() };
    case 'setRefill': requireAdmin_(req); return { refill: setRefill_(req.id, req.requestId, req.status, req.toStock) };
    case 'getEvent': requireAdmin_(req); return { event: getEvent_(req.id) };
    case 'getInventory': requireAdmin_(req); return { inventory: withBarcodes_(getInventory_(req.id)) };
    case 'setEventStatus': requireAdmin_(req); return { event: setEventStatus_(req.id, req.status) };
    case 'eventPublic': return { event: eventPublic_(req.eventId) };
    case 'staffLogin': return staffLogin_(req);
    case 'posCatalog': return { catalog: posCatalog_(req.eventId) };
    case 'posData': requireEventAccess_(req, req.eventId); return { pos: posData_(req.eventId, isAdmin_(req)) };
    case 'recordSale': requireEventAccess_(req, req.eventId); return { sale: recordSale_(req.eventId, req.sale) };
    case 'clock': requireEventAccess_(req, req.eventId); return { openShifts: clock_(req.eventId, req.name, req.direction, req.clientTime, req.note) };
    case 'voidSale': requireAdmin_(req); return { sale: voidSale_(req.eventId, req.saleId, req.reason) };
    case 'recordReturn': requireEventAccess_(req, req.eventId); return { sale: recordReturn_(req.eventId, req.ret) };
    case 'logError': logError_(req.error || {}); return {};
    case 'recordCount': requireEventAccess_(req, req.eventId); return { count: recordCount_(req.eventId, req.count) };
    case 'recordCash': requireEventAccess_(req, req.eventId); return { cash: recordCash_(req.eventId, req.cash) };
    case 'dayAction': requireEventAccess_(req, req.eventId); return { day: dayAction_(req.eventId, req.day) };
    case 'recordCustomer': requireEventAccess_(req, req.eventId); return { customer: recordCustomer_(req.eventId, req.customer) };
    case 'recordRefill': requireEventAccess_(req, req.eventId); return { refill: recordRefill_(req.eventId, req.refill) };
    case 'recordDemo': requireEventAccess_(req, req.eventId); return { demo: recordDemo_(req.eventId, req.demo) };
    case 'daySummary': requireEventAccess_(req, req.eventId); return { summary: daySummary_(req.eventId, req.day) };
    case 'eventReport': requireAdmin_(req); return { report: eventReport_(req.id) };
    case 'addExpense': requireAdmin_(req); return { expense: addExpense_(req.id, req.expense) };
    case 'deleteExpense': requireAdmin_(req); return { deleted: deleteExpense_(req.id, req.expenseId) };
    case 'pnl': requireAdmin_(req); return { pnl: pnl_(req.id, req.writeSheet !== false) };
    default: throw userError_('Unknown action.', 'bad_action');
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function userError_(message, code) {
  const err = new Error(message);
  err.userMessage = message;
  err.code = code || 'error';
  return err;
}

/* ------------------------------------------------------------------ auth */

function adminLogin_(req) {
  const given = String(req.password || '').trim();
  const real = String(masterSetting_('ADMIN_PASSWORD') || '').trim();
  if (!given || !real || given !== real) {
    Utilities.sleep(800);
    throw userError_('Wrong password.', 'bad_password');
  }
  const exp = Date.now() + TOKEN_HOURS * 3600 * 1000;
  return { token: signToken_('admin', exp), expires: exp };
}

function signToken_(role, exp) {
  const body = role + '.' + exp;
  return body + '.' + hmac_(body);
}

function hmac_(text) {
  const secret = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  if (!secret) throw userError_('The back office is not set up yet. Run setup() in Apps Script.', 'not_setup');
  const bytes = Utilities.computeHmacSha256Signature(text, secret);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function tokenRole_(req) {
  const parts = String(req.token || '').split('.');
  if (parts.length !== 3) throw userError_('Please sign in again.', 'auth');
  const exp = Number(parts[1]);
  if (!exp || exp < Date.now()) throw userError_('Your session expired. Please sign in again.', 'auth');
  if (hmac_(parts[0] + '.' + parts[1]) !== parts[2]) throw userError_('Please sign in again.', 'auth');
  return parts[0];
}

function isAdmin_(req) {
  try { return tokenRole_(req) === 'admin'; } catch (e) { return false; }
}

function requireAdmin_(req) {
  if (tokenRole_(req) !== 'admin') throw userError_('Please sign in again.', 'auth');
}

/* Admin, or staff signed in with this event's PIN. */
function requireEventAccess_(req, eventId) {
  const role = tokenRole_(req);
  if (role === 'admin') return role;
  if (role === 'staff:' + eventId) return role;
  throw userError_('Please enter the event PIN again.', 'auth');
}

/* ------------------------------------------------------------------ master sheet */

function master_() {
  const id = PropertiesService.getScriptProperties().getProperty('MASTER_ID');
  if (!id) throw userError_('The back office is not set up yet. Run setup() in Apps Script.', 'not_setup');
  return SpreadsheetApp.openById(id);
}

function masterSetting_(key) {
  const rows = master_().getSheetByName('Settings').getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) return rows[i][1];
  }
  // a setting added in a newer version and not yet in the sheet: use its default
  for (let j = 0; j < MASTER_SETTINGS.length; j++) {
    if (MASTER_SETTINGS[j][0] === key) return MASTER_SETTINGS[j][1];
  }
  return '';
}

function eventsSheet_() {
  return master_().getSheetByName('Events');
}

function rowToEvent_(r) {
  return {
    id: String(r[0]),
    name: String(r[1]),
    type: String(r[2]),
    venue: String(r[3]),
    startDate: dateStr_(r[4]),
    endDate: dateStr_(r[5]),
    status: String(r[6] || 'Open'),
    sheetUrl: String(r[7]),
    sheetId: String(r[8]),
    createdAt: r[9] instanceof Date ? r[9].toISOString() : String(r[9] || ''),
    info: parseJson_(r[10], {}),
    breakeven: parseJson_(r[11], null),
    copyFrom: String(r[12] || ''),
    daysSold: Number(r[13]) || 0,
    avgUnitsPerDay: Number(r[14]) || 0,
    avgSalesPerDay: Number(r[15]) || 0,
    learnings: parseJson_(r[16], null)
  };
}

function parseJson_(v, fallback) {
  if (v === '' || v == null) return fallback;
  try { return JSON.parse(String(v)); } catch (e) { return fallback; }
}

function isDraft_(ev) { return ev.status === 'Draft'; }

function listEvents_() {
  const values = eventsSheet_().getDataRange().getValues();
  return values.slice(1).filter(function (r) { return String(r[0]).trim(); }).map(rowToEvent_);
}

function findEventRow_(id) {
  const sh = eventsSheet_();
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) return { sheet: sh, row: i + 1, values: values[i] };
  }
  throw userError_('Event not found.', 'not_found');
}

/* ------------------------------------------------------------------ events */

function eventFields_(req, base) {
  base = base || {};
  const name = String(req.name != null ? req.name : base.name || '').trim();
  const venue = String(req.venue != null ? req.venue : base.venue || '').trim();
  const type = EVENT_TYPES.indexOf(req.type) >= 0 ? req.type : (base.type || 'Sales');
  const start = String(req.startDate || base.startDate || '');
  const end = String(req.endDate || base.endDate || '');
  if (!name) throw userError_('Give the event a name.', 'invalid');
  if (!isIsoDate_(start) || !isIsoDate_(end)) throw userError_('Pick a start and an end date.', 'invalid');
  if (end < start) throw userError_('The end date is before the start date.', 'invalid');
  return { name: name.slice(0, 80), venue: venue.slice(0, 80), type: type, startDate: start, endDate: end };
}

/* A new event starts as a draft: it lives only in the master sheet (no Google Sheet, no PIN) until it is launched. */
function createEvent_(req, extra) {
  const f = eventFields_(req);
  extra = extra || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const existing = listEvents_().map(function (e) { return e.id; });
    let id;
    do { id = newId_(); } while (existing.indexOf(id) >= 0);
    const createdAt = new Date();
    const info = extra.info || {};
    const sh = eventsSheet_();
    const r = sh.getLastRow() + 1;
    sh.getRange(r, 1, 1, 13).setNumberFormat('@');
    sh.getRange(r, 1, 1, 13).setValues([[id, f.name, f.type, f.venue, f.startDate, f.endDate, 'Draft', '', '', '',
      JSON.stringify(info), extra.breakeven ? JSON.stringify(extra.breakeven) : '', extra.copyFrom || '']]);
    sh.getRange(r, 10).setNumberFormat('yyyy-mm-dd hh:mm').setValue(createdAt);
    return rowToEvent_(sh.getRange(r, 1, 1, 17).getValues()[0]);
  } finally {
    lock.releaseLock();
  }
}

/* Copy of an event as a new draft: same info and break-even; products, quantities, demo units and staff are copied at launch. */
function duplicateEvent_(req) {
  const src = rowToEvent_(findEventRow_(req.id).values);
  const copyFrom = isDraft_(src) ? src.copyFrom : src.id;
  return createEvent_({ name: req.name, type: src.type, venue: req.venue != null ? req.venue : src.venue, startDate: req.startDate, endDate: req.endDate },
    { info: src.info || {}, breakeven: src.breakeven, copyFrom: copyFrom });
}

function deleteDraft_(id) {
  const found = findEventRow_(id);
  if (!isDraft_(rowToEvent_(found.values))) throw userError_('Only a draft can be deleted. Close a launched event instead.', 'invalid');
  found.sheet.deleteRow(found.row);
  return true;
}

/* Name, dates, venue, type and the Info page. On a launched event the sheet's Settings follow. */
function saveInfo_(id, data) {
  const found = findEventRow_(id);
  const ev = rowToEvent_(found.values);
  const f = eventFields_(data, ev);
  const info = cleanInfo_(data.info || ev.info || {});
  found.sheet.getRange(found.row, 2, 1, 5).setNumberFormat('@').setValues([[f.name, f.type, f.venue, f.startDate, f.endDate]]);
  found.sheet.getRange(found.row, 11).setNumberFormat('@').setValue(JSON.stringify(info));
  if (!isDraft_(ev) && ev.sheetId) {
    setEventSettings_(SpreadsheetApp.openById(ev.sheetId), {
      'Event Name': f.name, 'Type': f.type, 'Venue': f.venue, 'Start Date': f.startDate, 'End Date': f.endDate, 'Opening Hours': info.openingHours || ''
    });
  }
  return getEvent_(id);
}

const INFO_FIELDS = ['description', 'openingHours', 'mapsLink', 'standLocation', 'standSize', 'organizerName', 'organizerPhone', 'organizerEmail',
  'setupTime', 'teardownTime', 'objectives', 'notes'];

function cleanInfo_(info) {
  const out = {};
  INFO_FIELDS.forEach(function (k) { if (info[k] != null && String(info[k]).trim()) out[k] = String(info[k]).slice(0, 3000); });
  if (Array.isArray(info.focusGames)) out.focusGames = info.focusGames.map(String).filter(Boolean).slice(0, 60);
  if (Array.isArray(info.targets)) {
    out.targets = info.targets.slice(0, 40).map(function (t) {
      const n = t.target === '' || t.target == null ? '' : Number(t.target);
      return { id: String(t.id || '').slice(0, 20), key: String(t.key || '').slice(0, 20), label: String(t.label || '').slice(0, 200),
        target: n === '' || isNaN(n) ? '' : n, lower: !!t.lower };
    }).filter(function (t) { return t.key || t.label || t.target !== ''; });
  }
  return out;
}

function saveBreakeven_(id, be) {
  const found = findEventRow_(id);
  const text = JSON.stringify(be || {});
  if (text.length > 20000) throw userError_('The break-even simulation is too long to save.', 'invalid');
  found.sheet.getRange(found.row, 12).setNumberFormat('@').setValue(text);
  return getEvent_(id);
}

/* Learnings tab: notes per topic and the actual result of each target (kept in the master sheet) */
function saveLearnings_(id, l) {
  l = l || {};
  const found = findEventRow_(id);
  const out = {};
  ['staffing', 'location', 'setup', 'differently'].forEach(function (k) { if (l[k] != null) out[k] = String(l[k]).slice(0, 5000); });
  out.actuals = {};
  Object.keys(l.actuals || {}).slice(0, 60).forEach(function (k) {
    const v = l.actuals[k];
    if (v !== '' && v != null && !isNaN(Number(v))) out.actuals[String(k).slice(0, 20)] = Number(v);
  });
  found.sheet.getRange(found.row, 17).setNumberFormat('@').setValue(JSON.stringify(out));
  return out;
}

/* writes key/value rows in an event's Settings tab (adds the row if missing) */
function setEventSettings_(ss, map) {
  const sh = ss.getSheetByName('Settings');
  const rows = sh.getRange(1, 1, Math.max(1, sh.getLastRow()), 2).getValues();
  Object.keys(map).forEach(function (k) {
    let at = -1;
    for (let i = 1; i < rows.length; i++) if (String(rows[i][0]).trim() === k) { at = i; break; }
    if (at < 0) {
      // first empty row of column A
      at = rows.length;
      for (let i = 1; i < rows.length; i++) if (!String(rows[i][0]).trim()) { at = i; break; }
      sh.getRange(at + 1, 1).setValue(k).setFontWeight('bold');
      if (at >= rows.length) rows.push([k, '']); else rows[at][0] = k;
    }
    sh.getRange(at + 1, 2).setNumberFormat('@').setValue(String(map[k]));
  });
}

function sheetName_(ev) {
  return ev.startDate.replace(/-/g, '') + ' - ' + ev.name;
}

/* Launch: creates the event's Google Sheet. Until then the event is a draft. */
function launchEvent_(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const found = findEventRow_(id);
    const ev = rowToEvent_(found.values);
    if (!isDraft_(ev)) return getEvent_(id);
    const catalogue = loadCatalogue_();
    const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER_ID'));
    const ss = SpreadsheetApp.create(sheetName_(ev));
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    ev.openingHours = (ev.info && ev.info.openingHours) || '';
    buildEventSheet_(ss, ev, catalogue);
    if (ev.copyFrom) {
      try { copyFromEvent_(ev.copyFrom, ss); } catch (e) { console.error(e); }
    }
    found.sheet.getRange(found.row, 7, 1, 3).setValues([['Open', ss.getUrl(), ss.getId()]]);
    return getEvent_(id);
  } finally {
    lock.releaseLock();
  }
}

/* products with their opening and demo quantities, external products and the staff list of an earlier event */
function copyFromEvent_(srcId, ss) {
  const src = rowToEvent_(findEventRow_(srcId).values);
  if (!src.sheetId) return;
  const from = SpreadsheetApp.openById(src.sheetId);
  const lst = from.getSheetByName('Listing').getDataRange().getValues().slice(1);
  const prods = lst.filter(function (r) { return String(r[4] || '').trim(); }).map(function (r) { return [r[4], r[5], r[6]]; });
  const K = CONS_COL - 1;
  const ext = lst.filter(function (r) { return String(r[K] || '').trim(); }).map(function (r) { return r.slice(K, K + 10); });
  const to = ss.getSheetByName('Listing');
  if (prods.length) to.getRange(2, 5, prods.length, 3).setValues(prods);
  const M = MAT_COL - 1;
  const mats = lst.filter(function (r) { return String(r[M] || '').trim(); }).map(function (r) { return r.slice(M, M + 3); });
  if (mats.length) to.getRange(2, MAT_COL, mats.length, 3).setValues(mats);
  if (ext.length) {
    to.getRange(2, CONS_COL + 1, ext.length, 1).setNumberFormat('@');
    to.getRange(2, CONS_COL, ext.length, 10).setValues(ext);
  }
  const staff = readStaff_(from);
  if (staff.length) {
    ss.getSheetByName('Settings').getRange(2, STAFF_COL, staff.length, 5).setValues(staff.map(function (p) {
      return [p.name, p.hourlyRate, p.commissionUnder, p.commissionOver, p.active ? 'Y' : 'N'];
    }));
  }
}

function buildEventSheet_(ss, ev, catalogue) {
  ss.setSpreadsheetLocale('en_US'); // formulas below use commas
  ss.setSpreadsheetTimeZone('Asia/Beirut');
  EVENT_TABS.forEach(function (tab, i) {
    const sh = i === 0 ? ss.getSheets()[0].setName(tab[0]) : ss.insertSheet(tab[0]);
    writeHeader_(sh, tab[1]);
  });
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  const settings = [
    ['Event ID', ev.id, 'Do not change'],
    ['Event Name', ev.name, ''],
    ['Type', ev.type, 'Sales or Awareness'],
    ['Venue', ev.venue, ''],
    ['Start Date', ev.startDate, 'YYYY-MM-DD'],
    ['End Date', ev.endDate, 'YYYY-MM-DD'],
    ['Opening Hours', ev.openingHours || '', 'e.g. Weekdays 4pm-11pm, weekends 1pm-11pm. Staff access ends 12h after the last closing time'],
    ['Exchange Rate (LBP per USD)', Number(masterSetting_('DEFAULT_FX_RATE')) || 89500, ''],
    ['Opening Cash USD', Number(masterSetting_('DEFAULT_OPENING_CASH_USD')) || 0, 'Cash in the drawer at the start'],
    ['Opening Cash LBP', Number(masterSetting_('DEFAULT_OPENING_CASH_LBP')) || 0, 'Cash in the drawer at the start'],
    ['Max Discount %', Number(masterSetting_('DEFAULT_MAX_DISCOUNT_PCT')) || 0, 'Highest discount a cashier can enter'],
    ['COGS %', Number(masterSetting_('COGS_PCT')) || 0, 'Cost of goods as % of selling price, locked for this event'],
    ['PIN', pin, '4 digits, shared with the event staff'],
    ['Manager PIN', String(masterSetting_('MANAGER_PIN') || ''), 'For returns above $' + (Number(masterSetting_('RETURN_APPROVAL_USD')) || 0) + ' and discounts above the max'],
    ['Commission Threshold (USD)', Number(masterSetting_('COMMISSION_THRESHOLD')) || 0, 'Items paid at or above this price earn the higher commission'],
    ['Daily Target Qty', '', 'Optional'],
    ['Daily Target Sales (USD)', '', 'Optional']
  ];
  const sh = ss.getSheetByName('Settings');
  sh.getRange(2, 1, settings.length, 3).setNumberFormat('@').setValues(settings.map(function (r) {
    return [r[0], String(r[1]), r[2]];
  }));
  sh.getRange(2, 1, settings.length, 1).setFontWeight('bold');
  sh.setColumnWidth(1, 210);
  sh.setColumnWidth(3, 300);
  ss.getSheetByName('P&L').getRange(2, 1).setValue('Filled automatically when a business day is closed.');
  buildInventoryTabs_(ss, catalogue || []);
}

/* ------------------------------------------------------------------ catalogue + inventory tabs */

function normKey_(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}

function upper_(s) { return (String(s).match(/[A-Z]/g) || []).length; }

function parseMoney_(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

/* Reads the SHN Catalogue, drops excluded product lines, tidies category spelling. */
function loadCatalogue_() {
  let sheet;
  try {
    sheet = SpreadsheetApp.openById(String(masterSetting_('CATALOG_SHEET_ID')).trim()).getSheets()[0];
  } catch (e) {
    throw userError_('Could not open the SHN Catalogue. Check CATALOG_SHEET_ID in the master sheet and that this account can view it.', 'catalog');
  }
  const values = sheet.getDataRange().getValues();
  const head = values[0].map(normKey_);
  const ix = {};
  Object.keys(CATALOG_COLS).forEach(function (k) { ix[k] = head.indexOf(normKey_(CATALOG_COLS[k])); });
  if (ix.name < 0 || ix.ref < 0 || ix.price < 0) {
    throw userError_('The SHN Catalogue is missing a column (Ref Code, Product Description or SHN Price (Leb) TTC USD).', 'catalog');
  }
  const excluded = {};
  String(masterSetting_('EVENT_EXCLUDED_PRODUCT_LINES') || '').split(',').forEach(function (x) {
    const k = normKey_(x);
    if (k) excluded[k === '(blank)' ? '' : k] = true;
  });
  // most common spelling of each product line wins ("Board games" -> "Board Games")
  const spell = {};
  values.slice(1).forEach(function (r) {
    const raw = ix.line >= 0 ? String(r[ix.line] || '').trim() : '';
    const k = normKey_(raw);
    spell[k] = spell[k] || {};
    spell[k][raw] = (spell[k][raw] || 0) + 1;
  });
  const canon = {};
  Object.keys(spell).forEach(function (k) {
    canon[k] = Object.keys(spell[k]).sort(function (a, b) {
      return (spell[k][b] - spell[k][a]) || (upper_(b) - upper_(a)); // tie: more capitals wins
    })[0];
  });
  const seen = {};
  const out = [];
  values.slice(1).forEach(function (r) {
    const name = String(r[ix.name] || '').replace(/\s+/g, ' ').trim();
    if (!name) return;
    const lineKey = ix.line >= 0 ? normKey_(r[ix.line]) : '';
    if (excluded[lineKey] === true) return;
    if (seen[normKey_(name)]) return;
    seen[normKey_(name)] = true;
    out.push([
      name,
      String(r[ix.ref] || '').trim(),
      parseMoney_(r[ix.price]),
      canon[lineKey] || '',
      ix.family >= 0 ? String(r[ix.family] || '').trim() : ''
    ]);
  });
  out.sort(function (a, b) { return a[0].toLowerCase() < b[0].toLowerCase() ? -1 : 1; });
  return out;
}

function colLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function buildInventoryTabs_(ss, catalogue) {
  const red = '#f8d7d4';
  const strict = function (range) {
    return SpreadsheetApp.newDataValidation().requireValueInRange(range, true).setAllowInvalid(false).build();
  };
  const list = function (values) {
    return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  };
  const C = colLetter_(CATALOG_COL), C2 = colLetter_(CATALOG_COL + 4); // K..O
  const catRange = 'Settings!' + C + '2:' + C2;

  // Settings: staff block + this event's catalogue (prices locked for the event)
  const set = ss.getSheetByName('Settings');
  if (catalogue.length) {
    set.getRange(2, CATALOG_COL + 1, catalogue.length, 1).setNumberFormat('@');
    set.getRange(2, CATALOG_COL, catalogue.length, 5).setValues(catalogue);
    set.getRange(2, CATALOG_COL + 2, catalogue.length, 1).setNumberFormat('$#,##0.00');
  }
  set.setColumnWidth(CATALOG_COL, 320);
  set.setColumnWidth(STAFF_COL, 160);
  set.getRange(2, STAFF_COL + 4, MAX_ROWS, 1).setDataValidation(list(['Y', 'N']));
  set.getRange(2, STAFF_COL + 1, MAX_ROWS, 1).setNumberFormat('$#,##0.00');

  // Listing: Ref Code, Category, Game Family, Price looked up from the product name
  const lst = ss.getSheetByName('Listing');
  const look = function (header, col) {
    return '={"' + header + '";ARRAYFORMULA(IF(E2:E="","",IFERROR(VLOOKUP(E2:E,' + catRange + ',' + col + ',FALSE),"")))}';
  };
  lst.getRange(1, 1).setFormula(look('Ref Code', 2));
  lst.getRange(1, 2).setFormula(look('Category', 4));
  lst.getRange(1, 3).setFormula(look('Game Family', 5));
  lst.getRange(1, 4).setFormula(look('Price (USD)', 3));
  lst.getRange(2, 4, MAX_ROWS, 1).setNumberFormat('$#,##0.00');
  lst.getRange(2, 5, MAX_ROWS, 1).setDataValidation(strict(set.getRange(C + '2:' + C)));
  lst.setColumnWidth(5, 320);
  // consignment block (I-R): typed by hand
  lst.getRange(2, CONS_COL + 3, MAX_ROWS, 1).setNumberFormat('$#,##0.00');
  lst.getRange(2, CONS_COL + 7, MAX_ROWS, 1).setDataValidation(list(['Fixed', '%']));
  lst.setColumnWidth(CONS_COL, 260);
  // hidden helper: every product name of this event, for the Stock Moves dropdown
  lst.setColumnWidth(MAT_COL, 240); lst.setColumnWidth(MAT_COL + 2, 200);
  const CL = colLetter_(CONS_COL), CL2 = colLetter_(CONS_COL + 1);
  lst.getRange(1, ALL_NAMES_COL).setFormula('={"All Products (auto)";IFERROR(FILTER({E2:E;' + CL + '2:' + CL + '},{E2:E;' + CL + '2:' + CL + '}<>""),"")}');
  lst.hideColumns(ALL_NAMES_COL);

  // Stock Moves: dropdown of this event's products (listing + consignment)
  const moves = ss.getSheetByName('Stock Moves');
  moves.getRange(1, 2).setFormula('={"Ref Code";ARRAYFORMULA(IF(C2:C="","",IFERROR(VLOOKUP(C2:C,{Listing!E2:E,Listing!A2:A},2,FALSE),IFERROR(VLOOKUP(C2:C,{Listing!' + CL + '2:' + CL + ',Listing!' + CL2 + '2:' + CL2 + '},2,FALSE),""))))}');
  moves.getRange(2, 1, MAX_ROWS, 1).setNumberFormat('yyyy-mm-dd');
  const NL = colLetter_(ALL_NAMES_COL);
  moves.getRange(2, 3, MAX_ROWS, 1).setDataValidation(strict(lst.getRange(NL + '2:' + NL)));
  moves.setColumnWidth(3, 320);

  // colour the column groups, then mark the automatic columns
  BLOCK_COLORS.forEach(function (b) {
    const sh = ss.getSheetByName(b[0]);
    const n = b[2] - b[1] + 1;
    sh.getRange(1, b[1], 1, n).setBackground(b[3]);
    sh.getRange(2, b[1], MAX_ROWS, n).setBackground(b[4]);
  });
  AUTO_COLS.forEach(function (a) {
    ss.getSheetByName(a[0]).getRange(2, a[1], MAX_ROWS, a[2] - a[1] + 1).setFontColor('#6b6b6b').setFontStyle('italic');
  });

  // warn before anyone edits formulas, headers or the event ID (edits stay possible after confirming)
  const warn = function (range, why) { range.protect().setDescription(why).setWarningOnly(true); };
  AUTO_COLS.forEach(function (a) {
    warn(ss.getSheetByName(a[0]).getRange(1, a[1], MAX_ROWS + 1, a[2] - a[1] + 1), 'Filled automatically from the product name');
  });
  warn(lst.getRange(1, ALL_NAMES_COL, MAX_ROWS + 1, 1), 'Automatic list for the Stock Moves dropdown');
  EVENT_TABS.map(function (t) { return t[0]; }).forEach(function (t) {
    const sh = ss.getSheetByName(t);
    warn(sh.getRange(1, 1, 1, sh.getMaxColumns()), 'Column headers used by the app');
  });
  warn(set.getRange(2, 1, 1, 3), 'Event ID: do not change');
  ['Sales', 'Shifts', 'Cash', 'Counts', 'Days', 'Customers', 'Refills', 'Demos'].forEach(function (t) {
    warn(ss.getSheetByName(t).getRange(2, 1, MAX_ROWS, ss.getSheetByName(t).getMaxColumns()), 'Written by the app');
  });

  // safety net: a name that no longer matches (catalogue edited) turns red
  lst.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($E2<>"",$A2="")').setBackground(red).setRanges([lst.getRange(2, 5, MAX_ROWS, 1)]).build()]);
  moves.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($C2<>"",$B2="")').setBackground(red).setRanges([moves.getRange(2, 3, MAX_ROWS, 1)]).build()]);
}

/* Live stock for the Inventory tab (and the POS later). */
function getInventory_(id, asOf) {
  const ev = rowToEvent_(findEventRow_(id).values);
  if (isDraft_(ev)) throw userError_('Launch the event first: its Google Sheet is created at launch.', 'draft');
  const ss = SpreadsheetApp.openById(ev.sheetId);
  ['Listing', 'Stock Moves', 'Sales'].forEach(function (t) {
    if (!ss.getSheetByName(t)) throw userError_('This event was created with an older version of the app. Create a new event.', 'old_event');
  });
  const warnings = [];
  const items = {};
  const byName = {};
  const order = [];
  function add(item, where) {
    if (items[item.ref]) {
      warnings.push(where + ': "' + item.name + '" is listed more than once. Quantities were added together.');
      items[item.ref].opening += item.opening;
      items[item.ref].demo += item.demo;
      return;
    }
    items[item.ref] = item;
    byName[normKey_(item.name)] = item.ref;
    order.push(item.ref);
  }
  function qty(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

  const lstSheet = ss.getSheetByName('Listing');
  const prod = lstSheet.getDataRange().getValues();
  for (let i = 1; i < prod.length; i++) {
    const r = prod[i];
    const name = String(r[4] || '').trim();
    if (!name) continue;
    const ref = String(r[0] || '').trim();
    if (!ref) { warnings.push('Listing row ' + (i + 1) + ': "' + name + '" is not in the event catalogue, so it is ignored.'); continue; }
    add({ ref: ref, name: name, category: String(r[1] || ''), family: String(r[2] || ''), price: parseMoney_(r[3]),
      opening: qty(r[5]), demo: qty(r[6]), moves: 0, sold: 0, consignment: false }, 'Listing');
  }

  // tools & materials (not sold, not on the staff link)
  const materials = [];
  for (let i = 1; i < prod.length; i++) {
    const d = String(prod[i][MAT_COL - 1] || '').trim();
    if (d) materials.push({ description: d, qty: qty(prod[i][MAT_COL]), notes: String(prod[i][MAT_COL + 1] || '') });
  }

  // consignment block: Listing M-V
  const K = CONS_COL - 1;
  const usedC = {};
  prod.slice(1).forEach(function (r) { const m = String(r[K + 1] || '').match(/^C(\d+)$/); if (m) usedC[Number(m[1])] = true; });
  let nextC = 1;
  for (let i = 1; i < prod.length; i++) {
    const r = prod[i];
    const name = String(r[K] || '').trim();
    if (!name) continue;
    let ref = String(r[K + 1] || '').trim();
    if (!ref) {
      while (usedC[nextC]) nextC++;
      usedC[nextC] = true;
      ref = 'C' + ('00' + nextC).slice(-3);
      lstSheet.getRange(i + 1, CONS_COL + 1).setValue(ref);
    }
    const price = parseMoney_(r[K + 3]);
    if (!price) warnings.push('External products row ' + (i + 1) + ': "' + name + '" has no price.');
    add({ ref: ref, name: name, category: String(r[K + 2] || '') || 'External', family: '', price: price,
      opening: qty(r[K + 4]), demo: qty(r[K + 5]), moves: 0, sold: 0, consignment: true,
      partner: String(r[K + 6] || ''), payType: String(r[K + 7] || ''), payValue: qty(r[K + 8]), picture: String(r[K + 9] || '') }, 'External products');
  }

  const moves = ss.getSheetByName('Stock Moves').getDataRange().getValues();
  for (let i = 1; i < moves.length; i++) {
    const r = moves[i];
    const name = String(r[2] || '').trim();
    const q = qty(r[3]);
    if (!name && !q) continue;
    const ref = String(r[1] || '').trim() || byName[normKey_(name)];
    if (!ref || !items[ref]) { warnings.push('Stock Moves row ' + (i + 1) + ': "' + name + '" is not a product of this event, so it is ignored.'); continue; }
    items[ref].moves += q;
  }

  const sales = ss.getSheetByName('Sales').getDataRange().getValues();
  for (let i = 1; i < sales.length; i++) {
    const r = sales[i];
    if (String(r[20] || '').trim()) continue; // voided
    if (asOf && saleStamp_(r) > asOf) continue;
    const ref = String(r[5] || '').trim();
    if (items[ref]) items[ref].sold += qty(r[8]);
  }

  const list = order.map(function (ref) {
    const it = items[ref];
    it.live = it.opening + it.moves - it.sold;
    if (it.live < 0) warnings.push('"' + it.name + '" shows ' + it.live + ' in stock. Check the opening quantity and stock moves.');
    return it;
  });
  return { items: list, warnings: warnings, materials: materials };
}

/* Staff list. Events created before v1.8 have a per-person Threshold column (read, still honoured). */
function readStaff_(ss) {
  const sh = ss.getSheetByName('Settings');
  const K = STAFF_COL - 1;
  const values = sh.getDataRange().getValues();
  const old = /threshold/i.test(String(values[0][K + 3] || '')) && !/at\/over/i.test(String(values[0][K + 3] || ''));
  return values.slice(1).filter(function (r) { return String(r[K] || '').trim(); }).map(function (r) {
    return {
      name: String(r[K]).trim(),
      hourlyRate: parseMoney_(r[K + 1]),
      commissionUnder: parseMoney_(r[K + 2]),
      threshold: old ? parseMoney_(r[K + 3]) : null,
      commissionOver: parseMoney_(old ? r[K + 4] : r[K + 3]),
      active: String((old ? r[K + 5] : r[K + 4]) || 'Y').trim().toUpperCase() !== 'N'
    };
  });
}

/* the commission threshold of an event: its Settings row, else (older events) each person's own, else the master default */
function commissionThreshold_(settings, person) {
  const v = settings['Commission Threshold (USD)'];
  if (v !== '' && v != null && !isNaN(Number(v))) return Number(v);
  if (person && person.threshold != null) return person.threshold;
  return Number(masterSetting_('COMMISSION_THRESHOLD')) || 0;
}

function managerPin_(settings) {
  const v = String(settings['Manager PIN'] == null ? '' : settings['Manager PIN']).trim();
  return v || String(masterSetting_('MANAGER_PIN') || '').trim();
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

/* Staff access ends 12 hours after the closing time of the last event day
   (no closing time in Opening Hours: 12 hours after midnight, i.e. noon the next day). */
function closingHour_(text) {
  const re = /(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm)?/gi;
  let m, best = null;
  while ((m = re.exec(String(text || ''))) !== null) {
    let sh = Number(m[1]), eh = Number(m[4]);
    const em = Number(m[5] || 0), sap = (m[3] || '').toLowerCase(), eap = (m[6] || sap).toLowerCase();
    if (eap === 'pm' && eh < 12) eh += 12;
    if (eap === 'am' && eh === 12) eh = 0;
    if (sap === 'pm' && sh < 12) sh += 12;
    let end = eh + em / 60;
    if (end <= sh || end < 6) end += 24; // closes after midnight
    if (end > 48) continue;
    if (best === null || end > best) best = end;
  }
  return best;
}

function accessEnds_(ev, settings) {
  const close = closingHour_(settings['Opening Hours']);
  const midnight = Utilities.parseDate(ev.endDate + ' 00:00', tz_(), 'yyyy-MM-dd HH:mm').getTime();
  return midnight + ((close === null ? 24 : close) + 12) * 3600000;
}

function readEventSettings_(sheetId) {
  const rows = SpreadsheetApp.openById(sheetId).getSheetByName('Settings').getDataRange().getValues();
  const out = {};
  rows.slice(1).forEach(function (r) { if (String(r[0]).trim()) out[String(r[0]).trim()] = r[1]; });
  return out;
}

function getEvent_(id) {
  const found = findEventRow_(id);
  const ev = rowToEvent_(found.values);
  if (isDraft_(ev)) { ev.staff = []; ev.settings = null; ev.defaults = draftDefaults_(); return ev; }
  const ss = SpreadsheetApp.openById(ev.sheetId);
  const s = readEventSettings_(ev.sheetId);
  ev.staff = readStaff_(ss);
  ev.settings = {
    openingHours: String(s['Opening Hours'] || ''),
    fxRate: Number(s['Exchange Rate (LBP per USD)']) || 0,
    openingCashUsd: Number(s['Opening Cash USD']) || 0,
    openingCashLbp: Number(s['Opening Cash LBP']) || 0,
    maxDiscountPct: Number(s['Max Discount %']) || 0,
    cogsPct: Number(s['COGS %']) || 0,
    pin: String(s['PIN'] || ''),
    dailyTargetQty: s['Daily Target Qty'] === '' ? null : Number(s['Daily Target Qty']),
    dailyTargetSales: s['Daily Target Sales (USD)'] === '' ? null : Number(s['Daily Target Sales (USD)']),
    managerPin: managerPin_(s),
    commissionThreshold: commissionThreshold_(s, null),
    accessEnds: accessEnds_(ev, s)
  };
  if (s['Opening Hours'] && !(ev.info && ev.info.openingHours)) { ev.info = ev.info || {}; ev.info.openingHours = String(s['Opening Hours']); }
  ev.defaults = draftDefaults_();
  return ev;
}

/* starting values for a new break-even simulation */
function draftDefaults_() {
  return {
    cogsPct: Number(masterSetting_('COGS_PCT')) || 0,
    staffRate: Number(masterSetting_('DEFAULT_STAFF_RATE')) || 0,
    threshold: Number(masterSetting_('COMMISSION_THRESHOLD')) || 0
  };
}

function setEventStatus_(id, status) {
  if (status !== 'Open' && status !== 'Closed') throw userError_('Status must be Open or Closed.', 'invalid');
  const found = findEventRow_(id);
  if (isDraft_(rowToEvent_(found.values))) throw userError_('Launch the event first.', 'invalid');
  found.sheet.getRange(found.row, 7).setValue(status);
  found.values[6] = status;
  return rowToEvent_(found.values);
}

/* ------------------------------------------------------------------ POS */

function eventPublic_(id) {
  const ev = rowToEvent_(findEventRow_(id).values);
  return { id: ev.id, name: ev.name, venue: ev.venue, status: ev.status, startDate: ev.startDate, endDate: ev.endDate, type: ev.type };
}

/* staff can't use a draft, a closed event, or an event whose access window is over */
function checkStaffWindow_(ev, settings) {
  if (isDraft_(ev)) throw userError_('This event is not launched yet. Ask your manager.', 'draft');
  if (ev.status === 'Closed') throw userError_('This event is closed.', 'closed');
  const ends = accessEnds_(ev, settings || readEventSettings_(ev.sheetId));
  if (Date.now() > ends) throw userError_('Access to this event ended on ' + Utilities.formatDate(new Date(ends), tz_(), 'EEE d MMM, HH:mm') + '.', 'ended');
  return ends;
}

function staffLogin_(req) {
  const id = String(req.eventId || '');
  const ev = rowToEvent_(findEventRow_(id).values);
  const settings = isDraft_(ev) ? {} : readEventSettings_(ev.sheetId);
  const ends = checkStaffWindow_(ev, settings);
  const cache = CacheService.getScriptCache();
  const key = 'pinfail_' + id;
  const fails = Number(cache.get(key) || 0);
  if (fails >= 10) throw userError_('Too many wrong PINs. Wait 10 minutes and try again.', 'locked');
  const pin = String(settings['PIN'] || '').trim();
  if (!pin || String(req.pin || '').trim() !== pin) {
    cache.put(key, String(fails + 1), 600);
    Utilities.sleep(600);
    throw userError_('Wrong PIN.', 'bad_pin');
  }
  const exp = Math.min(Date.now() + STAFF_TOKEN_HOURS * 3600 * 1000, ends);
  return { token: signToken_('staff:' + id, exp), expires: exp, event: eventPublic_(id) };
}

/* Product names, prices and pictures, shown while staff type the PIN (no stock, no sales). */
function posCatalog_(id) {
  const ev = eventPublic_(id);
  checkStaffWindow_(rowToEvent_(findEventRow_(id).values));
  let pics = {};
  try { pics = pictures_(); } catch (e) { pics = {}; }
  const products = getInventory_(id).items.map(function (it) {
    return { ref: it.ref, name: it.name, category: it.category, price: it.price, picture: it.picture || pics[it.ref] || '', barcodes: barcodesOf_(it.ref) };
  }).sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
  return { event: ev, products: products };
}

function openEventForWrite_(id) {
  const ev = rowToEvent_(findEventRow_(id).values);
  if (isDraft_(ev)) throw userError_('This event is not launched yet.', 'draft');
  if (ev.status === 'Closed') throw userError_('This event is closed. Reopen it to record sales.', 'closed');
  return ev;
}

function tz_() { return 'Asia/Beirut'; }

function when_(clientTime) {
  const now = new Date();
  const t = clientTime ? new Date(clientTime) : null;
  // sales recorded offline keep the time they happened (up to 7 days back)
  if (t && !isNaN(t) && t <= new Date(now.getTime() + 5 * 60000) && t >= new Date(now.getTime() - 7 * 86400000)) return t;
  return now;
}

function round2_(n) { return Math.round(n * 100) / 100; }

function activeStaffNames_(ss) {
  return readStaff_(ss).filter(function (p) { return p.active; }).map(function (p) { return p.name; });
}

function openShifts_(ss) {
  const rows = ss.getSheetByName('Shifts').getDataRange().getValues();
  const open = {};
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][1] || '').trim();
    if (!name) continue;
    if (String(rows[i][2] || '').trim() && !String(rows[i][3] || '').trim()) open[name] = String(rows[i][2]);
    else delete open[name];
  }
  return Object.keys(open).map(function (n) { return { name: n, since: open[n] }; });
}

/* Product pictures from the website, by SKU. Cached for 6 hours. */
function pictures_() {
  const cache = CacheService.getScriptCache();
  const head = cache.get('pics_n');
  if (head !== null) {
    const keys = [];
    for (let i = 0; i < Number(head); i++) keys.push('pics_' + i);
    const got = cache.getAll(keys);
    let json = '';
    let complete = true;
    keys.forEach(function (k) { if (got[k] == null) complete = false; else json += got[k]; });
    if (complete) { try { return JSON.parse(json || '{}'); } catch (e) { /* refetch */ } }
  }
  const map = {};
  const domain = String(masterSetting_('SHOP_DOMAIN') || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (domain) {
    for (let page = 1; page <= 40; page++) {
      let res;
      try {
        res = UrlFetchApp.fetch('https://' + domain + '/products.json?limit=250&page=' + page, { muteHttpExceptions: true });
      } catch (e) { break; }
      if (res.getResponseCode() !== 200) break;
      let data;
      try { data = JSON.parse(res.getContentText()); } catch (e) { break; }
      const products = (data && data.products) || [];
      if (!products.length) break;
      products.forEach(function (p) {
        const first = p.images && p.images[0] && p.images[0].src;
        (p.variants || []).forEach(function (v) {
          const sku = String(v.sku || '').trim();
          if (!sku || map[sku]) return;
          const img = (v.featured_image && v.featured_image.src) || first;
          if (img) map[sku] = img;
        });
      });
      if (products.length < 250) break;
    }
  }
  const json = JSON.stringify(map);
  const chunks = {};
  const size = 90000;
  let n = 0;
  for (let i = 0; i < json.length; i += size) chunks['pics_' + (n++)] = json.slice(i, i + size);
  chunks.pics_n = String(n);
  try { cache.putAll(chunks, 21600); } catch (e) { /* cache is a bonus */ }
  return map;
}

function saleSummaries_(rows, limit) {
  const by = {};
  const order = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = String(r[0] || '').trim();
    if (!id) continue;
    if (!by[id]) {
      by[id] = { id: id, date: dateStr_(r[2]), time: timeStr_(r[3]), seller: String(r[4] || ''), method: String(r[12] || ''),
        total: 0, units: 0, lines: [], void: !!String(r[20] || '').trim(), voidReason: String(r[21] || ''),
        returnOf: String(r[24] || ''), returned: {} };
      order.push(id);
    }
    const s = by[id];
    s.total = round2_(s.total + (Number(r[11]) || 0));
    s.units += Number(r[8]) || 0;
    s.lines.push({ ref: String(r[5]), name: String(r[6]), qty: Number(r[8]) || 0, total: Number(r[11]) || 0 });
    if (Number(r[1]) === 1) {
      s.online = Number(r[13]) || 0; s.recvUsd = Number(r[14]) || 0; s.recvLbp = Number(r[15]) || 0;
      s.changeUsd = Number(r[16]) || 0; s.changeLbp = Number(r[17]) || 0; s.discountPct = Number(r[10]) || 0;
    }
  }
  // how much of each sale has been returned
  order.forEach(function (id) {
    const ret = by[id];
    if (!ret.returnOf || ret.void || !by[ret.returnOf]) return;
    ret.lines.forEach(function (l) {
      by[ret.returnOf].returned[l.ref] = (by[ret.returnOf].returned[l.ref] || 0) - l.qty;
    });
  });
  return order.slice(-limit).reverse().map(function (id) { return by[id]; });
}

function timeStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'HH:mm');
  return String(v || '');
}

function posData_(id, admin) {
  const ev = rowToEvent_(findEventRow_(id).values);
  const ss = SpreadsheetApp.openById(ev.sheetId);
  const s = readEventSettings_(ev.sheetId);
  const inv = getInventory_(id);
  let pics = {};
  try { pics = pictures_(); } catch (e) { pics = {}; }
  const products = inv.items.map(function (it) {
    return { ref: it.ref, name: it.name, category: it.category, price: it.price, live: it.live, demo: it.demo,
      picture: it.picture || pics[it.ref] || '', barcodes: barcodesOf_(it.ref) };
  }).sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
  return {
    event: eventPublic_(id),
    fxRate: Number(s['Exchange Rate (LBP per USD)']) || 0,
    maxDiscountPct: Number(s['Max Discount %']) || 0,
    lbpStep: LBP_STEP,
    whishLink: String(masterSetting_('WHISH_PAY_LINK') || '').trim(),
    staff: activeStaffNames_(ss),
    openShifts: openShifts_(ss),
    products: products,
    recentSales: saleSummaries_(ss.getSheetByName('Sales').getDataRange().getValues(), admin ? 200 : 30),
    day: dayState_(ss),
    expectedCash: expectedCash_(ss, s, null),
    managerPinHash: sha256Hex_(id + ':' + managerPin_(s)),
    returnApprovalUsd: Number(masterSetting_('RETURN_APPROVAL_USD')) || 0,
    cashWarn: { usd: Number(masterSetting_('CASH_WARN_USD')) || 0, lbp: Number(masterSetting_('CASH_WARN_LBP')) || 0 },
    accessEnds: accessEnds_(ev, s),
    warnings: admin ? inv.warnings : [],
    serverTime: new Date().toISOString()
  };
}

/* Records one sale. Prices come from the event sheet, never from the phone. Safe to send twice. */
function recordSale_(id, sale) {
  sale = sale || {};
  const saleId = String(sale.id || '');
  if (!/^[A-Za-z0-9-]{6,40}$/.test(saleId)) throw userError_('Bad sale number.', 'invalid');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ev = openEventForWrite_(id);
    const ss = SpreadsheetApp.openById(ev.sheetId);
    const salesSheet = ss.getSheetByName('Sales');
    const existing = salesSheet.getDataRange().getValues();
    for (let i = 1; i < existing.length; i++) {
      if (String(existing[i][0]) === saleId) {
        return saleSummaries_(existing.filter(function (r, j) { return j === 0 || String(r[0]) === saleId; }), 1)[0];
      }
    }
    const s = readEventSettings_(ev.sheetId);
    const fx = Number(s['Exchange Rate (LBP per USD)']) || 0;
    if (!fx) throw userError_('Set the exchange rate in the event Settings tab first.', 'invalid');
    const maxDisc = Number(s['Max Discount %']) || 0;
    const approved = !!sale.approval && String(sale.approval) === managerPin_(s);
    if (sale.approval && !approved) throw userError_('The manager PIN is wrong.', 'invalid');
    let needsApproval = false;

    const seller = String(sale.seller || '').trim();
    if (activeStaffNames_(ss).indexOf(seller) < 0) throw userError_('Pick who made the sale.', 'invalid');

    const items = {};
    getInventory_(id).items.forEach(function (it) { items[it.ref] = it; });
    const orderDisc = Number(sale.discountPct || 0);
    if (!(orderDisc >= 0 && orderDisc <= 100)) throw userError_('Check the discount.', 'invalid');
    if (orderDisc > maxDisc) needsApproval = true;
    // lines: the same product can appear twice (e.g. 1 discounted + 1 at full price); identical lines are merged
    const lines = [];
    (sale.lines || []).forEach(function (l) {
      const ref = String(l.ref || '');
      const q = Math.round(Number(l.qty));
      if (!items[ref]) throw userError_('A product in this sale is not in the event listing anymore.', 'invalid');
      if (!(q >= 1 && q <= 999)) throw userError_('Check the quantities.', 'invalid');
      const d = orderDisc > 0 ? 0 : Number(l.discountPct || 0); // an order discount replaces item discounts
      if (!(d >= 0 && d <= 100)) throw userError_('Check the discount on "' + items[ref].name + '".', 'invalid');
      if (d > maxDisc) needsApproval = true;
      const round = d > 0 && l.roundDown !== false;
      const note = d > 0 ? String(l.note || '').slice(0, 120) : '';
      const same = lines.filter(function (x) { return x.ref === ref && x.disc === d && x.round === round && x.note === note; })[0];
      if (same) same.qty += q;
      else lines.push({ ref: ref, qty: q, disc: d, round: round, note: note });
    });
    if (!lines.length) throw userError_('The sale has no products.', 'invalid');
    if (needsApproval && !approved) throw userError_('A discount above ' + maxDisc + '% needs the manager PIN.', 'invalid');
    lines.forEach(function (l) {
      const gross = items[l.ref].price * l.qty;
      l.total = l.disc > 0 ? (l.round ? Math.floor(round2_(gross * (1 - l.disc / 100))) : round2_(gross * (1 - l.disc / 100))) : round2_(gross);
      l.pct = l.disc;
    });
    let total = round2_(lines.reduce(function (a, l) { return a + l.total; }, 0));
    if (orderDisc > 0) {
      const target = round2_(total * (1 - orderDisc / 100));
      const newTotal = sale.roundTotal !== false ? Math.floor(target) : target;
      // spread the order discount over the lines, the last line takes the cents
      let acc = 0;
      lines.forEach(function (l, i) {
        if (i < lines.length - 1) { l.total = round2_(l.total * newTotal / total); acc = round2_(acc + l.total); }
        else l.total = round2_(newTotal - acc);
        l.pct = orderDisc;
      });
      total = round2_(newTotal);
    }

    const method = sale.method;
    if (['Cash', 'Online', 'Split'].indexOf(method) < 0) throw userError_('Pick how the customer paid.', 'invalid');
    let online = 0;
    if (method === 'Online') online = total;
    if (method === 'Split') {
      online = round2_(Number(sale.onlineUsd) || 0);
      if (!(online > 0 && online < total)) throw userError_('For a split payment, the online part must be between $0 and the total.', 'invalid');
    }
    const cashDue = round2_(total - online);
    let recvUsd = 0, recvLbp = 0, changeUsd = 0, changeLbp = 0, rounding = 0;
    if (cashDue > 0) {
      recvUsd = Math.max(0, Number(sale.recvUsd) || 0);
      recvLbp = Math.max(0, Math.round(Number(sale.recvLbp) || 0));
      changeUsd = Math.max(0, Number(sale.changeUsd) || 0);
      changeLbp = Math.max(0, Math.round(Number(sale.changeLbp) || 0));
      const tolerance = LBP_STEP / fx + 0.005;
      const paid = recvUsd + recvLbp / fx;
      if (paid < cashDue - tolerance) throw userError_('The cash received is less than the amount due.', 'invalid');
      const changeDue = paid - cashDue;
      rounding = round2_(changeDue - changeUsd - changeLbp / fx);
      if (rounding < -tolerance) throw userError_('More change was given than due.', 'invalid');
      if (rounding > tolerance) throw userError_('Not enough change was given.', 'invalid');
    }

    const t = when_(sale.clientTime);
    const date = Utilities.formatDate(t, tz_(), 'yyyy-MM-dd');
    const time = Utilities.formatDate(t, tz_(), 'HH:mm');
    const loggedAt = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
    const note = [String(sale.note || '').slice(0, 200), needsApproval ? 'Discount approved with manager PIN' : ''].filter(Boolean).join(' | ');
    const rows = lines.map(function (l, i) {
      const it = items[l.ref];
      const first = i === 0;
      const lineNote = [first ? note : '', l.note].filter(Boolean).join(' | ');
      return [saleId, i + 1, date, time, seller, l.ref, it.name, it.category, l.qty, it.price, l.pct, l.total,
        method, first ? online : '', first ? recvUsd : '', first ? recvLbp : '', first ? changeUsd : '', first ? changeLbp : '',
        first ? rounding : '', round2_(l.total * VAT_PCT / (100 + VAT_PCT)), '', '', loggedAt, lineNote];
    });
    const start = salesSheet.getLastRow() + 1;
    salesSheet.getRange(start, 1, rows.length, 3).setNumberFormat('@');
    salesSheet.getRange(start, 4, rows.length, 1).setNumberFormat('@');
    salesSheet.getRange(start, 6, rows.length, 1).setNumberFormat('@');
    salesSheet.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
    return saleSummaries_([existing[0]].concat(rows), 1)[0];
  } finally {
    lock.releaseLock();
  }
}

/* A return: the customer brings items back. Stored as negative lines linked to the original sale,
   so stock goes back up and the cash handed back leaves the drawer. Safe to send twice. */
function recordReturn_(id, ret) {
  ret = ret || {};
  const retId = String(ret.id || '');
  if (!/^[A-Za-z0-9-]{6,40}$/.test(retId)) throw userError_('Bad return number.', 'invalid');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ev = openEventForWrite_(id);
    const ss = SpreadsheetApp.openById(ev.sheetId);
    const sh = ss.getSheetByName('Sales');
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === retId) {
        return saleSummaries_(rows.filter(function (r, j) { return j === 0 || String(r[0]) === retId; }), 1)[0];
      }
    }
    const saleId = String(ret.saleId || '');
    const orig = rows.filter(function (r, j) { return j > 0 && String(r[0]) === saleId; });
    if (!orig.length) throw userError_('The original sale was not found.', 'not_found');
    if (String(orig[0][24] || '').trim()) throw userError_('A return cannot be returned.', 'invalid');
    if (String(orig[0][20] || '').trim()) throw userError_('This sale was cancelled.', 'invalid');
    const summary = saleSummaries_([rows[0]].concat(rows.slice(1).filter(function (r) {
      return String(r[0]) === saleId || String(r[24]) === saleId;
    })), 1000).filter(function (x) { return x.id === saleId; })[0];

    const fx = Number(readEventSettings_(ev.sheetId)['Exchange Rate (LBP per USD)']) || 0;
    const lines = [];
    (ret.lines || []).forEach(function (l) {
      const ref = String(l.ref || '');
      const q = Math.round(Number(l.qty));
      if (!q) return;
      const o = orig.filter(function (r) { return String(r[5]) === ref; })[0];
      if (!o) throw userError_('An item in this return was not in the original sale.', 'invalid');
      const left = (Number(o[8]) || 0) - (summary.returned[ref] || 0);
      if (!(q >= 1 && q <= left)) throw userError_('You can return at most ' + left + ' of "' + o[6] + '".', 'invalid');
      lines.push({ o: o, qty: q, total: round2_((Number(o[11]) || 0) / (Number(o[8]) || 1) * q) });
    });
    if (!lines.length) throw userError_('Pick the items being returned.', 'invalid');
    const due = round2_(lines.reduce(function (a, l) { return a + l.total; }, 0));
    const rs = readEventSettings_(ev.sheetId);
    const limit = Number(masterSetting_('RETURN_APPROVAL_USD')) || 0;
    const retApproved = limit > 0 && due > limit;
    if (retApproved && String(ret.approval || '') !== managerPin_(rs)) {
      throw userError_(ret.approval ? 'The manager PIN is wrong.' : 'Returns above $' + limit + ' need the manager PIN.', 'invalid');
    }

    const method = ret.method === 'Online' ? 'Online' : 'Cash';
    let refundUsd = 0, refundLbp = 0, rounding = 0;
    if (method === 'Cash') {
      if (!fx) throw userError_('Set the exchange rate in the event Settings tab first.', 'invalid');
      refundUsd = Math.max(0, Number(ret.refundUsd) || 0);
      refundLbp = Math.max(0, Math.round(Number(ret.refundLbp) || 0));
      rounding = round2_(due - refundUsd - refundLbp / fx);
      if (Math.abs(rounding) > LBP_STEP / fx + 0.005) throw userError_('The refund given does not match the amount due.', 'invalid');
    }
    const t = when_(ret.clientTime);
    const date = Utilities.formatDate(t, tz_(), 'yyyy-MM-dd');
    const time = Utilities.formatDate(t, tz_(), 'HH:mm');
    const loggedAt = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
    const out = lines.map(function (l, i) {
      const o = l.o, first = i === 0;
      return [retId, i + 1, date, time, String(o[4]), String(o[5]), String(o[6]), String(o[7]), -l.qty, Number(o[9]) || 0, Number(o[10]) || 0, -l.total,
        method, first ? (method === 'Online' ? -due : 0) : '', first ? 0 : '', first ? 0 : '', first ? refundUsd : '', first ? refundLbp : '',
        first ? rounding : '', round2_(-l.total * VAT_PCT / (100 + VAT_PCT)), '', '', loggedAt,
        first ? [String(ret.note || '').slice(0, 200), retApproved ? 'Approved with manager PIN' : ''].filter(Boolean).join(' | ') : '', saleId];
    });
    const start = sh.getLastRow() + 1;
    sh.getRange(start, 1, out.length, 3).setNumberFormat('@');
    sh.getRange(start, 4, out.length, 1).setNumberFormat('@');
    sh.getRange(start, 6, out.length, 1).setNumberFormat('@');
    sh.getRange(start, 25, out.length, 1).setNumberFormat('@');
    sh.getRange(start, 1, out.length, out[0].length).setValues(out);
    return saleSummaries_([rows[0]].concat(out), 1)[0];
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ business days, counts, cash */

function nowStamp_(t) { return Utilities.formatDate(t || new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }

function saleStamp_(r) { return dateStr_(r[2]) + ' ' + timeStr_(r[3]); }

function needTab_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw userError_('This event was created with an older version of the app. Create a new event.', 'old_event');
  return sh;
}

function dayState_(ss) {
  const sh = ss.getSheetByName('Days');
  if (!sh) return { open: false, number: 0, next: 1, counts: {} };
  const rows = sh.getDataRange().getValues().slice(1).filter(function (r) { return String(r[0]).trim(); });
  const last = rows[rows.length - 1];
  const open = !!last && String(last[19]) === 'Open';
  const number = open ? Number(last[0]) : 0;
  const tag = open ? number : rows.length + 1; // counts before "Start day" belong to the coming day
  const purposeWanted = open ? 'Closing' : 'Opening';
  const counts = { cash: false, stock: false };
  needTab_(ss, 'Cash').getDataRange().getValues().slice(1).forEach(function (r) {
    if (String(r[2]) === 'Count' && Number(r[13]) === tag && String(r[12]) === purposeWanted) counts.cash = true;
  });
  needTab_(ss, 'Counts').getDataRange().getValues().slice(1).forEach(function (r) {
    if (Number(r[12]) === tag && String(r[11]) === purposeWanted) counts.stock = true;
  });
  return { open: open, number: number, next: rows.length + 1, tag: tag, openedAt: open ? String(last[2]) : '', openedBy: open ? String(last[3]) : '',
    counts: counts, countsFor: purposeWanted, lastClosedAt: !open && last ? String(last[4]) : '' };
}

/* What should be in the drawer: opening cash + cash taken − change and refunds given − handovers. */
function expectedCash_(ss, settings, asOf) {
  let usd = Number(settings['Opening Cash USD']) || 0;
  let lbp = Number(settings['Opening Cash LBP']) || 0;
  ss.getSheetByName('Sales').getDataRange().getValues().slice(1).forEach(function (r) {
    if (Number(r[1]) !== 1 || String(r[20] || '').trim()) return;
    if (asOf && saleStamp_(r) > asOf) return;
    usd += (Number(r[14]) || 0) - (Number(r[16]) || 0);
    lbp += (Number(r[15]) || 0) - (Number(r[17]) || 0);
  });
  const cash = ss.getSheetByName('Cash');
  if (cash) cash.getDataRange().getValues().slice(1).forEach(function (r) {
    if (String(r[2]) !== 'Handover') return;
    if (asOf && String(r[1]) > asOf) return;
    usd -= Number(r[3]) || 0;
    lbp -= Number(r[4]) || 0;
  });
  return { usd: round2_(usd), lbp: Math.round(lbp) };
}

function idCheck_(id, what) {
  id = String(id || '');
  if (!/^[A-Za-z0-9-]{6,40}$/.test(id)) throw userError_('Bad ' + what + ' number.', 'invalid');
  return id;
}

function alreadyIn_(sh, id) {
  return sh.getDataRange().getValues().slice(1).some(function (r) { return String(r[0]) === id; });
}

function purpose_(p) { return ['Opening', 'Closing', 'Spot'].indexOf(p) >= 0 ? p : 'Spot'; }

/* Stock count: one row per product, expected worked out at the moment of the count. */
function recordCount_(id, c) {
  c = c || {};
  const cid = idCheck_(c.id, 'count');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ev = openEventForWrite_(id);
    const ss = SpreadsheetApp.openById(ev.sheetId);
    const sh = needTab_(ss, 'Counts');
    const by = String(c.countedBy || '').trim();
    if (activeStaffNames_(ss).indexOf(by) < 0) throw userError_('Pick who counted.', 'invalid');
    const t = when_(c.clientTime);
    const stamp = nowStamp_(t);
    const items = {};
    getInventory_(id, stamp).items.forEach(function (it) { items[it.ref] = it; });
    const state = dayState_(ss);
    const purpose = purpose_(c.purpose);
    let rows = [];
    const result = [];
    (c.lines || []).forEach(function (l) {
      const it = items[String(l.ref)];
      if (!it) return;
      const hasS = l.sellable !== '' && l.sellable != null, hasD = l.demo !== '' && l.demo != null;
      if (!hasS && !hasD) return;
      const cs = hasS ? Math.round(Number(l.sellable)) : '', cd = hasD ? Math.round(Number(l.demo)) : '';
      const ds = hasS ? cs - it.live : '', dd = hasD ? cd - it.demo : '';
      rows.push([cid, stamp, it.ref, it.name, it.live, cs, ds, it.demo, cd, dd, by, purpose, state.tag]);
      result.push({ ref: it.ref, diffSellable: ds, diffDemo: dd });
    });
    if (!rows.length) throw userError_('Enter at least one quantity.', 'invalid');
    if (!alreadyIn_(sh, cid)) {
      const start = sh.getLastRow() + 1;
      sh.getRange(start, 1, rows.length, 4).setNumberFormat('@');
      sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
    }
    const off = result.filter(function (x) { return (x.diffSellable || 0) !== 0 || (x.diffDemo || 0) !== 0; }).length;
    return { id: cid, purpose: purpose, day: state.tag, lines: result, productsOff: off };
  } finally {
    lock.releaseLock();
  }
}

/* Cash count (by banknotes) or handover. A count reports only whether it matches, never the expected amount. */
function recordCash_(id, c) {
  c = c || {};
  const eid = idCheck_(c.id, 'cash entry');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ev = openEventForWrite_(id);
    const ss = SpreadsheetApp.openById(ev.sheetId);
    const sh = needTab_(ss, 'Cash');
    const t = when_(c.clientTime);
    const stamp = nowStamp_(t);
    const by = String(c.by || '').trim().slice(0, 80);
    const usd = round2_(Math.max(0, Number(c.usd) || 0));
    const lbp = Math.max(0, Math.round(Number(c.lbp) || 0));
    const state = dayState_(ss);
    if (c.kind === 'handover') {
      const to = String(c.to || '').trim().slice(0, 80);
      if (!to) throw userError_('Who collected the cash?', 'invalid');
      if (!usd && !lbp) throw userError_('Enter the amount handed over.', 'invalid');
      if (!alreadyIn_(sh, eid)) {
        sh.appendRow([eid, stamp, 'Handover', usd, lbp, by, to, String(c.note || '').slice(0, 200), '', '', '', '', '', state.tag, '']);
      }
      return { id: eid, kind: 'handover' };
    }
    if (activeStaffNames_(ss).indexOf(by) < 0) throw userError_('Pick who counted.', 'invalid');
    const exp = expectedCash_(ss, readEventSettings_(ev.sheetId), stamp);
    const diffUsd = round2_(usd - exp.usd), diffLbp = lbp - exp.lbp;
    const purpose = purpose_(c.purpose);
    if (!alreadyIn_(sh, eid)) {
      sh.appendRow([eid, stamp, 'Count', usd, lbp, by, '', String(c.note || '').slice(0, 200), exp.usd, exp.lbp, diffUsd, diffLbp, purpose, state.tag,
        JSON.stringify(c.banknotes || {}).slice(0, 500)]);
    } else {
      const row = sh.getDataRange().getValues().filter(function (r) { return String(r[0]) === eid; })[0];
      return { id: eid, kind: 'count', diffUsd: Number(row[10]), diffLbp: Number(row[11]), purpose: String(row[12]) };
    }
    return { id: eid, kind: 'count', diffUsd: diffUsd, diffLbp: diffLbp, purpose: purpose };
  } finally {
    lock.releaseLock();
  }
}

function latestCash_(rows, day, purpose) {
  const m = rows.filter(function (r) { return String(r[2]) === 'Count' && Number(r[13]) === day && String(r[12]) === purpose; });
  return m.length ? m[m.length - 1] : null;
}

function latestStock_(rows, day, purpose) {
  const m = rows.filter(function (r) { return Number(r[12]) === day && String(r[11]) === purpose; });
  if (!m.length) return null;
  const lastId = String(m[m.length - 1][0]);
  const lines = m.filter(function (r) { return String(r[0]) === lastId; });
  return {
    net: lines.reduce(function (a, r) { return a + (Number(r[6]) || 0); }, 0),
    demoMissing: lines.reduce(function (a, r) { return a + Math.max(0, -(Number(r[9]) || 0)); }, 0)
  };
}

/* Start day / Close day. Closing writes the day's report row in the Days tab. */
function dayAction_(id, d) {
  d = d || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ev = openEventForWrite_(id);
    const ss = SpreadsheetApp.openById(ev.sheetId);
    const sh = needTab_(ss, 'Days');
    const state = dayState_(ss);
    const by = String(d.by || '').trim().slice(0, 80);
    const t = when_(d.clientTime);
    const stamp = nowStamp_(t);
    const cashRows = needTab_(ss, 'Cash').getDataRange().getValues().slice(1);
    const countRows = needTab_(ss, 'Counts').getDataRange().getValues().slice(1);
    if (d.action === 'open') {
      if (state.open) return dayState_(ss); // already open (e.g. sent twice)
      const oc = latestCash_(cashRows, state.next, 'Opening');
      const os = latestStock_(countRows, state.next, 'Opening');
      const r = sh.getLastRow() + 1;
      sh.getRange(r, 1, 1, 20).setNumberFormat('@').setValues([[String(state.next), stamp.slice(0, 10), stamp, by, '', '',
        oc ? oc[10] : '', oc ? oc[11] : '', os ? os.net : '', '', '', '', '', '', '', '', '', '', '', 'Open']]);
      return dayState_(ss);
    }
    if (d.action === 'close') {
      if (!state.open) return dayState_(ss);
      const rows = sh.getDataRange().getValues();
      const rowIdx = rows.length; // last row is the open day
      const day = state.number;
      const cc = latestCash_(cashRows, day, 'Closing');
      const cs = latestStock_(countRows, day, 'Closing');
      // start of the day: its opening count, else the previous day's closing count
      const prev = rows[rowIdx - 2] && Number(rows[rowIdx - 2][0]) ? rows[rowIdx - 2] : null;
      const openRow = rows[rowIdx - 1];
      const startUsd = openRow[6] !== '' ? Number(openRow[6]) : (prev && prev[9] !== '' ? Number(prev[9]) : null);
      const startLbp = openRow[7] !== '' ? Number(openRow[7]) : (prev && prev[10] !== '' ? Number(prev[10]) : null);
      const startStock = openRow[8] !== '' ? Number(openRow[8]) : (prev && prev[11] !== '' ? Number(prev[11]) : null);
      let sales = 0, online = 0, units = 0;
      ss.getSheetByName('Sales').getDataRange().getValues().slice(1).forEach(function (r) {
        if (String(r[20] || '').trim()) return;
        const st = saleStamp_(r);
        if (st < state.openedAt || st > stamp) return;
        sales += Number(r[11]) || 0;
        units += Number(r[8]) || 0;
        if (Number(r[1]) === 1) online += Number(r[13]) || 0;
      });
      const v = function (a, b) { return a === null || b === null || b === '' ? '' : round2_(Number(b) - a); };
      const demo = demoTotals_(ss, day);
      ensureHeaders_(sh, DAYS_HEADERS);
      sh.getRange(rowIdx, 5, 1, 19).setValues([[stamp, by,
        openRow[6], openRow[7], openRow[8],
        cc ? cc[10] : '', cc ? cc[11] : '', cs ? cs.net : '',
        cc ? v(startUsd, cc[10]) : '', cc ? v(startLbp, cc[11]) : '', cs ? v(startStock, cs.net) : '',
        cs ? cs.demoMissing : '', round2_(sales), round2_(online), units, 'Closed',
        String(d.notes || '').slice(0, 1000), demo.plays, demo.customers]]);
      try { pnl_(id, true); } catch (e) { console.error(e); } // refresh the P&L and Sales Tracker tabs
      return dayState_(ss);
    }
    throw userError_('Start or close the day?', 'invalid');
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ customers, refill requests, demo counter */

function clientStamp_(c) { return nowStamp_(when_(c && c.clientTime)); }

/* Optional customer contact, from checkout or from the Customers box. */
function recordCustomer_(id, c) {
  c = c || {};
  const cid = idCheck_(c.id, 'customer');
  const name = String(c.name || '').trim().slice(0, 80), phone = String(c.phone || '').trim().slice(0, 40), email = String(c.email || '').trim().slice(0, 120);
  if (!name && !phone && !email) throw userError_('Enter a name, phone or email.', 'invalid');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ev = openEventForWrite_(id);
    const ss = SpreadsheetApp.openById(ev.sheetId);
    const sh = lateTab_(ss, 'Customers');
    if (!alreadyIn_(sh, cid)) {
      const r = sh.getLastRow() + 1;
      sh.getRange(r, 1, 1, 9).setNumberFormat('@').setValues([[cid, clientStamp_(c), name, phone, email, String(c.note || '').slice(0, 200),
        String(c.saleId || '').slice(0, 40), String(c.by || '').slice(0, 80), String(dayState_(ss).tag)]]);
    }
    return { id: cid };
  } finally {
    lock.releaseLock();
  }
}

/* Refill request from the stock count page: one row per product. */
function recordRefill_(id, r) {
  r = r || {};
  const rid = idCheck_(r.id, 'refill request');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ev = openEventForWrite_(id);
    const ss = SpreadsheetApp.openById(ev.sheetId);
    const sh = lateTab_(ss, 'Refills');
    const items = {};
    getInventory_(id).items.forEach(function (it) { items[it.ref] = it; });
    const by = String(r.by || '').trim().slice(0, 80);
    const stamp = clientStamp_(r), day = String(dayState_(ss).tag), note = String(r.note || '').slice(0, 300);
    const rows = (r.lines || []).filter(function (l) { return items[String(l.ref)] && Math.round(Number(l.qty)) > 0; }).map(function (l) {
      const it = items[String(l.ref)];
      return [rid, stamp, by, it.ref, it.name, Math.round(Number(l.qty)), note, day, 'Requested'];
    });
    if (!rows.length && !note) throw userError_('Enter the quantities to refill.', 'invalid');
    if (!rows.length) rows.push([rid, stamp, by, '', '', '', note, day, 'Requested']);
    if (!alreadyIn_(sh, rid)) {
      const start = sh.getLastRow() + 1;
      sh.getRange(start, 1, rows.length, 9).setNumberFormat('@');
      sh.getRange(start, 1, rows.length, 9).setValues(rows);
    }
    return { id: rid, lines: rows.length };
  } finally {
    lock.releaseLock();
  }
}

function readRefills_(ss) {
  const sh = ss.getSheetByName('Refills');
  if (!sh) return [];
  const by = {}, order = [];
  sh.getDataRange().getValues().slice(1).forEach(function (r, i) {
    const id = String(r[0] || '').trim();
    if (!id) return;
    if (!by[id]) { by[id] = { id: id, at: String(r[1]), by: String(r[2]), note: String(r[6] || ''), day: String(r[7] || ''), status: String(r[8] || 'Requested'), lines: [] }; order.push(id); }
    if (String(r[3] || '').trim()) by[id].lines.push({ ref: String(r[3]), name: String(r[4]), qty: Number(r[5]) || 0, row: i + 2 });
  });
  return order.reverse().map(function (k) { return by[k]; });
}

/* Management: mark a refill request done, optionally adding its quantities to Stock Moves. */
function setRefill_(id, requestId, status, toStock) {
  const ev = rowToEvent_(findEventRow_(id).values);
  const ss = SpreadsheetApp.openById(ev.sheetId);
  const sh = lateTab_(ss, 'Refills');
  const req = readRefills_(ss).filter(function (x) { return x.id === String(requestId); })[0];
  if (!req) throw userError_('Refill request not found.', 'not_found');
  const st = status === 'Requested' ? 'Requested' : 'Done';
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === req.id) sh.getRange(i + 1, 9).setValue(st);
  if (toStock && st === 'Done' && req.status !== 'Done' && req.lines.length) {
    const moves = ss.getSheetByName('Stock Moves');
    const today = nowStamp_().slice(0, 10);
    const start = Math.max(lastFilled_(moves, 1), lastFilled_(moves, 3)) + 1;
    moves.getRange(start, 1, req.lines.length, 1).setNumberFormat('@');
    moves.getRange(start, 1, req.lines.length, 1).setValues(req.lines.map(function () { return [today]; }));
    moves.getRange(start, 3, req.lines.length, 3).setValues(req.lines.map(function (l) { return [l.name, l.qty, 'Refill request ' + req.id]; }));
  }
  req.status = st;
  return req;
}

/* last row with a value in one column (Stock Moves has a header formula in B that fills the column) */
function lastFilled_(sh, col) {
  const v = sh.getRange(1, col, Math.max(1, sh.getLastRow()), 1).getValues();
  for (let i = v.length - 1; i >= 0; i--) if (String(v[i][0]).trim()) return i + 1;
  return 1;
}

/* Demo counter: plays per demo product and customers activated, saved from a phone (at Close day or with Save). */
function recordDemo_(id, d) {
  d = d || {};
  const did = idCheck_(d.id, 'demo entry');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ev = openEventForWrite_(id);
    const ss = SpreadsheetApp.openById(ev.sheetId);
    const sh = lateTab_(ss, 'Demos');
    if (alreadyIn_(sh, did)) return { id: did };
    const names = {};
    getInventory_(id).items.forEach(function (it) { names[it.ref] = it.name; });
    const stamp = clientStamp_(d);
    const state = dayState_(ss);
    const day = d.day ? String(d.day) : String(state.tag);
    const by = String(d.by || '').slice(0, 80);
    const rows = [];
    Object.keys(d.plays || {}).forEach(function (ref) {
      const n = Math.round(Number(d.plays[ref]));
      if (n > 0 && names[ref]) rows.push([did, stamp, day, ref, names[ref], n, by]);
    });
    const cust = Math.round(Number(d.customers) || 0);
    if (cust > 0) rows.push([did, stamp, day, '', 'Customers activated', cust, by]);
    if (!rows.length) return { id: did, empty: true };
    const start = sh.getLastRow() + 1;
    sh.getRange(start, 1, rows.length, 7).setNumberFormat('@');
    sh.getRange(start, 1, rows.length, 7).setValues(rows);
    return { id: did, lines: rows.length };
  } finally {
    lock.releaseLock();
  }
}

/* plays and customers activated for one business day (or the whole event when day is null) */
function demoTotals_(ss, day) {
  const sh = ss.getSheetByName('Demos');
  const out = { plays: 0, customers: 0, byProduct: {} };
  if (!sh) return out;
  sh.getDataRange().getValues().slice(1).forEach(function (r) {
    if (!String(r[0]).trim()) return;
    if (day != null && Number(r[2]) !== Number(day)) return;
    const n = Number(r[5]) || 0;
    if (!String(r[3]).trim()) { out.customers += n; return; }
    out.plays += n;
    const k = String(r[3]);
    out.byProduct[k] = out.byProduct[k] || { ref: k, name: String(r[4]), plays: 0 };
    out.byProduct[k].plays += n;
  });
  return out;
}

/* Figures for the WhatsApp summary of a business day (the open day, or the given / last closed one). */
function daySummary_(id, dayNumber) {
  const ev = rowToEvent_(findEventRow_(id).values);
  const ss = SpreadsheetApp.openById(ev.sheetId);
  const settings = readEventSettings_(ev.sheetId);
  const days = needTab_(ss, 'Days').getDataRange().getValues().slice(1).filter(function (r) { return String(r[0]).trim(); });
  let row = dayNumber ? days.filter(function (r) { return Number(r[0]) === Number(dayNumber); })[0] : days[days.length - 1];
  const from = row ? String(row[2]) : '0000';
  const to = row && String(row[19]) === 'Closed' ? String(row[4]) : nowStamp_();
  let sales = 0, online = 0, units = 0, returns = 0;
  const tickets = {}, prods = {}, sellers = {};
  ss.getSheetByName('Sales').getDataRange().getValues().slice(1).forEach(function (r) {
    if (!String(r[0]).trim() || String(r[20] || '').trim()) return;
    const st = saleStamp_(r);
    if (st < from || st > to) return;
    const t = Number(r[11]) || 0, q = Number(r[8]) || 0;
    sales += t; units += q;
    if (t < 0) returns += -t;
    if (Number(r[1]) === 1) online += Number(r[13]) || 0;
    if (q > 0 && !String(r[24] || '').trim()) tickets[String(r[0])] = true;
    const k = String(r[5]);
    prods[k] = prods[k] || { name: String(r[6]), units: 0, sales: 0 };
    prods[k].units += q; prods[k].sales = round2_(prods[k].sales + t);
    const se = String(r[4] || '');
    sellers[se] = sellers[se] || { name: se, units: 0, sales: 0 };
    sellers[se].units += q; sellers[se].sales = round2_(sellers[se].sales + t);
  });
  const dayNo = row ? Number(row[0]) : null;
  const demo = dayNo ? demoTotals_(ss, dayNo) : { plays: 0, customers: 0, byProduct: {} };
  const refills = readRefills_(ss).filter(function (x) { return dayNo && Number(x.day) === dayNo; });
  const custSh = ss.getSheetByName('Customers');
  const contacts = custSh ? custSh.getDataRange().getValues().slice(1).filter(function (r) { return String(r[0]).trim() && dayNo && Number(r[8]) === dayNo; }).length : 0;
  const n = Object.keys(tickets).length;
  return {
    event: ev.name, venue: ev.venue, day: dayNo, date: row ? String(row[1]) : nowStamp_().slice(0, 10),
    status: row ? String(row[19]) : 'Not started', openedAt: row ? String(row[2]) : '', closedAt: row ? String(row[4]) : '',
    sales: round2_(sales), online: round2_(online), cash: round2_(sales - online), units: units, tickets: n, avgTicket: n ? round2_(sales / n) : 0,
    returns: round2_(returns),
    targetQty: Number(settings['Daily Target Qty']) || null, targetSales: Number(settings['Daily Target Sales (USD)']) || null,
    products: Object.keys(prods).map(function (k) { return prods[k]; }).filter(function (p) { return p.units > 0; })
      .sort(function (a, b) { return b.units - a.units || b.sales - a.sales; }).slice(0, 6),
    sellers: Object.keys(sellers).map(function (k) { return sellers[k]; }).filter(function (p) { return p.name; }).sort(function (a, b) { return b.sales - a.sales; }),
    demoPlays: demo.plays, customersActivated: demo.customers, contacts: contacts,
    demoTop: Object.keys(demo.byProduct).map(function (k) { return demo.byProduct[k]; }).sort(function (a, b) { return b.plays - a.plays; }).slice(0, 5),
    refills: refills.map(function (x) { return { by: x.by, note: x.note, lines: x.lines.map(function (l) { return { name: l.name, qty: l.qty }; }) }; }),
    cashDiffUsd: row && row[12] !== '' ? Number(row[12]) : null, cashDiffLbp: row && row[13] !== '' ? Number(row[13]) : null,
    stockDiff: row && row[14] !== '' ? Number(row[14]) : null, notes: row ? String(row[20] || '') : ''
  };
}

/* Events home: one line per running event (today's sales, drawer, people on shift, warnings). */
function overview_() {
  const today = nowStamp_().slice(0, 10);
  const warnUsd = Number(masterSetting_('CASH_WARN_USD')) || 0, warnLbp = Number(masterSetting_('CASH_WARN_LBP')) || 0;
  return listEvents_().filter(function (ev) {
    return ev.status === 'Open' && ev.sheetId && ev.startDate <= today && today <= ev.endDate;
  }).map(function (ev) {
    try {
      const ss = SpreadsheetApp.openById(ev.sheetId);
      const s = readEventSettings_(ev.sheetId);
      let sales = 0, units = 0;
      const tickets = {};
      ss.getSheetByName('Sales').getDataRange().getValues().slice(1).forEach(function (r) {
        if (!String(r[0]).trim() || String(r[20] || '').trim() || dateStr_(r[2]) !== today) return;
        sales += Number(r[11]) || 0; units += Number(r[8]) || 0;
        if ((Number(r[8]) || 0) > 0 && !String(r[24] || '').trim()) tickets[String(r[0])] = true;
      });
      const cash = expectedCash_(ss, s, null);
      const day = dayState_(ss);
      const refills = readRefills_(ss).filter(function (x) { return x.status !== 'Done'; }).length;
      return { id: ev.id, name: ev.name, sales: round2_(sales), units: units, tickets: Object.keys(tickets).length,
        cash: cash, cashWarn: (warnUsd && cash.usd > warnUsd) || (warnLbp && cash.lbp > warnLbp),
        dayOpen: day.open, dayNumber: day.open ? day.number : day.next - 1, onShift: openShifts_(ss).map(function (x) { return x.name; }),
        refills: refills, targetSales: Number(s['Daily Target Sales (USD)']) || null, targetQty: Number(s['Daily Target Qty']) || null };
    } catch (e) {
      return { id: ev.id, name: ev.name, error: String(e && e.message || e) };
    }
  });
}

/* ------------------------------------------------------------------ catalogue extras: barcodes, names (cached 6 h) */

function cachedJson_(key, seconds, build) {
  const cache = CacheService.getScriptCache();
  const head = cache.get(key + '_n');
  if (head !== null) {
    const keys = [];
    for (let i = 0; i < Number(head); i++) keys.push(key + '_' + i);
    const got = cache.getAll(keys);
    let json = '', complete = true;
    keys.forEach(function (k) { if (got[k] == null) complete = false; else json += got[k]; });
    if (complete) { try { return JSON.parse(json); } catch (e) { /* rebuild */ } }
  }
  const value = build();
  const json = JSON.stringify(value);
  const chunks = {};
  let n = 0;
  for (let i = 0; i < json.length; i += 90000) chunks[key + '_' + (n++)] = json.slice(i, i + 90000);
  chunks[key + '_n'] = String(n);
  try { cache.putAll(chunks, seconds); } catch (e) { /* cache is a bonus */ }
  return value;
}

/* every barcode of the SHN Catalogue (Barcode (Latest), Barcode 2, 3, 4), by Ref Code */
function catalogueBarcodes_() {
  return cachedJson_('barcodes', 21600, function () {
    const sheet = SpreadsheetApp.openById(String(masterSetting_('CATALOG_SHEET_ID')).trim()).getSheets()[0];
    const values = sheet.getDataRange().getValues();
    const head = values[0].map(normKey_);
    const refIx = head.indexOf(normKey_(CATALOG_COLS.ref));
    const cols = [];
    head.forEach(function (h, i) { if (/^barcode/.test(h)) cols.push(i); });
    const map = {};
    values.slice(1).forEach(function (r) {
      const ref = String(r[refIx] || '').trim();
      if (!ref) return;
      cols.forEach(function (c) {
        const raw = r[c];
        const code = typeof raw === 'number' ? raw.toFixed(0) : String(raw || '').replace(/\s+/g, '').trim();
        if (!code || code === '0') return;
        map[ref] = map[ref] || [];
        if (map[ref].indexOf(code) < 0) map[ref].push(code);
      });
    });
    return map;
  });
}

let BARCODES_ = null;
function barcodesOf_(ref) {
  if (BARCODES_ === null) { try { BARCODES_ = catalogueBarcodes_(); } catch (e) { BARCODES_ = {}; } }
  return BARCODES_[ref] || [];
}

function withBarcodes_(inv) {
  inv.items.forEach(function (it) { it.barcodes = barcodesOf_(it.ref); });
  return inv;
}

function catalogueNames_() {
  return cachedJson_('catnames', 21600, function () { return loadCatalogue_().map(function (r) { return r[0]; }); });
}

/* For the management tabs: cash, shifts and pay, counts, days. */
function eventReport_(id) {
  const ev = rowToEvent_(findEventRow_(id).values);
  const ss = SpreadsheetApp.openById(ev.sheetId);
  const settings = readEventSettings_(ev.sheetId);
  const staff = readStaff_(ss);
  const byName = {};
  staff.forEach(function (p) { byName[p.name] = p; });
  const sales = ss.getSheetByName('Sales').getDataRange().getValues().slice(1);

  // cash
  let recvUsd = 0, recvLbp = 0, chUsd = 0, chLbp = 0, online = 0;
  sales.forEach(function (r) {
    if (Number(r[1]) !== 1 || String(r[20] || '').trim()) return;
    recvUsd += Number(r[14]) || 0; recvLbp += Number(r[15]) || 0;
    chUsd += Number(r[16]) || 0; chLbp += Number(r[17]) || 0; online += Number(r[13]) || 0;
  });
  const cashRows = (ss.getSheetByName('Cash') ? ss.getSheetByName('Cash').getDataRange().getValues().slice(1) : []).filter(function (r) { return String(r[0]).trim(); });
  const handovers = cashRows.filter(function (r) { return String(r[2]) === 'Handover'; }).map(function (r) {
    return { at: String(r[1]), usd: Number(r[3]) || 0, lbp: Number(r[4]) || 0, by: String(r[5]), to: String(r[6]), note: String(r[7]), day: r[13] };
  });
  const counts = cashRows.filter(function (r) { return String(r[2]) === 'Count'; }).map(function (r) {
    return { at: String(r[1]), usd: Number(r[3]) || 0, lbp: Number(r[4]) || 0, by: String(r[5]), expUsd: Number(r[8]) || 0, expLbp: Number(r[9]) || 0,
      diffUsd: Number(r[10]) || 0, diffLbp: Number(r[11]) || 0, purpose: String(r[12]), day: r[13] };
  });

  // commission per seller per day, on the price actually paid
  const comm = {}, unitsBy = {};
  sales.forEach(function (r) {
    if (String(r[20] || '').trim()) return;
    const q = Number(r[8]) || 0;
    if (!q) return;
    const p = byName[String(r[4])];
    if (!p) return;
    const unitPaid = Math.abs(Number(r[11]) || 0) / Math.abs(q);
    const rate = unitPaid >= commissionThreshold_(settings, p) ? p.commissionOver : p.commissionUnder;
    const k = dateStr_(r[2]) + '|' + p.name;
    comm[k] = round2_((comm[k] || 0) + rate * q);
    unitsBy[k] = (unitsBy[k] || 0) + q;
  });

  // shifts → hours per person per day
  const shiftRows = ss.getSheetByName('Shifts').getDataRange().getValues().slice(1).filter(function (r) { return String(r[1]).trim(); });
  const days = {};
  shiftRows.forEach(function (r, i) {
    const k = dateStr_(r[0]) + '|' + String(r[1]).trim();
    const d = days[k] = days[k] || { date: dateStr_(r[0]), name: String(r[1]).trim(), shifts: [], hours: 0, notes: [], open: false };
    const hours = Number(r[4]) || 0;
    d.shifts.push({ in: String(r[2]).slice(11), out: String(r[3]).slice(11), hours: hours, row: i + 2 });
    d.hours = round2_(d.hours + hours);
    if (String(r[5]).trim()) d.notes.push(String(r[5]));
    if (String(r[2]).trim() && !String(r[3]).trim()) d.open = true;
  });
  Object.keys(comm).forEach(function (k) {
    if (!days[k]) { const parts = k.split('|'); days[k] = { date: parts[0], name: parts[1], shifts: [], hours: 0, notes: [], open: false }; }
  });
  const pay = Object.keys(days).map(function (k) {
    const d = days[k];
    const p = byName[d.name] || { hourlyRate: 0 };
    d.rate = p.hourlyRate;
    d.hoursCost = round2_(d.hours * p.hourlyRate);
    d.commission = comm[k] || 0;
    d.units = unitsBy[k] || 0;
    d.pay = round2_(d.hoursCost + d.commission);
    return d;
  }).sort(function (a, b) { return a.date === b.date ? (a.name < b.name ? -1 : 1) : (a.date < b.date ? 1 : -1); });

  // latest stock count per product
  const countRows = ss.getSheetByName('Counts') ? ss.getSheetByName('Counts').getDataRange().getValues().slice(1).filter(function (r) { return String(r[0]).trim(); }) : [];
  const lastCount = {};
  countRows.forEach(function (r) {
    lastCount[String(r[2])] = { at: String(r[1]), by: String(r[10]), purpose: String(r[11]), diffSellable: r[6] === '' ? null : Number(r[6]), diffDemo: r[9] === '' ? null : Number(r[9]) };
  });
  const dayRows = ss.getSheetByName('Days') ? ss.getSheetByName('Days').getDataRange().getValues().slice(1).filter(function (r) { return String(r[0]).trim(); }) : [];

  return {
    cash: {
      opening: { usd: Number(settings['Opening Cash USD']) || 0, lbp: Number(settings['Opening Cash LBP']) || 0 },
      received: { usd: round2_(recvUsd), lbp: Math.round(recvLbp) }, given: { usd: round2_(chUsd), lbp: Math.round(chLbp) },
      handedOver: { usd: round2_(handovers.reduce(function (a, h) { return a + h.usd; }, 0)), lbp: handovers.reduce(function (a, h) { return a + h.lbp; }, 0) },
      expected: expectedCash_(ss, settings, null), online: round2_(online), handovers: handovers.reverse(), counts: counts.reverse()
    },
    pay: pay,
    lastCount: lastCount,
    days: dayRows.map(function (r) {
      return { day: r[0], date: String(r[1]), openedAt: String(r[2]), openedBy: String(r[3]), closedAt: String(r[4]), closedBy: String(r[5]),
        openCashUsd: r[6], openCashLbp: r[7], openStock: r[8], closeCashUsd: r[9], closeCashLbp: r[10], closeStock: r[11],
        varUsd: r[12], varLbp: r[13], varStock: r[14], demoMissing: r[15], sales: r[16], online: r[17], units: r[18], status: String(r[19]),
        notes: String(r[20] || ''), demoPlays: r[21] === undefined ? '' : r[21], customersActivated: r[22] === undefined ? '' : r[22] };
    }).reverse(),
    refills: readRefills_(ss),
    customers: (ss.getSheetByName('Customers') ? ss.getSheetByName('Customers').getDataRange().getValues().slice(1) : [])
      .filter(function (r) { return String(r[0]).trim(); }).map(function (r) {
        return { at: String(r[1]), name: String(r[2]), phone: String(r[3]), email: String(r[4]), note: String(r[5]), saleId: String(r[6]), by: String(r[7]) };
      }).reverse(),
    demo: demoTotals_(ss, null),
    fxRate: Number(settings['Exchange Rate (LBP per USD)']) || 0
  };
}

/* ------------------------------------------------------------------ expenses, P&L, dashboard, Sales Tracker */

function readExpenses_(ss, fx) {
  const sh = ss.getSheetByName('Expenses');
  if (!sh) return [];
  return sh.getDataRange().getValues().slice(1).filter(function (r) { return String(r[2] || r[3]).trim(); }).map(function (r, i) {
    const usd = Number(r[4]) || 0, lbp = Number(r[5]) || 0;
    return { id: String(r[0] || ''), row: i + 2, date: dateStr_(r[1]), type: String(r[2] || 'Other'), description: String(r[3] || ''),
      usd: usd, lbp: lbp, total: round2_(usd + (fx ? lbp / fx : 0)) };
  });
}

function addExpense_(id, e) {
  e = e || {};
  const ev = rowToEvent_(findEventRow_(id).values);
  const ss = SpreadsheetApp.openById(ev.sheetId);
  const sh = needTab_(ss, 'Expenses');
  const fx = Number(readEventSettings_(ev.sheetId)['Exchange Rate (LBP per USD)']) || 0;
  const usd = round2_(Math.max(0, Number(e.usd) || 0)), lbp = Math.max(0, Math.round(Number(e.lbp) || 0));
  if (!usd && !lbp) throw userError_('Enter an amount.', 'invalid');
  const date = isIsoDate_(String(e.date || '')) ? String(e.date) : nowStamp_().slice(0, 10);
  const type = String(e.type || 'Other').trim().slice(0, 40) || 'Other';
  const xid = 'X' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  const r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, 2).setNumberFormat('@');
  sh.getRange(r, 1, 1, 8).setValues([[xid, date, type, String(e.description || '').slice(0, 200), usd, lbp, round2_(usd + (fx ? lbp / fx : 0)), nowStamp_()]]);
  return { id: xid, date: date, type: type, usd: usd, lbp: lbp };
}

function deleteExpense_(id, xid) {
  const ev = rowToEvent_(findEventRow_(id).values);
  const sh = needTab_(SpreadsheetApp.openById(ev.sheetId), 'Expenses');
  const rows = sh.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(xid)) { sh.deleteRow(i + 1); return true; }
  }
  throw userError_('Expense not found.', 'not_found');
}

function fmtTrackerDate_(iso) {
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = String(iso).split('-');
  return p.length === 3 ? Number(p[2]) + '-' + m[Number(p[1]) - 1] + '-' + p[0].slice(2) : String(iso);
}

/* The P&L (and dashboard figures). With writeSheet, also rewrites the P&L and Sales Tracker tabs. */
function pnl_(id, writeSheet) {
  const ev = rowToEvent_(findEventRow_(id).values);
  const ss = SpreadsheetApp.openById(ev.sheetId);
  const settings = readEventSettings_(ev.sheetId);
  const fx = Number(settings['Exchange Rate (LBP per USD)']) || 0;
  const cogsPct = Number(settings['COGS %']) || 0;
  const inv = getInventory_(id);
  const items = {};
  inv.items.forEach(function (it) { items[it.ref] = it; });
  const sales = ss.getSheetByName('Sales').getDataRange().getValues().slice(1).filter(function (r) { return String(r[0]).trim() && !String(r[20] || '').trim(); });

  let total = 0, shn = 0, ext = 0, vat = 0, online = 0, units = 0, returns = 0, discounts = 0;
  const byDay = {}, byCat = {}, byProduct = {}, bySeller = {}, byPartner = {}, tickets = {};
  sales.forEach(function (r) {
    const ref = String(r[5]), q = Number(r[8]) || 0, t = Number(r[11]) || 0, it = items[ref];
    const isExt = it ? it.consignment : /^C\d+$/.test(ref);
    total += t; units += q; vat += Number(r[19]) || 0;
    if (Number(r[1]) === 1) online += Number(r[13]) || 0;
    if (t < 0) returns += -t;
    discounts += Math.max(0, (Number(r[9]) || 0) * q - t) * (q > 0 ? 1 : 0);
    if (isExt) {
      ext += t;
      const partner = (it && it.partner) || 'External';
      const pp = byPartner[partner] = byPartner[partner] || { partner: partner, units: 0, sales: 0, owed: 0 };
      pp.units += q; pp.sales = round2_(pp.sales + t);
      if (it && it.payType === 'Fixed') pp.owed = round2_(pp.owed + it.payValue * q);
      else if (it && it.payType === '%') pp.owed = round2_(pp.owed + t * it.payValue / 100);
    } else shn += t;
    const d = dateStr_(r[2]);
    const day = byDay[d] = byDay[d] || { date: d, sales: 0, units: 0, tickets: {} };
    day.sales = round2_(day.sales + t); day.units += q;
    if (q > 0 && !String(r[24] || '').trim()) day.tickets[String(r[0])] = true;
    const cat = String(r[7] || 'Other');
    const c = byCat[cat] = byCat[cat] || { name: cat, sales: 0, units: 0 };
    c.sales = round2_(c.sales + t); c.units += q;
    const pr = byProduct[ref] = byProduct[ref] || { ref: ref, name: String(r[6]), sales: 0, units: 0 };
    pr.sales = round2_(pr.sales + t); pr.units += q;
    const sel = String(r[4] || '');
    const se = bySeller[sel] = bySeller[sel] || { name: sel, sales: 0, units: 0 };
    se.sales = round2_(se.sales + t); se.units += q;
    if (q > 0 && !String(r[24] || '').trim()) tickets[String(r[0])] = true;
  });
  const report = eventReport_(id);
  const staffCost = round2_(report.pay.reduce(function (a, p) { return a + p.pay; }, 0));
  const expenses = readExpenses_(ss, fx);
  const byType = {};
  expenses.forEach(function (e) { byType[e.type] = round2_((byType[e.type] || 0) + e.total); });
  const expTotal = round2_(expenses.reduce(function (a, e) { return a + e.total; }, 0));
  const cogs = round2_(shn * cogsPct / 100);
  const partnersOwed = round2_(Object.keys(byPartner).reduce(function (a, k) { return a + byPartner[k].owed; }, 0));
  total = round2_(total);
  const gross = round2_(total - cogs - partnersOwed);
  const net = round2_(gross - staffCost - expTotal);

  // weekday / weekend and targets
  const days = Object.keys(byDay).sort().map(function (k) {
    const d = byDay[k];
    const wd = new Date(k + 'T12:00:00Z').getUTCDay();
    return { date: k, sales: d.sales, units: d.units, tickets: Object.keys(d.tickets).length, weekend: wd === 0 || wd === 6 };
  });
  const avg = function (list, f) { return list.length ? round2_(list.reduce(function (a, x) { return a + f(x); }, 0) / list.length) : 0; };
  const nTickets = Object.keys(tickets).length;
  const out = {
    cogsPct: cogsPct, fxRate: fx,
    lines: { sales: total, shnSales: round2_(shn), externalSales: round2_(ext), vatIncluded: round2_(vat), returns: round2_(returns),
      cogs: cogs, partnersOwed: partnersOwed, gross: gross, staffCost: staffCost, expenses: expTotal, expensesByType: byType,
      net: net, netPct: total ? round2_(net / total * 100) : 0 },
    partners: Object.keys(byPartner).map(function (k) { return byPartner[k]; }),
    expenses: expenses.reverse(),
    expenseTypes: String(masterSetting_('EXPENSE_TYPES') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean),
    dashboard: {
      sales: total, units: units, tickets: nTickets, avgTicket: nTickets ? round2_(total / nTickets) : 0,
      online: round2_(online), cash: round2_(total - online), discounts: round2_(discounts),
      days: days, avgPerDay: avg(days, function (d) { return d.sales; }), avgUnitsPerDay: avg(days, function (d) { return d.units; }),
      weekday: { days: days.filter(function (d) { return !d.weekend; }).length, avgSales: avg(days.filter(function (d) { return !d.weekend; }), function (d) { return d.sales; }) },
      weekend: { days: days.filter(function (d) { return d.weekend; }).length, avgSales: avg(days.filter(function (d) { return d.weekend; }), function (d) { return d.sales; }) },
      categories: Object.keys(byCat).map(function (k) { return byCat[k]; }).sort(function (a, b) { return b.sales - a.sales; }),
      products: Object.keys(byProduct).map(function (k) { return byProduct[k]; }).sort(function (a, b) { return b.units - a.units || b.sales - a.sales; }).slice(0, 15),
      sellers: Object.keys(bySeller).map(function (k) { return bySeller[k]; }).sort(function (a, b) { return b.sales - a.sales; }),
      targetQty: settings['Daily Target Qty'] === '' ? null : Number(settings['Daily Target Qty']) || null,
      targetSales: settings['Daily Target Sales (USD)'] === '' ? null : Number(settings['Daily Target Sales (USD)']) || null
    }
  };
  const demo = demoTotals_(ss, null);
  out.dashboard.demoPlays = demo.plays;
  out.dashboard.customersActivated = demo.customers;
  out.dashboard.demoProducts = Object.keys(demo.byProduct).map(function (k) { return demo.byProduct[k]; }).sort(function (a, b) { return b.plays - a.plays; });
  if (writeSheet) {
    writeReportTabs_(ss, ev, out, sales, items);
    // per-day averages kept in the master sheet, for break-even forecasts of later events
    try {
      const f = findEventRow_(id);
      f.sheet.getRange(f.row, 14, 1, 3).setValues([[days.length, out.dashboard.avgUnitsPerDay, out.dashboard.avgPerDay]]);
    } catch (e) { console.error(e); }
  }
  return out;
}

function writeReportTabs_(ss, ev, p, sales, items) {
  const L = p.lines;
  const rows = [
    ['Sales (VAT included)', L.sales], ['  of which SHN products', L.shnSales], ['  of which external products', L.externalSales],
    ['  returns refunded (already deducted)', L.returns], ['  VAT included in sales (reporting only)', L.vatIncluded], ['', ''],
    ['COGS (' + p.cogsPct + '% of SHN product sales)', -L.cogs], ['Owed to external product partners', -L.partnersOwed], ['Gross margin', L.gross], ['', ''],
    ['Staff pay (hours + commission)', -L.staffCost]
  ];
  Object.keys(L.expensesByType).sort().forEach(function (k) { rows.push(['Expenses: ' + k, -L.expensesByType[k]]); });
  rows.push(['', ''], ['Net profit', L.net], ['Net profit %', L.netPct / 100], ['', '']);
  if (p.partners.length) {
    rows.push(['External products settlement', '']);
    p.partners.forEach(function (x) { rows.push(['  ' + x.partner + ': ' + x.units + ' units, sales $' + x.sales, x.owed]); });
  }
  rows.push(['', ''], ['Updated', nowStamp_()]);
  const sh = ss.getSheetByName('P&L');
  if (sh) {
    sh.getRange(2, 1, Math.max(sh.getLastRow(), rows.length + 1), 2).clearContent();
    sh.getRange(2, 1, rows.length, 2).setValues(rows);
    sh.getRange(2, 2, rows.length, 1).setNumberFormat('$#,##0.00;-$#,##0.00');
    const pctRow = rows.findIndex(function (r) { return r[0] === 'Net profit %'; });
    if (pctRow >= 0) sh.getRange(pctRow + 2, 2).setNumberFormat('0.0%');
  }
  // Sales Tracker: one line per day and product (SHN products only), in the offline tracker's columns
  const tr = ss.getSheetByName('Sales Tracker');
  if (!tr) return;
  const country = String(masterSetting_('TRACKER_COUNTRY')), channel = String(masterSetting_('TRACKER_CHANNEL')),
    ctype = String(masterSetting_('TRACKER_CHANNEL_TYPE')), wh = String(masterSetting_('TRACKER_WAREHOUSE'));
  const agg = {}, order = [];
  sales.forEach(function (r) {
    const ref = String(r[5]), it = items[ref];
    if ((it && it.consignment) || /^C\d+$/.test(ref)) return;
    const d = dateStr_(r[2]);
    const k = d + '|' + ref;
    if (!agg[k]) { agg[k] = { date: d, ref: ref, name: String(r[6]), qty: 0, total: 0 }; order.push(k); }
    agg[k].qty += Number(r[8]) || 0;
    agg[k].total = round2_(agg[k].total + (Number(r[11]) || 0));
  });
  const out = order.filter(function (k) { return agg[k].qty !== 0 || agg[k].total !== 0; }).sort().map(function (k) {
    const a = agg[k], sd = fmtTrackerDate_(a.date), dl = typeof a.date === 'string' ? a.date : '';
    const unit = a.qty ? round2_(a.total / a.qty) : 0;
    const dt = new Date(dl + 'T12:00:00Z');
    const dayLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()] + ', ' + ('0' + dt.getUTCDate()).slice(-2) + '-' +
      ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()];
    return [dayLabel, a.ref, a.name, a.qty, a.total, country, channel, ctype, wh, '', sd, sd, '',
      ev.name, ev.name, '', a.ref, a.name, a.qty, unit, 'USD', a.total, 0];
  });
  tr.getRange(2, 1, Math.max(tr.getLastRow(), out.length + 1), 23).clearContent();
  if (out.length) {
    tr.getRange(2, 1, out.length, 23).setNumberFormat('@');
    tr.getRange(2, 4, out.length, 2).setNumberFormat('0.##');
    tr.getRange(2, 19, out.length, 2).setNumberFormat('0.##');
    tr.getRange(2, 22, out.length, 2).setNumberFormat('0.##');
    tr.getRange(2, 1, out.length, 23).setValues(out);
  }
}

/* Errors from phones, laptops and the server land in the master sheet's Errors tab. */
function logError_(e) {
  const cache = CacheService.getScriptCache();
  const key = 'errlog_' + Utilities.formatDate(new Date(), tz_(), 'yyyyMMddHH');
  const n = Number(cache.get(key) || 0);
  if (n >= 200) return; // flood guard
  cache.put(key, String(n + 1), 3600);
  const ss = master_();
  let sh = ss.getSheetByName('Errors');
  if (!sh) {
    sh = ss.insertSheet('Errors');
    writeHeader_(sh, ['Time', 'Event ID', 'Where', 'Device', 'App Version', 'Message', 'Details']);
  }
  const clip = function (v, n2) { return String(v == null ? '' : v).slice(0, n2); };
  sh.appendRow([Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'), clip(e.eventId, 40), clip(e.where, 120),
    clip(e.device, 200), clip(e.version || APP_VERSION, 20), clip(e.message, 500), clip(e.details, 2000)]);
}

function clock_(id, name, direction, clientTime, note) {
  note = String(note || '').trim().slice(0, 200);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ev = openEventForWrite_(id);
    const ss = SpreadsheetApp.openById(ev.sheetId);
    name = String(name || '').trim();
    if (activeStaffNames_(ss).indexOf(name) < 0) throw userError_('This name is not in the staff list.', 'invalid');
    const sh = ss.getSheetByName('Shifts');
    const t = when_(clientTime);
    const stamp = Utilities.formatDate(t, tz_(), 'yyyy-MM-dd HH:mm');
    const rows = sh.getDataRange().getValues();
    let openRow = -1;
    for (let i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][1]).trim() === name) {
        if (String(rows[i][2] || '').trim() && !String(rows[i][3] || '').trim()) openRow = i;
        break;
      }
    }
    if (direction === 'in') {
      if (openRow < 0) {
        const r = sh.getLastRow() + 1;
        sh.getRange(r, 1, 1, 6).setNumberFormat('@').setValues([[Utilities.formatDate(t, tz_(), 'yyyy-MM-dd'), name, stamp, '', '', note ? 'In: ' + note : '']]);
      }
    } else if (direction === 'out') {
      if (openRow >= 0) {
        let start = null;
        try { start = Utilities.parseDate(String(rows[openRow][2]), tz_(), 'yyyy-MM-dd HH:mm'); } catch (e) { start = null; }
        const end = Utilities.parseDate(stamp, tz_(), 'yyyy-MM-dd HH:mm');
        const hours = start ? round2_(Math.max(0, (end - start) / 3600000)) : '';
        const prev = String(rows[openRow][5] || '');
        sh.getRange(openRow + 1, 4, 1, 3).setValues([[stamp, hours, note ? [prev, 'Out: ' + note].filter(Boolean).join(' | ') : prev]]);
      }
    } else {
      throw userError_('Clock in or out?', 'invalid');
    }
    return openShifts_(ss);
  } finally {
    lock.releaseLock();
  }
}

function voidSale_(id, saleId, reason) {
  reason = String(reason || '').trim();
  if (!reason) throw userError_('Give a reason for the void.', 'invalid');
  const ev = rowToEvent_(findEventRow_(id).values);
  const sh = SpreadsheetApp.openById(ev.sheetId).getSheetByName('Sales');
  const rows = sh.getDataRange().getValues();
  let found = false;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(saleId)) {
      sh.getRange(i + 1, 21, 1, 2).setValues([['Y', reason]]);
      rows[i][20] = 'Y'; rows[i][21] = reason;
      found = true;
    }
  }
  if (!found) throw userError_('Sale not found.', 'not_found');
  return saleSummaries_(rows.filter(function (r, j) { return j === 0 || String(r[0]) === String(saleId); }), 1)[0];
}

/* Run once from the editor after updating, so Google asks for the new "connect to the website" permission. */
function authorize() {
  CacheService.getScriptCache().remove('pics_n');
  const n = Object.keys(pictures_()).length;
  Logger.log('Pictures found on the website: ' + n);
  return n;
}

/* ------------------------------------------------------------------ helpers */

function newId_() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function isIsoDate_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function dateStr_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v || '');
}
