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

const APP_VERSION = '1.4.0';

/* Drive folder that holds the master sheet and every event sheet.
   Leave empty to have setup() create a "SHN Events" folder in My Drive. */
const EVENTS_FOLDER_ID = '1JkQzc0GkBpx6OvErqHcBe2VYljxhtjxh';
const TOKEN_HOURS = 12;
const STAFF_TOKEN_HOURS = 16;
const VAT_PCT = 11;   // prices include VAT; the VAT column is for reporting only
const LBP_STEP = 5000; // LBP change is rounded to this step

const MASTER_TABS = {
  Events: ['Event ID', 'Name', 'Type', 'Venue', 'Start Date', 'End Date', 'Status', 'Sheet URL', 'Sheet ID', 'Created At'],
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
  ['SHOP_DOMAIN', 'superheatedneurons.com', 'Website the POS takes product pictures from (matched by SKU = Ref Code)'],
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

/* Every tab of an event sheet. Settings is a key/value tab; the rest are tables. */
/* Every tab of an event sheet. '' leaves an empty separator column between blocks.
   Settings: A-C event settings, E-J staff list, L-P this event's catalogue.
   Listing:  A-G products from the catalogue, I-R external products, T all product names (hidden helper). */
const STAFF_COL = 5;      // Settings!E
const CATALOG_COL = 12;   // Settings!L
const CONS_COL = 9;       // Listing!I
const ALL_NAMES_COL = 20; // Listing!T
/* Colour per column group: [tab, first col, last col, header colour, body colour] */
const BLOCK_COLORS = [
  ['Settings', 1, 3, '#d9d9d9', '#f3f3f3'],                                   // event settings: grey
  ['Settings', STAFF_COL, STAFF_COL + 5, '#c9daf8', '#eef4fd'],               // staff: blue
  ['Settings', CATALOG_COL, CATALOG_COL + 4, '#d9ead3', '#f1f8ee'],           // catalogue: green
  ['Listing', 1, 7, '#c9daf8', '#eef4fd'],                                    // products: blue
  ['Listing', CONS_COL, CONS_COL + 9, '#fce5cd', '#fef5ec'],                  // external products: orange
  ['Stock Moves', 1, 5, '#d9ead3', '#f1f8ee']                                 // stock moves: green
];
/* Columns filled by formulas: shown in grey italic so nobody types in them */
const AUTO_COLS = [['Listing', 1, 4], ['Stock Moves', 2, 2]];

const EVENT_TABS = [
  ['Settings', ['Setting', 'Value', 'Notes', '',
    'Staff Name', 'Hourly Rate (USD)', 'Commission Under Threshold (USD/item)', 'Threshold (USD)', 'Commission At/Over Threshold (USD/item)', 'Active (Y/N)', '',
    'Catalogue: Product', 'Ref Code', 'Price (USD)', 'Category', 'Game Family']],
  ['Listing', ['Ref Code', 'Category', 'Game Family', 'Price (USD)', 'Product', 'Opening Qty', 'Demo Qty', '',
    'External Product', 'Ref Code', 'Category', 'Price (USD)', 'Opening Qty', 'Demo Qty', 'Partner', 'Pay Type (Fixed/%)', 'Pay Value', 'Picture URL', '',
    'All Products (auto)']],
  ['Stock Moves', ['Date', 'Ref Code', 'Product', 'Qty (+refill / -return)', 'Note']],
  ['Sales', ['Sale ID', 'Line', 'Date', 'Time', 'Seller', 'Ref Code', 'Product', 'Category', 'Qty', 'Unit Price (USD)', 'Discount %', 'Line Total (USD)', 'Payment Method', 'Online (USD)', 'Received USD', 'Received LBP', 'Change USD', 'Change LBP', 'Rounding (USD)', 'VAT (USD)', 'Void', 'Void Reason', 'Logged At', 'Note', 'Return Of']],
  ['Shifts', ['Date', 'Employee', 'Clock In', 'Clock Out', 'Hours', 'Note']],
  ['Cash', ['Date Time', 'Kind (Handover/Count)', 'USD', 'LBP', 'From', 'To', 'Note']],
  ['Counts', ['Count ID', 'Counted At', 'Ref Code', 'Product', 'Kind (Sellable/Demo)', 'Expected', 'Counted', 'Difference', 'Counted By']],
  ['Expenses', ['Date', 'Type', 'Description', 'Amount USD', 'Amount LBP', 'Total USD']],
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
    case 'getEvent': requireAdmin_(req); return { event: getEvent_(req.id) };
    case 'getInventory': requireAdmin_(req); return { inventory: getInventory_(req.id) };
    case 'setEventStatus': requireAdmin_(req); return { event: setEventStatus_(req.id, req.status) };
    case 'eventPublic': return { event: eventPublic_(req.eventId) };
    case 'staffLogin': return staffLogin_(req);
    case 'posCatalog': return { catalog: posCatalog_(req.eventId) };
    case 'posData': requireEventAccess_(req, req.eventId); return { pos: posData_(req.eventId, isAdmin_(req)) };
    case 'recordSale': requireEventAccess_(req, req.eventId); return { sale: recordSale_(req.eventId, req.sale) };
    case 'clock': requireEventAccess_(req, req.eventId); return { openShifts: clock_(req.eventId, req.name, req.direction, req.clientTime) };
    case 'voidSale': requireAdmin_(req); return { sale: voidSale_(req.eventId, req.saleId, req.reason) };
    case 'recordReturn': requireEventAccess_(req, req.eventId); return { sale: recordReturn_(req.eventId, req.ret) };
    case 'logError': logError_(req.error || {}); return {};
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
    createdAt: r[9] instanceof Date ? r[9].toISOString() : String(r[9] || '')
  };
}

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

