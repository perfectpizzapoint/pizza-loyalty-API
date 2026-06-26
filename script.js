/* ═══════════════════════════════════════════
   Perfect Pizza Point – Loyalty System
   Single JS file (Entry + Admin logic)
   ═══════════════════════════════════════════ */

// ──── CONFIGURATION ────
// ⚠️  PASTE YOUR DEPLOYED APPS SCRIPT WEB APP URL HERE:
const API_URL = 'https://script.google.com/macros/s/AKfycby2RXrQOKkXQ3dgWRz_hCJMl9Fi9ZFxjm_hD6vuwCdh6KHPbRxCXfMsmKeK6JE1LunG-Q/exec';

// Runtime cache
let APP_CONFIG = null;       // { minAmount, cycle, rewardValue }
let CURRENT_CUSTOMER = null; // customer data from reward
let LAST_ENTRY_RESULT = null;
let ADMIN_DATA = null;
let ADMIN_AUTHENTICATED = false;
let ALL_ENTRIES_CACHE = [];
let DASHBOARD_PERIOD = '7d'; // 'today' | '7d' | '30d' | 'all'
let visibleEntriesLimit = 30;

// ──── POS THEME COLOR PRESETS ────
const THEME_PRESETS = [
  {
    id: 'sunset-tomato',
    name: 'Sunset Tomato',
    primary: '#FF4B2B',
    gradient: 'linear-gradient(135deg, #FF416C, #FF4B2B)',
    gradientHover: 'linear-gradient(135deg, #FF4B2B, #FF416C)',
    glow: 'rgba(255, 75, 43, 0.4)'
  },
  {
    id: 'golden-honey',
    name: 'Golden Honey',
    primary: '#faa307',
    gradient: 'linear-gradient(135deg, #f48c06, #faa307)',
    gradientHover: 'linear-gradient(135deg, #faa307, #f48c06)',
    glow: 'rgba(250, 163, 7, 0.4)'
  },
  {
    id: 'fresh-basil',
    name: 'Fresh Basil',
    primary: '#10B981',
    gradient: 'linear-gradient(135deg, #059669, #10B981)',
    gradientHover: 'linear-gradient(135deg, #10B981, #059669)',
    glow: 'rgba(16, 185, 129, 0.4)'
  },
  {
    id: 'tuscan-plum',
    name: 'Tuscan Plum',
    primary: '#8B5CF6',
    gradient: 'linear-gradient(135deg, #7C3AED, #8B5CF6)',
    gradientHover: 'linear-gradient(135deg, #8B5CF6, #7C3AED)',
    glow: 'rgba(139, 92, 246, 0.4)'
  },
  {
    id: 'mediterranean-blue',
    name: 'Mediterranean',
    primary: '#3B82F6',
    gradient: 'linear-gradient(135deg, #2563EB, #3B82F6)',
    gradientHover: 'linear-gradient(135deg, #3B82F6, #2563EB)',
    glow: 'rgba(59, 130, 246, 0.4)'
  }
];

function applyTheme(themeId) {
  const theme = THEME_PRESETS.find(t => t.id === themeId) || THEME_PRESETS[0];
  const root = document.documentElement;
  
  root.style.setProperty('--brand-primary', theme.primary);
  root.style.setProperty('--brand-gradient', theme.gradient);
  root.style.setProperty('--brand-gradient-hover', theme.gradientHover);
  root.style.setProperty('--brand-glow', theme.glow);
  
  localStorage.setItem('ppp_pos_theme_id', theme.id);
  updateAdminThemeUI(theme.id);
}

function renderAdminThemePresets() {
  const grid = document.getElementById('adminThemeOptionsGrid');
  if (!grid) return;
  
  grid.innerHTML = '';
  const currentThemeId = localStorage.getItem('ppp_pos_theme_id') || 'sunset-tomato';
  
  THEME_PRESETS.forEach(theme => {
    const card = document.createElement('div');
    card.className = 'theme-option-card' + (theme.id === currentThemeId ? ' active' : '');
    card.dataset.themeId = theme.id;
    card.onclick = () => applyTheme(theme.id);
    
    card.innerHTML = `
      <div class="theme-preview-dot" style="background: ${theme.gradient};"></div>
      <div class="theme-option-name">${theme.name}</div>
    `;
    grid.appendChild(card);
  });
}

function updateAdminThemeUI(activeThemeId) {
  const cards = document.querySelectorAll('.theme-option-card');
  cards.forEach(card => {
    if (card.dataset.themeId === activeThemeId) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });
}

// Initialize theme preset immediately before rendering starts
(function initPOSTheme() {
  const savedThemeId = localStorage.getItem('ppp_pos_theme_id') || 'sunset-tomato';
  const theme = THEME_PRESETS.find(t => t.id === savedThemeId) || THEME_PRESETS[0];
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', theme.primary);
  root.style.setProperty('--brand-gradient', theme.gradient);
  root.style.setProperty('--brand-gradient-hover', theme.gradientHover);
  root.style.setProperty('--brand-glow', theme.glow);
})();

async function saveAdminCreds() {
  const user = document.getElementById('newAdminUser').value.trim();
  const pass = document.getElementById('newAdminPass').value.trim();
  const confirmPass = document.getElementById('confirmAdminPass').value.trim();
  
  if (!user || !pass) {
    toast('Username and password cannot be empty.', 'error');
    return;
  }
  if (pass !== confirmPass) {
    toast('Passwords do not match.', 'error');
    return;
  }
  
  const btn = document.getElementById('btnUpdateAdminCreds');
  const originalText = btn.innerText;
  btn.innerText = 'Saving...';
  btn.disabled = true;
  
  try {
    const res = await apiDirect({ action: 'updateAdminCreds', username: user, password: pass });
    if (res.success) {
      toast('Admin credentials updated successfully!', 'success');
      document.getElementById('newAdminUser').value = '';
      document.getElementById('newAdminPass').value = '';
      document.getElementById('confirmAdminPass').value = '';
      
      // Force update config cache
      if (APP_CONFIG) {
        APP_CONFIG.username = user;
        APP_CONFIG.password = pass;
      }
    } else {
      toast(res.error || 'Failed to update credentials.', 'error');
    }
  } catch (e) {
    console.error('Credentials update failed', e);
    toast('Error updating credentials: ' + e.message, 'error');
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

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

/** Load cached data into memory variables on startup */
function initializeMemoryFromCache() {
  APP_CONFIG = getCacheItem('getConfig');
  ALL_ENTRIES_CACHE = getCacheItem('getAllEntries') || [];
  ADMIN_DATA = getCacheItem('getAdminData');
}
initializeMemoryFromCache();

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

    if (document.getElementById('sectionDashboard') && document.getElementById('sectionDashboard').classList.contains('active')) {
      renderAllDashboardComponents();
    }

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
  if (btnSync) {
    const shouldShow = sectionName !== 'admin';
    btnSync.style.display = shouldShow ? '' : 'none';
  }
  
  // Hide integration dock when in admin section to prevent overlap with tables
  const dock = document.getElementById('integrationDock');
  if (dock) {
    const shouldShow = sectionName !== 'admin';
    dock.style.display = shouldShow ? '' : 'none';
  }
}

/** Check if the remaining width requires icon-only bottom navigation */
function updateNavDockResponsive() {
  const body = document.body;
  const isSplitActive = body.classList.contains('split-active');
  const splitWidth = isSplitActive ? (parseFloat(body.style.getPropertyValue('--split-width')) || 0) : 0;
  const remainingWidth = window.innerWidth - splitWidth;
  
  const dock = document.getElementById('navDock');
  if (dock) {
    if (remainingWidth < 550) {
      dock.classList.add('nav-icon-only');
    } else {
      dock.classList.remove('nav-icon-only');
    }
  }

  // Handle narrow split view to overlay modals full-screen
  if (isSplitActive && remainingWidth < 500) {
    body.classList.add('split-overlay-full');
  } else {
    body.classList.remove('split-overlay-full');
  }
  
  // Re-position active page indicator line after button widths adjust
  setTimeout(() => {
    updateNavIndicator(document.querySelector('.nav-btn.active'));
  }, 50);
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

      let cellClasses = ['heatmap-cell'];
      if (d < 4) cellClasses.push('edge-left');
      if (d > 26) cellClasses.push('edge-right');
      if (m < 2) cellClasses.push('edge-top');
      const classAttr = cellClasses.join(' ');

      html += '<div class="' + classAttr + '" style="background:' + bg + '; cursor: pointer;" onclick="selectHeatmapDate(' + m + ', ' + d + ')">' +
        '<div class="heatmap-tooltip">' + months[m] + ' ' + (d + 1) + ' — ' + displayVal + '</div>' +
        '</div>';
    }
  }
  html += '</div>';
  container.innerHTML = html;
}

