const express = require('express');
const router = express.Router();

const db = require('../config/db');
const { login, getMe, sendOtp, verifyOtp, registerNewUser } = require('../controllers/authController');
const { 
  createRegistration, 
  updateApproval, 
  generateRegistrationQr,
  getHostRegistrations, 
  updateRegistration, 
  isL2Enabled, 
  getVisitHistory,
  getPublicHostInfo,
  createPublicVisitorRegistration
} = require('../controllers/visitorController');
const { 
  verifyGatePass, 
  processGateMovement, 
  getVisitorsInsideCampus,
  getSpotRegistrationsQueue,
  assignHostToSpotRegistration 
} = require('../controllers/gateController');
const { checkExpiredRequests } = require('../controllers/expiryService');
const { 
  getOverstayAlerts, 
  supervisorOverride, 
  adminBypassApprove, 
  adminEmergencyPass, 
  toggleL2Approval, 
  registerResidentAbsence 
} = require('../controllers/supervisorController');
const { getDashboardMetrics, getReportData } = require('../controllers/reportsController');
const { 
  getAllUsers, 
  getDepartments, 
  createSingleUser, 
  bulkUploadUsers, 
  bulkUploadVisitors 
} = require('../controllers/adminUserController');
const { authenticateToken, requireRoles } = require('../middlewares/auth');

/**
 * @openapi
 * tags:
 *   - name: Authentication
 *     description: User authentication and profile endpoints
 *   - name: Visitor Registrations
 *     description: Visitor invitations, pre-registrations, and L1/L2 approval workflows
 *   - name: Gate Operations
 *     description: Security Guard gate pass verification and Ingress/Egress movement logging
 *   - name: Supervisor & Overrides
 *     description: Overstay alerts, unresponsive host escalations, and supervisor overrides
 *   - name: Super Admin
 *     description: Master admin bypass approvals and Emergency Instant Pass creation
 *   - name: Reports & Analytics
 *     description: Executive command dashboard metrics and 13 analytics reports
 */

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: User Login
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 example: resident1@ashram.org
 *               password:
 *                 type: string
 *                 example: password123
 *     responses:
 *       200:
 *         description: Login successful, returns JWT Bearer token
 *       401:
 *         description: Invalid credentials
 */
router.post('/auth/login', login);

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     summary: Get Authenticated User Profile
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Current user profile details
 *       401:
 *         description: Authentication token missing or invalid
 */
router.get('/auth/me', authenticateToken, getMe);

/**
 * @openapi
 * /api/auth/send-otp:
 *   post:
 *     summary: Send OTP to Phone Number
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "+91 9876543210"
 *     responses:
 *       200:
 *         description: OTP sent successfully
 */
router.post('/auth/send-otp', sendOtp);

/**
 * @openapi
 * /api/auth/verify-otp:
 *   post:
 *     summary: Verify OTP and Login
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, otp]
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "+91 9876543210"
 *               otp:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Login successful with JWT token
 */
router.post('/auth/verify-otp', verifyOtp);

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     summary: Self-Register New User (Pending Admin Approval)
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [full_name, phone]
 *             properties:
 *               full_name:
 *                 type: string
 *                 example: "Priya Sharma"
 *               phone:
 *                 type: string
 *                 example: "+91 9876549999"
 *               email:
 *                 type: string
 *                 example: "priya@example.com"
 *     responses:
 *       201:
 *         description: Registration submitted, pending approval
 */
router.post('/auth/register', registerNewUser);

/**
 * @openapi
 * /api/registrations:
 *   post:
 *     summary: Create Pre-Registration or Guest Invitation
 *     tags: [Visitor Registrations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [full_name, phone, purpose]
 *             properties:
 *               full_name:
 *                 type: string
 *                 example: Meera Devi
 *               phone:
 *                 type: string
 *                 example: "+91 9888877777"
 *               email:
 *                 type: string
 *                 example: meera@devotee.org
 *               gender:
 *                 type: string
 *                 enum: [Male, Female, Other]
 *                 example: Female
 *               photo_url:
 *                 type: string
 *                 example: "data:image/jpeg;base64,..."
 *               id_card_number:
 *                 type: string
 *                 example: "9876-5432-1098"
 *               id_card_image_url:
 *                 type: string
 *                 example: "https://example.com/aadhaar.jpg"
 *               visitor_category:
 *                 type: string
 *                 enum: [VVIP, VIP, GENERAL, VENDOR, CONTRACTOR, FOREIGN_NATIONAL, DELIVERY, CAB]
 *                 example: VIP
 *               visit_type:
 *                 type: string
 *                 enum: [HOME, OFFICE, TOUR, BHAJAN, EVENT, EMERGENCY]
 *                 example: HOME
 *               purpose:
 *                 type: string
 *                 example: Spiritual Guidance & Darshan
 *               stay_required:
 *                 type: boolean
 *                 example: false
 *               is_vvip:
 *                 type: boolean
 *                 example: false
 *               valid_from:
 *                 type: string
 *                 example: "2026-08-25T09:00"
 *               valid_until:
 *                 type: string
 *                 example: "2026-08-25T21:00"
 *               adult_men_count:
 *                 type: integer
 *                 example: 1
 *               adult_women_count:
 *                 type: integer
 *                 example: 2
 *               children_count:
 *                 type: integer
 *                 example: 1
 *               vehicles:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     plate_number:
 *                       type: string
 *                       example: KA-05-MH-8888
 *                     vehicle_type:
 *                       type: string
 *                       example: SUV
 *                     driver_name:
 *                       type: string
 *                       example: Ramesh Driver
 *                     driver_phone:
 *                       type: string
 *                       example: "+91 9777766666"
 *     responses:
 *       201:
 *         description: Registration created successfully
 */
