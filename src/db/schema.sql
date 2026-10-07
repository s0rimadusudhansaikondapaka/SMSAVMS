-- Exported UAT Schema DDL
-- Generated on 2026-10-07T11:02:43.056Z

CREATE TABLE IF NOT EXISTS approvers_config (
  id SERIAL PRIMARY KEY,
  host_type VARCHAR(50) NOT NULL,
  approval_required BOOLEAN DEFAULT false,
  approver_role VARCHAR(50),
  l2_to_security_head BOOLEAN DEFAULT false,
  l2_time_condition_start TIME WITHOUT TIME ZONE,
  l2_time_condition_end TIME WITHOUT TIME ZONE,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INTEGER,
  remarks TEXT,
  timestamp TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  actor_name VARCHAR(150),
  actor_role VARCHAR(50),
  ip_address VARCHAR(100),
  status VARCHAR(20) DEFAULT 'SUCCESS'::character varying,
  guid VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS delivery_persons (
  id SERIAL PRIMARY KEY,
  guid VARCHAR(64),
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  company_name VARCHAR(255),
  id_type VARCHAR(100) DEFAULT 'Aadhaar'::character varying,
  id_number VARCHAR(100),
  photo_url TEXT,
  vehicle_type VARCHAR(50) DEFAULT 'Two Wheeler'::character varying,
  vehicle_number VARCHAR(100),
  destination_host_id INTEGER,
  status VARCHAR(50) DEFAULT 'PENDING'::character varying,
  created_by_user_id INTEGER,
  created_by_role VARCHAR(50),
  approved_by_user_id INTEGER,
  approved_by_name VARCHAR(255),
  supervisor_notified_at TIMESTAMP WITHOUT TIME ZONE,
  approved_at TIMESTAMP WITHOUT TIME ZONE,
  current_visit_status VARCHAR(50) DEFAULT 'OUT'::character varying,
  last_entry_at TIMESTAMP WITHOUT TIME ZONE,
  last_exit_at TIMESTAMP WITHOUT TIME ZONE,
  active_registration_id INTEGER,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  id_card_image_url TEXT
);

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  hod_user_id INTEGER
);

