app.post('/api/bids', async (req, res) => {
  const { playerId, teamId, amount } = req.body;
  try {
    const player = await fetchSingle('players', { id: playerId });
    if (player.bids?.length) return sendError(res, 400, 'Bids already placed');
    const team = await fetchSingle('teams', { id: teamId }, 'budget');
    if (team.budget < amount) return sendError(res, 400, 'Insufficient budget');
    const { error } = await supabase
      .from('bids')
      .insert({ player_id: playerId, team_id: teamId, amount });
    if (error) throw new Error(error.message);
    await supabase
      .from('players')
      .update({ bidding_ends_at: new Date(Date.now() + 60 * 1000).toISOString() })
      .eq('id', playerId);
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
    const { error } = await supabase
      .from('bids')
      .delete()
      .eq('player_id', playerId)
      .eq('team_id', teamId);
    if (error) throw new Error(error.message);
    await supabase
      .from('players')
      .update({ bidding_ends_at: null })
      .eq('id', playerId);
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
    const { error } = await supabase
      .from('players')
      .update({ team_id: bid.team_id, salary: bid.amount, bidding_ends_at: null })
      .eq('id', playerId);
    if (error) throw new Error(error.message);
    await supabase
      .from('bids')
      .update({ status: 'accepted' })
      .eq('id', bidId);
    await supabase
      .from('teams')
      .update({ budget: supabase.sql`budget - ${bid.amount}` })
      .eq('id', bid.team_id);
    await logAction(`Player ${player.name} accepted bid $${bid.amount} from ${bid.team.name}`);
    res.json({ message: 'Bid accepted, player assigned', timestamp: new Date().toISOString() });
  } catch (error) {
    sendError(res, error.message.includes('not found') ? 404 : 500, error.message);
  }
});

app.post('/api/bids/reject', async (req, res) => {
  const { bidId, playerId } = req.body;
  try {
    const { error } = await supabase
      .from('bids')
      .update({ status: 'rejected' })
      .eq('id', bidId)
      .eq('player_id', playerId);
    if (error) return sendError(res, 500, error.message);
    await logAction(`Player rejected bid ID ${bidId}`);
    res.json({ message: 'Bid rejected' });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});