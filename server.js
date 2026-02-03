const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const REFERER = 'https://appx-play.akamai.net.in/';
const ORIGIN  = 'https://appx-play.akamai.net.in';
const HOST    = 'static-trans-v1.appx.co.in';

/* ======================
   XOR decrypt (28 bytes)
====================== */
function decrypt28(buffer, key) {
  for (let i = 0; i < 28; i++) {
    buffer[i] ^= (i < key.length ? key.charCodeAt(i) : i);
  }
  return buffer;
}

/* ======================
   MP4 STREAM PROXY
====================== */
app.get('/mp4', async (req, res) => {
  if (!req.query.url || !req.query.key) {
    return res.status(400).end('Missing url or key');
  }

  // IMPORTANT: decode full signed URL
  const videoUrl = decodeURIComponent(req.query.url);
  const key = req.query.key;

  res.status(206);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');

  try {
    const upstream = await axios({
      method: 'GET',
      url: videoUrl,
      responseType: 'stream',
      headers: {
        Referer: REFERER,
        Origin: ORIGIN,
        Host: HOST,
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13)',
      },
      timeout: 0,                 // long streams safe
      maxRedirects: 5,
      validateStatus: () => true  // handle 403 manually
    });

    if (upstream.status === 403) {
      console.error('Origin 403 blocked');
      return res.status(403).end('Origin blocked');
    }

    let buffer = Buffer.alloc(0);
    let decrypted = false;

    upstream.data.on('data', chunk => {
      if (!decrypted) {
        buffer = Buffer.concat([buffer, chunk]);

        if (buffer.length >= 28) {
          const head = decrypt28(buffer.slice(0, 28), key);
          res.write(head);
          res.write(buffer.slice(28));
          decrypted = true;
        }
      } else {
        res.write(chunk);
      }
    });

    upstream.data.on('end', () => res.end());
    upstream.data.on('error', () => res.end());

  } catch (err) {
    console.error('Proxy error:', err.message);
    res.end();
  }
});

/* ======================
   ROOT (health check)
====================== */
app.get('/', (req, res) => {
  res.send('VidProxy running OK');
});

app.listen(PORT, () => {
  console.log(`VidProxy running on port ${PORT}`);
});