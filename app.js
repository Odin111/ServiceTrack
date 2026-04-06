// ─── Data Layer ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'servicetrack_employees';
const DISMISSED_KEY = 'servicetrack_dismissed';

function loadEmployees() {
  try { 
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); 
    return data.map(emp => {
      // Migrate department to division seamlessly
      if (emp.department !== undefined && emp.division === undefined) {
        emp.division = emp.department;
        delete emp.department;
      }
      return emp;
    });
  } catch { return []; }
}

function saveEmployees(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadDismissed() {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'); } catch { return []; }
}

function saveDismissed(data) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(data));
}

let employees = loadEmployees();
let dismissed = loadDismissed();

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
  const target = new Date(new Date(startDate).getTime() + milestoneYears * 365.25 * 24 * 60 * 60 * 1000);
  return Math.ceil((target - Date.now()) / (1000 * 60 * 60 * 24));
}

function milestoneDate(startDate, milestoneYears) {
  return new Date(new Date(startDate).getTime() + milestoneYears * 365.25 * 24 * 60 * 60 * 1000);
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

function getSoonestEvent(startDate) {
  const yrs = yearsWorked(startDate);
  const nextL = nextMilestone(yrs);
  const daysL = daysUntilMilestone(startDate, nextL.milestone);
  
  const nextS = nextSalaryMilestone(yrs);
  const daysS = daysUntilMilestone(startDate, nextS.milestone);

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
    getPastSalaryMilestones(years).forEach(m => {
      const key = `${emp.id}_salary_${m}`;
      notifs.push({ type: 'milestone', emp, milestone: m, key, dismissed: dismissed.includes(key), ntype: 'salary' });
    });

    const nextS = nextSalaryMilestone(years);
    const daysS = daysUntilMilestone(emp.startDate, nextS.milestone);
    if (daysS > 0 && daysS <= 90) {
      const key = `${emp.id}_upcomingsal_${nextS.milestone}`;
      notifs.push({ type: 'upcoming', emp, milestone: nextS.milestone, daysLeft: daysS, key, dismissed: dismissed.includes(key), ntype: 'salary' });
    }
  });
  return notifs;
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