function selectHeatmapDate(monthIndex, dayIndex) {
  let year = new Date().getFullYear();
  if (ALL_ENTRIES_CACHE && ALL_ENTRIES_CACHE.length > 0) {
    const matchedEntry = ALL_ENTRIES_CACHE.find(e => {
      if (!e.date) return false;
      const parts = e.date.split('-');
      return parts.length === 3 && (parseInt(parts[1], 10) - 1) === monthIndex && (parseInt(parts[2], 10) - 1) === dayIndex;
    });
    if (matchedEntry) {
      year = parseInt(matchedEntry.date.split('-')[0], 10);
    } else {
      const latestDate = ALL_ENTRIES_CACHE[0].date;
      if (latestDate && latestDate.includes('-')) {
        year = parseInt(latestDate.split('-')[0], 10);
      }
    }
  }

  const mm = String(monthIndex + 1).padStart(2, '0');
  const dd = String(dayIndex + 1).padStart(2, '0');
  const dateStr = `${year}-${mm}-${dd}`;

  const dateInput = document.getElementById('bestSellersDateFilter');
  if (dateInput) {
    dateInput.value = dateStr;
    loadBestSellers();
    
    // Smooth scroll to the Best Sellers card
    const bestSellersCard = dateInput.closest('.card');
    if (bestSellersCard) {
      bestSellersCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    toast(`Filtered Today's Top 5 for ${monthNames[monthIndex]} ${dayIndex + 1}, ${year}`, 'success');
  }
}

// ──── HARDCODED WHATSAPP TEMPLATE (removes admin dependency) ────
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
  // Initialize POS data on startup since POS is the default page
  initPos();

  setTimeout(() => {
    updateNavIndicator(document.querySelector('.nav-btn.active'));
    updateNavDockResponsive();
  }, 100);
  window.addEventListener('resize', () => {
    updateNavIndicator(document.querySelector('.nav-btn.active'));
    updateNavDockResponsive();
  });

  // Restore saved loyalty state on page load/reload
  restoreLoyaltyState();
  
  // Initialize third-party integration dock
  fetchIntegrationLinks();
  initResizer();
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

  if (!mobile) {
    checkAmountAndToggleButtons();
    return;
  }

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

function handleWithoutMobileEntry() {
  const mobileInput = document.getElementById('inputMobile');
  if (mobileInput) {
    mobileInput.value = '';
    localStorage.setItem('ppp_loyalty_mobile', '');
  }
  
  CURRENT_CUSTOMER = {
    found: false, mobile: '',
    totalEntries: 0, rewardsClaimed: 0,
    eligible: false, lastVisitDate: ''
  };
  openEntryForm('', CURRENT_CUSTOMER);
}

async function handleDispMobileInput() {
  const dispInput = document.getElementById('dispMobile');
  dispInput.value = dispInput.value.replace(/\D/g, '');
  const mobile = dispInput.value.trim();
  
  localStorage.setItem('ppp_loyalty_mobile', mobile);
  
  if (mobile === '') {
    CURRENT_CUSTOMER = {
      found: false, mobile: '',
      totalEntries: 0, rewardsClaimed: 0,
      eligible: false, lastVisitDate: ''
    };
    hide('rowDetailsBtn');
    checkAmountAndToggleButtons();
    return;
  }
  
  if (!/^\d{10}$/.test(mobile)) {
    CURRENT_CUSTOMER = {
      found: false, mobile,
      totalEntries: 0, rewardsClaimed: 0,
      eligible: false, lastVisitDate: ''
    };
    hide('rowDetailsBtn');
    checkAmountAndToggleButtons();
    return;
  }
  
  try {
    CURRENT_CUSTOMER = {
      found: false, mobile,
      totalEntries: 0, rewardsClaimed: 0,
      eligible: false, lastVisitDate: ''
    };
    checkAmountAndToggleButtons();
    
    const cust = await api({ action: 'getCustomer', mobile });
    if (document.getElementById('dispMobile').value.trim() !== mobile) {
      return; 
    }
    
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
      } else {
        hide('rowDetailsBtn');
      }
    }
    
    checkAmountAndToggleButtons();
  } catch (e) {
    console.error('Disp mobile duplicate check failed', e);
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

  // If mobile is blank or the default "no mobile" number, always show only the Receipt button
  const dispMobile = document.getElementById('dispMobile');
  const mobile = dispMobile ? dispMobile.value.trim() : '';
  if (!mobile) {
    btnSave.style.display = 'none';
    btnReceipt.style.display = '';
    btnClaim.style.display = 'none';
    if (!isNaN(amount) && amount > 0) {
      hideErr('errAmount');
      amountInput.classList.remove('error');
    }
    return;
  }

  // If mobile is entered but not 10 digits, hide save/receipt/claim buttons to block invalid data
  if (mobile && !/^\d{10}$/.test(mobile)) {
    btnSave.style.display = 'none';
    btnReceipt.style.display = 'none';
    btnClaim.style.display = 'none';
    return;
  }

  // If reward system is OFF, always show only the Receipt button
  const rewardOn = APP_CONFIG ? APP_CONFIG.rewardSystemOn !== false : true;
  if (!rewardOn) {
    btnSave.style.display = 'none';
    btnReceipt.style.display = '';
    btnClaim.style.display = 'none';
    if (!isNaN(amount) && amount > 0) {
      hideErr('errAmount');
      amountInput.classList.remove('error');
    }
    return;
  }

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
  const mobile = document.getElementById('dispMobile').value.trim();
  if (mobile && !/^\d{10}$/.test(mobile)) {
    toast('Please enter a valid 10-digit mobile number or leave it empty.', 'error');
    return;
  }
  const amount = parseInt(document.getElementById('inputAmount').value, 10);
  const date   = document.getElementById('dispDate').value;
  const time   = istTimeStr(); // refresh time
  const message = document.getElementById('inputMessage').value.trim();
  const rewardOn = APP_CONFIG ? APP_CONFIG.rewardSystemOn !== false : true;
  const minAmt = APP_CONFIG ? APP_CONFIG.minAmount : 100;

  hideErr('errAmount');
  // When reward system is OFF, skip minimum amount validation (just need amount > 0)
  if (rewardOn) {
    if (isNaN(amount) || amount < minAmt) {
      showErr('errAmount');
      document.getElementById('inputAmount').classList.add('error');
      return;
    }
  } else {
    if (isNaN(amount) || amount <= 0) {
      showErr('errAmount');
      document.getElementById('inputAmount').classList.add('error');
      return;
    }
  }
  document.getElementById('inputAmount').classList.remove('error');

  const btn = document.getElementById('btnSaveEntry');

  // ── Instant UI update — no waiting for the server ──
  btn.disabled = true;
  btn.innerHTML = '✔ Saved';

  const orderItems = localStorage.getItem('ppp_pendingOrderItems') || '';
  const payAmts = getPaymentAmounts(amount);

  if (!mobile) {
    // Skip optimistic loyalty UI logic, just toast success
    toast('✅ Bill generated successfully!', 'success');
    
    // Clear persistent entry data from localStorage since it is saved
    localStorage.removeItem('ppp_loyalty_form_open');
    localStorage.removeItem('ppp_loyalty_mobile');
    localStorage.removeItem('ppp_loyalty_amount');
    localStorage.removeItem('ppp_loyalty_message');
    localStorage.removeItem('ppp_pendingOrderItems');

    // Optimistically update cache
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
      source: 'bill'
    };
    ALL_ENTRIES_CACHE.unshift(newCacheEntry);
    setCacheItem('getAllEntries', ALL_ENTRIES_CACHE);
    
    if (document.getElementById('sectionDashboard') && document.getElementById('sectionDashboard').classList.contains('active')) {
      prependActivityRow(newCacheEntry);
      setTimeout(() => {
        loadDashboardData();
      }, 1000);
    }
    
    try {
      const result = await api({ action: 'addbillEntry', mobile, amount, date, time, message, cashAmt: payAmts.cashAmt, upiAmt: payAmts.upiAmt, cardAmt: payAmts.cardAmt, orderItems });
      if (result.error) {
        toast(result.error, 'error');
        btn.disabled = false;
        btn.innerHTML = '💾 Save Entry';
        return;
      }
      
      // Dynamic sync
      if (typeof downloadSheetCache === 'function') {
        downloadSheetCache(true);
      }
      
      // Wait 2 seconds, then return to home screen
      setTimeout(() => {
        closeEntryForm();
      }, 2000);
    } catch (e) {
      console.error('Save bill failed', e);
      toast('Error saving bill', 'error');
      btn.disabled = false;
      btn.innerHTML = '💾 Save Entry';
    }
    return;
  }

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
  
  localStorage.removeItem('ppp_pendingOrderItems');

  // ── Background: persist to Google Sheets (original flow) ──
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
      source: 'entry'
    };
    ALL_ENTRIES_CACHE.unshift(newCacheEntry);
    setCacheItem('getAllEntries', ALL_ENTRIES_CACHE);
    
    // Refresh currently open sections if needed
    if (document.getElementById('sectionDashboard').classList.contains('active')) {
      prependActivityRow(newCacheEntry);
      setTimeout(() => {
        loadDashboardData();
      }, 1000);
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
  const mobile = document.getElementById('dispMobile').value.trim();
  if (mobile && !/^\d{10}$/.test(mobile)) {
    toast('Please enter a valid 10-digit mobile number or leave it empty.', 'error');
    return;
  }
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

  if (!mobile) {
    toast('✅ Bill generated successfully!', 'success');
    
    localStorage.removeItem('ppp_loyalty_form_open');
    localStorage.removeItem('ppp_loyalty_mobile');
    localStorage.removeItem('ppp_loyalty_amount');
    localStorage.removeItem('ppp_loyalty_message');
    localStorage.removeItem('ppp_pendingOrderItems');
    
    // Optimistically update cache
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
      source: 'bill'
    };
    ALL_ENTRIES_CACHE.unshift(newCacheEntry);
    setCacheItem('getAllEntries', ALL_ENTRIES_CACHE);
    
    if (document.getElementById('sectionDashboard') && document.getElementById('sectionDashboard').classList.contains('active')) {
      prependActivityRow(newCacheEntry);
      setTimeout(() => {
        loadDashboardData();
      }, 1000);
    }
    
    try {
      await api({
        action: 'addbillEntry',
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
      
      if (typeof downloadSheetCache === 'function') {
        downloadSheetCache(true);
      }
      
      setTimeout(() => {
        closeEntryForm();
        btn.disabled = false;
        btn.innerHTML = '🧾 Generate Receipt Only';
      }, 2000);
    } catch (e) {
      console.error('Failed to save receipt to bill', e);
      toast('Error saving bill', 'error');
      btn.disabled = false;
      btn.innerHTML = '🧾 Generate Receipt Only';
    }
    return;
  }

  try {
    // Save uncounted/receipt-only entry to bill in the background
    await api({
      action: 'addbillEntry',
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
      source: 'bill'
    };
    ALL_ENTRIES_CACHE.unshift(newCacheEntry);
    setCacheItem('getAllEntries', ALL_ENTRIES_CACHE);
    
    // Refresh currently open sections if needed
    if (document.getElementById('sectionDashboard').classList.contains('active')) {
      prependActivityRow(newCacheEntry);
      setTimeout(() => {
        loadDashboardData();
      }, 1000);
    } else if (document.getElementById('sectionAllEntries') && document.getElementById('sectionAllEntries').classList.contains('active')) {
      loadAllEntries();
    }
    
    // Background sync to ensure full parity
    downloadSheetCache(true);
    
  } catch (e) {
    console.error('Failed to save receipt to bill', e);
    toast('⚠️ WhatsApp receipt generated, but database sync failed.', 'warning');
  }

  btn.disabled = false;
  btn.innerHTML = '🧾 Generate Receipt Only';

  // Build the WhatsApp link using the current customer's data, without adding a loyalty entry
  buildWhatsAppLink(CURRENT_CUSTOMER, mobile, amount, message, false);
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
    resetEntriesFilters(); // Reset controls and trigger rendering
  } catch (e) {
    console.error('Failed to load all entries', e);
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--danger);">Error loading entries. Please try again.</td></tr>';
    if (mobileList) {
      mobileList.innerHTML = '<div style="text-align:center;color:var(--danger);padding:2rem;">Error loading entries. Please try again.</div>';
    }
  }
}

