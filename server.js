const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Get all teams
app.get('/api/teams', async (req, res) => {
  const { data, error } = await supabase.from('teams').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Get all players
app.get('/api/players', async (req, res) => {
  const { data, error } = await supabase.from('players').select('*, team:teams(name)');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Verify players
app.post('/api/players/verify', async (req, res) => {
  const { name, password } = req.body;
  const { data, error } = await supabase
    .from('players')
    .select('id, name, salary, team_id, team:teams(id, name), bids')
    .eq('name', name)
    .eq('password', password)
    .single();
  if (error || !data) return res.status(401).json({ error: 'Invalid credentials' });
  delete data.password; // Remove password from response
  res.json(data);
});


// Get all offers
app.get('/api/offers', async (req, res) => {
  const { data, error } = await supabase.from('offers').select('*, player:players(name, team_id), team:teams(name)');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Get all managers
app.get('/api/managers', async (req, res) => {
  const { data, error } = await supabase
    .from('managers')
    .select('id, name, team_id, team:teams(id, name)')
    .order('id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Place a bid
app.post('/api/bids', async (req, res) => {
  const { playerId, teamId, amount } = req.body;
  const { data: player, error: playerError } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .single();
  if (playerError) return res.status(500).json({ error: playerError.message });
  if (player.bids.length > 0) return res.status(400).json({ error: 'Bids already placed' });
  const { data: team, error: teamError } = await supabase
    .from('teams')
    .select('budget')
    .eq('id', teamId)
    .single();
  if (teamError) return res.status(500).json({ error: teamError.message });
  if (team.budget < amount) return res.status(400).json({ error: 'Insufficient budget' });
  const newBid = { teamId, amount, timestamp: new Date().toISOString() };
  const { error } = await supabase
    .from('players')
    .update({
      bids: [...player.bids, newBid],
      bidding_ends_at: new Date(Date.now() + 60 * 1000).toISOString() // Ensure this line exists
    })
    .eq('id', playerId);
  if (error) return res.status(500).json({ error: error.message });
  await supabase
    .from('action_log')
    .insert({ action: `Bid placed on ${player.name} by team ${teamId} for $${amount}` });
  res.json({ message: 'Bid placed' });
});

// Resolve bids and create offer
app.post('/api/resolve-bids', async (req, res) => {
  const { playerId } = req.body;
  const { data: player, error: playerError } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .single();
  if (playerError) return res.status(500).json({ error: playerError.message });
  const now = new Date();
const biddingEndsAt = player.bidding_ends_at ? new Date(player.bidding_ends_at) : now;
  if (biddingEndsAt > now) {
    return res.status(400).json({ error: 'Bidding still active' });
  }
  if (player.bids.length === 0) {
    return res.status(400).json({ error: 'No bids to resolve' });
  }
  const highestBid = Math.max(...player.bids.map(bid => bid.amount));
  const winningBid = player.bids.find(bid => bid.amount === highestBid);
  const { error: updateError } = await supabase
    .from('players')
    .update({ team_id: winningBid.teamId, salary: highestBid, bids: [], bidding_ends_at: null })
    .eq('id', playerId);
  if (updateError) return res.status(500).json({ error: updateError.message });
  const { error: offerError } = await supabase
    .from('offers')
    .insert({
      player_id: playerId,
      team_id: winningBid.teamId,
      bid_amount: highestBid,
      expires_at: new Date(now.getTime() + 60 * 1000).toISOString(),
      status: 'pending'
    });
  if (offerError) return res.status(500).json({ error: offerError.message });
  await supabase
    .from('action_log')
    .insert({ action: `Offer created for ${player.name} to team ${winningBid.teamId} for $${highestBid}` });
  await supabase
    .from('teams')
    .update({ budget: supabase.sql`budget - ${highestBid}` })
    .eq('id', winningBid.teamId);
  res.json({ message: 'Offer created' });
});

// Cancel bid
app.post('/api/cancel-bid', async (req, res) => {
  const { playerId, teamId } = req.body;
  const { data: player, error: playerError } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .single();
  if (playerError) return res.status(500).json({ error: playerError.message });
  if (!player.bids.length) return res.status(400).json({ error: 'No bids to cancel' });
  const teamBid = player.bids.find(bid => bid.teamId === teamId);
  if (!teamBid) return res.status(400).json({ error: 'No bid from this team' });
  const updatedBids = player.bids.filter(bid => bid.teamId !== teamId);
  const { error } = await supabase
    .from('players')
    .update({ bids: updatedBids, bidding_ends_at: null })
    .eq('id', playerId);
  if (error) return res.status(500).json({ error: error.message });
  await supabase
    .from('action_log')
    .insert({ action: `Bid cancelled on ${player.name} by team ${teamId}` });
  res.json({ message: 'Bid cancelled' });
});

// Accept offer
app.post('/api/offers/accept', async (req, res) => {
  const { offerId } = req.body;
  const { data: offer, error: offerError } = await supabase
    .from('offers')
    .select('*, player:players(*), team:teams(*)')
    .eq('id', offerId)
    .single();
  if (offerError || !offer) return res.status(404).json({ error: 'Offer not found' });
  if (offer.status !== 'pending') return res.status(400).json({ error: 'Offer not pending' });
  if (new Date(offer.expires_at) < new Date()) {
    await supabase.from('offers').update({ status: 'expired' }).eq('id', offerId);
    return res.status(400).json({ error: 'Offer expired' });
  }

  const { error: playerError } = await supabase
    .from('players')
    .update({ team_id: offer.team_id, salary: offer.bid_amount, bids: [], bidding_ends_at: null })
    .eq('id', offer.player_id);
  if (playerError) return res.status(500).json({ error: playerError.message });

  const { error: teamError } = await supabase
    .from('teams')
    .update({ budget: offer.team.budget - offer.bid_amount })
    .eq('id', offer.team_id);
  if (teamError) return res.status(500).json({ error: teamError.message });

  await supabase.from('offers').update({ status: 'accepted' }).eq('id', offerId);
  await supabase.from('action_log').insert({
    action: `Offer accepted for ${offer.player.name} by team ${offer.team.name} for $${offer.bid_amount}`,
  });
  res.json({ message: 'Offer accepted' });
});

// Decline offer
app.post('/api/offers/decline', async (req, res) => {
  const { offerId } = req.body;
  const { data: offer, error: offerError } = await supabase
    .from('offers')
    .select('*, player:players(*), team:teams(*)')
    .eq('id', offerId)
    .single();
  if (offerError || !offer) return res.status(404).json({ error: 'Offer not found' });
  if (offer.status !== 'pending') return res.status(400).json({ error: 'Offer not pending' });

  await supabase.from('offers').update({ status: 'declined' }).eq('id', offerId);
  await supabase.from('action_log').insert({
    action: `Offer declined for ${offer.player.name} by team ${offer.team.name}`,
  });
  res.json({ message: 'Offer declined' });
});

// Get action log
app.get('/api/log', async (req, res) => {
  const { data, error } = await supabase.from('action_log').select('*').order('timestamp', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Add player
app.post('/api/admin/add-player', async (req, res) => {
  const { name, password, salary, teamId } = req.body;
  if (!name || !password || !salary || salary < 0) return res.status(400).json({ error: 'Invalid player data' });
  const { data, error } = await supabase
    .from('players')
    .insert({ name, password, salary, team_id: teamId || null, bids: [], bidding_ends_at: null })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  await supabase
    .from('action_log')
    .insert({ action: `Player ${name} added by admin` });
  res.json({ message: 'Player added' });
});

// Accept bid
app.post('/api/bids/accept', async (req, res) => {
  const { bidId, playerId } = req.body;
  const { data: bid, error: bidError } = await supabase
    .from('bids')
    .select('id, amount, team_id, team:teams(name)')
    .eq('id', bidId)
    .single();
  if (bidError || !bid) return res.status(404).json({ error: 'Bid not found' });
  const { data: player, error: playerError } = await supabase
    .from('players')
    .select('id, salary, team_id')
    .eq('id', playerId)
    .single();
  if (playerError || !player) return res.status(404).json({ error: 'Player not found' });
  if (bid.amount <= player.salary) return res.status(400).json({ error: 'Bid must exceed current salary' });
  const { error } = await supabase.rpc('accept_bid', { bid_id: bidId, player_id: playerId });
  if (error) return res.status(500).json({ error: error.message });
  await supabase
    .from('action_log')
    .insert({ action: `Player ${player.name} accepted bid $${bid.amount} from ${bid.team.name}` });
  res.json({ message: 'Bid accepted, player assigned' });
});

// Reject bid
app.post('/api/bids/reject', async (req, res) => {
  const { bidId, playerId } = req.body;
  const { error } = await supabase
    .from('bids')
    .delete()
    .eq('id', bidId)
    .eq('player_id', playerId);
  if (error) return res.status(500).json({ error: error.message });
  await supabase
    .from('action_log')
    .insert({ action: `Player rejected bid ID ${bidId}` });
  res.json({ message: 'Bid rejected' });
});

// Salary update
app.post('/api/admin/update-salary', async (req, res) => {
  const { playerId, newSalary } = req.body;
  if (!playerId || !newSalary || newSalary < 0) return res.status(400).json({ error: 'Invalid data' });
  const { error } = await supabase
    .from('players')
    .update({ salary: newSalary })
    .eq('id', playerId);
  if (error) return res.status(500).json({ error: error.message });
  await supabase
    .from('action_log')
    .insert({ action: `Salary updated for player ID ${playerId} to $${newSalary}` });
  res.json({ message: 'Salary updated' });
});

// Manager signup
app.post('/api/managers/signup', async (req, res) => {
  const { name, password, teamId } = req.body;
  if (!name || !password || !teamId) return res.status(400).json({ error: 'All fields required' });
  const { data: existing, error: existsError } = await supabase
    .from('managers')
    .select('id')
    .eq('name', name)
    .single();
  if (existsError && existsError.code !== 'PGRST116') return res.status(500).json({ error: existsError.message });
  if (existing) return res.status(400).json({ error: 'Manager already exists' });
  const { data, error } = await supabase
    .from('managers')
    .insert({ name, password, team_id: teamId })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  delete data.password;
  res.json({ message: 'Manager signed up successfully' });
});

// Verify manager
app.post('/api/managers/verify', async (req, res) => {
  const { name, password } = req.body;
  const { data, error } = await supabase
    .from('managers')
    .select('id, name, password, team_id, team:teams(id, name)')
    .eq('name', name)
    .single();
  if (error || !data) return res.status(401).json({ error: 'Invalid credentials' });
  // For now, compare plain text (add hashing later for security)
  if (data.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
  delete data.password; // Remove password from response
  res.json(data);
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});