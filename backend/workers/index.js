/**
 * Vocalis AI — Dedicated Background Worker Microservice
 */
const jobQueue = require('./job-queue');
const whatsAppDispatcher = require('../services/whatsapp-dispatcher');
const bookingEngine = require('../services/booking-engine');

console.log('🚀 [Vocalis Worker] Background Task Worker is active and listening for jobs...');

jobQueue.on('job', async (job) => {
  console.log(`⚙️ [Worker Processing] ${job.type} (ID: ${job.id})`);

  switch (job.type) {
    case 'DISPATCH_BOOKING_ALERTS': {
      const { doctorPhone, bookingDetails } = job.data;
      try {
        const res = await whatsAppDispatcher.sendConfirmedBookingAlert(doctorPhone, bookingDetails);
        console.log(`✅ [Worker Success] Alerts dispatched for ${bookingDetails.patientName}:`, res.status);
      } catch (e) {
        console.error('[Worker Error] Alert dispatch failed:', e.message);
      }
      break;
    }

    case 'PROCESS_CALL_RECORDING': {
      const { recordingUrl, callSid, tenantId } = job.data;
      console.log(`🎙️ [Worker Processing Recording] CallSid: ${callSid}`);
      // Background compression and archival
      break;
    }

    case 'SYNC_CALENDAR_SLOT': {
      const { tenantId, slotTime, patientName } = job.data;
      console.log(`📅 [Worker Syncing Calendar] ${patientName} at ${slotTime}`);
      break;
    }

    default:
      console.warn(`⚠️ [Worker Warning] Unknown job type: ${job.type}`);
  }
});

// Keep process alive
setInterval(() => {}, 60000);
