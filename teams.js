const express = require('express');
const router = express.Router();

let teams = []; // Replace with your database
let nextTeamId = 1;

// Create a new team
router.post('/', async (req, res) => {
  try {
    const { name, budget } = req.body;
    if (!name || !budget) {
      return res.status(400).json({ error: 'Name and budget required' });
    }
    const newTeam = { id: nextTeamId++, name, budget, players: [] };
    teams.push(newTeam);
    res.status(201).json(newTeam);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// Get all teams
router.get('/', async (req, res) => {
  try {
    res.json(teams);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

module.exports = router;