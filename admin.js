const express = require('express');
const router = express.Router();

let managers = []; // Replace with your database
let teams = []; // In-memory for now, replace with database
let players = []; // In-memory for now, replace with database
let nextManagerId = 1;

// Mock data (replace with database queries)
const loadData = () => {
  teams = teams.length ? teams : [];
  players = players.length ? players : [
    { id: 1, name: "Tunahead" } // Ensure Tunahead exists
  ];
};

// Middleware to check admin auth (simplified for now)
const checkAdminAuth = (req, res, next) => {
  const adminAuth = req.headers['admin-auth'];
  if (!adminAuth) {
    return res.status(401).json({ error: 'Admin access required' });
  }
  next();
};

router.post('/manage-manager', checkAdminAuth, async (req, res) => {
  try {
    loadData();
    const { action, playerId, teamId } = req.body;
    if (!action || !playerId || !teamId) {
      return res.status(400).json({ error: 'Action, playerId, and teamId required' });
    }

    if (action === 'nominate') {
      const player = players.find(p => p.id === parseInt(playerId));
      const team = teams.find(t => t.id === parseInt(teamId));
      if (!player || !team) {
        return res.status(404).json({ error: 'Player or team not found' });
      }
      const existingManager = managers.find(m => m.team?.id === team.id);
      if (existingManager) {
        return res.status(400).json({ error: 'Team already has a manager' });
      }
      const newManager = {
        id: nextManagerId++,
        name: player.name,
        team: { id: team.id, name: team.name }
      };
      managers.push(newManager);
      res.json({ message: `${player.name} nominated as manager of ${team.name}` });
    } else if (action === 'remove') {
      const managerId = req.body.managerId;
      const managerIndex = managers.findIndex(m => m.id === parseInt(managerId));
      if (managerIndex === -1) {
        return res.status(404).json({ error: 'Manager not found' });
      }
      managers.splice(managerIndex, 1);
      res.json({ message: 'Manager removed' });
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to manage manager' });
  }
});

module.exports = router;