function renderAllEntriesTable(entries) {
  const tbody = document.getElementById('allEntriesTableBody');
  const mobileList = document.getElementById('allEntriesMobileList');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (mobileList) mobileList.innerHTML = '';

  // Calculate and display mini stats for the current view
  updateEntriesStats(entries);

  // Handle Load More button visibility
  const loadMoreContainer = document.getElementById('entriesLoadMoreContainer');
  if (loadMoreContainer) {
    if (entries && entries.length > visibleEntriesLimit) {
      loadMoreContainer.style.display = 'block';
    } else {
      loadMoreContainer.style.display = 'none';
    }
  }

  const slicedEntries = (entries || []).slice(0, visibleEntriesLimit);

  if (slicedEntries && slicedEntries.length > 0) {
    slicedEntries.forEach((e) => {
      // Find the absolute index in the global entries cache for showEntryDetails
      const absoluteIdx = ALL_ENTRIES_CACHE.indexOf(e);

      // Format payment modes string (with custom green/indigo/orange pills)
      const modes = [];
      if (e.cash > 0) modes.push(`<span class="pm-pill pm-cash">Cash: ₹${e.cash}</span>`);
      if (e.upi > 0) modes.push(`<span class="pm-pill pm-upi">UPI: ₹${e.upi}</span>`);
      if (e.card > 0) modes.push(`<span class="pm-pill pm-card">Card: ₹${e.card}</span>`);
      
      let modesHtml = modes.join('');
      if (!modesHtml) {
        modesHtml = `<span class="pm-pill pm-cash">Cash: ₹${e.amount}</span>`;
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
        <td style="font-weight: 700; color: var(--text-primary);">📱 +91 ${e.mobile}</td>
        <td>${e.date}</td>
        <td>${e.time}</td>
        <td style="font-weight: 800; color: var(--brand-primary); font-size: 0.95rem;">₹${e.amount}</td>
        <td><div style="display: flex; flex-wrap: wrap; gap: 4px;">${modesHtml}</div></td>
        <td>${itemsHtml}</td>
        <td style="text-align: center; font-weight: 600; color: var(--text-secondary);">Visit #${visitNum}</td>
      `;
      tbody.appendChild(tr);

      // Mobile list rendering showing mobile number, amount, and details 'i' button in one horizontal line
      if (mobileList) {
        const card = document.createElement('div');
        card.className = 'mobile-entry-card fade-in';
        card.innerHTML = `
          <div class="mobile-entry-card__phone" style="font-size: 0.95rem; display: flex; align-items: center; gap: 6px;">📱 +91 ${e.mobile}</div>
          <div class="mobile-entry-card__amount" style="flex: 1; text-align: right; margin-right: 0.25rem; font-size: 1.1rem; font-weight: 800; color: var(--brand-primary);">₹${e.amount}</div>
          <button class="btn btn--outline" onclick="showEntryDetails(${absoluteIdx})" style="width: 32px; height: 32px; border-radius: 50%; padding: 0; min-width: 32px; display: inline-flex; align-items: center; justify-content: center; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 0.95rem; border-color: var(--brand-primary); color: var(--brand-primary); transition: all 0.2s; background: transparent;" title="View Details">i</button>
        `;
        mobileList.appendChild(card);
      }
    });
  } else {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem;">No entries found matching filters.</td></tr>';
    if (mobileList) {
      mobileList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:2rem;">No entries found matching filters.</div>';
    }
  }
}

function updateEntriesStats(entries) {
  const totalSalesEl = document.getElementById('entriesTotalSales');
  const totalCountEl = document.getElementById('entriesTotalCount');
  const avgValueEl = document.getElementById('entriesAvgValue');
  const paymentBreakdownEl = document.getElementById('entriesPaymentBreakdown');

  if (!entries || entries.length === 0) {
    if (totalSalesEl) totalSalesEl.textContent = '₹0';
    if (totalCountEl) totalCountEl.textContent = '0';
    if (avgValueEl) avgValueEl.textContent = '₹0';
    if (paymentBreakdownEl) paymentBreakdownEl.textContent = '₹0 / ₹0 / ₹0';
    return;
  }

  const count = entries.length;
  let totalSales = 0;
  let cashTotal = 0;
  let upiTotal = 0;
  let cardTotal = 0;

  entries.forEach(e => {
    totalSales += e.amount || 0;
    cashTotal += e.cash > 0 ? e.cash : (e.upi === 0 && e.card === 0 ? e.amount : 0);
    upiTotal += e.upi || 0;
    cardTotal += e.card || 0;
  });

  const avg = Math.round(totalSales / count);

  if (totalSalesEl) totalSalesEl.textContent = `₹${totalSales.toLocaleString('en-IN')}`;
  if (totalCountEl) totalCountEl.textContent = count.toLocaleString('en-IN');
  if (avgValueEl) avgValueEl.textContent = `₹${avg.toLocaleString('en-IN')}`;
  if (paymentBreakdownEl) {
    paymentBreakdownEl.innerHTML = `
      <span style="color: #10b981;">₹${(cashTotal/1000).toFixed(1)}k</span> / 
      <span style="color: #6366f1;">₹${(upiTotal/1000).toFixed(1)}k</span> / 
      <span style="color: #ff4b2b;">₹${(cardTotal/1000).toFixed(1)}k</span>
    `;
  }
}

function filterEntries(resetLimit = true) {
  if (resetLimit) {
    visibleEntriesLimit = 30;
  }
  const searchVal = document.getElementById('entriesSearchInput').value.trim();
  const dateVal = document.getElementById('entriesDateFilter').value;
  const paymentVal = document.getElementById('entriesPaymentFilter').value;

  let filtered = ALL_ENTRIES_CACHE || [];

  // 1. Search by mobile number
  if (searchVal) {
    filtered = filtered.filter(e => e.mobile && e.mobile.includes(searchVal));
  }

  // 2. Filter by date
  if (dateVal) {
    filtered = filtered.filter(e => e.date === dateVal);
  }

  // 3. Filter by payment mode
  if (paymentVal && paymentVal !== 'all') {
    filtered = filtered.filter(e => {
      if (paymentVal === 'cash') return e.cash > 0;
      if (paymentVal === 'upi') return e.upi > 0;
      if (paymentVal === 'card') return e.card > 0;
      return true;
    });
  }

  renderAllEntriesTable(filtered);
}

function resetEntriesFilters() {
  const searchInput = document.getElementById('entriesSearchInput');
  const dateFilter = document.getElementById('entriesDateFilter');
  const paymentFilter = document.getElementById('entriesPaymentFilter');

  if (searchInput) searchInput.value = '';
  if (dateFilter) dateFilter.value = '';
  if (paymentFilter) paymentFilter.value = 'all';

  visibleEntriesLimit = 30;
  renderAllEntriesTable(ALL_ENTRIES_CACHE || []);
}

function loadMoreEntries() {
  visibleEntriesLimit += 50;
  filterEntries(false);
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
function buildWhatsAppLink(result, mobile, amount, message, isLoyaltyEntry = true) {
  let template = WHATSAPP_TEMPLATE;
  const cycle    = (result && result.cycle) || (APP_CONFIG ? APP_CONFIG.cycle : 10);
  const total    = (result && typeof result.totalEntries === 'number') ? result.totalEntries : 0;

  // cyclePosition
  const mod = total % cycle;
  const cyclePosition = total === 0 ? 0 : (mod === 0 ? cycle : mod);
  const completedVisit = cyclePosition + '/' + cycle;

  // loyalty link
  const loyaltyNum = total === 0 ? 0 : (mod === 0 ? cycle : cyclePosition);
  const loyaltyLink = 'https://perfectpizzapoint.github.io/' + loyaltyNum + '/';

  if (!isLoyaltyEntry) {
    template = template.replace('%F0%9F%93%8A%20Current%20visit%20count%20%3A%20<completedvisit>%0A', '');
    template = template.replace('%F0%9F%A4%9D%20Loyalty%20%3A%20<loyality>%0A', '');
  }

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
  
  const displayMobile = CURRENT_CUSTOMER.mobile && CURRENT_CUSTOMER.mobile.trim() !== ''
    ? '+91 ' + CURRENT_CUSTOMER.mobile
    : 'Walk-in / No Mobile';
  const profileEl = document.getElementById('profileMobileDisp');
  if (profileEl) profileEl.textContent = displayMobile;

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

function setDashboardPeriod(period, btn) {
  DASHBOARD_PERIOD = period;
  // Update active state on buttons
  document.querySelectorAll('#periodFilter .period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // Re-render everything
  renderAllDashboardComponents();
}

function renderAllDashboardComponents() {
  const entries = getFilteredEntries();
  
  try {
    renderKpiStrip(entries);
  } catch (e) {
    console.error('Error rendering KPI Strip:', e);
  }
  
  try {
    renderRevenueTrendChart(entries);
  } catch (e) {
    console.error('Error rendering Revenue Trend Chart:', e);
  }
  
  try {
    renderPaymentBreakdownChart(entries);
  } catch (e) {
    console.error('Error rendering Payment Breakdown Chart:', e);
  }
  
  try {
    renderPaymentDonut(entries);
  } catch (e) {
    console.error('Error rendering Payment Donut Chart:', e);
  }
  
  try {
    renderBestSellers(entries);
  } catch (e) {
    console.error('Error rendering Best Sellers:', e);
  }
  
  try {
    renderTodaySummaryCard();
  } catch (e) {
    console.error('Error rendering Today Summary Card:', e);
  }
  
  try {
    renderCustomerBase(entries);
  } catch (e) {
    console.error('Error rendering Customer Base Chart:', e);
  }
  
  try {
    renderTopLoyalists();
  } catch (e) {
    console.error('Error rendering Top Loyalists:', e);
  }
  
  try {
    renderRecentActivity();
  } catch (e) {
    console.error('Error rendering Recent Activity:', e);
  }
  
  try {
    calculateMdHeatmap();
  } catch (e) {
    console.error('Error rendering Month-Day Heatmap:', e);
  }
  
  try {
    calculateHeatmap();
  } catch (e) {
    console.error('Error rendering Peak Hours Map:', e);
  }
  
  try {
    calculateTimeBetweenVisits();
  } catch (e) {
    console.error('Error rendering Revisit Frequency Chart:', e);
  }
  
  try {
    updateLastSyncedLabel();
  } catch (e) {
    console.error('Error updating sync label:', e);
  }
}

function updateLastSyncedLabel() {
  const label = document.getElementById('lastSyncedLabel');
  if (!label) return;
  
  const ts = localStorage.getItem(CACHE_TIMESTAMP_KEY);
  if (!ts) {
    label.textContent = 'Last synced: Never';
    return;
  }
  
  const diffMs = Date.now() - Number(ts);
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) {
    label.textContent = 'Last synced: Just now';
  } else if (diffMins === 1) {
    label.textContent = 'Last synced: 1 min ago';
  } else if (diffMins < 60) {
    label.textContent = `Last synced: ${diffMins} mins ago`;
  } else {
    const diffHours = Math.floor(diffMins / 60);
    label.textContent = `Last synced: ${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  }
}

if (!window.lastSyncedInterval) {
  window.lastSyncedInterval = setInterval(() => {
    const section = document.getElementById('sectionDashboard');
    if (section && section.classList.contains('active')) {
      updateLastSyncedLabel();
    }
  }, 30000);
}

function getFilteredEntries() {
  const today = istDateStr();
  const now = new Date();
  
  switch (DASHBOARD_PERIOD) {
    case 'today':
      return ALL_ENTRIES_CACHE.filter(e => e.date === today);
    case '7d':
      const d7 = new Date(now);
      d7.setDate(d7.getDate() - 7);
      const d7Str = d7.toISOString().split('T')[0];
      return ALL_ENTRIES_CACHE.filter(e => e.date >= d7Str);
    case '30d':
      const d30 = new Date(now);
      d30.setDate(d30.getDate() - 30);
      const d30Str = d30.toISOString().split('T')[0];
      return ALL_ENTRIES_CACHE.filter(e => e.date >= d30Str);
    case 'all':
    default:
      return ALL_ENTRIES_CACHE;
  }
}

function getPriorPeriodEntries() {
  const today = istDateStr();
  const now = new Date();
  
  switch (DASHBOARD_PERIOD) {
    case 'today':
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      return ALL_ENTRIES_CACHE.filter(e => e.date === yesterdayStr);
    case '7d':
      const d7 = new Date(now);
      d7.setDate(d7.getDate() - 7);
      const d7Str = d7.toISOString().split('T')[0];
      const d14 = new Date(now);
      d14.setDate(d14.getDate() - 14);
      const d14Str = d14.toISOString().split('T')[0];
      return ALL_ENTRIES_CACHE.filter(e => e.date >= d14Str && e.date < d7Str);
    case '30d':
      const d30 = new Date(now);
      d30.setDate(d30.getDate() - 30);
      const d30Str = d30.toISOString().split('T')[0];
      const d60 = new Date(now);
      d60.setDate(d60.getDate() - 60);
      const d60Str = d60.toISOString().split('T')[0];
      return ALL_ENTRIES_CACHE.filter(e => e.date >= d60Str && e.date < d30Str);
    case 'all':
    default:
      return [];
  }
}

function computeKpiData(entries) {
  const today = istDateStr();
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  })();

  const todayEntries = ALL_ENTRIES_CACHE.filter(e => e.date === today);
  const yesterdayEntries = ALL_ENTRIES_CACHE.filter(e => e.date === yesterday);

  const todayRevenue = todayEntries.reduce((s, e) => s + (e.amount || 0), 0);
  const yesterdayRevenue = yesterdayEntries.reduce((s, e) => s + (e.amount || 0), 0);
  const todayRevenueΔ = yesterdayRevenue > 0
    ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100)
    : null;

  const periodRevenue = entries.reduce((s, e) => s + (e.amount || 0), 0);
  const periodCount = entries.length;
  const periodAvg = periodCount > 0 ? Math.round(periodRevenue / periodCount) : 0;

  // Prior period for delta
  const priorEntries = getPriorPeriodEntries();
  const priorRevenue = priorEntries.reduce((s, e) => s + (e.amount || 0), 0);
  const periodRevenueΔ = priorRevenue > 0
    ? Math.round(((periodRevenue - priorRevenue) / priorRevenue) * 100)
    : null;

  // Sparkline: last 7 days daily revenue
  const sparkData = getLast7DaysDailyRevenue();

  return {
    todayRevenue, todayRevenueΔ, todayCount: todayEntries.length,
    periodRevenue, periodRevenueΔ, periodCount, periodAvg,
    sparkData
  };
}

function getLast7DaysDailyRevenue() {
  const result = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const dayTotal = ALL_ENTRIES_CACHE
      .filter(e => e.date === dateStr)
      .reduce((s, e) => s + (e.amount || 0), 0);
    result.push(dayTotal);
  }
  return result;
}

function makeSparkline(dataArray, width = 80, height = 28) {
  if (!dataArray || dataArray.length < 2) return '';
  const max = Math.max(...dataArray);
  const min = Math.min(...dataArray);
  const range = max - min || 1;
  const step = width / (dataArray.length - 1);
  const points = dataArray.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="kpi-sparkline">
    <polyline points="${points}" fill="none" stroke="var(--sparkline-line)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function renderKpiStrip(entries) {
  const kpi = computeKpiData(entries);
  const totalCustomers = ADMIN_DATA ? ADMIN_DATA.totalCustomers : 0;
  const rewardsGiven = ADMIN_DATA ? ADMIN_DATA.rewardsGiven : 0;
  const conversionRate = ADMIN_DATA ? ADMIN_DATA.conversionRate : 0;

  const container = document.getElementById('kpiStrip');
  if (!container) return;

  const todayDeltaHtml = kpi.todayRevenueΔ !== null
    ? (kpi.todayRevenueΔ >= 0
        ? `<span class="kpi-delta up">↑ +${kpi.todayRevenueΔ}%</span>`
        : `<span class="kpi-delta down">↓ ${kpi.todayRevenueΔ}%</span>`)
    : '';

  const periodDeltaHtml = kpi.periodRevenueΔ !== null
    ? (kpi.periodRevenueΔ >= 0
        ? `<span class="kpi-delta up">↑ +${kpi.periodRevenueΔ}%</span>`
        : `<span class="kpi-delta down">↓ ${kpi.periodRevenueΔ}%</span>`)
    : '';

  // Get period label
  let periodLabel = 'Period';
  if (DASHBOARD_PERIOD === '7d') periodLabel = '7 Days';
  else if (DASHBOARD_PERIOD === '30d') periodLabel = '30 Days';
  else if (DASHBOARD_PERIOD === 'all') periodLabel = 'All-Time';
  else if (DASHBOARD_PERIOD === 'today') periodLabel = 'Today';

  const html = `
    <!-- Card 1: Today's Revenue (Hero) -->
    <div class="kpi-card kpi-card--hero">
      <div>
        <div class="kpi-label">Today's Revenue</div>
        <div class="kpi-value">₹${kpi.todayRevenue.toLocaleString('en-IN')}</div>
      </div>
      <div>
        ${todayDeltaHtml}
        ${makeSparkline(kpi.sparkData, 120, 32)}
      </div>
    </div>

    <!-- Card 2: Period Revenue -->
    <div class="kpi-card">
      <div>
        <div class="kpi-label">${periodLabel} Revenue</div>
        <div class="kpi-value">₹${kpi.periodRevenue.toLocaleString('en-IN')}</div>
      </div>
      <div>
        ${periodDeltaHtml}
        ${makeSparkline(kpi.sparkData, 80, 24)}
      </div>
    </div>

    <!-- Card 3: Today's Orders -->
    <div class="kpi-card">
      <div>
        <div class="kpi-label">Today's Orders</div>
        <div class="kpi-value">${kpi.todayCount}</div>
      </div>
      <div>
        <span class="kpi-label" style="font-size:10px; margin-top:8px; display:block;">Live orders</span>
      </div>
    </div>

    <!-- Card 4: Total Customers -->
    <div class="kpi-card">
      <div>
        <div class="kpi-label">Total Customers</div>
        <div class="kpi-value">${totalCustomers.toLocaleString('en-IN')}</div>
      </div>
      <div>
        <span class="kpi-label" style="font-size:10px; margin-top:8px; display:block;">Registered</span>
      </div>
    </div>

    <!-- Card 5: Avg Order Value -->
    <div class="kpi-card">
      <div>
        <div class="kpi-label">Avg Order Value</div>
        <div class="kpi-value">₹${kpi.periodAvg.toLocaleString('en-IN')}</div>
      </div>
      <div>
        <span class="kpi-label" style="font-size:10px; margin-top:8px; display:block;">Per order</span>
      </div>
    </div>

    <!-- Card 6: Rewards Given -->
    <div class="kpi-card">
      <div>
        <div class="kpi-label">Rewards Given</div>
        <div class="kpi-value">${rewardsGiven.toLocaleString('en-IN')}</div>
      </div>
      <div>
        <span class="kpi-label" style="font-size:10px; margin-top:8px; display:block;">Loyalty free meals</span>
      </div>
    </div>

    <!-- Card 7: Loyalty Conv. Rate -->
    <div class="kpi-card">
      <div>
        <div class="kpi-label">Loyalty Conv.</div>
        <div class="kpi-value">${conversionRate}%</div>
      </div>
      <div>
        <span class="kpi-label" style="font-size:10px; margin-top:8px; display:block;">Claim rate</span>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

let revenueTrendChart = null;
let paymentBreakdownChart = null;
let paymentDonutChart = null;

function renderRevenueTrendChart(entries) {
  const canvas = document.getElementById('chartRevenueTrend');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (revenueTrendChart) revenueTrendChart.destroy();

  const { labels, data } = getRevenueTrendData(entries);

  revenueTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Revenue',
        data,
        borderColor: '#e85d04',
        borderWidth: 2.5,
        pointRadius: 3,
        pointBackgroundColor: '#e85d04',
        fill: true,
        backgroundColor: (context) => {
          const chart = context.chart;
          const { ctx: chartCtx, chartArea } = chart;
          if (!chartArea) return null;
          const gradient = chartCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(232, 93, 4, 0.25)');
          gradient.addColorStop(1, 'rgba(232, 93, 4, 0)');
          return gradient;
        },
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `₹${item.raw.toLocaleString('en-IN')}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (v) => v >= 1000 ? `₹${(v/1000).toFixed(1)}K` : `₹${v}`,
            font: { family: 'Plus Jakarta Sans', size: 11 }
          },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        x: {
          ticks: { font: { family: 'Plus Jakarta Sans', size: 11 }, maxRotation: 30 },
          grid: { display: false }
        }
      }
    }
  });
}

