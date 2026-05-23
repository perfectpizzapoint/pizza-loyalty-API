/* ═══════════════════════════════════════════
   Perfect Pizza Point – Loyalty System
   Single JS file (Entry + Admin logic)
   ═══════════════════════════════════════════ */

// ──── CONFIGURATION ────
// ⚠️  PASTE YOUR DEPLOYED APPS SCRIPT WEB APP URL HERE:
const API_URL = 'https://script.google.com/macros/s/AKfycby2RXrQOKkXQ3dgWRz_hCJMl9Fi9ZFxjm_hD6vuwCdh6KHPbRxCXfMsmKeK6JE1LunG-Q/exec';

// Runtime cache
let APP_CONFIG = null;       // { minAmount, cycle, rewardValue }
let CURRENT_CUSTOMER = null; // customer data from Sheet1
let LAST_ENTRY_RESULT = null;
let ADMIN_DATA = null;
let ADMIN_AUTHENTICATED = false;
let ALL_ENTRIES_CACHE = [];

// ──── GOOGLE SHEET CACHE SYSTEM ────
const CACHE_KEY_PREFIX = 'ppp_sheet_cache_';
const CACHE_TIMESTAMP_KEY = 'ppp_sheet_cache_timestamp';
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Actions whose responses can be cached
const CACHEABLE_ACTIONS = ['getConfig', 'getCustomer', 'getAllEntries', 'getAdminData', 'getCategories', 'getTableCount', 'getDishes', 'getFlavoursMap'];

/** Store an API response in localStorage cache */
function setCacheItem(cacheKey, data) {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + cacheKey, JSON.stringify(data));
  } catch (e) {
    console.warn('Cache write failed (storage full?)', e);
  }
}

/** Retrieve an API response from localStorage cache (returns null if missing or expired) */
function getCacheItem(cacheKey) {
  try {
    const ts = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (!ts) return null;
    const age = Date.now() - Number(ts);
    if (age > CACHE_MAX_AGE_MS) {
      // Cache too old, treat as empty
      return null;
    }
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + cacheKey);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/** Build a unique cache key from API params */
function buildCacheKey(params) {
  const action = params.action;
  // For customer lookups, include mobile in the key
  if (action === 'getCustomer' && params.mobile) {
    return action + '_' + params.mobile;
  }
  return action;
}

/** Clear all sheet-related cache data */
function clearSheetCache(silent = false) {
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(CACHE_KEY_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
  localStorage.removeItem(CACHE_TIMESTAMP_KEY);
  if (!silent) toast('🗑️ Cache cleared successfully.', 'success');
}

/** Sync cache (clear then download) */
async function syncSheetCache() {
  clearSheetCache(true);
  await downloadSheetCache(false);
}

/** Download all key data from Google Sheets and store in cache */
async function downloadSheetCache(silent = false) {
  const btn = document.getElementById('btnCacheSync');
  if (btn && !silent) {
    btn.classList.add('downloading');
    btn.style.pointerEvents = 'none';
  }
  if (!silent) toast('⬇️ Downloading data to cache…', 'info');

  try {
    // Fetch all major data endpoints in parallel
    const [config, entries, adminData, categories, tableCount, dishes, flavoursMap] = await Promise.all([
      apiDirect({ action: 'getConfig' }),
      apiDirect({ action: 'getAllEntries' }),
      apiDirect({ action: 'getAdminData' }),
      apiDirect({ action: 'getCategories' }),
      apiDirect({ action: 'getTableCount' }),
      apiDirect({ action: 'getDishes' }), // fetches all dishes
      apiDirect({ action: 'getFlavoursMap' }) // fetches all flavors grouped by dishIndex
    ]);

    // Store each response
    setCacheItem('getConfig', config);
    setCacheItem('getAllEntries', entries);
    setCacheItem('getAdminData', adminData);
    setCacheItem('getCategories', categories);
    setCacheItem('getTableCount', tableCount);
    setCacheItem('getDishes', dishes);
    setCacheItem('getFlavoursMap', flavoursMap);

    // Set the cache timestamp
    localStorage.setItem(CACHE_TIMESTAMP_KEY, String(Date.now()));

    if (!silent) toast('✅ Data cached successfully! App will use cached data.', 'success');
  } catch (e) {
    console.error('Cache download failed', e);
    if (!silent) toast('❌ Cache download failed: ' + e.message, 'error');
  }

  if (btn && !silent) {
    btn.classList.remove('downloading');
    btn.style.pointerEvents = '';
  }
}

/** Toggle cache button visibility based on current section */
function updateCacheButtonsVisibility(sectionName) {
  const btnSync = document.getElementById('btnCacheSync');
  if (!btnSync) return;
  const shouldShow = sectionName !== 'admin';
  btnSync.style.display = shouldShow ? '' : 'none';
}

// ──── Month-Day Heatmap ────
let mdHeatmapType = 'amount';

function setMdHeatmapType(type, btn) {
  mdHeatmapType = type;
  document.querySelectorAll('#mdHeatmapToggle .toggle-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  calculateMdHeatmap();
}

function calculateMdHeatmap() {
  const matrix = Array.from({ length: 12 }, () => Array(31).fill(0));
  
  ALL_ENTRIES_CACHE.forEach(entry => {
    if (!entry.date) return;
    const parts = entry.date.split('-');
    if (parts.length === 3) {
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10) - 1;
      if (month >= 0 && month < 12 && day >= 0 && day < 31) {
        if (mdHeatmapType === 'amount') matrix[month][day] += entry.amount || 0;
        else if (mdHeatmapType === 'cash') matrix[month][day] += entry.cash || 0;
        else if (mdHeatmapType === 'upi') matrix[month][day] += entry.upi || 0;
        else if (mdHeatmapType === 'card') matrix[month][day] += entry.card || 0;
        else matrix[month][day] += 1;
      }
    }
  });

  renderMdHeatmap(matrix);
}

function renderMdHeatmap(matrix) {
  const container = document.getElementById('mdHeatmapContainer');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let maxVal = 0;
  matrix.forEach(row => row.forEach(v => { if (v > maxVal) maxVal = v; }));

  let html = '<div class="md-heatmap-grid">';
  // Header row (days 1-31)
  html += '<div class="heatmap-label"></div>';
  for (let d = 1; d <= 31; d++) {
    html += '<div class="heatmap-header">' + d + '</div>';
  }
  // Data rows (months)
  for (let m = 0; m < 12; m++) {
    html += '<div class="heatmap-label">' + months[m] + '</div>';
    for (let d = 0; d < 31; d++) {
      const val = matrix[m][d];
      const intensity = maxVal > 0 ? val / maxVal : 0;
      const bg = intensity === 0
        ? 'var(--dot-empty)'
        : 'rgba(232, 93, 4, ' + (0.15 + intensity * 0.85) + ')';
      const displayVal = mdHeatmapType === 'entries' ? val : '₹' + val;
      html += '<div class="heatmap-cell" style="background:' + bg + '">' +
        '<div class="heatmap-tooltip">' + months[m] + ' ' + (d + 1) + ' — ' + displayVal + '</div>' +
        '</div>';
    }
  }
  html += '</div>';
  container.innerHTML = html;
}

// ──── HARDCODED WHATSAPP TEMPLATE (removes Sheet3 dependency) ────
const WHATSAPP_TEMPLATE = "https://api.whatsapp.com/send?phone=91<number>&text=*Perfect%20Pizza%20Point*%F0%9F%8D%95%0A%0A%F0%9F%93%8A%20Current%20visit%20count%20%3A%20<completedvisit>%0A%F0%9F%92%B0%C2%A0%20Billing%20Amount%20%3D%20%E2%82%B9<amount>%0A%E2%9C%89%EF%B8%8F%20<message>%0A%0A%F0%9F%94%97%20Useful%20links%3A%0A%E2%9D%A4%EF%B8%8F%20Insta%20page%20%3A%20https%3A%2F%2Finstagram.com%2Fperfect_pizza_point_p3%0A%F0%9F%8D%95%20Zomato%20%3A%20https%3A%2F%2Fzomato.onelink.me%2Fxqzv%2F0o9285p4%0A%F0%9F%8D%94%20Swiggy%20%3A%20https%3A%2F%2Fwww.swiggy.com%2Fmenu%2F765590%0A%F0%9F%A4%9D%20Loyalty%20%3A%20<loyality>%0A%E2%98%8E%EF%B8%8F%20Phone%20No%3A%20%2B918319798869";

// ──── HELPERS ────

/**
 * IST date/time helpers — using the Intl API.
 *
 * The old approach manually added +5:30 ms to new Date(). That double-counts
 * the offset when the browser is already in IST, and gives wrong results in
 * every other timezone. The Intl API is the correct, locale-agnostic way to
 * express a moment in a specific IANA timezone.
 */

/** Returns the current date as "YYYY-MM-DD" in IST. */
function istDateStr() {
  // en-CA locale natively formats dates as YYYY-MM-DD.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Returns the current time as "HH:MM:SS" in IST. */
function istTimeStr() {
  // en-GB with hour12:false produces 24-hour HH:MM:SS with no AM/PM suffix.
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour12:  false,
    hour:    '2-digit',
    minute:  '2-digit',
    second:  '2-digit'
  });
}

/** Direct API call (always hits network, no cache) */
async function apiDirect(params) {
  const qs = new URLSearchParams(params).toString();
  const url = API_URL + '?' + qs;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('Network error');
  return res.json();
}

/** Cache-aware API call helper */
async function api(params) {
  const action = params.action;
  
  // Special offline interception for getFlavours
  if (action === 'getFlavours') {
    const cachedMap = getCacheItem('getFlavoursMap');
    if (cachedMap && cachedMap.flavoursMap) {
      const fList = cachedMap.flavoursMap[params.dishIndex] || [];
      return { flavours: fList.map(name => ({ name })) };
    }
  }

  // Only try cache for cacheable read-only actions
  if (CACHEABLE_ACTIONS.includes(action)) {
    const cacheKey = buildCacheKey(params);
    const cached = getCacheItem(cacheKey);
    if (cached !== null) {
      // If we requested getDishes with a parentIndex, filter the cached global dishes array locally
      if (action === 'getDishes' && params.parentIndex !== undefined && params.parentIndex !== null && params.parentIndex !== '') {
        const filtered = (cached.dishes || []).filter(d => Number(d.parentIndex) === Number(params.parentIndex));
        return { dishes: filtered };
      }
      return cached;
    }
  }
  // Fallback to network
  return apiDirect(params);
}

/** Toast */
function toast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast toast--' + type;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
}

/** Show / hide helpers */
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function showErr(id) { document.getElementById(id).classList.add('visible'); }
function hideErr(id) { document.getElementById(id).classList.remove('visible'); }

