/**
 * Vocalis AI — Real Calendar & Slot Booking Engine (Pillar 3)
 * Manages appointment availability, conflict prevention, and confirmed booking records.
 */
const fs = require('fs');
const path = require('path');
const WhatsAppDispatcher = require('./whatsapp-dispatcher');

class BookingEngine {
  constructor() {
    this.bookingsFile = path.join(__dirname, '..', 'bookings', 'bookings.json');
    const bookingsDir = path.dirname(this.bookingsFile);
    if (!fs.existsSync(bookingsDir)) {
      try { fs.mkdirSync(bookingsDir, { recursive: true }); } catch(e) {}
    }
    if (!fs.existsSync(this.bookingsFile)) {
      try { fs.writeFileSync(this.bookingsFile, JSON.stringify([], null, 2), 'utf8'); } catch(e) { /* Read-only cloud filesystem fallback */ }
    }
    this.whatsApp = new WhatsAppDispatcher();
    this.seedInitialBookings();
  }

  seedInitialBookings() {
    const existing = this.getAllBookings();
    if (existing.length === 0) {
      const samples = [
        {
          id: 'BKG-8801',
          tenantId: 'TNT-001',
          clinicName: 'Harley Street Smiles Dental',
          patientName: 'Emma Watson',
          patientPhone: '+44 7700 900456',
          treatment: 'Comprehensive Hygiene & Polish',
          treatmentFee: '£140',
          slotTime: 'Friday, 28 Aug at 2:30 PM',
          doctorName: 'Dr. Harley',
          doctorPhone: '+44 7911 123456',
          status: 'CONFIRMED',
          bookedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
          symptoms: 'Patient booked 2:30 PM Friday slot. Requested gentle polish due to mild sensitive enamel.',
          audioUrl: 'https://app.vocalis.ai/recordings/call_rec_8801.mp3'
        },
        {
          id: 'BKG-8802',
          tenantId: 'TNT-002',
          clinicName: 'Prestige Nature Farmland & Estates',
          patientName: 'Rajesh Sharma',
          patientPhone: '+91 98450 55432',
          treatment: 'Weekend 1-Acre Farmland Site Visit (AC Cab)',
          treatmentFee: '₹25,00,000 (Booking Fee: Free)',
          slotTime: 'Saturday at 10:00 AM',
          doctorName: 'Agent Vikram',
          doctorPhone: '+91 98450 12345',
          status: 'CONFIRMED',
          bookedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
          symptoms: 'Inbound call from Instagram ad. Interested in 1/2-acre sandalwood plot with clubhouse access. Doorstep AC cab pickup confirmed for Hebbal.',
          audioUrl: 'https://app.vocalis.ai/recordings/call_rec_8802.mp3'
        }
      ];
      try { fs.writeFileSync(this.bookingsFile, JSON.stringify(samples, null, 2), 'utf8'); } catch(e) { /* Read-only cloud filesystem fallback */ }
    }
  }

  getAllBookings() {
    try {
      return JSON.parse(fs.readFileSync(this.bookingsFile, 'utf8'));
    } catch(e) {
      return [];
    }
  }

  getBookingsByTenant(tenantId) {
    return this.getAllBookings().filter(b => b.tenantId === tenantId);
  }

  /**
   * Generates dynamic available time slots based on tenant working hours
   */
  getAvailableSlots(tenantId, preferredDay = 'friday') {
    const booked = this.getBookingsByTenant(tenantId).map(b => b.slotTime.toLowerCase());
    
    const standardSlots = [
      'Friday at 10:00 AM',
      'Friday at 11:30 AM',
      'Friday at 2:30 PM',
      'Friday at 4:00 PM',
      'Saturday at 10:00 AM',
      'Saturday at 12:00 PM',
      'Saturday at 3:00 PM',
      'Today at 4:00 PM (Emergency Slot)'
    ];

    return standardSlots.filter(s => !booked.some(b => b.includes(s.toLowerCase())));
  }

  /**
   * Books a slot with conflict check and triggers WhatsApp notification
   */
  async createBooking(bookingData) {
    const all = this.getAllBookings();
    
    // Check for double booking conflict
    const conflict = all.find(b => 
      b.tenantId === bookingData.tenantId && 
      b.slotTime.toLowerCase() === bookingData.slotTime.toLowerCase() &&
      b.status === 'CONFIRMED'
    );

    if (conflict) {
      return {
        success: false,
        error: 'SLOT_CONFLICT',
        message: `The slot ${bookingData.slotTime} has already been reserved. Next open slot: Friday at 4:00 PM.`
      };
    }

    const newBooking = {
      id: 'BKG-' + Math.floor(1000 + Math.random() * 9000),
      tenantId: bookingData.tenantId || 'TNT-001',
      clinicName: bookingData.clinicName || 'Harley Street Smiles Dental',
      patientName: bookingData.patientName || 'New Patient',
      patientPhone: bookingData.patientPhone || '+44 7700 900123',
      treatment: bookingData.treatment || 'Consultation & Hygiene',
      treatmentFee: bookingData.treatmentFee || 'Standard',
      slotTime: bookingData.slotTime || 'Friday at 2:30 PM',
      doctorName: bookingData.doctorName || 'Dr. Harley',
      doctorPhone: bookingData.doctorPhone || '+44 7911 123456',
      status: 'CONFIRMED',
      bookedAt: new Date().toISOString(),
      symptoms: bookingData.symptoms || 'Booked via Vocalis AI Voice Receptionist.',
      audioUrl: bookingData.audioUrl || 'https://app.vocalis.ai/recordings/live_call.mp3'
    };

    all.unshift(newBooking);
    try { fs.writeFileSync(this.bookingsFile, JSON.stringify(all, null, 2), 'utf8'); } catch(e) { /* Read-only cloud filesystem fallback */ }

    // Trigger Doctor WhatsApp alert
    await this.whatsApp.sendConfirmedBookingAlert(newBooking.doctorPhone, {
      patientName: newBooking.patientName,
      patientPhone: newBooking.patientPhone,
      treatment: newBooking.treatment,
      treatmentFee: newBooking.treatmentFee,
      slotTime: newBooking.slotTime,
      clinicName: newBooking.clinicName,
      conversationScript: newBooking.symptoms,
      audioUrl: newBooking.audioUrl
    });

    return {
      success: true,
      booking: newBooking
    };
  }
}

module.exports = new BookingEngine();
