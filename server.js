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

const logAction = async (action) => {
  await supabase.from('action_log').insert({ action });
};

app.get('/api/players', async (req, res) => {
  const { data, error } = await supabase.from('players').select('*, team:teams(name)');
  if (error) return sendError(res, 500, error.message);
  res.json(data);
});

app.post('/api/players/verify', async (req, res) => {
  const { name, password } = req.body;
  try {
    const player = await fetchSingle('players', { name, password }, 'id, name, salary, team_id, team:teams(id, name), bids');
    delete player.password;
    res.json(player);
  } catch (error) {
    sendError(res, 401, 'Invalid credentials');
  }
});

app.get('/api/managers', async (req, res) => {
  const { data, error } = await supabase.from('managers').select('id, name, team_id, team:teams(id, name)');
  if (error) return sendError(res, 500, error.message);
  res.json(data);
});

app.post('/api/managers/verify', async (req, res) => {
  const { name, password } = req.body;
  try {
    const manager = await fetchSingle('managers', { name }, 'id, name, password, team_id, team:teams(id, name)');
    if (manager.password !== password) throw new Error('Invalid credentials');
    delete manager.password;
    res.json(manager);
  } catch (error) {
    sendError(res, 401, 'Invalid credentials');
  }
});

app.get('/api/managers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const manager = await fetchSingle('managers', { id }, '*, team:teams(*, players:players(*))');
    const { data: transactions, error: transactionError } = await supabase.from('transactions').select('*').eq('manager_id', id);
    if (transactionError) throw new Error(transactionError.message);
    res.json({ ...manager, transactions });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/managers/quit', async (req, res) => {
  const { managerId } = req.body;
  const { error } = await supabase.from('managers').delete().eq('id', managerId);
  if (error) return sendError(res, 500, error.message);
  await logAction(`Manager with ID ${managerId} has quit.`);
  res.json({ message: 'Successfully quit manager role.' });
});

app.get('/api/teams', async (req, res) => {
  const { data, error } = await supabase.from('teams').select('id, name, budget');
  if (error) return sendError(res, 500, error.message);
  res.json(data || []);
});

