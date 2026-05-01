// ============================================================
// Perfect Pizza Point - Frontend Logic
// ============================================================

// ⚠️ IMPORTANT: Set your deployed Google Apps Script Web App URL here
const API_URL = "https://script.google.com/macros/s/AKfycbzfcThwO6xpJ0FRACtR3toOkl9SToRUnP8kESQ17Y19AQiVmWz6LmHz-WBdn5rUHd3w/exec";

// ===== STATE =====
let appConfig = null;
let currentMobile = "";
let currentCustomerData = null;
let adminCharts = {};
let adminLoggedIn = false;

// ===== HELPERS =====
function getISTNow() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist;
}

function getISTDate() {
  const ist = getISTNow();
  return ist.getUTCFullYear() + '-' +
    String(ist.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(ist.getUTCDate()).padStart(2, '0');
}

function getISTTime() {
  const ist = getISTNow();
  return String(ist.getUTCHours()).padStart(2, '0') + ':' +
    String(ist.getUTCMinutes()).padStart(2, '0') + ':' +
    String(ist.getUTCSeconds()).padStart(2, '0');
}

function showToast(message, type = "") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "toast" + (type ? " " + type : "");
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => toast.classList.remove("show"), 3200);
}

async function apiCall(action, params = {}) {
  const url = new URL(API_URL);
  url.searchParams.set("action", action);
  for (const key in params) {
    url.searchParams.set(key, params[key]);
  }
  try {
    const resp = await fetch(url.toString());
    const data = await resp.json();
    return data;
  } catch (err) {
    return { success: false, error: "Network error: " + err.message };
  }
}

// ===== THEME TOGGLE =====
(function initTheme() {
  const saved = localStorage.getItem("ppp_theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  updateThemeIcon(saved);
})();

function updateThemeIcon(theme) {
  const icon = document.getElementById("themeIcon");
  if (icon) icon.textContent = theme === "dark" ? "☀️" : "🌙";
}

document.getElementById("themeToggle").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("ppp_theme", next);
  updateThemeIcon(next);
});

// ===== TABS =====
function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.getElementById(tab === "entry" ? "tabEntry" : "tabAdmin").classList.add("active");
  document.getElementById("entrySection").classList.toggle("hidden", tab !== "entry");
  document.getElementById("adminSection").classList.toggle("hidden", tab !== "admin");
  if (tab === "admin" && adminLoggedIn) loadAdminData();
}

document.getElementById("tabEntry").addEventListener("click", () => switchTab("entry"));

document.getElementById("tabAdmin").addEventListener("click", () => {
  // Always require re-authentication when admin panel is accessed
  document.getElementById("adminLoginModal").classList.remove("hidden");
  document.getElementById("adminUser").value = "";
  document.getElementById("adminPass").value = "";
  document.getElementById("adminLoginError").textContent = "";
  document.getElementById("adminUser").focus();
});

// ===== ADMIN LOGIN MODAL =====
document.getElementById("adminLoginClose").addEventListener("click", () => {
  document.getElementById("adminLoginModal").classList.add("hidden");
  document.getElementById("adminLoginError").textContent = "";
  document.getElementById("adminUser").value = "";
  document.getElementById("adminPass").value = "";
});

document.getElementById("adminLoginModal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("adminLoginModal")) {
    document.getElementById("adminLoginClose").click();
  }
});

document.getElementById("adminLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = document.getElementById("adminUser").value.trim();
  const pass = document.getElementById("adminPass").value.trim();
  const errEl = document.getElementById("adminLoginError");
  const btn = document.getElementById("adminLoginBtn");

  if (!user || !pass) {
    errEl.textContent = "Please fill in both fields.";
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Verifying...';
  errEl.textContent = "";

  const result = await apiCall("login", { username: user, password: pass });

  if (result.success) {
    adminLoggedIn = true;

    // Fetch and cache config
    const configResult = await apiCall("getConfig");
    if (configResult.success) appConfig = configResult;

    document.getElementById("adminLoginModal").classList.add("hidden");
    document.getElementById("logoutBtn").classList.remove("hidden");
    document.getElementById("adminUser").value = "";
    document.getElementById("adminPass").value = "";
    switchTab("admin");
    showToast("Admin access granted 🔓", "success");
  } else {
    errEl.textContent = result.error || "Login failed.";
  }

  btn.disabled = false;
  btn.innerHTML = "🔐 Login";
});

