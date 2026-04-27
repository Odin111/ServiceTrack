// ─── Data Layer ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'servicetrack_employees';
const DISMISSED_KEY = 'servicetrack_dismissed';
const PERMANENT_DELETED_KEY = 'servicetrack_deleted';
const API_URL = '/api/sync';

let employees = [];
let dismissed = [];
let deletedNotifs = [];

let notifSearchTerm = '';
let historySearchTerm = '';
let currentHistoryTab = 'loyalty';

function saveEmployees(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  fetch(`${API_URL}/${STORAGE_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).catch(e => console.error("Sync error", e));
}

function saveDismissed(data) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(data));
  fetch(`${API_URL}/${DISMISSED_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).catch(e => console.error("Sync error", e));
}

function saveDeleted(data) {
  localStorage.setItem(PERMANENT_DELETED_KEY, JSON.stringify(data));
  fetch(`${API_URL}/${PERMANENT_DELETED_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).catch(e => console.error("Sync error", e));
}

async function loadDataFromAPI() {
  try {
    const [empRes, disRes, delRes] = await Promise.all([
      fetch(`${API_URL}/${STORAGE_KEY}`),
      fetch(`${API_URL}/${DISMISSED_KEY}`),
      fetch(`${API_URL}/${PERMANENT_DELETED_KEY}`)
    ]);
    
    const empData = await empRes.json();
    dismissed = await disRes.json();
    deletedNotifs = await delRes.json();
    
    employees = empData.map(emp => {
      if (emp.department !== undefined && emp.division === undefined) {
        emp.division = emp.department;
        delete emp.department;
      }
      return emp;
    });
    
    // Fallback if empty but local storage has data
    if (employees.length === 0 && localStorage.getItem(STORAGE_KEY)) {
        throw new Error("Server empty, using local backup");
    }
  } catch (err) {
    console.warn("Failed to load from DB, falling back to local storage", err);
    try { employees = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { employees = []; }
    try { dismissed = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'); } catch { dismissed = []; }
    try { deletedNotifs = JSON.parse(localStorage.getItem(PERMANENT_DELETED_KEY) || '[]'); } catch { deletedNotifs = []; }
    
    employees = employees.map(emp => {
      if (emp.department !== undefined && emp.division === undefined) {
        emp.division = emp.department;
        delete emp.department;
      }
      return emp;
    });
  }
}

// ─── Calculations ────────────────────────────────────────────────────────────

function yearsWorked(startDate) {
  const diff = Date.now() - new Date(startDate).getTime();
  return diff / (1000 * 60 * 60 * 24 * 365.25);
}

/**
 * Notification rules:
 * - First alert at exactly 10 years
 * - After 10 years, every 5 years (15, 20, 25, ...)
 */
function nextMilestone(years) {
  if (years < 10) return { milestone: 10, label: '10-year Loyalty Award' };
  const intervals = Math.floor((years - 10) / 5);
  const next = 10 + (intervals + 1) * 5;
  const isAward = next % 10 === 0;
  return { milestone: next, label: isAward ? `${next}-year Loyalty Award` : `${next}-year milestone` };
}

function daysUntilMilestone(startDate, milestoneYears) {
  const target = milestoneDate(startDate, milestoneYears);
  return Math.ceil((target - Date.now()) / (1000 * 60 * 60 * 24));
}

function milestoneDate(startDate, milestoneYears) {
  const d = new Date(startDate);
  d.setFullYear(d.getFullYear() + milestoneYears);
  return d;
}

function getPastMilestones(years) {
  const milestones = [];
  if (years >= 10) {
    milestones.push(10);
    let m = 15;
    while (m <= Math.floor(years)) { milestones.push(m); m += 5; }
  }
  return milestones;
}

function nextSalaryMilestone(years) {
  const intervals = Math.floor(years / 3);
  const next = (intervals + 1) * 3;
  return { milestone: next, label: `${next}-year Salary Adjustment` };
}

function getPastSalaryMilestones(years) {
  const milestones = [];
  let m = 3;
  while (m <= Math.floor(years)) { milestones.push(m); m += 3; }
  return milestones;
}

function getSoonestEvent(emp) {
  const yrsL = yearsWorked(emp.startDate);
  const nextL = nextMilestone(yrsL);
  const daysL = daysUntilMilestone(emp.startDate, nextL.milestone);

  const baseS = emp.stepIncrementBaseDate || emp.lastPromotionDate || emp.startDate;
  const yrsS = yearsWorked(baseS);
  const nextS = nextSalaryMilestone(yrsS);
  const daysS = daysUntilMilestone(baseS, nextS.milestone);

  if (daysS < daysL) {
    return { ...nextS, daysLeft: daysS, type: 'salary' };
  } else {
    return { ...nextL, daysLeft: daysL, type: 'loyalty' };
  }
}

function progressToNext(years) {
  if (years < 10) return (years / 10) * 100;
  const above = years - 10;
  return ((above % 5) / 5) * 100;
}

function archiveSalaryMilestones(emp) {
  if (!emp.archivedSalaryMilestones) emp.archivedSalaryMilestones = [];
  const baseS = emp.stepIncrementBaseDate || emp.lastPromotionDate || emp.startDate;
  const yearsS = yearsWorked(baseS);
  const promoCount = emp.promotionCount || 0;
  const salKeySuffix = promoCount > 0 ? `_p${promoCount}` : '';

  getPastSalaryMilestones(yearsS).forEach(m => {
    const key = `${emp.id}_salary_${m}${salKeySuffix}`;
    if (!emp.archivedSalaryMilestones.some(a => a.key === key)) {
      emp.archivedSalaryMilestones.push({ milestone: m, key: key, baseDate: baseS });
    }
  });
}

// ─── Notifications ───────────────────────────────────────────────────────────

function getNotifications() {
  const notifs = [];
  employees.forEach(emp => {
    const years = yearsWorked(emp.startDate);

    // ─── Loyalty Milestones ───
    getPastMilestones(years).forEach(m => {
      const key = `${emp.id}_milestone_${m}`;
      notifs.push({ type: 'milestone', emp, milestone: m, key, dismissed: dismissed.includes(key), ntype: 'loyalty' });
    });

    const nextL = nextMilestone(years);
    const daysL = daysUntilMilestone(emp.startDate, nextL.milestone);
    if (daysL > 0 && daysL <= 90) {
      const key = `${emp.id}_upcoming_${nextL.milestone}`;
      notifs.push({ type: 'upcoming', emp, milestone: nextL.milestone, daysLeft: daysL, key, dismissed: dismissed.includes(key), ntype: 'loyalty' });
    }

    // ─── Salary Milestones ───
    const baseS = emp.stepIncrementBaseDate || emp.lastPromotionDate || emp.startDate;
    const yearsS = yearsWorked(baseS);
    const promoCount = emp.promotionCount || 0;
    const salKeySuffix = promoCount > 0 ? `_p${promoCount}` : '';

    if (emp.archivedSalaryMilestones) {
      emp.archivedSalaryMilestones.forEach(arch => {
        notifs.push({ type: 'milestone', emp, milestone: arch.milestone, key: arch.key, dismissed: dismissed.includes(arch.key), ntype: 'salary', archivedBaseDate: arch.baseDate });
      });
    }

    getPastSalaryMilestones(yearsS).forEach(m => {
      const key = `${emp.id}_salary_${m}${salKeySuffix}`;
      if (!emp.archivedSalaryMilestones || !emp.archivedSalaryMilestones.some(a => a.key === key)) {
        notifs.push({ type: 'milestone', emp, milestone: m, key, dismissed: dismissed.includes(key), ntype: 'salary' });
      }
    });

    const nextS = nextSalaryMilestone(yearsS);
    const daysS = daysUntilMilestone(baseS, nextS.milestone);
    if (daysS > 0 && daysS <= 90) {
      const key = `${emp.id}_upcomingsal_${nextS.milestone}${salKeySuffix}`;
      notifs.push({ type: 'upcoming', emp, milestone: nextS.milestone, daysLeft: daysS, key, dismissed: dismissed.includes(key), ntype: 'salary' });
    }
  });
  return notifs.filter(n => !deletedNotifs.includes(n.key));
}

function activeNotifCount() {
  return getNotifications().filter(n => !n.dismissed).length;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function initials(name) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
}

function formatDaysLeft(daysLeft) {
  if (daysLeft <= 0) return 'Due now!';
  const y = Math.floor(daysLeft / 365);
  const m = Math.floor((daysLeft % 365) / 30);
  const d = Math.floor((daysLeft % 365) % 30);

  const parts = [];
  if (y > 0) parts.push(`${y}y`);
  if (m > 0) parts.push(`${m}m`);
  if (d > 0) parts.push(`${d}d`);

  if (parts.length === 0) return 'Due today';
  return `in ${parts.join(' ')}`;
}

function promotionBadge(emp) {
  const count = emp.promotionCount || 0;
  const badgeHTML = (!count || count === 0)
    ? '<span class="badge badge-gray" style="font-weight:500">Step 0</span>'
    : `<span class="badge badge-blue">Step ${count}</span>`;

  const baseS = emp.stepIncrementBaseDate || emp.lastPromotionDate || emp.startDate;
  const yearsS = yearsWorked(baseS);
  const nextM = nextSalaryMilestone(yearsS).milestone;
  const daysLeft = daysUntilMilestone(baseS, nextM);

  let timerText = '';
  if (daysLeft <= 0) {
    timerText = '<div style="font-size:11px; color:var(--amber); margin-top:4px; font-weight:600; white-space:nowrap;">Due Now</div>';
  } else {
    let tStr = formatDaysLeft(daysLeft);
    tStr = tStr.charAt(0).toUpperCase() + tStr.slice(1);
    timerText = `<div style="font-size:11px; color:var(--text-hint); margin-top:4px; white-space:nowrap;">${tStr}</div>`;
  }

  return `<div style="display:flex; flex-direction:column; align-items:center;">
    ${badgeHTML}
    ${timerText}
  </div>`;
}

function statusBadge(years) {
  if (years < 1) return '<span class="badge badge-gray">New Hire</span>';
  if (years < 5) return '<span class="badge badge-blue">Active</span>';
  if (years < 10) return '<span class="badge badge-teal">Senior</span>';
  return '<span class="badge badge-amber">Veteran</span>';
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderMetrics() {
  const total = employees.length;
  const veterans = employees.filter(e => yearsWorked(e.startDate) >= 10).length;
  const milestoneAlerts = getNotifications().filter(n => n.type === 'milestone' && !n.dismissed).length;
  const upcomingAlerts = getNotifications().filter(n => n.type === 'upcoming' && !n.dismissed).length;

  document.getElementById('metricsGrid').innerHTML = `
    <div class="metric-card"><div class="metric-label">Total Employees</div><div class="metric-value blue">${total}</div></div>
    <div class="metric-card"><div class="metric-label">Veterans (10+ yrs)</div><div class="metric-value teal">${veterans}</div></div>
    <div class="metric-card"><div class="metric-label">Milestone Alerts</div><div class="metric-value amber">${milestoneAlerts}</div></div>
    <div class="metric-card"><div class="metric-label">Upcoming (90 days)</div><div class="metric-value red">${upcomingAlerts}</div></div>
  `;
}

function renderUpcoming() {
  const upcoming = getNotifications().filter(n => n.type === 'upcoming' && !n.dismissed);
  const el = document.getElementById('upcomingList');
  if (upcoming.length === 0) {
    el.innerHTML = '<div class="upcoming-empty">No milestones coming up in the next 90 days.</div>';
    return;
  }
  el.innerHTML = upcoming.map(n => `
    <div class="upcoming-item">
      <div class="upcoming-avatar">${initials(n.emp.name)}</div>
      <div class="upcoming-info">
        <div class="upcoming-name">${n.emp.name}</div>
        <div class="upcoming-meta">${n.emp.division || '—'} · ${n.milestone}-year ${n.ntype === 'salary' ? 'Salary Update' : 'Loyalty Award'} on ${formatDate(milestoneDate(n.ntype === 'salary' ? (n.emp.stepIncrementBaseDate || n.emp.lastPromotionDate || n.emp.startDate) : n.emp.startDate, n.milestone))}</div>
      </div>
      <div class="upcoming-days">in ${n.daysLeft} days</div>
    </div>
  `).join('');
}

function renderTable() {
  const tbody = document.getElementById('empTableBody');

  let currentEmployees = [...employees];

  const searchInput = document.getElementById('empSearchInput');
  if (searchInput) {
    const q = searchInput.value.toLowerCase().trim();
    if (q) {
      const searchField = document.querySelector('input[name="empSearchField"]:checked')?.value || 'name';
      currentEmployees = currentEmployees.filter(emp => {
        const matchName = emp.name && emp.name.toLowerCase().includes(q);
        const matchId = emp.employeeId && emp.employeeId.toLowerCase().includes(q);
        const matchDiv = emp.division && emp.division.toLowerCase().includes(q);

        if (searchField === 'name') return matchName;
        if (searchField === 'id') return matchId;
        if (searchField === 'division') return matchDiv;
        return false;
      });
    }
  }

  const sortSelect = document.getElementById('empSortSelect');
  if (sortSelect) {
    const sortVal = sortSelect.value;
    currentEmployees.sort((a, b) => {
      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      const yearsA = yearsWorked(a.startDate);
      const yearsB = yearsWorked(b.startDate);
      const promoA = a.promotionCount || 0;
      const promoB = b.promotionCount || 0;
      const salaryA = a.currentSalary || 0;
      const salaryB = b.currentSalary || 0;

      switch (sortVal) {
        case 'name_asc': return nameA.localeCompare(nameB);
        case 'name_desc': return nameB.localeCompare(nameA);
        case 'years_desc': return yearsB - yearsA;
        case 'years_asc': return yearsA - yearsB;
        case 'promo_desc': return promoB - promoA;
        case 'promo_asc': return promoA - promoB;
        case 'salary_desc': return salaryB - salaryA;
        case 'salary_asc': return salaryA - salaryB;
        default: return 0;
      }
    });
  }

  if (currentEmployees.length === 0) {
    if (employees.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10"><div class="table-empty">No employees added yet. Click "Add Employee" to get started.</div></td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="10"><div class="table-empty">No employees match your search.</div></td></tr>`;
    }
    return;
  }

  tbody.innerHTML = currentEmployees.map(emp => {
    const years = yearsWorked(emp.startDate);
    const pct = Math.min(100, Math.round(progressToNext(years)));
    const soonest = getSoonestEvent(emp);
    return `
      <tr>
        <td style="font-weight:600;color:var(--text-hint);font-size:12px;">${emp.employeeId || '—'}</td>
        <td style="font-weight:500;">${emp.name}</td>
        <td style="color:var(--text-muted);">${emp.division || '—'}</td>
        <td style="font-weight:500;">${emp.position || '—'}</td>
        <td style="color:var(--text-muted);">${emp.lastPromotionDate ? formatDate(emp.lastPromotionDate) : '—'}</td>
        <td style="color:var(--text-muted);">${emp.eligibility || '—'}</td>
        <td style="color:var(--text-muted);">${formatDate(emp.startDate)}</td>
        <td style="font-weight:600;">${formatCurrency(emp.currentSalary || 0)}</td>
        <td>${promotionBadge(emp)}</td>
        <td>
          <div class="progress-wrap">
            <span style="font-weight:600;min-width:32px;">${years.toFixed(1)}</span>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          </div>
        </td>
        <td style="font-size:13px;">
          ${soonest.label}<br>
          <span style="color:var(--text-hint);font-size:11px;">${formatDaysLeft(soonest.daysLeft)}</span>
        </td>
        <td>${statusBadge(years)}</td>
        <td>
           <div style="display:flex;gap:4px;">
              <button class="btn-icon blue" onclick="openEditModal('${emp.id}')">Edit</button>
              <button class="btn-icon teal" onclick="openPromoteModal('${emp.id}')">Promote</button>
              <button class="btn-icon amber" onclick="openDemoteModal('${emp.id}')">Demote</button>
              <button class="btn-icon" onclick="removeEmployee('${emp.id}')">Remove</button>
           </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderNotifications() {
  const notifs = getNotifications();

  // Filter by Search Term (Active Only)
  let filtered = notifs.filter(n => !n.dismissed);
  if (notifSearchTerm) {
    const q = notifSearchTerm.toLowerCase();
    filtered = filtered.filter(n => n.emp.name.toLowerCase().includes(q));
  }

  const el = document.getElementById('notifContainer');

  if (filtered.length === 0) {
    el.innerHTML = `<div class="notif-empty">${notifSearchTerm ? 'No matching active notifications.' : 'No active notifications at this time.'}</div>`;
    return;
  }

  const loyaltyGroup = filtered.filter(n => n.type === 'milestone' && n.ntype !== 'salary');
  const salaryGroup = filtered.filter(n => n.type === 'milestone' && n.ntype === 'salary');
  const upcomingGroup = filtered.filter(n => n.type === 'upcoming');

  let activeGroup = loyaltyGroup;
  let activeTitle = 'Loyalty Awards';

  if (currentNotifTab === 'salary') {
    activeGroup = salaryGroup;
    activeTitle = 'Salary Updates';
  } else if (currentNotifTab === 'upcoming') {
    activeGroup = upcomingGroup;
    activeTitle = 'Upcoming Milestones';
  }

  if (activeGroup.length === 0) {
    el.innerHTML = `<div class="notif-empty" style="margin-top: 12px;">No active ${activeTitle} at this time.</div>`;
    return;
  }

  const RENDER_LIMIT = 50;
  const limitedGroup = activeGroup.slice(0, RENDER_LIMIT);
  const hiddenCount = activeGroup.length - limitedGroup.length;

  let extraNote = '';
  if (hiddenCount > 0) {
    extraNote = `<div style="text-align:center; padding: 24px 16px; color: var(--text-muted); font-size: 14px;"><strong>+ ${hiddenCount} more ${activeTitle.toLowerCase()}</strong><br>Dismiss some items to see the rest.</div>`;
  }

  el.innerHTML = `
    <div class="notif-list">
      ${limitedGroup.map(n => renderNotifItem(n, false)).join('')}
    </div>
    ${extraNote}
  `;
}

function renderNotifItem(n, isHistoryView = false) {
  if (n.type === 'milestone') {
    const isSalary = n.ntype === 'salary';
    const baseS = n.archivedBaseDate || n.emp.stepIncrementBaseDate || n.emp.lastPromotionDate || n.emp.startDate;
    const eventTitle = isSalary
      ? `${n.emp.name} is due for a ${n.milestone}-year Salary Update!`
      : `${n.emp.name} has reached ${n.milestone} years of service! ${n.milestone % 10 === 0 ? '(Loyalty Award)' : ''}`;

    const subTitle = isSalary
      ? `${n.emp.division || 'No division'} · Due since ${formatDate(milestoneDate(baseS, n.milestone))}`
      : `${n.emp.division || 'No division'} · Started ${formatDate(n.emp.startDate)} · Admin recognition recommended`;

    const extraAction = isSalary
      ? `<button class="btn-primary" style="margin-top: 12px; font-size: 13px; padding: 6px 14px; background: var(--teal); box-shadow: none;" onclick="openSalaryModal('${n.emp.id}', '${n.key}')">Update Salary</button>`
      : `<button class="btn-primary" style="margin-top: 12px; font-size: 13px; padding: 6px 14px; box-shadow: none;" onclick="dismissNotif('${n.key}')">Mark as recognized</button>`;

    const actionBlock = isHistoryView
      ? `<div style="display:flex; flex-wrap: wrap; gap: 8px; align-items:center; margin-top:12px;">
           <button class="notif-dismiss" style="color:var(--teal);" onclick="restoreNotif('${n.key}')">Restore</button>
           <button class="notif-dismiss" style="color:var(--red);" onclick="deleteNotifFromHistory('${n.key}')">Delete Permanently</button>
         </div>`
      : `<div style="display:flex; flex-wrap: wrap; gap: 8px; align-items:center;">
           ${extraAction}
           <button class="notif-dismiss" onclick="dismissNotif('${n.key}')">Dismiss</button>
         </div>`;

    return `
      <div class="notif-card milestone">
        <div class="notif-icon milestone" style="${isSalary ? 'background: var(--teal); animation: none;' : ''}">${isSalary ? '₱' : '&#9733;'}</div>
        <div class="notif-body">
          <div class="notif-title">${eventTitle}</div>
          <div class="notif-sub">${subTitle}</div>
          ${actionBlock}
        </div>
      </div>
    `;
  } else {
    const actionBlock = isHistoryView
      ? `<div style="display:flex; flex-wrap: wrap; gap:8px; margin-top:8px;">
           <button class="notif-dismiss" style="color:var(--teal);" onclick="restoreNotif('${n.key}')">Restore</button>
           <button class="notif-dismiss" style="color:var(--red);" onclick="deleteNotifFromHistory('${n.key}')">Delete Permanently</button>
         </div>`
      : `<div style="display:flex; flex-wrap: wrap; gap:8px; margin-top:8px;">
           <button class="notif-dismiss" onclick="dismissNotif('${n.key}')">Dismiss</button>
         </div>`;

    return `
      <div class="notif-card upcoming">
        <div class="notif-icon upcoming">&#8987;</div>
        <div class="notif-body">
          <div class="notif-title">${n.emp.name} — ${n.milestone}-year ${n.ntype === 'salary' ? 'Salary Update' : 'Loyalty Award'} in ${n.daysLeft} days</div>
          <div class="notif-sub">
            ${n.emp.division || 'No division'} · Milestone date: ${formatDate(milestoneDate(n.ntype === 'salary' ? (n.emp.stepIncrementBaseDate || n.emp.lastPromotionDate || n.emp.startDate) : n.emp.startDate, n.milestone))}
          </div>
          ${actionBlock}
        </div>
      </div>
    `;
  }
}

let currentNotifTab = 'loyalty';

function switchNotifTab(tab) {
  document.getElementById('notifTabLoyalty').classList.remove('active');
  document.getElementById('notifTabSalary').classList.remove('active');
  document.getElementById('notifTabUpcoming').classList.remove('active');

  if (tab === 'loyalty') document.getElementById('notifTabLoyalty').classList.add('active');
  if (tab === 'salary') document.getElementById('notifTabSalary').classList.add('active');
  if (tab === 'upcoming') document.getElementById('notifTabUpcoming').classList.add('active');

  currentNotifTab = tab;
  renderNotifications();
}

function renderSidebarBadge() {
  const count = activeNotifCount();
  const badge = document.getElementById('sidebarBadge');
  badge.textContent = count > 0 ? count : '';
  badge.style.display = count > 0 ? '' : 'none';
}

function renderYearlyReport() {
  const tbody = document.getElementById('reportTableBody');
  if (!tbody) return;
  const currentYear = new Date().getFullYear();
  const yearText = document.getElementById('reportYearText');
  if (yearText) yearText.textContent = currentYear;

  const results = [];
  employees.forEach(emp => {
    // Loyalty Milestones
    const loyaltyMs = [10, 15, 20, 25, 30, 35, 40, 45, 50];
    loyaltyMs.forEach(m => {
      const d = milestoneDate(emp.startDate, m);
      if (d.getFullYear() === currentYear) {
        results.push({ emp, milestone: m, type: 'loyalty', date: d });
      }
    });

    // Salary Milestones
    const salaryMs = [];
    for (let m = 3; m <= 50; m += 3) salaryMs.push(m);
    salaryMs.forEach(m => {
      const baseS = emp.stepIncrementBaseDate || emp.lastPromotionDate || emp.startDate;
      const d = milestoneDate(baseS, m);
      if (d.getFullYear() === currentYear) {
        results.push({ emp, milestone: m, type: 'salary', date: d });
      }
    });
  });

  results.sort((a, b) => a.date - b.date);

  if (results.length === 0) {
    if (employees.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="table-empty">No employees in the system.</div></td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="6"><div class="table-empty">No milestones happening in ${currentYear}.</div></td></tr>`;
    }
    return;
  }

  tbody.innerHTML = results.map(item => {
    const isSalary = item.type === 'salary';
    const typeBadge = isSalary
      ? '<span class="badge badge-teal">Salary</span>'
      : '<span class="badge badge-amber">Loyalty</span>';

    const milestoneText = isSalary
      ? `${item.milestone}-year Salary Adjustment`
      : `${item.milestone}-year ${item.milestone % 10 === 0 ? 'Loyalty Award' : 'Milestone'}`;

    return `
      <tr>
         <td style="font-weight:600; white-space:nowrap;">${formatDate(item.date)}</td>
         <td style="font-weight:500;">${item.emp.name}</td>
         <td style="color:var(--text-muted); font-size:12px;">${item.emp.employeeId || '—'}</td>
         <td style="color:var(--text-muted);">${item.emp.division || '—'}</td>
         <td style="font-weight:500;">${milestoneText}</td>
         <td>${typeBadge}</td>
      </tr>
    `;
  }).join('');
}