// ──── THEME TOGGLE ────
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  document.getElementById('themeToggle').textContent = isDark ? '🌙' : '☀️';
  localStorage.setItem('ppp_theme', isDark ? 'light' : 'dark');
}

(function initTheme() {
  const saved = localStorage.getItem('ppp_theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('themeToggle').textContent = '☀️';
  }
})();

// ──── SECTION NAV ────
function showSection(name) {
  document.getElementById('sectionHome').classList.remove('active');
  document.getElementById('sectionPos').classList.remove('active');
  if (document.getElementById('sectionAllEntries')) {
    document.getElementById('sectionAllEntries').classList.remove('active');
  }
  if (document.getElementById('sectionDashboard')) {
    document.getElementById('sectionDashboard').classList.remove('active');
  }
  document.getElementById('sectionAdmin').classList.remove('active');

  document.getElementById('navHome').classList.remove('active');
  document.getElementById('navPos').classList.remove('active');
  if (document.getElementById('navAllEntries')) {
    document.getElementById('navAllEntries').classList.remove('active');
  }
  if (document.getElementById('navDashboard')) {
    document.getElementById('navDashboard').classList.remove('active');
  }
  document.getElementById('navAdmin').classList.remove('active');

  let activeBtn;
  if (name === 'admin') {
    document.getElementById('sectionAdmin').classList.add('active');
    activeBtn = document.getElementById('navAdmin');
    activeBtn.classList.add('active');
    // Always require re-auth when opening admin
    ADMIN_AUTHENTICATED = false;
    show('adminLoginWrap');
    hide('adminPOSPanel');
    document.getElementById('adminUser').value = '';
    document.getElementById('adminPass').value = '';
    hideErr('errLogin');
  } else if (name === 'dashboard') {
    if (document.getElementById('sectionDashboard')) {
      document.getElementById('sectionDashboard').classList.add('active');
    }
    activeBtn = document.getElementById('navDashboard');
    if (activeBtn) activeBtn.classList.add('active');
    loadDashboardData();
  } else if (name === 'pos') {
    document.getElementById('sectionPos').classList.add('active');
    activeBtn = document.getElementById('navPos');
    activeBtn.classList.add('active');
    initPos();
  } else if (name === 'allEntries') {
    if (document.getElementById('sectionAllEntries')) {
      document.getElementById('sectionAllEntries').classList.add('active');
    }
    activeBtn = document.getElementById('navAllEntries');
    if (activeBtn) activeBtn.classList.add('active');
    loadAllEntries();
  } else {
    document.getElementById('sectionHome').classList.add('active');
    activeBtn = document.getElementById('navHome');
    activeBtn.classList.add('active');
  }
  
  updateNavIndicator(activeBtn);
  updateCacheButtonsVisibility(name);
}

function updateNavIndicator(btn) {
  if (!btn) return;
  const indicator = document.getElementById('navIndicator');
  const dock = document.getElementById('navDock');
  if (!indicator || !dock) return;
  
  const dockRect = dock.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  
  indicator.style.width = btnRect.width + 'px';
  indicator.style.left = (btnRect.left - dockRect.left) + 'px';
}

// Initial positioning and resize listener for the animated dock indicator
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    updateNavIndicator(document.querySelector('.nav-btn.active'));
  }, 100);
  window.addEventListener('resize', () => {
    updateNavIndicator(document.querySelector('.nav-btn.active'));
  });

  // Restore saved loyalty state on page load/reload
  restoreLoyaltyState();
});

async function restoreLoyaltyState() {
  const formOpen = localStorage.getItem('ppp_loyalty_form_open') === 'true';
  const savedMobile = localStorage.getItem('ppp_loyalty_mobile') || '';
  
  if (savedMobile) {
    document.getElementById('inputMobile').value = savedMobile;
  }
  
  if (formOpen && savedMobile) {
    await handleAddEntry();
  }
}

// ──── FETCH CONFIG ON LOAD ────
async function loadConfig() {
  try {
    APP_CONFIG = await api({ action: 'getConfig' });
    document.getElementById('minAmtLabel').textContent = APP_CONFIG.minAmount;
  } catch (e) {
    console.error('Config load failed', e);
  }
}
loadConfig();

// ══════════════════════════════════════
//  HOME – CUSTOMER ENTRY SYSTEM
// ══════════════════════════════════════

async function handleAddEntry() {
  const mobileInput = document.getElementById('inputMobile');
  const mobile = mobileInput.value.trim();
  hideErr('errMobile');

  if (!/^\d{10}$/.test(mobile)) {
    showErr('errMobile');
    mobileInput.classList.add('error');
    return;  // keep field intact so user can correct the typo
  }
  mobileInput.classList.remove('error');

  const btn = document.getElementById('btnAddEntry');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Checking…';

  // ── Instantly open the entry form with placeholder customer data ──
  CURRENT_CUSTOMER = {
    found: false, mobile,
    totalEntries: 0, rewardsClaimed: 0,
    eligible: false, lastVisitDate: ''
  };
  openEntryForm(mobile, CURRENT_CUSTOMER);
  mobileInput.value = '';

  btn.disabled = false;
  btn.innerHTML = '➕ Add Entry';

  // ── Background: run the original duplicate-check against Google Sheets ──
  try {
    const cust = await api({ action: 'getCustomer', mobile });
    CURRENT_CUSTOMER = cust;

    const todayDate = istDateStr();
    if (cust.found && cust.lastVisitDate === todayDate) {
      toast('Entry already added today. You can generate a receipt without adding an entry.', 'info');
    } else {
      const cycle = APP_CONFIG ? APP_CONFIG.cycle : 10;
      const needsClaim = cust.found && cust.eligible &&
        cust.rewardsClaimed < cust.totalEntries / cycle;

      if (needsClaim) {
        toast('🎁 Customer must claim reward before new entry!', 'info');
        show('rowDetailsBtn');
      }
    }

    checkAmountAndToggleButtons();
  } catch (e) {
    console.error('Background duplicate check failed', e);
  }
}

function checkAmountAndToggleButtons() {
  const amountInput = document.getElementById('inputAmount');
  const amountVal = amountInput.value.trim();
  const amount = parseInt(amountVal, 10);
  const minAmt = APP_CONFIG ? APP_CONFIG.minAmount : 100;
  
  const btnSave = document.getElementById('btnSaveEntry');
  const btnReceipt = document.getElementById('btnReceiptOnly');
  const btnClaim = document.getElementById('btnClaimForce');

  const todayDate = istDateStr();
  const alreadyAddedToday = CURRENT_CUSTOMER && CURRENT_CUSTOMER.found && CURRENT_CUSTOMER.lastVisitDate === todayDate;

  const cycle = APP_CONFIG ? APP_CONFIG.cycle : 10;
  const needsClaim = CURRENT_CUSTOMER && CURRENT_CUSTOMER.found && CURRENT_CUSTOMER.eligible &&
    CURRENT_CUSTOMER.rewardsClaimed < CURRENT_CUSTOMER.totalEntries / cycle;

  // Clear err if valid or positive (since receipt only is valid)
  if (!isNaN(amount) && amount > 0) {
    hideErr('errAmount');
    amountInput.classList.remove('error');
  }

  if (amountVal !== '' && (isNaN(amount) || amount < minAmt)) {
    // Explicitly entered a value that is less than ₹100
    btnSave.style.display = 'none';
    btnReceipt.style.display = '';
    btnClaim.style.display = 'none';
  } else {
    // Empty input or value >= ₹100
    if (alreadyAddedToday) {
      btnSave.style.display = '';
      btnSave.disabled = true;
      btnSave.innerHTML = '🚫 Already Added Today';
      btnReceipt.style.display = '';
      btnClaim.style.display = 'none';
    } else if (needsClaim) {
      btnSave.style.display = 'none';
      btnReceipt.style.display = 'none';
      btnClaim.style.display = '';
    } else {
      btnSave.style.display = '';
      btnSave.disabled = false;
      btnSave.innerHTML = '💾 Save Entry';
      btnReceipt.style.display = 'none';
      btnClaim.style.display = 'none';
    }
  }
}

function openEntryForm(mobile, cust) {
  document.getElementById('dispMobile').value = mobile;
  document.getElementById('dispDate').value = istDateStr();
  document.getElementById('dispTime').value = istTimeStr();
  
  const savedAmount = localStorage.getItem('ppp_loyalty_amount');
  if (savedAmount) {
    document.getElementById('inputAmount').value = savedAmount;
  } else if (window.PENDING_POS_TOTAL) {
    document.getElementById('inputAmount').value = window.PENDING_POS_TOTAL;
    window.PENDING_POS_TOTAL = null;
  } else {
    document.getElementById('inputAmount').value = '';
  }
  
  const savedMsg = localStorage.getItem('ppp_loyalty_message');
  if (savedMsg !== null) {
    document.getElementById('inputMessage').value = savedMsg;
  } else {
    document.getElementById('inputMessage').value = 'Thank You, Visit Again';  // default message
  }
  
  hideErr('errAmount');
  hide('rowWhatsapp');
  hide('rowDetailsBtn');

  const cycle = APP_CONFIG ? APP_CONFIG.cycle : 10;
  const needsClaim = cust.found && cust.eligible &&
    cust.rewardsClaimed < cust.totalEntries / cycle;

  if (needsClaim) {
    toast('🎁 Customer must claim reward before new entry!', 'info');
    show('rowDetailsBtn');
  }

  checkAmountAndToggleButtons();
  resetPaymentMode();

  show('cardEntryForm');
  document.getElementById('inputAmount').focus();

  // Save current form status to localStorage
  localStorage.setItem('ppp_loyalty_form_open', 'true');
  localStorage.setItem('ppp_loyalty_mobile', mobile);
}

function closeEntryForm() {
  hide('cardEntryForm');
  CURRENT_CUSTOMER = null;
  LAST_ENTRY_RESULT = null;
  localStorage.removeItem('ppp_loyalty_form_open');
  localStorage.removeItem('ppp_loyalty_mobile');
  localStorage.removeItem('ppp_loyalty_amount');
  localStorage.removeItem('ppp_loyalty_message');
  localStorage.removeItem('ppp_pendingOrderItems');
  resetPaymentMode();
}

// ══════════════════════════════════════
//  PAYMENT MODE LOGIC
// ══════════════════════════════════════

let PAYMENT_STATE = { mode: 'cash', cashAmt: 0, upiAmt: 0, cardAmt: 0 };

function selectPaymentMode(mode) {
  PAYMENT_STATE.mode = mode;
  if (mode === 'split') {
    openSplitModal();
  } else {
    // For single-mode payments, amounts are computed at save time from the total
    PAYMENT_STATE.cashAmt = 0;
    PAYMENT_STATE.upiAmt = 0;
    PAYMENT_STATE.cardAmt = 0;
  }
}