// ===== LOGOUT =====
document.getElementById("logoutBtn").addEventListener("click", () => {
  adminLoggedIn = false;
  document.getElementById("logoutBtn").classList.add("hidden");
  switchTab("entry");
  showToast("Logged out successfully.");
});

// ===== NO SESSION RESTORE — Admin must re-authenticate every time =====

// ===== ADD ENTRY BUTTON =====
// Single optimized API call (checkMobile + getCustomerData combined)
document.getElementById("addEntryBtn").addEventListener("click", async () => {
  const mobile = document.getElementById("mobileInput").value.trim();
  const errEl = document.getElementById("mobileError");
  errEl.textContent = "";

  if (!/^\d{10}$/.test(mobile)) {
    errEl.textContent = "Please enter exactly 10 digits.";
    return;
  }

  const btn = document.getElementById("addEntryBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  // Single combined API call — replaces two sequential calls for speed
  const result = await apiCall("openCustomer", { mobile });

  btn.disabled = false;
  btn.innerHTML = "Add Entry";

  if (!result.success) {
    errEl.textContent = result.error || "Error loading customer data.";
    return;
  }

  // Clear mobile input for next entry
  document.getElementById("mobileInput").value = "";

  currentMobile = mobile;
  currentCustomerData = result;

  // Cache config from response
  appConfig = appConfig || {};
  appConfig.cycle = result.cycle;
  appConfig.rewardValue = result.rewardValue;
  appConfig.minAmount = result.minAmount;

  // ===== POINT 8: Gift popup for eligible customers =====
  if (result.eligible) {
    openGiftModal(result);
  } else {
    openCustomerModal(result);
  }
});

// Enter key on mobile input
document.getElementById("mobileInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("addEntryBtn").click();
  }
});

// Only numeric input
document.getElementById("mobileInput").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
});

// ===== GIFT MODAL =====
function openGiftModal(data) {
  document.getElementById("giftMobileDisplay").textContent = currentMobile;
  document.getElementById("giftValueDisplay").textContent = "₹" + (data.rewardValue || 150);
  document.getElementById("giftError").textContent = "";

  const claimBtn = document.getElementById("claimGiftBtn");
  claimBtn.disabled = false;
  claimBtn.innerHTML = "🎉 Claim Free Meal Now";

  document.getElementById("giftModal").classList.remove("hidden");
}

document.getElementById("claimGiftBtn").addEventListener("click", async () => {
  const btn = document.getElementById("claimGiftBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Claiming...';
  document.getElementById("giftError").textContent = "";

  const result = await apiCall("claimReward", { mobile: currentMobile });

  if (result.success) {
    showToast("Reward claimed! 🎁🎉", "success");

    // Update customer data with claimed state
    currentCustomerData.rewardsClaimed = result.rewardsClaimed;
    currentCustomerData.eligible = result.eligible;
    currentCustomerData.totalEntries = result.totalEntries;

    document.getElementById("giftModal").classList.add("hidden");

    // Open normal entry modal so they can log today's visit
    openCustomerModal(currentCustomerData);
  } else {
    document.getElementById("giftError").textContent = result.error || "Failed to claim reward.";
    btn.disabled = false;
    btn.innerHTML = "🎉 Claim Free Meal Now";
  }
});

// Close gift modal via X button
document.getElementById("giftCloseBtn").addEventListener("click", () => {
  document.getElementById("giftModal").classList.add("hidden");
  openCustomerModal(currentCustomerData);
});

// Close gift modal via overlay click
document.getElementById("giftModal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("giftModal")) {
    document.getElementById("giftModal").classList.add("hidden");
    openCustomerModal(currentCustomerData);
  }
});