function createEvent_(req) {
  const name = String(req.name || '').trim();
  const venue = String(req.venue || '').trim();
  const type = EVENT_TYPES.indexOf(req.type) >= 0 ? req.type : 'Sales';
  const start = String(req.startDate || '');
  const end = String(req.endDate || '');
  if (!name) throw userError_('Give the event a name.', 'invalid');
  if (!isIsoDate_(start) || !isIsoDate_(end)) throw userError_('Pick a start and an end date.', 'invalid');
  if (end < start) throw userError_('The end date is before the start date.', 'invalid');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const existing = listEvents_().map(function (e) { return e.id; });
    let id;
    do { id = newId_(); } while (existing.indexOf(id) >= 0);

    const catalogue = loadCatalogue_();
    const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER_ID'));
    const ss = SpreadsheetApp.create('SHN LEB Event — ' + name + ' (' + start + ')');
    DriveApp.getFileById(ss.getId()).moveTo(folder);

    const event = { id: id, name: name, type: type, venue: venue, startDate: start, endDate: end, status: 'Open' };
    buildEventSheet_(ss, event, catalogue);

    const createdAt = new Date();
    eventsSheet_().appendRow([id, name, type, venue, start, end, 'Open', ss.getUrl(), ss.getId(), createdAt]);
    // keep dates as plain text so time zones never shift them
    const sh = eventsSheet_();
    sh.getRange(sh.getLastRow(), 5, 1, 2).setNumberFormat('@').setValues([[start, end]]);

    event.sheetUrl = ss.getUrl();
    event.sheetId = ss.getId();
    event.createdAt = createdAt.toISOString();
    return event;
  } finally {
    lock.releaseLock();
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
    ['Opening Hours', '', 'e.g. Weekdays 4pm-11pm, weekends 1pm-11pm'],
    ['Exchange Rate (LBP per USD)', Number(masterSetting_('DEFAULT_FX_RATE')) || 89500, ''],
    ['Opening Cash USD', Number(masterSetting_('DEFAULT_OPENING_CASH_USD')) || 0, 'Cash in the drawer at the start'],
    ['Opening Cash LBP', Number(masterSetting_('DEFAULT_OPENING_CASH_LBP')) || 0, 'Cash in the drawer at the start'],
    ['Max Discount %', Number(masterSetting_('DEFAULT_MAX_DISCOUNT_PCT')) || 0, 'Highest discount a cashier can enter'],
    ['COGS %', Number(masterSetting_('COGS_PCT')) || 0, 'Cost of goods as % of selling price, locked for this event'],
    ['PIN', pin, '4 digits, shared with the event staff'],
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
  ss.getSheetByName('P&L').getRange(2, 1).setValue('Built automatically in a later phase.');
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
  const C = colLetter_(CATALOG_COL), C2 = colLetter_(CATALOG_COL + 4); // L..P
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
  set.getRange(2, STAFF_COL + 5, MAX_ROWS, 1).setDataValidation(list(['Y', 'N']));
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
  lst.getRange(1, ALL_NAMES_COL).setFormula('={"All Products (auto)";IFERROR(FILTER({E2:E;I2:I},{E2:E;I2:I}<>""),"")}');
  lst.hideColumns(ALL_NAMES_COL);

  // Stock Moves: dropdown of this event's products (listing + consignment)
  const moves = ss.getSheetByName('Stock Moves');
  moves.getRange(1, 2).setFormula('={"Ref Code";ARRAYFORMULA(IF(C2:C="","",IFERROR(VLOOKUP(C2:C,{Listing!E2:E,Listing!A2:A},2,FALSE),IFERROR(VLOOKUP(C2:C,{Listing!I2:I,Listing!J2:J},2,FALSE),""))))}');
  moves.getRange(2, 1, MAX_ROWS, 1).setNumberFormat('yyyy-mm-dd');
  moves.getRange(2, 3, MAX_ROWS, 1).setDataValidation(strict(lst.getRange('T2:T')));
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
  ['Settings', 'Listing', 'Stock Moves', 'Sales', 'Shifts', 'Cash', 'Counts', 'Expenses', 'P&L', 'Sales Tracker'].forEach(function (t) {
    const sh = ss.getSheetByName(t);
    warn(sh.getRange(1, 1, 1, sh.getMaxColumns()), 'Column headers used by the app');
  });
  warn(set.getRange(2, 1, 1, 3), 'Event ID: do not change');
  ['Sales', 'Shifts', 'Cash', 'Counts'].forEach(function (t) {
    warn(ss.getSheetByName(t).getRange(2, 1, MAX_ROWS, ss.getSheetByName(t).getMaxColumns()), 'Written by the app');
  });

  // safety net: a name that no longer matches (catalogue edited) turns red
  lst.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($E2<>"",$A2="")').setBackground(red).setRanges([lst.getRange(2, 5, MAX_ROWS, 1)]).build()]);
  moves.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($C2<>"",$B2="")').setBackground(red).setRanges([moves.getRange(2, 3, MAX_ROWS, 1)]).build()]);
}

