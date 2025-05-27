let currentManager = null;
let currentPlayer = null;
let currentAdmin = false;
const API_URL = "https://player-trading-backend.supabase.co";
let activeTab = 'info';
let teams = [];
let players = [];
const SALARY_CAP = 500000;
const INITIAL_MANAGER_BUDGET = 600000;

const showModal = (msg) => {
  document.getElementById('modalMessage').textContent = msg;
  document.getElementById('modal').style.display = 'flex';
};

const closeModal = () => {
  document.getElementById('modal').style.display = 'none';
};

const fetchData = async (endpoint, query = {}) => {
  try {
    const url = new URL(`${API_URL}/api/${endpoint}`);
    url.search = new URLSearchParams(query).toString();
    const res = await fetch(url, {
      headers: currentAdmin ? { 'admin-auth': 'true' } : {}
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    console.error(`Fetch error for ${endpoint}:`, error);
    throw error;
  }
};

const postData = async (endpoint, data, headers = {}) => {
  try {
    const res = await fetch(`${API_URL}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0anZkaGhhYm5lZnpvYWZ6cGRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxMTcwNTUsImV4cCI6MjA2MzY5MzA1NX0.3eUla2G9QJmRqOWX7ZdVCWoEwt8OG6ij3gKJJgnjc_Y', // Add your Supabase anon key
        'Authorization': `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0anZkaGhhYm5lZnpvYWZ6cGRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxMTcwNTUsImV4cCI6MjA2MzY5MzA1NX0.3eUla2G9QJmRqOWX7ZdVCWoEwt8OG6ij3gKJJgnjc_Y`, // For authenticated requests
        ...headers,
        ...(currentAdmin ? { 'admin-auth': 'true' } : {})
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    console.error(`Post error for ${endpoint}:`, error);
    throw error;
  }
};

const showTab = (tabName) => {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
  document.querySelectorAll('.sidebar button').forEach(btn => btn.classList.remove('active'));
  const tab = document.getElementById(tabName);
  if (tab) {
    tab.classList.remove('hidden');
    const btn = document.querySelector(`button[data-tab="${tabName}"]`);
    if (btn) btn.classList.add('active');
    activeTab = tabName;
    refreshData();
  } else {
    console.error(`Tab ${tabName} not found`);
    showModal(`Tab ${tabName} not found`);
  }
};

const refreshData = async () => {
  try {
    const actions = {
      info: () => {},
      news: loadNews,
      statistics: loadStatistics,
      teamManagers: loadTeamManagers,
      teams: loadTeamsTab,
      salaries: loadSalaries,
      waiverList: loadWaiverList,
      tradeHistory: loadTradeHistory,
      teamBudgets: loadTeamBudgets,
      managerLogin: loadManagerLogin,
      playerLogin: currentPlayer ? loadPlayerDashboard : () => {},
      admin: loadAdminTab,
      help: () => {},
    };
    await actions[activeTab]?.();
  } catch (error) {
    showModal(`Error loading ${activeTab}: ${error.message}`);
  }
};

const loadNews = async () => {
  try {
    const news = await fetchData('news');
    document.getElementById('newsDisplay').innerHTML = news.length
      ? news.map(n => `<p>${n.message} <span style="color: #999;">${new Date(n.timestamp).toLocaleString()}</span></p>`).join('')
      : '<p>No news available.</p>';
  } catch (error) {
    document.getElementById('newsDisplay').innerHTML = '<p>Failed to load news.</p>';
    console.error('News error:', error);
  }
};

const loadStatistics = async () => {
  try {
    const counts = await fetchData('counts');
    const players = await fetchData('players');
    const totalSalary = players.reduce((sum, p) => sum + (p.salary || 0), 0);
    const avgSalary = players.length ? Math.round(totalSalary / players.length) : 0;
    document.getElementById('statsDisplay').innerHTML = `
      <p>Signed Players: ${counts.playerCount || 0}</p>
      <p>Team Managers: ${counts.managerCount || 0}</p>
      <p>Total Bids: ${counts.totalBids || 0}</p>
      <p>Waiver Listed Players: ${counts.waiverCount || 0}</p>
      <p>Average Salary: $${avgSalary}</p>
      <p>Teams: ${counts.teamCount || 0}</p>
    `;
  } catch (error) {
    document.getElementById('statsDisplay').innerHTML = '<p>Failed to load statistics.</p>';
    console.error('Statistics error:', error);
  }
};

const loadManagers = async () => {
  try {
    const managers = await fetchData('managers');
    console.log('Managers for dropdown:', managers);
    const select = document.getElementById('managerSelect');
    if (!select) {
      console.error('Manager select element not found');
      return [];
    }
    select.innerHTML = '<option value="">Select Manager</option>';
    if (!managers || managers.length === 0) {
      select.innerHTML += '<option value="" disabled>No managers available</option>';
      return [];
    }
    managers.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name} (${m.team?.name || 'Inactive'})`;
      select.appendChild(opt);
    });
    return managers;
  } catch (error) {
    console.error('Load managers error:', error);
    const select = document.getElementById('managerSelect');
    if (select) {
      select.innerHTML = '<option value="" disabled>Failed to load managers</option>';
    }
    return [];
  }
};

const loadPlayers = async () => {
  try {
    players = await fetchData('players');
    return players;
  } catch (error) {
    console.error('Load players error:', error);
    return [];
  }
};

const loadTeams = async () => {
  try {
    teams = await fetchData('teams');
  } catch (error) {
    console.error('Load teams error:', error);
  }
};

const loadTeamManagers = async () => {
  try {
    const managers = await fetchData('managers');
    console.log('Managers fetched for Team Managers tab:', managers);
    const teamManagersList = document.getElementById('teamManagersList');
    if (!managers || managers.length === 0) {
      teamManagersList.innerHTML = '<p>No managers found.</p>';
      return;
    }
    teamManagersList.innerHTML = managers.map(m => `
      <div style="background: #2c3e50; padding: 16px; margin-bottom: 8px;">
        <p>Name: ${m.name || 'Unknown'}</p>
        <p>Team: ${m.team?.name || 'Inactive'}</p>
      </div>
    `).join('');
    if (currentManager) {
      document.getElementById('managerActions').classList.remove('hidden');
      const playerSelect = document.getElementById('managerPlayerSelect');
      playerSelect.innerHTML = '<option value="">Select Team Player</option>';
      const teamPlayers = (await fetchData(`teams/${currentManager.team_id}`)).players || [];
      teamPlayers.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        playerSelect.appendChild(opt);
      });
    } else {
      document.getElementById('managerActions').classList.add('hidden');
    }
  } catch (error) {
    document.getElementById('teamManagersList').innerHTML = '<p>Failed to load managers.</p>';
    console.error('Team managers error:', error);
  }
};

