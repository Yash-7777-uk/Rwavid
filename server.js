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
    if (videoUrl.toLowerCase().includes('.mp4')) {
      // Handle MP4 file with possible encryption
      await handleMP4Stream(videoUrl, encryptionKey, req, res);
      return;
    }

    // Check if it's an encrypted video
    const isEncryptedVideo = encryptionKey || 
                            videoUrl.toLowerCase().includes('encrypted') ||
                            videoUrl.toLowerCase().includes('enc');

    if (isEncryptedVideo && !videoUrl.toLowerCase().includes('.m3u8')) {
      // Handle other encrypted video formats
      await handleEncryptedVideo(videoUrl, encryptionKey, req, res);
      return;
    }

    // Original HLS handling logic
    const response = await axios.get(videoUrl, {
      headers: {
        'Referer': REFERER,
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
    
    // Parse the full URL with all query parameters
    const urlObj = new URL(videoUrl);
    const fullUrl = urlObj.toString();
    
    const response = await axios.get(fullUrl, {
      responseType: 'stream',
      headers: {
        'Referer': REFERER,
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Range': req.headers['range'] || '',
        'Accept': '*/*',
        'Accept-Encoding': 'identity'
      },
      timeout: 30000
    });

    // Set appropriate headers
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache');
    
    // Copy response headers
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
    }
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
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
        },
        flush(callback) {
          console.log(`Decryption complete. Total bytes processed: ${bytesProcessed}`);
          callback();
        }
      });
      
      response.data.pipe(decryptStream).pipe(res);
    } else {
      // No encryption, stream directly
      console.log('Streaming without decryption...');
      response.data.pipe(res);
    }

  } catch (error) {
    console.error('Error streaming MP4:', error.message);
    console.error('Error details:', error.response?.status, error.response?.headers);
    res.status(500).send('Failed to stream video.');
  }
}

async function handleEncryptedVideo(videoUrl, encryptionKey, req, res) {
  try {
    console.log(`Handling encrypted video: ${videoUrl.substring(0, 100)}...`);
    
    // Parse URL to handle query parameters properly
    const urlObj = new URL(videoUrl);
    const fullUrl = urlObj.toString();
    
    console.log(`Full URL: ${fullUrl}`);
    
    const response = await axios.get(fullUrl, {
      responseType: 'stream',
      headers: {
        'Referer': REFERER,
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Range': req.headers['range'] || '',
        'Accept': '*/*',
        'Accept-Encoding': 'identity'
      },
      timeout: 30000
    });

    // Detect content type
    let contentType = 'video/mp4';
    if (videoUrl.toLowerCase().includes('.ts')) {
      contentType = 'video/mp2t';
    } else if (videoUrl.toLowerCase().includes('.m4s')) {
      contentType = 'video/iso.segment';
    } else if (response.headers['content-type']) {
      contentType = response.headers['content-type'];
    }

    // Set appropriate headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache');
    
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
      console.log(`Applying XOR decryption with key length: ${encryptionKey.length}`);
      
      const { Transform } = require('stream');
      
      let bytesProcessed = 0;
      const keyLength = encryptionKey.length;
      const maxDecryptBytes = Math.min(28, keyLength);
      
      console.log(`Will decrypt first ${maxDecryptBytes} bytes`);
      
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
        },
        flush(callback) {
          console.log(`Decrypted ${bytesProcessed} bytes`);
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
    console.error('Error response:', {
      status: error.response?.status,
      headers: error.response?.headers,
      data: error.response?.data?.toString().substring(0, 200)
    });
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
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity'
      },
      timeout: 15000
    });

    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp2t');
    res.setHeader('Cache-Control', 'no-cache');
    
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Enhanced video proxy server running on port ${PORT}`);
  console.log(`Features:`);
  console.log(`- MP4 streaming support`);
  console.log(`- XOR decryption with query parameter (url=...&key=...)`);
  console.log(`- HLS/m3u8 proxy with encryption support`);
  console.log(`- Full URL query parameter preservation`);
  console.log(`Example usage: http://localhost:${PORT}/stream?url=VIDEO_URL&key=ENCRYPTION_KEY`);
});