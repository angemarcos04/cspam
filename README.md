# CSPAMS — Centralized School Performance & Monitoring System

**For the Schools Division Office (SDO) Santiago City — SMM&E Unit**

A modern, compliance-first web platform that replaces manual paperwork and fragmented spreadsheets with a secure, real-time digital workflow.

---

## 🏛️ Mission & Framework Alignment

CSPAMS serves as the **digital backbone** for the two flagship monitoring programs of DepEd SDO Santiago City:

| Pillar | Focus & Description | 🛠️ Implementation Method | 📄 Technical Format |
| :--- | :--- | :--- | :--- |
| **1. Project I-META** | **Integrated Monitoring, Evaluation & Technical Assistance**<br>Digital self-assessment of school quality management systems across Sections I to III. | **Automated Scoring Engine**<br>Provides real-time aggregation and overall school performance ratings. | **Structured JSON**<br>Built-in validation & draft-saving capabilities. |
| **2. Project TARGETS-MET** | **Four Pillar Oversight**<br>Comprehensive tracking of **Resources**, **Access**, **Learning Outcomes**, and **Child Protection Rights**. | **Hybrid Submission Model**<br>Direct integration of existing data to eliminate redundant manual entry. | **Excel / Word**<br>Standard Document Uploads. |
| **3. SMEA** | **School-based Management Effectiveness Assessment**<br>Evaluation of institutional strengths, leadership, and school governance practices. | **Institutional Evaluation**<br>Focus on management and governance effectiveness for division-wide review. | **Word / PDF**<br>File-based Submission. |

**Core Shift**: From tracking individual learners (LRNs) → **Institutional Compliance + Student Welfare Risks** (identified only by grade level & section).

---

## ✨ Key Features

### For School Heads (Submitters)
- **6-digit School Code** login
- Interactive **I-META digital form** with auto-calculation
- Simple file upload for **TARGETS-MET** (Excel/PDF) and **SMEA** reports
- **Welfare Concern Flagging** (no student names or LRNs stored)
- Real-time submission status and review feedback

### For Division Monitors (Evaluators)
- Email-based login with full division visibility
- **Review & Approval Queue** with comment threads
- Live **Division KPI Dashboard** (enrollment trends, submission rates, open concerns)
- Secure download of uploaded school files
- Instant Reverb notifications for new concerns or submissions

---

## 🛠️ Technology Stack

| Layer           | Technology                              |
|-----------------|-----------------------------------------|
| Backend         | Laravel 11 (PHP 8.2+) + Sanctum         |
| Admin Panel     | Filament PHP                            |
| Frontend        | React + TypeScript + Vite + Tailwind    |
| Real-time       | Laravel Reverb + Echo                   |
| Database        | PostgreSQL / MySQL (JSONB for forms)    |
| File Storage    | Private disk (TARGETS-MET & SMEA files) |

---

## 🔐 Access Control

| Role              | Login Method         | Responsibilities |
|-------------------|----------------------|------------------|
| **SMM&E Monitor** | Email + Password     | Review all submissions, manage concerns, generate reports |
| **School Head**   | 6-digit School Code | Submit compliance packages, flag welfare concerns |

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- PHP 8.2+, Node.js 18+, Composer, MySQL/PostgreSQL

### Backend
```bash
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate:fresh --seed
php artisan serve
