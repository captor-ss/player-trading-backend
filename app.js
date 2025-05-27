const express = require('express');
const app = express();

app.use(express.json());

const teamsRouter = require('./routes/teams');
const adminRouter = require('./routes/admin');

app.use('/api/teams', teamsRouter);
app.use('/api/admin', adminRouter);

// Add other routes as needed (e.g., /api/players, /api/managers)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});