CREATE TABLE IF NOT EXISTS device_duty_sessions (
  id SERIAL PRIMARY KEY,
  device_id VARCHAR(50),
  guard_id INTEGER,
  guard_name VARCHAR(150),
  guard_phone VARCHAR(50),
  guard_code VARCHAR(50),
  duty_date DATE,
  checked_in_at TIMESTAMP WITHOUT TIME ZONE,
  checked_out_at TIMESTAMP WITHOUT TIME ZONE,
  status VARCHAR(20),
  gate_name VARCHAR(100),
  created_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE TABLE IF NOT EXISTS devices (
  id SERIAL PRIMARY KEY,
  device_id VARCHAR(50),
  device_name VARCHAR(100),
  secret_code VARCHAR(255),
  gate_name VARCHAR(100),
  status VARCHAR(20),
  last_active_at TIMESTAMP WITHOUT TIME ZONE,
  created_at TIMESTAMP WITHOUT TIME ZONE,
  updated_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  subject VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gate_category_rules (
  id SERIAL PRIMARY KEY,
  gate_name VARCHAR(50),
  visitor_category VARCHAR(50),
  is_allowed BOOLEAN,
  updated_at TIMESTAMP WITHOUT TIME ZONE,
  direction_mode VARCHAR(50) DEFAULT 'BOTH'::character varying,
  allow_in BOOLEAN DEFAULT true,
  allow_out BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS gate_direction_config (
  gate_name VARCHAR(100),
  direction_mode VARCHAR(50),
  is_active BOOLEAN,
  updated_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE TABLE IF NOT EXISTS gate_logs (
  id SERIAL PRIMARY KEY,
  registration_id INTEGER,
  visitor_id INTEGER,
  gate_name VARCHAR(50) NOT NULL,
  direction VARCHAR(10) NOT NULL,
  person_count INTEGER DEFAULT 1,
  adult_men_count INTEGER DEFAULT 1,
  adult_women_count INTEGER DEFAULT 0,
  children_count INTEGER DEFAULT 0,
  boys_count INTEGER DEFAULT 0,
  girls_count INTEGER DEFAULT 0,
  vehicle_no VARCHAR(50),
  recorded_by_guard_id INTEGER,
  timestamp TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  remarks TEXT,
  guid VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS incidents (
  id SERIAL PRIMARY KEY,
  incident_id VARCHAR(64),
  incident_type VARCHAR(100),
  severity VARCHAR(50),
  description TEXT,
  gate_name VARCHAR(100),
  device_id VARCHAR(100),
  guard_id INTEGER,
  guard_name VARCHAR(150),
  pass_code VARCHAR(100),
  vehicle_no VARCHAR(100),
  photo_url TEXT,
  status VARCHAR(50),
  resolution_notes TEXT,
  resolved_by VARCHAR(150),
  created_at TIMESTAMP WITHOUT TIME ZONE,
  resolved_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE TABLE IF NOT EXISTS invite_tokens (
  id SERIAL PRIMARY KEY,
  token VARCHAR(100) NOT NULL,
  host_id INTEGER NOT NULL,
  is_used BOOLEAN DEFAULT false,
  used_at TIMESTAMP WITHOUT TIME ZONE,
  registration_id INTEGER,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS l2_approval_matrix_rules (
  id SERIAL PRIMARY KEY,
  host_category VARCHAR(50),
  visit_type_category VARCHAR(50),
  approver_type VARCHAR(50),
  is_enabled BOOLEAN,
  updated_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE TABLE IF NOT EXISTS registration_vehicles (
  id SERIAL PRIMARY KEY,
  registration_id INTEGER NOT NULL,
  plate_number VARCHAR(50) NOT NULL,
  vehicle_type VARCHAR(50) NOT NULL,
  driver_name VARCHAR(100),
  driver_phone VARCHAR(20),
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS registrations (
  id SERIAL PRIMARY KEY,
  visitor_id INTEGER NOT NULL,
  host_id INTEGER,
  purpose TEXT NOT NULL,
  registration_mode VARCHAR(20) DEFAULT 'Single'::character varying,
  registration_type VARCHAR(50) DEFAULT 'PRE_APPROVAL'::character varying,
  visit_type VARCHAR(50) DEFAULT 'OFFICE'::character varying,
  stay_required BOOLEAN DEFAULT false,
  accommodation_approved BOOLEAN DEFAULT false,
  priority VARCHAR(10) DEFAULT 'P3'::character varying,
  status VARCHAR(50) DEFAULT 'PENDING_L1'::character varying,
  pass_code VARCHAR(20) NOT NULL,
  qr_code_url TEXT,
  valid_from TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  valid_until TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  is_permanent_pass BOOLEAN DEFAULT false,
  adult_men_count INTEGER DEFAULT 1,
  adult_women_count INTEGER DEFAULT 0,
  children_count INTEGER DEFAULT 0,
  boys_count INTEGER DEFAULT 0,
  girls_count INTEGER DEFAULT 0,
  person_count INTEGER DEFAULT 1,
  is_vvip BOOLEAN DEFAULT false,
  bypassed_by_admin BOOLEAN DEFAULT false,
  reminder_sent_at TIMESTAMP WITHOUT TIME ZONE,
  host_notified_at TIMESTAMP WITHOUT TIME ZONE,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  approved_by_user_id INTEGER,
  approved_by_name VARCHAR(150),
  approved_by_role VARCHAR(50),
  family_member_id INTEGER,
  relationship_to_resident VARCHAR(100),
  guid VARCHAR(64),
  vehicle_no VARCHAR(100),
  lifecycle_status VARCHAR(50) DEFAULT 'Yet to Arrive'::character varying,
  presence_status VARCHAR(50) DEFAULT 'currently_outside'::character varying,
  first_entry_at TIMESTAMP WITHOUT TIME ZONE,
  last_entry_at TIMESTAMP WITHOUT TIME ZONE,
  last_exit_at TIMESTAMP WITHOUT TIME ZONE,
  host_approved_at TIMESTAMP WITHOUT TIME ZONE,
  host_approved_by INTEGER,
  approval_timestamp TIMESTAMP WITHOUT TIME ZONE
);

CREATE TABLE IF NOT EXISTS resident_absences (
  id SERIAL PRIMARY KEY,
  resident_id INTEGER NOT NULL,
  departure_date TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  expected_return_date TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  actual_return_date TIMESTAMP WITHOUT TIME ZONE,
  reason TEXT,
  status VARCHAR(50) DEFAULT 'APPROVED'::character varying,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS resident_family_members (
  id SERIAL PRIMARY KEY,
  resident_id INTEGER,
  full_name VARCHAR(255) NOT NULL,
  relationship VARCHAR(100) NOT NULL,
  phone VARCHAR(50),
  photo_url TEXT,
  id_card_number VARCHAR(100),
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  is_pro_approved BOOLEAN DEFAULT false,
  pro_approved_by INTEGER,
  pro_approved_at TIMESTAMP WITHOUT TIME ZONE,
  guid VARCHAR(64),
  user_id INTEGER,
  email VARCHAR(150),
  age INTEGER,
  gender VARCHAR(20),
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(100) NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  guid VARCHAR(64),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  role VARCHAR(50) NOT NULL,
  residency_status VARCHAR(50) NOT NULL,
  department_id INTEGER,
  password_hash VARCHAR(255) NOT NULL,
  otp_code VARCHAR(6),
  otp_expires_at TIMESTAMP WITHOUT TIME ZONE,
  registration_status VARCHAR(20) DEFAULT 'ACTIVE'::character varying,
  gender VARCHAR(20) DEFAULT 'Male'::character varying,
  profile_photo_url TEXT,
  flat_info VARCHAR(100),
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  user_type VARCHAR(50) DEFAULT 'RESIDENT'::character varying,
  primary_resident_id INTEGER
);

CREATE TABLE IF NOT EXISTS visitors (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(150),
  gender VARCHAR(20) DEFAULT 'Male'::character varying,
  photo_url TEXT,
  id_type VARCHAR(50) DEFAULT 'Aadhaar'::character varying,
  id_number VARCHAR(50),
  id_card_number VARCHAR(50),
  id_card_image_url TEXT,
  visitor_category VARCHAR(50) DEFAULT 'GENERAL'::character varying,
  vehicle_no VARCHAR(50),
  vehicle_type VARCHAR(50),
  is_frequent_visitor BOOLEAN DEFAULT false,
  has_smartphone BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  company_name VARCHAR(255),
  guid VARCHAR(64)
);