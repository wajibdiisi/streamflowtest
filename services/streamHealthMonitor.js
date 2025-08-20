/**
 * Stream Health Monitor Service
 * Monitors active streams and handles automatic recovery
 */

const { EventEmitter } = require('events');
const streamingService = require('./streamingService');

class StreamHealthMonitor extends EventEmitter {
  constructor() {
    super();
    this.monitoringInterval = null;
    this.healthChecks = new Map();
    this.MONITORING_INTERVAL = 10000; // 10 seconds
    this.HEALTH_CHECK_TIMEOUT = 30000; // 30 seconds
    this.MAX_CONSECUTIVE_FAILURES = 3;
  }

  /**
   * Start monitoring all active streams
   */
  startMonitoring() {
    if (this.monitoringInterval) {
      console.log('[StreamHealthMonitor] Monitoring already active');
      return;
    }

    console.log('[StreamHealthMonitor] Starting stream health monitoring...');
    
    this.monitoringInterval = setInterval(() => {
      this.checkAllStreams();
    }, this.MONITORING_INTERVAL);

    // Initial check
    this.checkAllStreams();
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('[StreamHealthMonitor] Stopped stream health monitoring');
    }
  }

  /**
   * Check health of all active streams
   */
  async checkAllStreams() {
    try {
      const activeStreams = streamingService.getActiveStreams();
      
      for (const streamId of activeStreams) {
        await this.checkStreamHealth(streamId);
      }
    } catch (error) {
      console.error('[StreamHealthMonitor] Error checking stream health:', error);
    }
  }

  /**
   * Check health of a specific stream
   */
  async checkStreamHealth(streamId) {
    try {
      const streamStatus = streamingService.getStreamStatus(streamId);
      
      if (!streamStatus.isActive) {
        // Stream is not active, remove from health checks
        this.healthChecks.delete(streamId);
        return;
      }

      // Check if stream has been running for too long without activity
      const elapsedTime = streamStatus.elapsedTime;
      const lastLog = streamStatus.lastLog;
      
      if (elapsedTime > this.HEALTH_CHECK_TIMEOUT / 1000) {
        // Check if we have recent logs
        if (lastLog) {
          const lastLogTime = new Date(lastLog.timestamp);
          const timeSinceLastLog = Date.now() - lastLogTime.getTime();
          
          if (timeSinceLastLog > this.HEALTH_CHECK_TIMEOUT) {
            console.warn(`[StreamHealthMonitor] Stream ${streamId} appears to be stalled (no logs for ${Math.floor(timeSinceLastLog / 1000)}s)`);
            await this.handleStalledStream(streamId);
            return;
          }
        }
      }

      // Update health check status
      this.updateHealthStatus(streamId, true);
      
    } catch (error) {
      console.error(`[StreamHealthMonitor] Error checking health for stream ${streamId}:`, error);
      this.updateHealthStatus(streamId, false);
    }
  }

  /**
   * Update health status for a stream
   */
  updateHealthStatus(streamId, isHealthy) {
    if (!this.healthChecks.has(streamId)) {
      this.healthChecks.set(streamId, {
        consecutiveFailures: 0,
        lastCheck: Date.now(),
        isHealthy: true
      });
    }

    const healthCheck = this.healthChecks.get(streamId);
    
    if (isHealthy) {
      healthCheck.consecutiveFailures = 0;
      healthCheck.isHealthy = true;
    } else {
      healthCheck.consecutiveFailures++;
      healthCheck.isHealthy = false;
      
      console.warn(`[StreamHealthMonitor] Stream ${streamId} health check failed (${healthCheck.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES})`);
      
      if (healthCheck.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        this.handleUnhealthyStream(streamId);
      }
    }
    
    healthCheck.lastCheck = Date.now();
  }

  /**
   * Handle stalled stream (no recent activity)
   */
  async handleStalledStream(streamId) {
    try {
      console.log(`[StreamHealthMonitor] Attempting to recover stalled stream ${streamId}`);
      
      // Get current video position
      const videoPosition = streamingService.getStreamVideoPosition(streamId);
      const elapsedTime = streamingService.getStreamElapsedTime(streamId);
      
      // Calculate resume position (use elapsed time if video position is not available)
      const resumePosition = videoPosition > 0 ? videoPosition : elapsedTime;
      
      console.log(`[StreamHealthMonitor] Resuming stream ${streamId} from position ${resumePosition}s`);
      
      // Stop current stream
      await streamingService.stopStream(streamId);
      
      // Wait a bit before restarting
      setTimeout(async () => {
        try {
          const result = await streamingService.startStream(streamId, resumePosition);
          if (result.success) {
            console.log(`[StreamHealthMonitor] Successfully recovered stalled stream ${streamId}`);
            this.emit('streamRecovered', { streamId, resumePosition });
          } else {
            console.error(`[StreamHealthMonitor] Failed to recover stalled stream ${streamId}: ${result.error}`);
            this.emit('streamRecoveryFailed', { streamId, error: result.error });
          }
        } catch (error) {
          console.error(`[StreamHealthMonitor] Error during stalled stream recovery: ${error.message}`);
          this.emit('streamRecoveryFailed', { streamId, error: error.message });
        }
      }, 2000);
      
    } catch (error) {
      console.error(`[StreamHealthMonitor] Error handling stalled stream ${streamId}:`, error);
    }
  }

  /**
   * Handle unhealthy stream (multiple consecutive failures)
   */
  async handleUnhealthyStream(streamId) {
    try {
      console.log(`[StreamHealthMonitor] Stream ${streamId} is unhealthy, attempting recovery`);
      
      // Get current video position for resume
      const videoPosition = streamingService.getStreamVideoPosition(streamId);
      const elapsedTime = streamingService.getStreamElapsedTime(streamId);
      const resumePosition = videoPosition > 0 ? videoPosition : elapsedTime;
      
      // Stop current stream
      await streamingService.stopStream(streamId);
      
      // Wait before restarting
      setTimeout(async () => {
        try {
          const result = await streamingService.startStream(streamId, resumePosition);
          if (result.success) {
            console.log(`[StreamHealthMonitor] Successfully recovered unhealthy stream ${streamId}`);
            this.emit('streamRecovered', { streamId, resumePosition });
            
            // Reset health check status
            this.healthChecks.delete(streamId);
          } else {
            console.error(`[StreamHealthMonitor] Failed to recover unhealthy stream ${streamId}: ${result.error}`);
            this.emit('streamRecoveryFailed', { streamId, error: result.error });
          }
        } catch (error) {
          console.error(`[StreamHealthMonitor] Error during unhealthy stream recovery: ${error.message}`);
          this.emit('streamRecoveryFailed', { streamId, error: error.message });
        }
      }, 5000);
      
    } catch (error) {
      console.error(`[StreamHealthMonitor] Error handling unhealthy stream ${streamId}:`, error);
    }
  }

  /**
   * Get health status for all streams
   */
  getHealthStatus() {
    const status = {};
    
    for (const [streamId, healthCheck] of this.healthChecks) {
      status[streamId] = {
        isHealthy: healthCheck.isHealthy,
        consecutiveFailures: healthCheck.consecutiveFailures,
        lastCheck: new Date(healthCheck.lastCheck).toISOString(),
        timeSinceLastCheck: Date.now() - healthCheck.lastCheck
      };
    }
    
    return status;
  }

  /**
   * Force health check for a specific stream
   */
  async forceHealthCheck(streamId) {
    console.log(`[StreamHealthMonitor] Forcing health check for stream ${streamId}`);
    await this.checkStreamHealth(streamId);
  }

  /**
   * Clean up health check data for a stream
   */
  cleanupStream(streamId) {
    this.healthChecks.delete(streamId);
    console.log(`[StreamHealthMonitor] Cleaned up health check data for stream ${streamId}`);
  }
}

// Create singleton instance
const streamHealthMonitor = new StreamHealthMonitor();

// Export singleton instance
module.exports = streamHealthMonitor;
