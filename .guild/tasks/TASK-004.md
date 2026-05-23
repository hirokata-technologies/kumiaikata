---
id: TASK-004
title: "Update Dockerfile base image to node:24-alpine and verify build"
agent: developer
status: done
requirement: REQ-001
plan: PLAN-001
plan-slice: .guild/plans/PLAN-001/slice-dockerfile-node24.md
depends-on: [TASK-003]
priority: high
created: 2026-05-22
---

## Objective

Change all three Dockerfile FROM stages from node:20-alpine to node:24-alpine and verify the image builds and serves correctly.

## Context

- Requirement: .guild/requirements/REQ-001.md
- Plan: .guild/plans/PLAN-001.md
- Parent task: TASK-002

## Acceptance Criteria

- [x] All three Dockerfile FROM lines updated to node:24-alpine
- [x] docker build succeeds
- [x] Container starts and responds on configured port

## Work Log

### 2026-05-22 — developer
- Updated all three FROM lines in Dockerfile from node:20-alpine to node:24-alpine (lines 4, 10, 18)
- `docker build -t kata-test .` completed successfully across all three stages (deps, build, runtime) with no EBADENGINE warnings
- `docker run --rm kata-test node --version` reported v24.16.0
- Smoke test: container started on port 3001 (mapped from 3000), curl returned HTTP 200
- Cleaned up kata-test image after verification
- No other files modified

## Follow-up Tasks
