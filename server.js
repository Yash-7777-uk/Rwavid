
const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

const REFERER = 'https://appx-play.akamai.net.in/';

app.get('/stream', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) return res.status(400).send('Missing URL');

  try {
    const response = await axios.get(videoUrl, {
      headers: {
        'Referer': REFERER,
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0'
      }
    });

    let content = response.data;

    const baseUrl = videoUrl.substring(0, videoUrl.lastIndexOf('/') + 1);

    content = content.replace(/^(?!#)([^\s]+\.ts[^\s]*)/gm, segment => {
      const fullSegmentUrl = baseUrl + segment;
      return `/segment?url=${encodeURIComponent(fullSegmentUrl)}`;
    });

    content = content.replace(/^(?!#)([^\s]+\.m3u8[^\s]*)/gm, playlist => {
      const fullPlaylistUrl = baseUrl + playlist;
      return `/stream?url=${encodeURIComponent(fullPlaylistUrl)}`;
    });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(content);

  } catch (error) {
    console.error('Error loading playlist:', error.message);
    res.status(500).send('Failed to load playlist.');
  }
});

app.get('/segment', async (req, res) => {
  const segmentUrl = req.query.url;
  if (!segmentUrl) return res.status(400).send('Missing segment URL');

  try {
    const response = await axios.get(segmentUrl, {
      responseType: 'stream',
      headers: {
        'Referer': REFERER,
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0'
      }
    });

    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp2t');
    response.data.pipe(res);

  } catch (error) {
    console.error('Error loading segment:', error.message);
    res.status(500).send('Failed to load segment.');
  }
});

app.listen(PORT, () => {
  console.log(`HLS proxy server running on http://localhost:${PORT}`);
});