function renderAll() {
  renderMetrics();
  renderUpcoming();
  renderTable();
  renderNotifications();
  renderSidebarBadge();
  renderYearlyReport();
}

// ─── Actions ─────────────────────────────────────────────────────────────────



function addEmployee() {
  const empIdText = document.getElementById('inputId').value.trim();
  const name = document.getElementById('inputName').value.trim();
  const dept = document.getElementById('inputDept').value;
  const currentPosition = document.getElementById('inputPosition').value.trim();
  const eligibility = document.getElementById('inputEligibility').value.trim();
  const date = document.getElementById('inputDate').value;
  const salaryInput = document.getElementById('inputSalary').value;

  if (!name || !date) { alert('Please provide a name and start date.'); return; }

  const currentSalary = parseFloat(salaryInput) || 0;
  const newEmp = {
    id: Date.now().toString(), employeeId: empIdText || '—', name, division: dept,
    position: currentPosition, positionHistory: [currentPosition],
    lastPromotionDate: '', lastPromotionDateHistory: [''],
    eligibility, startDate: date, currentSalary, promotionCount: 0
  };

  const oldEmp = checkDuplicate(newEmp);
  if (oldEmp) {
    backupEmployeesBeforeImport = [...employees];
    duplicateQueue = [{ oldEmp, newEmp }];
    duplicateQueueOnComplete = () => {
      saveEmployees(employees);
      closeModal();
      renderAll();
    };
    processDuplicateQueue();
  } else {
    employees.push(newEmp);
    saveEmployees(employees);
    closeModal();
    renderAll();
  }
}

