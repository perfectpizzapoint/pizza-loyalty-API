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

/** API call helper */
async function api(params) {
  const qs = new URLSearchParams(params).toString();
  const url = API_URL + '?' + qs;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('Network error');
  return res.json();
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
  document.getElementById('sectionAdmin').classList.remove('active');
  document.getElementById('sectionPos').classList.remove('active');
  document.getElementById('navHome').classList.remove('active');
  document.getElementById('navAdmin').classList.remove('active');
  document.getElementById('navPos').classList.remove('active');

  let activeBtn;
  if (name === 'admin') {
    document.getElementById('sectionAdmin').classList.add('active');
    activeBtn = document.getElementById('navAdmin');
    activeBtn.classList.add('active');
    // Always require re-auth when opening admin
    ADMIN_AUTHENTICATED = false;
    show('adminLoginWrap');
    hide('adminDashboard');
    document.getElementById('adminUser').value = '';
    document.getElementById('adminPass').value = '';
    hideErr('errLogin');
  } else if (name === 'pos') {
    document.getElementById('sectionPos').classList.add('active');
    activeBtn = document.getElementById('navPos');
    activeBtn.classList.add('active');
    initPos();
  } else {
    document.getElementById('sectionHome').classList.add('active');
    activeBtn = document.getElementById('navHome');
    activeBtn.classList.add('active');
  }
  
  updateNavIndicator(activeBtn);
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
});

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

    // If entry already exists for today → block saving
    const todayDate = istDateStr();
    if (cust.found && cust.lastVisitDate === todayDate) {
      toast('Entry already added today. You can generate a receipt without adding an entry.', 'info');
      const btnSave = document.getElementById('btnSaveEntry');
      btnSave.disabled = true;
      btnSave.innerHTML = '🚫 Already Added Today';
      
      const btnReceipt = document.getElementById('btnReceiptOnly');
      btnReceipt.style.display = ''; // Show Receipt Only button
      
      return;
    }

    // If customer needs to claim reward first → swap buttons
    const cycle = APP_CONFIG ? APP_CONFIG.cycle : 10;
    const needsClaim = cust.found && cust.eligible &&
      cust.rewardsClaimed < cust.totalEntries / cycle;

    if (needsClaim) {
      const btnSave = document.getElementById('btnSaveEntry');
      const btnClaim = document.getElementById('btnClaimForce');
      btnSave.style.display = 'none';
      btnClaim.style.display = '';
      toast('🎁 Customer must claim reward before new entry!', 'info');
      show('rowDetailsBtn');
    }
  } catch (e) {
    console.error('Background duplicate check failed', e);
  }
}

function openEntryForm(mobile, cust) {
  document.getElementById('dispMobile').value = mobile;
  document.getElementById('dispDate').value = istDateStr();
  document.getElementById('dispTime').value = istTimeStr();
  
  if (window.PENDING_POS_TOTAL) {
    document.getElementById('inputAmount').value = window.PENDING_POS_TOTAL;
    window.PENDING_POS_TOTAL = null;
  } else {
    document.getElementById('inputAmount').value = '';
  }
  
  document.getElementById('inputMessage').value = 'Thank You, Visit Again';  // default message
  hideErr('errAmount');
  hide('rowWhatsapp');
  hide('rowDetailsBtn');

  const cycle = APP_CONFIG ? APP_CONFIG.cycle : 10;

  // Check if this customer needs to claim reward BEFORE adding entry
  const needsClaim = cust.found && cust.eligible &&
    cust.rewardsClaimed < cust.totalEntries / cycle;

  const btnSave = document.getElementById('btnSaveEntry');
  const btnClaim = document.getElementById('btnClaimForce');

  // ── Reset Save button for every new entry (fix #5) ──
  btnSave.disabled = false;
  btnSave.innerHTML = '💾 Save Entry';
  btnSave.style.display = '';
  
  const btnReceipt = document.getElementById('btnReceiptOnly');
  btnReceipt.style.display = 'none';

  if (needsClaim) {
    btnSave.style.display = 'none';
    btnClaim.style.display = '';
    toast('🎁 Customer must claim reward before new entry!', 'info');
    show('rowDetailsBtn');
  } else {
    btnClaim.style.display = 'none';
  }

  show('cardEntryForm');
  document.getElementById('inputAmount').focus();
}

