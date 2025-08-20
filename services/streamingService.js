const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const schedulerService = require('./schedulerService');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');

let ffmpegPath;
if (fs.existsSync('/usr/bin/ffmpeg')) {
  ffmpegPath = '/usr/bin/ffmpeg';
  console.log('Using system FFmpeg at:', ffmpegPath);
} else {
  ffmpegPath = ffmpegInstaller.path;
  console.log('Using bundled FFmpeg at:', ffmpegPath);
}

const Stream = require('../models/Stream');
const Video = require('../models/Video');

// Import health monitor (will be initialized after this module loads)
let streamHealthMonitor = null;

const activeStreams = new Map();
const streamLogs = new Map();
const streamRetryCount = new Map();
const streamStartTimes = new Map(); // Track when each stream started
const streamVideoPositions = new Map(); // Track video position for each stream
const MAX_RETRY_ATTEMPTS = 3;
const manuallyStoppingStreams = new Set();
const MAX_LOG_LINES = 100;

// Enhanced FFmpeg options for better stability
const STABLE_FFMPEG_OPTIONS = [
  '-hwaccel', 'none',
  '-loglevel', 'error',
  '-re',
  '-fflags', '+genpts+igndts+discardcorrupt',
  '-avoid_negative_ts', 'make_zero',
  '-max_muxing_queue_size', '1024'
];

// Initialize health monitor reference
function setHealthMonitor(healthMonitor) {
  streamHealthMonitor = healthMonitor;
}

function addStreamLog(streamId, message) {
  if (!streamLogs.has(streamId)) {
    streamLogs.set(streamId, []);
  }
  const logs = streamLogs.get(streamId);
  logs.push({
    timestamp: new Date().toISOString(),
    message
  });
  if (logs.length > MAX_LOG_LINES) {
    logs.shift();
  }
}

async function buildFFmpegArgs(stream, resumePosition = null) {
  const video = await Video.findById(stream.video_id);
  if (!video) {
    throw new Error(`Video record not found in database for video_id: ${stream.video_id}`);
  }

  const relativeVideoPath = video.filepath.startsWith('/') ? video.filepath.substring(1) : video.filepath;
  const projectRoot = path.resolve(__dirname, '..');
  const videoPath = path.join(projectRoot, 'public', relativeVideoPath);

  if (!fs.existsSync(videoPath)) {
    console.error(`[StreamingService] CRITICAL: Video file not found on disk.`);
    console.error(`[StreamingService] Checked path: ${videoPath}`);
    console.error(`[StreamingService] stream.video_id: ${stream.video_id}`);
    console.error(`[StreamingService] video.filepath (from DB): ${video.filepath}`);
    console.error(`[StreamingService] Calculated relativeVideoPath: ${relativeVideoPath}`);
    console.error(`[StreamingService] process.cwd(): ${process.cwd()}`);
    throw new Error('Video file not found on disk. Please check paths and file existence.');
  }

  const rtmpUrl = `${stream.rtmp_url.replace(/\/$/, '')}/${stream.stream_key}`;
  
  // Base arguments with enhanced stability options
  let args = [...STABLE_FFMPEG_OPTIONS];

  // Add resume position if available
  if (resumePosition && resumePosition > 0) {
    args.push('-ss', resumePosition.toString());
    addStreamLog(stream.id, `Resuming stream from position: ${resumePosition}s`);
  }

  // Add loop options
  if (stream.loop_video) {
    args.push('-stream_loop', '-1');
  } else {
    args.push('-stream_loop', '0');
  }

  // Add input file
  args.push('-i', videoPath);

  if (!stream.use_advanced_settings) {
    // Simple copy mode with enhanced stability
    args.push(
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-f', 'flv',
      rtmpUrl
    );
  } else {
    // Advanced encoding mode with enhanced stability
    const resolution = stream.resolution || '1280x720';
    const bitrate = stream.bitrate || 2500;
    const fps = stream.fps || 30;
    
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-b:v', `${bitrate}k`,
      '-maxrate', `${bitrate * 1.5}k`,
      '-bufsize', `${bitrate * 2}k`,
      '-pix_fmt', 'yuv420p',
      '-g', '60',
      '-s', resolution,
      '-r', fps.toString(),
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-f', 'flv',
      rtmpUrl
    );
  }

  return args;
}

