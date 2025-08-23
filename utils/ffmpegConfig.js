const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const fs = require('fs');

let ffmpegPath;
if (fs.existsSync('/usr/bin/ffmpeg')) {
  ffmpegPath = '/usr/bin/ffmpeg';
  console.log('Using system FFmpeg at:', ffmpegPath);
} else {
  ffmpegPath = ffmpegInstaller.path;
  console.log('Using bundled FFmpeg at:', ffmpegPath);
}

// Enhanced FFmpeg options for better stability and network resilience
const STABLE_FFMPEG_OPTIONS = [
  '-hwaccel', 'none',
  '-loglevel', 'error',
  '-re',
  '-fflags', '+genpts+igndts+discardcorrupt',
  '-avoid_negative_ts', 'make_zero',
  '-max_muxing_queue_size', '1024',
  '-tune', 'zerolatency'
];

// Network-specific options for RTMP
const RTMP_NETWORK_OPTIONS = [
  '-flvflags', 'no_duration_filesize',
  '-rtmp_live', 'live',
  '-rtmp_buffer', '5000',
  '-rtmp_conn', 'B:1',
  '-rtmp_tls', '0',
  '-rtmp_tls_verify', '0'
];

// Video encoding options for stability
const VIDEO_ENCODING_OPTIONS = {
  codec: 'libx264',
  preset: 'ultrafast',
  tune: 'zerolatency',
  g: '30',
  keyint_min: '30',
  sc_threshold: '0',
  pix_fmt: 'yuv420p',
  profile: 'baseline',
  level: '3.1'
};

// Audio encoding options
const AUDIO_ENCODING_OPTIONS = {
  codec: 'aac',
  bitrate: '128k',
  sample_rate: '44100',
  channels: '2'
};

// Function to build FFmpeg arguments with resume position
function buildFFmpegArgs(videoPath, rtmpUrl, options = {}) {
  const {
    resumePosition = 0,
    bitrate = '2500k',
    resolution = '1280x720',
    fps = 30,
    loopVideo = false,
    useAdvancedSettings = false
  } = options;

  let args = [...STABLE_FFMPEG_OPTIONS];

  // Add resume position if specified
  if (resumePosition && resumePosition > 0) {
    args.push('-ss', resumePosition.toString());
  }

  // Add loop option
  if (loopVideo) {
    args.push('-stream_loop', '-1');
  } else {
    args.push('-stream_loop', '0');
  }

  // Add input file
  args.push('-i', videoPath);

  if (useAdvancedSettings) {
    // Advanced encoding mode
    args.push(
      '-c:v', VIDEO_ENCODING_OPTIONS.codec,
      '-preset', VIDEO_ENCODING_OPTIONS.preset,
      '-tune', VIDEO_ENCODING_OPTIONS.tune,
      '-g', VIDEO_ENCODING_OPTIONS.g,
      '-keyint_min', VIDEO_ENCODING_OPTIONS.keyint_min,
      '-sc_threshold', VIDEO_ENCODING_OPTIONS.sc_threshold,
      '-b:v', bitrate,
      '-maxrate', bitrate,
      '-bufsize', `${parseInt(bitrate) * 2}k`,
      '-pix_fmt', VIDEO_ENCODING_OPTIONS.pix_fmt,
      '-profile:v', VIDEO_ENCODING_OPTIONS.profile,
      '-level:v', VIDEO_ENCODING_OPTIONS.level,
      '-s', resolution,
      '-r', fps.toString(),
      '-c:a', AUDIO_ENCODING_OPTIONS.codec,
      '-b:a', AUDIO_ENCODING_OPTIONS.bitrate,
      '-ar', AUDIO_ENCODING_OPTIONS.sample_rate,
      '-ac', AUDIO_ENCODING_OPTIONS.channels,
      '-f', 'flv',
      ...RTMP_NETWORK_OPTIONS,
      rtmpUrl
    );
  } else {
    // Simple copy mode with enhanced stability
    args.push(
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-f', 'flv',
      ...RTMP_NETWORK_OPTIONS,
      rtmpUrl
    );
  }

  return args;
}

// Function to get FFmpeg version and capabilities
function getFFmpegInfo() {
  return {
    path: ffmpegPath,
    isSystem: ffmpegPath === '/usr/bin/ffmpeg',
    options: {
      stable: STABLE_FFMPEG_OPTIONS,
      rtmp: RTMP_NETWORK_OPTIONS,
      video: VIDEO_ENCODING_OPTIONS,
      audio: AUDIO_ENCODING_OPTIONS
    }
  };
}

// Function to validate FFmpeg installation
function validateFFmpeg() {
  try {
    const { execSync } = require('child_process');
    const version = execSync(`${ffmpegPath} -version`, { encoding: 'utf8' });
    const firstLine = version.split('\n')[0];
    console.log(`FFmpeg validation successful: ${firstLine}`);
    return { valid: true, version: firstLine };
  } catch (error) {
    console.error('FFmpeg validation failed:', error.message);
    return { valid: false, error: error.message };
  }
}

module.exports = {
  ffmpegPath,
  STABLE_FFMPEG_OPTIONS,
  RTMP_NETWORK_OPTIONS,
  VIDEO_ENCODING_OPTIONS,
  AUDIO_ENCODING_OPTIONS,
  buildFFmpegArgs,
  getFFmpegInfo,
  validateFFmpeg
};
