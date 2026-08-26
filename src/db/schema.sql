-- Sathya Sai Grama Visitor Management System Database Schema (PostgreSQL)

DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS gate_logs CASCADE;
DROP TABLE IF EXISTS resident_absences CASCADE;
DROP TABLE IF EXISTS registration_vehicles CASCADE;
DROP TABLE IF EXISTS registrations CASCADE;
DROP TABLE IF EXISTS visitors CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS departments CASCADE;
DROP TABLE IF EXISTS system_settings CASCADE;

-- 1. Departments Table
CREATE TABLE departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users Table (Roles: RESIDENT, EMPLOYEE, HOD, GUARD, SUPERVISOR, SECURITY_HEAD, ADMIN)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('RESIDENT', 'EMPLOYEE', 'HOD', 'GUARD', 'SUPERVISOR', 'SECURITY_HEAD', 'ADMIN')),
    residency_status VARCHAR(50) NOT NULL CHECK (residency_status IN ('RESIDENT', 'NON_RESIDENT')),
    department_id INT REFERENCES departments(id) ON DELETE SET NULL,
    password_hash VARCHAR(255) NOT NULL,
    otp_code VARCHAR(6),
    otp_expires_at TIMESTAMP,
    registration_status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (registration_status IN ('PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE departments ADD COLUMN hod_user_id INT REFERENCES users(id) ON DELETE SET NULL;

-- 3. Visitors Table (Enhanced fields: photo_url, id_card_number, id_card_image_url, email, gender, is_frequent_visitor)
CREATE TABLE visitors (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(150),
    gender VARCHAR(20) DEFAULT 'Male' CHECK (gender IN ('Male', 'Female', 'Other')),
    photo_url TEXT,
    id_type VARCHAR(50) DEFAULT 'Aadhaar',
    id_number VARCHAR(50),
    id_card_number VARCHAR(50),
    id_card_image_url TEXT,
    visitor_category VARCHAR(50) DEFAULT 'GENERAL' CHECK (visitor_category IN ('VVIP', 'VIP', 'GENERAL', 'VENDOR', 'CONTRACTOR', 'FOREIGN_NATIONAL', 'DELIVERY', 'CAB', 'MAID', 'FREQUENT_VISITOR')),
    vehicle_no VARCHAR(50),
    vehicle_type VARCHAR(50),
    is_frequent_visitor BOOLEAN DEFAULT FALSE,
    has_smartphone BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Visitor Registrations Table (Enhanced: registration_mode, is_permanent_pass, delivery_phone_lookup)
CREATE TABLE registrations (
    id SERIAL PRIMARY KEY,
    visitor_id INT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    host_id INT REFERENCES users(id) ON DELETE SET NULL,
    purpose TEXT NOT NULL,
    registration_mode VARCHAR(20) DEFAULT 'Single' CHECK (registration_mode IN ('Single', 'Group')),
    registration_type VARCHAR(50) DEFAULT 'PRE_APPROVAL' CHECK (registration_type IN ('PRE_APPROVAL', 'SPOT_REGISTRATION', 'NO_SMARTPHONE', 'FREQUENT_VISITOR', 'DELIVERY_COURIER')),
    visit_type VARCHAR(50) DEFAULT 'OFFICE' CHECK (visit_type IN ('HOME', 'OFFICE', 'TOUR', 'BHAJAN', 'EVENT', 'EMERGENCY')),
    stay_required BOOLEAN DEFAULT FALSE,
    accommodation_approved BOOLEAN DEFAULT FALSE,
    priority VARCHAR(10) DEFAULT 'P3' CHECK (priority IN ('P1', 'P2', 'P3')),
    status VARCHAR(50) DEFAULT 'PENDING_L1' CHECK (status IN ('PENDING_L1', 'PENDING_L2', 'PENDING_ACCOMMODATION', 'APPROVED', 'REJECTED', 'INSIDE_CAMPUS', 'CHECKED_OUT', 'EXPIRED', 'NOT_ARRIVED', 'ADMIN_BYPASSED', 'ESCALATED')),
    pass_code VARCHAR(20) UNIQUE NOT NULL,
    qr_code_url TEXT,
    valid_from TIMESTAMP NOT NULL,
    valid_until TIMESTAMP NOT NULL,
    is_permanent_pass BOOLEAN DEFAULT FALSE,
    adult_men_count INT DEFAULT 1,
    adult_women_count INT DEFAULT 0,
    children_count INT DEFAULT 0,
    person_count INT DEFAULT 1,
    is_vvip BOOLEAN DEFAULT FALSE,
    bypassed_by_admin BOOLEAN DEFAULT FALSE,
    reminder_sent_at TIMESTAMP,
    host_notified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Multiple Registered Vehicles Table
CREATE TABLE registration_vehicles (
    id SERIAL PRIMARY KEY,
    registration_id INT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    plate_number VARCHAR(50) NOT NULL,
    vehicle_type VARCHAR(50) NOT NULL,
    driver_name VARCHAR(100),
    driver_phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Gate Logs Table (Ingress & Egress)
CREATE TABLE gate_logs (
    id SERIAL PRIMARY KEY,
    registration_id INT REFERENCES registrations(id) ON DELETE SET NULL,
    visitor_id INT REFERENCES visitors(id) ON DELETE SET NULL,
    gate_name VARCHAR(50) NOT NULL CHECK (gate_name IN ('NORTH_GATE', 'EAST_GATE', 'WEST_GATE', 'SOUTH_GATE')),
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('IN', 'OUT')),
    person_count INT DEFAULT 1,
    adult_men_count INT DEFAULT 1,
    adult_women_count INT DEFAULT 0,
    children_count INT DEFAULT 0,
    vehicle_no VARCHAR(50),
    recorded_by_guard_id INT REFERENCES users(id) ON DELETE SET NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    remarks TEXT
);

-- 7. Resident Absence Monitoring
CREATE TABLE resident_absences (
    id SERIAL PRIMARY KEY,
    resident_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    departure_date TIMESTAMP NOT NULL,
    expected_return_date TIMESTAMP NOT NULL,
    actual_return_date TIMESTAMP,
    reason TEXT,
    status VARCHAR(50) DEFAULT 'APPROVED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Audit & Exception Logs
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    actor_id INT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INT,
    remarks TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. System Global Settings
CREATE TABLE system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_settings (key, value) VALUES 
('L2_APPROVAL_ENABLED', 'true'),
('ACCOMMODATION_BYPASS_ENABLED', 'false'),
('CURFEW_BYPASS_ENABLED', 'false');

-- 10. Approvers Configuration Table
CREATE TABLE approvers_config (
    id SERIAL PRIMARY KEY,
    host_type VARCHAR(50) NOT NULL,
    approval_required BOOLEAN DEFAULT FALSE,
    approver_role VARCHAR(50),
    l2_to_security_head BOOLEAN DEFAULT FALSE,
    l2_time_condition_start TIME,
    l2_time_condition_end TIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