function promotionBadge(count) {
  if (!count || count === 0) return '<span class="badge badge-gray" style="font-weight:500">Step 0</span>';
  return `<span class="badge badge-blue">Step ${count}</span>`;
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
        <div class="upcoming-meta">${n.emp.division || '—'} · ${n.milestone}-year ${n.ntype === 'salary' ? 'Salary Adjustment' : (n.milestone % 10 === 0 ? 'Loyalty Award' : 'milestone')} on ${formatDate(milestoneDate(n.emp.startDate, n.milestone))}</div>
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
      currentEmployees = currentEmployees.filter(emp => {
        return (emp.name && emp.name.toLowerCase().includes(q)) ||
               (emp.employeeId && emp.employeeId.toLowerCase().includes(q)) ||
               (emp.division && emp.division.toLowerCase().includes(q));
      });
    }
  }

  const sortSelect = document.getElementById('empSortSelect');
  if (sortSelect) {
    const sortVal = sortSelect.value;
    currentEmployees.sort((a, b) => {
      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      const divA = (a.division || '').toLowerCase();
      const divB = (b.division || '').toLowerCase();
      const yearsA = yearsWorked(a.startDate);
      const yearsB = yearsWorked(b.startDate);
      const promoA = a.promotionCount || 0;
      const promoB = b.promotionCount || 0;

      switch(sortVal) {
        case 'name_asc': return nameA.localeCompare(nameB);
        case 'name_desc': return nameB.localeCompare(nameA);
        case 'div_asc': return divA.localeCompare(divB);
        case 'years_desc': return yearsB - yearsA;
        case 'years_asc': return yearsA - yearsB;
        case 'promo_desc': return promoB - promoA;
        case 'promo_asc': return promoA - promoB;
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
    const soonest = getSoonestEvent(emp.startDate);
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
        <td>${promotionBadge(emp.promotionCount || 0)}</td>
        <td>
          <div class="progress-wrap">
            <span style="font-weight:600;min-width:32px;">${years.toFixed(1)}</span>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          </div>
        </td>
        <td style="font-size:13px;">
          ${soonest.label}<br>
          <span style="color:var(--text-hint);font-size:11px;">${soonest.daysLeft > 0 ? `in ${soonest.daysLeft} days` : 'Due now!'}</span>
        </td>
        <td>${statusBadge(years)}</td>
        <td>
           <div style="display:flex;gap:4px;">
              <button class="btn-icon blue" onclick="openEditModal('${emp.id}')">Edit</button>
              <button class="btn-icon teal" onclick="openPromoteModal('${emp.id}')">Promote</button>
              <button class="btn-icon amber" onclick="openDemoteModal('${emp.id}')" ${(emp.promotionCount || 0) === 0 ? 'disabled' : ''}>Demote</button>
              <button class="btn-icon" onclick="removeEmployee('${emp.id}')">Remove</button>
           </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderNotifications() {
  const notifs = getNotifications();
  const active = notifs.filter(n => !n.dismissed);
  const el = document.getElementById('notifContainer');

  if (active.length === 0) {
    el.innerHTML = `<div class="notif-empty">
      No active notifications. Milestone alerts appear when an employee reaches 10 years, then every 5 years after.
    </div>`;
    return;
  }

  el.innerHTML = `<div class="notif-list">${active.map(n => {
    if (n.type === 'milestone') {
      const isSalary = n.ntype === 'salary';
      const eventTitle = isSalary 
          ? `${n.emp.name} is due for a ${n.milestone}-year Salary Update!` 
          : `${n.emp.name} has reached ${n.milestone} years of service! ${n.milestone % 10 === 0 ? '(Loyalty Award)' : ''}`;
      
      const subTitle = isSalary
          ? `${n.emp.division || 'No division'} · Due since ${formatDate(milestoneDate(n.emp.startDate, n.milestone))}`
          : `${n.emp.division || 'No division'} · Started ${formatDate(n.emp.startDate)} · Admin recognition recommended`;

      const extraAction = isSalary 
          ? `<button class="btn-primary" style="margin-top: 12px; font-size: 13px; padding: 6px 14px; background: var(--teal); box-shadow: none;" onclick="openSalaryModal('${n.emp.id}', '${n.key}')">Update Salary</button>`
          : `<button class="btn-primary" style="margin-top: 12px; font-size: 13px; padding: 6px 14px; box-shadow: none;" onclick="dismissNotif('${n.key}')">Mark as recognized</button>`;

      return `
        <div class="notif-card milestone">
          <div class="notif-icon milestone" style="${isSalary ? 'background: var(--teal); animation: none;' : ''}">${isSalary ? '₱' : '&#9733;'}</div>
          <div class="notif-body">
            <div class="notif-title">${eventTitle}</div>
            <div class="notif-sub">${subTitle}</div>
            <div style="display:flex; gap: 8px;">
              ${extraAction}
              <button class="notif-dismiss" onclick="dismissNotif('${n.key}')">Dismiss</button>
            </div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="notif-card upcoming">
          <div class="notif-icon upcoming">&#8987;</div>
          <div class="notif-body">
            <div class="notif-title">${n.emp.name} — ${n.milestone}-year ${n.ntype === 'salary' ? 'Salary Adjustment' : (n.milestone % 10 === 0 ? 'Loyalty Award' : 'milestone')} in ${n.daysLeft} days</div>
            <div class="notif-sub">
              ${n.emp.division || 'No division'} · Milestone date: ${formatDate(milestoneDate(n.emp.startDate, n.milestone))}
            </div>
            <button class="notif-dismiss" onclick="dismissNotif('${n.key}')">Dismiss</button>
          </div>
        </div>
      `;
    }
  }).join('')}</div>`;
}

function renderSidebarBadge() {
  const count = activeNotifCount();
  const badge = document.getElementById('sidebarBadge');
  badge.textContent = count > 0 ? count : '';
  badge.style.display = count > 0 ? '' : 'none';
}

function renderAll() {
  renderMetrics();
  renderUpcoming();
  renderTable();
  renderNotifications();
  renderSidebarBadge();
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

  if (!name || !date || !salaryInput) { alert('Please provide a name, start date, and starting salary.'); return; }

  const currentSalary = parseFloat(salaryInput) || 0;
  const newEmp = { 
    id: Date.now().toString(), employeeId: empIdText || '—', name, division: dept, 
    position: currentPosition, positionHistory: [currentPosition], 
    lastPromotionDate: '', lastPromotionDateHistory: [''],
    eligibility, startDate: date, currentSalary, promotionCount: 0 
  };

  const oldEmp = checkDuplicate(newEmp);
  if (oldEmp) {
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

function dismissNotif(key) {
  if (!dismissed.includes(key)) dismissed.push(key);
  saveDismissed(dismissed);
  renderAll();
}

function clearAllDismissed() {
  dismissed = [];
  saveDismissed(dismissed);
  renderAll();
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

  const currentCount = emp.promotionCount || 0;
  if (currentCount <= 0) {
    alert('This employee is at Step 0 and cannot be demoted further.');
    return;
  }

  currentDemoteEmpId = id;
  const nameEl = document.getElementById('demoteEmpName');
  if (nameEl) nameEl.textContent = emp.name;

  const modal = document.getElementById('demoteModal');
  if (modal) modal.style.display = 'flex';
}

function closeDemoteModal() {
  const modal = document.getElementById('demoteModal');
  if (modal) modal.style.display = 'none';
  currentDemoteEmpId = null;
}

function closeDemoteModalOutside(e) {
  if (e.target.id === 'demoteModal') closeDemoteModal();
}

function submitDemote() {
  if (!currentDemoteEmpId) return;
  const emp = employees.find(e => e.id === currentDemoteEmpId);
  if (emp) {
    emp.promotionCount = (emp.promotionCount || 0) - 1;
    if (emp.positionHistory && emp.positionHistory.length > 1) {
      emp.positionHistory.pop();
      emp.position = emp.positionHistory[emp.positionHistory.length - 1];
    }
    if (emp.lastPromotionDateHistory && emp.lastPromotionDateHistory.length > 0) {
      emp.lastPromotionDateHistory.pop();
      emp.lastPromotionDate = emp.lastPromotionDateHistory.length > 0 ? emp.lastPromotionDateHistory[emp.lastPromotionDateHistory.length - 1] : '';
    }
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
    if (posInput) {
      posInput.value = emp ? (emp.position || '') : '';
    }
    
    const errDiv = document.getElementById('promoteError');
    if (errDiv) errDiv.textContent = '';
    
    const modal = document.getElementById('promoteModal');
    if (modal) {
      modal.style.display = 'flex';
    }
    
    if (posInput) posInput.focus();
  } catch(e) {
    console.error("Open Promote Modal Error:", e);
  }
}

function closePromoteModal() {
  const modal = document.getElementById('promoteModal');
  if (modal) modal.style.display = 'none';
  
  const posInput = document.getElementById('inputNewPosition');
  if (posInput) posInput.value = '';
  
  const errDiv = document.getElementById('promoteError');
  if (errDiv) errDiv.textContent = '';
  
  currentPromoteEmpId = null;
}

function submitPromotion() {
  try {
    if (!currentPromoteEmpId) return;
    
    const posInput = document.getElementById('inputNewPosition');
    const newPosition = posInput ? posInput.value.trim() : '';
    const errDiv = document.getElementById('promoteError');
    
    if (!newPosition) {
      if (errDiv) errDiv.textContent = 'Please specify the new position.';
      return;
    }

    const empIndex = employees.findIndex(e => e.id === currentPromoteEmpId);
    if (empIndex > -1) {
      const emp = employees[empIndex];

      if (newPosition.toLowerCase() === (emp.position || '').toLowerCase()) {
        if (errDiv) errDiv.textContent = 'Promotion rejected: already in this position.';
        return;
      }

      if (!emp.positionHistory) {
         emp.positionHistory = [emp.position || ''];
      }
      if (!emp.lastPromotionDateHistory) {
         emp.lastPromotionDateHistory = [emp.lastPromotionDate || ''];
      }
      emp.positionHistory.push(newPosition);
      emp.lastPromotionDateHistory.push(new Date().toISOString().split('T')[0]);
      emp.position = newPosition;
      emp.lastPromotionDate = new Date().toISOString().split('T')[0];

      saveEmployees(employees);
      renderAll();
    }
    closePromoteModal();
  } catch(e) {
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
  } catch(e) {
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

      if (currentSalaryNotifKey) {
        dismissNotif(currentSalaryNotifKey);
      }

      saveEmployees(employees);
      renderAll();
    }
    closeSalaryModal();
  } catch(e) {
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
  document.getElementById('editDate').value = emp.startDate || '';
  document.getElementById('editSalary').value = emp.currentSalary || '';
  document.getElementById('editModal').style.display = 'flex';
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

  const empIdText = document.getElementById('editId').value.trim();
  const name = document.getElementById('editName').value.trim();
  const dept = document.getElementById('editDept').value;
  const position = document.getElementById('editPosition').value.trim();
  const eligibility = document.getElementById('editEligibility').value.trim();
  const date = document.getElementById('editDate').value;
  const salaryInput = document.getElementById('editSalary').value;

  if (!name || !date || !salaryInput) {
    alert('Please provide a name, start date, and starting salary.');
    return;
  }

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

function resolveDuplicate(choice) {
  if (!currentDuplicateItem) return;

  const { oldEmp, newEmp } = currentDuplicateItem;

  if (choice === 'keepNew') {
    const index = employees.findIndex(e => e.id === oldEmp.id);
    if (index > -1) {
      // Overwrite entirely, retaining the original ID so lists don't break
      employees[index] = { ...newEmp, id: oldEmp.id };
    }
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

    if (nameIdx === -1 || dateIdx === -1 || salaryIdx === -1 || promoDateIdx === -1) {
      const succ = document.getElementById('csvSuccess');
      if (succ) {
         succ.textContent = "CSV must match these headers: ID, Name, Division, Position Title, Date of Last Promotion, Eligibility, Start Date, Salary.";
         succ.style.display = 'block';
         succ.style.background = 'var(--red)';
      } else {
         alert("CSV must contain exactly these headers: ID, Name, Division, Position Title, Date of Last Promotion, Eligibility, Start Date, Salary.");
      }
      return;
    }

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
        promotionCount: 0
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

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('servicetrack_theme', newTheme);
  updateThemeIcon(newTheme);
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
renderAll();
