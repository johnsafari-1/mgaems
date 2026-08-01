# MGAEMS — Manna Goodnews Academy Education Management System

A secure, modular, web-based school management platform for Manna Goodnews Academy — a private,
sponsor-funded day school offering Primary School (Grade 1–6) and Junior School (Grade 7–9) under
Kenya's Competency-Based Curriculum (CBC).

This repository is the implementation of the design documented in `/docs`:

- Software Requirements Specification (SRS)
- Business Requirements Document (BRD)
- Use Case Document
- User Role Matrix
- Entity Relationship Diagram (ERD)
- Database Schema
- UI/UX Wireframes
- System Architecture Diagram
- API Design
- Development Roadmap
- Testing Strategy
- Deployment Guide

## Stack

- **Backend:** PHP / Laravel (MVC, Eloquent ORM, built-in CSRF/XSS/SQLi protection, Sanctum for API auth)
- **Database:** MySQL 8.x (InnoDB, utf8mb4)
- **Frontend:** Laravel Blade + responsive CSS (or a lightweight JS layer), per the UI/UX Wireframes
- **Reporting:** PDF/Excel generation libraries (e.g., DomPDF/Snappy, PhpSpreadsheet)

## Why this stack

Laravel was chosen over a bare Node/Express setup because it is secure-by-default for the risks this
project explicitly has to defend against (SQL injection, XSS, CSRF — see SRS §5.2 and the Testing
Strategy's security checklist), and it maps cleanly onto the modular architecture in the System
Architecture Diagram (Eloquent models per entity, Policies for RBAC, versioned API routes).

## Explicitly out of scope (see BRD §5.2)

This system does **not** implement traditional school fee billing/invoicing. Financial support is
tracked exclusively through the Sponsorship & Partnership module.

## Getting started (once Composer/PHP dependencies are installed locally)

```bash
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate --seed
php artisan serve
```

## Project status

Early scaffold stage — see `docs/MGAEMS_DevelopmentRoadmap.docx` for the phased build plan
(Phase 0: Foundations → Phase 7: Pilot & Launch).

## Repository structure

```
app/Http/Controllers/Api   API controllers, one per module
app/Models                 Eloquent models (one per entity in the ERD)
app/Policies                RBAC policies mapped from the User Role Matrix
app/Services                Business logic services
database/migrations         Schema migrations (see docs/Database Schema for full DDL reference)
database/seeders            Roles, default admin user, reference data
routes/api.php               Versioned REST API routes (see docs/API Design)
docs/                        All planning & design documents
```

## License

Proprietary — Manna Goodnews Academy. All rights reserved.