function getRevenueTrendData(entries) {
  if (DASHBOARD_PERIOD === 'today') {
    // Hourly grouping
    const hourly = Array(24).fill(0);
    entries.forEach(e => {
      if (!e.time) return;
      const hour = parseInt(e.time.split(':')[0], 10);
      if (hour >= 0 && hour < 24) hourly[hour] += e.amount || 0;
    });
    const labels = Array.from({length: 24}, (_, i) => `${i}:00`);
    return { labels, data: hourly };
  }
  
  if (DASHBOARD_PERIOD === '7d') {
    return getDailyGrouped(entries, 7);
  }

  if (DASHBOARD_PERIOD === '30d') {
    return getDailyGrouped(entries, 30);
  }

  // All time: monthly grouping
  const monthly = {};
  entries.forEach(e => {
    if (!e.date) return;
    const [year, month] = e.date.split('-');
    const key = `${year}-${month}`;
    monthly[key] = (monthly[key] || 0) + (e.amount || 0);
  });
  const keys = Object.keys(monthly).sort();
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return {
    labels: keys.map(k => {
      const [y, m] = k.split('-');
      return `${monthNames[parseInt(m,10)-1]} '${y.slice(2)}`;
    }),
    data: keys.map(k => monthly[k])
  };
}

function getDailyGrouped(entries, days) {
  const labels = [];
  const data = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const amount = entries
      .filter(e => e.date === dateStr)
      .reduce((s, e) => s + (e.amount || 0), 0);
    
    const label = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
    labels.push(label);
    data.push(amount);
  }
  return { labels, data };
}

function renderPaymentBreakdownChart(entries) {
  const canvas = document.getElementById('chartPaymentBreakdown');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (paymentBreakdownChart) paymentBreakdownChart.destroy();

  const { labels, cashData, upiData, cardData } = getPaymentBreakdownData(entries);

  paymentBreakdownChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Cash',
          data: cashData,
          borderColor: '#10B981',
          backgroundColor: 'rgba(16, 185, 129, 0.25)',
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointBackgroundColor: '#10B981',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        },
        {
          label: 'UPI',
          data: upiData,
          borderColor: '#6366F1',
          backgroundColor: 'rgba(99, 102, 241, 0.25)',
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointBackgroundColor: '#6366F1',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        },
        {
          label: 'Card',
          data: cardData,
          borderColor: '#FF4B2B',
          backgroundColor: 'rgba(255, 75, 43, 0.25)',
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointBackgroundColor: '#FF4B2B',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      animation: { duration: 500 },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { family: 'Plus Jakarta Sans', size: 11 }, padding: 12 }
        },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ₹${item.raw.toLocaleString('en-IN')}`
          }
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          stacked: true,
          ticks: {
            callback: (v) => v >= 1000 ? `₹${(v/1000).toFixed(1)}K` : `₹${v}`,
            font: { family: 'Plus Jakarta Sans', size: 11 }
          }
        }
      }
    }
  });
}

function getPaymentBreakdownData(entries) {
  if (DASHBOARD_PERIOD === 'today') {
    // Hourly
    const cashData = Array(24).fill(0);
    const upiData = Array(24).fill(0);
    const cardData = Array(24).fill(0);
    entries.forEach(e => {
      if (!e.time) return;
      const hour = parseInt(e.time.split(':')[0], 10);
      if (hour >= 0 && hour < 24) {
        cashData[hour] += e.cash || 0;
        upiData[hour] += e.upi || 0;
        cardData[hour] += e.card || 0;
      }
    });
    const labels = Array.from({length: 24}, (_, i) => `${i}:00`);
    return { labels, cashData, upiData, cardData };
  }
  
  if (DASHBOARD_PERIOD === '7d' || DASHBOARD_PERIOD === '30d') {
    // Daily
    const days = DASHBOARD_PERIOD === '7d' ? 7 : 30;
    const labels = [];
    const cashData = [];
    const upiData = [];
    const cardData = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const dayEntries = entries.filter(e => e.date === dateStr);
      cashData.push(dayEntries.reduce((s, e) => s + (e.cash || 0), 0));
      upiData.push(dayEntries.reduce((s, e) => s + (e.upi || 0), 0));
      cardData.push(dayEntries.reduce((s, e) => s + (e.card || 0), 0));
      
      const label = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
      labels.push(label);
    }
    return { labels, cashData, upiData, cardData };
  }
  
  // All time: monthly
  const monthly = {};
  entries.forEach(e => {
    if (!e.date) return;
    const [year, month] = e.date.split('-');
    const key = `${year}-${month}`;
    if (!monthly[key]) {
      monthly[key] = { cash: 0, upi: 0, card: 0 };
    }
    monthly[key].cash += e.cash || 0;
    monthly[key].upi += e.upi || 0;
    monthly[key].card += e.card || 0;
  });
  const keys = Object.keys(monthly).sort();
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labels = keys.map(k => {
    const [y, m] = k.split('-');
    return `${monthNames[parseInt(m,10)-1]} '${y.slice(2)}`;
  });
  return {
    labels,
    cashData: keys.map(k => monthly[k].cash),
    upiData: keys.map(k => monthly[k].upi),
    cardData: keys.map(k => monthly[k].card)
  };
}

function renderPaymentDonut(entries) {
  const ctx = document.getElementById('chartPaymentDonut');
  if (!ctx) return;
  
  if (paymentDonutChart) paymentDonutChart.destroy();
  
  let cash = 0, upi = 0, card = 0;
  entries.forEach(e => {
    cash += e.cash || 0;
    upi += e.upi || 0;
    card += e.card || 0;
  });
  
  const total = cash + upi + card;
  const totalsEl = document.getElementById('paymentMixTotals');
  if (totalsEl) {
    totalsEl.innerHTML = `
      <span>
        <span class="mix-label">💵 Cash</span>
        <span class="mix-value">₹${cash.toLocaleString('en-IN')}</span>
      </span>
      <span>
        <span class="mix-label">📱 UPI</span>
        <span class="mix-value">₹${upi.toLocaleString('en-IN')}</span>
      </span>
      <span>
        <span class="mix-label">💳 Card</span>
        <span class="mix-value">₹${card.toLocaleString('en-IN')}</span>
      </span>
    `;
  }

  if (total === 0) {
    paymentDonutChart = new Chart(ctx.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['No Data'],
        datasets: [{
          data: [1],
          backgroundColor: ['#e2e8f0'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        cutout: '70%'
      }
    });
    return;
  }
  
  paymentDonutChart = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Cash', 'UPI', 'Card'],
      datasets: [{
        data: [cash, upi, card],
        backgroundColor: ['#10B981', '#6366F1', '#FF4B2B'],
        borderWidth: 0,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      cutout: '70%'
    }
  });
}
function renderBestSellers(entries) {
  const dateInput = document.getElementById('bestSellersDateFilter');
  let targetDate = istDateStr();
  if (dateInput) {
    if (!dateInput.value) {
      dateInput.value = targetDate;
    } else {
      targetDate = dateInput.value;
    }
  }
  const filteredEntries = ALL_ENTRIES_CACHE.filter(e => e.date === targetDate);
  renderBestSellersRanked(filteredEntries, 'dailyBestSellersList');
  renderBestSellersRanked(ALL_ENTRIES_CACHE, 'overallBestSellersList');
}

function getBestSellersData(entries) {
  const tally = {};
  entries.forEach(entry => {
    if (!entry.orderItems) return;
    try {
      const items = JSON.parse(entry.orderItems);
      if (Array.isArray(items)) {
        items.forEach(item => {
          if (!item.qty || item.qty <= 0) return;
          const flavourSuffix = item.flavour ? ` (${item.flavour})` : '';
          const key = `${item.dishName}${flavourSuffix}`;
          tally[key] = (tally[key] || 0) + item.qty;
        });
      }
    } catch (e) {
      // Ignore
    }
  });

  return Object.entries(tally)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty);
}

function renderBestSellersRanked(entries, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const sorted = getBestSellersData(entries);
  const top5 = sorted.slice(0, 5);

  if (top5.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:1rem; font-size:13px;">No data for this period.</p>';
    return;
  }

  const maxQty = top5[0].qty;
  const medals = ['🥇', '🥈', '🥉', '4', '5'];

  let html = top5.map((item, i) => {
    const pct = Math.round((item.qty / maxQty) * 100);
    const rankLabel = medals[i];
    return `<div class="best-seller-row">
      <span class="bs-rank">${rankLabel}</span>
      <div class="bs-info">
        <span class="bs-name">${item.name}</span>
        <div class="bs-bar-wrap">
          <div class="bs-bar" style="width:${pct}%"></div>
        </div>
      </div>
      <span class="bs-count">${item.qty}</span>
    </div>`;
  }).join('');

  if (sorted.length > 5) {
    const listType = containerId === 'dailyBestSellersList' ? 'today' : 'all-time';
    html += `
      <div style="margin-top: auto; padding-top: 12px; text-align: center;">
        <button class="btn btn--outline btn--sm" style="width: 100%;" onclick="showAllBestSellers('${listType}')">View All</button>
      </div>
    `;
  }

  container.innerHTML = html;
}

function showAllBestSellers(listType) {
  let entries = [];
  let title = '';
  
  if (listType === 'today') {
    const dateInput = document.getElementById('bestSellersDateFilter');
    let targetDate = istDateStr();
    if (dateInput && dateInput.value) {
      targetDate = dateInput.value;
    }
    entries = ALL_ENTRIES_CACHE.filter(e => e.date === targetDate);
    let dateObj = new Date(targetDate);
    let formattedDate = targetDate;
    if (!isNaN(dateObj)) {
      formattedDate = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    title = `Today's Best Sellers (${formattedDate})`;
  } else {
    entries = ALL_ENTRIES_CACHE;
    title = 'All-Time Best Sellers';
  }
  
  const sorted = getBestSellersData(entries);
  const container = document.getElementById('bestSellersAllList');
  const titleContainer = document.getElementById('bestSellersAllTitle');
  
  if (titleContainer) {
    titleContainer.innerHTML = `<span class="icon">${listType === 'today' ? '📈' : '🏆'}</span> ${title}`;
  }
  
  if (!container) return;
  
  if (sorted.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:1.5rem;">No data available.</p>';
  } else {
    const maxQty = sorted[0].qty;
    container.innerHTML = sorted.map((item, i) => {
      const pct = Math.round((item.qty / maxQty) * 100);
      const rankLabel = i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1);
      return `<div class="best-seller-row">
        <span class="bs-rank">${rankLabel}</span>
        <div class="bs-info">
          <span class="bs-name">${item.name}</span>
          <div class="bs-bar-wrap">
            <div class="bs-bar" style="width:${pct}%"></div>
          </div>
        </div>
        <span class="bs-count">${item.qty}</span>
      </div>`;
    }).join('');
  }
  
  openModal('modalBestSellersAll');
}

let customerTiersChart = null;

function renderCustomerBase(entries) {
  const ctx = document.getElementById('chartCustomerTiers');
  if (!ctx) return;
  
  if (customerTiersChart) customerTiersChart.destroy();
  
  const visitCounts = {};
  ALL_ENTRIES_CACHE.forEach(e => {
    if (!e.mobile || e.mobile.trim() === '') return;
    visitCounts[e.mobile] = (visitCounts[e.mobile] || 0) + 1;
  });
  
  let regulars = 0;  // 2+ visits
  let oneTimers = 0; // 1 visit
  
  Object.values(visitCounts).forEach(count => {
    if (count >= 2) regulars++;
    else oneTimers++;
  });
  
  const total = regulars + oneTimers;
  const pillsEl = document.getElementById('tierPills');
  if (pillsEl) {
    pillsEl.innerHTML = `
      <span class="tier-pill" style="background:rgba(232, 93, 4, 0.15); color:#e85d04;">🤝 Regulars: ${regulars}</span>
      <span class="tier-pill" style="background:rgba(209, 213, 219, 0.3); color:var(--text-secondary);">🌱 One-timers: ${oneTimers}</span>
    `;
  }
  
  if (total === 0) {
    customerTiersChart = new Chart(ctx.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['No Data'],
        datasets: [{
          data: [1],
          backgroundColor: ['#e2e8f0'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        cutout: '70%'
      }
    });
    return;
  }
  
  customerTiersChart = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Regulars (2+)', 'One-timers (1)'],
      datasets: [{
        data: [regulars, oneTimers],
        backgroundColor: ['#e85d04', '#d1d5db'],
        borderWidth: 0,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      cutout: '70%'
    }
  });
}