function resetPaymentMode() {
  PAYMENT_STATE = { mode: 'cash', cashAmt: 0, upiAmt: 0, cardAmt: 0 };
  const cashRadio = document.querySelector('input[name="paymentMode"][value="cash"]');
  if (cashRadio) cashRadio.checked = true;
}

function getPaymentAmounts(totalAmount) {
  if (PAYMENT_STATE.mode === 'split') {
    return { cashAmt: PAYMENT_STATE.cashAmt, upiAmt: PAYMENT_STATE.upiAmt, cardAmt: PAYMENT_STATE.cardAmt };
  }
  const result = { cashAmt: 0, upiAmt: 0, cardAmt: 0 };
  if (PAYMENT_STATE.mode === 'cash') result.cashAmt = totalAmount;
  else if (PAYMENT_STATE.mode === 'upi') result.upiAmt = totalAmount;
  else if (PAYMENT_STATE.mode === 'card') result.cardAmt = totalAmount;
  return result;
}

// Split Modal
function openSplitModal() {
  const amount = parseInt(document.getElementById('inputAmount').value, 10) || 0;
  document.getElementById('splitTotalBadge').textContent = 'Total: ₹' + amount;
  document.getElementById('splitCash').value = '';
  document.getElementById('splitUpi').value = '';
  document.getElementById('splitCard').value = '';
  validateSplitTotal();
  document.getElementById('modalSplit').classList.add('open');
}

function closeSplitModal() {
  document.getElementById('modalSplit').classList.remove('open');
  // If split wasn't confirmed, revert to cash
  if (PAYMENT_STATE.mode === 'split' && PAYMENT_STATE.cashAmt === 0 && PAYMENT_STATE.upiAmt === 0 && PAYMENT_STATE.cardAmt === 0) {
    const cashRadio = document.querySelector('input[name="paymentMode"][value="cash"]');
    if (cashRadio) cashRadio.checked = true;
    PAYMENT_STATE.mode = 'cash';
  }
}

function validateSplitTotal() {
  const total = parseInt(document.getElementById('inputAmount').value, 10) || 0;
  const cash = parseInt(document.getElementById('splitCash').value, 10) || 0;
  const upi = parseInt(document.getElementById('splitUpi').value, 10) || 0;
  const card = parseInt(document.getElementById('splitCard').value, 10) || 0;
  const sum = cash + upi + card;
  const remaining = total - sum;
  
  const el = document.getElementById('splitRemaining');
  const btn = document.getElementById('btnSplitDone');
  
  if (remaining === 0 && total > 0) {
    el.textContent = '✅ Amounts match perfectly!';
    el.className = 'split-remaining valid';
    btn.disabled = false;
  } else {
    el.textContent = remaining > 0 ? `Remaining: ₹${remaining}` : `Over by: ₹${Math.abs(remaining)}`;
    el.className = 'split-remaining invalid';
    btn.disabled = true;
  }
}

function confirmSplitPayment() {
  const cash = parseInt(document.getElementById('splitCash').value, 10) || 0;
  const upi = parseInt(document.getElementById('splitUpi').value, 10) || 0;
  const card = parseInt(document.getElementById('splitCard').value, 10) || 0;
  
  PAYMENT_STATE.cashAmt = cash;
  PAYMENT_STATE.upiAmt = upi;
  PAYMENT_STATE.cardAmt = card;
  
  document.getElementById('modalSplit').classList.remove('open');
  toast('✅ Split payment set: Cash ₹' + cash + ' | UPI ₹' + upi + ' | Card ₹' + card, 'success');
}

