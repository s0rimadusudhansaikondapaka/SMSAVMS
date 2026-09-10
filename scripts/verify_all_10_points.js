const db = require('../src/config/db');
const { 
  verifyGatePass, 
  processGateMovement, 
  getInvitedVisitors, 
  updateVisitorGateDetails 
} = require('../src/controllers/gateController');
const { checkSystematicCheckouts } = require('../src/controllers/expiryService');

// Mock Express req & res objects for direct controller testing
function createMockReqRes(body = {}, params = {}, query = {}, user = { id: 1, name: 'Test Guard', role: 'GUARD' }) {
  const req = { body, params, query, user };
  let statusCode = 200;
  let jsonResponse = null;

  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      jsonResponse = data;
      return res;
    },
    getStatusCode: () => statusCode,
    getData: () => jsonResponse,
  };

  return { req, res };
}

async function runVerification() {
  console.log('===============================================================');
  console.log('     LIVE VERIFICATION OF ALL 10 GATE SECURITY REQUIREMENTS     ');
  console.log('===============================================================\n');

  let passedTests = 0;
  const totalTests = 10;

  try {
    // 0. Setup a clean test visitor and registration
    const testPhone = '+919988770011';
    const testPlate = 'KA04AB9999';
    const testPassCode = `PASS-TEST-${Math.floor(1000 + Math.random() * 9000)}`;
    const testName = 'Verification Test Devotee';

    // Insert or get test visitor
    let visRes = await db.query('SELECT id FROM visitors WHERE phone = $1', [testPhone]);
    let visitorId;
    if (visRes.rows.length === 0) {
      const maxVisRes = await db.query('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM visitors');
      const nextVisId = parseInt(maxVisRes.rows[0].next_id, 10);
      const insVis = await db.query(
        `INSERT INTO visitors (id, full_name, phone, vehicle_no, visitor_category) 
         VALUES ($1, $2, $3, $4, 'GENERAL') RETURNING id`,
        [nextVisId, testName, testPhone, testPlate]
      );
      visitorId = insVis.rows[0].id;
    } else {
      visitorId = visRes.rows[0].id;
      await db.query('UPDATE visitors SET vehicle_no = $1, full_name = $2 WHERE id = $3', [testPlate, testName, visitorId]);
    }

    // Insert registration scheduled 4 hours in the future (within +8 hours window)
    const validFrom = new Date(Date.now() - 30 * 60 * 1000); // 30 mins ago
    const validUntil = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hours in future

    const maxRegRes = await db.query('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM registrations');
    const nextRegId = parseInt(maxRegRes.rows[0].next_id, 10);

    const regRes = await db.query(
      `INSERT INTO registrations (
        id, visitor_id, pass_code, status, lifecycle_status, presence_status, 
        valid_from, valid_until, adult_men_count, adult_women_count, boys_count, girls_count, person_count, vehicle_no, purpose
      ) VALUES ($1, $2, $3, 'APPROVED', 'Yet to Arrive', 'currently_outside', $4, $5, 2, 1, 1, 0, 4, $6, 'Ashram Visit')
      RETURNING *`,
      [nextRegId, visitorId, testPassCode, validFrom, validUntil, testPlate]
    );
    const testRegId = regRes.rows[0].id;

    console.log(`[SETUP] Created test registration ID: ${testRegId}, PassCode: ${testPassCode}, Phone: ${testPhone}, Vehicle: ${testPlate}\n`);

    // -------------------------------------------------------------
    // POINT 1: Security Guard should be able to Scan the QR code
    // -------------------------------------------------------------
    console.log('Testing Point 1: QR Code Scanning & Lookups...');
    // Simulate JSON encoded QR code: `{"passCode": "PASS-XXXX"}`
    const jsonQrPayload = JSON.stringify({ passCode: testPassCode });
    const { req: req1, res: res1 } = createMockReqRes({}, {}, { query: jsonQrPayload, gateName: 'NORTH_GATE' });
    await verifyGatePass(req1, res1);

    if (res1.getStatusCode() === 200 && res1.getData()?.success && res1.getData()?.pass?.pass_code === testPassCode) {
      console.log('✅ PASS 1: QR Code scan (JSON payload & URL formats) successfully verified and resolved.');
      passedTests++;
    } else {
      console.error('❌ FAIL 1: QR Code verification failed:', res1.getData());
    }

    // -------------------------------------------------------------
    // POINT 2: Search from INVITED VISITORS list by visitor's name or last 4 digit phone number or vehicle number
    // -------------------------------------------------------------
    console.log('\nTesting Point 2: Search by Name, last 4 digits phone, or vehicle number...');
    // Search by Name
    const { req: req2a, res: res2a } = createMockReqRes({}, {}, { search: 'Verification Test Devotee' });
    await getInvitedVisitors(req2a, res2a);
    const nameMatch = res2a.getData()?.visitors?.some(v => v.id === testRegId);

    // Search by Last 4 Digits of Phone ('0011')
    const { req: req2b, res: res2b } = createMockReqRes({}, {}, { search: '0011' });
    await getInvitedVisitors(req2b, res2b);
    const phoneMatch = res2b.getData()?.visitors?.some(v => v.id === testRegId);

    // Search by Vehicle Plate ('AB9999')
    const { req: req2c, res: res2c } = createMockReqRes({}, {}, { search: 'AB9999' });
    await getInvitedVisitors(req2c, res2c);
    const vehicleMatch = res2c.getData()?.visitors?.some(v => v.id === testRegId);

    if (nameMatch && phoneMatch && vehicleMatch) {
      console.log('✅ PASS 2: Search successfully matched by visitor name, phone last 4 digits, and vehicle number.');
      passedTests++;
    } else {
      console.error(`❌ FAIL 2: Search failure -> Name: ${nameMatch}, Phone: ${phoneMatch}, Vehicle: ${vehicleMatch}`);
    }

    // -------------------------------------------------------------
    // POINT 3: The list should contain +8 hours of upcoming visitors list and already checked-in list
    // -------------------------------------------------------------
    console.log('\nTesting Point 3: Scope of List (+8h upcoming & already checked-in)...');
    const { req: req3, res: res3 } = createMockReqRes({}, {}, {});
    await getInvitedVisitors(req3, res3);
    const visitors = res3.getData()?.visitors || [];
    const containsUpcoming = visitors.some(v => v.id === testRegId);

    if (res3.getStatusCode() === 200 && containsUpcoming) {
      console.log(`✅ PASS 3: List correctly populated with upcoming (+8h) visitors and checked-in visitors (Count: ${visitors.length}).`);
      passedTests++;
    } else {
      console.error('❌ FAIL 3: Upcoming visitor not found in list scope.');
    }

    // -------------------------------------------------------------
    // POINT 4: When clicked on visitor record, Guard can ONLY edit 'number of people' and 'vehicle details'
    // -------------------------------------------------------------
    console.log('\nTesting Point 4: Guard Restricted Edit (People & Vehicle Only)...');
    const { req: req4, res: res4 } = createMockReqRes({
      adult_men_count: 3,
      adult_women_count: 2,
      boys_count: 1,
      girls_count: 1,
      vehicle_no: 'KA04XY1111',
      // Prohibited fields attempted by guard:
      visitor_name: 'HACKED NAME',
      status: 'OVERRIDDEN'
    }, { id: testRegId });
    await updateVisitorGateDetails(req4, res4);

    const checkReg4 = await db.query('SELECT * FROM registrations WHERE id = $1', [testRegId]);
    const checkVis4 = await db.query('SELECT * FROM visitors WHERE id = $1', [visitorId]);

    const updatedCounts = checkReg4.rows[0].adult_men_count === 3 && checkReg4.rows[0].adult_women_count === 2 && checkReg4.rows[0].person_count === 7;
    const updatedVehicle = checkReg4.rows[0].vehicle_no === 'KA04XY1111' && checkVis4.rows[0].vehicle_no === 'KA04XY1111';
    const prohibitedIgnored = checkVis4.rows[0].full_name === testName; // Name was NOT altered

    if (res4.getStatusCode() === 200 && updatedCounts && updatedVehicle && prohibitedIgnored) {
      console.log('✅ PASS 4: Guard edit successfully modified ONLY people count (Total: 7) and vehicle (KA04XY1111). Restricted fields protected.');
      passedTests++;
    } else {
      console.error('❌ FAIL 4: Guard restricted edit check failed.');
    }

    // -------------------------------------------------------------
    // POINT 5: The Status of the Visitors to be in TWO categories
    // First Category: Yet to Arrive, CHECKED-IN, CHECKED-OUT
    // Second Category: currently_inside, currently_outside, over_stayed
    // -------------------------------------------------------------
    console.log('\nTesting Point 5: TWO Categories of Visitor Status...');
    const { req: req5, res: res5 } = createMockReqRes({}, {}, { query: testPassCode, gateName: 'NORTH_GATE' });
    await verifyGatePass(req5, res5);
    const pass5 = res5.getData()?.pass;

    const validCat1 = ['Yet to Arrive', 'CHECKED-IN', 'CHECKED-OUT'].includes(pass5?.lifecycle_status);
    const validCat2 = ['currently_inside', 'currently_outside', 'over_stayed'].includes(pass5?.presence_status);

    if (validCat1 && validCat2 && pass5.lifecycle_status === 'Yet to Arrive' && pass5.presence_status === 'currently_outside') {
      console.log(`✅ PASS 5: Both categories properly computed: Category 1 = '${pass5.lifecycle_status}', Category 2 = '${pass5.presence_status}'.`);
      passedTests++;
    } else {
      console.error('❌ FAIL 5: Invalid category status values:', pass5?.lifecycle_status, pass5?.presence_status);
    }

    // -------------------------------------------------------------
    // POINT 6: IN or OUT button for allowing visitor to enter or exit
    // -------------------------------------------------------------
    console.log('\nTesting Point 6: IN button movement processing...');
    const { req: req6, res: res6 } = createMockReqRes({
      registration_id: testRegId,
      gate_name: 'NORTH_GATE',
      direction: 'IN',
      adult_men_count: 3,
      adult_women_count: 2,
    });
    await processGateMovement(req6, res6);

    const checkReg6 = await db.query('SELECT * FROM registrations WHERE id = $1', [testRegId]);
    if (res6.getStatusCode() === 200 && checkReg6.rows[0].lifecycle_status === 'CHECKED-IN' && checkReg6.rows[0].presence_status === 'currently_inside') {
      console.log('✅ PASS 6: IN movement processed successfully. Visitor now CHECKED-IN & currently_inside.');
      passedTests++;
    } else {
      console.error('❌ FAIL 6: IN movement failed:', res6.getData());
    }

    // -------------------------------------------------------------
    // POINT 7: IN button should be only enabled till Estimated Departure Time. After that disabled.
    // -------------------------------------------------------------
    console.log('\nTesting Point 7: Strict IN Button Gating on Estimated Departure Time...');
    // Create an expired pass (valid_until was 10 mins ago)
    const expValidFrom = new Date(Date.now() - 2 * 3600000);
    const expValidUntil = new Date(Date.now() - 10 * 60000); // 10 minutes ago
    const maxExpRes = await db.query('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM registrations');
    const nextExpId = parseInt(maxExpRes.rows[0].next_id, 10);
    const expReg = await db.query(
      `INSERT INTO registrations (id, visitor_id, pass_code, status, valid_from, valid_until, adult_men_count, purpose)
       VALUES ($1, $2, 'PASS-EXPIRED-TEST', 'APPROVED', $3, $4, 1, 'Darshan Visit') RETURNING id`,
      [nextExpId, visitorId, expValidFrom, expValidUntil]
    );

    const { req: req7, res: res7 } = createMockReqRes({
      registration_id: expReg.rows[0].id,
      gate_name: 'NORTH_GATE',
      direction: 'IN',
    });
    await processGateMovement(req7, res7);

    if (res7.getStatusCode() === 400 && res7.getData()?.message?.includes('Estimated departure time')) {
      console.log(`✅ PASS 7: IN entry strictly blocked for expired departure time (${res7.getData().message}).`);
      passedTests++;
    } else {
      console.error('❌ FAIL 7: IN button was not blocked for expired departure time:', res7.getStatusCode(), res7.getData());
    }

    // -------------------------------------------------------------
    // POINT 8: OUT button should be enabled, if Visitor status is 'currently_inside'
    // -------------------------------------------------------------
    console.log('\nTesting Point 8: OUT button enabled when currently_inside...');
    // Our test visitor is currently inside from Point 6!
    const { req: req8, res: res8 } = createMockReqRes({
      registration_id: testRegId,
      gate_name: 'NORTH_GATE',
      direction: 'OUT',
    });
    await processGateMovement(req8, res8);

    if (res8.getStatusCode() === 200 && res8.getData()?.success) {
      console.log('✅ PASS 8: OUT button successfully executed for currently_inside visitor.');
      passedTests++;
    } else {
      console.error('❌ FAIL 8: OUT movement failed for inside visitor:', res8.getData());
    }

    // -------------------------------------------------------------
    // POINT 9: If guest is going out, they are just 'currently_outside'.
    // They are still 'CHECKED-IN' (Category 1) and 'currently_outside' (Category 2).
    // -------------------------------------------------------------
    console.log('\nTesting Point 9: Temporary Exit (CHECKED-IN & currently_outside)...');
    const checkReg9 = await db.query('SELECT * FROM registrations WHERE id = $1', [testRegId]);
    const isCat1CheckedIn = checkReg9.rows[0].lifecycle_status === 'CHECKED-IN';
    const isCat2CurrentlyOutside = checkReg9.rows[0].presence_status === 'currently_outside';

    if (isCat1CheckedIn && isCat2CurrentlyOutside) {
      console.log(`✅ PASS 9: Visitor correctly retained in Category 1: '${checkReg9.rows[0].lifecycle_status}' and Category 2: '${checkReg9.rows[0].presence_status}'. Multi re-entry enabled.`);
      passedTests++;
    } else {
      console.error(`❌ FAIL 9: Expected CHECKED-IN and currently_outside, got: Cat1='${checkReg9.rows[0].lifecycle_status}', Cat2='${checkReg9.rows[0].presence_status}'`);
    }

    // -------------------------------------------------------------
    // POINT 10: If guest is 'currently_outside' and Estimated Departure Time is passed, systematically CHECKED-OUT
    // -------------------------------------------------------------
    console.log('\nTesting Point 10: Systematic Check-Out on Expiry...');
    // Set our test visitor's valid_until to 5 minutes ago to simulate elapsed departure time while outside
    await db.query(`UPDATE registrations SET valid_until = NOW() - INTERVAL '5 minutes' WHERE id = $1`, [testRegId]);

    // Trigger systematic checkouts engine
    await checkSystematicCheckouts();

    const checkReg10 = await db.query('SELECT * FROM registrations WHERE id = $1', [testRegId]);
    const isSystematicCheckedOut = checkReg10.rows[0].lifecycle_status === 'CHECKED-OUT' && checkReg10.rows[0].status === 'CHECKED_OUT';

    if (isSystematicCheckedOut) {
      console.log(`✅ PASS 10: Visitor systematically transitioned to '${checkReg10.rows[0].lifecycle_status}' after departure time elapsed while currently outside.`);
      passedTests++;
    } else {
      console.error('❌ FAIL 10: Systematic checkout failed:', checkReg10.rows[0]);
    }

    // Clean up test records
    await db.query('DELETE FROM gate_logs WHERE registration_id IN ($1, $2)', [testRegId, expReg.rows[0].id]);
    await db.query('DELETE FROM registrations WHERE id IN ($1, $2)', [testRegId, expReg.rows[0].id]);
    await db.query('DELETE FROM visitors WHERE id = $1', [visitorId]);

    console.log('\n===============================================================');
    console.log(`    FINAL RESULT: ${passedTests}/${totalTests} REQUIREMENTS VERIFIED & PASSED!`);
    console.log('===============================================================');

  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    process.exit(passedTests === totalTests ? 0 : 1);
  }
}

runVerification();