router.post('/registrations', authenticateToken, createRegistration);

/**
 * @openapi
 * /api/registrations/{id}:
 *   put:
 *     summary: Edit Visitor Invite / Pre-Registration Before Approval
 *     tags: [Visitor Registrations]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Registration updated successfully
 *       400:
 *         description: Cannot edit registration after approval
 */
router.put('/registrations/:id', authenticateToken, updateRegistration);

/**
 * @openapi
 * /api/registrations/approve:
 *   post:
 *     summary: Process L1/L2 Visitor Approval or Rejection
 *     tags: [Visitor Registrations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [registration_id, action]
 *             properties:
 *               registration_id:
 *                 type: integer
 *                 example: 1
 *               action:
 *                 type: string
 *                 enum: [APPROVE, REJECT]
 *                 example: APPROVE
 *               remarks:
 *                 type: string
 *                 example: Approved for visit
 *     responses:
 *       200:
 *         description: Approval status updated
 */
router.post('/registrations/approve', authenticateToken, updateApproval);
router.post('/registrations/generate-qr', authenticateToken, generateRegistrationQr);
router.get('/registrations/public-host/:host_id', getPublicHostInfo);
router.post('/registrations/public-visitor', createPublicVisitorRegistration);

/**
 * @openapi
 * /api/registrations/host:
 *   get:
 *     summary: Get Host's Invited Visitors & Requests
 *     tags: [Visitor Registrations]
 *     responses:
 *       200:
 *         description: List of visitor registrations
 */
router.get('/registrations/host', authenticateToken, getHostRegistrations);

/**
 * @openapi
 * /api/registrations/history:
 *   get:
 *     summary: Get Visit History (Completed/Expired Visits)
 *     tags: [Visitor Registrations]
 *     responses:
 *       200:
 *         description: Visit history with entry/exit timestamps
 */
router.get('/registrations/history', authenticateToken, getVisitHistory);

/**
 * @openapi
 * /api/gate/verify:
 *   get:
 *     summary: Verify Gate Pass by Code, QR, or Vehicle No
 *     tags: [Gate Operations]
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema:
 *           type: string
 *           example: VVIP-9999
 *     responses:
 *       200:
 *         description: Pass verified successfully with photo and vehicle list
 *       404:
 *         description: Pass not found or invalid
 */
router.get('/gate/verify', authenticateToken, requireRoles('GUARD', 'SUPERVISOR', 'SECURITY_HEAD', 'ADMIN'), verifyGatePass);

/**
 * @openapi
 * /api/gate/movement:
 *   post:
 *     summary: Record Gate Ingress (IN) or Egress (OUT)
 *     tags: [Gate Operations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [registration_id, gate_name, direction]
 *             properties:
 *               registration_id:
 *                 type: integer
 *                 example: 1
 *               gate_name:
 *                 type: string
 *                 enum: [NORTH_GATE, EAST_GATE, WEST_GATE, SOUTH_GATE]
 *                 example: NORTH_GATE
 *               direction:
 *                 type: string
 *                 enum: [IN, OUT]
 *                 example: IN
 *               adult_men_count:
 *                 type: integer
 *                 example: 1
 *               adult_women_count:
 *                 type: integer
 *                 example: 2
 *               children_count:
 *                 type: integer
 *                 example: 1
 *               vehicle_no:
 *                 type: string
 *                 example: KA-01-MJ-9999
 *               remarks:
 *                 type: string
 *                 example: Clean gate entry
 *     responses:
 *       200:
 *         description: Movement recorded successfully
 */
router.post('/gate/movement', authenticateToken, requireRoles('GUARD', 'SUPERVISOR', 'SECURITY_HEAD', 'ADMIN'), processGateMovement);

/**
 * @openapi
 * /api/gate/inside:
 *   get:
 *     summary: Get List of Visitors Currently Inside Campus
 *     tags: [Gate Operations]
 *     responses:
 *       200:
 *         description: Active visitors inside campus
 */
