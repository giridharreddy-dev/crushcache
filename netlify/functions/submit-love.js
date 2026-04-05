// netlify/functions/submit-love.js
// Native fetch (Node 18+) – no external dependencies

// Helper: normalize names
function normalize(str) {
  return str.trim().toLowerCase();
}

// Helper: call Upstash Redis REST API (optional – if Redis not configured, it will skip)
async function redisCommand(cmd, ...args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // Redis not configured – skip rate limiting
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

  // ----- Optional Redis rate limiting (5 seconds) -----
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

  // ----- Optional duplicate prevention (same names, same IP, 60 sec) -----
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

  // ----- Airtable credentials -----
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const TABLE_NAME = process.env.TABLE_NAME || 'LoveTests';
  const STATS_TABLE = 'Stats';

  if (!AIRTABLE_BASE_ID || !AIRTABLE_API_KEY) {
    console.error('Missing Airtable env vars');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server config error: missing Airtable credentials' }) };
  }

  const timestamp = new Date().toLocaleString();

  try {
    // 1. Add love record – FIX: send lovePercent as number, not string with %
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
            'Love Percentage': lovePercent,   // ✅ numeric value, no % sign
            'FLAMES Category': flameCategory,
            'Timestamp': timestamp,
          },
        }],
      }),
    });

    if (!addRes.ok) {
      const errText = await addRes.text();
      console.error('Airtable add error:', errText);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save to Airtable', details: errText }) };
    }

    // 2. Update Stats table (TotalSubmissions – no space)
    let newTotal = 1;
    try {
      const statsList = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${STATS_TABLE}`, {
        headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` },
      });
      const statsData = await statsList.json();
      let statsRecord = statsData.records?.[0];

      if (!statsRecord) {
        // Create stats record
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
        } else {
          console.error('Failed to create stats record');
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
      // Continue anyway – total will be 1
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, total: newTotal }),
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error', message: err.message }) };
  }
};