// ===== CUSTOMER MODAL =====
function openCustomerModal(data) {
  const modal = document.getElementById("customerModal");
  modal.classList.remove("hidden");

  document.getElementById("modalMobile").textContent = currentMobile;

  // Build dot visualization
  buildDots(data.totalEntries, data.cycle, data.rewardsClaimed);

  // Rewards emojis
  const rewardsSection = document.getElementById("rewardsSection");
  const rewardsDisplay = document.getElementById("rewardsDisplay");
  if (data.rewardsClaimed > 0) {
    rewardsSection.style.display = "";
    rewardsDisplay.innerHTML = "";
    for (let i = 0; i < data.rewardsClaimed; i++) {
      const span = document.createElement("span");
      span.className = "reward-emoji";
      span.textContent = "🎁";
      span.style.animationDelay = (i * 0.1) + "s";
      rewardsDisplay.appendChild(span);
    }
  } else {
    rewardsSection.style.display = "none";
  }

  // Eligibility (post-claim eligible state means save is still allowed)
  const banner = document.getElementById("eligibilityBanner");
  const saveBtn = document.getElementById("saveEntryBtn");

  banner.style.display = "";
  if (data.eligible) {
    banner.className = "eligibility-banner eligible";
    banner.textContent = "🎉 Eligible for FREE meal (up to ₹" + (data.rewardValue || 150) + ")!";
    saveBtn.disabled = false;
    saveBtn.title = "";
  } else {
    banner.className = "eligibility-banner not-eligible";
    const pos = data.totalEntries % data.cycle;
    const remaining = pos === 0 ? data.cycle : data.cycle - pos;
    banner.textContent = remaining + " more visit" + (remaining !== 1 ? "s" : "") + " to earn a free meal!";
    saveBtn.disabled = false;
    saveBtn.title = "";
  }

  // Reset form
  document.getElementById("dateInput").value = getISTDate();
  document.getElementById("timeInput").value = getISTTime();
  document.getElementById("amountInput").value = "";
  document.getElementById("messageInput").value = "";
  document.getElementById("formError").textContent = "";
  document.getElementById("whatsappSection").style.display = "none";
  document.getElementById("entriesList").classList.add("hidden");
  document.getElementById("showDetailsBtn").textContent = "📜 Show Past Entry Details";
  document.getElementById("entryForm").style.display = "";
  saveBtn.innerHTML = "💾 Save Entry";

  buildPastEntries(data.entries || []);
}

function buildDots(totalEntries, cycle, rewardsClaimed) {
  const section = document.getElementById("dotsSection");
  const label = section.querySelector('.dots-section-label');
  section.innerHTML = '';
  section.appendChild(label);

  const completedCycles = Math.floor(totalEntries / cycle);
  const totalRows = completedCycles + (totalEntries % cycle > 0 || totalEntries === 0 ? 1 : 0);

  for (let row = 0; row < totalRows; row++) {
    const dotRow = document.createElement("div");
    dotRow.className = "dot-row";

    const rowLabel = document.createElement("div");
    rowLabel.className = "dot-row-label";
    const startNum = row * cycle + 1;
    const endNum = (row + 1) * cycle;
    rowLabel.textContent = "Visits " + startNum + "–" + endNum;
    dotRow.appendChild(rowLabel);

    for (let d = 0; d < cycle; d++) {
      const dot = document.createElement("div");
      dot.className = "dot";
      const entryNum = row * cycle + d + 1;
      if (entryNum <= totalEntries) {
        dot.classList.add("filled");
        if ((entryNum % cycle === 0) && (entryNum / cycle <= rewardsClaimed)) {
          dot.classList.add("reward-dot");
        }
      }
      dotRow.appendChild(dot);
    }
    section.appendChild(dotRow);
  }
}