async function startStream(streamId, resumePosition = null) {
  try {
    // Reset retry count only if this is a fresh start
    if (!resumePosition) {
      streamRetryCount.set(streamId, 0);
    }

    if (activeStreams.has(streamId)) {
      return { success: false, error: 'Stream is already active' };
    }

    const stream = await Stream.findById(streamId);
    if (!stream) {
      return { success: false, error: 'Stream not found' };
    }

    const ffmpegArgs = await buildFFmpegArgs(stream, resumePosition);
    const fullCommand = `${ffmpegPath} ${ffmpegArgs.join(' ')}`;
    
    addStreamLog(streamId, `Starting stream with command: ${fullCommand}`);
    if (resumePosition) {
      addStreamLog(streamId, `Resuming from position: ${resumePosition}s`);
    }
    
    console.log(`Starting stream: ${fullCommand}`);

    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    activeStreams.set(streamId, ffmpegProcess);
    
    // Track start time for this stream instance
    const startTime = new Date();
    streamStartTimes.set(streamId, startTime);
    
    // Update stream status
    await Stream.updateStatus(streamId, 'live', stream.user_id);

    // Enhanced error handling and monitoring
    ffmpegProcess.stdout.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        addStreamLog(streamId, `[OUTPUT] ${message}`);
        console.log(`[FFMPEG_STDOUT] ${streamId}: ${message}`);
      }
    });

    ffmpegProcess.stderr.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        addStreamLog(streamId, `[FFmpeg] ${message}`);
        
        // Log important messages but filter out frame info
        if (!message.includes('frame=') && !message.includes('fps=')) {
          console.error(`[FFMPEG_STDERR] ${streamId}: ${message}`);
        }
        
        // Check for specific error conditions
        if (message.includes('Broken pipe') || message.includes('Connection refused')) {
          addStreamLog(streamId, `Network error detected: ${message}`);
        }
      }
    });

    ffmpegProcess.on('exit', async (code, signal) => {
      addStreamLog(streamId, `Stream ended with code ${code}, signal: ${signal}`);
      console.log(`[FFMPEG_EXIT] ${streamId}: Code=${code}, Signal=${signal}`);
      
      const wasActive = activeStreams.delete(streamId);
      const isManualStop = manuallyStoppingStreams.has(streamId);
      
      if (isManualStop) {
        console.log(`[StreamingService] Stream ${streamId} was manually stopped, not restarting`);
        manuallyStoppingStreams.delete(streamId);
        if (wasActive) {
          try {
            await Stream.updateStatus(streamId, 'offline');
            if (typeof schedulerService !== 'undefined' && schedulerService.cancelStreamTermination) {
              schedulerService.handleStreamStopped(streamId);
            }
          } catch (error) {
            console.error(`[StreamingService] Error updating stream status after manual stop: ${error.message}`);
          }
        }
        return;
      }

      // Handle different exit scenarios
      if (signal === 'SIGSEGV') {
        await handleStreamCrash(streamId, 'SIGSEGV');
      } else if (code !== 0 && code !== null) {
        await handleStreamError(streamId, code, signal);
      } else {
        // Normal exit
        if (wasActive) {
          try {
            console.log(`[StreamingService] Updating stream ${streamId} status to offline after FFmpeg exit`);
            await Stream.updateStatus(streamId, 'offline');
            if (typeof schedulerService !== 'undefined' && schedulerService.cancelStreamTermination) {
              schedulerService.handleStreamStopped(streamId);
            }
          } catch (error) {
            console.error(`[StreamingService] Error updating stream status after exit: ${error.message}`);
          }
        }
      }
    });

    ffmpegProcess.on('error', async (err) => {
      addStreamLog(streamId, `Error in stream process: ${err.message}`);
      console.error(`[FFMPEG_PROCESS_ERROR] ${streamId}: ${err.message}`);
      activeStreams.delete(streamId);
      try {
        await Stream.updateStatus(streamId, 'offline');
      } catch (error) {
        console.error(`Error updating stream status: ${error.message}`);
      }
    });

    ffmpegProcess.unref();

    // Schedule termination if duration is set
    if (stream.duration && typeof schedulerService !== 'undefined') {
      schedulerService.scheduleStreamTermination(streamId, stream.duration);
    }

    return {
      success: true,
      message: 'Stream started successfully',
      isAdvancedMode: stream.use_advanced_settings,
      resumed: !!resumePosition
    };
  } catch (error) {
    addStreamLog(streamId, `Failed to start stream: ${error.message}`);
    console.error(`Error starting stream ${streamId}:`, error);
    return { success: false, error: error.message };
  }
}

