/**
 * Main Service Index
 * Initializes all services in the correct order
 */

const streamingService = require('./streamingService');
const schedulerService = require('./schedulerService');
const streamHealthMonitor = require('./streamHealthMonitor');
const logger = require('./logger');

// Initialize services in dependency order
function initializeServices() {
  try {
    console.log('[Services] Initializing services...');
    
    // 1. Initialize streaming service first
    console.log('[Services] Initializing streaming service...');
    
    // 2. Initialize scheduler service with streaming service reference
    console.log('[Services] Initializing scheduler service...');
    schedulerService.init(streamingService);
    
    // 3. Set up health monitor with streaming service reference
    console.log('[Services] Setting up health monitor...');
    streamingService.setHealthMonitor(streamHealthMonitor);
    
    // 4. Start health monitoring
    console.log('[Services] Starting stream health monitoring...');
    streamHealthMonitor.startMonitoring();
    
    // 5. Set up event listeners for health monitor
    streamHealthMonitor.on('streamRecovered', ({ streamId, resumePosition }) => {
      logger.info(`Stream ${streamId} successfully recovered from position ${resumePosition}s`);
    });
    
    streamHealthMonitor.on('streamRecoveryFailed', ({ streamId, error }) => {
      logger.error(`Failed to recover stream ${streamId}: ${error}`);
    });
    
    console.log('[Services] All services initialized successfully');
    
    return {
      streamingService,
      schedulerService,
      streamHealthMonitor,
      logger
    };
    
  } catch (error) {
    console.error('[Services] Error initializing services:', error);
    throw error;
  }
}

// Graceful shutdown function
async function shutdownServices() {
  try {
    console.log('[Services] Shutting down services...');
    
    // Stop health monitoring
    if (streamHealthMonitor) {
      streamHealthMonitor.stopMonitoring();
    }
    
    // Stop all active streams
    const activeStreams = streamingService.getActiveStreams();
    for (const streamId of activeStreams) {
      try {
        await streamingService.stopStream(streamId);
      } catch (error) {
        console.error(`[Services] Error stopping stream ${streamId} during shutdown:`, error);
      }
    }
    
    console.log('[Services] All services shut down successfully');
    
  } catch (error) {
    console.error('[Services] Error during service shutdown:', error);
  }
}

// Handle process termination signals
process.on('SIGINT', async () => {
  console.log('[Services] Received SIGINT, shutting down...');
  await shutdownServices();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Services] Received SIGTERM, shutting down...');
  await shutdownServices();
  process.exit(0);
});

// Export services and initialization functions
module.exports = {
  initializeServices,
  shutdownServices,
  streamingService,
  schedulerService,
  streamHealthMonitor,
  logger
};