function closeEntryForm() {
  hide('cardEntryForm');
  CURRENT_CUSTOMER = null;
  LAST_ENTRY_RESULT = null;
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

  // ── Background: persist to Google Sheets (original flow) ──
  try {
    const result = await api({ action: 'addEntry', mobile, amount, date, time, message });
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

  } catch (e) {
    toast('Error saving: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '💾 Save Entry';
  }
}

// ──── RECEIPT ONLY (NO DB SAVE) ────
function handleReceiptOnly() {
  const mobile = document.getElementById('dispMobile').value;
  const amount = parseInt(document.getElementById('inputAmount').value, 10);
  const message = document.getElementById('inputMessage').value.trim();
  const minAmt = APP_CONFIG ? APP_CONFIG.minAmount : 100;

  hideErr('errAmount');
  if (isNaN(amount) || amount < minAmt) {
    showErr('errAmount');
    document.getElementById('inputAmount').classList.add('error');
    return;
  }
  document.getElementById('inputAmount').classList.remove('error');

  // Build the WhatsApp link using the current customer's data, without adding a new entry
  buildWhatsAppLink(CURRENT_CUSTOMER, mobile, amount, message);
  show('rowWhatsapp');
  show('rowDetailsBtn');
}

// ──── WHATSAPP LINK ────
function buildWhatsAppLink(result, mobile, amount, message) {
  const template = WHATSAPP_TEMPLATE;
  const cycle    = result.cycle || (APP_CONFIG ? APP_CONFIG.cycle : 10);
  const total    = result.totalEntries;

  // cyclePosition
  const mod = total % cycle;
  const cyclePosition = mod === 0 ? cycle : mod;
  const completedVisit = cyclePosition + '/' + cycle;

  // loyalty link
  const loyaltyNum = mod === 0 ? cycle : cyclePosition;
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

    // Now allow adding entry
    const btnSave = document.getElementById('btnSaveEntry');
    btnSave.style.display = '';
    btnSave.disabled = false;
    btnSave.innerHTML = '💾 Save Entry';

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
    // Step 1: Verify credentials against Sheet 3
    const authResult = await api({ action: 'getAdminCreds', inputUser: user, inputPass: pass });

    if (!authResult.authenticated) {
      showErr('errLogin');
      btn.disabled = false;
      btn.innerHTML = 'Login';
      return;
    }

    // Step 2: Fetch admin dashboard data
    ADMIN_AUTHENTICATED = true;
    ADMIN_DATA = await api({ action: 'getAdminData' });

    hide('adminLoginWrap');
    show('adminDashboard');
    renderAdminDashboard(ADMIN_DATA);
    toast('Welcome, Admin! 🎉', 'success');
  } catch (e) {
    toast('Login error: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.innerHTML = 'Login';
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
let heatmapType = 'entries';

function setHeatmapType(type, btn) {
  heatmapType = type;
  document.querySelectorAll('#heatmapToggle .toggle-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

async function calculateHeatmap() {
  const btn = document.getElementById('btnCalcHeatmap');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Calculating…';

  try {
    const type = heatmapType === 'amount' ? 'amount' : 'entries';
    const data = await api({ action: 'getHeatmapData', type });
    renderHeatmap(data.matrix);
    toast('Heatmap calculated!', 'success');
  } catch (e) {
    toast('Heatmap error: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.innerHTML = '🔄 Calculate Heatmap';
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

async function calculateTimeBetweenVisits() {
  const btn = document.getElementById('btnCalcTBV');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Calculating…';

  try {
    const data = await api({ action: 'getTimeBetweenVisits' });
    show('tbvContainer');

    const statsGrid = document.getElementById('tbvStats');
    statsGrid.innerHTML = [
      { label: 'Avg Gap', value: data.avg + ' days' },
      { label: 'Min Gap', value: data.min + ' days' },
      { label: 'Max Gap', value: data.max + ' days' },
      { label: 'Total Pairs', value: data.totalGaps || 0 },
    ].map(s =>
      '<div class="stat-card"><div class="stat-card__value">' + s.value +
      '</div><div class="stat-card__label">' + s.label + '</div></div>'
    ).join('');

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
    toast('Time-between-visits calculated!', 'success');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.innerHTML = '🔄 Calculate';
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
  tableOrders: JSON.parse(localStorage.getItem('ppp_tableOrders') || '{}')
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
  showPosTables();
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
    const hasOrder = POS_STATE.tableOrders[i] && Object.values(POS_STATE.tableOrders[i]).some(d => d.qty > 0);
    const indicator = hasOrder ? ' 🔵' : '';
    
    card.innerHTML = `
      <div class="table-icon">🪑</div>
      <div class="table-name">Table ${i}${indicator}</div>
    `;
    grid.appendChild(card);
  }
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
    const res = await api({ action: 'getDishes', parentIndex: catIndex });
    POS_STATE.dishes = res.dishes || [];
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
    const dishKey = `dish-${dish.rowIndex}`; // Using row index as unique ID
    const currentQty = order[dishKey] ? order[dishKey].qty : 0;
    
    const card = document.createElement('div');
    card.className = 'pos-dish-card';
    card.innerHTML = `
      <div>
        <div class="pos-dish-name">${dish.name}</div>
        <div class="pos-dish-price">₹${dish.amount}</div>
      </div>
      <div class="qty-selector">
        <button class="qty-btn" onclick="updateDishQty('${dishKey}', '${dish.name}', ${dish.amount}, -1)">-</button>
        <div class="qty-display" id="qty-${dishKey}">${currentQty}</div>
        <button class="qty-btn" onclick="updateDishQty('${dishKey}', '${dish.name}', ${dish.amount}, 1)">+</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function updateDishQty(dishKey, name, price, delta) {
  const order = POS_STATE.tableOrders[POS_STATE.currentTableId];
  
  if (!order[dishKey]) {
    order[dishKey] = { name, price, qty: 0 };
  }
  
  let newQty = order[dishKey].qty + delta;
  if (newQty < 0) newQty = 0;
  
  order[dishKey].qty = newQty;
  document.getElementById(`qty-${dishKey}`).textContent = newQty;
  
  localStorage.setItem('ppp_tableOrders', JSON.stringify(POS_STATE.tableOrders));
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
  
  // Save total for loyalty form pre-fill
  window.PENDING_POS_TOTAL = POS_STATE.currentBillTotal;
  
  // Clear the table order
  POS_STATE.tableOrders[POS_STATE.currentTableId] = {};
  localStorage.setItem('ppp_tableOrders', JSON.stringify(POS_STATE.tableOrders));
  
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
    tbody.innerHTML = '';
    select.innerHTML = '<option value="">-- Select Category --</option>';
    
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

async function editAdminDish(rowIndex, oldName, oldAmount) {
  const newName = prompt('Enter new dish name:', oldName);
  if (!newName) return;
  const newAmount = prompt('Enter new dish price (₹):', oldAmount);
  if (!newAmount || isNaN(parseInt(newAmount, 10))) return;
  
  try {
    await api({ action: 'updateDish', rowIndex, newName: newName.trim(), newAmount: parseInt(newAmount, 10) });
    toast('Dish updated', 'success');
    loadAdminDishes();
  } catch(e) {
    toast('Failed to update dish', 'error');
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

// Hooking into renderAdminDashboard
const originalRenderAdminDashboard = renderAdminDashboard;
renderAdminDashboard = async function(data) {
  originalRenderAdminDashboard(data);
  // Load POS admin stuff
  loadAdminCategories();
  try {
    const res = await api({ action: 'getTableCount' });
    document.getElementById('adminTableCount').value = res.count || '';
    POS_STATE.tableCount = res.count || 0;
  } catch(e) {}
};