router.get('/gate/inside', authenticateToken, requireRoles('GUARD', 'SUPERVISOR', 'SECURITY_HEAD', 'ADMIN'), getVisitorsInsideCampus);
router.get('/gate/spot-queue', authenticateToken, requireRoles('GUARD', 'SUPERVISOR', 'SECURITY_HEAD', 'ADMIN'), getSpotRegistrationsQueue);
router.post('/gate/assign-host', authenticateToken, requireRoles('GUARD', 'SUPERVISOR', 'SECURITY_HEAD', 'ADMIN'), assignHostToSpotRegistration);

/**
 * @openapi
 * /api/supervisor/overstays:
 *   get:
 *     summary: Get Delayed Exits & Overstay Alerts
 *     tags: [Supervisor & Overrides]
 *     responses:
 *       200:
 *         description: List of overstayed visitors
 */
router.get('/supervisor/overstays', authenticateToken, requireRoles('SUPERVISOR', 'SECURITY_HEAD', 'ADMIN'), getOverstayAlerts);

/**
 * @openapi
 * /api/supervisor/override:
 *   post:
 *     summary: Execute Supervisor Override Decision
 *     tags: [Supervisor & Overrides]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [registration_id, action, remarks]
 *             properties:
 *               registration_id:
 *                 type: integer
 *                 example: 1
 *               action:
 *                 type: string
 *                 enum: [APPROVE, REJECT, ESCALATE]
 *                 example: APPROVE
 *               remarks:
 *                 type: string
 *                 example: Unresponsive host override after 10m
 *     responses:
 *       200:
 *         description: Supervisor override recorded
 */
router.post('/supervisor/override', authenticateToken, requireRoles('SUPERVISOR', 'SECURITY_HEAD', 'ADMIN'), supervisorOverride);

/**
 * @openapi
 * /api/supervisor/l2-toggle:
 *   post:
 *     summary: Toggle Global System Policy Settings
 *     tags: [Supervisor & Overrides]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enabled]
 *             properties:
 *               enabled:
 *                 type: boolean
 *                 example: true
 *               key:
 *                 type: string
 *                 example: L2_APPROVAL_ENABLED
 *     responses:
 *       200:
 *         description: System setting toggled
 */
router.post('/supervisor/l2-toggle', authenticateToken, requireRoles('SECURITY_HEAD', 'ADMIN'), toggleL2Approval);

/**
 * @openapi
 * /api/supervisor/resident-absence:
 *   post:
 *     summary: Register Resident Overnight Absence Pre-Notification
 *     tags: [Supervisor & Overrides]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [departure_date, expected_return_date]
 *             properties:
 *               departure_date:
 *                 type: string
 *                 example: "2026-08-26T08:00"
 *               expected_return_date:
 *                 type: string
 *                 example: "2026-08-28T20:00"
 *               reason:
 *                 type: string
 *                 example: Institutional Conference
 *     responses:
 *       201:
 *         description: Resident absence registered
 */
router.post('/supervisor/resident-absence', authenticateToken, registerResidentAbsence);

/**
 * @openapi
 * /api/registrations/expire-check:
 *   post:
 *     summary: Manually Trigger Request Expiry Check
 *     tags: [Supervisor & Overrides]
 *     responses:
 *       200:
 *         description: Expiry check completed
 */
router.post('/registrations/expire-check', authenticateToken, requireRoles('SUPERVISOR', 'SECURITY_HEAD', 'ADMIN'), async (req, res) => {
  const expired = await checkExpiredRequests();
  res.json({ success: true, message: `Expiry check completed. ${expired.length} request(s) expired.`, expired });
});

/**
 * @openapi
 * /api/admin/bypass-approve:
 *   post:
 *     summary: Master Admin Force Bypass Approval
 *     tags: [Super Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [registration_id]
 *             properties:
 *               registration_id:
 *                 type: integer
 *                 example: 1
 *               remarks:
 *                 type: string
 *                 example: Force approved by Super Admin
 *     responses:
 *       200:
 *         description: Pass force-approved with QR code
 */
router.post('/admin/bypass-approve', authenticateToken, requireRoles('ADMIN', 'SECURITY_HEAD'), adminBypassApprove);

/**
 * @openapi
 * /api/admin/emergency-pass:
 *   post:
 *     summary: Issue & Auto-Approve Admin Emergency Instant Pass
 *     tags: [Super Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [full_name, phone]
 *             properties:
 *               full_name:
 *                 type: string
 *                 example: Emergency Governor Envoy
 *               phone:
 *                 type: string
 *                 example: "+91 9988776655"
 *               vehicle_no:
 *                 type: string
 *                 example: KA-01-GOV-0001
 *               purpose:
 *                 type: string
 *                 example: Urgent State Security Inspection
 *     responses:
 *       201:
 *         description: Emergency pass created and auto-approved
 */