const loadTeamsTab = async () => {
  try {
    const teamsData = await fetchData('teams');
    const salaryData = await fetchData('team-salaries'); // New endpoint for the view
    const playersData = await fetchData('players');
    document.getElementById('teamsList').innerHTML = teamsData.map(t => {
      const teamPlayers = playersData.filter(p => p.team_id === t.id);
      const salaryInfo = salaryData.find(s => s.team_id === t.id) || {};
      return `
        <div style="background: #2c3e50; padding: 16px; margin-bottom: 8px;">
          <h3>${t.name}</h3>
          <p>Budget: $${t.budget || 0}</p>
          <p>Total Salary: $${salaryInfo.total_salary || 0}</p>
          <p>Salary Cap Status: ${salaryInfo.cap_status || 'Under Cap'}</p>
          <p>Players: ${teamPlayers.map(p => p.name).join(', ') || 'None'}</p>
        </div>
      `;
    }).join('');
  } catch (error) {
    document.getElementById('teamsList').innerHTML = '<p>Failed to load teams.</p>';
    console.error('Teams error:', error);
  }
};

const loadSalaries = async () => {
  try {
    const playersData = await fetchData('players');
    const teamsData = await fetchData('teams');
    const salaryData = await fetchData('team-salaries');
    let html = '<h3>Team Rosters</h3>';
    teamsData.forEach(team => {
      const teamPlayers = playersData.filter(p => p.team_id === team.id);
      const salaryInfo = salaryData.find(s => s.team_id === team.id) || {};
      const totalSalary = salaryInfo.total_salary || 0;
      html += `
        <button class="collapsible">${team.name} (Manager: ${team.manager?.name || 'None'}) - Total Salary: $${totalSalary.toLocaleString()} (${salaryInfo.cap_status || 'Under Cap'})</button>
        <div class="content">
          <ul style="list-style-type: disc; margin-left: 20px;">
      `;
      if (teamPlayers.length === 0) {
        html += '<li>No players in roster.</li>';
      } else {
        teamPlayers.forEach(player => {
          html += `
            <li>
              ${player.name} - $${player.salary.toLocaleString()}
              ${currentManager?.id === team.manager_id ? `<button onclick="sellPlayer(${team.id}, ${player.id})" class="btn-danger" style="width: auto; margin-left: 10px;">Sell</button>` : ''}
            </li>
          `;
        });
      }
      html += `
          </ul>
        </div>
      `;
    });

    html += '<h3>Waiver List Players</h3>';
    const waiverPlayers = playersData.filter(p => !p.team_id);
    if (waiverPlayers.length === 0) {
      html += '<p>No players in waiver list.</p>';
    } else {
      html += '<ul style="list-style-type: disc; margin-left: 20px;">';
      waiverPlayers.forEach(player => {
        html += `
          <li>
            ${player.name} - $${player.salary.toLocaleString()}
            ${currentManager ? `<button onclick="bidOnPlayer(${player.id}, ${player.salary})" class="btn-success" style="width: auto; margin-left: 10px;">Bid</button>` : ''}
          </li>
        `;
      });
      html += '</ul>';
    }

    document.getElementById('salariesList').innerHTML = html;

    document.querySelectorAll('.collapsible').forEach(button => {
      button.addEventListener('click', function() {
        this.classList.toggle('active');
        const content = this.nextElementSibling;
        if (content.style.display === 'block') {
          content.style.display = 'none';
        } else {
          content.style.display = 'block';
        }
      });
    });
  } catch (error) {
    document.getElementById('salariesList').innerHTML = '<p>Failed to load salaries.</p>';
    console.error('Salaries error:', error);
  }
};

