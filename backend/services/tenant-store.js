/**
 * Vocalis AI — Multi-Tenant Store & Knowledge Base Engine (Pillar 1 & 2)
 * Manages tenant JSON configurations, custom business rules, and FAQ knowledge bases.
 */
const fs = require('fs');
const path = require('path');

class TenantStore {

  getActiveTestTenantId() {
    try {
      const cfgPath = path.join(__dirname, '..', 'data', 'active_telephony_routing.json');
      if (fs.existsSync(cfgPath)) {
        const d = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        return d.activeTenantId || 'TNT-001';
      }
    } catch(e) {}
    return 'TNT-001';
  }

  setActiveTestTenantId(tenantId) {
    try {
      const cfgDir = path.join(__dirname, '..', 'data');
      if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });
      const cfgPath = path.join(cfgDir, 'active_telephony_routing.json');
      fs.writeFileSync(cfgPath, JSON.stringify({ activeTenantId: tenantId, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
      console.log('[Telephony Routing] Active live phone line routed to tenant:', tenantId);
      return true;
    } catch(e) {
      console.error('Failed to set active test tenant:', e.message);
      return false;
    }
  }

  constructor() {
    this.tenantsDir = path.join(__dirname, '..', 'tenants');
    if (!fs.existsSync(this.tenantsDir)) {
      fs.mkdirSync(this.tenantsDir, { recursive: true });
    }
    this.seedDefaultTenants();
  }

  seedDefaultTenants() {
    const defaults = [
      {
        id: 'TNT-001',
        businessName: 'Harley Street Smiles Dental',
        industry: 'dental',
        currency: 'GBP',
        currencySymbol: '£',
        ownerName: 'Dr. Harley',
        personaName: 'Clara',
        language: 'en-GB',
        phone: '+44 20 7946 0912',
        doctorWhatsApp: '+44 7911 123456',
        city: 'Central London',
        address: '14 Harley Street, London W1G 9PQ',
        workingHours: 'Mon-Sat: 8:30 AM - 6:00 PM',
        emergencyAvailable: true,
        services: [
          { name: 'Comprehensive Hygiene & Polish', fee: '£140', durationMin: 45 },
          { name: 'Routine Dental Examination', fee: '£95', durationMin: 30 },
          { name: 'Emergency Toothache Triage', fee: '£120', durationMin: 30 },
          { name: 'Invisalign Consultation', fee: 'Free (£0)', durationMin: 30 }
        ],
        knowledgeBase: [
          { question: 'Do you accept private insurance like Bupa, AXA, or Aviva?', answer: 'Yes, we accept all major UK private health insurances including Bupa, AXA Health, Aviva, and Vitality. We provide itemized receipts for instant direct claim reimbursement.' },
          { question: 'Is there parking available nearby?', answer: 'Yes, validated Q-Park parking is available directly across from our clinic on Cavendish Square.' },
          { question: 'Are you wheelchair accessible?', answer: 'Yes, our clinic has ground floor step-free access and an elevator.' },
          { question: 'What happens if I need root canal or emergency tooth extraction?', answer: 'Dr. Harley specializes in pain-free emergency root canal therapy and same-day extractions with local sedation.' }
        ]
      },
      {
        id: 'TNT-002',
        businessName: 'Prestige Nature Farmland & Estates',
        industry: 'realestate',
        currency: 'INR',
        currencySymbol: '₹',
        ownerName: 'Agent Vikram',
        personaName: 'Priya / Maya',
        language: 'kn',
        phone: '+91 80 2345 6789',
        doctorWhatsApp: '+91 98450 12345',
        city: 'Bangalore (Chikkaballapur)',
        address: 'NH-44 Highway, Near Nandi Hills, Chikkaballapur, Karnataka',
        workingHours: 'Mon-Sun: 9:00 AM - 7:00 PM',
        emergencyAvailable: false,
        services: [
          { name: '1/4-Acre Managed Farmland Plot', fee: '₹25,00,000 (₹25 Lakhs)', durationMin: 60 },
          { name: '1/2-Acre Luxury Villa Farm Plot', fee: '₹48,00,000 (₹48 Lakhs)', durationMin: 60 },
          { name: '1-Acre Gated Sandalwood Estate', fee: '₹90,00,000 (₹90 Lakhs)', durationMin: 60 },
          { name: 'Weekend Site Visit with AC Cab', fee: 'Complimentary (Free)', durationMin: 180 }
        ],
        knowledgeBase: [
          { question: 'What are the legal approvals and documentation status?', answer: 'All plots have clear 100% DC Conversion, A-Khata, RERA registration, and 30-year clean legal search certificate.' },
          { question: 'Who manages the farm trees and sandalwood plantation?', answer: 'Our professional agro-forestry team manages 24/7 drip irrigation, tree maintenance, organic fertilizers, and security for 15 years with a 60-40 harvest profit share.' },
          { question: 'What clubhouse amenities are included?', answer: 'Clubhouse includes swimming pool, organic farm-to-table cafe, cottages for weekend stay, kids play area, and solar power backup.' },
          { question: 'Where is the cab pickup point for the weekend site visit?', answer: 'We provide complimentary door-to-door AC cab pickup from Bangalore city (Hebbal, Manyata, Indiranagar, Whitefield) every Saturday and Sunday at 9:30 AM.' }
        ]
      },
      {
        id: 'TNT-003',
        businessName: 'Apex 24/7 HVAC & Plumbing Emergency',
        industry: 'hvac',
        currency: 'USD',
        currencySymbol: '$',
        ownerName: 'Tech Mike',
        personaName: 'Sarah',
        language: 'en-US',
        phone: '+1 (214) 555-0199',
        doctorWhatsApp: '+1 214 555 0199',
        city: 'Dallas-Fort Worth, TX',
        address: '4500 Plano Pkwy, Plano, TX 75093',
        workingHours: '24 Hours / 7 Days a Week',
        emergencyAvailable: true,
        services: [
          { name: 'Diagnostic Service Call', fee: '$79 (Waived if repaired)', durationMin: 45 },
          { name: 'Emergency AC Capacitor / Motor Replacement', fee: '$249 - $450', durationMin: 60 },
          { name: 'Seasonal HVAC Performance Tune-Up', fee: '$99', durationMin: 60 }
        ],
        knowledgeBase: [
          { question: 'How fast can a technician arrive for an emergency AC breakdown?', answer: 'Our on-call technicians arrive within 30 to 60 minutes anywhere in the Dallas-Fort Worth metroplex.' },
          { question: 'Do you offer warranties on parts and labor?', answer: 'Yes, all repairs include our 1-year 100% parts and labor satisfaction guarantee.' }
        ]
      },
      {
        id: 'TNT-004',
        businessName: 'Johnson & Croft Injury Law',
        industry: 'legal',
        currency: 'USD',
        currencySymbol: '$',
        ownerName: 'Attorney Croft',
        personaName: 'Elena',
        language: 'en-US',
        phone: '+1 (212) 555-0144',
        doctorWhatsApp: '+1 212 555 0144',
        city: 'New York, NY',
        address: '350 5th Ave, Empire State Bldg, New York, NY 10118',
        workingHours: '24/7 Intake Available',
        emergencyAvailable: true,
        services: [
          { name: 'Free Initial Accident Consultation', fee: '$0 (Free)', durationMin: 30 },
          { name: 'Contingency Fee Representation', fee: 'No Win, No Fee (0% Upfront)', durationMin: 60 }
        ],
        knowledgeBase: [
          { question: 'Do I have to pay any legal fees upfront?', answer: 'No, we operate strictly on a contingency fee basis. You pay absolutely zero dollars out of pocket unless we win a settlement or jury award for you.' }
        ]
      },
      {
        id: 'TNT-005',
        businessName: 'Gourmet Haven Italian Ristorante',
        industry: 'restaurant',
        currency: 'GBP',
        currencySymbol: '£',
        ownerName: 'Chef Marco',
        personaName: 'Marco',
        language: 'en-GB',
        phone: '+44 20 7123 4567',
        doctorWhatsApp: '+44 7922 888999',
        city: 'Covent Garden, London',
        address: '18 Floral Street, Covent Garden, London WC2E 9DS',
        workingHours: 'Tue-Sun: 12:00 PM - 11:00 PM',
        emergencyAvailable: false,
        services: [
          { name: 'Dining Table Reservation', fee: 'Complimentary', durationMin: 120 },
          { name: 'Chef Tasting Menu (5-Course)', fee: '£85 per person', durationMin: 120 }
        ],
        knowledgeBase: [
          { question: 'Do you offer gluten-free and vegan pasta options?', answer: 'Yes! We make fresh homemade gluten-free pasta and have a dedicated vegan Italian menu curated by Chef Marco.' },
          { question: 'What is the dress code?', answer: 'Our dress code is smart casual.' }
        ]
      }
    ];

    for (const t of defaults) {
      const filePath = path.join(this.tenantsDir, `${t.id}.json`);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(t, null, 2), 'utf8');
      }
    }
  }

  getAllTenants() {
    try {
      const files = fs.readdirSync(this.tenantsDir).filter(f => f.endsWith('.json'));
      return files.map(f => JSON.parse(fs.readFileSync(path.join(this.tenantsDir, f), 'utf8')));
    } catch (e) {
      console.error('[TenantStore] Read error:', e);
      return [];
    }
  }

  getTenantById(id) {
    const filePath = path.join(this.tenantsDir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    // Fallback: search by industry or return first
    const all = this.getAllTenants();
    return all.find(t => t.industry === id || t.id === id) || all[0];
  }

  saveTenant(tenantData) {
    if (!tenantData.id) {
      tenantData.id = 'TNT-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
    }
    const filePath = path.join(this.tenantsDir, `${tenantData.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(tenantData, null, 2), 'utf8');
    return tenantData;
  }

  /**
   * Search knowledge base for exact or semantic match (RAG)
   */
  deleteTenant(id) {
    if (!id || id === 'TNT-001') {
      throw new Error('Cannot delete default demo tenant TNT-001');
    }
    const filePath = path.join(this.tenantsDir, id + '.json');
    if (!fs.existsSync(filePath)) {
      throw new Error('Tenant not found: ' + id);
    }
    fs.unlinkSync(filePath);
    return { success: true, deleted: id };
  }

  suspendTenant(id, suspended) {
    const tenant = this.getTenantById(id);
    if (!tenant) throw new Error('Tenant not found: ' + id);
    tenant.suspended = !!suspended;
    tenant.suspendedAt = suspended ? new Date().toISOString() : null;
    return this.saveTenant(tenant);
  }

  queryKnowledgeBase(tenantId, query) {
    const tenant = this.getTenantById(tenantId);
    if (!tenant || !tenant.knowledgeBase || tenant.knowledgeBase.length === 0) return null;

    const queryLower = query.toLowerCase();
    
    // Find best matching Q&A item
    for (const item of tenant.knowledgeBase) {
      const qWords = item.question.toLowerCase().split(/\s+/);
      const matchCount = qWords.filter(w => w.length > 3 && queryLower.includes(w)).length;
      if (matchCount >= 2 || queryLower.includes(item.question.toLowerCase().substring(0, 15))) {
        return item.answer;
      }
    }
    return null;
  }
}

module.exports = new TenantStore();
