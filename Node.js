const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
app.use(express.json());

const supabase = createClient('https://ctjvdhhabnezfoafzpdd.supabase.co', 'your-supabase-anon-key');

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const { data, error } = await supabase
    .from('admins')
    .select('password')
    .eq('username', username)
    .single();
  if (error || !data) return res.status(401).json({ error: 'Invalid username' });
  const match = await supabase.rpc('crypt', { input: password, hash: data.password });
  if (match) {
    res.status(200).json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.listen(3000);