const loadWaiverList = async () => {
  try {
    const playersData = await fetchData('players');
    const waiverPlayers = playersData.filter(p => !p.team_id);
    document.getElementById('waiverListContent').innerHTML = waiverPlayers.map(p => `
      <div style="background: #2c3e50; padding: 16px; margin-bottom: 8px;">
        <p>Name: ${p.name}</p>
        <p>Salary: $${p.salary || 0}</p>
      </div>
    `).join('');
  } catch (error) {
    document.getElementById('waiverListContent').innerHTML = '<p>Failed to load waiver list.</p>';
    console.error('Waiver list error:', error);
  }
};

const loadTradeHistory = async () => {
  try {
    const trades = await fetchData('trades');
    document.getElementById('tradeHistoryList').innerHTML = trades.length
      ? trades.map(t => `<p>${t.details} (${new Date(t.timestamp).toLocaleString()})</p>`).join('')
      : '<p>No trade history available.</p>';
  } catch (error) {
    document.getElementById('tradeHistoryList').innerHTML = '<p>Failed to load trade history.</p>';
    console.error('Trade history error:', error);
  }
};

const loadTeamBudgets = async () => {
  try {
    const salaryData = await fetchData('team-salaries');
    document.getElementById('teamBudgetsList').innerHTML = salaryData.map(s => `
      <div style="background: #2c3e50; padding: 16px; margin-bottom: 8px;">
        <p>Team: ${s.team_name}</p>
        <p>Budget: $${s.team_budget || 0}</p>
        <p>Total Salary: $${s.total_salary || 0}</p>
        <p>Salary Cap Status: ${s.cap_status || 'Under Cap'}</p>
      </div>
    `).join('');
  } catch (error) {
    document.getElementById('teamBudgetsList').innerHTML = '<p>Failed to load team budgets.</p>';
    console.error('Team budgets error:', error);
  }
};

const loadManagerLogin = async () => {
  try {
    await loadManagers();
    const dashboard = document.getElementById('managerDashboard');
    const loginFormElements = [
      document.getElementById('managerSelect'),
      document.getElementById('managerPassword'),
      document.getElementById('verifyManagerBtn')
    ];
    if (currentManager) {
      await loadManagerDashboard();
      dashboard.classList.remove('hidden');
      loginFormElements.forEach(el => el.classList.add('hidden'));
    } else {
      dashboard.classList.add('hidden');
      loginFormElements.forEach(el => el.classList.remove('hidden'));
    }
  } catch (error) {
    showModal('Error loading manager login: ' + error.message);
  }
};