function buildPastEntries(entries) {
  const list = document.getElementById("entriesList");
  list.innerHTML = "";
  if (entries.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:12px">No past entries yet. This is a new customer!</p>';
    return;
  }
  const reversed = [...entries].reverse();
  for (const entry of reversed) {
    const item = document.createElement("div");
    item.className = "entry-item";
    item.innerHTML =
      '<span>#</span><span>' + entry.index + '</span>' +
      '<span>Mobile</span><span>' + entry.mobile + '</span>' +
      '<span>Amount</span><span>₹' + entry.amount + '</span>' +
      '<span>Date</span><span>' + entry.date + '</span>' +
      '<span>Time</span><span>' + entry.time + '</span>' +
      '<span>Message</span><span>' + (entry.message || '—') + '</span>';
    list.appendChild(item);
  }
}

document.getElementById("showDetailsBtn").addEventListener("click", () => {
  const list = document.getElementById("entriesList");
  const btn = document.getElementById("showDetailsBtn");
  if (list.classList.contains("hidden")) {
    list.classList.remove("hidden");
    btn.textContent = "📜 Hide Past Entry Details";
  } else {
    list.classList.add("hidden");
    btn.textContent = "📜 Show Past Entry Details";
  }
});

// ===== SAVE ENTRY =====
document.getElementById("saveEntryBtn").addEventListener("click", async () => {
  const amount = document.getElementById("amountInput").value.trim();
  const message = document.getElementById("messageInput").value.trim();
  const errEl = document.getElementById("formError");
  errEl.textContent = "";

  const minAmount = (appConfig && appConfig.minAmount) || 100;
  if (!amount || Number(amount) < minAmount) {
    errEl.textContent = "Billing amount must be ₹" + minAmount + " or more.";
    return;
  }

  const btn = document.getElementById("saveEntryBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving...';

  // Timeout guard: re-enable after 30s if stuck
  const timeoutId = setTimeout(() => {
    if (btn.disabled) {
      btn.disabled = false;
      btn.innerHTML = "💾 Save Entry";
      errEl.textContent = "Request timed out. Please try again.";
    }
  }, 30000);

  // STEP A — Compute optimistic state
  const optimisticTotal = (currentCustomerData.totalEntries || 0) + 1;
  const optimisticEligible = optimisticTotal % appConfig.cycle === 0;

  // STEP B — Immediately update the UI (before awaiting API)
  buildDots(optimisticTotal, appConfig.cycle, currentCustomerData.rewardsClaimed);

  const banner = document.getElementById("eligibilityBanner");
  if (optimisticEligible) {
    banner.className = "eligibility-banner eligible";
    banner.textContent = "🎉 Eligible for FREE meal (up to ₹" + (appConfig.rewardValue || 150) + ")!";
  } else {
    banner.className = "eligibility-banner not-eligible";
    const pos = optimisticTotal % appConfig.cycle;
    const remaining = pos === 0 ? appConfig.cycle : appConfig.cycle - pos;
    banner.textContent = remaining + " more visit" + (remaining !== 1 ? "s" : "") + " to earn a free meal!";
  }

  document.getElementById("entryForm").style.display = "none";
  document.getElementById("whatsappSection").style.display = "";

  const whatsappBtn = document.getElementById("whatsappBtn");
  whatsappBtn.href = "#";
  whatsappBtn.textContent = "Preparing message...";
  whatsappBtn.style.opacity = "0.5";

  // STEP C — Await the API call
  const result = await apiCall("addEntry", {
    mobile: currentMobile,
    amount: amount,
    message: message
  });

  clearTimeout(timeoutId);

  if (result.success) {
    // Success: finalize optimistic UI
    showToast("Entry saved! ✅", "success");

    btn.disabled = false;
    btn.innerHTML = "💾 Save Entry";

    currentCustomerData.totalEntries = result.totalEntries;
    currentCustomerData.eligible = result.eligible;
    currentCustomerData.rewardsClaimed = result.rewardsClaimed;
    buildDots(result.totalEntries, result.cycle, result.rewardsClaimed);

    // Update eligibility banner with server-confirmed values
    if (result.eligible) {
      banner.className = "eligibility-banner eligible";
      banner.textContent = "🎉 Eligible for FREE meal (up to ₹" + result.rewardValue + ")!";
    } else {
      banner.className = "eligibility-banner not-eligible";
      const pos = result.totalEntries % result.cycle;
      const remaining = pos === 0 ? result.cycle : result.cycle - pos;
      banner.textContent = remaining + " more visit" + (remaining !== 1 ? "s" : "") + " to earn a free meal!";
    }

    // Set real WhatsApp link
    whatsappBtn.href = result.whatsappLink;
    whatsappBtn.textContent = "📱 Send WhatsApp Message";
    whatsappBtn.style.opacity = "1";

  } else {
    // Failure: roll back optimistic UI
    document.getElementById("entryForm").style.display = "";
    document.getElementById("whatsappSection").style.display = "none";
    buildDots(currentCustomerData.totalEntries, appConfig.cycle, currentCustomerData.rewardsClaimed);
    errEl.textContent = result.error || "Failed to save entry.";
    showToast(result.error || "Failed to save entry.", "error");
    btn.disabled = false;
    btn.innerHTML = "💾 Save Entry";
  }
});

// Amount input — only numeric
document.getElementById("amountInput").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/[^\d]/g, "");
});

