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

const APP_VERSION = '1.1.0';

/* Drive folder that holds the master sheet and every event sheet.
   Leave empty to have setup() create a "SHN Events" folder in My Drive. */
const EVENTS_FOLDER_ID = '1JkQzc0GkBpx6OvErqHcBe2VYljxhtjxh';
const TOKEN_HOURS = 12;

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
const EVENT_TABS = [
  ['Settings', ['Setting', 'Value', 'Notes']],
  ['Staff', ['Name', 'Hourly Rate (USD)', 'Commission Under Threshold (USD/item)', 'Threshold (USD)', 'Commission At/Over Threshold (USD/item)', 'Active (Y/N)']],
  ['Products', ['Ref Code', 'Category', 'Game Family', 'Price (USD)', 'Product', 'Opening Qty', 'Demo Qty']],
  ['Consignment', ['Product', 'Ref Code', 'Category', 'Price (USD)', 'Opening Qty', 'Demo Qty', 'Partner', 'Pay Type (Fixed/%)', 'Pay Value', 'Picture URL']],
  ['Stock Moves', ['Date', 'Ref Code', 'Product', 'Qty (+refill / -return)', 'Note']],
  ['Counts', ['Count ID', 'Counted At', 'Ref Code', 'Product', 'Kind (Sellable/Demo)', 'Expected', 'Counted', 'Difference', 'Counted By']],
  ['Sales', ['Sale ID', 'Line', 'Date', 'Time', 'Seller', 'Ref Code', 'Product', 'Category', 'Qty', 'Unit Price (USD)', 'Discount %', 'Line Total (USD)', 'Payment Method', 'Online (USD)', 'Received USD', 'Received LBP', 'Change USD', 'Change LBP', 'Rounding (USD)', 'VAT (USD)', 'Void', 'Void Reason', 'Logged At']],
  ['Cash', ['Date Time', 'Kind (Handover/Count)', 'USD', 'LBP', 'From', 'To', 'Note']],
  ['Shifts', ['Date', 'Employee', 'Clock In', 'Clock Out', 'Hours', 'Note']],
  ['Expenses', ['Date', 'Type', 'Description', 'Amount USD', 'Amount LBP', 'Total USD']],
  ['P&L', ['Line', 'USD']],
  ['Sales Tracker', ['Date', 'Product Code', 'Description', 'Qty', 'Total Sales $', 'Country', 'Channel', 'Channel Type', 'Warehouse', 'Delivered by', 'Sales Date', 'Invoice Date', 'Invoice number', 'Parent Account', 'Customer', 'Branch', 'Product Ref.', 'Description', 'Quantity', 'Unit Amount HT (Invoiced)', 'Currency', 'Total Amount HT (Invoiced)', 'Total VAT (Invoiced)']],
  ['Catalogue', ['Product', 'Ref Code', 'Price (USD)', 'Category', 'Game Family']]
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
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#eef1f6');
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
    return json_(Object.assign({ ok: true }, route_(req)));
  } catch (err) {
    const msg = (err && err.userMessage) || 'Something went wrong. Please try again.';
    if (!(err && err.userMessage)) console.error(err && err.stack || err);
    return json_({ ok: false, error: msg, code: (err && err.code) || 'error' });
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

function requireAdmin_(req) {
  const parts = String(req.token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'admin') throw userError_('Please sign in again.', 'auth');
  const exp = Number(parts[1]);
  if (!exp || exp < Date.now()) throw userError_('Your session expired. Please sign in again.', 'auth');
  if (hmac_(parts[0] + '.' + parts[1]) !== parts[2]) throw userError_('Please sign in again.', 'auth');
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
  sh.autoResizeColumns(1, 3);
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

function lookupFormula_(header, keyCol, col) {
  return '={"' + header + '";ARRAYFORMULA(IF(' + keyCol + '2:' + keyCol + '="","",IFERROR(VLOOKUP(' +
    keyCol + '2:' + keyCol + ',Catalogue!A2:E,' + col + ',FALSE),"")))}';
}

function buildInventoryTabs_(ss, catalogue) {
  const grey = '#f1f3f6';
  const red = '#f8d7d4';

  // Catalogue: this event's own copy (prices locked for the event)
  const cat = ss.getSheetByName('Catalogue');
  if (catalogue.length) {
    cat.getRange(2, 2, catalogue.length, 1).setNumberFormat('@');
    cat.getRange(2, 1, catalogue.length, 5).setValues(catalogue);
    cat.getRange(2, 3, catalogue.length, 1).setNumberFormat('$#,##0.00');
  }
  cat.setColumnWidth(1, 340);

  // Products: Ref Code, Category, Game Family, Price are looked up from the product name
  const prod = ss.getSheetByName('Products');
  prod.getRange(1, 1).setFormula(lookupFormula_('Ref Code', 'E', 2));
  prod.getRange(1, 2).setFormula(lookupFormula_('Category', 'E', 4));
  prod.getRange(1, 3).setFormula(lookupFormula_('Game Family', 'E', 5));
  prod.getRange(1, 4).setFormula(lookupFormula_('Price (USD)', 'E', 3));
  prod.getRange(2, 1, MAX_ROWS, 4).setBackground(grey);
  prod.getRange(2, 4, MAX_ROWS, 1).setNumberFormat('$#,##0.00');
  prod.getRange(2, 5, MAX_ROWS, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(cat.getRange('A2:A'), true).setAllowInvalid(true).build());
  prod.setColumnWidth(5, 340);

  // Stock Moves: product dropdown from this event's products; Ref Code looked up
  const moves = ss.getSheetByName('Stock Moves');
  moves.getRange(1, 2).setFormula('={"Ref Code";ARRAYFORMULA(IF(C2:C="","",IFERROR(VLOOKUP(C2:C,{Products!E2:E,Products!A2:A},2,FALSE),IFERROR(VLOOKUP(C2:C,{Consignment!A2:A,Consignment!B2:B},2,FALSE),""))))}');
  moves.getRange(2, 2, MAX_ROWS, 1).setBackground(grey);
  moves.getRange(2, 1, MAX_ROWS, 1).setNumberFormat('yyyy-mm-dd');
  moves.getRange(2, 3, MAX_ROWS, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(prod.getRange('E2:E'), true).setAllowInvalid(true).build());
  moves.setColumnWidth(3, 340);

  // Consignment: typed by hand
  const cons = ss.getSheetByName('Consignment');
  cons.getRange(2, 8, MAX_ROWS, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Fixed', '%'], true).setAllowInvalid(false).build());
  cons.getRange(2, 4, MAX_ROWS, 1).setNumberFormat('$#,##0.00');
  cons.setColumnWidth(1, 300);

  // Staff
  const staff = ss.getSheetByName('Staff');
  staff.getRange(2, 6, MAX_ROWS, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Y', 'N'], true).setAllowInvalid(false).build());

  // names that don't match turn red
  prod.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($E2<>"",$A2="")').setBackground(red).setRanges([prod.getRange(2, 5, MAX_ROWS, 1)]).build()]);
  moves.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($C2<>"",$B2="")').setBackground(red).setRanges([moves.getRange(2, 3, MAX_ROWS, 1)]).build()]);
}

/* Live stock for the Inventory tab (and the POS later). */
function getInventory_(id) {
  const ev = rowToEvent_(findEventRow_(id).values);
  const ss = SpreadsheetApp.openById(ev.sheetId);
  ['Products', 'Consignment', 'Stock Moves', 'Sales'].forEach(function (t) {
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

  const prod = ss.getSheetByName('Products').getDataRange().getValues();
  for (let i = 1; i < prod.length; i++) {
    const r = prod[i];
    const name = String(r[4] || '').trim();
    if (!name) continue;
    const ref = String(r[0] || '').trim();
    if (!ref) { warnings.push('Products row ' + (i + 1) + ': "' + name + '" is not in the event catalogue, so it is ignored.'); continue; }
    add({ ref: ref, name: name, category: String(r[1] || ''), family: String(r[2] || ''), price: parseMoney_(r[3]),
      opening: qty(r[5]), demo: qty(r[6]), moves: 0, sold: 0, consignment: false }, 'Products');
  }

  const consSheet = ss.getSheetByName('Consignment');
  const cons = consSheet.getDataRange().getValues();
  const usedC = {};
  cons.slice(1).forEach(function (r) { const m = String(r[1] || '').match(/^C(\d+)$/); if (m) usedC[Number(m[1])] = true; });
  let nextC = 1;
  for (let i = 1; i < cons.length; i++) {
    const r = cons[i];
    const name = String(r[0] || '').trim();
    if (!name) continue;
    let ref = String(r[1] || '').trim();
    if (!ref) {
      while (usedC[nextC]) nextC++;
      usedC[nextC] = true;
      ref = 'C' + ('00' + nextC).slice(-3);
      consSheet.getRange(i + 1, 2).setValue(ref);
    }
    const price = parseMoney_(r[3]);
    if (!price) warnings.push('Consignment row ' + (i + 1) + ': "' + name + '" has no price.');
    add({ ref: ref, name: name, category: String(r[2] || '') || 'Consignment', family: '', price: price,
      opening: qty(r[4]), demo: qty(r[5]), moves: 0, sold: 0, consignment: true,
      partner: String(r[6] || ''), payType: String(r[7] || ''), payValue: qty(r[8]), picture: String(r[9] || '') }, 'Consignment');
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
  const sh = ss.getSheetByName('Staff');
  if (!sh) return [];
  return sh.getDataRange().getValues().slice(1).filter(function (r) { return String(r[0]).trim(); }).map(function (r) {
    return {
      name: String(r[0]).trim(),
      hourlyRate: parseMoney_(r[1]),
      commissionUnder: parseMoney_(r[2]),
      threshold: parseMoney_(r[3]),
      commissionOver: parseMoney_(r[4]),
      active: String(r[5] || 'Y').trim().toUpperCase() !== 'N'
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
