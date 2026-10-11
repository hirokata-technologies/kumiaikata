# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Kata API and relay merged into the kumiai SvelteKit app (one container, same origin); Redis and BullMQ removed; Cloud SQL, Cloud Storage attachments and a migration job on Google Cloud
- Removed the Minimax-based AI chat; only hirokata.dev may sign in
- Web app on Google Cloud Run behind a Google load balancer at kumiai.hirokata.dev, with Terraform and a GitHub Actions deploy
- AI agents service (Project Manager + Strategist) on Google ADK 2.0 with Agent Runtime, and Terraform for its Google Cloud infrastructure
- REQ-007: API readiness gate during startup migrations + Railway deploy docs fix (TASK-071 skipped)
- REQ-005: GitHub Actions plan/apply workflow for Railway IaC
- REQ-004: Author .railway/railway.ts (Railway TypeScript IaC) for the kata services
- REQ-003: Bugfix batch: post-REQ-001/REQ-002 triage cleanup
- REQ-002: apps/web Component Testing Tooling
- REQ-001: Kumiaikata App Shell & Data Layer
- REQ-001: AI Chat Assist with Anthropic SDK using Minimax Model
- REQ-002: Flexible Assignee Selection
- REQ-001: Remember Active Workspace on Switch
- REQ-001: Sign Out
- REQ-002: Workspace Switch (Personal, Team)
- REQ-003: Edit Profile
- REQ-004: Settings
- REQ-002: Add Email and Password Login & Sign Up
- REQ-003: Use Resend for Email Sending
- REQ-001: Remove Apple Sign In
- REQ-007: Increase Code Coverage to 70%
- REQ-006: QA Kanban Board Implementation
- REQ-005: QA Google SSO Login Implementation
- REQ-004: Configure Claude Preview to Launch Local Docker Compose
- REQ-003: Update Local Docker Compose
- REQ-001: Migrate from MongoDB to PostgreSQL
- REQ-002: Disable Bot Exploration in kata-web
- REQ-003: Migrate apps/api from Mongoose to Native MongoDB Driver
- REQ-002: Kanban Board Management API
- REQ-001: Dependency Updates and Node 24
- REQ-001: SvelteKit Hello World
