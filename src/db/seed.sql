-- Exported UAT Data Seed
-- Generated on 2026-08-29T06:28:33.245Z

INSERT INTO approvers_config (id, host_type, approval_required, approver_role, l2_to_security_head, l2_time_condition_start, l2_time_condition_end, created_at) VALUES
  (1, 'RESIDENT', true, 'RESIDENT_VISITOR_APPROVER', true, '18:00:00', '06:00:00', '2026-08-27T04:18:54.284Z'),
  (2, 'EMPLOYEE', false, NULL, false, NULL, NULL, '2026-08-27T04:18:54.284Z'),
  (3, 'VIP_GUEST_HOST', false, NULL, false, NULL, NULL, '2026-08-27T04:18:54.284Z'),
  (4, 'PRO', false, NULL, false, NULL, NULL, '2026-08-27T04:18:54.284Z');

INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, remarks, timestamp, actor_name, actor_role, ip_address, status) VALUES
  (1, 1, 'GENERATE_QR_CODE', 'REGISTRATION', 4, 'Referrer Srinivas Rao (Resident) generated QR Code for Pass MAID-PERM-5001', '2026-08-27T05:55:44.113Z', 'Srinivas Rao (Resident)', 'RESIDENT', NULL, 'SUCCESS'),
  (2, 1, 'GENERATE_QR_CODE', 'REGISTRATION', 1, 'Referrer Srinivas Rao (Resident) generated QR Code for Pass VVIP-9999', '2026-08-27T06:02:58.223Z', 'Srinivas Rao (Resident)', 'RESIDENT', NULL, 'SUCCESS'),
  (3, 4, 'GATE_IN', 'REGISTRATION', 1, 'Gate IN at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T06:47:48.157Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (4, 4, 'GATE_IN', 'REGISTRATION', 1, 'Gate IN at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T06:47:55.895Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (5, 4, 'GATE_IN', 'REGISTRATION', 1, 'Gate IN at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T06:48:04.152Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (6, 4, 'GATE_OUT', 'REGISTRATION', 1, 'Gate OUT at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T06:48:11.755Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (7, 4, 'GATE_IN', 'REGISTRATION', 1, 'Gate IN at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T06:48:21.064Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (8, 4, 'GATE_OUT', 'REGISTRATION', 1, 'Gate OUT at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T07:36:10.775Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (9, 4, 'GATE_OUT', 'REGISTRATION', 1, 'Gate OUT at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T07:36:10.808Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (10, 4, 'GATE_OUT', 'REGISTRATION', 1, 'Gate OUT at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T07:36:11.941Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (11, 4, 'GATE_OUT', 'REGISTRATION', 1, 'Gate OUT at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T07:36:12.336Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (12, 4, 'GATE_OUT', 'REGISTRATION', 1, 'Gate OUT at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T07:36:12.522Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (13, 4, 'GATE_OUT', 'REGISTRATION', 1, 'Gate OUT at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T07:36:12.558Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (14, 4, 'GATE_IN', 'REGISTRATION', 1, 'Gate IN at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T07:37:12.909Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (15, 4, 'GATE_OUT', 'REGISTRATION', 1, 'Gate OUT at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T07:37:16.568Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (16, 4, 'GATE_IN', 'REGISTRATION', 1, 'Gate IN at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T07:37:21.136Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (17, 4, 'GATE_OUT', 'REGISTRATION', 1, 'Gate OUT at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T07:48:41.108Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (18, 4, 'GATE_IN', 'REGISTRATION', 1, 'Gate IN at NORTH_GATE. Men: 2, Women: 1, Children: 0 (Permanent Pass: false)', '2026-08-27T07:49:15.970Z', 'Ramesh Guard (North Gate Guard)', 'GUARD', NULL, 'SUCCESS'),
  (19, 1, 'APPROVAL_APPROVE', 'REGISTRATION', 2, 'Test approval', '2026-08-28T23:55:44.510Z', NULL, NULL, NULL, 'SUCCESS'),
  (20, 1, 'APPROVAL_REJECT', 'REGISTRATION', 2, 'Test rejection', '2026-08-28T23:55:50.118Z', NULL, NULL, NULL, 'SUCCESS');

INSERT INTO departments (id, name, created_at, hod_user_id) VALUES
  (1, 'Administration Office', '2026-08-27T04:18:54.284Z', 3),
  (2, 'Accommodation Office', '2026-08-27T04:18:54.284Z', NULL),
  (3, 'Public Relations (PRO)', '2026-08-27T04:18:54.284Z', NULL),
  (4, 'Security Department', '2026-08-27T04:18:54.284Z', NULL),
  (5, 'IT & Systems', '2026-08-27T04:18:54.284Z', NULL);

INSERT INTO gate_category_rules (id, gate_name, visitor_category, is_allowed, updated_at) VALUES
  (1, 'NORTH_GATE', 'GENERAL', true, '2026-08-27T22:56:47.041Z'),
  (2, 'NORTH_GATE', 'VVIP', true, '2026-08-27T22:56:47.421Z'),
  (3, 'NORTH_GATE', 'VIP', true, '2026-08-27T22:56:47.929Z'),
  (4, 'NORTH_GATE', 'VENDOR', true, '2026-08-27T22:56:48.399Z'),
  (5, 'NORTH_GATE', 'CONTRACTOR', true, '2026-08-27T22:56:48.898Z'),
  (6, 'NORTH_GATE', 'FOREIGN_NATIONAL', true, '2026-08-27T22:56:49.398Z'),
  (7, 'NORTH_GATE', 'DELIVERY', true, '2026-08-27T22:56:50.002Z'),
  (8, 'NORTH_GATE', 'CAB', true, '2026-08-27T22:56:50.677Z'),
  (9, 'NORTH_GATE', 'MAID', true, '2026-08-27T22:56:51.358Z'),
  (10, 'NORTH_GATE', 'FREQUENT_VISITOR', true, '2026-08-27T22:56:52.509Z'),
  (11, 'SOUTH_GATE', 'GENERAL', true, '2026-08-27T22:56:53.182Z'),
  (12, 'SOUTH_GATE', 'VVIP', true, '2026-08-27T22:56:53.789Z'),
  (13, 'SOUTH_GATE', 'VIP', true, '2026-08-27T22:56:54.557Z'),
  (14, 'SOUTH_GATE', 'VENDOR', true, '2026-08-27T22:56:55.068Z'),
  (15, 'SOUTH_GATE', 'CONTRACTOR', true, '2026-08-27T22:56:55.532Z'),
  (16, 'SOUTH_GATE', 'FOREIGN_NATIONAL', true, '2026-08-27T22:56:56.081Z'),
  (17, 'SOUTH_GATE', 'DELIVERY', false, '2026-08-27T22:56:57.808Z'),
  (18, 'SOUTH_GATE', 'CAB', true, '2026-08-27T22:56:58.350Z'),
  (19, 'SOUTH_GATE', 'MAID', true, '2026-08-27T22:56:58.641Z'),
  (20, 'SOUTH_GATE', 'FREQUENT_VISITOR', true, '2026-08-27T22:56:59.014Z'),
  (21, 'EAST_GATE', 'GENERAL', true, '2026-08-27T22:56:59.269Z'),
  (22, 'EAST_GATE', 'VVIP', true, '2026-08-27T22:56:59.626Z'),
  (23, 'EAST_GATE', 'VIP', true, '2026-08-27T22:57:00.041Z'),
  (24, 'EAST_GATE', 'VENDOR', true, '2026-08-27T22:57:00.445Z'),
  (25, 'EAST_GATE', 'CONTRACTOR', true, '2026-08-27T22:57:00.592Z'),
  (26, 'EAST_GATE', 'FOREIGN_NATIONAL', true, '2026-08-27T22:57:00.744Z'),
  (27, 'EAST_GATE', 'DELIVERY', true, '2026-08-27T22:57:00.921Z'),
  (28, 'EAST_GATE', 'CAB', true, '2026-08-27T22:57:01.068Z'),
  (29, 'EAST_GATE', 'MAID', true, '2026-08-27T22:57:01.215Z'),
  (30, 'EAST_GATE', 'FREQUENT_VISITOR', true, '2026-08-27T22:57:01.399Z'),
  (31, 'WEST_GATE', 'GENERAL', true, '2026-08-27T22:57:01.558Z'),
  (32, 'WEST_GATE', 'VVIP', true, '2026-08-27T22:57:01.734Z'),
  (33, 'WEST_GATE', 'VIP', true, '2026-08-27T22:57:01.887Z'),
  (34, 'WEST_GATE', 'VENDOR', true, '2026-08-27T22:57:02.053Z'),
  (35, 'WEST_GATE', 'CONTRACTOR', true, '2026-08-27T22:57:02.284Z'),
  (36, 'WEST_GATE', 'FOREIGN_NATIONAL', true, '2026-08-27T22:57:02.420Z'),
  (37, 'WEST_GATE', 'DELIVERY', true, '2026-08-27T22:57:02.606Z'),
  (38, 'WEST_GATE', 'CAB', true, '2026-08-27T22:57:02.972Z'),
  (39, 'WEST_GATE', 'MAID', true, '2026-08-27T22:57:03.145Z'),
  (40, 'WEST_GATE', 'FREQUENT_VISITOR', true, '2026-08-27T22:57:03.292Z'),
  (41, 'STAFF_GATE', 'GENERAL', true, '2026-08-27T22:57:03.942Z'),
  (42, 'STAFF_GATE', 'VVIP', true, '2026-08-27T22:57:04.464Z'),
  (43, 'STAFF_GATE', 'VIP', true, '2026-08-27T22:57:05.026Z'),
  (44, 'STAFF_GATE', 'VENDOR', true, '2026-08-27T22:57:05.683Z'),
  (45, 'STAFF_GATE', 'CONTRACTOR', true, '2026-08-27T22:57:06.389Z'),
  (46, 'STAFF_GATE', 'FOREIGN_NATIONAL', true, '2026-08-27T22:57:07.506Z'),
  (47, 'STAFF_GATE', 'DELIVERY', true, '2026-08-27T22:57:07.969Z'),
  (48, 'STAFF_GATE', 'CAB', true, '2026-08-27T22:57:08.914Z'),
  (49, 'STAFF_GATE', 'MAID', true, '2026-08-27T22:57:09.288Z'),
  (50, 'STAFF_GATE', 'FREQUENT_VISITOR', true, '2026-08-27T22:57:09.883Z');

INSERT INTO gate_logs (id, registration_id, visitor_id, gate_name, direction, person_count, adult_men_count, adult_women_count, children_count, boys_count, girls_count, vehicle_no, recorded_by_guard_id, timestamp, remarks) VALUES
  (1, 1, 1, 'NORTH_GATE', 'IN', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T06:47:48.157Z', ''),
  (2, 1, 1, 'NORTH_GATE', 'IN', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T06:47:55.895Z', ''),
  (3, 1, 1, 'NORTH_GATE', 'IN', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T06:48:04.152Z', ''),
  (4, 1, 1, 'NORTH_GATE', 'OUT', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T06:48:11.755Z', ''),
  (5, 1, 1, 'NORTH_GATE', 'IN', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T06:48:21.064Z', ''),
  (6, 1, 1, 'NORTH_GATE', 'OUT', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T07:36:10.775Z', ''),
  (7, 1, 1, 'NORTH_GATE', 'OUT', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T07:36:10.808Z', ''),
  (8, 1, 1, 'NORTH_GATE', 'OUT', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T07:36:11.941Z', ''),
  (9, 1, 1, 'NORTH_GATE', 'OUT', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T07:36:12.336Z', ''),
  (10, 1, 1, 'NORTH_GATE', 'OUT', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T07:36:12.522Z', ''),
  (11, 1, 1, 'NORTH_GATE', 'OUT', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T07:36:12.558Z', ''),
  (12, 1, 1, 'NORTH_GATE', 'IN', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T07:37:12.909Z', ''),
  (13, 1, 1, 'NORTH_GATE', 'OUT', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T07:37:16.568Z', ''),
  (14, 1, 1, 'NORTH_GATE', 'IN', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T07:37:21.136Z', ''),
  (15, 1, 1, 'NORTH_GATE', 'OUT', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T07:48:41.108Z', ''),
  (16, 1, 1, 'NORTH_GATE', 'IN', 3, 2, 1, 0, 0, 0, 'KA-01-MJ-9999', 4, '2026-08-27T07:49:15.970Z', '');

INSERT INTO l2_approval_matrix_rules (id, host_category, visit_type_category, approver_type, is_enabled, updated_at) VALUES
  (1, 'RESIDENT', 'RESIDENT_VISIT', 'DEPARTMENT_PRO', true, NULL),
  (2, 'RESIDENT', 'ASHRAM_VISIT', 'DEPARTMENT_PRO', true, NULL),
  (3, 'EMPLOYEE', 'EMPLOYEE_OFFICIAL_VISIT', 'SAME_DEPARTMENT_HOD', true, NULL),
  (4, 'EMPLOYEE', 'ASHRAM_VISIT', 'DEPARTMENT_PRO', true, NULL),
  (5, 'BOTH', 'RESIDENT_VISIT', 'DEPARTMENT_PRO', true, NULL),
  (6, 'BOTH', 'EMPLOYEE_OFFICIAL_VISIT', 'SAME_DEPARTMENT_HOD', true, NULL),
  (7, 'BOTH', 'ASHRAM_VISIT', 'DEPARTMENT_PRO', true, NULL);

INSERT INTO registration_vehicles (id, registration_id, plate_number, vehicle_type, driver_name, driver_phone, created_at) VALUES
  (1, 1, 'KA-01-MJ-9999', 'Luxury Sedan', 'Mahesh Driver', '+91 9111222333', '2026-08-27T04:18:54.284Z'),
  (2, 1, 'KA-01-ESC-0001', 'Security Escort SUV', 'Suresh Security Driver', '+91 9111222334', '2026-08-27T04:18:54.284Z'),
  (3, 2, 'KA-04-AB-1234', 'Family Car', 'Anil Sharma', '+91 9911223344', '2026-08-27T04:18:54.284Z'),
  (4, 5, 'KA-05-EX-3344', 'Two Wheeler Delivery Bike', 'Swiggy Driver', '+91 9933445566', '2026-08-27T04:18:54.284Z');

INSERT INTO registrations (id, visitor_id, host_id, purpose, registration_mode, registration_type, visit_type, stay_required, accommodation_approved, priority, status, pass_code, qr_code_url, valid_from, valid_until, is_permanent_pass, adult_men_count, adult_women_count, children_count, boys_count, girls_count, person_count, is_vvip, bypassed_by_admin, reminder_sent_at, host_notified_at, created_at, approved_by_user_id, approved_by_name, approved_by_role, family_member_id, relationship_to_resident) VALUES
  (1, 1, 1, 'High Level Ashram Visit & Institutional Meeting', 'Group', 'PRE_APPROVAL', 'OFFICE', false, false, 'P1', 'INSIDE_CAMPUS', 'VVIP-9999', 'data:image/png;base64,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', '2026-08-27T03:18:54.284Z', '2026-08-27T16:18:54.284Z', false, 2, 1, 0, 0, 0, 3, true, false, NULL, NULL, '2026-08-27T04:18:54.284Z', NULL, NULL, NULL, NULL, NULL),
  (2, 2, 1, 'Personal Visit to Meet Resident', 'Group', 'PRE_APPROVAL', 'BHAJAN', false, false, 'P3', 'REJECTED', 'PASS-1001', NULL, '2026-08-29T07:13:00.000Z', '2026-08-30T10:30:00.000Z', false, 1, 1, 2, 0, 0, 4, false, false, NULL, NULL, '2026-08-27T04:18:54.284Z', 1, 'Test Referrer', 'RESIDENT', NULL, NULL),
  (3, 3, 2, 'Attending Evening Bhajans & Spiritual Program', 'Single', 'PRE_APPROVAL', 'BHAJAN', true, true, 'P2', 'APPROVED', 'PASS-1002', NULL, '2026-08-27T02:18:54.284Z', '2026-08-28T04:18:54.284Z', false, 1, 0, 0, 0, 0, 1, false, false, NULL, NULL, '2026-08-27T04:18:54.284Z', NULL, NULL, NULL, NULL, NULL),
  (4, 4, 1, 'Daily Ashram Domestic Helper Services', 'Single', 'FREQUENT_VISITOR', 'HOME', false, true, 'P3', 'APPROVED', 'MAID-PERM-5001', 'data:image/png;base64,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', '2026-07-28T04:18:54.284Z', '2027-08-27T04:18:54.284Z', true, 0, 1, 0, 0, 0, 1, false, false, NULL, NULL, '2026-08-27T04:18:54.284Z', NULL, NULL, NULL, NULL, NULL),
  (5, 5, 5, 'Express Package Delivery to Admin Building', 'Single', 'DELIVERY_COURIER', 'OFFICE', false, true, 'P3', 'APPROVED', 'DELIVERY-9933445566', NULL, '2026-08-17T04:18:54.284Z', '2027-02-23T04:18:54.284Z', true, 1, 0, 0, 0, 0, 1, false, false, NULL, NULL, '2026-08-27T04:18:54.284Z', NULL, NULL, NULL, NULL, NULL);

INSERT INTO system_settings (key, value, updated_at) VALUES
  ('L2_APPROVAL_ENABLED', 'true', '2026-08-27T04:18:54.104Z'),
  ('ACCOMMODATION_BYPASS_ENABLED', 'false', '2026-08-27T04:18:54.104Z'),
  ('CURFEW_BYPASS_ENABLED', 'false', '2026-08-27T04:18:54.104Z'),
  ('ENTRY_WINDOW_HOURS', '8', '2026-08-27T04:18:54.284Z'),
  ('HOST_TIMEOUT_MINUTES', '30', '2026-08-27T04:18:54.284Z'),
  ('REMINDER_BEFORE_ARRIVAL_MINUTES', '30', '2026-08-27T04:18:54.284Z'),
  ('OVERSTAY_ALERT_TIME', '21:00', '2026-08-27T04:18:54.284Z'),
  ('OVERSTAY_ESCALATION_TIME', '21:30', '2026-08-27T04:18:54.284Z'),
  ('LATE_ENTRY_START_TIME', '22:00', '2026-08-27T04:18:54.284Z'),
  ('LATE_ENTRY_END_TIME', '05:00', '2026-08-27T04:18:54.284Z'),
  ('NIGHT_HOURS_START', '18:00', '2026-08-27T04:18:54.284Z'),
  ('NIGHT_HOURS_END', '06:00', '2026-08-27T04:18:54.284Z'),
  ('MAX_VISIT_DURATION_DAYS', '30', '2026-08-27T04:18:54.284Z'),
  ('QR_EXPIRY_HOURS', '24', '2026-08-27T04:18:54.284Z'),
  ('AUTO_EXPIRE_PENDING_REQUESTS', 'true', '2026-08-27T04:18:54.284Z'),
  ('REQUIRE_FIRST_TIME_FAMILY_PRO_APPROVAL', 'true', '2026-08-28T23:02:07.644Z');

INSERT INTO users (id, guid, name, email, phone, role, residency_status, department_id, password_hash, otp_code, otp_expires_at, registration_status, gender, profile_photo_url, flat_info, created_at) VALUES
  (1, 'e9a18432-84b2-4d89-b7e1-8a9d3c5f7e12', 'Srinivas Rao (Resident)', 'resident1@ashram.org', '+91 9876543210', 'RESIDENT', 'RESIDENT', 1, '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW', NULL, NULL, 'ACTIVE', 'Male', NULL, NULL, '2026-08-27T04:18:54.284Z'),
  (2, 'f83a9b2c-4e7f-4b3c-9a1b-2c3d4e5f6a7b', 'Dr. Kumar (Resident Employee)', 'employee1@ashram.org', '+91 9876543211', 'EMPLOYEE', 'RESIDENT', 1, '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW', NULL, NULL, 'ACTIVE', 'Male', NULL, NULL, '2026-08-27T04:18:54.284Z'),
  (3, 'c72b8a1d-3e6f-4a2b-8c0d-1e2f3a4b5c6d', 'Swami Nathan (Department HOD)', 'hod1@ashram.org', '+91 9876543212', 'HOD', 'RESIDENT', 1, '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW', NULL, NULL, 'ACTIVE', 'Male', NULL, NULL, '2026-08-27T04:18:54.284Z'),
  (4, 'b61a7f0e-2d5c-4b1a-7b9c-0d1e2f3a4b5c', 'Ramesh Guard (North Gate Guard)', 'guard1@ashram.org', '+91 9876543213', 'GUARD', 'NON_RESIDENT', 4, '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW', NULL, NULL, 'ACTIVE', 'Male', NULL, NULL, '2026-08-27T04:18:54.284Z'),
  (5, 'a50f6e9d-1c4b-3a0f-6a8b-9c0d1e2f3a4b', 'Suresh Supervisor (Security Officer)', 'supervisor1@ashram.org', '+91 9876543214', 'SUPERVISOR', 'RESIDENT', 4, '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW', NULL, NULL, 'ACTIVE', 'Male', NULL, NULL, '2026-08-27T04:18:54.284Z'),
  (6, '940e5d8c-0b3a-2f9e-5f7a-8b9c0d1e2f3a', 'Major Rajesh (Security Head)', 'securityhead@ashram.org', '+91 9876543215', 'SECURITY_HEAD', 'RESIDENT', 4, '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW', NULL, NULL, 'ACTIVE', 'Male', NULL, NULL, '2026-08-27T04:18:54.284Z'),
  (7, '830d4c7b-9a2f-1e8d-4e6f-7a8b9c0d1e2f', 'System Administrator (Super Admin)', 'admin@ashram.org', '+91 9876543216', 'ADMIN', 'RESIDENT', 5, '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW', NULL, NULL, 'ACTIVE', 'Male', NULL, NULL, '2026-08-27T04:18:54.284Z');

INSERT INTO visitors (id, full_name, phone, email, gender, photo_url, id_type, id_number, id_card_number, id_card_image_url, visitor_category, vehicle_no, vehicle_type, is_frequent_visitor, has_smartphone, created_at, company_name) VALUES
  (1, 'Ravi VVIP Guest', '+91 9900112233', 'vVIP@guest.com', 'Male', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150', 'Passport', 'Z1234567', 'Z1234567', 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=300', 'VVIP', 'KA-01-MJ-9999', 'Car', false, true, '2026-08-27T04:18:54.284Z', NULL),
  (2, 'Anil Sharma', '+91 9911223344', 'anil@gmail.com', 'Male', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150', 'Aadhaar', '1234-5678-9012', '1234-5678-9012', 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=300', 'GENERAL', 'KA-04-AB-1234', 'Car', false, true, '2026-08-27T04:18:54.284Z', NULL),
  (3, 'John Doe', '+91 9922334455', 'john@foreign.org', 'Male', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150', 'Passport', 'US987654321', 'US987654321', 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=300', 'FOREIGN_NATIONAL', '', '', false, true, '2026-08-27T04:18:54.284Z', NULL),
  (4, 'Lakshmi (Ashram Domestic Helper)', '+91 9988001122', 'lakshmi@maid.org', 'Female', 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150', 'Aadhaar', '9988-7766-5544', '9988-7766-5544', '', 'MAID', '', '', true, false, '2026-08-27T04:18:54.284Z', NULL),
  (5, 'Swiggy / Amazon Courier Delivery', '+91 9933445566', 'delivery@courier.com', 'Male', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150', 'Aadhaar', '4455-6677-8899', '4455-6677-8899', '', 'DELIVERY', 'KA-05-EX-3344', 'Two Wheeler', true, true, '2026-08-27T04:18:54.284Z', NULL);