function renderTopLoyalists() {
  const ul = document.getElementById('topCustomersList');
  if (!ul) return;
  
  const sortSelect = document.getElementById('loyalistSort');
  const sortBy = sortSelect ? sortSelect.value : 'visits';
  
  const customerMap = {};
  ALL_ENTRIES_CACHE.forEach(e => {
    if (!e.mobile || e.mobile.trim() === '') return;
    if (!customerMap[e.mobile]) {
      customerMap[e.mobile] = { mobile: e.mobile, visits: 0, revenue: 0 };
    }
    customerMap[e.mobile].visits += 1;
    customerMap[e.mobile].revenue += (e.amount || 0);
  });
  
  const list = Object.values(customerMap);
  if (sortBy === 'visits') {
    list.sort((a, b) => b.visits - a.visits);
  } else {
    list.sort((a, b) => b.revenue - a.revenue);
  }
  
  const top8 = list.slice(0, 8);
  if (top8.length === 0) {
    ul.innerHTML = '<li style="color:var(--text-muted); font-size:13px; text-align:center; padding:1rem;">No customer records yet.</li>';
    return;
  }
  
  ul.innerHTML = top8.map((c, i) => {
    const displayMobile = c.mobile;
    
    const valueLabel = sortBy === 'visits' ? `${c.visits} visits` : `₹${c.revenue.toLocaleString('en-IN')}`;

    return `<li style="cursor:pointer;" onclick="openLoyalistProfile('${c.mobile}')">
      <div style="display:flex; align-items:center;">
        <span class="top-list__rank" style="margin-right:8px; font-weight:700;">#${i + 1}</span>
        <span>${displayMobile}</span>
      </div>
      <span style="font-weight:700; color:var(--brand-primary);">${valueLabel}</span>
    </li>`;
  }).join('');
}

async function openLoyalistProfile(mobile) {
  try {
    toast('Loading customer profile…', 'info');
    const cust = await api({ action: 'getCustomer', mobile });
    CURRENT_CUSTOMER = cust;
    openDetailsModal();
  } catch (e) {
    toast('Error opening profile: ' + e.message, 'error');
  }
}

function renderRecentActivity() {
  const container = document.getElementById('recentActivityFeed');
  if (!container) return;
  
  const recent = [...ALL_ENTRIES_CACHE]
    .sort((a, b) => {
      const dateA = a.date + 'T' + (a.time || '00:00:00');
      const dateB = b.date + 'T' + (b.time || '00:00:00');
      return dateB.localeCompare(dateA);
    })
    .slice(0, 10);

  if (!recent.length) {
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:2rem; font-size:13px;">No transactions recorded yet.</p>';
    return;
  }

  container.innerHTML = recent.map((e, i) => {
    const absoluteIndex = ALL_ENTRIES_CACHE.indexOf(e);
    
    const displayMobile = e.mobile && e.mobile.trim() !== ''
      ? e.mobile
      : 'Walk-in';
      
    const modeIcon = { cash: '💵', upi: '📱', card: '💳', split: '✂️' }[e.paymentMode] || '💵';
    
    let itemsStr = '—';
    if (e.orderItems) {
      try {
        const items = JSON.parse(e.orderItems);
        if (Array.isArray(items) && items.length > 0) {
          itemsStr = items.map(it => `${it.dishName}×${it.qty || 1}`).join(', ');
        }
      } catch (err) {}
    }
    
    const dateLabel = e.date ? e.date.substring(5) : '';
    const timeLabel = e.time ? e.time.substring(0, 5) : '';
    const timeDisplay = `${dateLabel} ${timeLabel}`;
    
    return `<div class="activity-row" onclick="showEntryDetails(${absoluteIndex})" style="cursor:pointer;">
      <div class="activity-time">${timeDisplay}</div>
      <div class="activity-customer">${displayMobile}</div>
      <div class="activity-amount">₹${(e.amount || 0).toLocaleString('en-IN')}</div>
      <div class="activity-mode">${modeIcon}</div>
      <div class="activity-items" title="${itemsStr}">${itemsStr}</div>
    </div>`;
  }).join('');
}

function prependActivityRow(e) {
  const feed = document.getElementById('recentActivityFeed');
  if (!feed) return;
  
  if (feed.querySelector('p')) {
    feed.innerHTML = '';
  }
  
  const displayMobile = e.mobile && e.mobile.trim() !== ''
    ? e.mobile
    : 'Walk-in';
    
  const modeIcon = { cash: '💵', upi: '📱', card: '💳', split: 'split' }[e.cash ? (e.upi ? 'split' : (e.card ? 'split' : 'cash')) : (e.upi ? (e.card ? 'split' : 'upi') : 'card')] || '💵';
  
  let itemsStr = '—';
  if (e.orderItems) {
    try {
      const items = JSON.parse(e.orderItems);
      if (Array.isArray(items) && items.length > 0) {
        itemsStr = items.map(it => `${it.dishName}×${it.qty || 1}`).join(', ');
      }
    } catch (err) {}
  }
  
  const dateLabel = e.date ? e.date.substring(5) : '';
  const timeLabel = e.time ? e.time.substring(0, 5) : '';
  
  const absoluteIndex = ALL_ENTRIES_CACHE.indexOf(e);
  
  const row = document.createElement('div');
  row.className = 'activity-row activity-row--new';
  row.onclick = () => showEntryDetails(absoluteIndex);
  row.style.cursor = 'pointer';
  row.innerHTML = `
    <div class="activity-time">${dateLabel} ${timeLabel}</div>
    <div class="activity-customer">${displayMobile}</div>
    <div class="activity-amount">₹${(e.amount || 0).toLocaleString('en-IN')}</div>
    <div class="activity-mode">${modeIcon}</div>
    <div class="activity-items" title="${itemsStr}">${itemsStr}</div>
  `;
  
  feed.prepend(row);
  
  const rows = feed.querySelectorAll('.activity-row');
  if (rows.length > 10) {
    rows[rows.length - 1].remove();
  }
  
  requestAnimationFrame(() => {
    row.classList.add('activity-row--visible');
  });
}

function renderTodaySummaryCard() {
  const valEl = document.getElementById('todayValue');
  const deltaEl = document.getElementById('todayDelta');
  if (!valEl) return;
  
  const today = istDateStr();
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  })();
  
  const todayEntries = ALL_ENTRIES_CACHE.filter(e => e.date === today);
  const yesterdayEntries = ALL_ENTRIES_CACHE.filter(e => e.date === yesterday);
  
  const todayRevenue = todayEntries.reduce((s, e) => s + (e.amount || 0), 0);
  const yesterdayRevenue = yesterdayEntries.reduce((s, e) => s + (e.amount || 0), 0);
  
  const todayCount = todayEntries.length;
  const yesterdayCount = yesterdayEntries.length;
  
  if (todayView === 'entries') {
    valEl.textContent = todayCount + (todayCount === 1 ? ' entry' : ' entries');
    const diff = todayCount - yesterdayCount;
    if (diff > 0) {
      deltaEl.textContent = `↑ +${diff} vs yesterday`;
      deltaEl.className = 'today-delta positive';
    } else if (diff < 0) {
      deltaEl.textContent = `↓ ${diff} vs yesterday`;
      deltaEl.className = 'today-delta negative';
    } else {
      deltaEl.textContent = `→ 0 vs yesterday`;
      deltaEl.className = 'today-delta';
    }
  } else {
    valEl.textContent = '₹' + todayRevenue.toLocaleString('en-IN');
    const diff = todayRevenue - yesterdayRevenue;
    const sign = diff >= 0 ? '+' : '';
    if (diff > 0) {
      deltaEl.textContent = `↑ ${sign}₹${diff.toLocaleString('en-IN')} vs yesterday`;
      deltaEl.className = 'today-delta positive';
    } else if (diff < 0) {
      deltaEl.textContent = `↓ ₹${Math.abs(diff).toLocaleString('en-IN')} vs yesterday`;
      deltaEl.className = 'today-delta negative';
    } else {
      deltaEl.textContent = `→ ₹0 vs yesterday`;
      deltaEl.className = 'today-delta';
    }
  }
}

function setTodayView(view, btn) {
  todayView = view;
  document.querySelectorAll('#todayToggle .toggle-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderTodaySummaryCard();
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
  let peakDayIdx = 0;
  let peakHourIdx = 0;
  
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = matrix[d][h];
      if (v > maxVal) {
        maxVal = v;
        peakDayIdx = d;
        peakHourIdx = h;
      }
    }
  }

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

      let cellClasses = ['heatmap-cell'];
      if (h < 3) cellClasses.push('edge-left');
      if (h > 20) cellClasses.push('edge-right');
      if (d < 2) cellClasses.push('edge-top');
      const classAttr = cellClasses.join(' ');

      html += '<div class="' + classAttr + '" style="background:' + bg + '">' +
        '<div class="heatmap-tooltip">' + days[d] + ' ' + h + ':00 — ' + val + '</div>' +
        '</div>';
    }
  }
  html += '</div>';
  container.innerHTML = html;

  // Peak callout
  const peakCallout = document.getElementById('peakHoursCallout');
  if (peakCallout) {
    if (maxVal > 0) {
      const ampm = peakHourIdx >= 12 ? 'PM' : 'AM';
      const displayHour = peakHourIdx % 12 || 12;
      peakCallout.textContent = `🔥 Busiest: ${days[peakDayIdx]} at ${displayHour}${ampm}`;
      peakCallout.style.display = 'block';
    } else {
      peakCallout.style.display = 'none';
    }
  }
}

// ──── Time Between Visits ────
let tbvChart = null;

function calculateTimeBetweenVisits() {
  const byMobile = {};
  
  ALL_ENTRIES_CACHE.forEach(r => {
    if (!r.mobile || !r.date) return;
    const m = r.mobile;
    if (!m || m.trim() === '') return;
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

    const dist = {
      'Same Day': 0,
      '1-2 Days': 0,
      '3-5 Days': 0,
      '6-10 Days': 0,
      '11-20 Days': 0,
      '21-30 Days': 0,
      '30+ Days': 0
    };
    gaps.forEach(g => {
      if (g === 0) dist['Same Day']++;
      else if (g <= 2) dist['1-2 Days']++;
      else if (g <= 5) dist['3-5 Days']++;
      else if (g <= 10) dist['6-10 Days']++;
      else if (g <= 20) dist['11-20 Days']++;
      else if (g <= 30) dist['21-30 Days']++;
      else dist['30+ Days']++;
    });

    data = { avg, min, max, totalGaps: gaps.length, distribution: dist };
  }

  show('tbvContainer');

  const statsGrid = document.getElementById('tbvStats');
  if (statsGrid) {
    statsGrid.innerHTML = `
      <div class="stat-card">
        <div class="stat-card__value">${data.avg}d</div>
        <div class="stat-card__label">Avg Gap</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${data.min}d</div>
        <div class="stat-card__label">Min Gap</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${data.max}d</div>
        <div class="stat-card__label">Max Gap</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${data.totalGaps || 0}</div>
        <div class="stat-card__label">Total Pairs</div>
      </div>
    `;
  }

  const dist = data.distribution || {};
  const labels = ['Same Day', '1-2 Days', '3-5 Days', '6-10 Days', '11-20 Days', '21-30 Days', '30+ Days'];
  const values = labels.map(k => dist[k] || 0);

  const canvas = document.getElementById('chartTBV');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (tbvChart) tbvChart.destroy();
  
  tbvChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Customer Gaps',
        data: values,
        backgroundColor: (context) => {
          const chart = context.chart;
          const { ctx: chartCtx, chartArea } = chart;
          if (!chartArea) return 'rgba(232, 93, 4, 0.7)';
          const gradient = chartCtx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
          gradient.addColorStop(0, 'rgba(232, 93, 4, 0.4)');
          gradient.addColorStop(1, 'rgba(255, 75, 43, 0.85)');
          return gradient;
        },
        hoverBackgroundColor: (context) => {
          const chart = context.chart;
          const { ctx: chartCtx, chartArea } = chart;
          if (!chartArea) return 'rgba(232, 93, 4, 0.9)';
          const gradient = chartCtx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
          gradient.addColorStop(0, 'rgba(232, 93, 4, 0.7)');
          gradient.addColorStop(1, 'rgba(255, 75, 43, 1)');
          return gradient;
        },
        borderRadius: 8,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(26, 24, 28, 0.95)',
          titleFont: { family: 'Plus Jakarta Sans', size: 12, weight: 'bold' },
          bodyFont: { family: 'Plus Jakarta Sans', size: 12 },
          padding: 10,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            label: (item) => ` ${item.raw} return visits`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(128, 128, 128, 0.12)',
            drawBorder: false
          },
          ticks: {
            color: 'rgba(128, 128, 128, 0.8)',
            font: { family: 'Plus Jakarta Sans', size: 10 }
          }
        },
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: 'rgba(128, 128, 128, 0.8)',
            font: { family: 'Plus Jakarta Sans', size: 10 }
          }
        }
      }
    }
  });
}

// ══════════════════════════════════════
//  POS SYSTEM LOGIC
// ══════════════════════════════════════

let POS_STATE = {
  tableCount: 0,
  tableCategories: [], // Configured table layout categories/sections
  currentTableId: null,
  currentCategoryIndex: null,
  categories: [],
  dishes: [], // dishes for current category
  tableOrders: JSON.parse(localStorage.getItem('ppp_tables') || '{}'),
  flavoursMap: {}
};

function initializeLocalTableOrders(serverOrders) {
  POS_STATE.tableOrders = {};
  if (POS_STATE.tableCategories && POS_STATE.tableCategories.length > 0) {
    let globalIndex = 1;
    POS_STATE.tableCategories.forEach(cat => {
      const count = Number(cat.count) || 0;
      for (let i = 1; i <= count; i++) {
        const uniqueId = `table_${cat.id}_${i}`;
        // Map from server unique ID, or fallback to the old global numerical index if present
        POS_STATE.tableOrders[uniqueId] = (serverOrders && (serverOrders[uniqueId] || serverOrders[globalIndex])) || {};
        globalIndex++;
      }
    });
  } else {
    // Fallback if no categories
    for (let i = 1; i <= POS_STATE.tableCount; i++) {
      POS_STATE.tableOrders[i] = (serverOrders && serverOrders[i]) || {};
    }
  }
}