// ===== CLOSE MODAL =====
function closeModal() {
  document.getElementById("customerModal").classList.add("hidden");
  currentMobile = "";
  currentCustomerData = null;
  // Re-focus mobile input for quick next entry
  setTimeout(() => document.getElementById("mobileInput").focus(), 100);
}

document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
document.getElementById("cancelEntryBtn").addEventListener("click", closeModal);
document.getElementById("customerModal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("customerModal")) closeModal();
});

// ===== ADMIN PANEL =====
async function loadAdminData() {
  const loading = document.getElementById("adminLoading");
  loading.classList.remove("hidden");

  const result = await apiCall("getAdminData");
  loading.classList.add("hidden");

  if (!result.success) {
    showToast(result.error || "Failed to load admin data.", "error");
    return;
  }

  renderAdminStats(result);
  renderTopCustomers(result.topCustomers);
  renderRepeatChart(result.repeatCustomers, result.newCustomers);
}

function renderAdminStats(data) {
  const grid = document.getElementById("statsGrid");
  grid.innerHTML = "";

  const stats = [
    { icon: "👥", value: data.totalCustomers, label: "Total Customers" },
    { icon: "📝", value: data.totalVisits, label: "Total Visits" },
    { icon: "🎁", value: data.totalRewardsGiven, label: "Rewards Given" },
    { icon: "⏳", value: data.rewardsPending, label: "Rewards Pending" },
    {
      icon: "📅", value: data.todayEntries, label: "Today's Entries",
      altValue: "₹" + data.todayAmount, altLabel: "Today's Amount", toggleable: true
    },
    { icon: "💰", value: "₹" + data.avgBilling, label: "Avg Billing" },
    { icon: "📊", value: data.avgVisitsPerCustomer, label: "Avg Visits/Customer" },
    { icon: "🏆", value: data.rewardConversionRate + "%", label: "Reward Conv. Rate" }
  ];

  stats.forEach((s, i) => {
    const card = document.createElement("div");
    card.className = "stat-card";

    if (s.toggleable) {
      card.innerHTML =
        '<div class="stat-icon">' + s.icon + '</div>' +
        '<div class="toggle-group" style="margin-bottom:6px">' +
          '<button class="toggle-btn active" data-show="primary">Entries</button>' +
          '<button class="toggle-btn" data-show="alt">Amount</button>' +
        '</div>' +
        '<div class="stat-value">' + s.value + '</div>' +
        '<div class="stat-label">' + s.label + '</div>';
      card.dataset.primaryVal = s.value;
      card.dataset.primaryLabel = s.label;
      card.dataset.altVal = s.altValue;
      card.dataset.altLabel = s.altLabel;
    } else {
      card.innerHTML =
        '<div class="stat-icon">' + s.icon + '</div>' +
        '<div class="stat-value">' + s.value + '</div>' +
        '<div class="stat-label">' + s.label + '</div>';
    }
    grid.appendChild(card);
  });

  // Today's toggle handlers
  grid.querySelectorAll('.stat-card .toggle-btn').forEach(btn => {
    btn.addEventListener("click", (e) => {
      const card = e.target.closest('.stat-card');
      card.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      const show = e.target.dataset.show;
      const valEl = card.querySelector('.stat-value');
      const labelEl = card.querySelector('.stat-label');
      if (show === "alt") {
        valEl.textContent = card.dataset.altVal;
        labelEl.textContent = card.dataset.altLabel;
      } else {
        valEl.textContent = card.dataset.primaryVal;
        labelEl.textContent = card.dataset.primaryLabel;
      }
    });
  });
}