async function handleSaveEntry() {
  const mobile = document.getElementById('dispMobile').value;
  const amount = parseInt(document.getElementById('inputAmount').value, 10);
  const date   = document.getElementById('dispDate').value;
  const time   = istTimeStr(); // refresh time
  const message = document.getElementById('inputMessage').value.trim();
  const minAmt = APP_CONFIG ? APP_CONFIG.minAmount : 100;

  hideErr('errAmount');
  if (isNaN(amount) || amount < minAmt) {
    showErr('errAmount');
    document.getElementById('inputAmount').classList.add('error');
    return;
  }
  document.getElementById('inputAmount').classList.remove('error');

  const btn = document.getElementById('btnSaveEntry');

  // ── Instant UI update — no waiting for the server ──
  btn.disabled = true;
  btn.innerHTML = '✔ Saved';

  // Compute optimistic entry data so the UI can render immediately
  const cycle = APP_CONFIG ? APP_CONFIG.cycle : 10;
  const estimatedTotal = CURRENT_CUSTOMER && CURRENT_CUSTOMER.found
    ? CURRENT_CUSTOMER.totalEntries + 1
    : 1;
  const optimisticResult = {
    totalEntries: estimatedTotal,
    rewardsClaimed: CURRENT_CUSTOMER ? (CURRENT_CUSTOMER.rewardsClaimed || 0) : 0,
    eligible: false,
    cycle: cycle,
    index: estimatedTotal
  };

  toast('✅ Entry saved! Visit #' + optimisticResult.index, 'success');
  buildWhatsAppLink(optimisticResult, mobile, amount, message);
  show('rowWhatsapp');
  show('rowDetailsBtn');

  // Clear persistent entry data from localStorage since it is saved
  localStorage.removeItem('ppp_loyalty_form_open');
  localStorage.removeItem('ppp_loyalty_mobile');
  localStorage.removeItem('ppp_loyalty_amount');
  localStorage.removeItem('ppp_loyalty_message');
  
  const orderItems = localStorage.getItem('ppp_pendingOrderItems') || '';
  localStorage.removeItem('ppp_pendingOrderItems');

  // ── Background: persist to Google Sheets (original flow) ──
  const payAmts = getPaymentAmounts(amount);
  try {
    const result = await api({ action: 'addEntry', mobile, amount, date, time, message, cashAmt: payAmts.cashAmt, upiAmt: payAmts.upiAmt, cardAmt: payAmts.cardAmt, orderItems });
    if (result.error) {
      toast(result.error, 'error');
      btn.disabled = false;
      btn.innerHTML = '💾 Save Entry';
      hide('rowWhatsapp');
      hide('rowDetailsBtn');
      return;
    }

    LAST_ENTRY_RESULT = result;
    CURRENT_CUSTOMER = {
      found: true, mobile,
      totalEntries: result.totalEntries,
      rewardsClaimed: result.rewardsClaimed,
      eligible: result.eligible,
      lastVisitDate: date
    };

    // Refresh WhatsApp link with actual server data
    buildWhatsAppLink(result, mobile, amount, message);

    // If now eligible, show claim button
    const actualCycle = result.cycle || cycle;
    if (result.eligible && result.rewardsClaimed < result.totalEntries / actualCycle) {
      document.getElementById('btnClaimForce').style.display = '';
    }

    // Optimistically update cache and trigger background sync
    const newCacheEntry = {
      mobile: mobile,
      numEntries: result.totalEntries,
      amount: amount,
      date: date,
      time: time,
      cash: payAmts.cashAmt,
      upi: payAmts.upiAmt,
      card: payAmts.cardAmt,
      orderItems: orderItems,
      source: 'Sheet2'
    };
    ALL_ENTRIES_CACHE.unshift(newCacheEntry);
    setCacheItem('getAllEntries', ALL_ENTRIES_CACHE);
    
    // Refresh currently open sections if needed
    if (document.getElementById('sectionDashboard').classList.contains('active')) {
      loadDashboardData();
    } else if (document.getElementById('sectionAllEntries') && document.getElementById('sectionAllEntries').classList.contains('active')) {
      loadAllEntries();
    }
    
    // Background sync to ensure full parity
    downloadSheetCache(true);

  } catch (e) {
    toast('Error saving: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '💾 Save Entry';
  }
}

// ──── RECEIPT ONLY (NO DB SAVE) ────
async function handleReceiptOnly() {
  const mobile = document.getElementById('dispMobile').value;
  const amount = parseInt(document.getElementById('inputAmount').value, 10);
  const date   = document.getElementById('dispDate').value;
  const time   = istTimeStr(); // refresh time
  const message = document.getElementById('inputMessage').value.trim();

  hideErr('errAmount');
  if (isNaN(amount) || amount <= 0) {
    toast('Please enter a valid billing amount.', 'error');
    document.getElementById('inputAmount').classList.add('error');
    return;
  }
  document.getElementById('inputAmount').classList.remove('error');

  const btn = document.getElementById('btnReceiptOnly');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving Receipt…';

  const payAmts = getPaymentAmounts(amount);
  const orderItems = localStorage.getItem('ppp_pendingOrderItems') || '';

  try {
    // Save uncounted/receipt-only entry to Sheet7 in the background
    await api({
      action: 'addSheet7Entry',
      mobile,
      amount,
      date,
      time,
      message,
      cashAmt: payAmts.cashAmt,
      upiAmt: payAmts.upiAmt,
      cardAmt: payAmts.cardAmt,
      orderItems
    });
    toast('✅ Receipt saved to database!', 'success');

    // Clear persistent entry data from localStorage since it is saved
    localStorage.removeItem('ppp_loyalty_form_open');
    localStorage.removeItem('ppp_loyalty_mobile');
    localStorage.removeItem('ppp_loyalty_amount');
    localStorage.removeItem('ppp_loyalty_message');
    localStorage.removeItem('ppp_pendingOrderItems');

    // Optimistically update cache and trigger background sync
    const newCacheEntry = {
      mobile: mobile,
      numEntries: null,
      amount: amount,
      date: date,
      time: time,
      cash: payAmts.cashAmt,
      upi: payAmts.upiAmt,
      card: payAmts.cardAmt,
      orderItems: orderItems,
      source: 'Sheet7'
    };
    ALL_ENTRIES_CACHE.unshift(newCacheEntry);
    setCacheItem('getAllEntries', ALL_ENTRIES_CACHE);
    
    // Refresh currently open sections if needed
    if (document.getElementById('sectionDashboard').classList.contains('active')) {
      loadDashboardData();
    } else if (document.getElementById('sectionAllEntries') && document.getElementById('sectionAllEntries').classList.contains('active')) {
      loadAllEntries();
    }
    
    // Background sync to ensure full parity
    downloadSheetCache(true);
    
  } catch (e) {
    console.error('Failed to save receipt to Sheet7', e);
    toast('⚠️ WhatsApp receipt generated, but database sync failed.', 'warning');
  }

  btn.disabled = false;
  btn.innerHTML = '🧾 Generate Receipt Only';

  // Build the WhatsApp link using the current customer's data, without adding a loyalty entry
  buildWhatsAppLink(CURRENT_CUSTOMER, mobile, amount, message);
  show('rowWhatsapp');
  show('rowDetailsBtn');
}

// ──── ALL ENTRIES LISTING ────
async function loadAllEntries() {
  const tbody = document.getElementById('allEntriesTableBody');
  const mobileList = document.getElementById('allEntriesMobileList');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;"><span class="spinner" style="border-top-color:var(--brand-primary)"></span> Loading entries...</td></tr>';
  if (mobileList) {
    mobileList.innerHTML = '<div style="text-align:center; padding: 2rem;"><span class="spinner" style="border-top-color:var(--brand-primary)"></span> Loading entries...</div>';
  }

  try {
    const entries = await api({ action: 'getAllEntries' });
    ALL_ENTRIES_CACHE = entries || [];
    tbody.innerHTML = '';
    if (mobileList) mobileList.innerHTML = '';

    if (ALL_ENTRIES_CACHE && ALL_ENTRIES_CACHE.length > 0) {
      ALL_ENTRIES_CACHE.forEach((e, idx) => {
        // Format payment modes string (e.g. Cash: ₹100, UPI: ₹200, Card: ₹0)
        const modes = [];
        if (e.cash > 0) modes.push(`Cash: ₹${e.cash}`);
        if (e.upi > 0) modes.push(`UPI: ₹${e.upi}`);
        if (e.card > 0) modes.push(`Card: ₹${e.card}`);
        
        // If all are 0 or empty (e.g. legacy data), default to the whole amount as cash
        let modesStr = modes.join(', ');
        if (!modesStr) {
          modesStr = `Cash: ₹${e.amount}`;
        }

        const visitNum = (e.numEntries === null || e.numEntries === undefined || isNaN(e.numEntries)) ? '—' : e.numEntries;

        let itemsHtml = '<span style="color:var(--text-muted); font-size: 0.85rem;">—</span>';
        if (e.orderItems) {
          try {
            const items = JSON.parse(e.orderItems);
            if (Array.isArray(items) && items.length > 0) {
              itemsHtml = '<div class="ordered-items-list">';
              items.forEach(item => {
                const flavourSuffix = item.flavour ? ` (${item.flavour})` : '';
                itemsHtml += `
                  <span class="ordered-item-badge">
                    <span class="item-badge-category">${item.categoryName}</span>
                    <span class="item-badge-name">${item.dishName}${flavourSuffix}</span>
                    <span class="item-badge-qty">×${item.qty}</span>
                  </span>
                `;
              });
              itemsHtml += '</div>';
            }
          } catch(err) {
            // Ignore parse errors or old string entries
          }
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${e.mobile}</td>
          <td>${e.date}</td>
          <td>${e.time}</td>
          <td style="font-weight: 700;">₹${e.amount}</td>
          <td>${modesStr}</td>
          <td>${itemsHtml}</td>
          <td style="text-align: center;">${visitNum}</td>
        `;
        tbody.appendChild(tr);

        // Mobile list rendering
        if (mobileList) {
          const card = document.createElement('div');
          card.className = 'mobile-entry-card fade-in';
          card.innerHTML = `
            <div class="mobile-entry-card__header">
              <div class="mobile-entry-card__phone">📱 +91 ${e.mobile}</div>
              <div class="mobile-entry-card__amount">₹${e.amount}</div>
            </div>
            <div class="mobile-entry-card__actions">
              <button class="btn btn--outline btn--sm btn--block" onclick="showEntryDetails(${idx})">All Details</button>
            </div>
          `;
          mobileList.appendChild(card);
        }
      });
    } else {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">No entries found.</td></tr>';
      if (mobileList) {
        mobileList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:2rem;">No entries found.</div>';
      }
    }
  } catch (e) {
    console.error('Failed to load all entries', e);
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--danger);">Error loading entries. Please try again.</td></tr>';
    if (mobileList) {
      mobileList.innerHTML = '<div style="text-align:center;color:var(--danger);padding:2rem;">Error loading entries. Please try again.</div>';
    }
  }
}

function showEntryDetails(index) {
  const entry = ALL_ENTRIES_CACHE[index];
  if (!entry) return;

  const container = document.getElementById('modalEntryDetailsBody');
  if (!container) return;

  const modes = [];
  if (entry.cash > 0) modes.push(`Cash: ₹${entry.cash}`);
  if (entry.upi > 0) modes.push(`UPI: ₹${entry.upi}`);
  if (entry.card > 0) modes.push(`Card: ₹${entry.card}`);
  let modesStr = modes.join(', ');
  if (!modesStr) {
    modesStr = `Cash: ₹${entry.amount}`;
  }

  const visitNum = (entry.numEntries === null || entry.numEntries === undefined || isNaN(entry.numEntries)) ? '—' : entry.numEntries;

  let itemsHtml = '<span style="color:var(--text-muted); font-size: 0.85rem;">—</span>';
  if (entry.orderItems) {
    try {
      const items = JSON.parse(entry.orderItems);
      if (Array.isArray(items) && items.length > 0) {
        itemsHtml = '<div class="ordered-items-list" style="display:flex; flex-direction:column; gap:0.5rem;">';
        items.forEach(item => {
          const flavourSuffix = item.flavour ? ` (${item.flavour})` : '';
          itemsHtml += `
            <div class="ordered-item-badge" style="display:flex; justify-content:space-between; align-items:center; width:100%; max-width:none;">
              <span>
                <strong style="color:var(--brand-primary); font-size:0.75rem; text-transform:uppercase; margin-right:4px;">${item.categoryName}</strong>
                <span>${item.dishName}${flavourSuffix}</span>
              </span>
              <strong style="white-space:nowrap; margin-left:8px;">×${item.qty}</strong>
            </div>
          `;
        });
        itemsHtml += '</div>';
      }
    } catch(err) {
      // Ignore parse error
    }
  }

  container.innerHTML = `
    <div class="detail-row">
      <span style="color:var(--text-muted);">Mobile Number</span>
      <strong style="color:var(--text-light);">+91 ${entry.mobile}</strong>
    </div>
    <div class="detail-row">
      <span style="color:var(--text-muted);">Date & Time</span>
      <strong style="color:var(--text-light);">${entry.date} ${entry.time}</strong>
    </div>
    <div class="detail-row">
      <span style="color:var(--text-muted);">Grand Total</span>
      <strong style="color:var(--brand-primary); font-size:1.2rem;">₹${entry.amount}</strong>
    </div>
    <div class="detail-row">
      <span style="color:var(--text-muted);">Payment Mode</span>
      <strong style="color:var(--text-light);">${modesStr}</strong>
    </div>
    <div class="detail-row">
      <span style="color:var(--text-muted);">Visit #</span>
      <strong style="color:var(--text-light);">${visitNum}</strong>
    </div>
    <div class="detail-row">
      <div style="color:var(--text-muted); margin-bottom:0.5rem;">Ordered Items</div>
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-input); border-radius:8px; padding:0.75rem; width: 100%;">
        ${itemsHtml}
      </div>
    </div>
  `;

  document.getElementById('modalEntryDetails').classList.add('open');
}

function closeEntryDetailsModal() {
  document.getElementById('modalEntryDetails').classList.remove('open');
}

// ──── WHATSAPP LINK ────
function buildWhatsAppLink(result, mobile, amount, message) {
  const template = WHATSAPP_TEMPLATE;
  const cycle    = (result && result.cycle) || (APP_CONFIG ? APP_CONFIG.cycle : 10);
  const total    = (result && typeof result.totalEntries === 'number') ? result.totalEntries : 0;

  // cyclePosition
  const mod = total % cycle;
  const cyclePosition = total === 0 ? 0 : (mod === 0 ? cycle : mod);
  const completedVisit = cyclePosition + '/' + cycle;

  // loyalty link
  const loyaltyNum = total === 0 ? 0 : (mod === 0 ? cycle : cyclePosition);
  const loyaltyLink = 'https://perfectpizzapoint.github.io/' + loyaltyNum + '/';

  let link = template
    .replace('<number>', mobile)
    .replace('<completedvisit>', encodeURIComponent(completedVisit))
    .replace('<amount>', amount)
    .replace('<message>', encodeURIComponent(message || ''))
    .replace('<loyality>', encodeURIComponent(loyaltyLink));

  document.getElementById('linkWhatsapp').href = link;
}

// ──── CLAIM REWARD ────
async function handleClaimReward() {
  const mobile = document.getElementById('dispMobile').value;
  const btn = document.getElementById('btnClaimForce');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Claiming…';

  try {
    const result = await api({ action: 'claimReward', mobile });
    if (result.error) {
      toast(result.error, 'error');
      btn.disabled = false;
      btn.innerHTML = '🎁 Claim Reward';
      return;
    }

    toast('🎉 Reward claimed! Free meal up to ₹' + result.rewardValue, 'success');
    CURRENT_CUSTOMER = {
      found: true, mobile,
      totalEntries: result.totalEntries,
      rewardsClaimed: result.rewardsClaimed,
      eligible: result.eligible,
      lastVisitDate: CURRENT_CUSTOMER ? CURRENT_CUSTOMER.lastVisitDate : ''
    };

    btn.innerHTML = '✔ Claimed';
    btn.disabled = true;

    // Recalculate button visibility and state based on new CURRENT_CUSTOMER data
    checkAmountAndToggleButtons();

    show('rowDetailsBtn');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '🎁 Claim Reward';
  }
}

// ══════════════════════════════════════
//  CUSTOMER DETAILS MODAL
// ══════════════════════════════════════

function openDetailsModal() {
  if (!CURRENT_CUSTOMER || !CURRENT_CUSTOMER.found) {
    toast('No customer data available.', 'error');
    return;
  }
  renderDots();
  renderRewardEmojis();
  renderEligibility();
  hide('pastEntriesWrap');
  document.getElementById('btnShowDetails').textContent = '📄 Show Details';
  document.getElementById('modalDetails').classList.add('open');
}

function closeDetailsModal() {
  document.getElementById('modalDetails').classList.remove('open');
}

function renderDots() {
  const container = document.getElementById('dotsContainer');
  container.innerHTML = '';
  const c = CURRENT_CUSTOMER;
  const cycle = APP_CONFIG ? APP_CONFIG.cycle : 10;
  const total = c.totalEntries;
  const fullCycles = Math.floor(total / cycle);
  const remainder = total % cycle;
  const rowsNeeded = fullCycles + (remainder > 0 ? 1 : 0);

  for (let row = 0; row < Math.max(rowsNeeded, 1); row++) {
    const div = document.createElement('div');
    div.className = 'dots-cycle';

    const label = document.createElement('span');
    label.className = 'dots-cycle__label';
    const start = row * cycle + 1;
    const end = start + cycle - 1;
    label.textContent = start + '–' + end;
    div.appendChild(label);

    const dotsRow = document.createElement('div');
    dotsRow.className = 'dots-row';

    for (let d = 0; d < cycle; d++) {
      const dotIndex = row * cycle + d + 1;
      const dot = document.createElement('span');
      dot.className = 'dot';
      if (dotIndex <= total) {
        dot.classList.add('filled');
        // Mark cycle-completion dots as reward
        if (dotIndex % cycle === 0) dot.classList.add('reward');
      }
      dot.title = 'Visit ' + dotIndex;
      dotsRow.appendChild(dot);
    }
    div.appendChild(dotsRow);
    container.appendChild(div);
  }
}

function renderRewardEmojis() {
  const container = document.getElementById('rewardEmojis');
  const badge = document.getElementById('rewardCountBadge');
  container.innerHTML = '';
  const count = CURRENT_CUSTOMER.rewardsClaimed || 0;
  if (badge) badge.textContent = count;
  
  if (count === 0) {
    container.innerHTML = '<span style="font-size:.82rem;color:var(--text-muted);">None yet</span>';
    return;
  }
  for (let i = 0; i < count; i++) {
    const span = document.createElement('span');
    span.className = 'reward-emoji';
    span.textContent = '🍕';
    span.style.animationDelay = (i * 0.08) + 's';
    container.appendChild(span);
  }
}

function renderEligibility() {
  const banner = document.getElementById('eligibilityBanner');
  const c = CURRENT_CUSTOMER;
  const cycle = APP_CONFIG ? APP_CONFIG.cycle : 10;
  const rewardVal = APP_CONFIG ? APP_CONFIG.rewardValue : 150;
  const needsClaim = c.eligible && c.rewardsClaimed < c.totalEntries / cycle;

  if (needsClaim) {
    banner.innerHTML =
      '<div class="eligibility-banner eligible">' +
      '🎉 Eligible for Reward! Free meal up to ₹' + rewardVal +
      '</div>';
  } else {
    const mod = c.totalEntries % cycle;
    const remain = cycle - mod;
    banner.innerHTML =
      '<div class="eligibility-banner not-eligible">' +
      '📊 ' + (mod === 0 && c.totalEntries > 0 ? cycle : mod) + '/' + cycle +
      ' visits completed. ' + (mod === 0 && c.totalEntries > 0 ? 0 : remain) +
      ' more to next reward.' +
      '</div>';
  }
}

async function loadPastEntries() {
  const btn = document.getElementById('btnShowDetails');
  const wrap = document.getElementById('pastEntriesWrap');

  if (!wrap.classList.contains('hidden')) {
    hide('pastEntriesWrap');
    btn.textContent = '📄 Show Details';
    return;
  }

  btn.innerHTML = '<span class="spinner"></span> Loading…';
  btn.disabled = true;

  try {
    const mobile = CURRENT_CUSTOMER.mobile;
    const data = await api({ action: 'getCustomerDetails', mobile });
    const tbody = document.getElementById('pastEntriesBody');
    tbody.innerHTML = '';

    if (data.entries && data.entries.length > 0) {
      data.entries.forEach(e => {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + e.index + '</td>' +
          '<td>' + e.mobile + '</td>' +
          '<td>₹' + e.amount + '</td>' +
          '<td>' + e.date + '</td>' +
          '<td>' + e.time + '</td>' +
          '<td>' + (e.message || '—') + '</td>';
        tbody.appendChild(tr);
      });
    } else {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">No entries found.</td></tr>';
    }
    show('pastEntriesWrap');
    btn.textContent = '📄 Hide Details';
  } catch (e) {
    toast('Error loading details: ' + e.message, 'error');
    btn.textContent = '📄 Show Details';
  }
  btn.disabled = false;
}

// ══════════════════════════════════════
//  ADMIN PANEL
// ══════════════════════════════════════
async function handleAdminLogin() {
  const user = document.getElementById('adminUser').value.trim();
  const pass = document.getElementById('adminPass').value.trim();
  hideErr('errLogin');

  const btn = document.getElementById('btnLogin');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Logging in…';

  try {
    const authResult = await api({ action: 'getAdminCreds', inputUser: user, inputPass: pass });

    if (!authResult.authenticated) {
      showErr('errLogin');
      btn.disabled = false;
      btn.innerHTML = 'Login to Dashboard';
      return;
    }

    ADMIN_AUTHENTICATED = true;
    hide('adminLoginWrap');
    show('adminPOSPanel');
    loadAdminPOSConfig();
    toast('Welcome, Admin! 🎉', 'success');
  } catch (e) {
    toast('Login error: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.innerHTML = 'Login to Dashboard';
}


// ──── Dashboard Render ────
let todayView = 'entries';

function renderAdminDashboard(data) {
  if (!data) return;

  const grid = document.getElementById('statsGrid');
  const stats = [
    { label: 'Total Customers', value: data.totalCustomers, icon: '👥' },
    { label: 'Total Visits', value: data.totalVisits, icon: '📊' },
    { label: 'Rewards Given', value: data.rewardsGiven, icon: '🎁' },
    { label: 'Rewards Pending', value: data.rewardsPending, icon: '⏳' },
    { label: 'Avg Billing', value: '₹' + data.avgBilling, icon: '💰' },
    { label: 'Avg Visits/Cust', value: data.avgVisits, icon: '🔄' },
    { label: 'Reward Conv. Rate', value: data.conversionRate + '%', icon: '📈' },
  ];

  grid.innerHTML = stats.map(s =>
    '<div class="stat-card">' +
    '<div class="stat-card__value">' + s.icon + ' ' + s.value + '</div>' +
    '<div class="stat-card__label">' + s.label + '</div>' +
    '</div>'
  ).join('');

  // Today's value
  renderTodayValue(data);

  // Repeat vs New chart
  renderRepeatNewChart(data);

  // Top customers
  renderTopCustomers(data.topCustomers);
}

function renderTodayValue(data) {
  const el = document.getElementById('todayValue');
  if (todayView === 'entries') {
    el.textContent = data.todayCount + ' entries';
  } else {
    el.textContent = '₹' + data.todayAmount;
  }
}

function setTodayView(view, btn) {
  todayView = view;
  document.querySelectorAll('#todayToggle .toggle-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (ADMIN_DATA) renderTodayValue(ADMIN_DATA);
}

let repeatNewChart = null;
function renderRepeatNewChart(data) {
  const ctx = document.getElementById('chartRepeatNew').getContext('2d');
  if (repeatNewChart) repeatNewChart.destroy();

  repeatNewChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Repeat', 'New'],
      datasets: [{
        data: [data.repeatCount, data.newCount],
        backgroundColor: ['#e85d04', '#faa307'],
        borderWidth: 0,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: 'Inter' } } }
      },
      cutout: '65%'
    }
  });
}

function renderTopCustomers(list) {
  const ul = document.getElementById('topCustomersList');
  if (!list || list.length === 0) {
    ul.innerHTML = '<li style="color:var(--text-muted);">No data yet.</li>';
    return;
  }
  ul.innerHTML = list.map((c, i) =>
    '<li>' +
    '<div style="display:flex;align-items:center;">' +
    '<span class="top-list__rank">' + (i + 1) + '</span>' +
    '<span>' + c.mobile + '</span>' +
    '</div>' +
    '<span style="font-weight:700;color:var(--brand-primary);">' + c.entries + ' visits</span>' +
    '</li>'
  ).join('');
}

// ──── Heatmap ────
let heatmapType = 'amount';

function setHeatmapType(type, btn) {
  heatmapType = type;
  document.querySelectorAll('#heatmapToggle .toggle-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  calculateHeatmap();
}

function calculateHeatmap() {
  const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
  
  ALL_ENTRIES_CACHE.forEach(entry => {
    if (!entry.date || !entry.time) return;
    const dObj = new Date(entry.date);
    const dayOfWeek = dObj.getDay();
    const parts = entry.time.split(':');
    if (parts.length >= 1 && !isNaN(dayOfWeek)) {
      const hour = parseInt(parts[0], 10);
      if (hour >= 0 && hour < 24) {
        if (heatmapType === 'amount') matrix[dayOfWeek][hour] += entry.amount || 0;
        else matrix[dayOfWeek][hour] += 1;
      }
    }
  });

  renderHeatmap(matrix);
}

function renderHeatmap(matrix) {
  const container = document.getElementById('heatmapContainer');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let maxVal = 0;
  matrix.forEach(row => row.forEach(v => { if (v > maxVal) maxVal = v; }));

  let html = '<div class="heatmap-grid">';
  // Header row
  html += '<div class="heatmap-label"></div>';
  for (let h = 0; h < 24; h++) {
    html += '<div class="heatmap-header">' + h + '</div>';
  }
  // Data rows
  for (let d = 0; d < 7; d++) {
    html += '<div class="heatmap-label">' + days[d] + '</div>';
    for (let h = 0; h < 24; h++) {
      const val = matrix[d][h];
      const intensity = maxVal > 0 ? val / maxVal : 0;
      const bg = intensity === 0
        ? 'var(--dot-empty)'
        : 'rgba(232, 93, 4, ' + (0.15 + intensity * 0.85) + ')';
      html += '<div class="heatmap-cell" style="background:' + bg + '">' +
        '<div class="heatmap-tooltip">' + days[d] + ' ' + h + ':00 — ' + val + '</div>' +
        '</div>';
    }
  }
  html += '</div>';
  container.innerHTML = html;
}

// ──── Time Between Visits ────
let tbvChart = null;

function calculateTimeBetweenVisits() {
  const byMobile = {};
  
  ALL_ENTRIES_CACHE.forEach(r => {
    if (!r.mobile || !r.date) return;
    const m = r.mobile;
    if (!byMobile[m]) byMobile[m] = [];
    byMobile[m].push(new Date(r.date));
  });

  const gaps = [];
  Object.keys(byMobile).forEach(m => {
    const dates = byMobile[m].sort((a, b) => a - b);
    for (let i = 1; i < dates.length; i++) {
      const diff = Math.round((dates[i] - dates[i - 1]) / 86400000);
      if (diff >= 0) gaps.push(diff);
    }
  });

  let data = { avg: 0, min: 0, max: 0, totalGaps: 0, distribution: {} };

  if (gaps.length > 0) {
    const avg = Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 100) / 100;
    const min = Math.min(...gaps);
    const max = Math.max(...gaps);

    const dist = {};
    gaps.forEach(g => { const bucket = Math.min(g, 30); dist[bucket] = (dist[bucket] || 0) + 1; });
    data = { avg, min, max, totalGaps: gaps.length, distribution: dist };
  }

  show('tbvContainer');

  const statsGrid = document.getElementById('tbvStats');
  if (statsGrid) {
    statsGrid.innerHTML = [
      { label: 'Avg Gap', value: data.avg + ' days' },
      { label: 'Min Gap', value: data.min + ' days' },
      { label: 'Max Gap', value: data.max + ' days' },
      { label: 'Total Pairs', value: data.totalGaps || 0 },
    ].map(s =>
      '<div class="stat-card"><div class="stat-card__value">' + s.value +
      '</div><div class="stat-card__label">' + s.label + '</div></div>'
    ).join('');
  }

    // Distribution chart
    const dist = data.distribution || {};
    const labels = Object.keys(dist).sort((a, b) => Number(a) - Number(b));
    const values = labels.map(k => dist[k]);

    const ctx = document.getElementById('chartTBV').getContext('2d');
    if (tbvChart) tbvChart.destroy();
    tbvChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels.map(l => l + (l === '30' ? '+' : '') + 'd'),
        datasets: [{
          label: 'Frequency',
          data: values,
          backgroundColor: 'rgba(232,93,4,.7)',
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { font: { family: 'Inter' } } },
          x: { ticks: { font: { family: 'Inter', size: 10 } } }
        }
      }
    });
}

// ══════════════════════════════════════
//  POS SYSTEM LOGIC
// ══════════════════════════════════════

let POS_STATE = {
  tableCount: 0,
  currentTableId: null,
  currentCategoryIndex: null,
  categories: [],
  dishes: [], // dishes for current category
  tableOrders: JSON.parse(localStorage.getItem('ppp_tableOrders') || '{}'),
  flavoursMap: {}
};

async function initPos() {
  if (POS_STATE.tableCount === 0) {
    try {
      const res = await api({ action: 'getTableCount' });
      POS_STATE.tableCount = res.count || 0;
    } catch (e) {
      console.error('Failed to load table count', e);
    }
  }
  // Initialize occupiedSince for any loaded tableOrders that have items but no timestamp
  if (POS_STATE.tableOrders) {
    let updated = false;
    for (let tableId in POS_STATE.tableOrders) {
      const order = POS_STATE.tableOrders[tableId];
      if (order && Object.keys(order).some(k => k !== 'occupiedSince' && order[k].qty > 0)) {
        if (!order.occupiedSince) {
          order.occupiedSince = Date.now();
          updated = true;
        }
      }
    }
    if (updated) {
      localStorage.setItem('ppp_tableOrders', JSON.stringify(POS_STATE.tableOrders));
    }
  }
  showPosTables();
}

function updateTableTimers() {
  const view = document.getElementById('posTablesView');
  if (!view || view.classList.contains('hidden')) return;
  
  for (let i = 1; i <= POS_STATE.tableCount; i++) {
    const timerEl = document.getElementById(`table-timer-${i}`);
    if (!timerEl) continue;
    
    const order = POS_STATE.tableOrders[i];
    const hasOrder = order && Object.keys(order).some(k => k !== 'occupiedSince' && order[k].qty > 0);
    
    if (hasOrder && order.occupiedSince) {
      const elapsedMs = Date.now() - order.occupiedSince;
      const elapsedSec = Math.floor(elapsedMs / 1000);
      const hrs = Math.floor(elapsedSec / 3600);
      const mins = Math.floor((elapsedSec % 3600) / 60);
      const secs = elapsedSec % 60;
      
      const pad = (num) => String(num).padStart(2, '0');
      const timeStr = hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
      
      timerEl.textContent = `⏱️ ${timeStr}`;
      timerEl.style.display = 'block';
    } else {
      timerEl.textContent = '';
      timerEl.style.display = 'none';
    }
  }
}

// Start updating table timers globally every second
if (!window.tableTimerInterval) {
  window.tableTimerInterval = setInterval(updateTableTimers, 1000);
}

function showPosTables() {
  hide('posCategoriesView');
  hide('posDishesView');
  show('posTablesView');
  
  const grid = document.getElementById('posTablesGrid');
  grid.innerHTML = '';
  
  if (POS_STATE.tableCount === 0) {
    grid.innerHTML = '<p style="grid-column:1/-1; text-align:center;">No tables configured. Please configure in Admin.</p>';
    return;
  }
  
  for (let i = 1; i <= POS_STATE.tableCount; i++) {
    const card = document.createElement('div');
    card.className = 'pos-table-card';
    card.onclick = () => openPosTable(i);
    
    // show an indicator if the table has an active order
    const hasOrder = POS_STATE.tableOrders[i] && Object.keys(POS_STATE.tableOrders[i]).some(k => k !== 'occupiedSince' && POS_STATE.tableOrders[i][k].qty > 0);
    const indicator = hasOrder ? ' 🔵' : '';
    
    card.innerHTML = `
      <div class="table-icon">🪑</div>
      <div class="table-name">Table ${i}${indicator}</div>
      <div class="table-timer" id="table-timer-${i}" style="display: none;"></div>
    `;
    grid.appendChild(card);
  }
  updateTableTimers();
}

async function openPosTable(tableId) {
  POS_STATE.currentTableId = tableId;
  if (!POS_STATE.tableOrders[tableId]) {
    POS_STATE.tableOrders[tableId] = {};
  }
  
  hide('posTablesView');
  show('posCategoriesView');
  
  if (POS_STATE.categories.length === 0) {
    try {
      const res = await api({ action: 'getCategories' });
      POS_STATE.categories = res.categories || [];
    } catch (e) {
      toast('Failed to load categories', 'error');
    }
  }
  
  const grid = document.getElementById('posCategoriesGrid');
  grid.innerHTML = '';
  
  if (POS_STATE.categories.length === 0) {
    grid.innerHTML = '<p style="grid-column:1/-1; text-align:center;">No categories found.</p>';
    return;
  }
  
  POS_STATE.categories.forEach(cat => {
    const card = document.createElement('div');
    card.className = 'pos-category-card';
    card.textContent = cat.name;
    card.onclick = () => openPosCategory(cat.index);
    grid.appendChild(card);
  });
}

async function openPosCategory(catIndex) {
  POS_STATE.currentCategoryIndex = catIndex;
  hide('posCategoriesView');
  show('posDishesView');
  
  const grid = document.getElementById('posDishesGrid');
  grid.innerHTML = '<p style="grid-column:1/-1; text-align:center;"><span class="spinner" style="border-top-color:var(--brand-primary)"></span> Loading dishes...</p>';
  
  try {
    // Fetch dishes and flavours concurrently if flavours map is empty
    const tasks = [api({ action: 'getDishes', parentIndex: catIndex })];
    if (Object.keys(POS_STATE.flavoursMap).length === 0) {
      tasks.push(api({ action: 'getFlavoursMap' }));
    }
    
    const results = await Promise.all(tasks);
    POS_STATE.dishes = results[0].dishes || [];
    
    if (results.length > 1 && results[1].flavoursMap) {
      POS_STATE.flavoursMap = results[1].flavoursMap;
    }
    
    renderPosDishes();
  } catch (e) {
    toast('Failed to load dishes', 'error');
    grid.innerHTML = '';
  }
}

function showPosCategories() {
  hide('posDishesView');
  show('posCategoriesView');
}

function renderPosDishes() {
  const grid = document.getElementById('posDishesGrid');
  grid.innerHTML = '';
  
  if (POS_STATE.dishes.length === 0) {
    grid.innerHTML = '<p style="grid-column:1/-1; text-align:center;">No dishes in this category.</p>';
    return;
  }
  
  const order = POS_STATE.tableOrders[POS_STATE.currentTableId];
  
  POS_STATE.dishes.forEach(dish => {
    const dishKey = `dish-${dish.dishIndex}`; // Using dish index as unique ID
    
    // Calculate total quantity across all flavours for this dish
    let currentQty = 0;
    if (order) {
      Object.keys(order).forEach(key => {
        if (key === dishKey || key.startsWith(dishKey + '::')) {
          currentQty += order[key].qty;
        }
      });
    }
    
    const card = document.createElement('div');
    card.className = 'pos-dish-card';
    card.innerHTML = `
      <div class="pos-dish-info" onclick="updateDishQty(${dish.dishIndex}, '${dish.name}', ${dish.amount}, 1)">
        <div class="pos-dish-name">${dish.name}</div>
        <div class="pos-dish-price">₹${dish.amount}</div>
      </div>
      <div class="qty-selector">
        <button class="qty-btn" onclick="updateDishQty(${dish.dishIndex}, '${dish.name}', ${dish.amount}, -1)">-</button>
        <div class="qty-display" id="qty-dish-${dish.dishIndex}">${currentQty}</div>
        <button class="qty-btn" onclick="updateDishQty(${dish.dishIndex}, '${dish.name}', ${dish.amount}, 1)">+</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function updateDishQty(dishIndex, name, price, delta) {
  const dishKey = `dish-${dishIndex}`;
  const flavours = POS_STATE.flavoursMap[dishIndex];
  
  const order = POS_STATE.tableOrders[POS_STATE.currentTableId];
  
  if (delta > 0) {
    // Adding
    if (flavours && flavours.length > 0) {
      openFlavourModal(dishIndex, name, price, flavours);
    } else {
      incrementDishVariant(dishKey, name, price, delta);
    }
  } else {
    // Removing
    let activeVariants = [];
    if (order) {
      Object.keys(order).forEach(key => {
        if ((key === dishKey || key.startsWith(dishKey + '::')) && order[key].qty > 0) {
          activeVariants.push({ key, name: order[key].name, qty: order[key].qty });
        }
      });
    }
    
    if (activeVariants.length === 0) return;
    
    if (activeVariants.length > 1) {
      openFlavourRemoveModal(dishIndex, name, activeVariants);
    } else {
      // Only one variant active, just reduce it
      incrementDishVariant(activeVariants[0].key, activeVariants[0].name, price, delta);
    }
  }
}

function incrementDishVariant(variantKey, variantName, price, delta) {
  const order = POS_STATE.tableOrders[POS_STATE.currentTableId];
  const hasItemsBefore = Object.keys(order).some(k => k !== 'occupiedSince' && order[k].qty > 0);

  if (!order[variantKey]) {
    const categoryObj = POS_STATE.categories.find(c => c.index === POS_STATE.currentCategoryIndex);
    const categoryName = categoryObj ? categoryObj.name : 'Unknown';
    let dishName = variantName;
    let flavour = '';
    if (variantKey.includes('::')) {
      const parts = variantKey.split('::');
      flavour = parts[1];
      const suffix = ` (${flavour})`;
      if (variantName.endsWith(suffix)) {
        dishName = variantName.substring(0, variantName.length - suffix.length);
      }
    }
    order[variantKey] = {
      name: variantName,
      price: price,
      qty: 0,
      categoryName: categoryName,
      dishName: dishName,
      flavour: flavour
    };
  }
  
  let newQty = order[variantKey].qty + delta;
  if (newQty < 0) newQty = 0;
  
  order[variantKey].qty = newQty;
  if (newQty === 0) {
    delete order[variantKey];
  }
  
  const hasItemsAfter = Object.keys(order).some(k => k !== 'occupiedSince' && order[k].qty > 0);
  
  if (hasItemsAfter && !hasItemsBefore) {
    order.occupiedSince = Date.now();
  } else if (!hasItemsAfter) {
    delete order.occupiedSince;
  }
  
  localStorage.setItem('ppp_tableOrders', JSON.stringify(POS_STATE.tableOrders));
  
  // Re-render the dish quantity display
  const baseKey = variantKey.split('::')[0];
  let totalQty = 0;
  Object.keys(order).forEach(key => {
    if (key === baseKey || key.startsWith(baseKey + '::')) {
      totalQty += order[key].qty;
    }
  });
  
  const qtyDisplay = document.getElementById(`qty-${baseKey}`);
  if (qtyDisplay) qtyDisplay.textContent = totalQty;
}

// ══════════════════════════════════════
//  FLAVOUR MODALS
// ══════════════════════════════════════

let currentFlavourSelection = null;

function openFlavourModal(dishIndex, name, price, flavours) {
  document.getElementById('flavourModalDishName').textContent = name;
  const container = document.getElementById('flavourOptionsContainer');
  container.innerHTML = '';
  
  currentFlavourSelection = { dishIndex, name, price, selectedFlavour: null };
  
  flavours.forEach((flavour, idx) => {
    const id = `flavour_opt_${idx}`;
    const optionDiv = document.createElement('div');
    optionDiv.className = 'flavour-option';
    optionDiv.onclick = () => {
      document.querySelectorAll('.flavour-option').forEach(el => el.classList.remove('selected'));
      optionDiv.classList.add('selected');
      document.getElementById(id).checked = true;
      currentFlavourSelection.selectedFlavour = flavour;
      
      // Automatically confirm selection after a 150ms delay
      setTimeout(() => {
        confirmFlavourSelection();
      }, 150);
    };
    
    optionDiv.innerHTML = `
      <input type="radio" name="flavour_radio" id="${id}" value="${flavour}">
      <label for="${id}" style="cursor:pointer; flex-grow:1;">${flavour}</label>
    `;
    container.appendChild(optionDiv);
  });
  
  document.getElementById('modalFlavour').classList.add('open');
}

function closeFlavourModal() {
  document.getElementById('modalFlavour').classList.remove('open');
  currentFlavourSelection = null;
}

function confirmFlavourSelection() {
  if (!currentFlavourSelection || !currentFlavourSelection.selectedFlavour) return;
  
  const { dishIndex, name, price, selectedFlavour } = currentFlavourSelection;
  const variantKey = `dish-${dishIndex}::${selectedFlavour}`;
  const variantName = `${name} (${selectedFlavour})`;
  
  incrementDishVariant(variantKey, variantName, price, 1);
  closeFlavourModal();
}

function openFlavourRemoveModal(dishIndex, name, activeVariants) {
  document.getElementById('flavourRemoveModalDishName').textContent = name;
  const container = document.getElementById('flavourRemoveOptionsContainer');
  container.innerHTML = '';
  
  activeVariants.forEach(variant => {
    const optionDiv = document.createElement('div');
    optionDiv.className = 'flavour-remove-item';
    optionDiv.onclick = () => {
      const order = POS_STATE.tableOrders[POS_STATE.currentTableId];
      const price = order[variant.key] ? order[variant.key].price : 0;
      incrementDishVariant(variant.key, variant.name, price, -1);
      closeFlavourRemoveModal();
    };
    
    optionDiv.innerHTML = `
      <span class="flavour-remove-name">${variant.name}</span>
      <span class="flavour-remove-qty">${variant.qty}</span>
    `;
    container.appendChild(optionDiv);
  });
  
  document.getElementById('modalFlavourRemove').classList.add('open');
}

function closeFlavourRemoveModal() {
  document.getElementById('modalFlavourRemove').classList.remove('open');
}

function generateBill() {
  const order = POS_STATE.tableOrders[POS_STATE.currentTableId];
  if (!order || Object.keys(order).length === 0) {
    return toast('No dishes added to the table.', 'error');
  }
  
  let grandTotal = 0;
  const tbody = document.getElementById('billTableBody');
  tbody.innerHTML = '';
  
  let hasItems = false;
  Object.keys(order).forEach(key => {
    const dish = order[key];
    if (dish.qty > 0) {
      hasItems = true;
      const total = dish.qty * dish.price;
      grandTotal += total;
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${dish.name}</td>
        <td style="text-align: center;">${dish.qty}</td>
        <td>₹${dish.price}</td>
        <td style="font-weight: 700;">₹${total}</td>
      `;
      tbody.appendChild(tr);
    }
  });
  
  if (!hasItems) {
    return toast('No dishes added to the table.', 'error');
  }
  
  document.getElementById('billGrandTotal').textContent = '₹' + grandTotal;
  POS_STATE.currentBillTotal = grandTotal;
  
  document.getElementById('modalBill').classList.add('open');
}

function closeBillModal() {
  document.getElementById('modalBill').classList.remove('open');
}

function proceedToCheckout() {
  closeBillModal();
  
  const order = POS_STATE.tableOrders[POS_STATE.currentTableId];
  const pendingItems = [];
  if (order) {
    Object.keys(order).forEach(key => {
      if (key !== 'occupiedSince' && order[key].qty > 0) {
        pendingItems.push({
          categoryName: order[key].categoryName || 'Unknown',
          dishName: order[key].dishName || order[key].name,
          flavour: order[key].flavour || '',
          qty: order[key].qty
        });
      }
    });
  }
  localStorage.setItem('ppp_pendingOrderItems', JSON.stringify(pendingItems));

  // Save total for loyalty form pre-fill
  window.PENDING_POS_TOTAL = POS_STATE.currentBillTotal;
  
  // Clear the table order
  POS_STATE.tableOrders[POS_STATE.currentTableId] = {};
  localStorage.setItem('ppp_tableOrders', JSON.stringify(POS_STATE.tableOrders));
  
  // Clear any existing Loyalty Rewards entry data/state in localStorage and UI
  localStorage.removeItem('ppp_loyalty_form_open');
  localStorage.removeItem('ppp_loyalty_mobile');
  localStorage.removeItem('ppp_loyalty_amount');
  localStorage.removeItem('ppp_loyalty_message');

  // Reset the UI inputs and hide the card
  document.getElementById('inputMobile').value = '';
  document.getElementById('dispMobile').value = '';
  document.getElementById('inputAmount').value = '';
  document.getElementById('inputMessage').value = 'Thank You, Visit Again';
  hide('cardEntryForm');
  hide('rowWhatsapp');
  hide('rowDetailsBtn');
  
  // Switch to home section (Loyalty)
  showSection('home');
  
  // Highlight the mobile input for the user
  document.getElementById('inputMobile').focus();
  toast('Bill generated! Enter customer mobile to apply loyalty.', 'success');
}

// ══════════════════════════════════════
//  POS ADMIN LOGIC
// ══════════════════════════════════════

async function saveAdminTableCount() {
  const count = parseInt(document.getElementById('adminTableCount').value, 10);
  if (isNaN(count) || count < 1) return toast('Invalid table count', 'error');
  
  try {
    await api({ action: 'saveTableCount', count });
    POS_STATE.tableCount = count;
    toast('Table count saved', 'success');
  } catch(e) {
    toast('Failed to save table count', 'error');
  }
}

async function loadAdminCategories() {
  try {
    const res = await api({ action: 'getCategories' });
    const tbody = document.getElementById('adminCategoriesTable');
    const select = document.getElementById('adminDishCategorySelect');
    const selectFlavourCat = document.getElementById('adminFlavourCategorySelect');
    tbody.innerHTML = '';
    select.innerHTML = '<option value="">-- Select Category --</option>';
    if (selectFlavourCat) {
      selectFlavourCat.innerHTML = '<option value="">-- Select Category --</option>';
    }
    
    if (res.categories) {
      res.categories.forEach(cat => {
        // Table
        tbody.innerHTML += `
          <tr>
            <td>${cat.index}</td>
            <td>${cat.name}</td>
            <td>
              <button class="btn btn--sm btn--secondary" onclick="editAdminCategory(${cat.index}, '${cat.name}')">Edit</button>
              <button class="btn btn--sm btn--danger ml-1" onclick="deleteAdminCategory(${cat.index})">Delete</button>
            </td>
          </tr>
        `;
        // Dropdown
        select.innerHTML += '<option value="' + cat.index + '">' + cat.name + '</option>';
        if (selectFlavourCat) {
          selectFlavourCat.innerHTML += '<option value="' + cat.index + '">' + cat.name + '</option>';
        }
      });
    }
  } catch(e) {
    toast('Failed to load categories', 'error');
  }
}

async function addAdminCategory() {
  const name = document.getElementById('adminCategoryName').value.trim();
  if (!name) return;
  
  try {
    await api({ action: 'addCategory', categoryName: name });
    document.getElementById('adminCategoryName').value = '';
    toast('Category added', 'success');
    loadAdminCategories();
  } catch(e) {
    toast('Failed to add category', 'error');
  }
}

async function editAdminCategory(index, oldName) {
  const newName = prompt('Enter new category name:', oldName);
  if (!newName || newName.trim() === oldName) return;
  
  try {
    await api({ action: 'updateCategory', index, newName: newName.trim() });
    toast('Category updated', 'success');
    loadAdminCategories();
  } catch(e) {
    toast('Failed to update category', 'error');
  }
}

async function deleteAdminCategory(index) {
  if (!confirm('Are you sure you want to delete this category?')) return;
  try {
    await api({ action: 'deleteCategory', index });
    toast('Category deleted', 'success');
    loadAdminCategories();
  } catch(e) {
    toast('Failed to delete category', 'error');
  }
}

async function loadAdminDishes() {
  const catIndex = document.getElementById('adminDishCategorySelect').value;
  const tbody = document.getElementById('adminDishesTable');
  tbody.innerHTML = '';
  if (!catIndex) return;
  
  try {
    const res = await api({ action: 'getDishes', parentIndex: catIndex });
    if (res.dishes) {
      res.dishes.forEach(dish => {
        tbody.innerHTML += `
          <tr>
            <td>${dish.name}</td>
            <td>₹${dish.amount}</td>
            <td>
              <button class="btn btn--sm btn--secondary" onclick="editAdminDish(${dish.rowIndex}, '${dish.name}', ${dish.amount})">Edit</button>
              <button class="btn btn--sm btn--danger ml-1" onclick="deleteAdminDish(${dish.rowIndex})">Delete</button>
            </td>
          </tr>
        `;
      });
    }
  } catch(e) {
    toast('Failed to load dishes', 'error');
  }
}

async function addAdminDish() {
  const catIndex = document.getElementById('adminDishCategorySelect').value;
  const name = document.getElementById('adminDishName').value.trim();
  const amount = parseInt(document.getElementById('adminDishAmount').value, 10);
  
  if (!catIndex) return toast('Select a category first', 'error');
  if (!name || isNaN(amount)) return toast('Enter valid name and price', 'error');
  
  try {
    await api({ action: 'addDish', parentIndex: catIndex, dishName: name, amount });
    document.getElementById('adminDishName').value = '';
    document.getElementById('adminDishAmount').value = '';
    toast('Dish added', 'success');
    loadAdminDishes();
  } catch(e) {
    toast('Failed to add dish', 'error');
  }
}

function editAdminDish(rowIndex, name, amount) {
  document.getElementById('editDishRowIndex').value = rowIndex;
  document.getElementById('editDishName').value = name;
  document.getElementById('editDishPrice').value = amount;
  document.getElementById('modalEditDish').classList.add('open');
}

function closeEditDishModal() {
  document.getElementById('modalEditDish').classList.remove('open');
}

async function saveAdminDishEdit() {
  const rowIndex = document.getElementById('editDishRowIndex').value;
  const name = document.getElementById('editDishName').value.trim();
  const priceInput = document.getElementById('editDishPrice').value;
  const price = parseInt(priceInput, 10);
  
  if (!name || isNaN(price) || price < 0) {
    return toast('Please enter a valid name and price.', 'error');
  }
  
  const modal = document.getElementById('modalEditDish');
  const btn = modal.querySelector('.btn--primary');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving…';
  
  try {
    await api({ action: 'updateDish', rowIndex, newName: name, newAmount: price });
    toast('Dish updated successfully!', 'success');
    closeEditDishModal();
    loadAdminDishes();
  } catch (e) {
    toast('Failed to update dish: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Save Changes';
  }
}

async function deleteAdminDish(rowIndex) {
  if (!confirm('Are you sure you want to delete this dish?')) return;
  try {
    await api({ action: 'deleteDish', rowIndex });
    toast('Dish deleted', 'success');
    loadAdminDishes();
  } catch(e) {
    toast('Failed to delete dish', 'error');
  }
}

// ══════════════════════════════════════
//  ADMIN FLAVOUR CRUD
// ══════════════════════════════════════

async function loadAdminFlavourDishes() {
  const catIndex = document.getElementById('adminFlavourCategorySelect').value;
  const select = document.getElementById('adminFlavourDishSelect');
  const tbody = document.getElementById('adminFlavoursTable');
  tbody.innerHTML = ''; // Clear flavours table
  
  if (!catIndex) {
    select.innerHTML = '<option value="">-- Select Category First --</option>';
    return;
  }
  
  select.innerHTML = '<option value="">-- Loading Dishes --</option>';
  try {
    const res = await api({ action: 'getDishes', parentIndex: catIndex });
    select.innerHTML = '<option value="">-- Select Dish --</option>';
    if (res.dishes && res.dishes.length > 0) {
      res.dishes.forEach(dish => {
        select.innerHTML += `<option value="${dish.dishIndex}">${dish.name}</option>`;
      });
    } else {
      select.innerHTML = '<option value="">-- No Dishes in Category --</option>';
    }
  } catch(e) {
    select.innerHTML = '<option value="">-- Error Loading --</option>';
  }
}

async function loadAdminFlavours() {
  const dishIndex = document.getElementById('adminFlavourDishSelect').value;
  const tbody = document.getElementById('adminFlavoursTable');
  tbody.innerHTML = '';
  if (!dishIndex) return;
  
  try {
    const res = await api({ action: 'getFlavours', dishIndex });
    if (res.flavours) {
      res.flavours.forEach(f => {
        tbody.innerHTML += `
          <tr>
            <td>${f.name}</td>
            <td>
              <button class="btn btn--sm btn--secondary" onclick="editAdminFlavour(${f.rowIndex}, '${f.name}')">Edit</button>
              <button class="btn btn--sm btn--danger ml-1" onclick="deleteAdminFlavour(${f.rowIndex})">Delete</button>
            </td>
          </tr>
        `;
      });
    }
  } catch(e) {
    toast('Failed to load flavours', 'error');
  }
}

async function addAdminFlavour() {
  const dishIndex = document.getElementById('adminFlavourDishSelect').value;
  const name = document.getElementById('adminFlavourName').value.trim();
  
  if (!dishIndex) return toast('Select a dish first', 'error');
  if (!name) return toast('Enter flavour name', 'error');
  
  try {
    await api({ action: 'addFlavour', dishIndex, flavourName: name });
    document.getElementById('adminFlavourName').value = '';
    toast('Flavour added', 'success');
    loadAdminFlavours();
  } catch(e) {
    toast('Failed to add flavour', 'error');
  }
}

async function editAdminFlavour(rowIndex, oldName) {
  const newName = prompt('Enter new flavour name:', oldName);
  if (!newName || newName.trim() === oldName) return;
  
  try {
    await api({ action: 'updateFlavour', rowIndex, newName: newName.trim() });
    toast('Flavour updated', 'success');
    loadAdminFlavours();
  } catch(e) {
    toast('Failed to update flavour', 'error');
  }
}

async function deleteAdminFlavour(rowIndex) {
  if (!confirm('Are you sure you want to delete this flavour?')) return;
  try {
    await api({ action: 'deleteFlavour', rowIndex });
    toast('Flavour deleted', 'success');
    loadAdminFlavours();
  } catch(e) {
    toast('Failed to delete flavour', 'error');
  }
}

async function loadBestSellers() {
  const dateInput = document.getElementById('bestSellersDateFilter');
  if (!dateInput) return;
  
  if (!dateInput.value) {
    dateInput.value = istDateStr();
  }
  
  const targetDate = dateInput.value;
  
  const dailyBody = document.getElementById('dailyBestSellersBody');
  const overallBody = document.getElementById('overallBestSellersBody');
  
  if (dailyBody) dailyBody.innerHTML = '<tr><td colspan="4" style="text-align:center;"><span class="spinner" style="border-top-color:var(--brand-primary)"></span> Loading...</td></tr>';
  if (overallBody) overallBody.innerHTML = '<tr><td colspan="4" style="text-align:center;"><span class="spinner" style="border-top-color:var(--brand-primary)"></span> Loading...</td></tr>';
  
  try {
    const dailyMap = {};
    const overallMap = {};

    ALL_ENTRIES_CACHE.forEach(entry => {
      if (!entry.orderItems) return;
      try {
        const items = JSON.parse(entry.orderItems);
        items.forEach(item => {
          if (!item.qty || item.qty <= 0) return;
          const key = item.categoryName + '|||' + item.dishName + '|||' + (item.flavourName || '');
          
          if (!overallMap[key]) {
            overallMap[key] = { category: item.categoryName, dishName: item.dishName, flavour: item.flavourName, qty: 0 };
          }
          overallMap[key].qty += item.qty;

          if (entry.date === targetDate) {
            if (!dailyMap[key]) {
              dailyMap[key] = { category: item.categoryName, dishName: item.dishName, flavour: item.flavourName, qty: 0 };
            }
            dailyMap[key].qty += item.qty;
          }
        });
      } catch (e) {
        // Skip malformed orderItems
      }
    });

    const dailyArr = Object.values(dailyMap).sort((a, b) => b.qty - a.qty).slice(0, 5);
    const overallArr = Object.values(overallMap).sort((a, b) => b.qty - a.qty).slice(0, 5);
    const data = { daily: dailyArr, overall: overallArr };
    if (dailyBody) {
      dailyBody.innerHTML = '';
      if (data.daily && data.daily.length > 0) {
        data.daily.forEach(item => {
          dailyBody.innerHTML += `
            <tr>
              <td>${item.category}</td>
              <td style="font-weight: 600;">${item.dishName}</td>
              <td>${item.flavour || '—'}</td>
              <td style="text-align: center; font-weight: 700; color: var(--brand-primary);">${item.qty}</td>
            </tr>
          `;
        });
      } else {
        dailyBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No sales recorded for this day.</td></tr>';
      }
    }
    
    if (overallBody) {
      overallBody.innerHTML = '';
      if (data.overall && data.overall.length > 0) {
        data.overall.forEach(item => {
          overallBody.innerHTML += `
            <tr>
              <td>${item.category}</td>
              <td style="font-weight: 600;">${item.dishName}</td>
              <td>${item.flavour || '—'}</td>
              <td style="text-align: center; font-weight: 700; color: var(--brand-primary);">${item.qty}</td>
            </tr>
          `;
        });
      } else {
        overallBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No sales recorded.</td></tr>';
      }
    }
  } catch (e) {
    console.error('Failed to load best selling dishes', e);
    if (dailyBody) dailyBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--danger);">Error loading data.</td></tr>';
    if (overallBody) overallBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--danger);">Error loading data.</td></tr>';
  }
}
async function loadDashboardData() {
  const container = document.getElementById('statsGrid');
  if (container) {
    container.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 2rem;"><span class="spinner" style="border-top-color:var(--brand-primary)"></span> Loading dashboard analytics...</div>';
  }
  try {
    ADMIN_DATA = await api({ action: 'getAdminData' });
    
    // Override Today's totals dynamically to keep Dashboard completely real-time
    const today = istDateStr();
    let todayCount = 0;
    let todayAmount = 0;
    ALL_ENTRIES_CACHE.forEach(e => {
      if (e.date === today) {
        todayCount += 1;
        todayAmount += (e.amount || 0);
      }
    });
    ADMIN_DATA.todayCount = todayCount;
    ADMIN_DATA.todayAmount = todayAmount;
    
    // Also override total Amount overall
    let totalAmt = 0;
    ALL_ENTRIES_CACHE.forEach(e => totalAmt += (e.amount || 0));
    const totalLength = ALL_ENTRIES_CACHE.length;
    ADMIN_DATA.avgBilling = totalLength > 0 ? Math.round(totalAmt / totalLength) : 0;
    
    // Update overall totals
    ADMIN_DATA.totalVisits = Math.max(ADMIN_DATA.totalVisits, totalLength);

    renderAdminDashboard(ADMIN_DATA);
    loadBestSellers();
    calculateMdHeatmap();
    calculateHeatmap();
    calculateTimeBetweenVisits();
  } catch (e) {
    console.error('Failed to load dashboard data', e);
    if (container) {
      container.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--danger); padding: 2rem;">Error loading dashboard data.</div>';
    }
  }
}

async function loadAdminPOSConfig() {
  loadAdminCategories();
  
  const selectFlavourDish = document.getElementById('adminFlavourDishSelect');
  if (selectFlavourDish) {
    selectFlavourDish.innerHTML = '<option value="">-- Select Category First --</option>';
  }
  
  try {
    const res = await api({ action: 'getTableCount' });
    const input = document.getElementById('adminTableCount');
    if (input) input.value = res.count || '';
    POS_STATE.tableCount = res.count || 0;
  } catch(e) {
    console.error('Failed to load table count in POS configuration', e);
  }
}