function getUniqueTablesTopic() {
  try {
    if (API_URL && API_URL.includes('/s/')) {
      const parts = API_URL.split('/s/')[1];
      if (parts) {
        const subParts = parts.split('/')[0];
        if (subParts) {
          return 'ppp_tables_' + subParts.substring(0, 16);
        }
      }
    }
  } catch (e) {
    console.error('Error parsing API_URL for topic', e);
  }
  return 'ppp_tables_default_fallback';
}

function startTablesEventListener() {
  if (window.tablesEventSource) return;
  
  const topic = getUniqueTablesTopic();
  const url = `https://ntfy.sh/${topic}/sse`;
  
  window.tablesEventSource = new EventSource(url);
  window.tablesEventSource.onmessage = async (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload && payload.message) {
        const msgData = JSON.parse(payload.message);
        if (msgData && msgData.action === 'table_updated') {
          // Fetch the latest table data from database
          const res = await apiDirect({ action: 'getTablesData' });
          if (res && !res.error) {
            // Merge server orders without overwriting the table currently being edited locally
            if (POS_STATE.tableCategories && POS_STATE.tableCategories.length > 0) {
              POS_STATE.tableCategories.forEach(cat => {
                const count = Number(cat.count) || 0;
                for (let i = 1; i <= count; i++) {
                  const uniqueId = `table_${cat.id}_${i}`;
                  if (uniqueId === POS_STATE.currentTableId) {
                    if (!POS_STATE.tableOrders[uniqueId]) {
                      POS_STATE.tableOrders[uniqueId] = {};
                    }
                    continue;
                  }
                  POS_STATE.tableOrders[uniqueId] = res[uniqueId] || {};
                }
              });
            } else {
              for (let i = 1; i <= POS_STATE.tableCount; i++) {
                if (i === POS_STATE.currentTableId) {
                  if (!POS_STATE.tableOrders[i]) {
                    POS_STATE.tableOrders[i] = {};
                  }
                  continue;
                }
                POS_STATE.tableOrders[i] = res[i] || {};
              }
            }
            localStorage.setItem('ppp_tables', JSON.stringify(POS_STATE.tableOrders));
            
            // Re-render UI depending on active view
            const tablesView = document.getElementById('posTablesView');
            if (tablesView && !tablesView.classList.contains('hidden')) {
              showPosTables();
            }
            
            const reportView = document.getElementById('posLiveTablesReportView');
            if (reportView && !reportView.classList.contains('hidden')) {
              renderLiveTablesReportContent();
            }
            
            const categoriesView = document.getElementById('posCategoriesView');
            if (categoriesView && !categoriesView.classList.contains('hidden')) {
              updateCategoryActiveStates();
            }
            
            const dishesView = document.getElementById('posDishesView');
            if (dishesView && !dishesView.classList.contains('hidden')) {
              renderPosDishes();
            }
          }
        }
      }
    } catch (e) {
      console.error('Error handling tables SSE event', e);
    }
  };
  
  window.tablesEventSource.onerror = (e) => {
    console.warn('Tables SSE error, reconnecting...', e);
  };
}

async function notifyTableUpdate(tableId) {
  try {
    const topic = getUniqueTablesTopic();
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'table_updated', tableId: tableId })
    });
  } catch (err) {
    console.error('Failed to dispatch pub/sub update notification', err);
  }
}

async function initPos() {
  try {
    const res = await api({ action: 'getTableCount' });
    POS_STATE.tableCount = res.count || 0;
    POS_STATE.tableCategories = res.categories || [];
  } catch (e) {
    console.error('Failed to load table count and categories', e);
  }

  // Fetch active table orders from Google Sheets on start
  try {
    const serverOrders = await apiDirect({ action: 'getTablesData' });
    if (serverOrders && !serverOrders.error) {
      initializeLocalTableOrders(serverOrders);
      localStorage.setItem('ppp_tables', JSON.stringify(POS_STATE.tableOrders));
    }
  } catch (e) {
    console.error('Failed to load table orders from server, using local fallback', e);
  }

  // Initialize occupiedSince helper timestamps for local state robustness
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
      localStorage.setItem('ppp_tables', JSON.stringify(POS_STATE.tableOrders));
    }
  }
  
  showPosTables();

  // Start event-driven updates listener
  startTablesEventListener();
}

let tableSyncTimers = {};

function syncTableData(tableId) {
  if (tableSyncTimers[tableId]) {
    clearTimeout(tableSyncTimers[tableId]);
  }
  
  tableSyncTimers[tableId] = setTimeout(async () => {
    delete tableSyncTimers[tableId];
    try {
      const order = POS_STATE.tableOrders[tableId] || {};
      const hasItems = Object.keys(order).some(k => k !== 'occupiedSince' && order[k].qty > 0);
      
      if (hasItems) {
        let grandTotal = 0;
        Object.keys(order).forEach(k => {
          if (k !== 'occupiedSince') grandTotal += (order[k].qty * order[k].price);
        });
        
        await apiDirect({
          action: 'saveTableData',
          tableId: tableId,
          orderItemsJson: JSON.stringify(order),
          occupiedSince: order.occupiedSince || '',
          grandTotal: grandTotal
        });
      } else {
        await apiDirect({
          action: 'clearTableData',
          tableId: tableId
        });
      }
      
      // Dispatch immediate pub/sub update notification
      notifyTableUpdate(tableId);
    } catch (e) {
      console.error('Failed to sync table ' + tableId + ' to backend', e);
    }
  }, 1000);
}

function updateTableTimers() {
  const view = document.getElementById('posTablesView');
  if (!view || view.classList.contains('hidden')) return;
  
  const updateTimerElement = (uniqueId) => {
    const timerEl = document.getElementById(`table-timer-${uniqueId}`);
    if (!timerEl) return;
    
    const order = POS_STATE.tableOrders[uniqueId];
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
      timerEl.style.display = 'inline-flex';
    } else {
      timerEl.textContent = '';
      timerEl.style.display = 'none';
    }
  };

  if (POS_STATE.tableCategories && POS_STATE.tableCategories.length > 0) {
    POS_STATE.tableCategories.forEach(cat => {
      const count = Number(cat.count) || 0;
      for (let i = 1; i <= count; i++) {
        updateTimerElement(`table_${cat.id}_${i}`);
      }
    });
  } else {
    for (let i = 1; i <= POS_STATE.tableCount; i++) {
      updateTimerElement(i);
    }
  }
}

// Start updating table timers globally every second
if (!window.tableTimerInterval) {
  window.tableTimerInterval = setInterval(updateTableTimers, 1000);
}

function createTableCard(uniqueId, displayNum, categoryName) {
  const card = document.createElement('div');
  card.onclick = () => openPosTable(uniqueId);
  card.setAttribute('data-table-id', uniqueId);
  
  const order = POS_STATE.tableOrders[uniqueId];
  const hasOrder = order && Object.keys(order).some(k => k !== 'occupiedSince' && order[k].qty > 0);
  
  if (hasOrder) {
    card.className = 'pos-table-card occupied';
    
    let totalBill = 0;
    const itemList = [];
    Object.keys(order).forEach(k => {
      if (k !== 'occupiedSince' && order[k].qty > 0) {
        const name = order[k].dishName || order[k].name;
        const variantSuffix = order[k].flavour ? ` (${order[k].flavour})` : '';
        itemList.push(`${order[k].qty}x ${name}${variantSuffix}`);
        totalBill += (order[k].qty * order[k].price);
      }
    });
    
    const itemsSummary = itemList.join(', ');
    
    card.innerHTML = `
      <div class="table-card-header">
        <span class="table-badge occupied">Occupied</span>
        <span class="table-bill-total">₹${totalBill}</span>
      </div>
      <div class="table-card-body">
        <div class="table-icon">🍕</div>
        <div class="table-name">Table ${displayNum}</div>
        <div class="table-timer" id="table-timer-${uniqueId}">⏱️ --:--</div>
      </div>
      ${itemsSummary ? `<div class="table-items-list"><div class="table-items-summary" title="${itemsSummary}">${itemsSummary}</div></div>` : ''}
    `;
  } else {
    card.className = 'pos-table-card free';
    card.innerHTML = `
      <div class="table-card-header">
        <span class="table-badge free">Free</span>
        <span></span>
      </div>
      <div class="table-card-body">
        <div class="table-icon">🪑</div>
        <div class="table-name">Table ${displayNum}</div>
        <div class="table-timer" id="table-timer-${uniqueId}" style="display: none;"></div>
      </div>
    `;
  }
  return card;
}

function showPosTables() {
  POS_STATE.currentTableId = null;
  hide('posCategoriesView');
  hide('posDishesView');
  hide('posLiveTablesReportView');
  show('posTablesView');
  
  const container = document.getElementById('posTablesGrid');
  container.innerHTML = '';
  
  if (POS_STATE.tableCount === 0) {
    container.style.display = 'grid'; // Restore grid
    container.innerHTML = '<p style="grid-column:1/-1; text-align:center;">No tables configured. Please configure in Admin.</p>';
    return;
  }
  
  if (POS_STATE.tableCategories && POS_STATE.tableCategories.length > 0) {
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '2rem';
    
    POS_STATE.tableCategories.forEach(cat => {
      const section = document.createElement('div');
      section.className = 'table-category-group';
      
      const title = document.createElement('h3');
      title.className = 'table-category-group-title';
      title.style.fontSize = '1.25rem';
      title.style.fontWeight = '700';
      title.style.color = 'var(--text-secondary)';
      title.style.marginBottom = '1rem';
      title.textContent = cat.name;
      section.appendChild(title);
      
      const grid = document.createElement('div');
      grid.className = 'pos-tables-grid';
      
      const count = Number(cat.count) || 0;
      for (let i = 1; i <= count; i++) {
        const uniqueId = `table_${cat.id}_${i}`;
        const card = createTableCard(uniqueId, i, cat.name);
        grid.appendChild(card);
      }
      
      section.appendChild(grid);
      container.appendChild(section);
    });
  } else {
    // Fallback if no categories
    container.style.display = 'grid'; // Restore grid
    for (let i = 1; i <= POS_STATE.tableCount; i++) {
      const card = createTableCard(i, i, 'General');
      container.appendChild(card);
    }
  }
  updateTableTimers();
}

async function openLiveTablesReport() {
  hide('posTablesView');
  show('posLiveTablesReportView');
  
  const content = document.getElementById('posLiveTablesReportContent');
  if (content) {
    content.innerHTML = `
      <p style="text-align:center; padding: 3rem 0; color:var(--text-secondary);">
        <span class="spinner" style="border-top-color:var(--brand-primary); display:inline-block; width:1.5rem; height:1.5rem; vertical-align:middle; margin-right:0.5rem;"></span>
        Fetching latest table data from database...
      </p>
    `;
  }
  
  try {
    const res = await apiDirect({ action: 'getTablesData' });
    if (res && !res.error) {
      POS_STATE.tableOrders = res;
      localStorage.setItem('ppp_tables', JSON.stringify(POS_STATE.tableOrders));
      renderLiveTablesReportContent();
    } else {
      if (content) {
        content.innerHTML = `<p style="text-align:center; color:var(--brand-primary); padding: 2rem 0;">Error loading tables data from server.</p>`;
      }
    }
  } catch (err) {
    console.error('Failed to load live tables report', err);
    if (content) {
      content.innerHTML = `<p style="text-align:center; color:var(--brand-primary); padding: 2rem 0;">Failed to connect to database.</p>`;
    }
  }
}

function closeLiveTablesReport() {
  hide('posLiveTablesReportView');
  show('posTablesView');
  showPosTables();
}