let currentRemoveEmpId = null;

function removeEmployee(id) {
  currentRemoveEmpId = id;
  const emp = employees.find(e => e.id === id);
  if (emp) {
    document.getElementById('removeEmpName').textContent = emp.name;
  }
  document.getElementById('removeModal').style.display = 'flex';
}

function closeRemoveModal() {
  document.getElementById('removeModal').style.display = 'none';
  currentRemoveEmpId = null;
}

function closeRemoveModalOutside(e) {
  if (e.target.id === 'removeModal') closeRemoveModal();
}

function confirmRemoveEmployee() {
  if (!currentRemoveEmpId) return;
  employees = employees.filter(e => e.id !== currentRemoveEmpId);
  dismissed = dismissed.filter(k => !k.startsWith(currentRemoveEmpId));
  saveEmployees(employees);
  saveDismissed(dismissed);
  closeRemoveModal();
  renderAll();
}

function openDeleteAllModal() {
  document.getElementById('deleteAllModal').style.display = 'flex';
}

function closeDeleteAllModal() {
  document.getElementById('deleteAllModal').style.display = 'none';
}

function closeDeleteAllModalOutside(e) {
  if (e.target.id === 'deleteAllModal') closeDeleteAllModal();
}

function confirmDeleteAll() {
  employees = [];
  dismissed = [];
  saveEmployees(employees);
  saveDismissed(dismissed);
  closeDeleteAllModal();
  renderAll();
}

