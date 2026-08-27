-- Seed Initial Data for Sathya Sai Grama VMS (Updated per PPTX Specifications)

-- 1. Departments
INSERT INTO departments (name) VALUES 
('Administration Office'),
('Accommodation Office'),
('Public Relations (PRO)'),
('Security Department'),
('IT & Systems')
ON CONFLICT (name) DO NOTHING;

-- Users: Resident Host, Guard, Supervisor, Security Head, and System Admin
INSERT INTO users (guid, name, email, phone, role, residency_status, department_id, password_hash) VALUES
('e9a18432-84b2-4d89-b7e1-8a9d3c5f7e12', 'Srinivas Rao (Resident)', 'resident1@ashram.org', '+91 9876543210', 'RESIDENT', 'RESIDENT', 1, '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW'),
('f83a9b2c-4e7f-4b3c-9a1b-2c3d4e5f6a7b', 'Dr. Kumar (Resident Employee)', 'employee1@ashram.org', '+91 9876543211', 'EMPLOYEE', 'RESIDENT', 1, '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW'),
('c72b8a1d-3e6f-4a2b-8c0d-1e2f3a4b5c6d', 'Swami Nathan (Department HOD)', 'hod1@ashram.org', '+91 9876543212', 'HOD', 'RESIDENT', 1, '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW'),
('b61a7f0e-2d5c-4b1a-7b9c-0d1e2f3a4b5c', 'Ramesh Guard (North Gate Guard)', 'guard1@ashram.org', '+91 9876543213', 'GUARD', 'NON_RESIDENT', 4, '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW'),
('a50f6e9d-1c4b-3a0f-6a8b-9c0d1e2f3a4b', 'Suresh Supervisor (Security Officer)', 'supervisor1@ashram.org', '+91 9876543214', 'SUPERVISOR', 'RESIDENT', 4, '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW'),
('940e5d8c-0b3a-2f9e-5f7a-8b9c0d1e2f3a', 'Major Rajesh (Security Head)', 'securityhead@ashram.org', '+91 9876543215', 'SECURITY_HEAD', 'RESIDENT', 4, '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW'),
('830d4c7b-9a2f-1e8d-4e6f-7a8b9c0d1e2f', 'System Administrator (Super Admin)', 'admin@ashram.org', '+91 9876543216', 'ADMIN', 'RESIDENT', 5, '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW');

-- Update HOD backlink in departments
UPDATE departments SET hod_user_id = 3 WHERE id = 1;