function renderTopCustomers(customers) {
  const tbody = document.querySelector("#topCustomersTable tbody");
  tbody.innerHTML = "";
  if (!customers || customers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-muted);text-align:center;padding:20px">No data yet</td></tr>';
    return;
  }
  customers.forEach((c, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td>' + (i + 1) + '</td><td>' + c.mobile + '</td><td>' + c.count + '</td>';
    tbody.appendChild(tr);
  });
}

// ===== POINT 6: Revamped Repeat vs New chart =====
function renderRepeatChart(repeat, newC) {
  const total = repeat + newC;

  // Populate the stats side
  const side = document.getElementById("repeatStatsSide");
  side.innerHTML = "";

  const items = [
    { value: total, label: "Total Customers", class: "" },
    { value: repeat, label: "Repeat Customers", class: "" },
    { value: newC, label: "New Customers", class: "green" },
    { value: total > 0 ? ((repeat / total) * 100).toFixed(1) + "%" : "0%", label: "Repeat Rate", class: "" },
  ];

  items.forEach(item => {
    const card = document.createElement("div");
    card.className = "repeat-stat-card";
    card.innerHTML =
      '<div class="repeat-stat-value ' + item.class + '">' + item.value + '</div>' +
      '<div class="repeat-stat-label">' + item.label + '</div>';
    side.appendChild(card);
  });

  // Draw chart
  const ctx = document.getElementById("repeatChart").getContext("2d");
  if (adminCharts.repeat) adminCharts.repeat.destroy();

  adminCharts.repeat = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Repeat", "New"],
      datasets: [{
        data: [repeat, newC],
        backgroundColor: ["#ff8c32", "#34d399"],
        borderColor: "transparent",
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: "68%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "var(--text-muted, #6b6058)",
            font: { family: "Outfit", size: 12 },
            padding: 16,
            usePointStyle: true,
            pointStyleWidth: 8
          }
        },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              const val = ctx.raw;
              const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
              return " " + val + " (" + pct + "%)";
            }
          }
        }
      }
    }
  });
}

// ===== HEATMAP =====
let heatmapType = "entries";

document.querySelectorAll("#heatmapToggle .toggle-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#heatmapToggle .toggle-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    heatmapType = btn.dataset.type;
  });
});

document.getElementById("calcHeatmapBtn").addEventListener("click", async () => {
  const btn = document.getElementById("calcHeatmapBtn");
  btn.disabled = true;
  btn.textContent = "⏳ Calculating...";

  const result = await apiCall("getHeatmapData", { type: heatmapType });
  btn.disabled = false;
  btn.textContent = "📊 Calculate Heatmap";

  if (!result.success) {
    showToast(result.error || "Heatmap calculation failed.", "error");
    return;
  }
  renderHeatmap(result.heatmap, result.type);
});

