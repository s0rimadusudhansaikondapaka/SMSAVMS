const db = require('../config/db');

async function getDashboardMetrics(req, res) {
  try {
    const totalInsideRes = await db.query("SELECT COUNT(*) as count FROM registrations WHERE status = 'INSIDE_CAMPUS'");
    const totalTodayRes = await db.query("SELECT COUNT(*) as count FROM registrations");
    const pendingApprovalsRes = await db.query("SELECT COUNT(*) as count FROM registrations WHERE status IN ('PENDING_L1', 'PENDING_L2', 'PENDING_ACCOMMODATION')");
    const overstaysRes = await db.query("SELECT COUNT(*) as count FROM registrations WHERE status = 'INSIDE_CAMPUS'");
    const vvipCountRes = await db.query("SELECT COUNT(*) as count FROM registrations WHERE is_vvip = true");

    res.json({
      success: true,
      metrics: {
        visitors_inside: parseInt(totalInsideRes.rows[0].count || 0),
        total_today: parseInt(totalTodayRes.rows[0].count || 0),
        pending_approvals: parseInt(pendingApprovalsRes.rows[0].count || 0),
        overstays: parseInt(overstaysRes.rows[0].count || 0),
        vvip_visits_today: parseInt(vvipCountRes.rows[0].count || 0),
      },
    });
  } catch (err) {
    console.error('Error in getDashboardMetrics:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard metrics.' });
  }
}

async function getReportData(req, res) {
  const { report_type } = req.query; // e.g. DAILY_ENTRY_EXIT, SPOT_REG, PRE_REG, VENDOR, OVERSTAY, FOREIGN, VVIP, EXCEPTION
  try {
    let queryText = '';
    let params = [];

    switch (report_type) {
      case 'DAILY_ENTRY_EXIT':
        queryText = `SELECT gl.*, r.pass_code, v.full_name as visitor_name, u.name as guard_name FROM gate_logs gl JOIN registrations r ON gl.registration_id = r.id JOIN visitors v ON r.visitor_id = v.id LEFT JOIN users u ON gl.recorded_by_guard_id = u.id ORDER BY gl.id DESC`;
        break;
      case 'SPOT_REG':
        queryText = `SELECT r.*, v.full_name as visitor_name, v.phone as visitor_phone FROM registrations r JOIN visitors v ON r.visitor_id = v.id WHERE r.pass_code LIKE 'PASS%' ORDER BY r.id DESC`;
        break;
      case 'PRE_REG':
        queryText = `SELECT r.*, v.full_name as visitor_name, u.name as host_name FROM registrations r JOIN visitors v ON r.visitor_id = v.id LEFT JOIN users u ON r.host_id = u.id ORDER BY r.id DESC`;
        break;
      case 'VENDOR':
        queryText = `SELECT r.*, v.full_name as visitor_name, v.vehicle_no FROM registrations r JOIN visitors v ON r.visitor_id = v.id WHERE v.visitor_category IN ('VENDOR', 'DELIVERY', 'CONTRACTOR') ORDER BY r.id DESC`;
        break;
      case 'OVERSTAY':
        queryText = `SELECT r.*, v.full_name as visitor_name, v.phone as visitor_phone, u.name as host_name FROM registrations r JOIN visitors v ON r.visitor_id = v.id LEFT JOIN users u ON r.host_id = u.id WHERE r.status = 'INSIDE_CAMPUS'`;
        break;
      case 'FOREIGN':
        queryText = `SELECT r.*, v.full_name as visitor_name, v.phone as visitor_phone, v.id_number as passport_no FROM registrations r JOIN visitors v ON r.visitor_id = v.id WHERE v.visitor_category = 'FOREIGN_NATIONAL' ORDER BY r.id DESC`;
        break;
      case 'VVIP':
        queryText = `SELECT r.*, v.full_name as visitor_name, v.vehicle_no, u.name as host_name FROM registrations r JOIN visitors v ON r.visitor_id = v.id LEFT JOIN users u ON r.host_id = u.id WHERE r.is_vvip = true ORDER BY r.id DESC`;
        break;
      case 'EXCEPTION':
        queryText = `SELECT * FROM audit_logs ORDER BY id DESC`;
        break;
      default:
        queryText = `SELECT r.*, v.full_name as visitor_name FROM registrations r JOIN visitors v ON r.visitor_id = v.id ORDER BY r.id DESC`;
    }

    const result = await db.query(queryText, params);
    res.json({ success: true, report_type, data: result.rows });
  } catch (err) {
    console.error('Error generating report:', err);
    res.status(500).json({ success: false, message: 'Failed to generate report.' });
  }
}

module.exports = {
  getDashboardMetrics,
  getReportData,
};