async function handleStreamCrash(streamId, reason) {
  const retryCount = streamRetryCount.get(streamId) || 0;
  if (retryCount < MAX_RETRY_ATTEMPTS) {
    streamRetryCount.set(streamId, retryCount + 1);
    console.log(`[StreamingService] FFmpeg crashed with ${reason}. Attempting restart #${retryCount + 1} for stream ${streamId}`);
    addStreamLog(streamId, `FFmpeg crashed with ${reason}. Attempting restart #${retryCount + 1}`);
    
    // Calculate resume position based on how long the stream was running
    const resumePosition = calculateResumePosition(streamId);
    
    setTimeout(async () => {
      try {
        const streamInfo = await Stream.findById(streamId);
        if (streamInfo) {
          const result = await startStream(streamId, resumePosition);
          if (!result.success) {
            console.error(`[StreamingService] Failed to restart stream: ${result.error}`);
            await Stream.updateStatus(streamId, 'offline');
          }
        } else {
          console.error(`[StreamingService] Cannot restart stream ${streamId}: not found in database`);
        }
      } catch (error) {
        console.error(`[StreamingService] Error during stream restart: ${error.message}`);
        try {
          await Stream.updateStatus(streamId, 'offline');
        } catch (dbError) {
          console.error(`Error updating stream status: ${dbError.message}`);
        }
      }
    }, 3000);
  } else {
    console.error(`[StreamingService] Maximum retry attempts (${MAX_RETRY_ATTEMPTS}) reached for stream ${streamId}`);
    addStreamLog(streamId, `Maximum retry attempts (${MAX_RETRY_ATTEMPTS}) reached, stopping stream`);
    try {
      await Stream.updateStatus(streamId, 'offline');
    } catch (error) {
      console.error(`Error updating stream status: ${error.message}`);
    }
  }
}

async function handleStreamError(streamId, code, signal) {
  let errorMessage = `FFmpeg process exited with error code ${code}`;
  addStreamLog(streamId, errorMessage);
  console.error(`[StreamingService] ${errorMessage} for stream ${streamId}`);
  
  const retryCount = streamRetryCount.get(streamId) || 0;
  if (retryCount < MAX_RETRY_ATTEMPTS) {
    streamRetryCount.set(streamId, retryCount + 1);
    console.log(`[StreamingService] FFmpeg exited with code ${code}. Attempting restart #${retryCount + 1} for stream ${streamId}`);
    
    // Calculate resume position based on how long the stream was running
    const resumePosition = calculateResumePosition(streamId);
    
    setTimeout(async () => {
      try {
        const streamInfo = await Stream.findById(streamId);
        if (streamInfo) {
          const result = await startStream(streamId, resumePosition);
          if (!result.success) {
            console.error(`[StreamingService] Failed to restart stream: ${result.error}`);
            await Stream.updateStatus(streamId, 'offline');
          }
        }
      } catch (error) {
        console.error(`[StreamingService] Error during stream restart: ${error.message}`);
        await Stream.updateStatus(streamId, 'offline');
      }
    }, 3000);
  } else {
    console.error(`[StreamingService] Maximum retry attempts (${MAX_RETRY_ATTEMPTS}) reached for stream ${streamId}`);
    addStreamLog(streamId, `Maximum retry attempts (${MAX_RETRY_ATTEMPTS}) reached, stopping stream`);
    try {
      await Stream.updateStatus(streamId, 'offline');
    } catch (error) {
      console.error(`Error updating stream status: ${error.message}`);
    }
  }
}

function calculateResumePosition(streamId) {
  const startTime = streamStartTimes.get(streamId);
  if (!startTime) return 0;
  
  const now = new Date();
  const elapsedSeconds = Math.floor((now - startTime) / 1000);
  
  // Store the calculated position for this stream
  streamVideoPositions.set(streamId, elapsedSeconds);
  
  addStreamLog(streamId, `Calculated resume position: ${elapsedSeconds}s (elapsed time)`);
  return elapsedSeconds;
}