router.post('/admin/emergency-pass', authenticateToken, requireRoles('ADMIN', 'SECURITY_HEAD'), adminEmergencyPass);

/**
 * @openapi
 * /api/reports/metrics:
 *   get:
 *     summary: Get Executive Command Dashboard KPI Metrics
 *     tags: [Reports & Analytics]
 *     responses:
 *       200:
 *         description: KPI metrics summary
 */
router.get('/reports/metrics', authenticateToken, getDashboardMetrics);

/**
 * @openapi
 * /api/reports/data:
 *   get:
 *     summary: Generate Executive Analytics Report Data
 *     tags: [Reports & Analytics]
 *     parameters:
 *       - in: query
 *         name: report_type
 *         schema:
 *           type: string
 *           enum: [DAILY_ENTRY_EXIT, SPOT_REG, PRE_REG, VENDOR, OVERSTAY, FOREIGN, VVIP, EXCEPTION]
 *           example: DAILY_ENTRY_EXIT
 *     responses:
 *       200:
 *         description: Report data rows
 */
router.get('/reports/data', authenticateToken, getReportData);

/**
 * @openapi
 * /api/system/settings:
 *   get:
 *     summary: Get Current System Policy Settings
 *     tags: [Reports & Analytics]
 *     responses:
 *       200:
 *         description: System settings status
 */
router.get('/system/settings', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT key, value FROM system_settings ORDER BY key');
    const settings = {};
    result.rows.forEach(row => { settings[row.key] = row.value; });
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch settings.' });
  }
});

/**
 * @openapi
 * /api/system/settings:
 *   put:
 *     summary: Update System Configuration Setting
 *     tags: [Super Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [key, value]
 *             properties:
 *               key:
 *                 type: string
 *               value:
 *                 type: string
 *     responses:
 *       200:
 *         description: Setting updated
 */
router.put('/system/settings', authenticateToken, requireRoles('ADMIN', 'SECURITY_HEAD'), async (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) {
    return res.status(400).json({ success: false, message: 'Key and value are required.' });
  }
  try {
    await db.query(
      `INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, value]
    );
    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, remarks) VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'UPDATE_SYSTEM_SETTING', 'SYSTEM', `Setting ${key} updated to ${value} by ${req.user.name}`]
    );
    res.json({ success: true, message: `Setting ${key} updated to ${value}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update setting.' });
  }
});

/**
 * @openapi
 * /api/admin/approvers-config:
 *   get:
 *     summary: Get Approvers Configuration
 *     tags: [Super Admin]
 *     responses:
 *       200:
 *         description: List of approver configurations
 */
router.get('/admin/approvers-config', authenticateToken, requireRoles('ADMIN', 'SECURITY_HEAD'), async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM approvers_config ORDER BY id');
    res.json({ success: true, configs: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch approvers config.' });
  }
});

/**
 * @openapi
 * /api/admin/approvers-config:
 *   put:
 *     summary: Update Approver Configuration
 *     tags: [Super Admin]
 */
router.put('/admin/approvers-config/:id', authenticateToken, requireRoles('ADMIN', 'SECURITY_HEAD'), async (req, res) => {
  const { id } = req.params;
  const { approval_required, approver_role, l2_to_security_head, l2_time_condition_start, l2_time_condition_end } = req.body;
  try {
    await db.query(
      `UPDATE approvers_config SET approval_required = $1, approver_role = $2, l2_to_security_head = $3, l2_time_condition_start = $4, l2_time_condition_end = $5 WHERE id = $6`,
      [approval_required, approver_role, l2_to_security_head, l2_time_condition_start || null, l2_time_condition_end || null, id]
    );
    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, remarks) VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'UPDATE_APPROVER_CONFIG', 'APPROVER_CONFIG', parseInt(id), `Approver config #${id} updated by ${req.user.name}`]
    );
    res.json({ success: true, message: 'Approver configuration updated.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update approver config.' });
  }
});

// Admin User & Bulk Upload Endpoints
router.get('/departments', getDepartments);
router.get('/admin/users', authenticateToken, requireRoles('ADMIN', 'SECURITY_HEAD', 'SUPERVISOR'), getAllUsers);
router.post('/admin/users', authenticateToken, requireRoles('ADMIN', 'SECURITY_HEAD'), createSingleUser);
router.post('/admin/users/bulk-upload', authenticateToken, requireRoles('ADMIN', 'SECURITY_HEAD'), bulkUploadUsers);
router.post('/admin/visitors/bulk-upload', authenticateToken, requireRoles('ADMIN', 'SECURITY_HEAD', 'SUPERVISOR', 'HOD', 'GUARD'), bulkUploadVisitors);

module.exports = router;