const loadManagerDashboard = async () => {
  if (!currentManager) {
    document.getElementById('managerStats').innerHTML = '<p>Please log in.</p>';
    document.getElementById('managerDashboard').classList.add('hidden');
    return;
  }
  try {
    const data = await fetchData(`managers/${currentManager.id}`);
    currentManager.team = data.team || {};
    const stats = document.getElementById('managerStats');
    stats.innerHTML = `
      <p><strong>Name:</strong> ${currentManager.name}</p>
      <p><strong>Team:</strong> ${data.team?.name || 'None'}</p>
      <p><strong>Players:</strong> ${(data.team?.players || []).map(p => p.name).join(', ') || 'None'}</p>
      <p><strong>Budget:</strong> $${data.team?.budget || 0}</p>
    `;
    document.getElementById('managerDashboard').classList.remove('hidden');
  } catch (error) {
    document.getElementById('managerStats').innerHTML = '<p>Failed to load dashboard.</p>';
    console.error('Manager dashboard error:', error);
    showModal('Error loading dashboard: ' + error.message);
  }
};

const verifyManager = async () => {
  try {
    const id = document.getElementById('managerSelect').value;
    const password = document.getElementById('managerPassword').value;
    if (!id) return showModal('Please select a manager');
    if (!password) return showModal('Please enter a password');
    currentManager = await postData('managers/verify', { id, password });
    showModal(`Welcome, ${currentManager.name}! You are now logged in as a manager.`);
    document.getElementById('managerPassword').value = '';
    await loadManagerLogin();
    refreshData();
  } catch (error) {
    showModal('Error verifying manager: ' + error.message);
  }
};

const logoutManager = async () => {
  currentManager = null;
  showModal('You have been logged out.');
  await loadManagerLogin();
  refreshData();
};

const quitManagerRole = async () => {
  if (!currentManager || !confirm('Are you sure you want to quit your manager role?')) return;
  try {
    const data = await postData('managers/quit', { managerId: currentManager.id });
    showModal(data.message);
    currentManager = null;
    document.getElementById('managerDashboard').classList.add('hidden');
    document.getElementById('managerActions').classList.add('hidden');
    refreshData();
  } catch (error) {
    showModal('Error quitting manager role: ' + error.message);
  }
};

const nominateManager = async () => {
  if (!currentManager) return showModal('You must be logged in as a manager');
  const playerId = document.getElementById('managerPlayerSelect').value;
  if (!playerId) return showModal('Please select a player');
  try {
    const data = await postData('managers/nominate', {
      managerId: currentManager.id,
      playerId
    }, { 'manager-id': currentManager.id });
    showModal(data.message);
    currentManager = null;
    document.getElementById('managerDashboard').classList.add('hidden');
    document.getElementById('managerActions').classList.add('hidden');
    refreshData();
  } catch (error) {
    showModal('Error nominating manager: ' + error.message);
  }
};

const loadAdminTab = async () => {
  try {
    document.getElementById('adminLogin').classList.toggle('hidden', currentAdmin);
    document.getElementById('adminSection').classList.toggle('hidden', !currentAdmin);
    document.getElementById('adminMessage').classList.toggle('hidden', currentAdmin);
    if (!currentAdmin) return;

    const managers = await fetchData('managers');
    const adminManagerSelect = document.getElementById('adminManagerSelect');
    adminManagerSelect.innerHTML = '<option value="">Select Manager</option>';
    if (!managers || managers.length === 0) {
      adminManagerSelect.innerHTML += '<option value="" disabled>No managers available</option>';
    } else {
      managers.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        adminManagerSelect.appendChild(opt);
      });
    }

    const playersData = await fetchData('players');
    const adminPlayerSelect = document.getElementById('adminPlayerSelect');
    const waiverPlayerSelect = document.getElementById('waiverPlayerSelect');
    const salarySelect = document.getElementById('salaryPlayerSelect');
    [adminPlayerSelect, waiverPlayerSelect, salarySelect].forEach(select => {
      select.innerHTML = '<option value="">Select Player</option>';
      if (!playersData || playersData.length === 0) {
        select.innerHTML += '<option value="" disabled>No players available</option>';
      } else {
        playersData.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name;
          select.appendChild(opt);
        });
      }
    });

    const teamsData = await fetchData('teams');
    const adminTeamSelect = document.getElementById('adminTeamSelect');
    const newTeamNameInput = document.getElementById('newTeamNameInput');
    adminTeamSelect.innerHTML = '<option value="">Select Team</option>';
    if (!teamsData || teamsData.length === 0) {
      adminTeamSelect.innerHTML += '<option value="" disabled>No teams available</option>';
      newTeamNameInput.style.display = 'block';
    } else {
      newTeamNameInput.style.display = 'none';
      teamsData.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name;
        adminTeamSelect.appendChild(opt);
      });
    }
  } catch (error) {
    console.error('Admin tab error:', error);
    showModal('Error loading admin panel: ' + error.message);
  }
};

