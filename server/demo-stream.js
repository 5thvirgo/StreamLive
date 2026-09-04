// Pushes a synthetic test-pattern video (no camera/OBS needed) into the RTMP
// ingest so the full pipeline (ingest -> transcode -> HLS -> playback) can be
// verified end to end. Usage: node demo-stream.js <streamKey>
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const streamKey = process.argv[2];
if (!streamKey) {
  console.error('Usage: node demo-stream.js <streamKey>');
  process.exit(1);
}

const rtmpUrl = `rtmp://localhost:1935/live/${streamKey}`;

const args = [
  '-re',
  '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30',
  '-f', 'lavfi', '-i', 'sine=frequency=1000',
  '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
  '-b:v', '1500k', '-g', '60',
  '-c:a', 'aac', '-b:a', '128k',
  '-f', 'flv', rtmpUrl,
];

console.log(`Pushing demo stream to ${rtmpUrl}`);
const proc = spawn(ffmpegPath, args, { stdio: 'inherit' });
proc.on('exit', (code) => console.log(`ffmpeg exited with code ${code}`));