async function stopStream(streamId) {
  try {
    const ffmpegProcess = activeStreams.get(streamId);
    const isActive = ffmpegProcess !== undefined;
    console.log(`[StreamingService] Stop request for stream ${streamId}, isActive: ${isActive}`);
    
    if (!isActive) {
      const stream = await Stream.findById(streamId);
      if (stream && stream.status === 'live') {
        console.log(`[StreamingService] Stream ${streamId} not active in memory but status is 'live' in DB. Fixing status.`);
        await Stream.updateStatus(streamId, 'offline', stream.user_id);
        if (typeof schedulerService !== 'undefined' && schedulerService.cancelStreamTermination) {
          schedulerService.handleStreamStopped(streamId);
        }
        return { success: true, message: 'Stream status fixed (was not active but marked as live)' };
      }
      return { success: false, error: 'Stream is not active' };
    }

    addStreamLog(streamId, 'Stopping stream...');
    console.log(`[StreamingService] Stopping active stream ${streamId}`);
    manuallyStoppingStreams.add(streamId);
    
    try {
      ffmpegProcess.kill('SIGTERM');
    } catch (killError) {
      console.error(`[StreamingService] Error killing FFmpeg process: ${killError.message}`);
      manuallyStoppingStreams.delete(streamId);
    }

    const stream = await Stream.findById(streamId);
    activeStreams.delete(streamId);
    
    // Cleanup tracking data
    cleanupStreamData(streamId);
    
    if (stream) {
      await Stream.updateStatus(streamId, 'offline', stream.user_id);
      const updatedStream = await Stream.findById(streamId);
      await saveStreamHistory(updatedStream);
    }
    
    if (typeof schedulerService !== 'undefined' && schedulerService.cancelStreamTermination) {
      schedulerService.handleStreamStopped(streamId);
    }
    
    return { success: true, message: 'Stream stopped successfully' };
  } catch (error) {
    manuallyStoppingStreams.delete(streamId);
    console.error(`[StreamingService] Error stopping stream ${streamId}:`, error);
    return { success: false, error: error.message };
  }
}

function cleanupStreamData(streamId) {
  // Clean up all tracking data for this stream
  streamStartTimes.delete(streamId);
  streamVideoPositions.delete(streamId);
  streamRetryCount.delete(streamId);
  streamLogs.delete(streamId);
  
  // Notify health monitor if available
  if (streamHealthMonitor && typeof streamHealthMonitor.cleanupStream === 'function') {
    streamHealthMonitor.cleanupStream(streamId);
  }
  
  console.log(`[StreamingService] Cleaned up tracking data for stream ${streamId}`);
}

