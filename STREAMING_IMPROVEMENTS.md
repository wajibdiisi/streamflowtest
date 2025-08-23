# Streaming Service Improvements

## Overview
This document outlines the improvements made to the streaming service to address network stability issues, broken pipe errors, and resume position problems.

## Issues Addressed

### 1. Broken Pipe Errors
- **Problem**: FFmpeg processes were failing with "Broken pipe" errors when network connections to YouTube RTMP servers were interrupted
- **Solution**: 
  - Enhanced FFmpeg options for better network stability
  - Added exponential backoff for retry attempts
  - Improved error detection and handling

### 2. Stream Restart from Beginning
- **Problem**: When streams failed and restarted, they would start from the beginning instead of resuming from where they left off
- **Solution**:
  - Implemented cumulative resume position tracking
  - Added `streamBasePositions` map to track base positions across restarts
  - Improved position calculation logic

### 3. Maximum Retry Attempts
- **Problem**: Streams would stop permanently after 3 failed restart attempts
- **Solution**:
  - Added health check mechanism to detect and recover orphaned streams
  - Implemented automatic recovery for streams marked as 'live' but not active
  - Enhanced retry logic with exponential backoff

## Technical Improvements

### FFmpeg Configuration (`utils/ffmpegConfig.js`)
- **Enhanced stability options**:
  - `-max_muxing_queue_size 1024`: Prevents buffer overflow
  - `-tune zerolatency`: Optimizes for low-latency streaming
  - `-rtmp_buffer 5000`: Increases RTMP buffer size
  - `-rtmp_conn B:1`: Improves connection handling

### Resume Position Tracking
- **Base Position**: Tracks the cumulative position across all restarts
- **Current Position**: Tracks the current position within the current stream instance
- **Cumulative Calculation**: `resumePosition = basePosition + elapsedTime`

### Error Handling
- **Network Error Detection**: Detects broken pipe, connection refused, and other network issues
- **Exponential Backoff**: Retry delays increase exponentially (3s, 6s, 12s, max 30s)
- **Health Monitoring**: Automatic detection and recovery of inconsistent stream states

### Stream Health Monitoring
- **Status Sync**: Runs every 5 minutes to check for inconsistencies
- **Auto-Recovery**: Automatically attempts to recover streams that are marked as 'live' but not active
- **Logging**: Enhanced logging for better debugging and monitoring

## Configuration Changes

### FFmpeg Options
```javascript
// Before: Basic options
const STABLE_FFMPEG_OPTIONS = [
  '-hwaccel', 'none',
  '-loglevel', 'error',
  '-re'
];

// After: Enhanced options
const STABLE_FFMPEG_OPTIONS = [
  '-hwaccel', 'none',
  '-loglevel', 'error',
  '-re',
  '-fflags', '+genpts+igndts+discardcorrupt',
  '-avoid_negative_ts', 'make_zero',
  '-max_muxing_queue_size', '1024',
  '-tune', 'zerolatency'
];
```

### RTMP Network Options
```javascript
const RTMP_NETWORK_OPTIONS = [
  '-flvflags', 'no_duration_filesize',
  '-rtmp_live', 'live',
  '-rtmp_buffer', '5000',
  '-rtmp_conn', 'B:1',
  '-rtmp_tls', '0',
  '-rtmp_tls_verify', '0'
];
```

## Usage

### Starting a Stream with Resume
```javascript
// Start fresh
await startStream(streamId);

// Resume from specific position
await startStream(streamId, 3600); // Resume from 1 hour mark
```

### Monitoring Stream Health
```javascript
// Get comprehensive stream status
const status = getStreamStatus(streamId);
console.log('Stream position:', status.videoPosition);
console.log('Base position:', status.basePosition);
console.log('Retry count:', status.retryCount);

// Check if stream needs recovery
const needsRecovery = await checkStreamHealth(streamId);
```

## Monitoring and Debugging

### Log Messages
- **Position tracking**: Logs resume positions and calculations
- **Network errors**: Detects and logs network-related issues
- **Recovery attempts**: Tracks restart attempts and success/failure

### Health Checks
- **Automatic**: Runs every 5 minutes via `syncStreamStatuses()`
- **Manual**: Can be triggered via `checkStreamHealth(streamId)`
- **Recovery**: Automatically attempts to recover orphaned streams

## Expected Results

1. **Reduced Network Failures**: Better handling of temporary network issues
2. **Seamless Restarts**: Streams resume from where they left off instead of starting over
3. **Improved Stability**: Fewer permanent stream failures due to network issues
4. **Better Monitoring**: Enhanced logging and health checking for proactive maintenance

## Troubleshooting

### If Streams Still Fail
1. Check FFmpeg installation: `ffmpegConfig.validateFFmpeg()`
2. Review logs for specific error messages
3. Verify network connectivity to RTMP servers
4. Check system resources (CPU, memory, disk space)

### If Resume Position is Incorrect
1. Check `streamBasePositions` map in memory
2. Verify `streamVideoPositions` tracking
3. Review logs for position calculation messages
4. Ensure cleanup functions aren't removing position data prematurely

## Future Improvements

1. **Persistent Storage**: Save resume positions to database for server restarts
2. **Adaptive Bitrate**: Automatically adjust bitrate based on network conditions
3. **Multiple RTMP Endpoints**: Fallback to backup streaming servers
4. **Metrics Collection**: Track success rates and failure patterns
5. **WebSocket Monitoring**: Real-time stream status updates to frontend
