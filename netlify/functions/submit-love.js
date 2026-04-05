// Native fetch (Node 18+) – no require('node-fetch')

// Helper: normalize names
function normalize(str) {
  return str.trim().toLowerCase();
}

// Helper: call Upstash Redis REST API using native fetch
async function redisCommand(cmd, ...args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.error('Redis env vars missing');
    return { result: null };
  }
  try {
    const response = await fetch(`${url}/${cmd}/${args.join('/')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.json();
  } catch (err) {
    console.error('Redis error:', err);
    return { result: null };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ip = event.headers['x-forwarded-for'] || 'unknown';
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { yourName, crushName, lovePercent, flameCategory } = body;
  if (!yourName || !crushName || !lovePercent) {
    return { statusCode: 400, body: 'Missing fields' };
  }

  const normYour = normalize(yourName);
  const normCrush = normalize(crushName);
  const namesHash = `${normYour}|${normCrush}`;

  // ----- Rate limiting (5 seconds) -----
  const rateKey = `ratelimit:${ip}`;
  try {
    const lastReq = await redisCommand('GET', rateKey);
    if (lastReq && lastReq.result) {
      const lastTime = parseInt(lastReq.result, 10);
      const now = Date.now();
      if (now - lastTime < 5000) {
        const wait = Math.ceil((5000 - (now - lastTime)) / 1000);
        return {
          statusCode: 429,
          body: JSON.stringify({ error: `⏳ Too many requests! Please wait ${wait} seconds.` }),
        };
      }
    }
    await redisCommand('SETEX', rateKey, 6, Date.now());
  } catch (err) {
    console.error('Rate limit error:', err);
  }

  // ----- Duplicate prevention -----
  const dupKey = `duplicate:${ip}:${namesHash}`;
  try {
    const existing = await redisCommand('GET', dupKey);
    if (existing && existing.result) {
      return {
        statusCode: 429,
        body: JSON.stringify({ error: 'You already tested these names recently. Try something new!' }),
      };
    }
    await redisCommand('SETEX', dupKey, 60, '1');
  } catch (err) {
    console.error('Duplicate check error:', err);
  }

  // ----- Airtable -----
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const TABLE_NAME = process.env.TABLE_NAME || 'LoveTests';
  const STATS_TABLE = 'Stats';

  if (!AIRTABLE_BASE_ID || !AIRTABLE_API_KEY) {
    console.error('Missing Airtable env vars');
    return { statusCode: 500, body: 'Server config error' };
  }

  const timestamp = new Date().toLocaleString();

  try {
    // 1. Add love record
    const addRes = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE_NAME)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        records: [{
          fields: {
            'Your Name': yourName,
            'Crush\'s Name': crushName,
            'Love Percentage': `${lovePercent}%`,
            'FLAMES Category': flameCategory,
            'Timestamp': timestamp,
          },
        }],
      }),
    });
    if (!addRes.ok) {
      const err = await addRes.text();
      console.error('Airtable add error:', err);
      return { statusCode: 500, body: 'Failed to save to Airtable' };
    }

    // 2. Update Stats table
    let newTotal = 1;
    try {
      const statsList = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${STATS_TABLE}`, {
        headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` },
      });
      const statsData = await statsList.json();
      let statsRecord = statsData.records?.[0];

      if (!statsRecord) {
        const createRes = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${STATS_TABLE}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            records: [{
              fields: {
                TotalSubmissions: 1,
                LastUpdated: new Date().toISOString(),
              },
            }],
          }),
        });
        if (createRes.ok) {
          const createData = await createRes.json();
          newTotal = createData.records[0].fields.TotalSubmissions;
        }
      } else {
        const currentTotal = statsRecord.fields.TotalSubmissions || 0;
        newTotal = currentTotal + 1;
        await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${STATS_TABLE}/${statsRecord.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fields: {
              TotalSubmissions: newTotal,
              LastUpdated: new Date().toISOString(),
            },
          }),
        });
      }
    } catch (statsErr) {
      console.error('Stats handling error:', statsErr);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, total: newTotal }),
    };
  } catch (err) {
    console.error('Serverless function error:', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
};