function renderHeatmap(data, type) {
  const area = document.getElementById("heatmapArea");
  area.innerHTML = "";

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let maxVal = 0;
  data.forEach(row => row.forEach(v => { if (v > maxVal) maxVal = v; }));

  const hourRow = document.createElement("div");
  hourRow.className = "heatmap-hour-labels";
  hourRow.innerHTML = '<div></div>';
  for (let h = 0; h < 24; h++) {
    const el = document.createElement("div");
    el.className = "heatmap-hour";
    el.textContent = h;
    hourRow.appendChild(el);
  }
  area.appendChild(hourRow);

  const container = document.createElement("div");
  container.className = "heatmap-container";

  const grid = document.createElement("div");
  grid.className = "heatmap-grid";

  for (let d = 0; d < 7; d++) {
    const label = document.createElement("div");
    label.className = "heatmap-label";
    label.textContent = days[d];
    grid.appendChild(label);

    for (let h = 0; h < 24; h++) {
      const cell = document.createElement("div");
      cell.className = "heatmap-cell";
      const val = data[d][h];
      const intensity = maxVal > 0 ? val / maxVal : 0;
      if (val === 0) {
        cell.style.background = "var(--bg-primary)";
      } else {
        const alpha = 0.2 + intensity * 0.8;
        cell.style.background = type === "amount"
          ? `rgba(52, 211, 153, ${alpha})`
          : `rgba(255, 140, 50, ${alpha})`;
      }
      cell.textContent = val > 0 ? (type === "amount" ? "₹" + val : val) : "";
      cell.title = days[d] + " " + h + ":00 — " + (type === "amount" ? "₹" + val : val + " entries");
      grid.appendChild(cell);
    }
  }

  container.appendChild(grid);
  area.appendChild(container);
}

// ===== TIME BETWEEN VISITS =====
document.getElementById("calcVisitsBtn").addEventListener("click", async () => {
  const btn = document.getElementById("calcVisitsBtn");
  btn.disabled = true;
  btn.textContent = "⏳ Calculating...";

  const result = await apiCall("getTimeBetweenVisits");
  btn.disabled = false;
  btn.textContent = "📊 Calculate";

  if (!result.success) {
    showToast(result.error || "Calculation failed.", "error");
    return;
  }
  renderTimeBetween(result);
});

// ===== POINT 6: Revamped Time Between Visits =====
function renderTimeBetween(data) {
  const area = document.getElementById("timeBetweenArea");
  area.innerHTML = "";

  const statsDiv = document.createElement("div");
  statsDiv.className = "visit-stats";

  const items = [
    { value: data.avgGap + "d", label: "Avg Gap" },
    { value: data.medianGap + "d", label: "Median" },
    { value: data.minGap + "d", label: "Min Gap" },
    { value: data.maxGap + "d", label: "Max Gap" },
    { value: data.totalGaps, label: "Total Gaps" }
  ];

  items.forEach(item => {
    const div = document.createElement("div");
    div.className = "visit-stat";
    div.innerHTML =
      '<div class="visit-stat-value">' + item.value + '</div>' +
      '<div class="visit-stat-label">' + item.label + '</div>';
    statsDiv.appendChild(div);
  });
  area.appendChild(statsDiv);

  if (data.totalGaps === 0) {
    const msg = document.createElement("p");
    msg.style.cssText = "color:var(--text-muted);font-size:0.85rem;margin-top:16px";
    msg.textContent = "Not enough visit data to calculate gaps yet.";
    area.appendChild(msg);
    return;
  }

  const chartWrap = document.createElement("div");
  chartWrap.className = "visit-dist-wrap";
  const canvas = document.createElement("canvas");
  canvas.id = "visitDistChart";
  canvas.style.maxHeight = "260px";
  chartWrap.appendChild(canvas);
  area.appendChild(chartWrap);

  if (adminCharts.visitDist) adminCharts.visitDist.destroy();

  adminCharts.visitDist = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: Object.keys(data.distribution).map(k => k + " days"),
      datasets: [{
        label: "Visit Gaps",
        data: Object.values(data.distribution),
        backgroundColor: "rgba(255, 140, 50, 0.55)",
        borderColor: "#ff8c32",
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        x: {
          ticks: { color: "#a89e94", font: { family: "Outfit", size: 12 } },
          grid: { display: false }
        },
        y: {
          ticks: { color: "#a89e94", font: { family: "Outfit", size: 12 }, stepSize: 1 },
          grid: { color: "rgba(255,140,50,0.06)" },
          beginAtZero: true
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => " " + ctx.raw + " customer" + (ctx.raw !== 1 ? "s" : "")
          }
        }
      }
    }
  });
}
