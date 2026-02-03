const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const REFERER = 'https://appx-play.akamai.net.in/';

app.get('/stream', async (req, res) => {
  const videoUrl = req.query.url;
  const encryptionKey = req.query.key || req.headers['x-encryption-key'] || '';
  
  if (!videoUrl) return res.status(400).send('Missing URL');

  try {
    // Check if it's an MP4 file
    if (videoUrl.toLowerCase().endsWith('.mp4')) {
      // Handle MP4 file with possible encryption
      await handleMP4Stream(videoUrl, encryptionKey, req, res);
      return;
    }

    // Check if it's an encrypted video (based on query parameter or file extension)
    const isEncryptedVideo = encryptionKey || 
                            videoUrl.toLowerCase().includes('encrypted') ||
                            videoUrl.toLowerCase().includes('enc');

    if (isEncryptedVideo && !videoUrl.toLowerCase().endsWith('.m3u8')) {
      // Handle other encrypted video formats
      await handleEncryptedVideo(videoUrl, encryptionKey, req, res);
      return;
    }

    // Original HLS handling logic
    const response = await axios.get(videoUrl, {
      headers: {
        'Referer': REFERER,
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0'
      }
    });

    let content = response.data;
    const baseUrl = videoUrl.substring(0, videoUrl.lastIndexOf('/') + 1);

    // Pass encryption key to segments if provided
    const keyParam = encryptionKey ? `&key=${encodeURIComponent(encryptionKey)}` : '';

    content = content.replace(/^(?!#)([^\s]+\.ts[^\s]*)/gm, segment => {
      const fullSegmentUrl = baseUrl + segment;
      return `/segment?url=${encodeURIComponent(fullSegmentUrl)}${keyParam}`;
    });

    content = content.replace(/^(?!#)([^\s]+\.m3u8[^\s]*)/gm, playlist => {
      const fullPlaylistUrl = baseUrl + playlist;
      return `/stream?url=${encodeURIComponent(fullPlaylistUrl)}${keyParam}`;
    });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(content);

  } catch (error) {
    console.error('Error loading playlist:', error.message);
    res.status(500).send('Failed to load playlist.');
  }
});

async function handleMP4Stream(videoUrl, encryptionKey, req, res) {
  try {
    console.log(`Streaming MP4: ${videoUrl.substring(0, 100)}...`);
    console.log(`Encryption key provided: ${encryptionKey ? 'Yes (' + encryptionKey.length + ' chars)' : 'No'}`);
    
    const response = await axios.get(videoUrl, {
      responseType: 'stream',
      headers: {
        'Referer': REFERER,
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Range': req.headers['range'] || ''
      }
    });

    // Set appropriate headers
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    
    // Copy response headers
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
    }
    if (response.status === 206) {
      res.status(206);
    }

    // If encryption key is provided, decrypt the stream
    if (encryptionKey && encryptionKey.length > 0) {
      console.log('Applying XOR decryption to MP4 stream...');
      
      // Create a transform stream for decryption
      const { Transform } = require('stream');
      
      let bytesProcessed = 0;
      const keyLength = encryptionKey.length;
      const maxDecryptBytes = Math.min(28, keyLength);
      
      const decryptStream = new Transform({
        transform(chunk, encoding, callback) {
          // Only decrypt first maxDecryptBytes
          if (bytesProcessed < maxDecryptBytes) {
            const buffer = Buffer.from(chunk);
            
            for (let i = 0; i < buffer.length && bytesProcessed < maxDecryptBytes; i++) {
              const keyIndex = bytesProcessed % keyLength;
              buffer[i] ^= encryptionKey.charCodeAt(keyIndex);
              bytesProcessed++;
            }
            
            this.push(buffer);
          } else {
            this.push(chunk);
          }
          callback();
        }
      });
      
      response.data.pipe(decryptStream).pipe(res);
    } else {
      // No encryption, stream directly
      response.data.pipe(res);
    }

  } catch (error) {
    console.error('Error streaming MP4:', error.message);
    res.status(500).send('Failed to stream video.');
  }
}