/* Live stock for the Inventory tab (and the POS later). */
function getInventory_(id) {
  const ev = rowToEvent_(findEventRow_(id).values);
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

  // consignment block: Listing I-R
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
    const ref = String(r[5] || '').trim();
    if (items[ref]) items[ref].sold += qty(r[8]);
  }

  const list = order.map(function (ref) {
    const it = items[ref];
    it.live = it.opening + it.moves - it.sold;
    if (it.live < 0) warnings.push('"' + it.name + '" shows ' + it.live + ' in stock. Check the opening quantity and stock moves.');
    return it;
  });
  return { items: list, warnings: warnings };
}

function readStaff_(ss) {
  const sh = ss.getSheetByName('Settings');
  const K = STAFF_COL - 1;
  return sh.getDataRange().getValues().slice(1).filter(function (r) { return String(r[K] || '').trim(); }).map(function (r) {
    return {
      name: String(r[K]).trim(),
      hourlyRate: parseMoney_(r[K + 1]),
      commissionUnder: parseMoney_(r[K + 2]),
      threshold: parseMoney_(r[K + 3]),
      commissionOver: parseMoney_(r[K + 4]),
      active: String(r[K + 5] || 'Y').trim().toUpperCase() !== 'N'
    };
  });
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
    dailyTargetSales: s['Daily Target Sales (USD)'] === '' ? null : Number(s['Daily Target Sales (USD)'])
  };
  return ev;
}

