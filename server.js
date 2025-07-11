const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123'; // Change to secure password in production

const sendError = (res, status, message) => res.status(status).json({ error: message });

const fetchSingle = async (table, conditions, select = '*') => {
  const { data, error } = await supabase.from(table).select(select).match(conditions).single();
  if (error || !data) throw new Error(error?.message || `${table} not found`);
  return data;
};

const logAction = async (details) => {
  const { error } = await supabase.from('action_log').insert({ details });
  if (error) console.error('Error logging action:', error.message);
};

app.get('/api/players', async (req, res) => {
  const { data, error } = await supabase.from('players').select(`
    *,
    team:teams(id, name)
  `);
  if (error) return sendError(res, 500, error.message);
  res.json(data);
});

app.get('/api/players/:id', async (req, res) => {
  try {
    const player = await fetchSingle('players', { id: req.params.id }, '*, team:teams(id, name)');
    res.json(player);
  } catch (error) {
    sendError(res, 404, error.message);
  }
});

app.post('/api/players/verify', async (req, res) => {
  const { name, password } = req.body;
  try {
    const player = await fetchSingle('players', { name, password }, 'id, name');
    res.json(player);
  } catch (error) {
    sendError(res, 401, error.message);
  }
});

app.post('/api/players/sell', async (req, res) => {
  const { playerId, teamId } = req.body;
  try {
    const player = await fetchSingle('players', { id: playerId, team_id: teamId }, 'id, name, salary');
    const fee = Math.round(player.salary * 0.05);
    const amount = player.salary - fee;
    await supabase.from('players').update({ team_id: null, salary: 0, bidding_ends_at: null }).eq('id', playerId);
    await supabase.from('teams').update({ budget: supabase.sql`budget + ${amount}` }).eq('id', teamId);
    await supabase.from('bids').delete().eq('player_id', playerId);
    await logAction(`Player ${player.name} sold by team ${teamId} for $${amount} (fee: $${fee})`);
    res.json({ message: `Player sold for $${amount} (fee: $${fee})` });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.get('/api/players/offers', async (req, res) => {
  const { playerId } = req.query;
  try {
    const { data: bids } = await supabase.from('bids').select(`
      id,
      amount,
      team:teams(id, name),
      player:players(id, bidding_ends_at)
    `).eq('player_id', playerId).eq('status', 'pending');
    const offers = bids.map(bid => ({
      teamId: bid.team.id,
      teamName: bid.team.name,
      amount: bid.amount,
      expiresAt: bid.player.bidding_ends_at,
    }));
    res.json(offers);
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/players/claim-offer', async (req, res) => {
  const { playerId, teamId, amount } = req.body;
  try {
    const player = await fetchSingle('players', { id: playerId }, 'id, name, salary');
    if (amount <= player.salary) return sendError(res, 400, 'Offer must exceed current salary');
    const team = await fetchSingle('teams', { id: teamId }, 'id, name, budget');
    if (team.budget < amount) return sendError(res, 400, 'Team budget too low');
    await supabase.from('players').update({ team_id: teamId, salary: amount, bidding_ends_at: null }).eq('id', playerId);
    await supabase.from('teams').update({ budget: supabase.sql`budget - ${amount}` }).eq('id', teamId);
    await supabase.from('bids').delete().eq('player_id', playerId);
    await logAction(`Player ${player.name} claimed offer of $${amount} from ${team.name}`);
    res.json({ message: 'Offer claimed, player assigned' });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/players/deny-offer', async (req, res) => {
  const { playerId, teamId } = req.body;
  try {
    const { error } = await supabase.from('bids').delete().eq('player_id', playerId).eq('team_id', teamId);
    if (error) return sendError(res, 500, error.message);
    await logAction(`Player rejected offer from team ${teamId}`);
    res.json({ message: 'Offer denied' });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.get('/api/managers', async (req, res) => {
  const { data, error } = await supabase.from('managers').select(`
    *,
    team:teams(id, name, budget)
  `);
  if (error) return sendError(res, 500, error.message);
  res.json(data);
});

app.get('/api/managers/:id', async (req, res) => {
  try {
    const manager = await fetchSingle('managers', { id: req.params.id }, `
      *,
      team:teams(id, name, budget, players:players(id, name, salary))
    `);
    const { data: transactions } = await supabase.from('action_log').select('*').order('id', { ascending: false });
    manager.transactions = transactions.map(t => ({
      type: t.details.includes('sold') ? 'gain' : 'loss',
      amount: parseInt(t.details.match(/\$\d+/)?.[0]?.replace('$', '') || '0'),
    }));
    res.json(manager);
  } catch (error) {
    sendError(res, 404, error.message);
  }
});

app.post('/api/managers/verify', async (req, res) => {
  const { name, password } = req.body;
  try {
    if (!name || !password) {
      return sendError(res, 400, 'Name and password are required');
    }
    const { data: manager, error } = await supabase
      .from('managers')
      .select('id, name, team_id, team:teams(name, budget, players)')
      .eq('name', name)
      .eq('password', password)
      .single();
    if (error || !manager) {
      return sendError(res, 401, 'Invalid credentials');
    }
    await logAction(`Manager ${name} logged in`);
    res.json(manager);
  } catch (error) {
    sendError(res, 500, `Error verifying manager: ${error.message}`);
  }
});

app.post('/api/managers/quit', async (req, res) => {
  const { managerId } = req.body;
  try {
    const manager = await fetchSingle('managers', { id: managerId }, 'id, name');
    await supabase.from('managers').update({ team_id: null }).eq('id', managerId);
    await logAction(`Manager ${manager.name} quit their role`);
    res.json({ message: 'Manager role quit successfully' });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/manager/nominate', async (req, res) => {
  const { managerId, playerId } = req.body;
  if (!req.headers['manager-id'] || req.headers['manager-id'] !== String(managerId)) {
    return sendError(res, 403, 'Unauthorized manager action');
  }
  try {
    const manager = await fetchSingle('managers', { id: managerId }, 'id, name, team_id');
    if (!manager.team_id) return sendError(res, 400, 'Manager has no team');
    const player = await fetchSingle('players', { id: playerId, team_id: manager.team_id }, 'id, name');
    await supabase.from('managers').update({ team_id: null }).eq('id', managerId);
    await supabase.from('managers').update({ team_id: manager.team_id }).eq('name', player.name);
    await logAction(`Manager ${manager.name} nominated ${player.name} as new manager for team ${manager.team_id}`);
    res.json({ message: `Nominated ${player.name} as new manager` });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/managers/set-team-name', async (req, res) => {
  const { managerId, teamName } = req.body;
  try {
    if (!req.headers['manager-id'] || req.headers['manager-id'] !== managerId) {
      return sendError(res, 403, 'Unauthorized');
    }
    if (!teamName) {
      return sendError(res, 400, 'Team name is required');
    }
    // Check if manager exists
    const { data: manager, error: managerError } = await supabase
      .from('managers')
      .select('id, team_id')
      .eq('id', managerId)
      .single();
    if (managerError || !manager) throw new Error('Manager not found');

    if (manager.team_id) {
      // Update existing team name
      const { error } = await supabase
        .from('teams')
        .update({ name: teamName })
        .eq('id', manager.team_id);
      if (error) throw new Error(error.message);
      await logAction(`Manager ${managerId} updated team name to ${teamName}`);
      res.json({ message: `Team name updated to ${teamName}` });
    } else {
      // Create new team
      const defaultBudget = 100000;
      const { data: newTeam, error: teamError } = await supabase
        .from('teams')
        .insert({ name: teamName, budget: defaultBudget })
        .select('id')
        .single();
      if (teamError) throw new Error(teamError.message);

      // Link manager to new team
      const { error: updateError } = await supabase
        .from('managers')
        .update({ team_id: newTeam.id })
        .eq('id', managerId);
      if (updateError) throw new Error(updateError.message);

      await logAction(`Manager ${managerId} created team ${teamName}`);
      res.json({ message: `Team ${teamName} created successfully` });
    }
  } catch (error) {
    sendError(res, error.message.includes('not found') ? 404 : 500, error.message);
  }
});

app.get('/api/teams', async (req, res) => {
  const { data, error } = await supabase.from('teams').select('*');
  if (error) return sendError(res, 500, error.message);
  res.json(data);
});

app.get('/api/log', async (req, res) => {
  const { lastId } = req.query;
  const query = supabase.from('action_log').select('*').order('id', { ascending: false });
  if (lastId) query.gt('id', lastId);
  const { data, error } = await query;
  if (error) return sendError(res, 500, error.message);
  res.json(data);
});

app.get('/api/news', async (req, res) => {
  const { data, error } = await supabase.from('news').select('*').order('timestamp', { ascending: false });
  if (error) return sendError(res, 500, error.message);
  res.json(data || []);
});

app.post('/api/admin/news', async (req, res) => {
  if (!req.headers['admin-auth'] || req.headers['admin-auth'] !== 'true') {
    return sendError(res, 403, 'Admin access required');
  }
  const { message } = req.body;
  if (!message) return sendError(res, 400, 'Message is required');
  try {
    const { data, error } = await supabase.from('news').insert({ message, timestamp: new Date().toISOString() }).select().single();
    if (error) throw new Error(error.message);
    res.json({ message: 'News posted successfully' });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.get('/api/counts', async (req, res) => {
  try {
    const { data: players } = await supabase.from('players').select('id, team_id');
    const { data: managers } = await supabase.from('managers').select('id, team_id');
    const { data: bids } = await supabase.from('bids').select('id');
    const playerCount = players.filter(p => p.team_id).length;
    const managerCount = managers.filter(m => m.team_id).length;
    const totalBids = bids.length;
    const waiverCount = players.filter(p => !p.team_id).length;
    res.json({ playerCount, managerCount, totalBids, waiverCount });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return sendError(res, 401, 'Invalid admin credentials');
  }
  res.json({ message: 'Admin logged in successfully' });
});

app.post('/api/admin/logout', async (req, res) => {
  if (!req.headers['admin-auth'] || req.headers['admin-auth'] !== 'true') {
    return sendError(res, 403, 'Admin access required');
  }
  res.json({ message: 'Admin logged out successfully' });
});

app.post('/api/admin/add-player', async (req, res) => {
  if (!req.headers['admin-auth'] || req.headers['admin-auth'] !== 'true') {
    return sendError(res, 403, 'Admin access required');
  }
  const { name, password, salary } = req.body;
  if (!name || !password || !salary) return sendError(res, 400, 'Missing required fields');
  try {
    const { data, error } = await supabase.from('players').insert({ name, password, salary }).select().single();
    if (error) throw new Error(error.message);
    await logAction(`New player ${name} added by admin with salary $${salary}`);
    res.json({ message: `Player ${name} added with salary $${salary}` });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/admin/update-salary', async (req, res) => {
  if (!req.headers['admin-auth'] || req.headers['admin-auth'] !== 'true') {
    return sendError(res, 403, 'Admin access required');
  }
  const { playerId, newSalary } = req.body;
  try {
    const player = await fetchSingle('players', { id: playerId }, 'id, name, salary');
    await supabase.from('players').update({ salary: newSalary }).eq('id', playerId);
    await logAction(`Salary for Player ID ${playerId} updated to $${newSalary} by admin`);
    res.json({ message: `Player ${player.name} salary updated to $${newSalary}` });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/admin/manage-manager', async (req, res) => {
  const { action, managerId, playerId } = req.body;
  try {
    if (!req.headers['admin-auth']) {
      return sendError(res, 403, 'Admin access required');
    }
    if (action === 'remove' && managerId) {
      const { error } = await supabase
        .from('managers')
        .update({ team_id: null })
        .eq('id', managerId);
      if (error) throw new Error(error.message);
      await logAction(`Manager ${managerId} removed from team`);
      return res.json({ message: 'Manager removed successfully' });
    } else if (action === 'nominate' && playerId) {
      // Check if player exists
      const { data: player, error: playerError } = await supabase
        .from('players')
        .select('id, name')
        .eq('id', playerId)
        .single();
      if (playerError || !player) throw new Error('Player not found');

      // Create a new team with default name and budget
      const defaultTeamName = `${player.name}'s Team`;
      const defaultBudget = 100000; // Default budget for new teams
      const { data: newTeam, error: teamError } = await supabase
        .from('teams')
        .insert({ name: defaultTeamName, budget: defaultBudget })
        .select('id')
        .single();
      if (teamError) throw new Error(teamError.message);

      // Check if player is already a manager
      const { data: existingManager, error: managerError } = await supabase
        .from('managers')
        .select('id')
        .eq('name', player.name)
        .single();
      if (managerError && !managerError.message.includes('No rows found')) {
        throw new Error(managerError.message);
      }

      if (existingManager) {
        // Update existing manager's team_id
        const { error: updateError } = await supabase
          .from('managers')
          .update({ team_id: newTeam.id })
          .eq('id', existingManager.id);
        if (updateError) throw new Error(updateError.message);
      } else {
        // Create new manager
        const { error: insertError } = await supabase
          .from('managers')
          .insert({ name: player.name, password: 'default_password', team_id: newTeam.id }); // Use a secure default or prompt for password
        if (insertError) throw new Error(insertError.message);
      }

      await logAction(`Player ${player.name} nominated as manager with team ${newTeam.id}`);
      res.json({ message: `Player ${player.name} nominated as manager with team ${defaultTeamName}` });
    } else {
      sendError(res, 400, 'Invalid action or parameters');
    }
  } catch (error) {
    sendError(res, error.message.includes('not found') ? 404 : 500, error.message);
  }
});

app.post('/api/bids', async (req, res) => {
  const { playerId, teamId, amount } = req.body;
  try {
    // Verify team exists and has a manager
    const { data: team, error: teamError } = await supabase
      .from('teams')
      .select('id, budget')
      .eq('id', teamId)
      .single();
    if (teamError || !team) throw new Error('Team not found');
    const { data: manager, error: managerError } = await supabase
      .from('managers')
      .select('id')
      .eq('team_id', teamId)
      .single();
    if (managerError || !manager) throw new Error('Team has no manager');

    const player = await fetchSingle('players', { id: playerId }, 'id, name, team_id');
    if (player.team_id) return sendError(res, 400, 'Player already on a team');
    if (team.budget < amount) return sendError(res, 400, 'Insufficient budget');
    const { data: existingBid } = await supabase.from('bids').select('id').eq('player_id', playerId).eq('team_id', teamId).single();
    if (existingBid) return sendError(res, 400, 'Bid already placed by this team');
    const { error } = await supabase.from('bids').insert({ player_id: playerId, team_id: teamId, amount, status: 'pending' });
    if (error) throw new Error(error.message);
    const biddingEndsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('players').update({ bidding_ends_at: biddingEndsAt }).eq('id', playerId);
    await logAction(`Bid placed on ${player.name} by team ${teamId} for $${amount}`);
    res.json({ message: 'Bid placed successfully' });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/cancel-bid', async (req, res) => {
  const { playerId, teamId } = req.body;
  try {
    const player = await fetchSingle('players', { id: playerId }, 'id, name');
    const { data: bid } = await supabase.from('bids').select('id').eq('player_id', playerId).eq('team_id', teamId).single();
    if (!bid) return sendError(res, 400, 'No bid from this team');
    await supabase.from('bids').delete().eq('player_id', playerId).eq('team_id', teamId);
    const { data: remainingBids } = await supabase.from('bids').select('id').eq('player_id', playerId);
    if (!remainingBids.length) {
      await supabase.from('players').update({ bidding_ends_at: null }).eq('id', playerId);
    }
    await logAction(`Bid cancelled on ${player.name} by team ${teamId}`);
    res.json({ message: 'Bid cancelled successfully' });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/bids/accept', async (req, res) => {
  const { bidId, playerId } = req.body;
  try {
    const bid = await fetchSingle('bids', { id: bidId }, 'id, amount, team_id, team:teams(name)');
    const player = await fetchSingle('players', { id: playerId }, 'id, name, salary, team_id');
    if (bid.amount <= player.salary) return sendError(res, 400, 'Bid must exceed current salary');
    const team = await fetchSingle('teams', { id: bid.team_id }, 'id, name, budget');
    if (team.budget < bid.amount) return sendError(res, 400, 'Team budget too low');
    await supabase.from('players').update({ team_id: bid.team_id, salary: bid.amount, bidding_ends_at: null }).eq('id', playerId);
    await supabase.from('teams').update({ budget: supabase.sql`budget - ${bid.amount}` }).eq('id', bid.team_id);
    await supabase.from('bids').delete().eq('player_id', playerId);
    await logAction(`Player ${player.name} accepted bid of $${bid.amount} from ${team.name}`);
    res.json({ message: 'Bid accepted, player assigned' });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/bids/reject', async (req, res) => {
  const { bidId, playerId } = req.body;
  try {
    await supabase.from('bids').delete().eq('id', bidId);
    const { data: remainingBids } = await supabase.from('bids').select('id').eq('player_id', playerId);
    if (!remainingBids.length) {
      await supabase.from('players').update({ bidding_ends_at: null }).eq('id', playerId);
    }
    await logAction(`Player rejected bid ID ${bidId}`);
    res.json({ message: 'Bid rejected' });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));