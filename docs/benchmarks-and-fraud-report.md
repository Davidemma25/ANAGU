# ANAGU Prototype Evaluation: Fraud Simulations & Performance Benchmarks

> **Measured Run Timestamp:** `2026-11-13T18:03:12.229Z`  
> **Environment:** Node `v22.23.2` (linux/x64) · Hardhat In-Process EVM (Cancun) · Aedes Embedded TCP Broker + MQTT.js (QoS 1)

## 1. Automated Fraud & Attack Prevention Scenarios (4/4)

| Scenario | Outcome | HTTP Status | Measured Latency (ms) | Evidence |
| --- | --- | --- | --- | --- |
| Scenario 1: Forged / Tampered Document Detection | PASS — DETECTED (TAMPERED_DOCUMENT) | `200` | `51.04` | Oracle flagged 1 conflict(s) on tampered deed. |
| Scenario 2: Overlapping Parcel Boundary Rejection | PASS — REJECTED (HTTP 422 · OVERLAP) | `422` | `17.04` | GIS detected overlap (1 conflicting parcel(s)). |
| Scenario 3: Colluding Community Officer Override Block | PASS — BLOCKED (HTTP 409 · ORACLE_CONFLICT_OVERRIDE_BLOCKED) | `409` | `19.22` | Blocked attempt to override disputed archive INST-2024-003 and logged audit event. |
| Scenario 4: Revoked Title Transfer & Market Reuse Prevention | PASS — BLOCKED (TitleIsRevoked + HTTP 409) | `409` | `1616.64` | Revoked tx 0xa5edb310982d... blocked transfer (TitleIsRevoked(1)) & marketplace listing. |

## 2. Repeated-Trial Subsystem Benchmarks (5 Trials Each)

| Subsystem | Trials | Min (ms) | Mean (ms) | Max (ms) | Avg EVM Gas |
| --- | --- | --- | --- | --- | --- |
| GIS Geometry & Overlap Check | 5 | `0.53` | `0.72` | `1.02` | N/A |
| Community Ownership Oracle Cross-Check | 5 | `0.29` | `0.45` | `0.89` | N/A |
| ERC-721 Title Minting (Polygon EVM) | 5 | `26.12` | `143.32` | `579.74` | `481,411` |
| Polygon Marketplace Escrow (List+Buy+Settle) | 5 | `66.99` | `76.66` | `83.74` | `395,961` |
| Governor Statutory Revocation On-Chain | 5 | `19.13` | `20.53` | `22.65` | `149,949` |
| MQTT QoS 1 Publish + Subscriber Receipt | 5 | `2.75` | `3.59` | `5.47` | N/A |

## 3. Measured Storage Footprint

- **Prototype Store Size after 5 Full Lifecycles:** `22,038 bytes` (21.52 KB)
- **Total Database Records:** `30`
- **Average Footprint per Record:** `735 bytes`
- **Sample ERC-721 Metadata Payload Size:** `91 bytes`