const loginAdmin = async () => {
  try {
    const username = document.getElementById('adminUsername').value;
    const password = document.getElementById('adminPassword').value;
    await postData('admin/login', { username, password });
    currentAdmin = true;
    showModal('Logged in as admin');
    loadAdminTab();
  } catch (error) {
    showModal('Error logging in as admin: ' + error.message);
  }
};

const logoutAdmin = async () => {
  try {
    await postData('admin/logout', {});
    currentAdmin = false;
    showModal('Logged out');
    loadAdminTab();
  } catch (error) {
    showModal('Error logging out: ' + error.message);
  }
};

const addPlayer = async () => {
  try {
    if (!currentAdmin) return showModal('Admin access required');
    const name = document.getElementById('newPlayerName').value;
    const password = document.getElementById('newPlayerPassword').value;
    const salary = parseInt(document.getElementById('newPlayerSalary').value);
    if (!name || !password || isNaN(salary)) return showModal('Invalid player details');
    const data = await postData('admin/add-player', { name, password, salary });
    showModal(data.message);
    refreshData();
  } catch (error) {
    showModal('Error adding player: ' + error.message);
  }
};

const createTeam = async () => {
  try {
    if (!currentAdmin) return showModal('Admin access required');
    const name = document.getElementById('newTeamName').value;
    const budget = parseInt(document.getElementById('newTeamBudget').value);
    if (!name || isNaN(budget)) return showModal('Enter a team name and budget');
    const data = await postData('teams', { name, budget });
    showModal(`Team "${data.name}" created with ID ${data.id}`);
    document.getElementById('newTeamName').value = '';
    document.getElementById('newTeamBudget').value = '';
    loadAdminTab();
  } catch (error) {
    showModal('Error creating team: ' + error.message);
  }
};

const nominateWaiverPlayerAsManager = async () => {
  try {
    if (!currentAdmin) return showModal('Admin access required');
    const playerId = document.getElementById('waiverPlayerSelect').value;
    const password = document.getElementById('waiverManagerPassword').value;
    if (!playerId || !password) return showModal('Please select a player and provide a password');
    const player = players.find(p => p.id === parseInt(playerId) && !p.team_id);
    if (!player) return showModal('Player not found in waiver list');
    const availableTeam = teams.find(t => !t.manager_id);
    if (!availableTeam) return showModal('No available teams to assign. Create a new team first.');
    const data = await postData('admin/nominate-waiver-manager', {
      playerId,
      teamId: availableTeam.id,
      password,
      budget: INITIAL_MANAGER_BUDGET
    });
    showModal(data.message);
    document.getElementById('waiverPlayerSelect').value = '';
    document.getElementById('waiverManagerPassword').value = '';
    refreshData();
  } catch (error) {
    showModal('Error nominating waiver player as manager: ' + error.message);
  }
};

const removeManager = async () => {
  try {
    if (!currentAdmin) return showModal('Admin access required');
    const managerId = document.getElementById('adminManagerSelect').value;
    if (!managerId) return showModal('Select a manager');
    const data = await postData('admin/manage-manager', { action: 'remove', managerId });
    showModal(data.message);
    refreshData();
  } catch (error) {
    showModal('Error removing manager: ' + error.message);
  }
};

const nominateManagerAdmin = async () => {
  try {
    if (!currentAdmin) return showModal('Admin access required');
    const playerId = document.getElementById('adminPlayerSelect').value;
    const teamId = document.getElementById('adminTeamSelect').value;
    const newTeamNameInput = document.getElementById('newTeamNameInput').value;
    if (!playerId) return showModal('Select a player');
    if (!teamId && !newTeamNameInput) return showModal('Select a team or enter a new team name');
    let teamData = { id: teamId };
    if (newTeamNameInput && !teamId) {
      const newTeam = await postData('teams', { name: newTeamNameInput, budget: 100000 });
      teamData = { id: newTeam.id };
    }
    const data = await postData('admin/manage-manager', {
      action: 'nominate',
      playerId,
      teamId: teamData.id
    });
    showModal(data.message);
    document.getElementById('newTeamNameInput').value = '';
    loadAdminTab();
  } catch (error) {
    console.error('Nomination error details:', error);
    showModal('Error nominating manager: ' + error.message);
  }
};