function setEventStatus_(id, status) {
  if (status !== 'Open' && status !== 'Closed') throw userError_('Status must be Open or Closed.', 'invalid');
  const found = findEventRow_(id);
  found.sheet.getRange(found.row, 7).setValue(status);
  found.values[6] = status;
  return rowToEvent_(found.values);
}

/* ------------------------------------------------------------------ POS */

function eventPublic_(id) {
  const ev = rowToEvent_(findEventRow_(id).values);
  return { id: ev.id, name: ev.name, venue: ev.venue, status: ev.status, startDate: ev.startDate, endDate: ev.endDate, type: ev.type };
}

function staffLogin_(req) {
  const id = String(req.eventId || '');
  const ev = rowToEvent_(findEventRow_(id).values);
  if (ev.status === 'Closed') throw userError_('This event is closed.', 'closed');
  const cache = CacheService.getScriptCache();
  const key = 'pinfail_' + id;
  const fails = Number(cache.get(key) || 0);
  if (fails >= 10) throw userError_('Too many wrong PINs. Wait 10 minutes and try again.', 'locked');
  const pin = String(readEventSettings_(ev.sheetId)['PIN'] || '').trim();
  if (!pin || String(req.pin || '').trim() !== pin) {
    cache.put(key, String(fails + 1), 600);
    Utilities.sleep(600);
    throw userError_('Wrong PIN.', 'bad_pin');
  }
  const exp = Date.now() + STAFF_TOKEN_HOURS * 3600 * 1000;
  return { token: signToken_('staff:' + id, exp), expires: exp, event: eventPublic_(id) };
}

/* Product names, prices and pictures, shown while staff type the PIN (no stock, no sales). */
function posCatalog_(id) {
  const ev = eventPublic_(id);
  if (ev.status === 'Closed') throw userError_('This event is closed.', 'closed');
  let pics = {};
  try { pics = pictures_(); } catch (e) { pics = {}; }
  const products = getInventory_(id).items.map(function (it) {
    return { ref: it.ref, name: it.name, category: it.category, price: it.price, picture: it.picture || pics[it.ref] || '' };
  }).sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
  return { event: ev, products: products };
}