function dismissNotif(key) {
  if (!dismissed.includes(key)) dismissed.push(key);
  saveDismissed(dismissed);
  renderAll();
}


function openDismissAllModal() {
  document.getElementById('dismissAllModal').style.display = 'flex';
}

function closeDismissAllModal() {
  document.getElementById('dismissAllModal').style.display = 'none';
}

function closeDismissAllModalOutside(e) {
  if (e.target.id === 'dismissAllModal') closeDismissAllModal();
}

function dismissAllNotifs(type = 'all') {
  const notifs = getNotifications();
  let changed = false;

  notifs.forEach(n => {
    if (!n.dismissed && !dismissed.includes(n.key)) {
      let match = false;
      if (type === 'all') match = true;
      else if (type === 'loyalty' && n.type === 'milestone' && n.ntype !== 'salary') match = true;
      else if (type === 'salary' && n.type === 'milestone' && n.ntype === 'salary') match = true;
      else if (type === 'upcoming' && n.type === 'upcoming') match = true;

      if (match) {
        dismissed.push(n.key);
        changed = true;
      }
    }
  });
  if (changed) {
    saveDismissed(dismissed);
    renderAll();
  }
  closeDismissAllModal();
}

// ─── Notification History & Search ──────────────────────────────────────────

function handleNotifSearch() {
  notifSearchTerm = document.getElementById('notifSearchInput').value;
  renderNotifications();
}

// ─── History Island & Search ────────────────────────────────────────────────

function openHistoryModal() {
  document.getElementById('historyModal').style.display = 'flex';
  historySearchTerm = '';
  const searchInput = document.getElementById('historySearchInput');
  if (searchInput) searchInput.value = '';
  renderHistoryContent();
}

function closeHistoryModal() {
  document.getElementById('historyModal').style.display = 'none';
  historySearchTerm = '';
  const searchInput = document.getElementById('historySearchInput');
  if (searchInput) searchInput.value = '';
}

function closeHistoryModalOutside(e) {
  if (e.target.id === 'historyModal') closeHistoryModal();
}

function handleHistorySearch() {
  historySearchTerm = document.getElementById('historySearchInput').value;
  renderHistoryContent();
}

function switchHistoryTab(tab) {
  document.getElementById('histTabLoyalty').classList.remove('active');
  document.getElementById('histTabSalary').classList.remove('active');
  document.getElementById('histTabUpcoming').classList.remove('active');

  if (tab === 'loyalty') document.getElementById('histTabLoyalty').classList.add('active');
  if (tab === 'salary') document.getElementById('histTabSalary').classList.add('active');
  if (tab === 'upcoming') document.getElementById('histTabUpcoming').classList.add('active');

  currentHistoryTab = tab;
  renderHistoryContent();
}

