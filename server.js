const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const REFERER = 'https://appx-play.akamai.net.in/';
const ORIGIN = 'https://appx-play.akamai.net.in';

app.get('/stream', async (req, res) => {
  try {
    // Parse incoming parameters
    const incomingUrl = req.query.url;
    const encryptionKey = req.query.key || req.headers['x-encryption-key'] || '';
    
    if (!incomingUrl) return res.status(400).send('Missing URL');

    console.log('Incoming request for URL:', incomingUrl.substring(0, 150));
    console.log('Encryption key length:', encryptionKey.length);

    // Handle the actual video URL
    await handleVideoRequest(incomingUrl, encryptionKey, req, res);
    
  } catch (error) {
    console.error('Request processing error:', error.message);
    res.status(500).send('Server error');
  }
});

async function handleVideoRequest(videoUrl, encryptionKey, req, res) {
  try {
    // Parse the video URL carefully
    let actualVideoUrl;
    
    if (videoUrl.includes('?URLPrefix=')) {
      // This is a signed URL with parameters
      actualVideoUrl = decodeURIComponent(videoUrl);
    } else {
      actualVideoUrl = videoUrl;
    }

    console.log('Actual video URL:', actualVideoUrl.substring(0, 200));
    
    // Check if it's an MP4 file
    if (actualVideoUrl.toLowerCase().includes('.mp4')) {
      await streamVideoWithDecryption(actualVideoUrl, encryptionKey, req, res);
      return;
    }

    // For HLS/m3u8 content
    const response = await axios.get(actualVideoUrl, {
      headers: getRequestHeaders(req)
    });

    let content = response.data;
    
    // Handle HLS playlist manipulation
    if (actualVideoUrl.toLowerCase().includes('.m3u8')) {
      const baseUrl = actualVideoUrl.substring(0, actualVideoUrl.lastIndexOf('/') + 1);
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
      return;
    }

    // For other content types
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
    res.send(content);

  } catch (error) {
    console.error('Video handling error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
      console.error('Response data (first 200 chars):', 
        error.response.data?.toString().substring(0, 200));
    }
    res.status(error.response?.status || 500).send('Video request failed');
  }
}

async function streamVideoWithDecryption(videoUrl, encryptionKey, req, res) {
  try {
    console.log('Streaming video with possible decryption...');
    
    const config = {
      responseType: 'stream',
      headers: getRequestHeaders(req),
      timeout: 45000,
      maxRedirects: 5
    };

    // Add range header if present
    if (req.headers.range) {
      config.headers['Range'] = req.headers.range;
    }

    const response = await axios.get(videoUrl, config);

    console.log('Response status:', response.status);
    console.log('Content-Type:', response.headers['content-type']);
    console.log('Content-Length:', response.headers['content-length']);

    // Set response headers
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
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
      console.log(`Applying XOR decryption (key length: ${encryptionKey.length})`);
      
      const { Transform } = require('stream');
      
      let bytesProcessed = 0;
      const keyLength = encryptionKey.length;
      const maxDecryptBytes = Math.min(28, keyLength);
      
      const decryptStream = new Transform({
        transform(chunk, encoding, callback) {
          try {
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
          } catch (err) {
            console.error('Decryption error:', err.message);
            callback(err);
          }
        },
        flush(callback) {
          console.log(`Decryption completed. Bytes decrypted: ${bytesProcessed}`);
          callback();
        }
      });
      
      response.data.on('error', (err) => {
        console.error('Stream error:', err.message);
        res.end();
      });
      
      response.data.pipe(decryptStream).pipe(res);
    } else {
      console.log('Streaming without decryption');
      response.data.pipe(res);
    }

  } catch (error) {
    console.error('Streaming error:', error.message);
    console.error('Error details:', {
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText
    });
    
    if (error.response?.status === 403) {
      res.status(403).send('Access forbidden. The video server rejected the request.');
    } else {
      res.status(500).send('Streaming failed');
    }
  }
}

function getRequestHeaders(req) {
  const headers = {
    'Referer': REFERER,
    'Origin': ORIGIN,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Sec-Fetch-Dest': 'video',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site'
  };

  // Copy some headers from the original request
  if (req.headers['user-agent']) {
    headers['User-Agent'] = req.headers['user-agent'];
  }
  
  return headers;
}

app.get('/segment', async (req, res) => {
  try {
    const segmentUrl = req.query.url;
    const encryptionKey = req.query.key || '';
    
    if (!segmentUrl) return res.status(400).send('Missing segment URL');

    console.log('Segment request:', segmentUrl.substring(0, 150));

    const response = await axios.get(segmentUrl, {
      responseType: 'stream',
      headers: getRequestHeaders(req),
      timeout: 15000
    });

    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp2t');
    res.setHeader('Cache-Control', 'no-cache');
    
    if (encryptionKey && encryptionKey.length > 0) {
      console.log('Decrypting segment...');
      
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
    console.error('Segment error:', error.message);
    res.status(500).send('Segment failed');
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'Video Proxy',
    timestamp: new Date().toISOString() 
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).send('Internal server error');
});

app.listen(PORT, () => {
  console.log(`🚀 Video Proxy Server running on port ${PORT}`);
  console.log(`📺 Endpoint: http://localhost:${PORT}/stream?url=VIDEO_URL&key=ENCRYPTION_KEY`);
  console.log(`🔧 Features: MP4 streaming, XOR decryption, HLS support`);
});