-- 3. Initial Sample Visitors (Pre-approval, Frequent Maid, Delivery Boy, Smartphone-less)
INSERT INTO visitors (full_name, phone, email, gender, photo_url, id_type, id_number, id_card_number, id_card_image_url, visitor_category, vehicle_no, vehicle_type, is_frequent_visitor, has_smartphone) VALUES
('Ravi VVIP Guest', '+91 9900112233', 'vVIP@guest.com', 'Male', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150', 'Passport', 'Z1234567', 'Z1234567', 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=300', 'VVIP', 'KA-01-MJ-9999', 'Car', false, true),
('Anil Sharma', '+91 9911223344', 'anil@gmail.com', 'Male', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150', 'Aadhaar', '1234-5678-9012', '1234-5678-9012', 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=300', 'GENERAL', 'KA-04-AB-1234', 'Car', false, true),
('John Doe', '+91 9922334455', 'john@foreign.org', 'Male', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150', 'Passport', 'US987654321', 'US987654321', 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=300', 'FOREIGN_NATIONAL', '', '', false, true),
('Lakshmi (Ashram Domestic Helper)', '+91 9988001122', 'lakshmi@maid.org', 'Female', 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150', 'Aadhaar', '9988-7766-5544', '9988-7766-5544', '', 'MAID', '', '', true, false),
('Swiggy / Amazon Courier Delivery', '+91 9933445566', 'delivery@courier.com', 'Male', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150', 'Aadhaar', '4455-6677-8899', '4455-6677-8899', '', 'DELIVERY', 'KA-05-EX-3344', 'Two Wheeler', true, true);

-- 4. Initial Sample Registrations (Including PERMANENT PASSCODE & DELIVERY PHONE LOOKUP)
INSERT INTO registrations (visitor_id, host_id, purpose, registration_mode, registration_type, visit_type, stay_required, accommodation_approved, priority, status, pass_code, valid_from, valid_until, is_permanent_pass, adult_men_count, adult_women_count, children_count, person_count, is_vvip) VALUES
(1, 1, 'High Level Ashram Visit & Institutional Meeting', 'Group', 'PRE_APPROVAL', 'OFFICE', false, false, 'P1', 'APPROVED', 'VVIP-9999', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '12 hours', false, 2, 1, 0, 3, true),
(2, 1, 'Personal Visit to Meet Resident', 'Group', 'PRE_APPROVAL', 'HOME', false, false, 'P3', 'APPROVED', 'PASS-1001', NOW() - INTERVAL '30 minutes', NOW() + INTERVAL '8 hours', false, 1, 1, 2, 4, false),
(3, 2, 'Attending Evening Bhajans & Spiritual Program', 'Single', 'PRE_APPROVAL', 'BHAJAN', true, true, 'P2', 'APPROVED', 'PASS-1002', NOW() - INTERVAL '2 hours', NOW() + INTERVAL '24 hours', false, 1, 0, 0, 1, false),
(4, 1, 'Daily Ashram Domestic Helper Services', 'Single', 'FREQUENT_VISITOR', 'HOME', false, true, 'P3', 'APPROVED', 'MAID-PERM-5001', NOW() - INTERVAL '30 days', NOW() + INTERVAL '365 days', true, 0, 1, 0, 1, false),
(5, 5, 'Express Package Delivery to Admin Building', 'Single', 'DELIVERY_COURIER', 'OFFICE', false, true, 'P3', 'APPROVED', 'DELIVERY-9933445566', NOW() - INTERVAL '10 days', NOW() + INTERVAL '180 days', true, 1, 0, 0, 1, false);

-- 5. Multiple Vehicles Seed Data
INSERT INTO registration_vehicles (registration_id, plate_number, vehicle_type, driver_name, driver_phone) VALUES
(1, 'KA-01-MJ-9999', 'Luxury Sedan', 'Mahesh Driver', '+91 9111222333'),
(1, 'KA-01-ESC-0001', 'Security Escort SUV', 'Suresh Security Driver', '+91 9111222334'),
(2, 'KA-04-AB-1234', 'Family Car', 'Anil Sharma', '+91 9911223344'),
(5, 'KA-05-EX-3344', 'Two Wheeler Delivery Bike', 'Swiggy Driver', '+91 9933445566');

-- 6. Approvers Configuration Seed Data
INSERT INTO approvers_config (host_type, approval_required, approver_role, l2_to_security_head, l2_time_condition_start, l2_time_condition_end) VALUES
('RESIDENT', true, 'RESIDENT_VISITOR_APPROVER', true, '18:00', '06:00'),
('EMPLOYEE', false, NULL, false, NULL, NULL),
('VIP_GUEST_HOST', false, NULL, false, NULL, NULL),
('PRO', false, NULL, false, NULL, NULL);

-- 7. Additional System Settings (Admin-Configurable)
INSERT INTO system_settings (key, value) VALUES 
('ENTRY_WINDOW_HOURS', '8'),
('HOST_TIMEOUT_MINUTES', '30'),
('REMINDER_BEFORE_ARRIVAL_MINUTES', '30'),
('OVERSTAY_ALERT_TIME', '21:00'),
('OVERSTAY_ESCALATION_TIME', '21:30'),
('LATE_ENTRY_START_TIME', '22:00'),
('LATE_ENTRY_END_TIME', '05:00'),
('NIGHT_HOURS_START', '18:00'),
('NIGHT_HOURS_END', '06:00'),
('MAX_VISIT_DURATION_DAYS', '30'),
('QR_EXPIRY_HOURS', '24'),
('AUTO_EXPIRE_PENDING_REQUESTS', 'true')
ON CONFLICT (key) DO NOTHING;