function renderHistoryContent() {
  const notifs = getNotifications();
  const el = document.getElementById('historyContainer');

  let historyItems = notifs.filter(n => n.dismissed);

  // Filter by Search
  if (historySearchTerm) {
    const q = historySearchTerm.toLowerCase();
    historyItems = historyItems.filter(n => n.emp.name.toLowerCase().includes(q));
  }

  // Filter by Tab
  if (currentHistoryTab === 'loyalty') {
    historyItems = historyItems.filter(n => n.type === 'milestone' && n.ntype !== 'salary');
  } else if (currentHistoryTab === 'salary') {
    historyItems = historyItems.filter(n => n.type === 'milestone' && n.ntype === 'salary');
  } else if (currentHistoryTab === 'upcoming') {
    historyItems = historyItems.filter(n => n.type === 'upcoming');
  }

  if (historyItems.length === 0) {
    el.innerHTML = `<div class="notif-empty" style="padding: 40px 0;">No history records found for this category.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="notif-list">
      ${historyItems.map(n => renderNotifItem(n, true)).join('')}
    </div>
  `;
}

function restoreNotif(key) {
  dismissed = dismissed.filter(k => k !== key);
  saveDismissed(dismissed);
  renderAll();
  renderHistoryContent();
}

function deleteNotifFromHistory(key) {
  if (!confirm('Are you sure you want to permanently delete this history record?')) return;
  if (!deletedNotifs.includes(key)) {
    deletedNotifs.push(key);
    saveDeleted(deletedNotifs);
  }
  renderAll();
  renderHistoryContent();
}

function openRestoreAllModal() {
  document.getElementById('restoreAllModal').style.display = 'flex';
}
function closeRestoreAllModal() {
  document.getElementById('restoreAllModal').style.display = 'none';
}
function closeRestoreAllModalOutside(e) {
  if (e.target.id === 'restoreAllModal') closeRestoreAllModal();
}
function confirmRestoreAll(type = 'all') {
  if (type === 'all') {
    dismissed = [];
  } else {
    const notifs = getNotifications();
    dismissed = dismissed.filter(key => {
      const n = notifs.find(x => x.key === key);
      if (!n) return true; // keep if it doesn't exist

      let match = false;
      if (type === 'loyalty' && n.type === 'milestone' && n.ntype !== 'salary') match = true;
      else if (type === 'salary' && n.type === 'milestone' && n.ntype === 'salary') match = true;
      else if (type === 'upcoming' && n.type === 'upcoming') match = true;

      return !match;
    });
  }

  saveDismissed(dismissed);
  closeRestoreAllModal();
  renderAll();
  renderHistoryContent();
}

function openClearHistoryModal() {
  document.getElementById('clearHistoryModal').style.display = 'flex';
}
function closeClearHistoryModal() {
  document.getElementById('clearHistoryModal').style.display = 'none';
}
function closeClearHistoryModalOutside(e) {
  if (e.target.id === 'clearHistoryModal') closeClearHistoryModal();
}
function confirmClearHistory(type = 'all') {
  const notifs = getNotifications();

  notifs.forEach(n => {
    if (n.dismissed && !deletedNotifs.includes(n.key)) {
      let match = false;
      if (type === 'all') match = true;
      else if (type === 'loyalty' && n.type === 'milestone' && n.ntype !== 'salary') match = true;
      else if (type === 'salary' && n.type === 'milestone' && n.ntype === 'salary') match = true;
      else if (type === 'upcoming' && n.type === 'upcoming') match = true;

      if (match) {
        deletedNotifs.push(n.key);
      }
    }
  });

  saveDeleted(deletedNotifs);
  closeClearHistoryModal();
  renderAll();
  renderHistoryContent();
}

// ─── View Switching ───────────────────────────────────────────────────────────

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  event.currentTarget.classList.add('active');

  if (window.innerWidth <= 768) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('mobile-open');
  }
}

// ─── Modal ───────────────────────────────────────────────────────────────────

function openModal() {
  document.getElementById('modal').style.display = 'flex';
  document.getElementById('inputId').focus();
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
  document.getElementById('inputId').value = '';
  document.getElementById('inputName').value = '';
  document.getElementById('inputDept').value = 'STOD';
  document.getElementById('inputPosition').value = '';
  document.getElementById('inputEligibility').value = '';
  document.getElementById('inputDate').value = '';
  document.getElementById('inputSalary').value = '';

  const csvInput = document.getElementById('csvFileInput');
  if (csvInput) csvInput.value = '';

  if (typeof switchAddMode === 'function') {
    switchAddMode('manual');
  }
}

function closeModalOutside(e) {
  if (e.target.id === 'modal') closeModal();
}

// ─── Promotion & Demotion Engine ───

let currentDemoteEmpId = null;

function openDemoteModal(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return;

  // No restriction on demotion eligibility as requested

  currentDemoteEmpId = id;
  const nameEl = document.getElementById('demoteEmpName');
  if (nameEl) nameEl.textContent = emp.name;

  const dateInput = document.getElementById('inputDemoteDate');
  if (dateInput) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  const errDiv = document.getElementById('demoteError');
  if (errDiv) errDiv.textContent = '';

  const modal = document.getElementById('demoteModal');
  if (modal) modal.style.display = 'flex';
}

function closeDemoteModal() {
  const modal = document.getElementById('demoteModal');
  if (modal) modal.style.display = 'none';

  const dateInput = document.getElementById('inputDemoteDate');
  if (dateInput) dateInput.value = '';

  const errDiv = document.getElementById('demoteError');
  if (errDiv) errDiv.textContent = '';

  currentDemoteEmpId = null;
}

function closeDemoteModalOutside(e) {
  if (e.target.id === 'demoteModal') closeDemoteModal();
}

function submitDemote() {
  if (!currentDemoteEmpId) return;
  const emp = employees.find(e => e.id === currentDemoteEmpId);
  if (emp) {
    const demoteDateInput = document.getElementById('inputDemoteDate');
    const demoteDate = demoteDateInput ? demoteDateInput.value : '';
    const errDiv = document.getElementById('demoteError');

    if (!demoteDate) {
      if (errDiv) errDiv.textContent = 'Please specify the date of demotion.';
      else alert('Please specify the date of demotion.');
      return;
    }

    archiveSalaryMilestones(emp);

    // emp.promotionCount = (emp.promotionCount || 0) - 1; // Removed as per request
    if (emp.positionHistory && emp.positionHistory.length > 1) {
      emp.positionHistory.pop();
      emp.position = emp.positionHistory[emp.positionHistory.length - 1];
    }
    if (emp.lastPromotionDateHistory && emp.lastPromotionDateHistory.length > 0) {
      emp.lastPromotionDateHistory.pop();
      emp.lastPromotionDate = emp.lastPromotionDateHistory.length > 0 ? emp.lastPromotionDateHistory[emp.lastPromotionDateHistory.length - 1] : '';
    }

    // Reset the 3 year timer to the specified demotion date
    emp.stepIncrementBaseDate = demoteDate;

    saveEmployees(employees);
    renderAll();
  }
  closeDemoteModal();
}

let currentPromoteEmpId = null;

function openPromoteModal(id) {
  try {
    currentPromoteEmpId = id;
    const emp = employees.find(e => e.id === id);
    const posInput = document.getElementById('inputNewPosition');
    const dateInput = document.getElementById('inputNewPromoDate');
    if (posInput) {
      posInput.value = emp ? (emp.position || '') : '';
    }
    if (dateInput) {
      dateInput.value = new Date().toISOString().split('T')[0];
    }

    const errDiv = document.getElementById('promoteError');
    if (errDiv) errDiv.textContent = '';

    const modal = document.getElementById('promoteModal');
    if (modal) {
      modal.style.display = 'flex';
    }

    if (posInput) posInput.focus();
  } catch (e) {
    console.error("Open Promote Modal Error:", e);
  }
}

function closePromoteModal() {
  const modal = document.getElementById('promoteModal');
  if (modal) modal.style.display = 'none';

  const posInput = document.getElementById('inputNewPosition');
  if (posInput) posInput.value = '';

  const dateInput = document.getElementById('inputNewPromoDate');
  if (dateInput) dateInput.value = '';

  const errDiv = document.getElementById('promoteError');
  if (errDiv) errDiv.textContent = '';

  currentPromoteEmpId = null;
}

