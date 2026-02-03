const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const REFERER = 'https://appx-play.akamai.net.in/';
const ORIGIN  = 'https://appx-play.akamai.net.in';
const HOST    = 'static-trans-v1.appx.co.in';

function decrypt28(buf, key) {
  for (let i = 0; i < 28; i++) {
    buf[i] ^= (i < key.length ? key.charCodeAt(i) : i);
  }
  return buf;
}

app.get('/mp4', async (req, res) => {
  if (!req.query.url || !req.query.key) {
    return res.status(400).end('Missing params');
  }

  const videoUrl = decodeURIComponent(req.query.url);
  const key = req.query.key;

  // 🔑 VERY IMPORTANT: client range
  const clientRange = req.headers.range || 'bytes=0-';

  try {
    const upstream = await axios({
      method: 'GET',
      url: videoUrl,
      responseType: 'stream',
      headers: {
        Referer: REFERER,
        Origin: ORIGIN,
        Host: HOST,
        Range: clientRange,
        'User-Agent': 'Mozilla/5.0 (Android)'
      },
      validateStatus: () => true
    });

    if (upstream.status === 403) {
      return res.status(403).end('Origin blocked');
    }

    // Forward important headers
    res.status(upstream.status);
    res.setHeader('Content-Type', 'video/mp4');
    if (upstream.headers['content-range'])
      res.setHeader('Content-Range', upstream.headers['content-range']);
    if (upstream.headers['content-length'])
      res.setHeader('Content-Length', upstream.headers['content-length']);
    res.setHeader('Accept-Ranges', 'bytes');

    // 🔓 Decrypt ONLY if starting from byte 0
    const startFromZero = clientRange.startsWith('bytes=0');

    if (!startFromZero) {
      // normal seek → no decrypt
      return upstream.data.pipe(res);
    }

    let buffer = Buffer.alloc(0);
    let done = false;

    upstream.data.on('data', chunk => {
      if (!done) {
        buffer = Buffer.concat([buffer, chunk]);

        if (buffer.length >= 28) {
          decrypt28(buffer, key);
          res.write(buffer);
          done = true;
        }
      } else {
        res.write(chunk);
      }
    });

    upstream.data.on('end', () => res.end());
    upstream.data.on('error', () => res.end());

  } catch (e) {
    console.error(e.message);
    res.end();
  }
});

app.get('/', (_, res) => {
  res.send('VidProxy OK');
});

app.listen(PORT, () => {
  console.log('VidProxy running on', PORT);
});