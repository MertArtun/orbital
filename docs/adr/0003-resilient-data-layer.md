# ADR 0003: Typed stale/fallback envelopes for public upstreams

**Status:** accepted

## Context

The experience depends on free public services with rate limits and uneven availability. A portfolio demo must remain coherent when one service fails.

## Decision

All critical upstreams are called through server route handlers with timeout, response validation and cache policy. Successful normalized data may be held as warm last-good memory. ISS additionally has a repository TLE fixture. Responses indicate live, stale-memory or repository-fallback so the UI can communicate degradation.

## Consequences

The page keeps a useful core during outages and avoids mixed content/rate-limit abuse. Warm memory is best-effort in serverless environments, so only the primary ISS feed receives a durable repository fallback.