function submitPromotion() {
  try {
    if (!currentPromoteEmpId) return;

    const posInput = document.getElementById('inputNewPosition');
    const dateInput = document.getElementById('inputNewPromoDate');
    const newPosition = posInput ? posInput.value.trim() : '';
    const promoDate = dateInput ? dateInput.value : '';
    const errDiv = document.getElementById('promoteError');

    if (!newPosition) {
      if (errDiv) errDiv.textContent = 'Please specify the new position.';
      return;
    }
    if (!promoDate) {
      if (errDiv) errDiv.textContent = 'Please specify the date of promotion.';
      return;
    }

    const empIndex = employees.findIndex(e => e.id === currentPromoteEmpId);
    if (empIndex > -1) {
      const emp = employees[empIndex];

      if (newPosition.toLowerCase() === (emp.position || '').toLowerCase()) {
        if (errDiv) errDiv.textContent = 'Promotion rejected: already in this position.';
        return;
      }

      archiveSalaryMilestones(emp);

      if (!emp.positionHistory) {
        emp.positionHistory = [emp.position || ''];
      }
      if (!emp.lastPromotionDateHistory) {
        emp.lastPromotionDateHistory = [emp.lastPromotionDate || ''];
      }
      emp.positionHistory.push(newPosition);
      emp.lastPromotionDateHistory.push(promoDate);
      emp.position = newPosition;
      emp.lastPromotionDate = promoDate;
      emp.stepIncrementBaseDate = promoDate;

      saveEmployees(employees);
      renderAll();
    }
    closePromoteModal();
  } catch (e) {
    console.error("Submit Promotion Error:", e);
  }
}

// ─── Salary Update Engine ───

let currentSalaryEmpId = null;
let currentSalaryNotifKey = null;

function openSalaryModal(id, notifKey = null) {
  try {
    currentSalaryEmpId = id;
    currentSalaryNotifKey = notifKey;
    const emp = employees.find(e => e.id === id);
    const salInput = document.getElementById('inputNewSalary');
    if (salInput) {
      salInput.value = (emp && emp.currentSalary) ? emp.currentSalary : '';
    }

    const hint = document.getElementById('salaryHint');
    if (hint) {
      if (emp && emp.currentSalary) {
        hint.style.color = 'var(--amber)';
        hint.textContent = `* Must be higher than ₱${emp.currentSalary.toLocaleString()}`;
      } else {
        hint.textContent = '';
      }
    }

    const modal = document.getElementById('salaryModal');
    if (modal) {
      modal.style.display = 'flex';
    }

    if (salInput) salInput.focus();
  } catch (e) {
    console.error("Open Salary Modal Error:", e);
  }
}

function closeSalaryModal() {
  const modal = document.getElementById('salaryModal');
  if (modal) modal.style.display = 'none';

  const salInput = document.getElementById('inputNewSalary');
  if (salInput) salInput.value = '';

  const hint = document.getElementById('salaryHint');
  if (hint) hint.textContent = '';

  currentSalaryEmpId = null;
  currentSalaryNotifKey = null;
}

function submitSalaryUpdate() {
  try {
    if (!currentSalaryEmpId) return;

    const salInput = document.getElementById('inputNewSalary');
    const newSalary = salInput ? parseFloat(salInput.value) : 0;
    if (isNaN(newSalary) || newSalary <= 0) {
      alert('Please enter a valid salary amount.');
      return;
    }

    const empIndex = employees.findIndex(e => e.id === currentSalaryEmpId);
    if (empIndex > -1) {
      const emp = employees[empIndex];

      if (newSalary <= (emp.currentSalary || 0)) {
        const hint = document.getElementById('salaryHint');
        if (hint) {
          hint.style.color = 'var(--red)';
          hint.textContent = 'Invalid: Amount must be higher than current salary.';
        } else {
          alert('Invalid Salary: Amount must be higher than current salary.');
        }
        return;
      }

      if (!emp.salaryHistory) emp.salaryHistory = [emp.currentSalary];

      emp.currentSalary = newSalary;
      emp.salaryHistory.push(newSalary);
      emp.promotionCount = (emp.promotionCount || 0) + 1;

      // Automatically dismiss ALL active salary notifications for this employee
      const activeNotifs = getNotifications();
      let dismissedAny = false;
      activeNotifs.forEach(n => {
        if (n.emp.id === emp.id && n.ntype === 'salary' && !n.dismissed) {
          if (!dismissed.includes(n.key)) {
            dismissed.push(n.key);
            dismissedAny = true;
          }
        }
      });
      if (dismissedAny) {
        saveDismissed(dismissed);
      }

      saveEmployees(employees);
      renderAll();
    }
    closeSalaryModal();
  } catch (e) {
    console.error("Submit Salary Error:", e);
  }
}

let currentEditEmpId = null;

function openEditModal(id) {
  currentEditEmpId = id;
  const emp = employees.find(e => e.id === id);
  if (!emp) return;
  document.getElementById('editId').value = emp.employeeId || '';
  document.getElementById('editName').value = emp.name || '';
  document.getElementById('editDept').value = emp.division || 'STOD';
  document.getElementById('editPosition').value = emp.position || '';
  document.getElementById('editEligibility').value = emp.eligibility || '';
  document.getElementById('editPromoDate').value = emp.lastPromotionDate || '';
  document.getElementById('editDate').value = emp.startDate || '';
  document.getElementById('editSalary').value = emp.currentSalary || '';
  document.getElementById('editModal').style.display = 'flex';

  const modalBody = document.querySelector('#editModal .modal-body');
  if (modalBody) modalBody.scrollTop = 0;
}

function closeEditModal() {
  document.getElementById('editModal').style.display = 'none';
  currentEditEmpId = null;
}

function closeEditModalOutside(e) {
  if (e.target.id === 'editModal') closeEditModal();
}

function submitEditEmployee() {
  if (!currentEditEmpId) return;
  const empIndex = employees.findIndex(e => e.id === currentEditEmpId);
  if (empIndex === -1) return;

  const empIdText = document.getElementById('editId').value;
  const name = document.getElementById('editName').value;
  const dept = document.getElementById('editDept').value;
  const position = document.getElementById('editPosition').value;
  const eligibility = document.getElementById('editEligibility').value;
  const promoDate = document.getElementById('editPromoDate').value;
  const date = document.getElementById('editDate').value;
  const salaryInput = document.getElementById('editSalary').value;

  const emp = employees[empIndex];
  if (!emp.salaryHistory) emp.salaryHistory = [emp.currentSalary];

  emp.employeeId = empIdText || '—';
  emp.name = name;
  emp.division = dept;
  emp.position = position;
  emp.eligibility = eligibility;
  emp.startDate = date;

  if (!emp.positionHistory) {
    emp.positionHistory = [emp.position];
  } else {
    emp.positionHistory[emp.positionHistory.length - 1] = position;
  }

  emp.lastPromotionDate = promoDate;
  emp.stepIncrementBaseDate = promoDate;
  if (!emp.lastPromotionDateHistory) {
    emp.lastPromotionDateHistory = [promoDate];
  } else if (emp.lastPromotionDateHistory.length > 0) {
    emp.lastPromotionDateHistory[emp.lastPromotionDateHistory.length - 1] = promoDate;
  } else {
    emp.lastPromotionDateHistory.push(promoDate);
  }

  const newSalary = parseFloat(salaryInput) || 0;
  emp.currentSalary = newSalary;
  // Overwrite the last history entry so they don't break rollback tracking if edited manually
  emp.salaryHistory[emp.salaryHistory.length - 1] = newSalary;

  saveEmployees(employees);
  closeEditModal();
  renderAll();
}

// ─── Duplicate Resolution Engine ──────────────────────────────────────────────

let duplicateQueue = [];
let currentDuplicateItem = null;
let duplicateQueueOnComplete = null;
let backupEmployeesBeforeImport = null;

