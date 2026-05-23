---
id: TASK-006
title: "Gather requirements for kanban board backend"
agent: product-owner
status: done
requirement: REQ-002
plan: null
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Gather and document requirements for the kanban board management backend API (Hono + MongoDB + Better Auth, Railway deployment).

## Context

- Requirement: .guild/requirements/REQ-002.md — Kanban Board Management API

## Acceptance Criteria

- [x] Requirement document REQ-002.md created with user stories and acceptance criteria
- [x] Auth approach confirmed (Better Auth + Google SSO + domain allow-list)
- [x] Data model scope confirmed (boards, columns, cards, labels, assignees, comments, checklists, attachments)
- [x] Real-time approach confirmed (SSE)
- [x] Team model confirmed (auto-join by domain, Admin vs. Member roles)

## Work Log

### 2026-05-23 — product-owner

- Interviewed user: multi-user system, domain allow-list, Better Auth + Google SSO, personal board per user, team board per domain, real-time SSE, dynamic labels/assignees, Admin vs. Member roles, card fields include due date + comments + checklists + attachments.
- Created REQ-002.md with 13 user stories covering auth, board provisioning, columns, cards, labels, teams, and SSE real-time updates.

## Follow-up Tasks

- Plan kanban board backend implementation | agent: architect | priority: high
