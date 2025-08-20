/**
 * FFmpeg Configuration for StreamFlow
 * Optimized settings for stable RTMP streaming
 */

// Base FFmpeg options for stability
const BASE_FFMPEG_OPTIONS = [
  '-hwaccel', 'none',
  '-loglevel', 'error',
  '-re',
  '-fflags', '+genpts+igndts+discardcorrupt',
  '-avoid_negative_ts', 'make_zero',
  '-max_muxing_queue_size', '1024'
];

// RTMP-specific options for better connection handling
const RTMP_OPTIONS = [
  '-rtmp_live', 'live',
  '-rtmp_buffer', '5000',
  '-rtmp_conn', 'attempts=3',
  '-rtmp_timeout', '30',
  '-rtmp_delay', '5'
];

// Video encoding presets for different quality levels
const VIDEO_PRESETS = {
  low: {
    preset: 'ultrafast',
    tune: 'zerolatency',
    g: '30',
    maxrate_multiplier: 1.2,
    bufsize_multiplier: 1.5
  },
  medium: {
    preset: 'veryfast',
    tune: 'zerolatency',
    g: '60',
    maxrate_multiplier: 1.5,
    bufsize_multiplier: 2.0
  },
  high: {
    preset: 'fast',
    tune: 'zerolatency',
    g: '60',
    maxrate_multiplier: 1.8,
    bufsize_multiplier: 2.5
  }
};

// Audio encoding presets
const AUDIO_PRESETS = {
  low: {
    bitrate: '96k',
    sampleRate: '22050'
  },
  medium: {
    bitrate: '128k',
    sampleRate: '44100'
  },
  high: {
    bitrate: '192k',
    sampleRate: '48000'
  }
};

// Network resilience options
const NETWORK_RESILIENCE_OPTIONS = [
  '-reconnect', '1',
  '-reconnect_at_eof', '1',
  '-reconnect_streamed', '1',
  '-reconnect_delay_max', '30'
];

// Error recovery options
const ERROR_RECOVERY_OPTIONS = [
  '-err_detect', 'ignore_err',
  '-fflags', '+genpts+igndts+discardcorrupt+nobuffer',
  '-flags', 'low_delay'
];

/**
 * Build FFmpeg arguments for a stream
 * @param {Object} stream - Stream configuration
 * @param {number} resumePosition - Position to resume from (in seconds)
 * @param {string} quality - Quality preset (low, medium, high)
 * @returns {Array} FFmpeg arguments
 */
function buildFFmpegArgs(stream, resumePosition = null, quality = 'medium') {
  let args = [...BASE_FFMPEG_OPTIONS, ...RTMP_OPTIONS];
  
  // Add network resilience for better connection handling
  if (stream.platform === 'youtube' || stream.platform === 'twitch') {
    args.push(...NETWORK_RESILIENCE_OPTIONS);
  }
  
  // Add resume position if available
  if (resumePosition && resumePosition > 0) {
    args.push('-ss', resumePosition.toString());
  }
  
  // Add loop options
  if (stream.loop_video) {
    args.push('-stream_loop', '-1');
  } else {
    args.push('-stream_loop', '0');
  }
  
  // Add input file
  args.push('-i', stream.videoPath);
  
  if (!stream.use_advanced_settings) {
    // Simple copy mode
    args.push(
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-f', 'flv',
      stream.rtmpUrl
    );
  } else {
    // Advanced encoding mode
    const videoPreset = VIDEO_PRESETS[quality] || VIDEO_PRESETS.medium;
    const audioPreset = AUDIO_PRESETS[quality] || AUDIO_PRESETS.medium;
    
    const resolution = stream.resolution || '1280x720';
    const bitrate = stream.bitrate || 2500;
    const fps = stream.fps || 30;
    
    args.push(
      '-c:v', 'libx264',
      '-preset', videoPreset.preset,
      '-tune', videoPreset.tune,
      '-b:v', `${bitrate}k`,
      '-maxrate', `${Math.floor(bitrate * videoPreset.maxrate_multiplier)}k`,
      '-bufsize', `${Math.floor(bitrate * videoPreset.bufsize_multiplier)}k`,
      '-pix_fmt', 'yuv420p',
      '-g', videoPreset.g.toString(),
      '-s', resolution,
      '-r', fps.toString(),
      '-c:a', 'aac',
      '-b:a', audioPreset.bitrate,
      '-ar', audioPreset.sampleRate,
      '-f', 'flv',
      stream.rtmpUrl
    );
  }
  
  return args;
}

/**
 * Get recommended bitrate for resolution
 * @param {string} resolution - Video resolution (e.g., '1280x720')
 * @param {string} quality - Quality level (low, medium, high)
 * @returns {number} Recommended bitrate in kbps
 */
function getRecommendedBitrate(resolution, quality = 'medium') {
  const multipliers = {
    low: 0.7,
    medium: 1.0,
    high: 1.5
  };
  
  const baseBitrates = {
    '640x360': 800,
    '854x480': 1200,
    '1280x720': 2500,
    '1920x1080': 4000,
    '2560x1440': 8000,
    '3840x2160': 16000
  };
  
  const baseBitrate = baseBitrates[resolution] || 2500;
  const multiplier = multipliers[quality] || 1.0;
  
  return Math.floor(baseBitrate * multiplier);
}

/**
 * Get recommended FPS for content type
 * @param {string} contentType - Type of content (gaming, presentation, etc.)
 * @returns {number} Recommended FPS
 */
function getRecommendedFPS(contentType) {
  const fpsRecommendations = {
    gaming: 60,
    presentation: 30,
    music: 30,
    general: 30,
    sports: 60
  };
  
  return fpsRecommendations[contentType] || 30;
}

module.exports = {
  BASE_FFMPEG_OPTIONS,
  RTMP_OPTIONS,
  VIDEO_PRESETS,
  AUDIO_PRESETS,
  NETWORK_RESILIENCE_OPTIONS,
  ERROR_RECOVERY_OPTIONS,
  buildFFmpegArgs,
  getRecommendedBitrate,
  getRecommendedFPS
};
