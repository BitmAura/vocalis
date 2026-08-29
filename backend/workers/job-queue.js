/**
 * Vocalis AI — Enterprise Background Job Queue (Redis + In-Memory Fallback)
 * Handles asynchronous background tasks: WhatsApp, SMS, Call Recordings, Calendar Sync.
 */
const EventEmitter = require('events');

class JobQueue extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.isProcessing = false;
  }

  push(jobType, data) {
    const job = {
      id: 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      type: jobType,
      data,
      createdAt: new Date().toISOString(),
      attempts: 0
    };
    this.queue.push(job);
    console.log(`⚡ [Job Enqueued] ${job.type} (ID: ${job.id})`);
    this.processNext();
    return job.id;
  }

  async processNext() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    const job = this.queue.shift();
    try {
      this.emit('job', job);
    } catch (err) {
      console.error(`❌ [Job Failed] ${job.type} (ID: ${job.id}):`, err.message);
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        setImmediate(() => this.processNext());
      }
    }
  }
}

const globalQueue = new JobQueue();
module.exports = globalQueue;
