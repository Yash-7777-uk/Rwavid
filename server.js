const express = require('express');
const axios = require('axios');

const app = express();
const PORT = 3000;

const REFERER = 'https://appx-play.akamai.net.in/';

/* ======================
   XOR decrypt (28 bytes)
====================== */
function decryptBuffer(buffer, key) {
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] ^= (i < key.length ? key.charCodeAt(i) : i);
  }
  return buffer;
}

/* ======================
   MP4 STREAM PROXY
====================== */
app.get('/mp4', async (req, res) => {
  const videoUrl = req.query.url;
  const key = req.query.key;

  if (!videoUrl || !key) {
    return res.status(400).send('Missing url or key');
  }

  try {
    res.setHeader('Content-Type', 'video/mp4');

    /* 1️⃣ First 28 bytes (encrypted part) */
    const headResp = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      headers: {
        Referer: REFERER,
        Range: 'bytes=0-27',
        'User-Agent': 'Mozilla/5.0 (Android)'
      }
    });

    let decryptedHead = decryptBuffer(
      Buffer.from(headResp.data),
      key
    );

    // 🔓 Send decrypted bytes
    res.write(decryptedHead);

    /* 2️⃣ Stream remaining video normally */
    const bodyResp = await axios.get(videoUrl, {
      responseType: 'stream',
      headers: {
        Referer: REFERER,
        Range: 'bytes=28-',
        'User-Agent': 'Mozilla/5.0 (Android)'
      }
    });

    bodyResp.data.pipe(res);

  } catch (err) {
    console.error(err.message);
    res.status(500).end('MP4 stream failed');
  }
});

app.listen(PORT, () => {
  console.log(`MP4 proxy running on http://localhost:${PORT}`);
});