const updatePlayerSalary = async () => {
  try {
    if (!currentAdmin) return showModal('Admin access required');
    const playerId = document.getElementById('salaryPlayerSelect').value;
    const newSalary = parseInt(document.getElementById('newSalary').value);
    if (!playerId || isNaN(newSalary)) return showModal('Select a player and enter a salary');
    const data = await postData('admin/update-salary', { playerId, newSalary });
    showModal(data.message);
    refreshData();
  } catch (error) {
    showModal('Error updating salary: ' + error.message);
  }
};

const postNews = async () => {
  try {
    if (!currentAdmin) return showModal('Admin access required');
    const message = document.getElementById('newsContent').value;
    if (!message) return showModal('Enter a news message');
    const data = await postData('admin/news', { message });
    showModal(data.message);
    document.getElementById('newsContent').value = '';
    refreshData();
  } catch (error) {
    showModal('Error posting news: ' + error.message);
  }
};

const verifyPlayer = async () => {
  try {
    const name = document.getElementById('playerName').value;
    const password = document.getElementById('playerPassword').value;
    if (!name || !password) return showModal('Enter player name and password');
    currentPlayer = await postData('players/verify', { name, password });
    document.getElementById('playerDashboard').classList.remove('hidden');
    showModal('Logged in as player');
    loadPlayerDashboard();
  } catch (error) {
    showModal('Error verifying player: ' + error.message);
  }
};

const loadPlayerDashboard = async () => {
  try {
    if (!currentPlayer) return;
    const player = await fetchData(`players/${currentPlayer.id}`);
    document.getElementById('playerStats').innerHTML = `
      <p>Name: ${player.name}</p>
      <p>Team: ${player.team?.name || 'None'}</p>
      <p>Salary: $${player.salary || 0}</p>
    `;
    document.getElementById('playerOffers').innerHTML = '<p>No offers available.</p>';
  } catch (error) {
    document.getElementById('playerStats').innerHTML = '<p>Failed to load player data.</p>';
    console.error('Player dashboard error:', error);
  }
};

const bidOnPlayer = async (playerId, defaultSalary) => {
  if (!currentManager) return showModal('Please log in as a manager.');
  try {
    const team = teams.find(t => t.manager_id === currentManager.id);
    if (!team) return showModal('No team assigned to manager.');
    const player = players.find(p => p.id === playerId && !p.team_id);
    if (!player) return showModal('Player not found in waiver list.');
    const bidAmount = parseInt(prompt(`Enter bid amount for ${player.name} (default: $${defaultSalary.toLocaleString()})`, defaultSalary)) || defaultSalary;
    if (isNaN(bidAmount) || bidAmount < player.salary) return showModal('Bid must be at least the player’s current salary.');
    if (bidAmount > team.budget) return showModal(`Bid of $${bidAmount.toLocaleString()} exceeds your budget of $${team.budget.toLocaleString()}.`);
    const teamPlayers = players.filter(p => p.team_id === team.id);
    const totalSalary = teamPlayers.reduce((sum, p) => sum + p.salary, 0) + player.salary;
    if (totalSalary > SALARY_CAP) return showModal(`Cannot bid on ${player.name}: Team salary would exceed cap of $${SALARY_CAP.toLocaleString()}.`);
    const data = await postData('managers/bid', {
      managerId: currentManager.id,
      playerId,
      bidAmount
    });
    showModal(data.message);
    refreshData();
  } catch (error) {
    showModal('Error bidding on player: ' + error.message);
  }
};

const sellPlayer = async (teamId, playerId) => {
  if (!currentManager) return showModal('Please log in as a manager.');
  if (currentManager.team_id !== teamId) return showModal('You can only sell players from your own team.');
  try {
    const data = await postData('managers/sell', {
      managerId: currentManager.id,
      playerId
    });
    showModal(data.message);
    refreshData();
  } catch (error) {
    showModal('Error selling player: ' + error.message);
  }
};

const initialize = async () => {
  try {
    document.querySelectorAll('.sidebar button').forEach(btn => {
      const tab = btn.getAttribute('data-tab');
      btn.addEventListener('click', () => showTab(tab));
    });
    await loadManagers();
    await loadPlayers();
    await loadTeams();
    showTab('info');
  } catch (error) {
    showModal('Error initializing app: ' + error.message);
  }
};

document.addEventListener('DOMContentLoaded', initialize);