function openEventForWrite_(id) {
  const ev = rowToEvent_(findEventRow_(id).values);
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
    return { ref: it.ref, name: it.name, category: it.category, price: it.price, live: it.live,
      picture: it.picture || pics[it.ref] || '' };
  }).sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
  return {
    event: eventPublic_(id),
    fxRate: Number(s['Exchange Rate (LBP per USD)']) || 0,
    maxDiscountPct: Number(s['Max Discount %']) || 0,
    lbpStep: LBP_STEP,
    staff: activeStaffNames_(ss),
    openShifts: openShifts_(ss),
    products: products,
    recentSales: saleSummaries_(ss.getSheetByName('Sales').getDataRange().getValues(), admin ? 200 : 30),
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

    const seller = String(sale.seller || '').trim();
    if (activeStaffNames_(ss).indexOf(seller) < 0) throw userError_('Pick who made the sale.', 'invalid');

    const items = {};
    getInventory_(id).items.forEach(function (it) { items[it.ref] = it; });
    const qtyByRef = {};
    const refs = [];
    (sale.lines || []).forEach(function (l) {
      const ref = String(l.ref || '');
      const q = Math.round(Number(l.qty));
      if (!items[ref]) throw userError_('A product in this sale is not in the event listing anymore.', 'invalid');
      if (!(q >= 1 && q <= 999)) throw userError_('Check the quantities.', 'invalid');
      if (!qtyByRef[ref]) { qtyByRef[ref] = 0; refs.push(ref); }
      qtyByRef[ref] += q;
    });
    if (!refs.length) throw userError_('The sale has no products.', 'invalid');

    const disc = Number(sale.discountPct || 0);
    if (!(disc >= 0 && disc <= maxDisc)) throw userError_('The discount is above the ' + maxDisc + '% allowed for this event.', 'invalid');

    const gross = refs.map(function (r) { return items[r].price * qtyByRef[r]; });
    const lineTotals = gross.map(function (g) { return round2_(g * (1 - disc / 100)); });
    const total = round2_(gross.reduce(function (a, b) { return a + b; }, 0) * (1 - disc / 100));
    lineTotals[lineTotals.length - 1] = round2_(lineTotals[lineTotals.length - 1] + total - lineTotals.reduce(function (a, b) { return a + b; }, 0));

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
      if (Math.abs(rounding) > 1 + tolerance) throw userError_('The change given does not match the change due.', 'invalid');
    }

    const t = when_(sale.clientTime);
    const date = Utilities.formatDate(t, tz_(), 'yyyy-MM-dd');
    const time = Utilities.formatDate(t, tz_(), 'HH:mm');
    const loggedAt = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
    const note = String(sale.note || '').slice(0, 200);
    const rows = refs.map(function (ref, i) {
      const it = items[ref];
      const first = i === 0;
      return [saleId, i + 1, date, time, seller, ref, it.name, it.category, qtyByRef[ref], it.price, disc, lineTotals[i],
        method, first ? online : '', first ? recvUsd : '', first ? recvLbp : '', first ? changeUsd : '', first ? changeLbp : '',
        first ? rounding : '', round2_(lineTotals[i] * VAT_PCT / (100 + VAT_PCT)), '', '', loggedAt, first ? note : ''];
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

    const method = ret.method === 'Online' ? 'Online' : 'Cash';
    let refundUsd = 0, refundLbp = 0, rounding = 0;
    if (method === 'Cash') {
      if (!fx) throw userError_('Set the exchange rate in the event Settings tab first.', 'invalid');
      refundUsd = Math.max(0, Number(ret.refundUsd) || 0);
      refundLbp = Math.max(0, Math.round(Number(ret.refundLbp) || 0));
      rounding = round2_(due - refundUsd - refundLbp / fx);
      if (Math.abs(rounding) > 1 + LBP_STEP / fx + 0.005) throw userError_('The refund given does not match the amount due.', 'invalid');
    }
    const t = when_(ret.clientTime);
    const date = Utilities.formatDate(t, tz_(), 'yyyy-MM-dd');
    const time = Utilities.formatDate(t, tz_(), 'HH:mm');
    const loggedAt = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
    const out = lines.map(function (l, i) {
      const o = l.o, first = i === 0;
      return [retId, i + 1, date, time, String(o[4]), String(o[5]), String(o[6]), String(o[7]), -l.qty, Number(o[9]) || 0, Number(o[10]) || 0, -l.total,
        method, first ? (method === 'Online' ? -due : 0) : '', first ? 0 : '', first ? 0 : '', first ? refundUsd : '', first ? refundLbp : '',
        first ? rounding : '', round2_(-l.total * VAT_PCT / (100 + VAT_PCT)), '', '', loggedAt, first ? String(ret.note || '').slice(0, 200) : '', saleId];
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

function clock_(id, name, direction, clientTime) {
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
        sh.getRange(r, 1, 1, 6).setNumberFormat('@').setValues([[Utilities.formatDate(t, tz_(), 'yyyy-MM-dd'), name, stamp, '', '', '']]);
      }
    } else if (direction === 'out') {
      if (openRow >= 0) {
        let start = null;
        try { start = Utilities.parseDate(String(rows[openRow][2]), tz_(), 'yyyy-MM-dd HH:mm'); } catch (e) { start = null; }
        const end = Utilities.parseDate(stamp, tz_(), 'yyyy-MM-dd HH:mm');
        const hours = start ? round2_(Math.max(0, (end - start) / 3600000)) : '';
        sh.getRange(openRow + 1, 4, 1, 2).setValues([[stamp, hours]]);
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