async function syncStreamStatuses() {
  try {
    console.log('[StreamingService] Syncing stream statuses...');
    const liveStreams = await Stream.findAll(null, 'live');
    for (const stream of liveStreams) {
      const isReallyActive = activeStreams.has(stream.id);
      if (!isReallyActive) {
        console.log(`[StreamingService] Found inconsistent stream ${stream.id}: marked as 'live' in DB but not active in memory`);
        await Stream.updateStatus(stream.id, 'offline');
        console.log(`[StreamingService] Updated stream ${stream.id} status to 'offline'`);
      }
    }
    const activeStreamIds = Array.from(activeStreams.keys());
    for (const streamId of activeStreamIds) {
      const stream = await Stream.findById(streamId);
      if (!stream || stream.status !== 'live') {
        console.log(`[StreamingService] Found inconsistent stream ${streamId}: active in memory but not 'live' in DB`);
        if (stream) {
          await Stream.updateStatus(streamId, 'live');
          console.log(`[StreamingService] Updated stream ${streamId} status to 'live'`);
        } else {
          console.log(`[StreamingService] Stream ${streamId} not found in DB, removing from active streams`);
          const process = activeStreams.get(streamId);
          if (process) {
            try {
              process.kill('SIGTERM');
            } catch (error) {
              console.error(`[StreamingService] Error killing orphaned process: ${error.message}`);
            }
          }
          activeStreams.delete(streamId);
        }
      }
    }
    console.log(`[StreamingService] Stream status sync completed. Active streams: ${activeStreamIds.length}`);
  } catch (error) {
    console.error('[StreamingService] Error syncing stream statuses:', error);
  }
}
setInterval(syncStreamStatuses, 5 * 60 * 1000);
function isStreamActive(streamId) {
  return activeStreams.has(streamId);
}
function getActiveStreams() {
  return Array.from(activeStreams.keys());
}
function getStreamLogs(streamId) {
  return streamLogs.get(streamId) || [];
}
async function saveStreamHistory(stream) {
  try {
    if (!stream.start_time) {
      console.log(`[StreamingService] Not saving history for stream ${stream.id} - no start time recorded`);
      return false;
    }
    const startTime = new Date(stream.start_time);
    const endTime = stream.end_time ? new Date(stream.end_time) : new Date();
    const durationSeconds = Math.floor((endTime - startTime) / 1000);
    if (durationSeconds < 1) {
      console.log(`[StreamingService] Not saving history for stream ${stream.id} - duration too short (${durationSeconds}s)`);
      return false;
    }
    const videoDetails = stream.video_id ? await Video.findById(stream.video_id) : null;
    const historyData = {
      id: uuidv4(),
      stream_id: stream.id,
      title: stream.title,
      platform: stream.platform || 'Custom',
      platform_icon: stream.platform_icon,
      video_id: stream.video_id,
      video_title: videoDetails ? videoDetails.title : null,
      resolution: stream.resolution,
      bitrate: stream.bitrate,
      fps: stream.fps,
      start_time: stream.start_time,
      end_time: stream.end_time || new Date().toISOString(),
      duration: durationSeconds,
      use_advanced_settings: stream.use_advanced_settings ? 1 : 0,
      user_id: stream.user_id
    };
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO stream_history (
          id, stream_id, title, platform, platform_icon, video_id, video_title,
          resolution, bitrate, fps, start_time, end_time, duration, use_advanced_settings, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          historyData.id, historyData.stream_id, historyData.title,
          historyData.platform, historyData.platform_icon, historyData.video_id, historyData.video_title,
          historyData.resolution, historyData.bitrate, historyData.fps,
          historyData.start_time, historyData.end_time, historyData.duration,
          historyData.use_advanced_settings, historyData.user_id
        ],
        function (err) {
          if (err) {
            console.error('[StreamingService] Error saving stream history:', err.message);
            return reject(err);
          }
          console.log(`[StreamingService] Stream history saved for stream ${stream.id}, duration: ${durationSeconds}s`);
          resolve(historyData);
        }
      );
    });
  } catch (error) {
    console.error('[StreamingService] Failed to save stream history:', error);
    return false;
  }
}
function getStreamVideoPosition(streamId) {
  return streamVideoPositions.get(streamId) || 0;
}

function getStreamStartTime(streamId) {
  return streamStartTimes.get(streamId);
}

function getStreamElapsedTime(streamId) {
  const startTime = streamStartTimes.get(streamId);
  if (!startTime) return 0;
  
  const now = new Date();
  return Math.floor((now - startTime) / 1000);
}

// Enhanced function to get comprehensive stream status
function getStreamStatus(streamId) {
  const isActive = activeStreams.has(streamId);
  const startTime = streamStartTimes.get(streamId);
  const videoPosition = streamVideoPositions.get(streamId);
  const retryCount = streamRetryCount.get(streamId) || 0;
  const logs = streamLogs.get(streamId) || [];
  
  return {
    isActive,
    startTime: startTime ? startTime.toISOString() : null,
    elapsedTime: startTime ? getStreamElapsedTime(streamId) : 0,
    videoPosition,
    retryCount,
    logCount: logs.length,
    lastLog: logs.length > 0 ? logs[logs.length - 1] : null
  };
}

module.exports = {
  startStream,
  stopStream,
  isStreamActive,
  getActiveStreams,
  getStreamLogs,
  syncStreamStatuses,
  saveStreamHistory,
  getStreamVideoPosition,
  getStreamStartTime,
  getStreamElapsedTime,
  getStreamStatus,
  cleanupStreamData,
  setHealthMonitor
};
// Scheduler is initialized once from the application entrypoint to avoid double timers