app.post('/api/bids', async (req, res) => {
  const { playerId, teamId, amount } = req.body;
  try {
    const player = await fetchSingle('players', { id: playerId });
    if (player.bids?.length) return sendError(res, 400, 'Bids already placed');
    const team = await fetchSingle('teams', { id: teamId }, 'budget');
    if (team.budget < amount) return sendError(res, 400, 'Insufficient budget');
    const newBid = { teamId, amount, timestamp: new Date().toISOString() };
    const { error } = await supabase
      .from('players')
      .update({ bids: [...player.bids, newBid], bidding_ends_at: new Date(Date.now() + 60 * 1000).toISOString() })
      .eq('id', playerId);
    if (error) throw new Error(error.message);
    await logAction(`Bid placed on ${player.name} by team ${teamId} for $${amount}`);
    res.json({ message: 'Bid placed' });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/cancel-bid', async (req, res) => {
  const { playerId, teamId } = req.body;
  try {
    const player = await fetchSingle('players', { id: playerId });
    if (!player.bids?.length) return sendError(res, 400, 'No bids to cancel');
    const teamBid = player.bids.find(bid => bid.teamId === teamId);
    if (!teamBid) return sendError(res, 400, 'No bid from this team');
    const updatedBids = player.bids.filter(bid => bid.teamId !== teamId);
    const { error } = await supabase.from('players').update({ bids: updatedBids, bidding_ends_at: null }).eq('id', playerId);
    if (error) throw new Error(error.message);
    await logAction(`Bid cancelled on ${player.name} by team ${teamId}`);
    res.json({ message: 'Bid cancelled' });
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
    const { error } = await supabase.rpc('accept_bid', { bid_id: bidId, player_id: playerId });
    if (error) throw new Error(error.message);
    await logAction(`Player ${player.name} accepted bid $${bid.amount} from ${bid.team.name}`);
    res.json({ message: 'Bid accepted, player assigned', timestamp: new Date().toISOString() });
  } catch (error) {
    sendError(res, error.message.includes('not found') ? 404 : 500, error.message);
  }
});

app.post('/api/bids/reject', async (req, res) => {
  const { bidId, playerId } = req.body;
  const { error } = await supabase.from('bids').delete().eq('id', bidId).eq('player_id', playerId);
  if (error) return sendError(res, 500, error.message);
  await logAction(`Player rejected bid ID ${bidId}`);
  res.json({ message: 'Bid rejected' });
});

app.post('/api/players/sell', async (req, res) => {
  const { playerId, teamId } = req.body;
  try {
    const player = await fetchSingle('players', { id: playerId }, 'salary');
    const salary = player.salary;
    const fee = salary * 0.05;
    const amountToAdd = salary - fee;
    const { error: playerError } = await supabase.from('players').update({ team_id: null, bidding_ends_at: null }).eq('id', playerId);
    if (playerError) throw new Error(playerError.message);
    const team = await fetchSingle('teams', { id: teamId }, 'budget');
    const { error: teamError } = await supabase.from('teams').update({ budget: team.budget + amountToAdd }).eq('id', teamId);
    if (teamError) throw new Error(teamError.message);
    await supabase.from('transactions').insert([
      { manager_id: teamId, type: 'gain', amount: amountToAdd, description: `Sold player for $${salary} (after 5% fee)` },
      { manager_id: teamId, type: 'loss', amount: fee, description: `5% fee for selling player` },
    ]);
    await logAction(`Player ID ${playerId} was sold by Team ID ${teamId} for $${amountToAdd} (after 5% fee).`);
    res.json({ message: `Player sold successfully. Team gained $${amountToAdd} after a 5% fee.` });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.get('/api/log', async (req, res) => {
  const { data, error } = await supabase.from('action_log').select('*').order('timestamp', { ascending: false });
  if (error) return sendError(res, 500, error.message);
  res.json(data);
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return sendError(res, 401, 'Invalid admin credentials');
  }
  res.json({ message: 'Admin logged in successfully' });
});

app.post('/api/admin/logout', (req, res) => {
  if (!req.headers['admin-auth'] || req.headers['admin-auth'] !== 'true') {
    return sendError(res, 403, 'Admin access required');
  }
  res.json({ message: 'Admin logged out successfully' });
});

app.post('/api/admin/add-player', async (req, res) => {
  const { name, password, salary } = req.body;
  if (!req.headers['admin-auth'] || req.headers['admin-auth'] !== 'true') {
    return sendError(res, 403, 'Admin access required');
  }
  try {
    const { data, error } = await supabase.from('players').insert({ name, password, salary }).select().single();
    if (error) throw new Error(error.message);
    await logAction(`New player ${name} added by admin with salary $${salary}.`);
    res.json({ message: 'Player added successfully.' });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/admin/update-salary', async (req, res) => {
  const { playerId, newSalary } = req.body;
  if (!req.headers['admin-auth'] || req.headers['admin-auth'] !== 'true') {
    return sendError(res, 403, 'Admin access required');
  }
  try {
    const { error } = await supabase.from('players').update({ salary: newSalary }).eq('id', playerId);
    if (error) throw new Error(error.message);
    await logAction(`Salary for Player ID ${playerId} updated to $${newSalary} by admin.`);
    res.json({ message: 'Salary updated successfully.' });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/admin/manage-manager', async (req, res) => {
  const { action, managerId, playerId } = req.body;
  if (!req.headers['admin-auth'] || req.headers['admin-auth'] !== 'true') {
    return sendError(res, 403, 'Admin access required');
  }
  try {
    if (action === 'remove') {
      const manager = await fetchSingle('managers', { id: managerId });
      const { error } = await supabase.from('managers').delete().eq('id', managerId);
      if (error) throw new Error(error.message);
      await logAction(`Manager ${manager.name} removed by admin`);
      res.json({ message: 'Manager removed successfully.' });
    } else if (action === 'nominate') {
      const player = await fetchSingle('players', { id: playerId }, 'name, team_id');
      if (!player.team_id) return sendError(res, 400, 'Player must be on a team to become a manager');
      const teamId = player.team_id;
      const { data: existingManager, error: managerError } = await supabase
        .from('managers')
        .select('id')
        .eq('team_id', teamId)
        .single();
      if (managerError && managerError.code !== 'PGRST116') throw new Error(managerError.message);
      if (existingManager) return sendError(res, 400, 'A manager already exists for this team');
      const { data, error } = await supabase
        .from('managers')
        .insert({ name: player.name, password: 'default123', team_id: teamId })
        .select()
        .single();
      if (error) throw new Error(error.message);
      delete data.password;
      await logAction(`Player ${player.name} nominated as manager for team ${teamId} by admin`);
      res.json({ message: 'Player nominated as manager successfully.' });
    } else {
      sendError(res, 400, 'Invalid action');
    }
  } catch (error) {
    sendError(res, error.message.includes('not found') ? 404 : 500, error.message);
  }
});

app.post('/api/manager/nominate', async (req, res) => {
  const { managerId, playerId } = req.body;
  const manager = await fetchSingle('managers', { id: managerId }, 'team_id, team:teams(name)');
  if (req.headers['manager-id'] !== managerId.toString()) {
    return sendError(res, 403, 'Unauthorized');
  }
  try {
    const player = await fetchSingle('players', { id: playerId }, 'name, team_id');
    if (!player.team_id || player.team_id !== manager.team_id) return sendError(res, 400, 'Player must be on your team');
    const { data: existingManager, error: managerError } = await supabase
      .from('managers')
      .select('id')
      .eq('team_id', manager.team_id)
      .single();
    if (managerError && managerError.code !== 'PGRST116') throw new Error(managerError.message);
    if (existingManager) return sendError(res, 400, 'A manager already exists for this team');
    const { data, error } = await supabase
      .from('managers')
      .insert({ name: player.name, password: 'default123', team_id: manager.team_id })
      .select()
      .single();
    if (error) throw new Error(error.message);
    delete data.password;
    await supabase.from('managers').delete().eq('id', managerId);
    await logAction(`Player ${player.name} nominated as manager for ${manager.team.name} by ${manager.name}`);
    res.json({ message: 'Player nominated as manager successfully, old manager removed.' });
  } catch (error) {
    sendError(res, error.message.includes('not found') ? 404 : 500, error.message);
  }
});

app.get('/api/players/offers', async (req, res) => {
  const { playerId } = req.query;
  try {
    const player = await fetchSingle('players', { id: playerId }, 'id, name, bids, team_id');
    const acceptedBids = await supabase
      .from('bids')
      .select('*, team:teams(name)')
      .eq('player_id', playerId)
      .eq('status', 'accepted')
      .order('timestamp', { ascending: false })
      .limit(1);
    const latestAccepted = acceptedBids.data?.[0]?.timestamp || null;
    const offers = player.bids.map(bid => ({
      ...bid,
      teamName: (await fetchSingle('teams', { id: bid.teamId }, 'name')).name,
      expiresAt: latestAccepted ? new Date(new Date(latestAccepted).getTime() + 24 * 60 * 60 * 1000).toISOString() : null,
    })).filter(offer => !player.team_id && (!latestAccepted || new Date(offer.expiresAt) > new Date()));
    res.json(offers);
  } claimOrDenyOffer catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/players/claim-offer', async (req, res) => {
  const { playerId, teamId, amount } = req.body;
  try {
    const player = await fetchSingle('players', { id: playerId }, 'id, name, bids, team_id');
    const acceptedBids = await supabase
      .from('bids')
      .select('*, team:teams(name)')
      .eq('player_id', playerId)
      .eq('status', 'accepted')
      .order('timestamp', { ascending: false })
      .limit(1);
    const latestAccepted = acceptedBids.data?.[0]?.timestamp || null;
    const offer = player.bids.find(b => b.teamId === teamId && b.amount === amount);
    if (!offer) return sendError(res, 400, 'Offer not found');
    if (player.team_id) return sendError(res, 400, 'Player already on a team');
    if (latestAccepted && new Date(latestAccepted).getTime() + 24 * 60 * 60 * 1000 < Date.now()) {
      return sendError(res, 400, 'Offer expired');
    }
    const { error } = await supabase
      .from('players')
      .update({ team_id: teamId, salary: amount, bids: [], bidding_ends_at: null })
      .eq('id', playerId);
    if (error) throw new Error(error.message);
    await supabase.from('teams').update({ budget: supabase.sql`budget - ${amount}` }).eq('id', teamId);
    await logAction(`Player ${player.name} claimed offer $${amount} from team ${teamId}`);
    res.json({ message: 'Offer claimed successfully' });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.post('/api/players/deny-offer', async (req, res) => {
  const { playerId, teamId, amount } = req.body;
  try {
    const player = await fetchSingle('players', { id: playerId }, 'id, name, bids, team_id');
    const offer = player.bids.find(b => b.teamId === teamId && b.amount === amount);
    if (!offer) return sendError(res, 400, 'Offer not found');
    const updatedBids = player.bids.filter(b => !(b.teamId === teamId && b.amount === amount));
    const { error } = await supabase.from('players').update({ bids: updatedBids }).eq('id', playerId);
    if (error) throw new Error(error.message);
    await logAction(`Player ${player.name} denied offer $${amount} from team ${teamId}`);
    res.json({ message: 'Offer denied successfully' });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

app.get('/api/counts', async (req, res) => {
  try {
    const { count: playerCount } = await supabase.from('players').select('id', { count: 'exact' });
    const { count: managerCount } = await supabase.from('managers').select('id', { count: 'exact' });
    const { data: players } = await supabase.from('players').select('bids');
    const totalBids = players.reduce((sum, p) => sum + (p.bids?.length || 0), 0);
    const waiverCount = players.filter(p => !p.team_id).length;
    res.json({ playerCount, managerCount, totalBids, waiverCount });
  } catch (error) {
    sendError(res, 500, `Failed to fetch counts: ${error.message}`);
  }
});

app.listen(process.env.PORT || 3000, () => console.log(`Server running on port ${process.env.PORT || 3000}`));