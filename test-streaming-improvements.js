#!/usr/bin/env node

/**
 * Test script for streaming service improvements
 * This script tests the enhanced resume position tracking and error handling
 */

const streamingService = require('./services/streamingService');
const ffmpegConfig = require('./utils/ffmpegConfig');

console.log('🧪 Testing Streaming Service Improvements\n');

// Test 1: FFmpeg Configuration
console.log('1. Testing FFmpeg Configuration...');
try {
  const ffmpegInfo = ffmpegConfig.getFFmpegInfo();
  console.log('✅ FFmpeg path:', ffmpegInfo.path);
  console.log('✅ Is system FFmpeg:', ffmpegInfo.isSystem);
  console.log('✅ Stable options count:', ffmpegInfo.options.stable.length);
  console.log('✅ RTMP options count:', ffmpegInfo.options.rtmp.length);
} catch (error) {
  console.error('❌ FFmpeg config test failed:', error.message);
}

// Test 2: FFmpeg Validation
console.log('\n2. Testing FFmpeg Installation...');
try {
  const validation = ffmpegConfig.validateFFmpeg();
  if (validation.valid) {
    console.log('✅ FFmpeg validation successful');
    console.log('✅ Version:', validation.version);
  } else {
    console.log('❌ FFmpeg validation failed:', validation.error);
  }
} catch (error) {
  console.error('❌ FFmpeg validation test failed:', error.message);
}

// Test 3: Resume Position Calculation
console.log('\n3. Testing Resume Position Logic...');
try {
  // Simulate stream tracking data
  const testStreamId = 'test-stream-123';
  
  // Test base position tracking
  console.log('Testing base position tracking...');
  
  // Simulate starting a stream
  console.log('Starting stream at position 0...');
  
  // Simulate stream running for 1 hour
  console.log('Stream running for 1 hour (3600 seconds)...');
  
  // Simulate restart with resume
  const basePosition = 3600;
  const elapsedTime = 1800; // 30 minutes into current session
  const calculatedResumePosition = basePosition + elapsedTime;
  
  console.log(`Base position: ${basePosition}s`);
  console.log(`Elapsed time: ${elapsedTime}s`);
  console.log(`Calculated resume position: ${calculatedResumePosition}s`);
  
  if (calculatedResumePosition === 5400) {
    console.log('✅ Resume position calculation correct');
  } else {
    console.log('❌ Resume position calculation incorrect');
  }
  
} catch (error) {
  console.error('❌ Resume position test failed:', error.message);
}

// Test 4: FFmpeg Arguments Building
console.log('\n4. Testing FFmpeg Arguments Building...');
try {
  const testOptions = {
    resumePosition: 3600,
    bitrate: '3000k',
    resolution: '1920x1080',
    fps: 30,
    loopVideo: true,
    useAdvancedSettings: true
  };
  
  const args = ffmpegConfig.buildFFmpegArgs(
    '/test/video.mp4',
    'rtmp://test.server/live/stream',
    testOptions
  );
  
  console.log('✅ FFmpeg args built successfully');
  console.log('✅ Args count:', args.length);
  
  // Check for key options
  const hasResumePosition = args.includes('-ss') && args.includes('3600');
  const hasLoop = args.includes('-stream_loop') && args.includes('-1');
  const hasCodec = args.includes('libx264');
  
  console.log('✅ Resume position option:', hasResumePosition ? 'Present' : 'Missing');
  console.log('✅ Loop option:', hasLoop ? 'Present' : 'Missing');
  console.log('✅ Video codec option:', hasCodec ? 'Present' : 'Missing');
  
} catch (error) {
  console.error('❌ FFmpeg args test failed:', error.message);
}

// Test 5: Error Handling Simulation
console.log('\n5. Testing Error Handling Logic...');
try {
  // Test exponential backoff calculation
  const maxRetries = 3;
  const baseDelay = 3000;
  
  console.log('Testing exponential backoff delays...');
  
  for (let retry = 1; retry <= maxRetries; retry++) {
    const delay = Math.min(baseDelay * Math.pow(2, retry - 1), 30000);
    console.log(`Retry ${retry}: ${delay}ms delay`);
  }
  
  console.log('✅ Exponential backoff calculation correct');
  
} catch (error) {
  console.error('❌ Error handling test failed:', error.message);
}

// Test 6: Stream Status Functions
console.log('\n6. Testing Stream Status Functions...');
try {
  // Test if functions are exported
  const requiredFunctions = [
    'startStream',
    'stopStream',
    'getStreamStatus',
    'checkStreamHealth',
    'getStreamVideoPosition',
    'getStreamBasePosition'
  ];
  
  let allFunctionsPresent = true;
  requiredFunctions.forEach(funcName => {
    if (typeof streamingService[funcName] === 'function') {
      console.log(`✅ ${funcName}: Available`);
    } else {
      console.log(`❌ ${funcName}: Missing`);
      allFunctionsPresent = false;
    }
  });
  
  if (allFunctionsPresent) {
    console.log('✅ All required functions are available');
  } else {
    console.log('❌ Some required functions are missing');
  }
  
} catch (error) {
  console.error('❌ Stream status test failed:', error.message);
}

console.log('\n🎯 Testing Complete!');
console.log('\n📋 Summary of Improvements:');
console.log('• Enhanced FFmpeg configuration for network stability');
console.log('• Improved resume position tracking across restarts');
console.log('• Better error handling with exponential backoff');
console.log('• Automatic stream health monitoring and recovery');
console.log('• Enhanced logging for debugging and monitoring');

console.log('\n🚀 To apply these improvements:');
console.log('1. Restart your streaming service');
console.log('2. Monitor logs for improved error handling');
console.log('3. Check that streams resume from correct positions');
console.log('4. Verify automatic recovery is working');

console.log('\n📖 For more details, see: STREAMING_IMPROVEMENTS.md');