async function handleEncryptedVideo(videoUrl, encryptionKey, req, res) {
  try {
    console.log(`Handling encrypted video: ${videoUrl.substring(0, 100)}...`);
    
    const response = await axios.get(videoUrl, {
      responseType: 'stream',
      headers: {
        'Referer': REFERER,
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Range': req.headers['range'] || ''
      }
    });

    // Detect content type from URL or headers
    let contentType = 'video/mp4';
    if (videoUrl.toLowerCase().endsWith('.ts')) {
      contentType = 'video/mp2t';
    } else if (videoUrl.toLowerCase().endsWith('.m4s')) {
      contentType = 'video/iso.segment';
    } else if (response.headers['content-type']) {
      contentType = response.headers['content-type'];
    }

    // Set appropriate headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    
    // Copy response headers
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
    }
    if (response.status === 206) {
      res.status(206);
    }

    // Apply decryption if key is provided
    if (encryptionKey && encryptionKey.length > 0) {
      console.log('Applying XOR decryption to video stream...');
      
      const { Transform } = require('stream');
      
      let bytesProcessed = 0;
      const keyLength = encryptionKey.length;
      const maxDecryptBytes = Math.min(28, keyLength);
      
      const decryptStream = new Transform({
        transform(chunk, encoding, callback) {
          if (bytesProcessed < maxDecryptBytes) {
            const buffer = Buffer.from(chunk);
            
            for (let i = 0; i < buffer.length && bytesProcessed < maxDecryptBytes; i++) {
              const keyIndex = bytesProcessed % keyLength;
              buffer[i] ^= encryptionKey.charCodeAt(keyIndex);
              bytesProcessed++;
            }
            
            this.push(buffer);
          } else {
            this.push(chunk);
          }
          callback();
        }
      });
      
      response.data.pipe(decryptStream).pipe(res);
    } else {
      // No encryption key provided, stream as-is
      console.log('No encryption key provided, streaming without decryption');
      response.data.pipe(res);
    }

  } catch (error) {
    console.error('Error handling encrypted video:', error.message);
    res.status(500).send('Failed to process encrypted video.');
  }
}

app.get('/segment', async (req, res) => {
  const segmentUrl = req.query.url;
  const encryptionKey = req.query.key || '';
  
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
    
    // Apply decryption to TS segments if key is provided
    if (encryptionKey && encryptionKey.length > 0) {
      console.log('Decrypting TS segment...');
      
      const { Transform } = require('stream');
      
      let bytesProcessed = 0;
      const keyLength = encryptionKey.length;
      const maxDecryptBytes = Math.min(28, keyLength);
      
      const decryptStream = new Transform({
        transform(chunk, encoding, callback) {
          if (bytesProcessed < maxDecryptBytes) {
            const buffer = Buffer.from(chunk);
            
            for (let i = 0; i < buffer.length && bytesProcessed < maxDecryptBytes; i++) {
              const keyIndex = bytesProcessed % keyLength;
              buffer[i] ^= encryptionKey.charCodeAt(keyIndex);
              bytesProcessed++;
            }
            
            this.push(buffer);
          } else {
            this.push(chunk);
          }
          callback();
        }
      });
      
      response.data.pipe(decryptStream).pipe(res);
    } else {
      response.data.pipe(res);
    }

  } catch (error) {
    console.error('Error loading segment:', error.message);
    res.status(500).send('Failed to load segment.');
  }
});

app.listen(PORT, () => {
  console.log(`Enhanced video proxy server running on http://localhost:${PORT}`);
  console.log(`Features:`);
  console.log(`- MP4 streaming support`);
  console.log(`- XOR decryption with query parameter (url=...&key=...)`);
  console.log(`- HLS/m3u8 proxy with encryption support`);
  console.log(`- TS segment decryption`);
  console.log(`Example usage: http://localhost:${PORT}/stream?url=VIDEO_URL&key=ENCRYPTION_KEY`);
});