function renderLiveTablesReportContent() {
  const content = document.getElementById('posLiveTablesReportContent');
  if (!content) return;
  content.innerHTML = '';
  
  const occupiedTables = [];
  
  if (POS_STATE.tableCategories && POS_STATE.tableCategories.length > 0) {
    POS_STATE.tableCategories.forEach(cat => {
      const count = Number(cat.count) || 0;
      for (let i = 1; i <= count; i++) {
        const uniqueId = `table_${cat.id}_${i}`;
        const order = POS_STATE.tableOrders[uniqueId];
        if (order && Object.keys(order).some(k => k !== 'occupiedSince' && order[k].qty > 0)) {
          occupiedTables.push({ id: uniqueId, displayNum: i, categoryName: cat.name, order: order });
        }
      }
    });
  } else {
    for (let i = 1; i <= POS_STATE.tableCount; i++) {
      const order = POS_STATE.tableOrders[i];
      if (order && Object.keys(order).some(k => k !== 'occupiedSince' && order[k].qty > 0)) {
        occupiedTables.push({ id: i, displayNum: i, categoryName: 'General', order: order });
      }
    }
  }
  
  if (occupiedTables.length === 0) {
    content.innerHTML = '<p style="text-align:center; color:var(--text-muted); font-size:1.1rem; padding: 2.5rem 0;">No tables are currently occupied.</p>';
    return;
  }
  
  let html = `<div class="live-report-wrapper">`;
  let totalRevenue = 0;
  
  occupiedTables.forEach(item => {
    const tableId = item.id;
    const displayNum = item.displayNum;
    const categoryName = item.categoryName;
    const order = item.order;
    
    // Calculate elapsed time details
    let durationStr = 'N/A';
    let timeStr = 'N/A';
    if (order.occupiedSince) {
      const occupiedTime = new Date(order.occupiedSince);
      timeStr = occupiedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      const elapsedMs = Date.now() - order.occupiedSince;
      const elapsedMins = Math.floor(elapsedMs / 60000);
      if (elapsedMins < 60) {
        durationStr = `${elapsedMins}m ago`;
      } else {
        const hrs = Math.floor(elapsedMins / 60);
        const mins = elapsedMins % 60;
        durationStr = `${hrs}h ${mins}m ago`;
      }
    }
    
    let tableBillTotal = 0;
    let itemsHtml = '';
    
    Object.keys(order).forEach(k => {
      if (k !== 'occupiedSince' && order[k].qty > 0) {
        const dish = order[k];
        const name = dish.dishName || dish.name;
        const variantSuffix = dish.flavour ? ` (${dish.flavour})` : '';
        const itemTotal = dish.qty * dish.price;
        tableBillTotal += itemTotal;
        
        itemsHtml += `
          <div class="report-item-row">
            <span class="report-item-qty">${dish.qty}x</span>
            <span class="report-item-name">${name}${variantSuffix}</span>
            <span class="report-item-price">₹${dish.price} each</span>
            <span class="report-item-total">₹${itemTotal}</span>
          </div>
        `;
      }
    });
    
    totalRevenue += tableBillTotal;
    
    html += `
      <div class="report-table-card glass-card mb-4">
        <div class="report-table-header">
          <h3 class="report-table-title">Table ${displayNum} <span style="font-size: 0.95rem; font-weight: 500; color: var(--text-secondary);">(${categoryName})</span></h3>
          <div class="report-table-meta">
            <span class="report-meta-badge">Occupied since: ${timeStr} (${durationStr})</span>
          </div>
        </div>
        <div class="report-table-body">
          <div class="report-items-header">Items Summary:</div>
          <div class="report-items-list">
            ${itemsHtml}
          </div>
          <div class="report-table-footer">
            <span>Subtotal:</span>
            <span class="report-table-grand-total">₹${tableBillTotal}</span>
          </div>
        </div>
      </div>
    `;
  });
  
  html += `
    <div class="report-summary-footer glass-card p-3 flex-between">
      <span class="report-summary-text">Total Active Tables: <strong>${occupiedTables.length}</strong></span>
      <span class="report-summary-revenue">Total Active Revenue: <strong>₹${totalRevenue}</strong></span>
    </div>
  </div>`;
  
  content.innerHTML = html;
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
  
  const order = POS_STATE.tableOrders[POS_STATE.currentTableId];
  POS_STATE.categories.forEach(cat => {
    const card = document.createElement('div');
    card.id = `category-card-${cat.index}`;
    
    // Check if this category has selected items
    let hasSelected = false;
    if (order) {
      hasSelected = Object.keys(order).some(k => {
        return k !== 'occupiedSince' && order[k].qty > 0 && 
               order[k].categoryName && cat.name &&
               order[k].categoryName.trim().toLowerCase() === cat.name.trim().toLowerCase();
      });
    }
    
    card.className = hasSelected ? 'pos-category-card active' : 'pos-category-card';
    
    // Fallback icon logic if needed or random icon
    const icon = cat.icon || '';
    
    card.innerHTML = `
      <div class="table-card-header">
        <!-- Spacer to match table cards if needed or badge -->
        ${hasSelected ? '<span class="table-badge active">Selected</span>' : '<span></span>'}
      </div>
      <div class="category-card-body">
        ${icon ? `<div class="category-icon">${icon}</div>` : ''}
        <div class="category-name">${cat.name}</div>
      </div>
    `;
    
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
  renderPosCategories();
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
    card.id = `dish-card-${dish.dishIndex}`;
    card.className = currentQty > 0 ? 'pos-dish-card active' : 'pos-dish-card';
    card.innerHTML = `
      <div class="table-card-header">
        ${currentQty > 0 ? '<span class="table-badge active">Selected</span>' : '<span></span>'}
      </div>
      <div class="dish-card-body">
        <div class="pos-dish-info" onclick="updateDishQty(${dish.dishIndex}, '${dish.name}', ${dish.amount}, 1)">
          <div class="pos-dish-name">${dish.name}</div>
          <div class="pos-dish-price">₹${dish.amount}</div>
        </div>
        <div class="qty-selector">
          <button class="qty-btn" onclick="updateDishQty(${dish.dishIndex}, '${dish.name}', ${dish.amount}, -1)">-</button>
          <div class="qty-display" id="qty-dish-${dish.dishIndex}">${currentQty}</div>
          <button class="qty-btn" onclick="updateDishQty(${dish.dishIndex}, '${dish.name}', ${dish.amount}, 1)">+</button>
        </div>
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
    const categoryObj = POS_STATE.categories.find(c => Number(c.index) === Number(POS_STATE.currentCategoryIndex));
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
  
  localStorage.setItem('ppp_tables', JSON.stringify(POS_STATE.tableOrders));
  
  // Sync modified table order to Google Sheets (debounced)
  syncTableData(POS_STATE.currentTableId);
  
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
  
  const cardElement = document.getElementById(`dish-card-${baseKey.split('-')[1]}`);
  if (cardElement) {
    const header = cardElement.querySelector('.table-card-header');
    if (totalQty > 0) {
      cardElement.classList.add('active');
      if (header) header.innerHTML = '<span class="table-badge active">Selected</span>';
    } else {
      cardElement.classList.remove('active');
      if (header) header.innerHTML = '<span></span>';
    }
  }
  
  // Instantly sync category active highlights in categories grid
  updateCategoryActiveStates();
}

function updateCategoryActiveStates() {
  const order = POS_STATE.tableOrders[POS_STATE.currentTableId];
  POS_STATE.categories.forEach(cat => {
    const card = document.getElementById(`category-card-${cat.index}`);
    if (card) {
      let hasSelected = false;
      if (order) {
        hasSelected = Object.keys(order).some(k => {
          return k !== 'occupiedSince' && order[k].qty > 0 && 
                 order[k].categoryName && cat.name &&
                 order[k].categoryName.trim().toLowerCase() === cat.name.trim().toLowerCase();
        });
      }
      if (hasSelected) {
        card.classList.add('active');
        const header = card.querySelector('.table-card-header');
        if (header) header.innerHTML = '<span class="table-badge active">Selected</span>';
      } else {
        card.classList.remove('active');
        const header = card.querySelector('.table-card-header');
        if (header) header.innerHTML = '<span></span>';
      }
    }
  });
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
  localStorage.setItem('ppp_tables', JSON.stringify(POS_STATE.tableOrders));
  
  // Clear table order from Google Sheets immediately
  try {
    apiDirect({
      action: 'clearTableData',
      tableId: POS_STATE.currentTableId
    }).then(() => {
      notifyTableUpdate(POS_STATE.currentTableId);
    });
  } catch (err) {
    console.error('Failed to clear table order on server', err);
  }
  
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

function loadAdminTableCategories() {
  const tbody = document.getElementById('adminTableCategoriesTable');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (!POS_STATE.tableCategories || POS_STATE.tableCategories.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding: 1.5rem 0;">No sections configured.</td></tr>';
    return;
  }
  
  POS_STATE.tableCategories.forEach(cat => {
    const tr = document.createElement('tr');
    tr.id = `admin-table-cat-row-${cat.id}`;
    
    tr.innerHTML = `
      <td>
        <span class="view-mode-${cat.id}">${cat.name}</span>
        <input type="text" class="form-input edit-mode-${cat.id} hidden" value="${cat.name}" id="edit-table-cat-name-${cat.id}" style="width: 100%; max-width: 250px;" />
      </td>
      <td>
        <span class="view-mode-${cat.id}">${cat.count}</span>
        <input type="number" min="1" class="form-input edit-mode-${cat.id} hidden" value="${cat.count}" id="edit-table-cat-count-${cat.id}" style="width: 100%; max-width: 100px;" />
      </td>
      <td style="text-align: center;">
        <div class="view-mode-${cat.id} flex-row" style="justify-content: center; gap: 0.5rem;">
          <button class="btn btn--secondary btn--sm" onclick="editAdminTableCategory(${cat.id})">✏️ Edit</button>
          <button class="btn btn--danger btn--sm" onclick="deleteAdminTableCategory(${cat.id})">🗑️ Delete</button>
        </div>
        <div class="edit-mode-${cat.id} hidden flex-row" style="justify-content: center; gap: 0.5rem;">
          <button class="btn btn--success btn--sm" onclick="saveAdminTableCategoryEdit(${cat.id})">💾 Save</button>
          <button class="btn btn--outline btn--sm" onclick="cancelAdminTableCategoryEdit(${cat.id})">❌ Cancel</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function addAdminTableCategory() {
  const nameInput = document.getElementById('adminTableCategoryName');
  const countInput = document.getElementById('adminTableCategoryCount');
  if (!nameInput || !countInput) return;
  
  const name = nameInput.value.trim();
  const count = parseInt(countInput.value, 10);
  
  if (!name) return toast('Please enter a section name', 'error');
  if (isNaN(count) || count < 1) return toast('Please enter a valid table count (minimum 1)', 'error');
  
  let maxId = 0;
  if (POS_STATE.tableCategories && POS_STATE.tableCategories.length > 0) {
    POS_STATE.tableCategories.forEach(c => {
      if (c.id > maxId) maxId = c.id;
    });
  } else {
    POS_STATE.tableCategories = [];
  }
  
  const newCat = {
    id: maxId + 1,
    name: name,
    count: count
  };
  
  POS_STATE.tableCategories.push(newCat);
  
  // Calculate total tables
  let totalCount = 0;
  POS_STATE.tableCategories.forEach(c => {
    totalCount += c.count;
  });
  POS_STATE.tableCount = totalCount;
  
  try {
    await api({
      action: 'saveTableCategories',
      categoriesJson: JSON.stringify(POS_STATE.tableCategories)
    });
    
    // Clear form inputs
    nameInput.value = '';
    countInput.value = '';
    
    // Synchronize local table orders state with the updated category layout
    const serverOrders = await apiDirect({ action: 'getTablesData' });
    initializeLocalTableOrders(serverOrders);
    
    toast('Table section added', 'success');
    loadAdminTableCategories();
    invalidateLocalCache();
  } catch (e) {
    console.error(e);
    toast('Failed to add table section', 'error');
  }
}

function editAdminTableCategory(catId) {
  document.querySelectorAll(`.view-mode-${catId}`).forEach(el => el.classList.add('hidden'));
  document.querySelectorAll(`.edit-mode-${catId}`).forEach(el => el.classList.remove('hidden'));
}

function cancelAdminTableCategoryEdit(catId) {
  document.querySelectorAll(`.view-mode-${catId}`).forEach(el => el.classList.remove('hidden'));
  document.querySelectorAll(`.edit-mode-${catId}`).forEach(el => el.classList.add('hidden'));
  loadAdminTableCategories();
}

async function saveAdminTableCategoryEdit(catId) {
  const newName = document.getElementById(`edit-table-cat-name-${catId}`).value.trim();
  const newCount = parseInt(document.getElementById(`edit-table-cat-count-${catId}`).value, 10);
  
  if (!newName) return toast('Please enter a section name', 'error');
  if (isNaN(newCount) || newCount < 1) return toast('Please enter a valid table count (minimum 1)', 'error');
  
  const cat = POS_STATE.tableCategories.find(c => c.id === catId);
  if (!cat) return;
  
  cat.name = newName;
  cat.count = newCount;
  
  // Calculate total tables
  let totalCount = 0;
  POS_STATE.tableCategories.forEach(c => {
    totalCount += c.count;
  });
  POS_STATE.tableCount = totalCount;
  
  try {
    await api({
      action: 'saveTableCategories',
      categoriesJson: JSON.stringify(POS_STATE.tableCategories)
    });
    
    const serverOrders = await apiDirect({ action: 'getTablesData' });
    initializeLocalTableOrders(serverOrders);
    
    toast('Table section updated', 'success');
    loadAdminTableCategories();
    invalidateLocalCache();
  } catch (e) {
    console.error(e);
    toast('Failed to update table section', 'error');
  }
}

async function deleteAdminTableCategory(catId) {
  if (!confirm('Are you sure you want to delete this table section? All unoccupied table data in it will be lost.')) return;
  
  POS_STATE.tableCategories = POS_STATE.tableCategories.filter(c => c.id !== catId);
  
  // Calculate total tables
  let totalCount = 0;
  POS_STATE.tableCategories.forEach(c => {
    totalCount += c.count;
  });
  POS_STATE.tableCount = totalCount;
  
  try {
    await api({
      action: 'saveTableCategories',
      categoriesJson: JSON.stringify(POS_STATE.tableCategories)
    });
    
    const serverOrders = await apiDirect({ action: 'getTablesData' });
    initializeLocalTableOrders(serverOrders);
    
    toast('Table section deleted', 'success');
    loadAdminTableCategories();
    invalidateLocalCache();
  } catch (e) {
    console.error(e);
    toast('Failed to delete table section', 'error');
  }
}

function invalidateLocalCache() {
  localStorage.removeItem(CACHE_TIMESTAMP_KEY);
}

async function loadAdminCategories() {
  try {
    const res = await api({ action: 'getCategories' });
    POS_STATE.categories = res.categories || [];
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
  POS_STATE.flavoursMap = {}; // Clear POS flavours cache on any change
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
  renderBestSellers();
}
async function loadDashboardData() {
  const overlay = document.getElementById('dashboardLoadingOverlay');
  if (overlay) overlay.classList.add('active');

  const container = document.getElementById('kpiStrip');
  if (container && (!ALL_ENTRIES_CACHE || ALL_ENTRIES_CACHE.length === 0)) {
    container.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 2rem;"><span class="spinner" style="border-top-color:var(--brand-primary)"></span> Loading dashboard analytics...</div>';
  }
  try {
    // If cache is empty, download cache first
    if (!ALL_ENTRIES_CACHE || ALL_ENTRIES_CACHE.length === 0) {
      await downloadSheetCache(true);
      ALL_ENTRIES_CACHE = getCacheItem('getAllEntries') || [];
    }
    
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
    
    if (ADMIN_DATA) {
      ADMIN_DATA.todayCount = todayCount;
      ADMIN_DATA.todayAmount = todayAmount;
      
      // Also override total Amount overall
      let totalAmt = 0;
      ALL_ENTRIES_CACHE.forEach(e => totalAmt += (e.amount || 0));
      const totalLength = ALL_ENTRIES_CACHE.length;
      ADMIN_DATA.avgBilling = totalLength > 0 ? Math.round(totalAmt / totalLength) : 0;
      
      // Update overall totals
      ADMIN_DATA.totalVisits = Math.max(ADMIN_DATA.totalVisits, totalLength);
    }

    renderAllDashboardComponents();
  } catch (e) {
    console.error('Failed to load dashboard data', e);
    if (container) {
      container.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--danger); padding: 2rem;">Error loading dashboard data.</div>';
    }
  } finally {
    // Hide overlay with a smooth transition
    setTimeout(() => {
      if (overlay) overlay.classList.remove('active');
    }, 600);
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
    POS_STATE.tableCount = res.count || 0;
    POS_STATE.tableCategories = res.categories || [];
    loadAdminTableCategories();
  } catch(e) {
    console.error('Failed to load table count in POS configuration', e);
  }

  // Prefill Loyalty Reward Settings inputs from current APP_CONFIG
  const inputMinAmount = document.getElementById('adminMinAmount');
  const inputCycle = document.getElementById('adminCycle');
  const inputRewardValue = document.getElementById('adminRewardValue');
  if (APP_CONFIG) {
    if (inputMinAmount) inputMinAmount.value = APP_CONFIG.minAmount !== undefined ? APP_CONFIG.minAmount : '';
    if (inputCycle) inputCycle.value = APP_CONFIG.cycle !== undefined ? APP_CONFIG.cycle : '';
    if (inputRewardValue) inputRewardValue.value = APP_CONFIG.rewardValue !== undefined ? APP_CONFIG.rewardValue : '';
  }

  // Sync reward system toggle state
  syncRewardToggleUI();

  // Load and render theme preset selection
  renderAdminThemePresets();
}

function syncRewardToggleUI() {
  const toggle = document.getElementById('adminRewardToggle');
  const badge = document.getElementById('rewardStatusBadge');
  if (!toggle || !badge) return;

  const isOn = APP_CONFIG ? APP_CONFIG.rewardSystemOn !== false : true;
  toggle.checked = isOn;
  badge.textContent = isOn ? '● Reward System is ON' : '● Reward System is OFF';
  badge.className = 'reward-status-badge ' + (isOn ? 'reward-status-on' : 'reward-status-off');
}

async function handleAdminToggleRewardSystem(checkbox) {
  const newStatus = checkbox.checked ? 1 : 0;
  const badge = document.getElementById('rewardStatusBadge');

  // Optimistic UI update
  if (badge) {
    badge.textContent = checkbox.checked ? '● Reward System is ON' : '● Reward System is OFF';
    badge.className = 'reward-status-badge ' + (checkbox.checked ? 'reward-status-on' : 'reward-status-off');
  }

  try {
    const result = await api({ action: 'updateRewardToggle', status: newStatus });
    if (result.error) {
      toast('Failed to update: ' + result.error, 'error');
      // Revert
      checkbox.checked = !checkbox.checked;
      syncRewardToggleUI();
      return;
    }

    // Update local config
    if (APP_CONFIG) {
      APP_CONFIG.rewardSystemOn = result.rewardSystemOn;
    }
    toast(result.rewardSystemOn ? '🎁 Reward System enabled!' : '🧾 Reward System disabled — bill-only mode active.', 'success');
  } catch (e) {
    toast('Error updating toggle: ' + e.message, 'error');
    // Revert on failure
    checkbox.checked = !checkbox.checked;
    syncRewardToggleUI();
  }
}

async function saveAdminRewardConfig() {
  const inputMinAmount = document.getElementById('adminMinAmount');
  const inputCycle = document.getElementById('adminCycle');
  const inputRewardValue = document.getElementById('adminRewardValue');
  const btn = document.getElementById('btnUpdateRewardConfig');

  if (!inputMinAmount || !inputCycle || !inputRewardValue) return;

  const minAmount = parseFloat(inputMinAmount.value);
  const cycle = parseInt(inputCycle.value, 10);
  const rewardValue = parseFloat(inputRewardValue.value);

  if (isNaN(minAmount) || minAmount < 0) {
    toast('Minimum Bill Amount must be a positive number.', 'error');
    return;
  }
  if (isNaN(cycle) || cycle < 1) {
    toast('Visits Cycle Length must be at least 1.', 'error');
    return;
  }
  if (isNaN(rewardValue) || rewardValue < 0) {
    toast('Reward Valuation Amount must be a positive number.', 'error');
    return;
  }

  // Set button loading state
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  try {
    const res = await apiDirect({
      action: 'updateRewardConfig',
      minAmount: minAmount,
      cycle: cycle,
      rewardValue: rewardValue
    });

    if (res.error) {
      toast('Failed to update config: ' + res.error, 'error');
      return;
    }

    // Update in-memory config
    if (!APP_CONFIG) APP_CONFIG = {};
    APP_CONFIG.minAmount = res.minAmount;
    APP_CONFIG.cycle = res.cycle;
    APP_CONFIG.rewardValue = res.rewardValue;

    // Overwrite the local cache for getConfig
    setCacheItem('getConfig', APP_CONFIG);

    // Refresh UI label
    const label = document.getElementById('minAmtLabel');
    if (label) {
      label.textContent = res.minAmount;
    }

    toast('🎉 Loyalty settings updated successfully!', 'success');

    // Trigger dashboard and cache update in the background silently
    downloadSheetCache(true);
  } catch (err) {
    toast('Network error saving settings: ' + err.message, 'error');
    console.error(err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Save Configurations';
    }
  }
}

/* ══════════════════════════════════════════════════
   THIRD-PARTY INTEGRATION DOCK (resturant_partner)
═════════════════════════════════════════════════════ */

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('open');
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('open');
    modal.classList.add('hidden');
  }
}

let INTEGRATION_LINKS = [];
let splitCurrentWidth = 40; // Default width percentage for the iframe panel

async function fetchIntegrationLinks() {
  try {
    const res = await api({ action: 'getIntegrationLinks' });
    if (res.links) {
      INTEGRATION_LINKS = res.links;
      renderIntegrationDock();
    }
  } catch (err) {
    console.error('Failed to fetch integration links', err);
  }
}

function renderIntegrationDock() {
  const dock = document.getElementById('integrationDock');
  if (!dock) return;
  
  let html = '';
  INTEGRATION_LINKS.forEach(link => {
    // Generate a favicon URL from Google's service
    const iconUrl = `https://www.google.com/s2/favicons?domain=${link.url}&sz=64`;
    html += `
      <button class="dock-btn" onclick="openIntegration('${link.name}', '${link.url}')" title="${link.name}">
        <img src="${iconUrl}" alt="${link.name}" onerror="this.src=''; this.onerror=null; this.alt='🌐';">
      </button>
    `;
  });
  
  // Plus Button for Custom Websites
  html += `
    <button class="dock-btn" onclick="openModal('modalAddIntegration')" title="Add Custom Website">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
    </button>
  `;
  
  dock.innerHTML = html;
  
  // Also update the split-view header dropdown select if it exists
  const select = document.getElementById('splitIntegrationSelect');
  const activeTitle = (select && document.getElementById('splitIntegration')?.classList.contains('open'))
    ? (select.options[select.selectedIndex]?.text || '')
    : '';
  updateSplitIntegrationSelect(activeTitle);
}

function updateSplitIntegrationSelect(activeName) {
  const select = document.getElementById('splitIntegrationSelect');
  if (!select) return;
  
  let html = '';
  INTEGRATION_LINKS.forEach(link => {
    const selected = link.name === activeName ? 'selected' : '';
    html += `<option value="${link.url}" ${selected}>${link.name}</option>`;
  });
  select.innerHTML = html;
}

function handleSplitSelectChange(selectElem) {
  const url = selectElem.value;
  const name = selectElem.options[selectElem.selectedIndex].text;
  openIntegration(name, url);
}

function openIntegration(name, url) {
  document.body.classList.add('split-active');
  
  const iframe = document.getElementById('splitIframe');
  const splitTitle = document.getElementById('splitTitle');
  const splitContainer = document.getElementById('splitIntegration');
  
  if (splitTitle) splitTitle.textContent = name;
  if (iframe) iframe.src = url;
  
  updateSplitIntegrationSelect(name);
  
  // Apply calculated width dynamically
  const widthPx = window.innerWidth * (splitCurrentWidth / 100);
  
  if (splitContainer) {
    splitContainer.style.width = `${widthPx}px`;
    splitContainer.classList.add('open');
  }
  
  // Shrink the main body to accommodate the fixed split pane
  document.body.style.paddingRight = `${widthPx}px`;
  document.body.style.setProperty('--split-width', `${widthPx}px`);
  
  // Update responsive bottom navigation
  updateNavDockResponsive();
}

function closeIntegration() {
  document.body.classList.remove('split-active');
  const splitContainer = document.getElementById('splitIntegration');
  if (splitContainer) splitContainer.classList.remove('open');
  document.body.style.paddingRight = '0px';
  document.body.style.setProperty('--split-width', '0px');
  
  const iframe = document.getElementById('splitIframe');
  if (iframe) iframe.src = ''; // stop rendering/media
  
  // Update responsive bottom navigation
  updateNavDockResponsive();
}

function reloadIntegration() {
  const iframe = document.getElementById('splitIframe');
  if (iframe && iframe.src) {
    // Force reload by resetting the src
    const currentSrc = iframe.src;
    iframe.src = '';
    setTimeout(() => { iframe.src = currentSrc; }, 50);
  }
}

function openIntegrationNewTab() {
  const iframe = document.getElementById('splitIframe');
  if (iframe && iframe.src) {
    window.open(iframe.src, '_blank');
  }
}

async function handleAddIntegrationSubmit() {
  const nameInput = document.getElementById('inputIntegrationName');
  const urlInput = document.getElementById('inputIntegrationUrl');
  
  if (!nameInput || !urlInput) return;
  
  const name = nameInput.value.trim();
  let url = urlInput.value.trim();
  
  if (!name || !url) {
    toast('Please enter both name and URL', 'error');
    return;
  }
  
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  
  const btn = document.getElementById('btnSaveIntegration');
  const originalText = btn.innerText;
  btn.innerText = 'Saving...';
  btn.disabled = true;
  
  try {
    const res = await api({ action: 'addIntegrationLink', name, url });
    if (res.success) {
      toast('Website added successfully', 'success');
      closeModal('modalAddIntegration');
      nameInput.value = '';
      urlInput.value = '';
      
      // Optimistic update
      INTEGRATION_LINKS.push({ name, url });
      renderIntegrationDock();
    } else {
      toast(res.error || 'Failed to add website', 'error');
    }
  } catch(e) {
    console.error(e);
    toast('Error saving website', 'error');
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

// Split Pane Resizer Logic
function initResizer() {
  const divider = document.getElementById('splitDivider');
  const splitContainer = document.getElementById('splitIntegration');
  if (!divider || !splitContainer) return;
  
  let isDragging = false;
  
  const onDrag = (e) => {
    if (!isDragging) return;
    
    e.preventDefault();
    
    // Calculate new width from right side
    const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    const newWidth = window.innerWidth - clientX;
    
    // Constraint width (min 300px, max 80vw)
    const minW = 300;
    const maxW = window.innerWidth * 0.8;
    
    const finalW = Math.max(minW, Math.min(newWidth, maxW));
    
    // Update percentage state
    splitCurrentWidth = (finalW / window.innerWidth) * 100;
    
    splitContainer.style.width = `${finalW}px`;
    document.body.style.paddingRight = `${finalW}px`;
    document.body.style.setProperty('--split-width', `${finalW}px`);
    updateNavDockResponsive();
  };
  
  const onStopDrag = () => {
    if (isDragging) {
      isDragging = false;
      document.body.classList.remove('dragging');
      splitContainer.classList.remove('dragging');
      divider.classList.remove('dragging');
      
      // We also add pointer-events: none to iframe while dragging to prevent iframe from swallowing mouse events
      const iframe = document.getElementById('splitIframe');
      if (iframe) iframe.style.pointerEvents = 'auto';
      
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', onStopDrag);
      document.removeEventListener('touchmove', onDrag);
      document.removeEventListener('touchend', onStopDrag);
    }
  };
  
  const onStartDrag = (e) => {
    isDragging = true;
    document.body.classList.add('dragging');
    splitContainer.classList.add('dragging');
    divider.classList.add('dragging');
    
    const iframe = document.getElementById('splitIframe');
    if (iframe) iframe.style.pointerEvents = 'none';
    
    document.addEventListener('mousemove', onDrag, { passive: false });
    document.addEventListener('mouseup', onStopDrag);
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend', onStopDrag);
  };
  
  divider.addEventListener('mousedown', onStartDrag);
  divider.addEventListener('touchstart', onStartDrag, { passive: true });

  const navItems = document.querySelectorAll('.admin-nav-item');
  navItems.forEach(item => {
    item.classList.remove('active');
  });

  // Activate selected panel & button
  const activePanel = document.getElementById(tabId);
  if (activePanel) {
    activePanel.classList.add('active');
  }
  if (btn) {
    btn.classList.add('active');
  }
}