function checkDuplicate(newEmp) {
  return employees.find(e =>
    (e.name.toLowerCase() === newEmp.name.toLowerCase()) ||
    (e.employeeId !== '—' && newEmp.employeeId !== '—' && e.employeeId === newEmp.employeeId)
  );
}

function processDuplicateQueue() {
  if (duplicateQueue.length === 0) {
    document.getElementById('duplicateModal').style.display = 'none';
    if (duplicateQueueOnComplete) duplicateQueueOnComplete();
    duplicateQueueOnComplete = null;
    backupEmployeesBeforeImport = null;
    return;
  }

  currentDuplicateItem = duplicateQueue.shift();
  const { oldEmp, newEmp } = currentDuplicateItem;

  document.getElementById('dupOldId').textContent = oldEmp.employeeId || '—';
  document.getElementById('dupOldName').textContent = oldEmp.name || '—';
  document.getElementById('dupOldDiv').textContent = oldEmp.division || '—';
  document.getElementById('dupOldPos').textContent = oldEmp.position || '—';
  document.getElementById('dupOldDate').textContent = formatDate(oldEmp.startDate) || '—';
  document.getElementById('dupOldSal').textContent = formatCurrency(oldEmp.currentSalary || 0);

  document.getElementById('dupNewId').textContent = newEmp.employeeId || '—';
  document.getElementById('dupNewName').textContent = newEmp.name || '—';
  document.getElementById('dupNewDiv').textContent = newEmp.division || '—';
  document.getElementById('dupNewPos').textContent = newEmp.position || '—';
  document.getElementById('dupNewDate').textContent = formatDate(newEmp.startDate) || '—';
  document.getElementById('dupNewSal').textContent = formatCurrency(newEmp.currentSalary || 0);

  document.getElementById('duplicateModal').style.display = 'flex';
}

let pendingBulkAction = null;

function promptBulkConfirm(action, title, message, btnText, bgGradient) {
  pendingBulkAction = action;
  const tEl = document.getElementById('bulkConfirmTitle');
  const mEl = document.getElementById('bulkConfirmMessage');
  const bEl = document.getElementById('bulkConfirmBtn');

  if (tEl) tEl.textContent = title;
  if (mEl) mEl.innerHTML = message;
  if (bEl) {
    bEl.textContent = btnText;
    bEl.style.background = bgGradient;
    bEl.style.borderColor = 'transparent';
    bEl.style.boxShadow = '0 4px 15px rgba(0,0,0,0.15)';
  }
  document.getElementById('bulkConfirmModal').style.display = 'flex';
}

function closeBulkConfirm() {
  document.getElementById('bulkConfirmModal').style.display = 'none';
  pendingBulkAction = null;
}

function closeBulkConfirmOutside(e) {
  if (e.target.id === 'bulkConfirmModal') closeBulkConfirm();
}

function executeBulkConfirm() {
  const action = pendingBulkAction;
  closeBulkConfirm();
  if (action) executeResolveDuplicate(action);
}

function resolveDuplicate(choice) {
  if (choice === 'cancelImport') {
    promptBulkConfirm('cancelImport', 'Cancel Import', 'Are you sure you want to cancel the entire import? <br><br><span style="color: var(--red); font-size: 13px; font-weight: 600;">No new data will be added and the database will be reverted.</span>', 'Yes, Cancel', 'linear-gradient(135deg, var(--red), #dc2626)');
    return;
  } else if (choice === 'keepAllOld') {
    promptBulkConfirm('keepAllOld', 'Keep All Old', 'Are you sure you want to discard <strong>ALL</strong> remaining new duplicates and keep your existing records?', 'Yes, Keep Old', 'linear-gradient(135deg, var(--text-muted), #475569)');
    return;
  } else if (choice === 'overrideAllNew') {
    promptBulkConfirm('overrideAllNew', 'Overwrite All', 'Are you sure you want to <strong>OVERWRITE ALL</strong> remaining duplicate matches with the newly imported data? <br><br><span style="color: var(--red); font-size: 13px; font-weight: 600;">This cannot be undone.</span>', 'Yes, Overwrite All', 'linear-gradient(135deg, var(--amber), #d97706)');
    return;
  } else if (choice === 'addAll') {
    promptBulkConfirm('addAll', 'Add All', 'Are you sure you want to <strong>ADD ALL</strong> remaining duplicates alongside existing records? This will create exact duplicate entries in the system.', 'Yes, Add All', 'linear-gradient(135deg, var(--teal), #059669)');
    return;
  }
  executeResolveDuplicate(choice);
}

function executeResolveDuplicate(choice) {
  if (!currentDuplicateItem) return;

  const { oldEmp, newEmp } = currentDuplicateItem;

  if (choice === 'cancelImport') {

    if (backupEmployeesBeforeImport) {
      employees = [...backupEmployeesBeforeImport];
    }
    duplicateQueue = [];
    document.getElementById('duplicateModal').style.display = 'none';
    duplicateQueueOnComplete = null;
    backupEmployeesBeforeImport = null;

    const succ = document.getElementById('csvSuccess');
    if (succ && document.getElementById('modal').style.display !== 'none') {
      succ.innerHTML = `Import was successfully canceled.<br>No data was added.`;
      succ.style.display = 'block';
      succ.style.background = 'var(--red)';

      setTimeout(() => {
        succ.style.display = 'none';
        closeModal();
      }, 2500);
    } else {
      alert('Import was successfully canceled. No data was added.');
    }

    renderAll();
    return;
  } else if (choice === 'keepAllOld') {
    duplicateQueue = [];
  } else if (choice === 'overrideAllNew') {
    const index = employees.findIndex(e => e.id === oldEmp.id);
    if (index > -1) {
      employees[index] = { ...newEmp, id: oldEmp.id };
    }
    duplicateQueue.forEach(item => {
      const idx = employees.findIndex(e => e.id === item.oldEmp.id);
      if (idx > -1) {
        employees[idx] = { ...item.newEmp, id: item.oldEmp.id };
      }
    });
    duplicateQueue = [];
  } else if (choice === 'addAll') {
    employees.push(newEmp);
    duplicateQueue.forEach(item => {
      employees.push(item.newEmp);
    });
    duplicateQueue = [];
  } else if (choice === 'keepNew') {
    const index = employees.findIndex(e => e.id === oldEmp.id);
    if (index > -1) {
      employees[index] = { ...newEmp, id: oldEmp.id };
    }
  } else if (choice === 'addBoth') {
    employees.push(newEmp);
  }

  processDuplicateQueue();
}


// ─── Modal Tabs & CSV Import ────────────────────────────────────────────────

function switchAddMode(mode) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('formManual').style.display = 'none';
  document.getElementById('formCsv').style.display = 'none';
  document.getElementById('footerManual').style.display = 'none';

  if (mode === 'manual') {
    document.getElementById('tabManual').classList.add('active');
    document.getElementById('formManual').style.display = 'flex';
    document.getElementById('footerManual').style.display = 'flex';
  } else {
    document.getElementById('tabCsv').classList.add('active');
    document.getElementById('formCsv').style.display = 'flex';
  }
}

function parseCSVLine(text) {
  let ret = [''], i = 0, p = '', s = true;
  for (let l = text; i < l.length; i++) {
    let c = l[i];
    if (c === '"') {
      if (s && c === '"') s = !s;
      else if (l[i + 1] && l[i + 1] === '"') { ret[ret.length - 1] += '"'; i++; }
      else s = !s;
    } else if (c === ',' && s) ret.push('');
    else ret[ret.length - 1] += c;
    p = c;
  }
  return ret;
}

function handleCsvUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const text = e.target.result;
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) {
      const succ = document.getElementById('csvSuccess');
      if (succ) {
        succ.textContent = "The CSV file seems to be empty or missing data.";
        succ.style.display = 'block';
        succ.style.background = 'var(--red)';
      } else {
        alert("The CSV file seems to be empty or missing data.");
      }
      return;
    }

    const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
    const idIdx = headers.indexOf('id');
    const nameIdx = headers.indexOf('name');
    const deptIdx = headers.indexOf('division');
    const posIdx = headers.indexOf('position title');
    const promoDateIdx = headers.indexOf('date of last promotion');
    const eligIdx = headers.indexOf('eligibility');
    const dateIdx = headers.indexOf('start date');
    const salaryIdx = headers.indexOf('salary');
    const stepsIdx = headers.indexOf('steps');

    if (idIdx === -1 || nameIdx === -1 || deptIdx === -1 || posIdx === -1 || eligIdx === -1 || stepsIdx === -1 || promoDateIdx === -1 || dateIdx === -1) {
      const succ = document.getElementById('csvSuccess');
      if (succ) {
        succ.textContent = "Error: CSV must include ID, Name, Division, Position Title, Eligibility, Steps, Date of Last Promotion, and Start Date.";
        succ.style.display = 'block';
        succ.style.background = 'var(--red)';
      } else {
        alert("Error: CSV must include ID, Name, Division, Position Title, Eligibility, Steps, Date of Last Promotion, and Start Date.");
      }
      return;
    }

    backupEmployeesBeforeImport = [...employees];

    let importedCount = 0;
    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVLine(lines[i]);
      // Skip empty or malformed rows that don't at least attempt to map to headers
      if (row.length === 0 || (row.length === 1 && row[0] === '')) continue;

      const csvId = idIdx > -1 ? (row[idIdx] || '').trim() : '';
      const name = nameIdx > -1 ? (row[nameIdx] || '').trim() : '';
      const dept = deptIdx > -1 ? (row[deptIdx] || '').trim() : '';
      const pos = posIdx > -1 ? (row[posIdx] || '').trim() : '';
      const elig = eligIdx > -1 ? (row[eligIdx] || '').trim() : '';
      const rawPromoDate = promoDateIdx > -1 ? (row[promoDateIdx] || '').trim() : '';
      let formattedPromoDate = '';
      if (rawPromoDate) {
        const pd = new Date(rawPromoDate);
        if (!isNaN(pd.getTime())) formattedPromoDate = pd.toISOString().split('T')[0];
      }
      const rawSteps = stepsIdx > -1 ? (row[stepsIdx] || '').trim() : '';
      const parsedSteps = parseInt(rawSteps) || 0;
      const rawDate = dateIdx > -1 ? (row[dateIdx] || '').trim() : '';
      const rawSalary = salaryIdx > -1 ? (row[salaryIdx] || '').trim().replace(/[^0-9.-]+/g, "") : '';

      if (!name || !rawDate) continue; // Name and Date are highly necessary

      // Date normalization to YYYY-MM-DD format commonly expected by input type="date"
      let formattedDate = rawDate;
      const parsedDate = new Date(rawDate);
      if (!isNaN(parsedDate.getTime())) {
        formattedDate = parsedDate.toISOString().split('T')[0];
      }

      const currentSalary = parseFloat(rawSalary) || 0;

      const newEmp = {
        id: Date.now().toString() + i, // Force unique ID per batch line
        employeeId: csvId || '—',
        name,
        division: dept,
        position: pos,
        positionHistory: [pos],
        lastPromotionDate: formattedPromoDate,
        lastPromotionDateHistory: [formattedPromoDate],
        eligibility: elig,
        startDate: formattedDate,
        currentSalary,
        promotionCount: parsedSteps
      };

      const oldEmp = checkDuplicate(newEmp);
      if (oldEmp) {
        duplicateQueue.push({ oldEmp, newEmp });
      } else {
        employees.push(newEmp);
      }

      importedCount++;
    }

    const showCsvSuccess = (count) => {
      const succ = document.getElementById('csvSuccess');
      if (succ) {
        succ.textContent = `Success! Imported ${count} employees.`;
        succ.style.display = 'block';
        succ.style.background = 'var(--teal)';
        setTimeout(() => {
          succ.style.display = 'none';
          closeModal();
        }, 1500);
      } else {
        alert(`Success! Imported ${count} employees.`);
        closeModal();
      }
    };

    if (importedCount > 0) {
      if (duplicateQueue.length > 0) {
        duplicateQueueOnComplete = () => {
          saveEmployees(employees);
          renderAll();
          showCsvSuccess(importedCount);
        };
        processDuplicateQueue();
      } else {
        saveEmployees(employees);
        renderAll();
        showCsvSuccess(importedCount);
      }
    } else {
      const succ = document.getElementById('csvSuccess');
      if (succ) {
        succ.textContent = "No valid employee records found to import.";
        succ.style.display = 'block';
        succ.style.background = 'var(--red)';
      } else {
        alert("No valid employee records found to import.");
      }
    }
  };

  reader.readAsText(file);
  event.target.value = ''; // Reset input to allow re-uploading the exact same file
}

// ─── Theme Toggle ────────────────────────────────────────────────────────────

function initTheme() {
  const savedTheme = localStorage.getItem('servicetrack_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function executeThemeToggle() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('servicetrack_theme', newTheme);
  updateThemeIcon(newTheme);
}

function toggleTheme() {
  if (document.startViewTransition) {
    document.documentElement.classList.add('theme-transitioning');
    const transition = document.startViewTransition(() => {
      executeThemeToggle();
    });
    transition.finished.finally(() => {
      document.documentElement.classList.remove('theme-transitioning');
    });
  } else {
    document.documentElement.classList.add('theme-transitioning');
    executeThemeToggle();
    setTimeout(() => {
      document.documentElement.classList.remove('theme-transitioning');
    }, 50);
  }
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if (icon && label) {
    icon.innerHTML = theme === 'dark' ? '&#9728;' : '&#9789;'; // Sun / Moon
    label.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
  }
}

// ─── Sidebar Toggle ──────────────────────────────────────────────────────────

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const main = document.querySelector('.main');
  if (sidebar && main) {
    if (window.innerWidth <= 768) {
      sidebar.classList.toggle('mobile-open');
    } else {
      sidebar.classList.toggle('collapsed');
      main.classList.toggle('collapsed');
    }
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────

initTheme();
loadDataFromAPI().then(() => {
  renderAll();
});

// ─── Scroll to Top ──────────────────────────────────────────────────────────

function checkScrollVisibility() {
  const btn = document.getElementById("scrollToTopBtn");
  if (!btn) return;
  let cardScrolled = false;
  document.querySelectorAll('.table-card').forEach(c => {
    if (c.scrollTop > 200) cardScrolled = true;
  });
  if (document.body.scrollTop > 200 || document.documentElement.scrollTop > 200 || cardScrolled) {
    btn.classList.add("visible");
  } else {
    btn.classList.remove("visible");
  }
}

window.addEventListener('scroll', checkScrollVisibility);

document.querySelectorAll('.table-card').forEach(card => {
  card.addEventListener('scroll', checkScrollVisibility);
});

function fastScrollToTop() {
  const c = document.documentElement.scrollTop || document.body.scrollTop;
  let scrolling = false;

  if (c > 0) {
    window.scrollTo(0, c - Math.max(1, c / 4));
    scrolling = true;
  }

  document.querySelectorAll('.table-card').forEach(card => {
    const cardTop = card.scrollTop;
    if (cardTop > 0) {
      card.scrollTop = cardTop - Math.max(1, cardTop / 4);
      if (card.scrollTop > 0) {
        scrolling = true;
      }
    }
  });

  if (scrolling) {
    window.requestAnimationFrame(fastScrollToTop);
  }
}

function clearSearch(inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.focus();
  }
}

function toggleClearIcon(input) {
  const clearIcon = input.nextElementSibling;
  if (clearIcon && clearIcon.classList.contains('clear-icon')) {
    clearIcon.style.display = input.value.length > 0 ? 'flex' : 'none';
  }
}