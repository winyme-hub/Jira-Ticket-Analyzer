const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ALLOWED_DOMAIN = 'invisible.email';

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

app.get('/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

async function verifyGoogleToken(token) {
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: GOOGLE_CLIENT_ID,
  });
  return ticket.getPayload();
}

app.post('/api/analyze', async (req, res) => {
  const { token, ticket } = req.body;
  if (!token || !ticket) return res.status(400).json({ error: 'Missing token or ticket content.' });
  let payload;
  try {
    payload = await verifyGoogleToken(token);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid Google token. Please sign in again.' });
  }
  const email = payload.email || '';
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) return res.status(403).json({ error: `Access restricted to @${ALLOWED_DOMAIN} accounts.` });

  const system = `You are a Jira ticket analyst for a Finance Operations team. Given a ticket, return ONLY a valid JSON object with exactly these keys:
{"urgency":"Critical"|"High"|"Medium"|"Low","category":"Bug"|"Access Request"|"Process Issue"|"Data Error"|"Integration"|"Finance Ops"|"Reporting"|"Other","sentiment":"Frustrated"|"Urgent"|"Confused"|"Neutral"|"Satisfied","summary":"2-3 sentence plain English summary","next_actions":["action 1","action 2","action 3"],"reply":"Professional empathetic reply 3-5 sentences"}
Return ONLY valid JSON. No markdown, no preamble.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1000, system, messages: [{ role: 'user', content: ticket }] }),
    });
    if (!response.ok) { const err = await response.json(); throw new Error(err.error?.message || `API error ${response.status}`); }
    const data = await response.json();
    const raw = data.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);
    return res.json({ result: parsed, user: { name: payload.name, email, picture: payload.picture } });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Analysis failed.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
